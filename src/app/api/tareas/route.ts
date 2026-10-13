import { z } from 'zod';
import { authorizeTaskRequest } from '@/lib/tasks/server';
import { completionMode } from '@/lib/tasks/completion-policy';
import { taskResourceIsEligible } from '@/lib/tasks/resource-eligibility';
import { scheduleValidationError } from '@/lib/tasks/schedule';

export const runtime = 'nodejs';

const schema = z.object({
  workspaceId: z.string().uuid(),
  sourceKind: z.enum(['document', 'form_template', 'template', 'case_file', 'form_response', 'user', 'task', 'participant_requirement']),
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
  scheduledFor: z.string().datetime().optional(),
  assigneeId: z.string().uuid().optional(),
  description: z.string().trim().max(2000).optional(),
});

const sourceTable = {
  document: { table: 'documentos', name: 'nombre' },
  form_template: { table: 'form_templates', name: 'name' },
  template: { table: 'plantillas', name: 'nombre' },
  case_file: { table: 'case_files', name: 'title' },
  form_response: { table: 'form_responses', name: 'folio' },
  user: { table: 'user_profiles', name: 'full_name' },
  task: { table: 'tareas', name: 'title' },
  participant_requirement: { table: 'participant_document_requirements', name: 'name' },
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
  const { service, scoped, user, role } = auth;
  const scheduleError = scheduleValidationError(input.scheduledFor, input.dueDate);
  if (scheduleError) return Response.json({ error: scheduleError }, { status: 400 });
  const expectedKind = completionMode(input.type, input.sourceKind) === 'verified' ? 'accion' : 'actividad';
  if (input.workKind !== expectedKind)
    return Response.json({ error: 'La clase de trabajo no corresponde a la acción seleccionada.' }, { status: 400 });
  const resource = sourceTable[input.sourceKind];
  const { data: source, error: sourceError } = await service.from(resource.table)
    .select('*').eq('id', input.sourceId).maybeSingle();
  if (sourceError || !source) return Response.json({ error: 'El recurso seleccionado ya no existe.' }, { status: 404 });
  if (input.sourceKind !== 'user') {
    const visible = await scoped.from(resource.table).select('id').eq('id', input.sourceId).maybeSingle();
    if (visible.error || !visible.data)
      return Response.json({ error: 'No tienes acceso al recurso seleccionado.' }, { status: 403 });
  }
  if (input.sourceKind === 'user') {
    const { data: membership } = await service.from('workspace_members').select('user_id')
      .eq('workspace_id', input.workspaceId).eq('user_id', input.sourceId).eq('status', 'active').maybeSingle();
    if (!membership) return Response.json({ error: 'El usuario no pertenece a este espacio.' }, { status: 403 });
  } else if (source.workspace_id !== input.workspaceId) {
    const { data: workspace } = await service.from('workspaces').select('workspace_type,owner_id').eq('id', input.workspaceId).maybeSingle();
    const personalOwner = input.sourceKind === 'document' && !source.workspace_id && source.owner_id === user.id
      && workspace?.workspace_type === 'personal' && workspace.owner_id === user.id;
    if (!personalOwner) return Response.json({ error: 'El recurso no pertenece al espacio actual.' }, { status: 403 });
  }
  if (input.sourceKind === 'case_file' && !['cerrar_expediente', 'revisar_expediente'].includes(input.type))
    return Response.json({ error: 'El tipo seleccionado no corresponde a un expediente.' }, { status: 400 });
  if (input.sourceKind === 'form_template' && !['seguimiento_formulario', 'revisar_documento', 'aprobar_documento'].includes(input.type))
    return Response.json({ error: 'El tipo seleccionado no corresponde a un formulario.' }, { status: 400 });
  if (input.sourceKind === 'template' && !['revisar_documento', 'aprobar_documento'].includes(input.type))
    return Response.json({ error: 'El tipo seleccionado no corresponde a una plantilla.' }, { status: 400 });
  if (input.sourceKind === 'document' && !['revisar_documento', 'aprobar_documento', 'firmar_documento', 'corregir_datos', 'revisar_vencimiento', 'confirmar_lectura', 'retomar_borrador', 'obtener_nom151'].includes(input.type))
    return Response.json({ error: 'El tipo seleccionado no corresponde a un documento.' }, { status: 400 });
  if (input.sourceKind === 'form_response' && !['revisar_documento', 'aprobar_documento', 'corregir_datos'].includes(input.type))
    return Response.json({ error: 'El tipo seleccionado no corresponde a una respuesta.' }, { status: 400 });
  if (input.sourceKind === 'user' && input.type !== 'validar_identidad')
    return Response.json({ error: 'El tipo seleccionado no corresponde a un usuario.' }, { status: 400 });
  if (input.sourceKind === 'participant_requirement' && input.type !== 'subir_anexo')
    return Response.json({ error: 'El tipo seleccionado no corresponde a un anexo requerido.' }, { status: 400 });
  if (input.sourceKind === 'task' && !['resolver_comentario', 'revisar_documento'].includes(input.type))
    return Response.json({ error: 'El tipo seleccionado no corresponde a una tarea.' }, { status: 400 });
  if (!taskResourceIsEligible(input.sourceKind, input.type, source.estado || source.status))
    return Response.json({ error: 'El estado actual del recurso no permite esta acción.' }, { status: 409 });
  if (input.type === 'retomar_borrador' && source.estado !== 'borrador')
    return Response.json({ error: 'El documento ya no está en borrador.' }, { status: 409 });
  if (input.type === 'firmar_documento' && source.estado === 'completado')
    return Response.json({ error: 'El documento ya está completado.' }, { status: 409 });
  if (input.type === 'cerrar_expediente' && (source.closed_at || source.status === 'closed'))
    return Response.json({ error: 'El expediente ya está cerrado.' }, { status: 409 });
  if (input.type === 'obtener_nom151') {
    const issued = await service.from('nom151_constancias_doc').select('id')
      .eq('documento_id', input.sourceId).eq('status', 'issued').limit(1);
    if (issued.error) return Response.json({ error: 'No se pudo consultar la constancia NOM-151.' }, { status: 500 });
    if (issued.data?.length) return Response.json({ error: 'Este documento ya cuenta con una constancia NOM-151.' }, { status: 409 });
  }
  if (input.sourceKind === 'participant_requirement' && (source.provided_at || ['accepted', 'waived'].includes(source.status)))
    return Response.json({ error: 'El anexo requerido ya fue atendido.' }, { status: 409 });
  if (input.type === 'validar_identidad' && input.sourceKind === 'user') {
    const verification = await service.from('user_verification_status').select('biometric_verified')
      .eq('user_id', input.sourceId).maybeSingle();
    if (verification.error) return Response.json({ error: 'No se pudo consultar la validación de identidad.' }, { status: 500 });
    if (verification.data?.biometric_verified)
      return Response.json({ error: 'La identidad de esta persona ya está validada.' }, { status: 409 });
  }
  const assignee = input.assigneeId || user.id;
  if (input.type === 'firmar_documento') {
    const signature = await service.from('signature_evidence').select('id')
      .eq('document_id', input.sourceId).eq('captured_by', assignee)
      .eq('is_voided', false).not('signed_at', 'is', null).limit(1);
    if (signature.error) return Response.json({ error: 'No se pudo consultar la firma del responsable.' }, { status: 500 });
    if (signature.data?.length) return Response.json({ error: 'La persona seleccionada ya firmó este documento.' }, { status: 409 });
  }
  if (input.sourceKind === 'user' && assignee !== input.sourceId)
    return Response.json({ error: 'La validación de identidad debe asignarse a la persona seleccionada.' }, { status: 400 });
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
  let resourceName = String(source[resource.name] || (input.sourceKind === 'user' ? source.email : null) || 'recurso');
  if (input.sourceKind === 'form_response') {
    const form = await service.from('form_templates').select('name').eq('id', source.template_id).maybeSingle();
    const submitted = source.submitted_at ? new Date(source.submitted_at) : null;
    const date = submitted && Number.isFinite(submitted.getTime()) ? submitted.toLocaleDateString('es-MX', { timeZone: 'UTC' }) : '';
    const reference = source.folio || [source.respondent_name, date, input.sourceId.slice(0, 8).toUpperCase()].filter(Boolean).join(' · ');
    resourceName = `${form.data?.name || 'Formulario'} · ${reference}`;
  }
  const relatedDocument = input.sourceKind === 'participant_requirement'
    ? (await service.from('documentos').select('nombre').eq('id', source.document_id).maybeSingle()).data : null;
  const defaultDueAt = Math.max(Date.now(), input.scheduledFor ? new Date(input.scheduledFor).getTime() : 0) + 3 * 86400000;
  const { data: task, error } = await service.from('tareas').insert({
    workspace_id: input.workspaceId, created_by: user.id, assigned_to: assignee,
    title: `${typeLabel[input.type]}: ${resourceName}`, description: input.description || null,
    tipo: input.type, prioridad: input.priority, estado: 'pendiente',
    riesgo: input.priority === 'critica' ? 'alto' : input.priority === 'alta' ? 'medio' : 'bajo',
    due_date: input.dueDate || new Date(defaultDueAt).toISOString(),
    scheduled_for: input.scheduledFor || null,
    source_type: input.sourceKind, source_id: input.sourceId, origin: 'manual', work_kind: input.workKind,
    document_id: input.sourceKind === 'document' ? input.sourceId : input.sourceKind === 'participant_requirement' ? source.document_id : null,
    document_name: input.sourceKind === 'document' ? resourceName : relatedDocument?.nombre || null,
    expediente_id: input.sourceKind === 'case_file' ? input.sourceId : null,
    expediente_name: input.sourceKind === 'case_file' ? resourceName : null,
    responsible_name: responsible?.full_name || responsible?.email || 'Usuario',
    creator_name: actor?.full_name || actor?.email || 'Usuario',
    main_action: 'Abrir recurso',
  }).select('id').single();
  if (error || !task) return Response.json({ error: error?.message || 'No se pudo crear la tarea.' }, { status: 500 });
  await service.from('task_history').insert({ tarea_id: task.id, workspace_id: input.workspaceId,
    action: `${input.workKind === 'accion' ? 'Acción' : 'Actividad'} creada y vinculada a un recurso existente.${input.scheduledFor ? ` Inicio programado para ${input.scheduledFor}.` : ''}`,
    actor_id: user.id,
    actor_name: actor?.full_name || actor?.email || 'Usuario', icon_name: 'Plus', color: 'text-blue-500' });
  return Response.json({ success: true, id: task.id });
}
