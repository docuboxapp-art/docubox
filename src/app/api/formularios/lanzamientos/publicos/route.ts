import { NextRequest, NextResponse } from 'next/server';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (error: string, status: number) => NextResponse.json({ error }, { status, headers });

async function authenticate(request: NextRequest) {
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return null;
  const userClient = createAnonClient(token);
  const { data: { user }, error } = await userClient.auth.getUser(token);
  return error || !user ? null : { user, userClient };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticate(request);
    if (!auth) return reply('Tu sesión expiró.', 401);
    const workspaceId = request.nextUrl.searchParams.get('workspace_id') || '';
    if (!uuidPattern.test(workspaceId)) return reply('Selecciona un espacio de trabajo.', 400);
    const { data: templates, error: templateError } = await auth.userClient
      .from('form_templates').select('id').eq('workspace_id', workspaceId);
    if (templateError) throw templateError;
    const ids = (templates || []).map((template) => template.id);
    if (!ids.length) return NextResponse.json({ invitees: [] }, { headers });

    const service = createServiceClient();
    const invitees = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await service.from('form_public_invitees')
        .select('form_id,recipient_name,recipient_email,invited_at')
        .in('form_id', ids).order('invited_at', { ascending: false })
        .range(offset, offset + 499);
      if (error) throw error;
      invitees.push(...(data || []));
      if (!data || data.length < 500) break;
    }
    return NextResponse.json({ invitees }, { headers });
  } catch (error) {
    console.error('[public-form-invitees-list]', error);
    return reply('No se pudieron consultar las invitaciones con código.', 503);
  }
}
