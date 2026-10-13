import { z } from 'zod';
import { authorizeTaskRequest } from '@/lib/tasks/server';
import { formInvitationPath, formResponsePath } from '@/lib/tasks/action-navigation';
import { completionAttestationIsValid, completionMode } from '@/lib/tasks/completion-policy';

export const runtime = 'nodejs';

const inputSchema = z.object({
  workspaceId: z.string().uuid(),
  action: z.enum(['open', 'start', 'complete', 'cancel', 'remind', 'reassign', 'edit']),
  reason: z.string().trim().min(5).max(1000).optional(),
  assigneeId: z.string().uuid().optional(),
  title: z.string().trim().min(3).max(160).optional(),
  description: z.string().trim().max(2000).optional(),
  priority: z.enum(['baja', 'media', 'alta', 'critica']).optional(),
  dueDate: z.string().datetime().nullable().optional(),
});

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Solicitud inválida.' }, { status: 400 });
  const { taskId } = await context.params;
  if (!z.string().uuid().safeParse(taskId).success) return Response.json({ error: 'Tarea inválida.' }, { status: 400 });
  const { workspaceId, action, reason, assigneeId } = parsed.data;
  const auth = await authorizeTaskRequest(request, workspaceId);
  if (!auth) return Response.json({ error: 'No autorizado.' }, { status: 403 });
  const { service, user, role } = auth;
  const { data: task, error: taskError } = await service.from('tareas').select('*')
    .eq('id', taskId).eq('workspace_id', workspaceId).maybeSingle();
  if (taskError || !task) return Response.json({ error: 'La tarea no existe en este espacio.' }, { status: 404 });
  const canManage = role === 'owner' || role === 'admin' || task.created_by === user.id;
  const canAct = canManage || task.assigned_to === user.id;
  if (!canAct) return Response.json({ error: 'Esta tarea no está asignada a tu cuenta.' }, { status: 403 });

  if (action === 'open') {
    if (task.source_type === 'form_token' && task.source_id) {
      const { data: token } = await service.from('form_tokens').select('template_id,recipient_email,used_at,expires_at')
        .eq('id', task.source_id).maybeSingle();
      if (!token || token.used_at || (token.expires_at && new Date(token.expires_at) < new Date()))
        return Response.json({ error: 'La invitación ya no está vigente.' }, { status: 409 });
      const href = formInvitationPath(token.template_id, token.recipient_email, user.email);
      if (href) return Response.json({ href });
      if (canManage)
        return Response.json({ href: `/formularios/lanzar?id=${encodeURIComponent(token.template_id)}` });
      return Response.json({ error: 'La invitación corresponde a otro destinatario.' }, { status: 403 });
    }
    if (task.document_id && z.string().uuid().safeParse(task.document_id).success) {
      const href = task.tipo === 'retomar_borrador'
        ? `/crear-documento?draft=${task.document_id}` : `/visor-documento/${task.document_id}`;
      return Response.json({ href });
    }
    if (task.expediente_id && z.string().uuid().safeParse(task.expediente_id).success)
      return Response.json({ href: `/expedientes/${task.expediente_id}` });
    if (task.source_type === 'form_template' && task.source_id)
      return Response.json({ href: task.tipo === 'seguimiento_formulario' ? `/formularios/lanzar?id=${task.source_id}` : `/formularios/nuevo?id=${task.source_id}` });
    if (task.source_type === 'template' && task.source_id)
      return Response.json({ href: `/plantillas/nueva?id=${task.source_id}` });
    if (task.source_type === 'form_response' && task.source_id) {
      const { data: response } = await service.from('form_responses').select('template_id,workspace_id')
        .eq('id', task.source_id).eq('workspace_id', workspaceId).maybeSingle();
      if (response) return Response.json({ href: formResponsePath(response.template_id, task.source_id) });
    }
    if (task.source_type === 'user' && task.source_id === user.id)
      return Response.json({ href: '/mi-perfil' });
    if (task.source_type === 'task' && task.source_id)
      return Response.json({ href: `/mis-tareas?task=${task.source_id}` });
    return Response.json({ error: 'Esta tarea no tiene un recurso vigente para abrir.' }, { status: 409 });
  }

  if (['completada', 'cancelada', 'rechazada'].includes(task.estado))
    return Response.json({ error: 'La tarea ya terminó.' }, { status: 409 });
  const actorName = (await service.from('user_profiles').select('full_name,email').eq('id', user.id).maybeSingle()).data;
  const audit = async (description: string) => service.from('task_history').insert({
    tarea_id: taskId, workspace_id: workspaceId, action: description,
    actor_id: user.id, actor_name: actorName?.full_name || actorName?.email || 'Usuario',
    icon_name: 'CheckCircle2', color: 'text-blue-500',
  });

  if (action === 'edit') {
    if (!canManage || task.origin !== 'manual') return Response.json({ error: 'Solo puedes editar una actividad manual que administras.' }, { status: 403 });
    const changes = { title: parsed.data.title, description: parsed.data.description,
      prioridad: parsed.data.priority, due_date: parsed.data.dueDate,
      riesgo: parsed.data.priority === 'critica' ? 'alto' : parsed.data.priority === 'alta' ? 'medio' : 'bajo' };
    if (!changes.title || !changes.prioridad) return Response.json({ error: 'Completa el título y la prioridad.' }, { status: 400 });
    const { error } = await service.from('tareas').update(changes).eq('id', taskId);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    await audit('Datos de la actividad actualizados');
    return Response.json({ success: true });
  }

  if (action === 'remind') {
    if (!task.assigned_to) return Response.json({ error: 'Asigna una persona antes de recordar.' }, { status: 409 });
    const { data: recent } = await service.from('task_history').select('id').eq('tarea_id', taskId)
      .eq('action', 'Recordatorio enviado').gte('created_at', new Date(Date.now() - 24 * 3600000).toISOString()).limit(1);
    if (recent?.length) return Response.json({ error: 'Ya se envió un recordatorio en las últimas 24 horas.' }, { status: 429 });
    const { error } = await service.from('notifications').insert({
      user_id: task.assigned_to, workspace_id: workspaceId, type: 'task_reminder',
      title: 'Recordatorio de tarea', description: task.title, priority: 'medium',
      category: 'REMINDER', event_type: 'task.reminder', severity: 'warning',
      entity_type: 'task', entity_id: taskId, action_url: `/mis-tareas?task=${taskId}`,
      action_label: 'Ver tarea', actor_user_id: user.id,
      idempotency_key: `task-reminder:${taskId}:${new Date().toISOString().slice(0, 10)}`,
    });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    await audit('Recordatorio enviado');
    return Response.json({ success: true });
  }

  if (action === 'reassign') {
    const { data: workspace } = await service.from('workspaces').select('organization_enabled').eq('id', workspaceId).single();
    if (!workspace?.organization_enabled || !['owner', 'admin'].includes(role))
      return Response.json({ error: 'La reasignación requiere una organización y permisos de administración.' }, { status: 403 });
    if (!assigneeId) return Response.json({ error: 'Elige un responsable.' }, { status: 400 });
    if (task.source_type === 'user' && task.source_id !== assigneeId)
      return Response.json({ error: 'La validación de identidad debe permanecer asignada a la persona correspondiente.' }, { status: 400 });
    const { data: member } = await service.from('workspace_members').select('user_id').eq('workspace_id', workspaceId)
      .eq('user_id', assigneeId).eq('status', 'active').maybeSingle();
    if (!member) return Response.json({ error: 'El responsable no pertenece a la organización.' }, { status: 400 });
    const profile = (await service.from('user_profiles').select('full_name,email').eq('id', assigneeId).maybeSingle()).data;
    const { error } = await service.from('tareas').update({ assigned_to: assigneeId,
      responsible_name: profile?.full_name || profile?.email || 'Usuario' }).eq('id', taskId);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    await audit(`Tarea reasignada a ${profile?.full_name || profile?.email || 'usuario'}`);
    await service.from('notifications').insert({
      user_id: assigneeId, workspace_id: workspaceId, type: 'task_assigned',
      title: ['critica', 'alta'].includes(task.prioridad) ? 'Tarea prioritaria asignada' : 'Nueva tarea asignada',
      description: task.title, priority: task.prioridad === 'critica' ? 'high' : 'medium', category: 'WORKFLOW', event_type: 'task.reassigned',
      severity: task.prioridad === 'critica' ? 'critical' : task.prioridad === 'alta' ? 'warning' : 'info', entity_type: 'task', entity_id: taskId,
      action_url: `/mis-tareas?task=${taskId}`, action_label: 'Ver tarea', actor_user_id: user.id,
      idempotency_key: `task-reassigned:${taskId}:${assigneeId}:${Date.now()}`,
    });
    return Response.json({ success: true });
  }

  if (action === 'cancel' && (!canManage || !reason))
    return Response.json({ error: 'Indica un motivo para cancelar esta tarea.' }, { status: 400 });
  if (action === 'complete' && task.origin === 'sistema') {
    const ruleId = typeof task.automation_key === 'string' && task.automation_key.startsWith('custom:')
      ? task.automation_key.slice(7) : null;
    const { data: rule } = ruleId && z.string().uuid().safeParse(ruleId).success
      ? await service.from('task_custom_rules').select('target_kind,condition_kind')
          .eq('id', ruleId).eq('workspace_id', workspaceId).maybeSingle()
      : { data: null };
    if (rule?.target_kind === 'task' || rule?.condition_kind !== 'created')
      return Response.json({ error: 'Esta acción se completa cuando se resuelve en el recurso vinculado.' }, { status: 409 });
  }
  if (action === 'complete') {
    const dependencies = await service.from('task_dependencies').select('depends_on_id')
      .eq('tarea_id', taskId).eq('workspace_id', workspaceId);
    if (dependencies.error) return Response.json({ error: 'No se pudieron verificar las dependencias.' }, { status: 500 });
    if (dependencies.data?.length) {
      const pending = await service.from('tareas').select('id').eq('workspace_id', workspaceId)
        .in('id', dependencies.data.map(item => item.depends_on_id)).neq('estado', 'completada').limit(1);
      if (pending.error) return Response.json({ error: 'No se pudieron verificar las dependencias.' }, { status: 500 });
      if (pending.data?.length) return Response.json({ error: 'Completa primero las tareas de las que depende esta acción.' }, { status: 409 });
    }
    const checklist = await service.from('task_checklist_items').select('id,done')
      .eq('tarea_id', taskId).eq('workspace_id', workspaceId);
    if (checklist.error) return Response.json({ error: 'No se pudo comprobar el checklist.' }, { status: 500 });
    if (checklist.data?.some(item => !item.done))
      return Response.json({ error: 'Completa todos los elementos del checklist antes de cerrar esta tarea.' }, { status: 409 });
    if (task.origin === 'manual') {
      if (completionMode(task.tipo, task.source_type) === 'attested') {
        if (!completionAttestationIsValid(reason))
          return Response.json({ error: 'Describe el resultado realizado (mínimo 15 caracteres) para dejar constancia del cierre.' }, { status: 400 });
      } else {
        let confirmed = false;
        if (task.tipo === 'retomar_borrador' && task.document_id) {
          const result = await service.from('documentos').select('estado').eq('id', task.document_id).maybeSingle();
          if (result.error) return Response.json({ error: 'No se pudo comprobar el documento.' }, { status: 500 });
          confirmed = Boolean(result.data && result.data.estado !== 'borrador');
        } else if (task.tipo === 'firmar_documento' && task.document_id) {
          const signature = await service.from('signature_evidence').select('id').eq('document_id', task.document_id)
            .eq('captured_by', task.assigned_to).eq('is_voided', false).not('signed_at', 'is', null)
            .gte('signed_at', task.created_at).limit(1);
          if (signature.error) return Response.json({ error: 'No se pudo comprobar la firma.' }, { status: 500 });
          confirmed = Boolean(signature.data?.length);
        } else if (task.tipo === 'responder_formulario' && task.source_type === 'form_token' && task.source_id) {
          const result = await service.from('form_tokens').select('used_at').eq('id', task.source_id).maybeSingle();
          if (result.error) return Response.json({ error: 'No se pudo comprobar la invitación.' }, { status: 500 });
          confirmed = Boolean(result.data?.used_at);
        } else if (task.tipo === 'validar_identidad' && task.source_type === 'user' && task.source_id) {
          const result = await service.from('user_verification_status').select('biometric_verified')
            .eq('user_id', task.source_id).maybeSingle();
          if (result.error) return Response.json({ error: 'No se pudo comprobar la identidad.' }, { status: 500 });
          confirmed = result.data?.biometric_verified === true;
        } else if (task.tipo === 'cerrar_expediente' && task.source_type === 'case_file' && task.source_id) {
          const result = await service.from('case_files').select('closed_at').eq('id', task.source_id).maybeSingle();
          if (result.error) return Response.json({ error: 'No se pudo comprobar el expediente.' }, { status: 500 });
          confirmed = Boolean(result.data?.closed_at);
        } else if (task.tipo === 'subir_anexo' && task.source_type === 'participant_requirement' && task.source_id) {
          const result = await service.from('participant_document_requirements').select('provided_at,status')
            .eq('id', task.source_id).maybeSingle();
          if (result.error) return Response.json({ error: 'No se pudo comprobar el anexo.' }, { status: 500 });
          confirmed = Boolean(result.data?.provided_at || ['approved','accepted','completed','waived'].includes(result.data?.status || ''));
        } else if (task.tipo === 'obtener_nom151' && task.document_id) {
          const result = await service.from('nom151_constancias_doc').select('id')
            .eq('documento_id', task.document_id).eq('status', 'issued').limit(1);
          if (result.error) return Response.json({ error: 'No se pudo comprobar la constancia NOM-151.' }, { status: 500 });
          confirmed = Boolean(result.data?.length);
        }
        if (!confirmed) return Response.json({ error: 'Completa primero la acción en el recurso vinculado; todavía no hay evidencia de que haya concluido.' }, { status: 409 });
      }
    }
  }
  const nextStatus = action === 'start' ? 'en_proceso' : action === 'complete' ? 'completada' : 'cancelada';
  const completionNote = action === 'complete' && task.origin === 'manual'
    ? reason || 'Resultado comprobado en el recurso vinculado.' : reason;
  const { error } = await service.from('tareas').update({
    estado: nextStatus, completed_at: action === 'complete' ? new Date().toISOString() : task.completed_at,
    cancelled_at: action === 'cancel' ? new Date().toISOString() : task.cancelled_at,
    resolution_note: completionNote || task.resolution_note,
  }).eq('id', taskId);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  await audit(action === 'start' ? 'Trabajo iniciado' : action === 'complete' ? 'Actividad completada' : `Tarea cancelada: ${reason}`);
  return Response.json({ success: true });
}
