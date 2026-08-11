import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email) {
      return NextResponse.json({ error: 'Email requerido' }, { status: 400 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Get user profile (id + nombre)
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('id, nombre')
      .eq('email', email.trim().toLowerCase())
      .maybeSingle();

    if (!profile?.id) {
      return NextResponse.json({
        found: false,
        emailVerified: false,
        hasWebAuthn: false,
        webAuthnDevices: [],
        nombre: null,
      });
    }

    // Check email_verified
    const { data: verifData } = await supabaseAdmin
      .from('user_verification_status')
      .select('email_verified')
      .eq('user_id', profile.id)
      .maybeSingle();

    // Fetch active webauthn credentials with device details
    // Note: table uses 'registered_from' and 'created_at' (not 'registration_method'/'registered_at')
    const { data: webauthnCreds, error: webauthnError } = await supabaseAdmin
      .from('webauthn_credentials')
      .select('id, device_name, os, browser, device_category, created_at, registered_from')
      .eq('user_id', profile.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (webauthnError) {
      console.error('[check-login-options] webauthn query error:', webauthnError);
    }

    const rawDevices = Array.isArray(webauthnCreds) ? webauthnCreds : [];

    // Normalize to the shape LoginForm expects
    const devices = rawDevices.map((d) => ({
      id: d.id,
      device_name: d.device_name ?? null,
      os: d.os ?? null,
      browser: d.browser ?? null,
      device_category: d.device_category ?? null,
      registered_at: d.created_at ?? null,
      registration_method: d.registered_from ?? null,
    }));

    return NextResponse.json({
      found: true,
      emailVerified: verifData?.email_verified === true,
      hasWebAuthn: devices.length > 0,
      webAuthnDevices: devices,
      nombre: profile.nombre || null,
    });
  } catch (err) {
    console.error('[check-login-options]', err);
    return NextResponse.json(
      { found: false, emailVerified: false, hasWebAuthn: false, webAuthnDevices: [], nombre: null },
      { status: 500 }
    );
  }
}
