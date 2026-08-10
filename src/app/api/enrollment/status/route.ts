import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') || '';
  const sessionId = request.nextUrl.searchParams.get('session_id') || '';
  if (!token || !sessionId) {
    return NextResponse.json({ error: 'token y session_id son requeridos' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: enrollmentToken } = await supabase
    .from('enrollment_tokens')
    .select('id,status,expires_at,session_id')
    .eq('token', token)
    .eq('session_id', sessionId)
    .maybeSingle();
  if (!enrollmentToken) return NextResponse.json({ error: 'Enrolamiento no encontrado' }, { status: 404 });
  if (new Date(enrollmentToken.expires_at).getTime() <= Date.now() && enrollmentToken.status !== 'completed') {
    return NextResponse.json({ status: 'expired' }, { status: 410 });
  }

  const { data: result } = await supabase
    .from('enrollment_results')
    .select('id,status,nombre,apellido_paterno,apellido_materno,curp,rfc,fecha_nacimiento,sexo,tipo_identificacion,face_match_passed,created_at')
    .eq('enrollment_token_id', enrollmentToken.id)
    .eq('status', 'completed')
    .maybeSingle();

  return NextResponse.json({
    status: result ? 'completed' : enrollmentToken.status,
    result: result || null,
  }, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}
