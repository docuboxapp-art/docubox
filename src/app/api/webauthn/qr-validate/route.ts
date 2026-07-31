import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getAdminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get('token') || '';
    if (!token) return NextResponse.json({ error: 'Token requerido.' }, { status: 400 });

    const supabase = getAdminClient();

    const { data, error } = await supabase
      .from('webauthn_qr_tokens')
      .select('status, used, expires_at, user_id')
      .eq('token', token)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Enlace inválido o ya utilizado.' }, { status: 400 });
    }

    if (data.used || data.status !== 'pending') {
      return NextResponse.json({ error: 'Enlace inválido o ya utilizado.' }, { status: 400 });
    }

    if (new Date(data.expires_at) < new Date()) {
      return NextResponse.json({ error: 'El código QR expiró. Genera uno nuevo.' }, { status: 400 });
    }

    return NextResponse.json({ valid: true });
  } catch (err) {
    console.error('[webauthn/qr-validate]', err);
    return NextResponse.json({ error: 'Error al validar token.' }, { status: 500 });
  }
}
