import { NextRequest, NextResponse } from 'next/server';
import { activityFailure, activityHeaders } from '@/lib/activity/access.server';
import { requireCaseWorkspace } from '@/lib/case-files/consultation.server';
import { CaseRuntimeError, isUuid } from '@/lib/case-files/runtime.server';
import { isContactResourceKind, normalizeContactEmail } from '@/lib/contacts/detail';
import { loadContactResources } from '@/lib/contacts/resources.server';
import { DocumentAccessError, requireDocumentIdentity } from '@/lib/security/document-access';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const reply = (data: unknown, status = 200) =>
    NextResponse.json(data, { status, headers: activityHeaders });
  try {
    const { id } = await context.params;
    const query = request.nextUrl.searchParams;
    const workspaceId = query.get('workspaceId');
    const kind = query.get('tipo');
    if (!isUuid(id) || !isUuid(workspaceId) || !isContactResourceKind(kind))
      return reply(
        { error: 'Selecciona un contacto, un espacio de trabajo y una vista válidos.' },
        422
      );

    const { token, user } = await requireDocumentIdentity(request);
    if (user.is_anonymous || !user.email_confirmed_at)
      throw new DocumentAccessError(
        'AUTH_UNVERIFIED',
        'Confirma tu correo para consultar la actividad del contacto.',
        403
      );

    const deadline = AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]);
    const db = createAnonClient(token, deadline);
    const service = createServiceClient(deadline);
    const contact = await db
      .from('contacts')
      .select('email')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (contact.error) throw contact.error;
    if (!contact.data) return reply({ error: 'El contacto no se encuentra en tu agenda.' }, 404);
    await requireCaseWorkspace(service, workspaceId, user.id);
    const rows = await loadContactResources(
      db,
      service,
      { id: user.id, email: normalizeContactEmail(user.email) },
      { workspaceId, email: normalizeContactEmail(contact.data.email) },
      kind
    );
    return reply({ data: rows });
  } catch (error) {
    const failure =
      error instanceof CaseRuntimeError
        ? { error: error.message, status: error.status }
        : activityFailure(error);
    return reply({ error: failure.error }, failure.status);
  }
}
