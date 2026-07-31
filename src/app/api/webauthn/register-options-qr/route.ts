import { NextRequest, NextResponse } from 'next/server';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const RP_NAME = 'DOCUBOX';
const CHALLENGE_TTL_SECONDS = 300;

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

function getAdminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { token, deviceCategory } = body;

    if (!token) return NextResponse.json({ error: 'Token requerido.' }, { status: 400 });

    const supabase = getAdminClient();

    // Validate QR token and get userId
    const { data: qrRow, error: qrError } = await supabase
      .from('webauthn_qr_tokens')
      .select('user_id, status, used, expires_at')
      .eq('token', token)
      .single();

    if (qrError || !qrRow) {
      return NextResponse.json({ error: 'Enlace inválido o ya utilizado.' }, { status: 400 });
    }
    if (qrRow.used || qrRow.status !== 'pending') {
      return NextResponse.json({ error: 'Enlace inválido o ya utilizado.' }, { status: 400 });
    }
    if (new Date(qrRow.expires_at) < new Date()) {
      return NextResponse.json({ error: 'El código QR expiró. Genera uno nuevo.' }, { status: 400 });
    }

    const userId = qrRow.user_id;

    // Get user info
    const { data: { user } } = await supabase.auth.admin.getUserById(userId);
    if (!user) return NextResponse.json({ error: 'Usuario no encontrado.' }, { status: 400 });

    // Count active credentials
    const { count } = await supabase
      .from('webauthn_credentials')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_active', true);

    const PLAN_LIMIT = 10;
    if ((count ?? 0) >= PLAN_LIMIT) {
      return NextResponse.json({ error: 'Alcanzaste el límite de dispositivos de tu plan.' }, { status: 400 });
    }

    // Get existing credentials to exclude
    const { data: existingCreds } = await supabase
      .from('webauthn_credentials')
      .select('credential_id')
      .eq('user_id', userId)
      .eq('is_active', true);

    const excludeCredentials = (existingCreds || []).map((c: { credential_id: string }) => ({
      id: c.credential_id,
      type: 'public-key' as const,
    }));

    // Generate registration options
    const options = await generateRegistrationOptions({
      rpID: getRpId(),
      rpName: RP_NAME,
      userID: new TextEncoder().encode(userId),
      userName: user.email || userId,
      userDisplayName: user.email || 'Usuario DOCUBOX',
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'discouraged',
      },
      supportedAlgorithmIDs: [-7, -257],
      excludeCredentials,
    });

    // Store challenge
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000).toISOString();
    const challengeKey = `reg:qr:${token}`;

    await supabase
      .from('webauthn_challenges')
      .upsert({ key: challengeKey, challenge: options.challenge, expires_at: expiresAt }, { onConflict: 'key' });

    return NextResponse.json(options);
  } catch (err) {
    console.error('[webauthn/register-options-qr]', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
