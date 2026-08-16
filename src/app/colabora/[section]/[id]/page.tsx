'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Circle,
  Clock3,
  Loader2,
  MessageSquareText,
  Paperclip,
  Plus,
  ExternalLink,
  RotateCcw,
  ScanSearch,
  ShieldAlert,
  Trash2,
  UserPlus,
  UserMinus,
} from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useCollaboration } from '@/contexts/CollaborationContext';
import { useCollaborationApi } from '@/lib/collaboration/client';
import { hasCollaborationEntitlement } from '@/lib/collaboration/domain';
import { collaborationSectionEntitlements } from '@/lib/collaboration/navigation';

type DetailPayload = {
  resource?: Record<string, unknown>;
  task?: Record<string, unknown>;
  [key: string]: unknown;
};

const labels: Record<string, string> = {
  tareas: 'Tarea',
  espacios: 'Espacio',
  solicitudes: 'Solicitud',
  salas: 'Sala externa',
  automatizaciones: 'Automatizacion',
  negociacion: 'Asunto de negociacion',
  comites: 'Comite',
  cierres: 'Sala de cierre',
};
const resources: Record<string, string> = {
  espacios: 'spaces',
  solicitudes: 'requests',
  salas: 'rooms',
  automatizaciones: 'automations',
  negociacion: 'negotiations',
  comites: 'committees',
  cierres: 'closings',
};

function value(input: unknown) {
  if (input == null || input === '') return '—';
  if (typeof input === 'object') return JSON.stringify(input);
  return String(input).replaceAll('_', ' ');
}

