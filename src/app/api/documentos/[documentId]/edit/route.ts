import { NextRequest, NextResponse } from 'next/server';
import { documentAccessResponse, requireDocumentAccess } from '@/lib/security/document-access';
import { canRenameDocument } from '@/lib/documents/workspace-actions';
import { canEditUnsignedDocument } from '@/lib/documents/workspace-actions.server';

const ALLOWED_DOCUMENT_FIELDS = new Set([
  'nombre',
  'descripcion',
  'numero_oficio',
  'grupo_tipo_documento_id',
  'tipo_documento_id',
  'otro_tipo_documento',
  'etiquetas_ids',
  'participantes',
  'participant_mode',
  'participation_order',
  'fecha_vencimiento',
  'fecha_vencimiento_timezone',
  'tiene_vencimiento',
  'campos_solicitados',
  'tiene_codigo_acceso',
  'es_urgente',
  'es_publico',
]);

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await context.params;
    const { user, document, service } = await requireDocumentAccess(request, documentId, {
      requireEdit: true,
    });
    const body = await request.json().catch(() => null);
    const updates = Object.fromEntries(
      Object.entries(body?.updates || {}).filter(
        ([key, value]) => ALLOWED_DOCUMENT_FIELDS.has(key) && value !== undefined
      )
    );
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No hay cambios válidos para guardar.' }, { status: 400 });
    }
    if ('nombre' in updates && (typeof updates.nombre !== 'string' || !updates.nombre.trim())) {
      return NextResponse.json(
        { error: 'El nombre del documento es obligatorio.' },
        { status: 400 }
      );
    }
    const renameOnly = body?.operation === 'rename';
    if (renameOnly && (Object.keys(updates).length !== 1 || !('nombre' in updates))) {
      return NextResponse.json({ error: 'Esta acción solo admite el nombre.' }, { status: 400 });
    }
    if (
      renameOnly
        ? !canRenameDocument(document)
        : !(await canEditUnsignedDocument(service, document))
    ) {
      return NextResponse.json(
        {
          error: renameOnly
            ? 'Un documento completado no se puede renombrar.'
            : 'Solo puedes editar un documento en proceso que aún no tenga una firma registrada o en curso.',
          code: 'DOCUMENT_EDIT_CONFLICT',
        },
        { status: 409 }
      );
    }
    if (typeof updates.nombre === 'string') updates.nombre = updates.nombre.trim();
    const query = service
      .from('documentos')
      .update(updates)
      .eq('id', documentId)
      .eq('estado', document.estado)
      .is('deleted_at', null)
      .is('fecha_completado', null);
    const { data, error } = await (
      document.updated_at
        ? query.eq('updated_at', document.updated_at)
        : query.is('updated_at', null)
    )
      .select(
        'id,nombre,descripcion,numero_oficio,grupo_tipo_documento_id,tipo_documento_id,otro_tipo_documento,etiquetas_ids,updated_at,fecha_vencimiento,fecha_vencimiento_timezone,tiene_vencimiento,campos_solicitados,participantes,participant_mode,participation_order'
      )
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        {
          error: 'El documento cambió mientras lo editabas. Vuelve a abrirlo e inténtalo de nuevo.',
          code: 'DOCUMENT_EDIT_CONFLICT',
        },
        { status: 409 }
      );
    }
    await service.from('document_lifecycle_audit_events').insert({
      workspace_id: document.workspace_id || null,
      document_id: documentId,
      actor_id: user.id,
      actor_email: user.email || null,
      action: 'DOCUMENT_EDITED_BY_PERMISSION',
      previous_state: {},
      new_state: { fields: Object.keys(updates) },
      result: 'success',
      request_id: request.headers.get('x-request-id') || null,
      ip_address: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
      user_agent: request.headers.get('user-agent') || null,
      metadata: { fields: Object.keys(updates) },
    });
    return NextResponse.json({ data });
  } catch (error) {
    const access = documentAccessResponse(error);
    if (access.status !== 500) return NextResponse.json(access.body, { status: access.status });
    console.error('[document edit] PATCH failed', error);
    return NextResponse.json({ error: 'No fue posible guardar los cambios.' }, { status: 500 });
  }
}
