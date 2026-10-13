import { NextRequest, NextResponse } from 'next/server';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const responseHeaders = { 'Cache-Control': 'private, no-store, max-age=0' };

async function workspaceAccess(request: NextRequest, workspaceId: string) {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return { error: NextResponse.json({ error: 'Inicia sesión.' }, { status: 401, headers: responseHeaders }) };
  const { data: auth, error: authError } = await createAnonClient().auth.getUser(token);
  if (authError || !auth.user) return { error: NextResponse.json({ error: 'Sesión no válida.' }, { status: 401, headers: responseHeaders }) };
  if (!UUID.test(workspaceId)) return { error: NextResponse.json({ error: 'Espacio de trabajo no válido.' }, { status: 400, headers: responseHeaders }) };

  const service = createServiceClient();
  const { data: member, error: memberError } = await service.from('workspace_members')
    .select('role,access_expires_at')
    .eq('workspace_id', workspaceId)
    .eq('user_id', auth.user.id)
    .eq('status', 'active')
    .maybeSingle();
  if (memberError) throw memberError;
  if (!member || (member.access_expires_at && new Date(member.access_expires_at).getTime() <= Date.now()))
    return { error: NextResponse.json({ error: 'No tienes acceso a este espacio.' }, { status: 403, headers: responseHeaders }) };
  return { service, canEdit: member.role === 'owner' || member.role === 'admin' };
}

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get('workspaceId') || '';
    const access = await workspaceAccess(request, workspaceId);
    if (access.error) return access.error;
    const { data, error } = await access.service!.from('workspaces')
      .select('participation_terms_text').eq('id', workspaceId).single();
    if (error) throw error;
    return NextResponse.json({ termsText: data.participation_terms_text, canEdit: access.canEdit }, { headers: responseHeaders });
  } catch (error) {
    console.error('[participation-terms:get]', error);
    return NextResponse.json({ error: 'No se pudieron cargar los términos.' }, { status: 500, headers: responseHeaders });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json() as { workspaceId?: unknown; termsText?: unknown };
    const workspaceId = String(body.workspaceId || '');
    const access = await workspaceAccess(request, workspaceId);
    if (access.error) return access.error;
    if (!access.canEdit) return NextResponse.json({ error: 'Solo un administrador puede editar estos términos.' }, { status: 403, headers: responseHeaders });
    if (body.termsText !== null && typeof body.termsText !== 'string')
      return NextResponse.json({ error: 'Texto de términos no válido.' }, { status: 422, headers: responseHeaders });
    const termsText = typeof body.termsText === 'string' ? body.termsText.trim() : null;
    if (termsText !== null && (termsText.length < 30 || termsText.length > 12000))
      return NextResponse.json({ error: 'Escribe entre 30 y 12 000 caracteres.' }, { status: 422, headers: responseHeaders });
    const { data, error } = await access.service!.from('workspaces')
      .update({ participation_terms_text: termsText })
      .eq('id', workspaceId)
      .select('participation_terms_text').single();
    if (error) throw error;
    return NextResponse.json({ termsText: data.participation_terms_text, canEdit: true }, { headers: responseHeaders });
  } catch (error) {
    console.error('[participation-terms:put]', error);
    return NextResponse.json({ error: 'No se pudieron guardar los términos.' }, { status: 500, headers: responseHeaders });
  }
}
