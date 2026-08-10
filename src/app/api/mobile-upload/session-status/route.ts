import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get('token') || '';
  if (!/^[a-f0-9]{64}$/i.test(token)) {
    return NextResponse.json({ error: 'Sesion no encontrada.' }, { status: 404 });
  }

  const supabase = createServiceClient();
  const { data: session } = await supabase
    .from('mobile_upload_sessions')
    .select('status,expires_at,user_id,metadata')
    .eq('token', token)
    .maybeSingle();
  if (!session) {
    return NextResponse.json({ error: 'Sesion no encontrada.' }, { status: 404 });
  }

  let profile: { curp: string | null; full_name: string | null; email: string | null } | null = null;
  const userId = session.user_id || session.metadata?.user_id || null;
  if (userId) {
    const { data } = await supabase
      .from('user_profiles')
      .select('curp,full_name,email')
      .eq('id', userId)
      .maybeSingle();
    profile = data || null;
  }

  return NextResponse.json({
    status: session.status,
    expiresAt: session.expires_at,
    mode: session.metadata?.mode || 'document_upload',
    profile,
  }, { headers: { 'Cache-Control': 'no-store, private' } });
}
