import { z } from 'zod';
import { authorizeTaskRequest } from '@/lib/tasks/server';

export const runtime = 'nodejs';

const schema = z.object({
  workspaceId: z.string().uuid(),
  sourceKind: z.enum(['document', 'form_template', 'template', 'case_file']),
  sourceId: z.string().uuid(),
  workKind: z.enum(['accion', 'actividad']),
  type: z.enum([
    'firmar_documento', 'revisar_documento', 'aprobar_documento', 'subir_anexo',
    'validar_identidad', 'corregir_datos', 'resolver_comentario', 'confirmar_lectura',
    'descargar_constancia', 'validar_efirma', 'obtener_nom151', 'cerrar_expediente',
    'retomar_borrador', 'revisar_vencimiento', 'responder_formulario', 'seguimiento_formulario', 'revisar_expediente',
  ]),
  priority: z.enum(['critica', 'alta', 'media', 'baja']).default('media'),
  dueDate: z.string().datetime().optional(),
  assigneeId: z.string().uuid().optional(),
  description: z.string().trim().max(2000).optional(),
});

const sourceTable = {
  document: { table: 'documentos', name: 'nombre' },
  form_template: { table: 'form_templates', name: 'name' },
  template: { table: 'plantillas', name: 'name' },
  case_file: { table: 'case_files', name: 'title' },
} as const;

const typeLabel: Record<z.infer<typeof schema>['type'], string> = {
  firmar_documento: 'Firmar', revisar_documento: 'Revisar', aprobar_documento: 'Aprobar',
  subir_anexo: 'Completar anexo de', validar_identidad: 'Validar identidad en',
  corregir_datos: 'Corregir datos de', resolver_comentario: 'Resolver comentario en',
  confirmar_lectura: 'Confirmar lectura de', descargar_constancia: 'Descargar constancia de',
  validar_efirma: 'Validar e.firma de', obtener_nom151: 'Obtener NOM-151 de',
  cerrar_expediente: 'Cerrar', retomar_borrador: 'Continuar borrador',
  revisar_vencimiento: 'Revisar vencimiento de', responder_formulario: 'Responder',
  seguimiento_formulario: 'Dar seguimiento a',
  revisar_expediente: 'Revisar',
};

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Completa el tipo y el recurso vinculado.' }, { status: 400 });
  const input = parsed.data;
  const auth = await authorizeTaskRequest(request, input.workspaceId);
  if (!auth) return Response.json({ error: 'No autorizado.' }, { status: 403 });
  const { service, user, role } = auth;
  const resource = sourceTable[input.sourceKind];
  const { data: source, error: sourceError } = await service.from(resource.table)
    .select('*').eq('id', input.sourceId).maybeSingle();
  if (sourceError || !source) return Response.json({ error: 'El recurso seleccionado ya no existe.' }, { status: 404 });
  if (source.workspace_id !== input.workspaceId) {
    const { data: workspace } = await service.from('workspaces').select('workspace_type,owner_id').eq('id', input.workspaceId).maybeSingle();
    const personalOwner = input.sourceKind === 'document' && !source.workspace_id && source.owner_id === user.id
      && workspace?.workspace_type === 'personal' && workspace.owner_id === user.id;
    if (!personalOwner) return Response.json({ error: 'El recurso no pertenece al espacio actual.' }, { status: 403 });
  }
  if (input.sourceKind === 'case_file' && !['cerrar_expediente', 'revisar_expediente', 'subir_anexo', 'validar_identidad'].includes(input.type))
    return Response.json({ error: 'El tipo seleccionado no corresponde a un expediente.' }, { status: 400 });
  if (input.sourceKind === 'form_template' && !['seguimiento_formulario', 'revisar_documento', 'aprobar_documento'].includes(input.type))
    return Response.json({ error: 'El tipo seleccionado no corresponde a un formulario.' }, { status: 400 });
  if (input.sourceKind === 'template' && !['revisar_documento', 'aprobar_documento'].includes(input.type))
    return Response.json({ error: 'El tipo seleccionado no corresponde a una plantilla.' }, { status: 400 });
  if (input.sourceKind === 'document' && !['revisar_documento', 'aprobar_documento', 'firmar_documento', 'subir_anexo', 'corregir_datos', 'validar_identidad', 'revisar_vencimiento', 'confirmar_lectura'].includes(input.type))
    return Response.json({ error: 'El tipo seleccionado no corresponde a un documento.' }, { status: 400 });
  const assignee = input.assigneeId || user.id;
  const { data: member } = await service.from('workspace_members').select('user_id').eq('workspace_id', input.workspaceId)
    .eq('user_id', assignee).eq('status', 'active').maybeSingle();
  if (!member) return Response.json({ error: 'El responsable debe pertenecer al espacio.' }, { status: 400 });
  if (assignee !== user.id) {
    const { data: workspace } = await service.from('workspaces').select('organization_enabled').eq('id', input.workspaceId).single();
    if (!workspace?.organization_enabled || !['owner', 'admin'].includes(role))
      return Response.json({ error: 'Solo un administrador de organización puede asignar a otra persona.' }, { status: 403 });
  }
  const names = await service.from('user_profiles').select('id,full_name,email').in('id', [user.id, assignee]);
  const actor = names.data?.find(profile => profile.id === user.id);
  const responsible = names.data?.find(profile => profile.id === assignee);
  const resourceName = String(source[resource.name] || 'recurso');
  const { data: task, error } = await service.from('tareas').insert({
    workspace_id: input.workspaceId, created_by: user.id, assigned_to: assignee,
    title: `${typeLabel[input.type]}: ${resourceName}`, description: input.description || null,
    tipo: input.type, prioridad: input.priority, estado: 'pendiente',
    riesgo: input.priority === 'critica' ? 'alto' : input.priority === 'alta' ? 'medio' : 'bajo',
    due_date: input.dueDate || new Date(Date.now() + 3 * 86400000).toISOString(),
    source_type: input.sourceKind, source_id: input.sourceId, origin: 'manual', work_kind: input.workKind,
    document_id: input.sourceKind === 'document' ? input.sourceId : null,
    document_name: input.sourceKind === 'document' ? resourceName : null,
    expediente_id: input.sourceKind === 'case_file' ? input.sourceId : null,
    expediente_name: input.sourceKind === 'case_file' ? resourceName : null,
    responsible_name: responsible?.full_name || responsible?.email || 'Usuario',
    creator_name: actor?.full_name || actor?.email || 'Usuario',
    main_action: 'Abrir recurso',
  }).select('id').single();
  if (error || !task) return Response.json({ error: error?.message || 'No se pudo crear la tarea.' }, { status: 500 });
  await service.from('task_history').insert({ tarea_id: task.id, workspace_id: input.workspaceId,
    action: 'Actividad creada y vinculada a un recurso existente.', actor_id: user.id,
    actor_name: actor?.full_name || actor?.email || 'Usuario', icon_name: 'Plus', color: 'text-blue-500' });
  return Response.json({ success: true, id: task.id });
}
