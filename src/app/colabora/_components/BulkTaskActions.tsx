'use client';
import { useEffect, useState } from 'react';
import { useCollaborationApi } from '@/lib/collaboration/client';
import { useCollaboration } from '@/contexts/CollaborationContext';
import { Loader2 } from 'lucide-react';
type Task = { id: string; optimistic_version: number; title?: string };
export default function BulkTaskActions({
  workspaceId,
  items,
  finished,
}: {
  workspaceId: string;
  items: Task[];
  finished: (message: string) => void;
}) {
  const api = useCollaborationApi();
  const { can } = useCollaboration();
  const [action, setAction] = useState(can('tasks.edit', true) ? 'start' : 'reassign'),
    [priority, setPriority] = useState('media'),
    [due, setDue] = useState(''),
    [assignee, setAssignee] = useState('');
  const [members, setMembers] = useState<
      Array<{
        user_id: string;
        user_profiles?:
          { full_name?: string; email?: string } | Array<{ full_name?: string; email?: string }>;
      }>
    >([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (action !== 'reassign') return;
    let active = true;
    void api<{ data: typeof members }>(
      `/api/colabora/catalog?workspace_id=${workspaceId}&type=members`
    )
      .then((result) => {
        if (active) setMembers(result.data);
      })
      .catch(() => {
        if (active) setError('No se pudieron cargar los responsables.');
      });
    return () => {
      active = false;
    };
  }, [action, workspaceId, api]);
  const apply = async () => {
    setBusy(true);
    setError('');
    try {
      const body = {
        workspace_id: workspaceId,
        items,
        action: ['priority', 'due'].includes(action) ? 'update' : action,
        ...(action === 'priority' ? { prioridad: priority } : {}),
        ...(action === 'due' ? { due_date: new Date(due).toISOString() } : {}),
        ...(action === 'reassign' ? { assigned_to: assignee } : {}),
      };
      const result = await api<{
        succeeded: number;
        failed: number;
        data: Array<{ id: string; success: boolean; code?: string }>;
        notification_status?: string;
      }>('/api/colabora/tasks/bulk', { method: 'POST', body: JSON.stringify(body) });
      const reasons: Record<string, string> = {
        organization_mutation_scope_denied: 'sin permiso',
        task_version_conflict: 'cambió en otra sesión',
        task_closed: 'tarea cerrada',
        task_not_due: 'fecha de inicio pendiente',
        task_transition_invalid: 'estado incompatible',
      };
      const failures = result.data
        .filter((row) => !row.success)
        .slice(0, 3)
        .map(
          (row) =>
            `${items.find((item) => item.id === row.id)?.title || 'Tarea seleccionada'} (${reasons[row.code || ''] || 'revisar detalle'})`
        )
        .join('; ');
      finished(
        `${result.succeeded} ${result.succeeded === 1 ? 'tarea actualizada' : 'tareas actualizadas'}.${result.failed ? ` ${result.failed} sin modificar: ${failures}${result.failed > 3 ? `; y ${result.failed - 3} más` : ''}.` : ''}${result.notification_status === 'failed' ? ' Los cambios se guardaron, pero no se pudo confirmar la notificación.' : ''}`
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el lote.');
    } finally {
      setBusy(false);
    }
  };
  const allowed = can(action === 'reassign' ? 'tasks.assign' : 'tasks.edit', true);
  return (
    <div className="space-y-2 border-b border-border bg-primary/5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-2 text-sm font-medium">
          {items.length} {items.length === 1 ? 'seleccionada' : 'seleccionadas'}{' '}
          <span className="font-normal text-muted-foreground">(máximo 25)</span>
        </span>
        <select
          aria-label="Acción para tareas seleccionadas"
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setError('');
          }}
          disabled={busy}
          className="h-9 rounded-md border border-border bg-background px-3 text-sm"
        >
          {can('tasks.edit', true) && (
            <>
              <option value="start">Iniciar</option>
              <option value="request_review">Enviar a revisión</option>
              <option value="priority">Cambiar prioridad</option>
              <option value="due">Cambiar vencimiento</option>
            </>
          )}
          {can('tasks.assign', true) && <option value="reassign">Cambiar responsable</option>}
        </select>
        {action === 'priority' && (
          <select
            aria-label="Prioridad del lote"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3 text-sm"
          >
            <option value="baja">Baja</option>
            <option value="media">Normal</option>
            <option value="alta">Alta</option>
            <option value="critica">Crítica</option>
          </select>
        )}
        {action === 'due' && (
          <input
            type="datetime-local"
            aria-label="Vencimiento del lote"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3 text-sm"
          />
        )}
        {action === 'reassign' && (
          <select
            aria-label="Responsable del lote"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            className="h-9 max-w-full rounded-md border border-border bg-background px-3 text-sm"
          >
            <option value="">Seleccionar responsable</option>
            {members.map((member) => {
              const profile = Array.isArray(member.user_profiles)
                ? member.user_profiles[0]
                : member.user_profiles;
              return (
                <option value={member.user_id} key={member.user_id}>
                  {profile?.full_name || profile?.email || 'Miembro de la organización'}
                </option>
              );
            })}
          </select>
        )}
        <button
          onClick={apply}
          disabled={
            busy || !allowed || (action === 'due' && !due) || (action === 'reassign' && !assignee)
          }
          className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy && <Loader2 size={15} className="animate-spin" />}Aplicar
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
