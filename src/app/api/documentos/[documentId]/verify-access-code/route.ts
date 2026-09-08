import { createHash } from 'crypto';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createServiceClient } from '@/lib/supabase/server';
import {
  createDocumentViewAccessToken,
  documentViewCookieName,
  DOCUMENT_VIEW_ACCESS_TTL_SECONDS,
} from '@/lib/security/document-view-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function email(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

async function getUser() {
  const cookieStore = await cookies();
  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => undefined } }
  );
  const result = await client.auth.getUser();
  return result.error ? null : result.data.user;
}

export async function POST(request: NextRequest, context: { params: Promise<{ documentId: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const code = typeof body?.code === 'string' ? body.code : '';
  if (!code || code.length > 128) {
    return NextResponse.json({ error: 'Ingresa un código de acceso válido.' }, { status: 400 });
  }

  const { documentId } = await context.params;
  const service = createServiceClient();
  const result = await service
    .from('documentos')
    .select('id,owner_id,workspace_id,participantes')
    .eq('id', documentId)
    .is('deleted_at', null)
    .maybeSingle();
  if (result.error) throw result.error;
  const document = result.data;
  if (!document) return NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 });

  const participant = Array.isArray(document.participantes) && document.participantes.some((item) => {
    const row = item as Record<string, unknown>;
    return row.user_id === user.id || row.id === user.id || email(row.email) === email(user.email);
  });
  const membership = document.workspace_id
    ? await service
        .from('workspace_members')
        .select('role,status,access_expires_at')
        .eq('workspace_id', document.workspace_id)
        .eq('user_id', user.id)
        .eq('status', 'active')
        .maybeSingle()
    : { data: null, error: null };
  if (membership.error) throw membership.error;
  const canManage = ['owner', 'admin'].includes(String(membership.data?.role));
  if (document.owner_id !== user.id && !participant && !canManage) {
    return NextResponse.json({ error: 'No tienes acceso a este documento.' }, { status: 403 });
  }

  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const ipHash = createHash('sha256').update(forwarded).digest('hex');
  const verification = await service.rpc('verify_document_access_code', {
    p_documento_id: document.id,
    p_user_id: user.id,
    p_ip_hash: ipHash,
    p_code: code,
  });
  if (verification.error) throw verification.error;
  const data = verification.data as { ok?: boolean; code?: string } | null;
  if (!data?.ok) {
    const status = data?.code === 'RATE_LIMITED' ? 429 : 401;
    return NextResponse.json(
      {
        error:
          data?.code === 'RATE_LIMITED'
            ? 'Demasiados intentos. Intenta de nuevo en 15 minutos.'
            : 'El código de acceso no es correcto.',
        code: data?.code || 'INVALID_CODE',
      },
      { status, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const { token } = createDocumentViewAccessToken(document.id, user.id);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(documentViewCookieName(document.id), token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: `/api/documentos/${document.id}/viewer-file`,
    maxAge: DOCUMENT_VIEW_ACCESS_TTL_SECONDS,
  });
  return response;
}
