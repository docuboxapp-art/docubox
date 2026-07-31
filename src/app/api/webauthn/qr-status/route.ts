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
    if (!token) return NextResponse.json({ status: 'expired' });

    const supabase = getAdminClient();

    const { data, error } = await supabase
      .from('webauthn_qr_tokens')
      .select('status, device_name, expires_at, used')
      .eq('token', token)
      .single();

    if (error || !data) return NextResponse.json({ status: 'expired' });

    // Check expiry
    if (new Date(data.expires_at) < new Date()) {
      return NextResponse.json({ status: 'expired' });
    }

    return NextResponse.json({ status: data.status, deviceName: data.device_name || null });
  } catch (err) {
    console.error('[webauthn/qr-status]', err);
    return NextResponse.json({ status: 'expired' });
  }
}
