import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';

function getRpId(): string {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'firmamax4272.builtwithrocket.new';
  try {
    return new URL(siteUrl).hostname;
  } catch {
    return siteUrl;
  }
}

function getExpectedOrigin(): string {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://firmamax4272.builtwithrocket.new';
  return siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`;
}

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

    // Retrieve challenge
    const challengeKey = `webauthn:auth:${userId}`;
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
    let publicKeyBytes: Uint8Array;
    const rawKey = credRow.public_key as string | Uint8Array | Buffer;

    if (typeof rawKey === 'string') {
      let base64Str: string;
      if (rawKey.startsWith('\\x') || rawKey.startsWith('\x00') || /^[0-9a-fA-F]+$/.test(rawKey.replace(/^\\x/, ''))) {
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
      publicKeyBytes = new Uint8Array(rawKey as ArrayBuffer);
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: credential,
        expectedChallenge: challengeRow.challenge,
        expectedOrigin: getExpectedOrigin(),
        expectedRPID: getRpId(),
        credential: {
          id: credRow.credential_id,
          publicKey: publicKeyBytes,
          counter: Number(credRow.sign_count),
        },
        requireUserVerification: true,
      });
    } catch (verifyErr) {
      console.error('[webauthn/auth-verify] verification failed:', verifyErr);
      return NextResponse.json({ error: 'Autenticación biométrica fallida. Intenta de nuevo.' }, { status: 400 });
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
      return NextResponse.json({ error: 'Alerta de seguridad: posible clonación de dispositivo.' }, { status: 400 });
    }

    // Update sign_count and last_used_at
    await supabaseAdmin
      .from('webauthn_credentials')
      .update({ sign_count: newCounter, last_used_at: new Date().toISOString() })
      .eq('id', credRow.id);

    // Delete challenge
    await supabaseAdmin.from('webauthn_challenges').delete().eq('key', challengeKey);

    // Audit log
    await supabaseAdmin.from('webauthn_audit').insert({
      user_id: userId,
      credential_id: credRow.credential_id,
      event_type: 'login',
      context: 'browser_desktop',
      success: true,
      ip: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null,
    }).catch(() => {/* non-blocking */});

    // Create Supabase session
    const { data: sessionData, error: sessionError } = await supabaseAdmin.auth.admin.createSession({ user_id: userId });
    if (sessionError || !sessionData?.session) {
      console.error('[webauthn/auth-verify] session creation failed:', sessionError);
      return NextResponse.json({ error: 'No se pudo crear la sesión. Intenta de nuevo.' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      userId,
      session: {
        access_token: sessionData.session.access_token,
        refresh_token: sessionData.session.refresh_token,
      },
    });
  } catch (err) {
    console.error('[webauthn/auth-verify]', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
