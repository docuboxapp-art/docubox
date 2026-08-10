import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getWebAuthnRequestConfig } from '@/lib/webauthn/request-config';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const QR_TTL_SECONDS = 300;

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

    // Generate unique QR token
    const qrToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + QR_TTL_SECONDS * 1000).toISOString();

    // Insert QR token record
    const { error: insertError } = await supabase.from('webauthn_qr_tokens').insert({
      user_id: user.id,
      token: qrToken,
      status: 'pending',
      used: false,
      expires_at: expiresAt,
    });

    if (insertError) {
      console.error('[webauthn/generate-qr] insert error:', insertError);
      return NextResponse.json({ error: 'Error al generar el código QR.' }, { status: 500 });
    }

    const { origin } = getWebAuthnRequestConfig(req);
    const qrUrl = `${origin}/register-device?token=${qrToken}`;

    return NextResponse.json({ token: qrToken, qrUrl, expiresIn: QR_TTL_SECONDS });
  } catch (err) {
    console.error('[webauthn/generate-qr]', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