export default function ColaboraDetailPage() {
  const { section, id } = useParams<{ section: string; id: string }>();
  const { activeWorkspace } = useWorkspace();
  const { access, can } = useCollaboration();
  const api = useCollaborationApi();
  const [data, setData] = useState<DetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [workspaceMembers, setWorkspaceMembers] = useState<
    Array<{
      user_id: string;
      role: string;
      user_profiles?:
        { full_name?: string; email?: string } | Array<{ full_name?: string; email?: string }>;
    }>
  >([]);
  const [roomDocuments, setRoomDocuments] = useState<
    Array<{ id: string; nombre: string; estado: string }>
  >([]);
  const [oneTimeLink, setOneTimeLink] = useState('');
  const proEntitlement = collaborationSectionEntitlements[section];
  const proAvailable = !proEntitlement || hasCollaborationEntitlement(access, proEntitlement, {
    proFeature: true,
  });

  const load = useCallback(async () => {
    if (!activeWorkspace?.id || !proAvailable) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const path =
        section === 'tareas'
          ? `/api/colabora/tasks/${id}`
          : `/api/colabora/details/${resources[section]}/${id}`;
      const payload = await api<{ data: DetailPayload }>(
        `${path}?workspace_id=${activeWorkspace.id}`
      );
      setData(payload.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar el detalle.');
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace?.id, api, id, proAvailable, section]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (section !== 'espacios' || !activeWorkspace?.id || !proAvailable) return;
    api<{ data: { members: typeof workspaceMembers } }>(
      `/api/colabora/overview?workspace_id=${activeWorkspace.id}`
    )
      .then((payload) => setWorkspaceMembers(payload.data.members || []))
      .catch(() => setWorkspaceMembers([]));
  }, [activeWorkspace?.id, api, proAvailable, section]);
  useEffect(() => {
    if (section !== 'salas' || !activeWorkspace?.id || !proAvailable || !can('rooms.create', true)) return;
    api<{ data: typeof roomDocuments }>(
      `/api/colabora/catalog?workspace_id=${activeWorkspace.id}&type=documents`
    )
      .then((payload) => setRoomDocuments(payload.data || []))
      .catch(() => setRoomDocuments([]));
  }, [activeWorkspace?.id, api, can, proAvailable, section]);

  const taskAction = async (action: string, reason?: string) => {
    const task = data?.task;
    if (!activeWorkspace?.id || !task) return;
    setSaving(true);
    setError('');
    try {
      await api(`/api/colabora/tasks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          workspace_id: activeWorkspace.id,
          action,
          reason: reason || null,
          optimistic_version: task.optimistic_version,
        }),
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar.');
    } finally {
      setSaving(false);
    }
  };

  const addComment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeWorkspace?.id) return;
    const form = event.currentTarget;
    const input = form.elements.namedItem('comment') as HTMLInputElement;
    if (!input.value.trim()) return;
    setSaving(true);
    try {
      await api(`/api/colabora/tasks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          workspace_id: activeWorkspace.id,
          action: 'comment',
          text: input.value,
          audience: 'internal',
          recipient_ids: [],
        }),
      });
      form.reset();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar el comentario.');
    } finally {
      setSaving(false);
    }
  };

  const addChecklistItem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeWorkspace?.id) return;
    const form = event.currentTarget;
    const input = form.elements.namedItem('checklist_text') as HTMLInputElement;
    if (!input.value.trim()) return;
    setSaving(true);
    setError('');
    try {
      await api(`/api/colabora/tasks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          workspace_id: activeWorkspace.id,
          action: 'add_checklist',
          text: input.value,
        }),
      });
      form.reset();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo agregar el elemento.');
    } finally {
      setSaving(false);
    }
  };

  const toggleChecklistItem = async (itemId: string, done: boolean) => {
    if (!activeWorkspace?.id) return;
    setSaving(true);
    setError('');
    try {
      await api(`/api/colabora/tasks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          workspace_id: activeWorkspace.id,
          action: 'toggle_checklist',
          item_id: itemId,
          done,
        }),
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el elemento.');
    } finally {
      setSaving(false);
    }
  };

  const requestItemAction = async (action: string, itemId: string, needsReason = false) => {
    if (!activeWorkspace?.id) return;
    const reason = needsReason ? window.prompt('Indica el motivo y como puede corregirse:') : null;
    if (needsReason && !reason?.trim()) return;
    setSaving(true);
    setError('');
    try {
      await api(`/api/colabora/details/requests/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          workspace_id: activeWorkspace.id,
          action,
          item_id: itemId,
          reason,
        }),
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo revisar el requisito.');
    } finally {
      setSaving(false);
    }
  };

  const scanRequestFile = async (fileId: string) => {
    if (!activeWorkspace?.id) return;
    setSaving(true);
    setError('');
    try {
      await api(`/api/colabora/request-files/${fileId}/scan`, {
        method: 'POST',
        body: JSON.stringify({ workspace_id: activeWorkspace.id }),
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo analizar el archivo.');
    } finally {
      setSaving(false);
    }
  };

  const spaceAction = async (body: Record<string, unknown>) => {
    if (!activeWorkspace?.id) return;
    setSaving(true);
    setError('');
    try {
      await api(`/api/colabora/details/spaces/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ workspace_id: activeWorkspace.id, ...body }),
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el espacio.');
    } finally {
      setSaving(false);
    }
  };

  const addSpaceMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    await spaceAction({
      action: 'add_member',
      user_id: values.get('user_id'),
      role: values.get('role'),
    });
    form.reset();
  };

  const addMilestone = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    await spaceAction({
      action: 'add_milestone',
      title: values.get('title'),
      due_at: new Date(String(values.get('due_at'))).toISOString(),
    });
    form.reset();
  };

  const addSpaceResource = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const [resourceType, resourceId] = String(values.get('resource') || '').split(':');
    if (!resourceType || !resourceId) return;
    await spaceAction({
      action: 'add_resource',
      resource_type: resourceType,
      resource_id: resourceId,
    });
    form.reset();
  };

  const roomAction = async (body: Record<string, unknown>) => {
    if (!activeWorkspace?.id) return;
    setSaving(true);
    setError('');
    try {
      const payload = await api<{ one_time_credentials?: { path: string } | null }>(
        `/api/colabora/details/rooms/${id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ workspace_id: activeWorkspace.id, ...body }),
        }
      );
      if (payload.one_time_credentials?.path)
        setOneTimeLink(`${window.location.origin}${payload.one_time_credentials.path}`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar la sala.');
    } finally {
      setSaving(false);
    }
  };

  const addRoomGuest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    await roomAction({
      action: 'add_guest',
      name: values.get('name'),
      email: values.get('email'),
      allow_download: values.get('allow_download') === 'on',
    });
    form.reset();
  };

  const addRoomResource = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    await roomAction({
      action: 'add_resource',
      resource_type: 'document',
      resource_id: values.get('resource_id'),
      allow_download: values.get('allow_download') === 'on',
    });
    form.reset();
  };

  const automationAction = async (body: Record<string, unknown>) => {
    if (!activeWorkspace?.id) return;
    setSaving(true);
    setError('');
    try {
      await api(`/api/colabora/details/automations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ workspace_id: activeWorkspace.id, ...body }),
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar la automatizacion.');
    } finally {
      setSaving(false);
    }
  };

  const advancedAction = async (body: Record<string, unknown>) => {
    if (!activeWorkspace?.id || !resources[section]) return;
    setSaving(true);
    setError('');
    try {
      await api(`/api/colabora/details/${resources[section]}/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ workspace_id: activeWorkspace.id, ...body }),
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el flujo.');
    } finally {
      setSaving(false);
    }
  };

  if (!labels[section] || (section !== 'tareas' && !resources[section]))
    return (
      <div className="rounded-lg border border-border bg-background p-8">
        Detalle no disponible.
      </div>
    );
  if (!proAvailable) {
    const canManagePlan = access.canManageSubscription
      || access.membershipRole === 'owner'
      || access.permissions.includes('subscription.manage_addons');
    return (
      <div className="mx-auto max-w-[920px] rounded-lg border border-border bg-background p-6">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-medium">{labels[section]}</h2>
          <span className="rounded border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">PRO</span>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">Función no disponible en el plan actual. Contacta a tu administrador.</p>
        {canManagePlan && <Link href="/app-market" className="mt-5 inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-white">Actualizar a Pro</Link>}
      </div>
    );
  }
  if (loading)
    return (
      <div className="min-h-[460px] grid place-items-center">
        <Loader2 className="animate-spin text-primary" />
      </div>
    );
  if (error && !data)
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        <AlertCircle size={18} className="mb-2" />
        {error}
      </div>
    );

  const primary = (data?.task || data?.resource || {}) as Record<string, unknown>;
  const title = value(primary.title || primary.name || primary.folio);
  const status = value(primary.estado || primary.status);
  const checklist = Array.isArray(data?.checklist)
    ? (data.checklist as Record<string, unknown>[])
    : [];
  const requestItems =
    section === 'solicitudes' && Array.isArray(data?.items)
      ? (data.items as Record<string, unknown>[])
      : [];
  const spaceMembers =
    section === 'espacios' && Array.isArray(data?.members)
      ? (data.members as Record<string, unknown>[])
      : [];
  const spaceMilestones =
    section === 'espacios' && Array.isArray(data?.milestones)
      ? (data.milestones as Record<string, unknown>[])
      : [];
  const spaceResources =
    section === 'espacios' && Array.isArray(data?.resources)
      ? (data.resources as Record<string, unknown>[])
      : [];
  const spaceResourceCatalog =
    section === 'espacios' && Array.isArray(data?.resource_catalog)
      ? (data.resource_catalog as Record<string, unknown>[])
      : [];
  const roomGuests =
    section === 'salas' && Array.isArray(data?.guests)
      ? (data.guests as Record<string, unknown>[])
      : [];
  const roomResources =
    section === 'salas' && Array.isArray(data?.resources)
      ? (data.resources as Record<string, unknown>[])
      : [];
  const automationVersions =
    section === 'automatizaciones' && Array.isArray(data?.versions)
      ? (data.versions as Record<string, unknown>[])
      : [];
  const automationRuns =
    section === 'automatizaciones' && Array.isArray(data?.runs)
      ? (data.runs as Record<string, unknown>[])
      : [];
  const committeeVotes =
    section === 'comites' && Array.isArray(data?.votes)
      ? (data.votes as Record<string, unknown>[])
      : [];
  const relatedEntries = Object.entries(data || {}).filter(
    ([key, item]) =>
      ![
        'task',
        'resource',
        'checklist',
        'items',
        'members',
        'milestones',
        'guests',
        'resources',
        'resource_catalog',
        'versions',
        'runs',
        'votes',
      ].includes(key) && Array.isArray(item)
  );

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <div>
        <Link
          href={`/colabora/${section}`}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary"
        >
          <ArrowLeft size={16} /> Volver a {section}
        </Link>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase text-primary">{labels[section]}</p>
            <h2 className="mt-1 text-2xl font-medium text-foreground">{title}</h2>
            <p className="mt-1 text-sm capitalize text-muted-foreground">{status}</p>
          </div>
          {section === 'tareas' && can('tasks.edit', true) && (
            <div className="flex flex-wrap gap-2">
              {String(primary.estado) === 'bloqueada' ? (
                <button
                  disabled={saving}
                  onClick={() => taskAction('unblock')}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-background px-4 text-sm"
                >
                  <RotateCcw size={15} /> Desbloquear
                </button>
              ) : (
                !['completada', 'cancelada'].includes(String(primary.estado)) && (
                  <>
                    <button
                      disabled={saving || String(primary.estado) === 'en_proceso'}
                      onClick={() => taskAction('start')}
                      className="h-10 rounded-md border border-border bg-background px-4 text-sm disabled:opacity-50"
                    >
                      Iniciar
                    </button>
                    <button
                      disabled={saving}
                      onClick={() => taskAction('block', 'Pendiente de insumo')}
                      className="h-10 rounded-md border border-amber-200 bg-amber-50 px-4 text-sm text-amber-700"
                    >
                      Bloquear
                    </button>
                    <button
                      disabled={saving}
                      onClick={() => taskAction('request_review')}
                      className="h-10 rounded-md border border-primary/30 bg-primary/5 px-4 text-sm text-primary"
                    >
                      Solicitar revision
                    </button>
                    <button
                      disabled={saving}
                      onClick={() => taskAction('complete')}
                      className="h-10 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white"
                    >
                      Completar
                    </button>
                  </>
                )
              )}
              {['completada', 'cancelada'].includes(String(primary.estado)) && (
                <button
                  disabled={saving}
                  onClick={() => taskAction('reopen', 'Reapertura solicitada desde Colabora')}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-background px-4 text-sm"
                >
                  <RotateCcw size={15} /> Reabrir
                </button>
              )}
            </div>
          )}
          {section === 'espacios' &&
            can('collaboration_spaces.archive', true) &&
            !['closed', 'archived'].includes(String(primary.status)) && (
              <div className="flex flex-wrap gap-2">
                <button
                  disabled={saving}
                  onClick={() => {
                    const reason = window.prompt('Motivo de cierre:');
                    if (reason?.trim()) spaceAction({ action: 'close', reason });
                  }}
                  className="h-10 rounded-md border border-border bg-background px-4 text-sm"
                >
                  Cerrar espacio
                </button>
                <button
                  disabled={saving}
                  onClick={() => {
                    const reason = window.prompt('Motivo de archivo:');
                    if (reason?.trim()) spaceAction({ action: 'archive', reason });
                  }}
                  className="h-10 rounded-md border border-border bg-background px-4 text-sm text-muted-foreground"
                >
                  Archivar
                </button>
              </div>
            )}
          {section === 'salas' &&
            can('rooms.manage_security', true) &&
            !['closed', 'revoked', 'archived'].includes(String(primary.status)) && (
              <div className="flex flex-wrap gap-2">
                <button
                  disabled={saving}
                  onClick={() => {
                    const reason = window.prompt('Motivo de cierre:');
                    if (reason?.trim()) roomAction({ action: 'close', reason });
                  }}
                  className="h-10 rounded-md border border-border bg-background px-4 text-sm"
                >
                  Cerrar sala
                </button>
                <button
                  disabled={saving}
                  onClick={() => {
                    const reason = window.prompt('Motivo de revocacion:');
                    if (reason?.trim()) roomAction({ action: 'revoke', reason });
                  }}
                  className="h-10 rounded-md border border-red-200 bg-red-50 px-4 text-sm text-red-700"
                >
                  Revocar sala
                </button>
              </div>
            )}
        </div>
      </div>
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <section className="overflow-hidden rounded-lg border border-border bg-background">
            <div className="border-b border-border px-5 py-4">
              <h3 className="font-medium text-foreground">Informacion general</h3>
            </div>
            <dl className="grid sm:grid-cols-2">
              {Object.entries(primary)
                .filter(
                  ([key, item]) =>
                    ![
                      'id',
                      'workspace_id',
                      'comments',
                      'activity',
                      'attachments',
                      'dependencies',
                      'checklist',
                      'settings',
                      'metadata',
                    ].includes(key) && item != null
                )
                .slice(0, 18)
                .map(([key, item], index) => (
                  <div
                    key={key}
                    className={`border-border px-5 py-3.5 ${index > 1 ? 'border-t' : ''} ${index % 2 ? 'sm:border-l' : ''}`}
                  >
                    <dt className="text-xs uppercase text-muted-foreground">
                      {key.replaceAll('_', ' ')}
                    </dt>
                    <dd className="mt-1 break-words text-sm text-foreground">{value(item)}</dd>
                  </div>
                ))}
            </dl>
          </section>
          {section === 'tareas' && (
            <section className="overflow-hidden rounded-lg border border-border bg-background">
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <h3 className="font-medium text-foreground">Checklist</h3>
                <span className="text-xs text-muted-foreground">
                  {checklist.filter((item) => item.done).length} de {checklist.length}
                </span>
              </div>
              {checklist.length ? (
                <div className="divide-y divide-border">
                  {checklist.map((item) => (
                    <label
                      key={String(item.id)}
                      className="flex cursor-pointer items-start gap-3 px-5 py-3.5"
                    >
                      <input
                        disabled={!can('tasks.edit', true) || saving}
                        type="checkbox"
                        checked={Boolean(item.done)}
                        onChange={(event) =>
                          toggleChecklistItem(String(item.id), event.target.checked)
                        }
                        className="mt-0.5 h-4 w-4 rounded border-border text-primary"
                      />
                      <span
                        className={`text-sm ${item.done ? 'text-muted-foreground line-through' : 'text-foreground'}`}
                      >
                        {value(item.text)}
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                  Sin elementos en el checklist.
                </div>
              )}
              {can('tasks.edit', true) && (
                <form onSubmit={addChecklistItem} className="flex gap-2 border-t border-border p-4">
                  <input
                    name="checklist_text"
                    placeholder="Agregar elemento..."
                    className="h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                  />
                  <button
                    disabled={saving}
                    aria-label="Agregar"
                    className="grid h-10 w-10 place-items-center rounded-md bg-primary text-white disabled:opacity-50"
                  >
                    <Plus size={17} />
                  </button>
                </form>
              )}
            </section>
          )}
          {section === 'solicitudes' && (
            <section className="overflow-hidden rounded-lg border border-border bg-background">
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <h3 className="font-medium text-foreground">Requisitos recibidos</h3>
                <span className="text-xs text-muted-foreground">{requestItems.length}</span>
              </div>
              {requestItems.length ? (
                <div className="divide-y divide-border">
                  {requestItems.map((item) => {
                    const files = Array.isArray(item.collaboration_request_files)
                      ? (item.collaboration_request_files as Record<string, unknown>[])
                      : [];
                    const latest = [...files].sort(
                      (a, b) => Number(b.version || 0) - Number(a.version || 0)
                    )[0];
                    const scanClean = latest?.malware_scan_status === 'clean';
                    return (
                      <div key={String(item.id)} className="px-5 py-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium text-foreground">
                                {value(item.title)}
                              </p>
                              <span
                                className={`rounded-full border px-2 py-0.5 text-[11px] ${String(item.status) === 'approved' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-border bg-muted text-muted-foreground'}`}
                              >
                                {value(item.status)}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {latest
                                ? `${value(latest.original_name)} · version ${value(latest.version)}`
                                : 'Sin archivo recibido'}
                            </p>
                            {latest && (
                              <p
                                className={`mt-1 text-xs ${scanClean ? 'text-emerald-700' : 'text-amber-700'}`}
                              >
                                Seguridad:{' '}
                                {scanClean
                                  ? 'analisis superado'
                                  : value(latest.malware_scan_status)}
                              </p>
                            )}
                            {Boolean(item.rejection_reason) && (
                              <p className="mt-2 text-xs text-red-700">
                                Observacion: {value(item.rejection_reason)}
                              </p>
                            )}
                          </div>
                          {can('requests.review_items', true) &&
                            !['approved', 'waived'].includes(String(item.status)) && (
                              <div className="flex flex-wrap gap-2">
                                {latest &&
                                  ['pending', 'failed'].includes(
                                    String(latest.malware_scan_status)
                                  ) && (
                                    <button
                                      disabled={saving}
                                      onClick={() => scanRequestFile(String(latest.id))}
                                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-3 text-xs font-medium text-primary disabled:opacity-50"
                                    >
                                      {saving ? (
                                        <Loader2 size={14} className="animate-spin" />
                                      ) : (
                                        <ScanSearch size={14} />
                                      )}
                                      Analizar archivo
                                    </button>
                                  )}
                                <button
                                  disabled={saving || !scanClean}
                                  title={
                                    !scanClean ? 'Pendiente de analisis de seguridad' : 'Aprobar'
                                  }
                                  onClick={() => requestItemAction('approve_item', String(item.id))}
                                  className="h-8 rounded-md bg-emerald-600 px-3 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  Aprobar
                                </button>
                                <button
                                  disabled={saving}
                                  onClick={() =>
                                    requestItemAction('request_replacement', String(item.id), true)
                                  }
                                  className="h-8 rounded-md border border-amber-200 bg-amber-50 px-3 text-xs text-amber-800"
                                >
                                  Pedir reemplazo
                                </button>
                                <button
                                  disabled={saving}
                                  onClick={() =>
                                    requestItemAction('reject_item', String(item.id), true)
                                  }
                                  className="h-8 rounded-md border border-red-200 bg-red-50 px-3 text-xs text-red-700"
                                >
                                  Rechazar
                                </button>
                                <button
                                  disabled={saving}
                                  onClick={() =>
                                    requestItemAction('waive_item', String(item.id), true)
                                  }
                                  className="h-8 rounded-md border border-border px-3 text-xs"
                                >
                                  Exentar
                                </button>
                              </div>
                            )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                  Sin requisitos registrados.
                </div>
              )}
            </section>
          )}
          {section === 'espacios' && (
            <SpaceManagement
              primary={primary}
              members={spaceMembers}
              milestones={spaceMilestones}
              resources={spaceResources}
              resourceCatalog={spaceResourceCatalog}
              workspaceMembers={workspaceMembers}
              saving={saving}
              canManageMembers={can('collaboration_spaces.manage_members', true)}
              canManageMilestones={can('collaboration_spaces.create', true)}
              onAddMember={addSpaceMember}
              onAddMilestone={addMilestone}
              onAddResource={addSpaceResource}
              onAction={spaceAction}
            />
          )}
          {section === 'salas' && (
            <RoomManagement
              primary={primary}
              guests={roomGuests}
              resources={roomResources}
              documents={roomDocuments}
              oneTimeLink={oneTimeLink}
              saving={saving}
              canManageGuests={can('rooms.manage_guests', true)}
              canManageSecurity={can('rooms.manage_security', true)}
              canManageResources={can('rooms.create', true)}
              onAddGuest={addRoomGuest}
              onAddResource={addRoomResource}
              onAction={roomAction}
            />
          )}
          {section === 'automatizaciones' && (
            <AutomationManagement
              versions={automationVersions}
              runs={automationRuns}
              saving={saving}
              canManage={can('automations.manage', true)}
              onAction={automationAction}
            />
          )}
          {['negociacion', 'comites', 'cierres'].includes(section) && (
            <AdvancedWorkflowManagement
              section={section}
              primary={primary}
              votes={committeeVotes}
              saving={saving}
              canManage={
                section === 'negociacion'
                  ? can('reviews.create', true)
                  : can('collaboration_spaces.create', true)
              }
              onAction={advancedAction}
            />
          )}
          {relatedEntries.map(([key, items]) => (
            <section
              key={key}
              className="overflow-hidden rounded-lg border border-border bg-background"
            >
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <h3 className="font-medium capitalize text-foreground">
                  {key.replaceAll('_', ' ')}
                </h3>
                <span className="text-xs text-muted-foreground">{(items as unknown[]).length}</span>
              </div>
              {(items as Record<string, unknown>[]).length ? (
                <div className="divide-y divide-border">
                  {(items as Record<string, unknown>[]).slice(0, 30).map((item, index) => (
                    <div
                      key={String(item.id || index)}
                      className="flex items-start gap-3 px-5 py-3.5"
                    >
                      {String(item.status || item.estado || '').includes('complet') ? (
                        <CheckCircle2 size={17} className="mt-0.5 text-emerald-600" />
                      ) : (
                        <Circle size={17} className="mt-0.5 text-muted-foreground" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">
                          {value(
                            item.title ||
                              item.name ||
                              item.summary ||
                              item.text ||
                              item.action ||
                              item.email ||
                              item.status
                          )}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {value(item.status || item.estado || item.created_at || item.due_at)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                  Sin elementos registrados.
                </div>
              )}
            </section>
          ))}
        </div>
        <aside className="space-y-5">
          <section className="overflow-hidden rounded-lg border border-border bg-background">
            <div className="border-b border-border px-5 py-4">
              <h3 className="font-medium text-foreground">Control</h3>
            </div>
            <div className="space-y-4 p-5">
              <div className="flex items-start gap-3">
                <Clock3 size={17} className="mt-0.5 text-primary" />
                <div>
                  <p className="text-sm font-medium">Ultima actualizacion</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {value(primary.updated_at || primary.created_at)}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <ShieldAlert size={17} className="mt-0.5 text-primary" />
                <div>
                  <p className="text-sm font-medium">Trazabilidad</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Los cambios quedan asociados al usuario y a la organizacion.
                  </p>
                </div>
              </div>
            </div>
          </section>
          {section === 'tareas' && can('tasks.edit', true) && (
            <section className="overflow-hidden rounded-lg border border-border bg-background">
              <div className="flex items-center gap-2 border-b border-border px-5 py-4">
                <MessageSquareText size={17} className="text-primary" />
                <h3 className="font-medium">Agregar comentario</h3>
              </div>
              <form onSubmit={addComment} className="p-5">
                <textarea
                  name="comment"
                  rows={4}
                  placeholder="Escribe un comentario interno..."
                  className="w-full rounded-md border border-border bg-background p-3 text-sm outline-none focus:border-primary"
                />
                <button
                  disabled={saving}
                  className="mt-3 inline-flex h-9 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-white disabled:opacity-60"
                >
                  Comentar
                </button>
              </form>
            </section>
          )}
          <section className="rounded-lg border border-border bg-background p-5">
            <div className="flex gap-3">
              <Paperclip size={17} className="text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Evidencia y archivos</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Las descargas respetan el acceso del recurso y el alcance del miembro.
                </p>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function AdvancedWorkflowManagement({
  section,
  primary,
  votes,
  saving,
  canManage,
  onAction,
}: {
  section: string;
  primary: Record<string, unknown>;
  votes: Record<string, unknown>[];
  saving: boolean;
  canManage: boolean;
  onAction: (body: Record<string, unknown>) => Promise<void>;
}) {
  if (section === 'negociacion')
    return (
      <section className="overflow-hidden rounded-lg border border-border bg-background">
        <div className="border-b border-border px-5 py-4">
          <h3 className="font-medium">Posiciones y resolucion</h3>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            onAction({
              action: 'update',
              status: values.get('status'),
              counterparty_proposal: values.get('counterparty_proposal') || null,
              internal_position: values.get('internal_position') || null,
              resolution: values.get('resolution') || null,
            });
          }}
          className="grid gap-4 p-5"
        >
          <label className="text-sm font-medium">
            Estado
            <select
              name="status"
              defaultValue={String(primary.status)}
              className="mt-2 h-10 w-full rounded-md border border-border bg-background px-3"
            >
              <option value="open">Abierto</option>
              <option value="internal_review">Revision interna</option>
              <option value="counterparty_review">Revision de contraparte</option>
              <option value="agreed">Acordado</option>
              <option value="rejected">Rechazado</option>
              <option value="withdrawn">Retirado</option>
            </select>
          </label>
          <label className="text-sm font-medium">
            Propuesta de contraparte
            <textarea
              name="counterparty_proposal"
              defaultValue={String(primary.counterparty_proposal || '')}
              rows={3}
              className="mt-2 w-full rounded-md border border-border bg-background p-3"
            />
          </label>
          <label className="text-sm font-medium">
            Posicion interna
            <textarea
              name="internal_position"
              defaultValue={String(primary.internal_position || '')}
              rows={3}
              className="mt-2 w-full rounded-md border border-border bg-background p-3"
            />
          </label>
          <label className="text-sm font-medium">
            Resolucion
            <textarea
              name="resolution"
              defaultValue={String(primary.resolution || '')}
              rows={3}
              className="mt-2 w-full rounded-md border border-border bg-background p-3"
            />
          </label>
          {canManage && (
            <button
              disabled={saving}
              className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-white"
            >
              Guardar posicion
            </button>
          )}
        </form>
      </section>
    );

  if (section === 'comites') {
    const agenda = Array.isArray(primary.agenda)
      ? (primary.agenda as Record<string, unknown>[])
      : [];
    return (
      <>
        {canManage && (
          <section className="flex flex-wrap gap-2 rounded-lg border border-border bg-background p-4">
            {primary.status === 'draft' && (
              <button
                disabled={saving}
                onClick={() => onAction({ action: 'convene' })}
                className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-white"
              >
                Convocar
              </button>
            )}
            {primary.status === 'convened' && (
              <button
                disabled={saving}
                onClick={() => onAction({ action: 'start' })}
                className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-white"
              >
                Iniciar sesion
              </button>
            )}
            {primary.status === 'in_session' && (
              <button
                disabled={saving}
                onClick={() => onAction({ action: 'close' })}
                className="h-9 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white"
              >
                Cerrar con quorum
              </button>
            )}
            {!['closed', 'cancelled'].includes(String(primary.status)) && (
              <button
                disabled={saving}
                onClick={() => onAction({ action: 'cancel' })}
                className="h-9 rounded-md border border-red-200 bg-red-50 px-4 text-sm text-red-700"
              >
                Cancelar
              </button>
            )}
          </section>
        )}
        <section className="overflow-hidden rounded-lg border border-border bg-background">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h3 className="font-medium">Agenda y votacion</h3>
            <span className="text-xs text-muted-foreground">{votes.length} votos</span>
          </div>
          <div className="divide-y divide-border">
            {agenda.map((item, index) => (
              <div key={String(item.key || index)} className="p-5">
                <p className="text-sm font-medium">{value(item.title)}</p>
                {canManage && primary.status === 'in_session' && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(['for', 'against', 'abstain'] as const).map((decision) => (
                      <button
                        key={decision}
                        disabled={saving}
                        onClick={() =>
                          onAction({ action: 'vote', agenda_item_key: item.key, decision })
                        }
                        className="h-8 rounded-md border border-border px-3 text-xs capitalize"
                      >
                        {decision === 'for'
                          ? 'A favor'
                          : decision === 'against'
                            ? 'En contra'
                            : 'Abstencion'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </>
    );
  }

  const conditions = Array.isArray(primary.conditions)
    ? (primary.conditions as Record<string, unknown>[])
    : [];
  const nextActionByStatus: Record<string, { action: string; label: string }> = {
    preparing: { action: 'mark_ready', label: 'Marcar listo' },
    ready: { action: 'start_signing', label: 'Iniciar firma' },
    signing: { action: 'release', label: 'Autorizar liberacion' },
    released: { action: 'seal', label: 'Sellar cierre' },
  };
  const next = nextActionByStatus[String(primary.status)];
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <h3 className="font-medium">Condiciones de cierre</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            El avance se bloquea hasta completar todas las condiciones.
          </p>
        </div>
        {canManage && next && (
          <button
            disabled={saving}
            onClick={() => onAction({ action: next.action })}
            className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-white"
          >
            {next.label}
          </button>
        )}
      </div>
      <div className="divide-y divide-border">
        {conditions.map((condition, index) => (
          <label key={String(condition.key || index)} className="flex items-center gap-3 px-5 py-4">
            <input
              type="checkbox"
              disabled={!canManage || saving || primary.status !== 'preparing'}
              checked={condition.status === 'completed'}
              onChange={(event) =>
                onAction({
                  action: 'toggle_condition',
                  condition_key: condition.key,
                  completed: event.target.checked,
                })
              }
              className="h-4 w-4"
            />
            <span className="text-sm">{value(condition.title)}</span>
          </label>
        ))}
      </div>
    </section>
  );
}

function AutomationManagement({
  versions,
  runs,
  saving,
  canManage,
  onAction,
}: {
  versions: Record<string, unknown>[];
  runs: Record<string, unknown>[];
  saving: boolean;
  canManage: boolean;
  onAction: (body: Record<string, unknown>) => Promise<void>;
}) {
  return (
    <>
      {canManage && (
        <section className="overflow-hidden rounded-lg border border-border bg-background">
          <div className="border-b border-border px-5 py-4">
            <h3 className="font-medium">Control de automatizacion</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              La prueba valida la regla sin efectos. Ejecutar ahora aplica solo acciones permitidas
              y registra el resultado.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 p-4">
            <button
              disabled={saving}
              onClick={() => onAction({ action: 'publish' })}
              className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-white"
            >
              Publicar
            </button>
            <button
              disabled={saving}
              onClick={() => onAction({ action: 'test_run' })}
              className="h-9 rounded-md border border-border px-4 text-sm"
            >
              Ejecutar prueba
            </button>
            <button
              disabled={saving}
              onClick={() => onAction({ action: 'run_now' })}
              className="h-9 rounded-md border border-primary/30 bg-primary/5 px-4 text-sm font-medium text-primary"
            >
              Ejecutar ahora
            </button>
            <button
              disabled={saving}
              onClick={() => onAction({ action: 'pause' })}
              className="h-9 rounded-md border border-amber-200 bg-amber-50 px-4 text-sm text-amber-800"
            >
              Pausar
            </button>
            <button
              disabled={saving}
              onClick={() => onAction({ action: 'disable' })}
              className="h-9 rounded-md border border-red-200 bg-red-50 px-4 text-sm text-red-700"
            >
              Deshabilitar
            </button>
          </div>
        </section>
      )}
      <section className="overflow-hidden rounded-lg border border-border bg-background">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h3 className="font-medium">Versiones</h3>
          <span className="text-xs text-muted-foreground">{versions.length}</span>
        </div>
        <div className="divide-y divide-border">
          {versions.map((version) => (
            <div key={String(version.id)} className="flex items-center justify-between px-5 py-3.5">
              <div>
                <p className="text-sm font-medium">Version {value(version.version)}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {version.published_at ? `Publicada ${value(version.published_at)}` : 'Borrador'}
                </p>
              </div>
              <span className="text-xs text-muted-foreground">
                Esquema {value(version.schema_version)}
              </span>
            </div>
          ))}
          {!versions.length && (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">
              Sin versiones.
            </div>
          )}
        </div>
      </section>
      <section className="overflow-hidden rounded-lg border border-border bg-background">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h3 className="font-medium">Ejecuciones</h3>
          <span className="text-xs text-muted-foreground">{runs.length}</span>
        </div>
        <div className="divide-y divide-border">
          {runs.map((run) => (
            <div key={String(run.id)} className="flex items-center gap-3 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium capitalize">{value(run.status)}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Intentos {value(run.attempt_count)} ·{' '}
                  {value(run.completed_at || run.scheduled_at)}
                </p>
              </div>
              {canManage &&
                ['failed', 'dead_lettered', 'retrying'].includes(String(run.status)) && (
                  <button
                    disabled={saving}
                    onClick={() => onAction({ action: 'retry_run', run_id: run.id })}
                    className="h-8 rounded-md border border-border px-3 text-xs"
                  >
                    Reintentar
                  </button>
                )}
            </div>
          ))}
          {!runs.length && (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">
              Aun no hay ejecuciones.
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function RoomManagement({
  primary,
  guests,
  resources,
  documents,
  oneTimeLink,
  saving,
  canManageGuests,
  canManageSecurity,
  canManageResources,
  onAddGuest,
  onAddResource,
  onAction,
}: {
  primary: Record<string, unknown>;
  guests: Record<string, unknown>[];
  resources: Record<string, unknown>[];
  documents: Array<{ id: string; nombre: string; estado: string }>;
  oneTimeLink: string;
  saving: boolean;
  canManageGuests: boolean;
  canManageSecurity: boolean;
  canManageResources: boolean;
  onAddGuest: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onAddResource: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onAction: (body: Record<string, unknown>) => Promise<void>;
}) {
  const editable = !['closed', 'revoked', 'archived'].includes(String(primary.status));
  return (
    <>
      {oneTimeLink && (
        <section className="rounded-lg border border-blue-200 bg-blue-50 p-5">
          <p className="text-sm font-medium text-blue-950">Enlace de acceso creado</p>
          <p className="mt-1 text-xs leading-5 text-blue-800">
            Comparte este enlace por un canal seguro. Solo se muestra durante esta sesion.
          </p>
          <div className="mt-3 flex gap-2">
            <input
              readOnly
              value={oneTimeLink}
              className="h-10 min-w-0 flex-1 rounded-md border border-blue-200 bg-white px-3 text-xs"
            />
            <button
              onClick={() => navigator.clipboard.writeText(oneTimeLink)}
              className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-white"
            >
              Copiar
            </button>
          </div>
        </section>
      )}
      <section className="overflow-hidden rounded-lg border border-border bg-background">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h3 className="font-medium">Invitados</h3>
          <span className="text-xs text-muted-foreground">{guests.length}</span>
        </div>
        {guests.length ? (
          <div className="divide-y divide-border">
            {guests.map((guest) => (
              <div key={String(guest.id)} className="flex items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{value(guest.name)}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {value(guest.email)} · {value(guest.status)}
                  </p>
                </div>
                {canManageGuests && editable && guest.status !== 'revoked' && (
                  <button
                    disabled={saving}
                    onClick={() => onAction({ action: 'revoke_guest', guest_id: guest.id })}
                    title="Revocar acceso"
                    className="grid h-8 w-8 place-items-center rounded-md border border-red-200 text-red-600"
                  >
                    <UserMinus size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">Sin invitados.</div>
        )}
        {canManageGuests && editable && (
          <form
            onSubmit={onAddGuest}
            className="grid gap-2 border-t border-border p-4 sm:grid-cols-2"
          >
            <input
              required
              name="name"
              placeholder="Nombre del invitado"
              className="h-10 rounded-md border border-border bg-background px-3 text-sm"
            />
            <input
              required
              type="email"
              name="email"
              placeholder="correo@empresa.com"
              className="h-10 rounded-md border border-border bg-background px-3 text-sm"
            />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" name="allow_download" className="h-4 w-4" /> Permitir descarga
            </label>
            <button
              disabled={saving}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white"
            >
              <UserPlus size={15} /> Invitar
            </button>
          </form>
        )}
      </section>
      <section className="overflow-hidden rounded-lg border border-border bg-background">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h3 className="font-medium">Recursos publicados</h3>
          <span className="text-xs text-muted-foreground">{resources.length}</span>
        </div>
        {resources.length ? (
          <div className="divide-y divide-border">
            {resources.map((resource) => (
              <div key={String(resource.id)} className="flex items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{value(resource.display_name)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {value(resource.resource_type)}
                  </p>
                </div>
                {canManageResources && editable && (
                  <button
                    disabled={saving}
                    onClick={() =>
                      onAction({ action: 'remove_resource', room_resource_id: resource.id })
                    }
                    title="Retirar recurso"
                    className="grid h-8 w-8 place-items-center rounded-md border border-red-200 text-red-600"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">Sin recursos.</div>
        )}
        {canManageResources && editable && (
          <form
            onSubmit={onAddResource}
            className="grid gap-2 border-t border-border p-4 sm:grid-cols-[1fr_auto_auto]"
          >
            <select
              required
              name="resource_id"
              className="h-10 rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="">Selecciona un documento</option>
              {documents.map((document) => (
                <option key={document.id} value={document.id}>
                  {document.nombre} · {document.estado}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
              <input type="checkbox" name="allow_download" className="h-4 w-4" /> Descarga
            </label>
            <button
              disabled={saving}
              className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-white"
            >
              Publicar
            </button>
          </form>
        )}
      </section>
      {canManageSecurity && editable && (
        <section className="overflow-hidden rounded-lg border border-border bg-background">
          <div className="border-b border-border px-5 py-4">
            <h3 className="font-medium">Seguridad de la sala</h3>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const values = new FormData(event.currentTarget);
              onAction({
                action: 'update_security',
                downloads_allowed: values.get('downloads_allowed') === 'on',
                watermark_enabled: values.get('watermark_enabled') === 'on',
                terms_required: values.get('terms_required') === 'on',
                session_minutes: Number(values.get('session_minutes')),
              });
            }}
            className="grid gap-3 p-5 sm:grid-cols-2"
          >
            <label className="flex items-center gap-2 text-sm">
              <input
                defaultChecked={Boolean(primary.downloads_allowed)}
                name="downloads_allowed"
                type="checkbox"
              />{' '}
              Descargas globales
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                defaultChecked={Boolean(primary.watermark_enabled)}
                name="watermark_enabled"
                type="checkbox"
              />{' '}
              Marca de agua
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                defaultChecked={Boolean(primary.terms_required)}
                name="terms_required"
                type="checkbox"
              />{' '}
              Aceptacion de terminos
            </label>
            <label className="text-xs text-muted-foreground">
              Minutos por sesion
              <input
                name="session_minutes"
                type="number"
                min={5}
                max={1440}
                defaultValue={Number(primary.session_minutes || 30)}
                className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
              />
            </label>
            <button className="h-10 rounded-md border border-border bg-background px-4 text-sm sm:col-span-2">
              Guardar seguridad
            </button>
          </form>
        </section>
      )}
    </>
  );
}

function SpaceManagement({
  primary,
  members,
  milestones,
  resources,
  resourceCatalog,
  workspaceMembers,
  saving,
  canManageMembers,
  canManageMilestones,
  onAddMember,
  onAddMilestone,
  onAddResource,
  onAction,
}: {
  primary: Record<string, unknown>;
  members: Record<string, unknown>[];
  milestones: Record<string, unknown>[];
  resources: Record<string, unknown>[];
  resourceCatalog: Record<string, unknown>[];
  workspaceMembers: Array<{
    user_id: string;
    role: string;
    user_profiles?:
      { full_name?: string; email?: string } | Array<{ full_name?: string; email?: string }>;
  }>;
  saving: boolean;
  canManageMembers: boolean;
  canManageMilestones: boolean;
  onAddMember: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onAddMilestone: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onAddResource: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onAction: (body: Record<string, unknown>) => Promise<void>;
}) {
  const editable = !['closed', 'archived'].includes(String(primary.status));
  const linkedResourceKeys = new Set(
    resources.map((resource) => `${resource.resource_type}:${resource.resource_id}`)
  );
  const availableResources = resourceCatalog.filter(
    (resource) => !linkedResourceKeys.has(`${resource.resource_type}:${resource.id}`)
  );
  const resourceHref = (resource: Record<string, unknown>) => {
    const resourceId = String(resource.resource_id || '');
    if (resource.resource_type === 'document') return `/visor-documento/${resourceId}`;
    if (resource.resource_type === 'case_file') return `/expedientes/${resourceId}`;
    if (resource.resource_type === 'form') return `/formularios/builder?id=${resourceId}`;
    if (resource.resource_type === 'template') return `/plantillas/nueva?id=${resourceId}`;
    return '';
  };
  return (
    <>
      <section className="overflow-hidden rounded-lg border border-border bg-background">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="font-medium text-foreground">Recursos del espacio</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Documentos, formularios, plantillas y expedientes compartidos con el equipo.
            </p>
          </div>
          <span className="text-xs text-muted-foreground">{resources.length}</span>
        </div>
        {resources.length ? (
          <div className="divide-y divide-border">
            {resources.map((resource) => {
              const href = resourceHref(resource);
              return (
                <div key={String(resource.id)} className="flex items-center gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{value(resource.display_name)}</p>
                    <p className="mt-0.5 text-xs capitalize text-muted-foreground">
                      {value(resource.resource_type)}
                    </p>
                  </div>
                  {href && (
                    <Link
                      href={href}
                      aria-label="Abrir recurso"
                      className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-primary"
                    >
                      <ExternalLink size={15} />
                    </Link>
                  )}
                  {canManageMilestones && editable && (
                    <button
                      aria-label="Retirar recurso"
                      disabled={saving}
                      onClick={() =>
                        onAction({
                          action: 'remove_resource',
                          space_resource_id: resource.id,
                        })
                      }
                      className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            Aun no hay recursos vinculados.
          </div>
        )}
        {canManageMilestones && editable && (
          <form
            onSubmit={onAddResource}
            className="flex flex-col gap-2 border-t border-border p-4 sm:flex-row"
          >
            <select
              required
              name="resource"
              defaultValue=""
              className="h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="" disabled>
                Seleccionar recurso
              </option>
              {availableResources.map((resource) => (
                <option
                  key={`${resource.resource_type}:${resource.id}`}
                  value={`${resource.resource_type}:${resource.id}`}
                >
                  {value(resource.display_name)} - {value(resource.resource_type)}
                </option>
              ))}
            </select>
            <button
              disabled={saving || !availableResources.length}
              className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-white disabled:opacity-50"
            >
              Vincular
            </button>
          </form>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-background">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h3 className="font-medium text-foreground">Hitos</h3>
          <span className="text-xs text-muted-foreground">{milestones.length}</span>
        </div>
        {milestones.length ? (
          <div className="divide-y divide-border">
            {milestones.map((milestone) => (
              <div key={String(milestone.id)} className="flex items-center gap-3 px-5 py-3.5">
                <Circle
                  size={16}
                  className={milestone.status === 'completed' ? 'text-emerald-600' : 'text-primary'}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{value(milestone.title)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{value(milestone.due_at)}</p>
                </div>
                {milestone.status !== 'completed' && canManageMilestones && editable && (
                  <button
                    disabled={saving}
                    onClick={() =>
                      onAction({ action: 'complete_milestone', milestone_id: milestone.id })
                    }
                    className="h-8 rounded-md border border-border px-3 text-xs"
                  >
                    Completar
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">Sin hitos.</div>
        )}
        {canManageMilestones && editable && (
          <form
            onSubmit={onAddMilestone}
            className="grid gap-2 border-t border-border p-4 sm:grid-cols-[1fr_220px_auto]"
          >
            <input
              required
              name="title"
              placeholder="Nuevo hito"
              className="h-10 rounded-md border border-border bg-background px-3 text-sm"
            />
            <input
              required
              name="due_at"
              type="datetime-local"
              className="h-10 rounded-md border border-border bg-background px-3 text-sm"
            />
            <button
              disabled={saving}
              className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-white"
            >
              Agregar
            </button>
          </form>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-background">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h3 className="font-medium text-foreground">Miembros</h3>
          <span className="text-xs text-muted-foreground">{members.length}</span>
        </div>
        {members.length ? (
          <div className="divide-y divide-border">
            {members.map((member) => {
              const profile = Array.isArray(member.user_profiles)
                ? member.user_profiles[0]
                : (member.user_profiles as Record<string, unknown> | undefined);
              return (
                <div key={String(member.user_id)} className="flex items-center gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {value(profile?.full_name || profile?.email)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{value(member.role)}</p>
                  </div>
                  {canManageMembers && primary.owner_id !== member.user_id && editable && (
                    <button
                      aria-label="Retirar miembro"
                      disabled={saving}
                      onClick={() => onAction({ action: 'remove_member', user_id: member.user_id })}
                      className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-red-600"
                    >
                      <UserMinus size={15} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            Sin miembros adicionales.
          </div>
        )}
        {canManageMembers && editable && (
          <form
            onSubmit={onAddMember}
            className="grid gap-2 border-t border-border p-4 sm:grid-cols-[1fr_170px_auto]"
          >
            <select
              required
              name="user_id"
              className="h-10 rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="">Seleccionar miembro</option>
              {workspaceMembers.map((member) => {
                const profile = Array.isArray(member.user_profiles)
                  ? member.user_profiles[0]
                  : member.user_profiles;
                return (
                  <option key={member.user_id} value={member.user_id}>
                    {profile?.full_name || profile?.email || member.user_id}
                  </option>
                );
              })}
            </select>
            <select
              name="role"
              className="h-10 rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="collaborator">Colaborador</option>
              <option value="reviewer">Revisor</option>
              <option value="approver">Aprobador</option>
              <option value="observer">Observador</option>
              <option value="coordinator">Coordinador</option>
            </select>
            <button
              disabled={saving}
              className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-white"
            >
              Agregar
            </button>
          </form>
        )}
      </section>
    </>
  );
}
