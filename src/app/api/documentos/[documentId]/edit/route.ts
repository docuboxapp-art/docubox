import { NextRequest, NextResponse } from 'next/server';
import { documentAccessResponse, requireDocumentAccess } from '@/lib/security/document-access';

const ALLOWED_DOCUMENT_FIELDS = new Set([
  'nombre',
  'descripcion',
  'numero_oficio',
  'grupo_tipo_documento_id',
  'tipo_documento_id',
  'etiquetas_ids',
  'participantes',
  'fecha_vencimiento',
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
    if (String(document.estado).toLowerCase() !== 'en_proceso') {
      return NextResponse.json(
        { error: 'Sólo se puede editar un documento que está en proceso.' },
        { status: 409 }
      );
    }
    const body = await request.json();
    const updates = Object.fromEntries(
      Object.entries(body?.updates || {}).filter(([key, value]) => ALLOWED_DOCUMENT_FIELDS.has(key) && value !== undefined)
    );
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No hay cambios válidos para guardar.' }, { status: 400 });
    }
    if ('nombre' in updates && (typeof updates.nombre !== 'string' || !updates.nombre.trim())) {
      return NextResponse.json({ error: 'El nombre del documento es obligatorio.' }, { status: 400 });
    }
    const { data, error } = await service
      .from('documentos')
      .update(updates)
      .eq('id', documentId)
      .select('id,nombre,file_url,file_size,file_type,fecha_vencimiento,campos_solicitados,participantes')
      .single();
    if (error) throw error;
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
