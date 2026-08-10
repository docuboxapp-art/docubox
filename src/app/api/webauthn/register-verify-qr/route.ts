import { NextRequest, NextResponse } from 'next/server';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { createClient } from '@supabase/supabase-js';
import { getWebAuthnChallengeKey, getWebAuthnRequestConfig } from '@/lib/webauthn/request-config';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getAdminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { credential, token, deviceName, deviceType, context, os, browser, deviceCategory } =
      body;

    if (!token || !credential) {
      return NextResponse.json({ error: 'Datos incompletos.' }, { status: 400 });
    }

    const supabase = getAdminClient();

    // Validate QR token
    const { data: qrRow, error: qrError } = await supabase
      .from('webauthn_qr_tokens')
      .select('user_id, status, used, expires_at')
      .eq('token', token)
      .single();

    if (qrError || !qrRow || qrRow.used || qrRow.status !== 'pending') {
      return NextResponse.json({ error: 'Enlace inválido o ya utilizado.' }, { status: 400 });
    }
    if (new Date(qrRow.expires_at) < new Date()) {
      return NextResponse.json(
        { error: 'El código QR expiró. Genera uno nuevo.' },
        { status: 400 }
      );
    }

    const userId = qrRow.user_id;
    const { origin, rpId } = getWebAuthnRequestConfig(req);

    // Retrieve challenge
    const challengeKey = getWebAuthnChallengeKey('reg:qr', token, rpId);
    const { data: challengeRow } = await supabase
      .from('webauthn_challenges')
      .select('challenge, expires_at')
      .eq('key', challengeKey)
      .single();

    if (!challengeRow || new Date(challengeRow.expires_at) < new Date()) {
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
      console.error('[webauthn/register-verify-qr] verification failed:', verifyErr);
      return NextResponse.json(
        { error: 'Verificación biométrica fallida. Intenta de nuevo.' },
        { status: 400 }
      );
    }

    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json({ error: 'Verificación biométrica fallida.' }, { status: 400 });
    }

    const { credential: regCredential, aaguid } = verification.registrationInfo;
    const finalDeviceName = deviceName || 'Dispositivo móvil';

    // Insert credential
    const { error: insertError } = await supabase.from('webauthn_credentials').insert({
      user_id: userId,
      credential_id: regCredential.id,
      public_key: Buffer.from(regCredential.publicKey).toString('base64'),
      sign_count: regCredential.counter,
      aaguid: aaguid || null,
      device_type: deviceType || null,
      device_name: finalDeviceName,
      device_category: deviceCategory || 'mobile',
      os: os || null,
      browser: browser || null,
      context: context || 'browser_mobile',
      registered_from: 'qr',
      is_active: true,
    });

    if (insertError) {
      console.error('[webauthn/register-verify-qr] insert error:', insertError);
      return NextResponse.json({ error: 'Error al guardar el dispositivo.' }, { status: 500 });
    }

    // Update QR token: mark as completed
    await supabase
      .from('webauthn_qr_tokens')
      .update({ status: 'completed', used: true, device_name: finalDeviceName })
      .eq('token', token);

    // Insert audit log
    await supabase.from('webauthn_audit').insert({
      user_id: userId,
      credential_id: regCredential.id,
      event_type: 'register_mobile_qr',
      device_name: finalDeviceName,
      device_type: deviceType || null,
      device_category: deviceCategory || 'mobile',
      context: context || 'browser_mobile',
      registered_from: 'qr',
      ip: req.headers.get('x-forwarded-for') || null,
      user_agent: req.headers.get('user-agent') || null,
      sign_count: regCredential.counter,
      success: true,
    });

    // Delete challenge
    await supabase.from('webauthn_challenges').delete().eq('key', challengeKey);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[webauthn/register-verify-qr]', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
