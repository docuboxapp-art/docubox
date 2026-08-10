import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { getWebAuthnChallengeKey, getWebAuthnRequestConfig } from '@/lib/webauthn/request-config';

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email) {
      return NextResponse.json({ error: 'Email requerido.' }, { status: 400 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Resolve user_id from email
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('id')
      .eq('email', email.trim().toLowerCase())
      .maybeSingle();

    if (!profile?.id) {
      return NextResponse.json(
        { error: 'No se encontraron dispositivos registrados.' },
        { status: 404 }
      );
    }

    const userId = profile.id;
    const { rpId } = getWebAuthnRequestConfig(req);

    // Fetch active credentials
    const { data: creds } = await supabaseAdmin
      .from('webauthn_credentials')
      .select('credential_id, public_key, sign_count')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (!creds || creds.length === 0) {
      return NextResponse.json(
        { error: 'No se encontraron dispositivos registrados.' },
        { status: 404 }
      );
    }

    // Build allowCredentials list
    const allowCredentials = creds.map((c) => ({
      id: c.credential_id,
      type: 'public-key' as const,
    }));

    const options = await generateAuthenticationOptions({
      rpID: rpId,
      userVerification: 'required',
      allowCredentials,
      timeout: 60000,
    });

    // Persist challenge in webauthn_challenges table (TTL 5 min)
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const challengeKey = getWebAuthnChallengeKey('webauthn:auth', userId, rpId);

    // Upsert challenge
    await supabaseAdmin
      .from('webauthn_challenges')
      .upsert(
        { key: challengeKey, challenge: options.challenge, expires_at: expiresAt },
        { onConflict: 'key' }
      );

    return NextResponse.json(options);
  } catch (err) {
    console.error('[webauthn/auth-options]', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
