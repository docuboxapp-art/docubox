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
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });

    const supabase = getAdminClient();

    // Verify JWT and get user
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });

    const body = await req.json();
    const { deviceName, context, os, browser, deviceCategory } = body;

    // Count active credentials
    const { count } = await supabase
      .from('webauthn_credentials')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('is_active', true);

    const deviceCount = count ?? 0;
    const PLAN_LIMIT = 10; // Default generous limit
    if (deviceCount >= PLAN_LIMIT) {
      return NextResponse.json({ error: 'Alcanzaste el límite de dispositivos de tu plan.' }, { status: 400 });
    }

    // Get existing credential IDs to exclude
    const { data: existingCreds } = await supabase
      .from('webauthn_credentials')
      .select('credential_id')
      .eq('user_id', user.id)
      .eq('is_active', true);

    const excludeCredentials = (existingCreds || []).map((c: { credential_id: string }) => ({
      id: c.credential_id,
      type: 'public-key' as const,
    }));

    // Generate registration options
    const options = await generateRegistrationOptions({
      rpID: getRpId(),
      rpName: RP_NAME,
      userID: new TextEncoder().encode(user.id),
      userName: user.email || user.id,
      userDisplayName: user.email || 'Usuario DOCUBOX',
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'discouraged',
      },
      supportedAlgorithmIDs: [-7, -257],
      excludeCredentials,
    });

    // Store challenge in DB (TTL via expires_at)
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000).toISOString();
    const challengeKey = `reg:${user.id}`;

    await supabase
      .from('webauthn_challenges')
      .upsert({ key: challengeKey, challenge: options.challenge, expires_at: expiresAt }, { onConflict: 'key' });

    return NextResponse.json(options);
  } catch (err) {
    console.error('[webauthn/register-options]', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
