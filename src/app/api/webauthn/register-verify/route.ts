import { NextRequest, NextResponse } from 'next/server';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { createClient } from '@supabase/supabase-js';
import { getWebAuthnChallengeKey, getWebAuthnRequestConfig } from '@/lib/webauthn/request-config';
import {
  createPlatformPasskeyProof,
  PLATFORM_PASSKEY_COOKIE,
  platformPasskeyCookieOptions,
} from '@/lib/security/platform-passkey-proof';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getAdminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });

    const supabase = getAdminClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });

    const body = await req.json();
    const {
      credential,
      deviceName,
      deviceType,
      context,
      os,
      browser,
      deviceCategory,
      registeredFrom,
    } = body;
    const { origin, rpId } = getWebAuthnRequestConfig(req);

    // Retrieve challenge
    const challengeKey = getWebAuthnChallengeKey('reg', user.id, rpId);
    const { data: challengeRow } = await supabase
      .from('webauthn_challenges')
      .select('challenge, expires_at')
      .eq('key', challengeKey)
      .single();

    if (!challengeRow) {
      return NextResponse.json({ error: 'Sesión expirada, recarga la página.' }, { status: 400 });
    }
    if (new Date(challengeRow.expires_at) < new Date()) {
      await supabase.from('webauthn_challenges').delete().eq('key', challengeKey);
      return NextResponse.json({ error: 'Sesión expirada, recarga la página.' }, { status: 400 });
    }

    // Verify registration
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: credential,
        expectedChallenge: challengeRow.challenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
        requireUserVerification: true,
      });
    } catch (verifyErr) {
      console.error('[webauthn/register-verify] verification failed:', verifyErr);
      return NextResponse.json(
        { error: 'Verificación biométrica fallida. Intenta de nuevo.' },
        { status: 400 }
      );
    }

    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json({ error: 'Verificación biométrica fallida.' }, { status: 400 });
    }

    const { credential: regCredential, aaguid } = verification.registrationInfo;

    // Insert credential
    const { error: insertError } = await supabase.from('webauthn_credentials').insert({
      user_id: user.id,
      credential_id: regCredential.id,
      public_key: Buffer.from(regCredential.publicKey).toString('base64'),
      sign_count: regCredential.counter,
      aaguid: aaguid || null,
      device_type: deviceType || null,
      device_name: deviceName || 'Mi dispositivo',
      device_category: deviceCategory || 'desktop',
      os: os || null,
      browser: browser || null,
      context: context || 'browser_desktop',
      registered_from: registeredFrom || 'direct',
      is_active: true,
    });

    if (insertError) {
      console.error('[webauthn/register-verify] insert error:', insertError);
      return NextResponse.json({ error: 'Error al guardar el dispositivo.' }, { status: 500 });
    }

    // Insert audit log
    await supabase.from('webauthn_audit').insert({
      user_id: user.id,
      credential_id: regCredential.id,
      event_type: 'register_desktop',
      device_name: deviceName || 'Mi dispositivo',
      device_type: deviceType || null,
      device_category: deviceCategory || 'desktop',
      context: context || 'browser_desktop',
      registered_from: registeredFrom || 'direct',
      ip: req.headers.get('x-forwarded-for') || null,
      user_agent: req.headers.get('user-agent') || null,
      sign_count: regCredential.counter,
      success: true,
    });

    // Delete challenge
    await supabase.from('webauthn_challenges').delete().eq('key', challengeKey);

    const response = NextResponse.json({ success: true, credentialId: regCredential.id });
    response.cookies.set(
      PLATFORM_PASSKEY_COOKIE,
      createPlatformPasskeyProof(user.id),
      platformPasskeyCookieOptions()
    );
    return response;
  } catch (err) {
    console.error('[webauthn/register-verify]', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
