import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { getWebAuthnChallengeKey, getWebAuthnRequestConfig } from '@/lib/webauthn/request-config';
import {
  createPlatformPasskeyProof,
  PLATFORM_PASSKEY_COOKIE,
  platformPasskeyCookieOptions,
} from '@/lib/security/platform-passkey-proof';

export async function POST(req: NextRequest) {
  try {
    const { email, credential } = await req.json();
    if (!email || !credential) {
      return NextResponse.json({ error: 'Email y credencial requeridos.' }, { status: 400 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Resolve user_id
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('id')
      .eq('email', email.trim().toLowerCase())
      .maybeSingle();

    if (!profile?.id) {
      return NextResponse.json({ error: 'Usuario no encontrado.' }, { status: 404 });
    }
    const userId = profile.id;
    const { origin, rpId } = getWebAuthnRequestConfig(req);

    // Retrieve challenge
    const challengeKey = getWebAuthnChallengeKey('webauthn:auth', userId, rpId);
    const { data: challengeRow } = await supabaseAdmin
      .from('webauthn_challenges')
      .select('challenge, expires_at')
      .eq('key', challengeKey)
      .maybeSingle();

    if (!challengeRow) {
      return NextResponse.json({ error: 'Sesión expirada, recarga la página.' }, { status: 400 });
    }
    if (new Date(challengeRow.expires_at) < new Date()) {
      await supabaseAdmin.from('webauthn_challenges').delete().eq('key', challengeKey);
      return NextResponse.json({ error: 'Sesión expirada, recarga la página.' }, { status: 400 });
    }

    // Find the credential in DB
    const { data: credRow } = await supabaseAdmin
      .from('webauthn_credentials')
      .select('id, credential_id, public_key, sign_count')
      .eq('credential_id', credential.id)
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();

    if (!credRow) {
      return NextResponse.json({ error: 'Dispositivo no reconocido.' }, { status: 400 });
    }

    // public_key is stored as a base64 string inserted into a BYTEA column.
    // Supabase returns BYTEA as a hex string prefixed with \x (e.g. "\x6147567a...").
    // We need to: hex → UTF-8 string (which is the base64) → Uint8Array (the actual key bytes).
    let publicKeyBytes: Uint8Array<ArrayBuffer>;
    const rawKey = credRow.public_key as string | Uint8Array | Buffer;

    if (typeof rawKey === 'string') {
      let base64Str: string;
      if (
        rawKey.startsWith('\\x') ||
        rawKey.startsWith('\x00') ||
        /^[0-9a-fA-F]+$/.test(rawKey.replace(/^\\x/, ''))
      ) {
        // Hex-encoded BYTEA from Supabase: strip \x prefix and decode hex to get the base64 string
        const hex = rawKey.startsWith('\\x') ? rawKey.slice(2) : rawKey;
        let decoded = '';
        for (let i = 0; i < hex.length; i += 2) {
          decoded += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
        }
        base64Str = decoded;
      } else {
        // Already a plain base64 string
        base64Str = rawKey;
      }
      // Now decode base64 → binary bytes
      try {
        const binary = atob(base64Str);
        publicKeyBytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) publicKeyBytes[i] = binary.charCodeAt(i);
      } catch {
        // If atob fails, treat the string itself as raw bytes
        publicKeyBytes = new Uint8Array(base64Str.length);
        for (let i = 0; i < base64Str.length; i++) publicKeyBytes[i] = base64Str.charCodeAt(i);
      }
    } else {
      const copiedKey = new Uint8Array(rawKey.byteLength);
      copiedKey.set(rawKey);
      publicKeyBytes = copiedKey;
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: credential,
        expectedChallenge: challengeRow.challenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
        credential: {
          id: credRow.credential_id,
          publicKey: publicKeyBytes,
          counter: Number(credRow.sign_count),
        },
        requireUserVerification: true,
      });
    } catch (verifyErr) {
      console.error('[webauthn/auth-verify] verification failed:', verifyErr);
      return NextResponse.json(
        { error: 'Autenticación biométrica fallida. Intenta de nuevo.' },
        { status: 400 }
      );
    }

    if (!verification.verified) {
      return NextResponse.json({ error: 'Autenticación biométrica fallida.' }, { status: 400 });
    }

    const newCounter = verification.authenticationInfo.newCounter;

    // Clone detection
    if (newCounter <= Number(credRow.sign_count) && Number(credRow.sign_count) > 0) {
      await supabaseAdmin.from('webauthn_audit').insert({
        user_id: userId,
        credential_id: credRow.credential_id,
        event_type: 'clone_detected',
        context: 'browser_desktop',
        success: false,
      });
      return NextResponse.json(
        { error: 'Alerta de seguridad: posible clonación de dispositivo.' },
        { status: 400 }
      );
    }

    // Update sign_count and last_used_at
    await supabaseAdmin
      .from('webauthn_credentials')
      .update({ sign_count: newCounter, last_used_at: new Date().toISOString() })
      .eq('id', credRow.id);

    // Delete challenge
    await supabaseAdmin.from('webauthn_challenges').delete().eq('key', challengeKey);

    // Audit log
    const { error: auditError } = await supabaseAdmin.from('webauthn_audit').insert({
      user_id: userId,
      credential_id: credRow.credential_id,
      event_type: 'login',
      context: 'browser_desktop',
      success: true,
      ip: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null,
    });
    if (auditError) {
      console.warn('[webauthn/auth-verify] audit log failed:', auditError.message);
    }

    // Generate a one-time token that the verified browser exchanges for its session.
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: email.trim().toLowerCase(),
    });
    if (linkError || !linkData?.properties?.hashed_token) {
      console.error('[webauthn/auth-verify] session token generation failed:', linkError);
      return NextResponse.json(
        { error: 'No se pudo crear la sesión. Intenta de nuevo.' },
        { status: 500 }
      );
    }

    const successResponse = NextResponse.json({
      success: true,
      userId,
      tokenHash: linkData.properties.hashed_token,
    });
    successResponse.cookies.set('docubox_session_start', Math.floor(Date.now() / 1000).toString(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 10 * 60 * 60 + 300,
    });
    successResponse.cookies.set(
      PLATFORM_PASSKEY_COOKIE,
      createPlatformPasskeyProof(userId),
      platformPasskeyCookieOptions()
    );
    return successResponse;
  } catch (err) {
    console.error('[webauthn/auth-verify]', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
