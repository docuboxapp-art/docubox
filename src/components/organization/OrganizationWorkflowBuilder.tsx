'use client';

import { useMemo, useState } from 'react';
import {
  BadgeCheck,
  Bell,
  CheckCircle2,
  Circle,
  Clock3,
  GitFork,
  GitBranch,
  PenLine,
  Plus,
  Save,
  Trash2,
  Webhook,
  Zap,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  legacyDefinitionToBuilderDraft,
  AUTOMATION_CONDITION_OPERATORS,
  WORKFLOW_CONDITION_FIELDS,
  validateWorkflowBuilderDraft,
  type WorkflowBuilderDraft,
  type WorkflowBuilderNode,
  type WorkflowBuilderNodeType,
} from '@/lib/organization/workflow-definition';

export type WorkflowBuilderCapabilities = {
  notification_channels: Array<'in_app' | 'email' | 'sms'>;
  action_types: string[];
  webhooks: Array<{ id: string; name: string; status: string }>;
};

const nodeMeta: Record<
  WorkflowBuilderNodeType,
  { label: string; icon: typeof Circle; tone: string }
> = {
  start: {
    label: 'Inicio',
    icon: Circle,
    tone: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
  approval: {
    label: 'Aprobación',
    icon: BadgeCheck,
    tone: 'border-blue-200 bg-blue-50 text-blue-700',
  },
  signature: {
    label: 'Firma',
    icon: PenLine,
    tone: 'border-violet-200 bg-violet-50 text-violet-700',
  },
  delay: { label: 'Espera', icon: Clock3, tone: 'border-amber-200 bg-amber-50 text-amber-700' },
  notification: {
    label: 'Notificación',
    icon: Bell,
    tone: 'border-cyan-200 bg-cyan-50 text-cyan-700',
  },
  action: {
    label: 'Acción',
    icon: Zap,
    tone: 'border-orange-200 bg-orange-50 text-orange-700',
  },
  webhook: {
    label: 'Webhook',
    icon: Webhook,
    tone: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  },
  condition: {
    label: 'Condición',
    icon: GitFork,
    tone: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700',
  },
  end: { label: 'Fin', icon: CheckCircle2, tone: 'border-slate-200 bg-slate-50 text-slate-700' },
};

const conditionFieldLabels: Record<(typeof WORKFLOW_CONDITION_FIELDS)[number], string> = {
  'event.type': 'Tipo de evento',
  'document.status': 'Estado del documento',
  'document.type_id': 'Tipo documental',
  'document.classification': 'Clasificación',
  'document.template_id': 'Plantilla',
  'participant.reference_id': 'Participante del evento',
  'organization.id': 'Organización',
  'workspace.id': 'Espacio',
  'package.status': 'Estado del paquete',
  'package.resource_count': 'Cantidad de recursos',
};

const operatorLabels: Record<(typeof AUTOMATION_CONDITION_OPERATORS)[number], string> = {
  equals: 'Es igual a',
  not_equals: 'No es igual a',
  exists: 'Existe',
  not_exists: 'No existe',
  contains: 'Contiene',
  in: 'Está en',
  greater_than: 'Es mayor que',
  less_than: 'Es menor que',
};

const inputClass =
  'mt-1.5 h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary';

function createNode(
  type: WorkflowBuilderNodeType,
  index: number,
  id = crypto.randomUUID()
): WorkflowBuilderNode {
  const config: Record<string, unknown> =
    type === 'signature'
      ? { completion_event: 'document.completed' }
      : type === 'delay'
        ? { duration_value: 24, duration_unit: 'hours' }
        : type === 'notification'
          ? {
              channels: ['in_app'],
              recipient: 'owner',
              title: 'Actualización del documento',
              message: 'El flujo documental requiere tu atención.',
              delivery_policy: 'single',
            }
          : type === 'action'
            ? { action: { type: 'activity', summary: 'Etapa automatizada completada.' } }
            : type === 'webhook'
              ? { webhook_configuration_id: '' }
              : type === 'condition'
                ? {
                    condition: {
                      field: 'document.status',
                      operator: 'equals',
                      value: 'completado',
                    },
                  }
                : type === 'end'
                  ? { outcome: 'approved' }
                  : {};
  return {
    id,
    type,
    label: nodeMeta[type].label,
    position: { x: 80, y: 48 + index * 112 },
    config,
  };
}

function connect(nodes: WorkflowBuilderNode[]) {
  return nodes.slice(0, -1).map((node, index) => ({
    id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    source: node.id,
    target: nodes[index + 1].id,
  }));
}

function edge(source: string, target: string, branch?: 'true' | 'false') {
  return { id: crypto.randomUUID(), source, target, ...(branch ? { branch } : {}) };
}

function defaultAction(type: string, channels: Array<'in_app' | 'email' | 'sms'>) {
  if (type === 'notify') {
    return {
      type,
      target: 'owner',
      title: 'Actualización del documento',
      message: 'Una acción del flujo documental se completó.',
      channels: channels.includes('in_app') ? ['in_app'] : [channels[0] || 'email'],
      delivery_policy: 'single',
    };
  }
  if (type === 'activity') return { type, summary: 'Etapa automatizada completada.' };
  if (type === 'webhook') return { type, endpoint_id: '' };
  if (type === 'document_metadata') return { type, name: '', value: '' };
  if (type === 'create_task') {
    return { type, title: '', description: '', assigned_to: 'owner' };
  }
  return { type };
}

function emptyDraft(): WorkflowBuilderDraft {
  const nodes = [
    createNode('start', 0, '10000000-0000-4000-8000-000000000001'),
    createNode('approval', 1, '10000000-0000-4000-8000-000000000002'),
    createNode('end', 2, '10000000-0000-4000-8000-000000000003'),
  ];
  return {
    name: '',
    description: null,
    document_type: null,
    applicable_areas: [],
    nodes,
    edges: connect(nodes),
  };
}

export default function OrganizationWorkflowBuilder({
  workspaceId,
  workflow,
  capabilities,
  onCancel,
  onSaved,
}: {
  workspaceId: string;
  workflow?: Record<string, unknown> | null;
  capabilities: WorkflowBuilderCapabilities;
  onCancel: () => void;
  onSaved: (message: string) => Promise<void> | void;
}) {
  const { session } = useAuth();
  const workflowId = typeof workflow?.id === 'string' ? workflow.id : null;
  const initialDraft = useMemo(
    () => (workflow ? legacyDefinitionToBuilderDraft(workflow) : null) || emptyDraft(),
    [workflow]
  );
  const [draft, setDraft] = useState(initialDraft);
  const [selectedId, setSelectedId] = useState(
    initialDraft.nodes[1]?.id || initialDraft.nodes[0].id
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const validation = useMemo(() => validateWorkflowBuilderDraft(draft), [draft]);
  const selected = draft.nodes.find((node) => node.id === selectedId) || draft.nodes[0];

  const updateNodes = (nodes: WorkflowBuilderNode[]) => {
    const positioned = nodes.map((node, index) => ({
      ...node,
      position: { x: 80, y: 48 + index * 112 },
    }));
    return positioned;
  };

  const addNode = (
    type: 'approval' | 'signature' | 'delay' | 'notification' | 'action' | 'webhook' | 'condition'
  ) => {
    const outgoing = draft.edges.filter((candidate) => candidate.source === selected.id);
    const insertionEdge =
      selected.type === 'end'
        ? draft.edges.find((candidate) => candidate.target === selected.id)
        : outgoing.length === 1
          ? outgoing[0]
          : null;
    if (!insertionEdge) {
      setMessage('Selecciona una etapa o un Fin dentro de la rama donde deseas insertar el nodo.');
      return;
    }
    const node = createNode(type, draft.nodes.length);
    const insertionIndex = draft.nodes.findIndex(
      (candidate) => candidate.id === insertionEdge.target
    );
    const next = [...draft.nodes];
    next.splice(insertionIndex < 0 ? next.length : insertionIndex, 0, node);
    const nextEdges = draft.edges.filter((candidate) => candidate.id !== insertionEdge.id);
    nextEdges.push(
      edge(insertionEdge.source, node.id, insertionEdge.branch),
      edge(node.id, insertionEdge.target, type === 'condition' ? 'true' : undefined)
    );
    if (type === 'condition') {
      const falseEnd = createNode('end', next.length, crypto.randomUUID());
      falseEnd.label = 'Fin alterno';
      next.push(falseEnd);
      nextEdges.push(edge(node.id, falseEnd.id, 'false'));
    }
    setDraft((current) => ({ ...current, nodes: updateNodes(next), edges: nextEdges }));
    setSelectedId(node.id);
    setMessage('');
  };

  const removeNode = (id: string) => {
    const node = draft.nodes.find((candidate) => candidate.id === id);
    const incoming = draft.edges.find((candidate) => candidate.target === id);
    const outgoing = draft.edges.filter((candidate) => candidate.source === id);
    if (!node || !incoming) return;
    if (node.type === 'condition') {
      const trueEdge = outgoing.find((candidate) => candidate.branch === 'true');
      const falseEdge = outgoing.find((candidate) => candidate.branch === 'false');
      const falseTarget = draft.nodes.find((candidate) => candidate.id === falseEdge?.target);
      if (!trueEdge || !falseEdge || falseTarget?.type !== 'end') {
        setMessage('Elimina primero las etapas de la rama Falso para retirar esta condición.');
        return;
      }
      const next = draft.nodes.filter(
        (candidate) => candidate.id !== id && candidate.id !== falseTarget.id
      );
      setDraft((current) => ({
        ...current,
        nodes: updateNodes(next),
        edges: [
          ...current.edges.filter(
            (candidate) =>
              candidate.id !== incoming.id &&
              candidate.source !== id &&
              candidate.target !== falseTarget.id
          ),
          edge(incoming.source, trueEdge.target, incoming.branch),
        ],
      }));
      setSelectedId(trueEdge.target);
      return;
    }
    if (outgoing.length !== 1) return;
    const next = draft.nodes.filter((candidate) => candidate.id !== id);
    setDraft((current) => ({
      ...current,
      nodes: updateNodes(next),
      edges: [
        ...current.edges.filter(
          (candidate) => candidate.id !== incoming.id && candidate.id !== outgoing[0].id
        ),
        edge(incoming.source, outgoing[0].target, incoming.branch),
      ],
    }));
    setSelectedId(next[Math.max(0, next.length - 2)]?.id || next[0].id);
  };

  const updateSelected = (patch: Partial<WorkflowBuilderNode>) => {
    setDraft((current) => ({
      ...current,
      nodes: current.nodes.map((node) => (node.id === selected.id ? { ...node, ...patch } : node)),
    }));
  };

  const updateConfig = (key: string, value: unknown) => {
    updateSelected({ config: { ...selected.config, [key]: value } });
  };

  const updateAction = (patch: Record<string, unknown>) => {
    const action =
      selected.config.action && typeof selected.config.action === 'object'
        ? (selected.config.action as Record<string, unknown>)
        : {};
    updateConfig('action', { ...action, ...patch });
  };

  const submit = async () => {
    if (!validation.valid || !session?.access_token) {
      setMessage(validation.issues[0]?.message || 'La sesión no está disponible.');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch('/api/organizacion/workflows', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: workflowId ? 'update' : 'create',
          workspace_id: workspaceId,
          ...(workflowId ? { workflow_id: workflowId } : {}),
          draft,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'No se pudo guardar el flujo.');
      await onSaved(workflowId ? 'Borrador actualizado.' : 'Flujo guardado como borrador.');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'No se pudo guardar el flujo.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="grid border-b border-border lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
        <div className="space-y-4 border-b border-border p-5 lg:border-b-0 lg:border-r">
          <label className="block">
            <span className="text-sm">Nombre del flujo</span>
            <input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              className={inputClass}
              placeholder="Ej. Revisión y firma contractual"
            />
          </label>
          <label className="block">
            <span className="text-sm">Descripción</span>
            <textarea
              value={draft.description || ''}
              onChange={(event) => setDraft({ ...draft, description: event.target.value || null })}
              className="mt-1.5 min-h-20 w-full rounded-md border border-border bg-background p-3 text-sm outline-none focus:border-primary"
            />
          </label>
          <label className="block">
            <span className="text-sm">Tipo documental</span>
            <input
              value={draft.document_type || ''}
              onChange={(event) =>
                setDraft({ ...draft, document_type: event.target.value || null })
              }
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="text-sm">Áreas aplicables</span>
            <input
              value={draft.applicable_areas.join(', ')}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  applicable_areas: event.target.value
                    .split(',')
                    .map((value) => value.trim())
                    .filter(Boolean),
                })
              }
              className={inputClass}
              placeholder="Legal, Finanzas"
            />
          </label>
        </div>
        <div className="grid min-h-[520px] xl:grid-cols-[190px_minmax(320px,1fr)_280px]">
          <aside className="border-b border-border p-4 xl:border-b-0 xl:border-r">
            <p className="text-sm font-medium">Etapas</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
              {(
                [
                  'approval',
                  'signature',
                  'delay',
                  'notification',
                  'action',
                  'webhook',
                  'condition',
                ] as const
              ).map((type) => {
                const meta = nodeMeta[type];
                const Icon = meta.icon;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => addNode(type)}
                    className="flex h-10 items-center gap-2 rounded-md border border-border px-3 text-left text-sm hover:border-primary/50 hover:bg-muted"
                  >
                    <Icon size={16} className="text-muted-foreground" />
                    {meta.label}
                    <Plus size={14} className="ml-auto text-muted-foreground" />
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="min-w-0 bg-muted/40 p-5">
            <div className="mx-auto max-w-xl space-y-0">
              {draft.nodes.map((node, index) => {
                const meta = nodeMeta[node.type];
                const Icon = meta.icon;
                const locked = node.type === 'start' || node.type === 'end';
                return (
                  <div key={node.id}>
                    <div
                      className={`flex min-h-16 w-full items-center gap-2 rounded-md border bg-background px-2 shadow-sm ${selectedId === node.id ? 'border-primary ring-2 ring-primary/10' : 'border-border'}`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedId(node.id)}
                        className="flex min-w-0 flex-1 items-center gap-3 px-2 py-3 text-left"
                      >
                        <span
                          className={`grid h-9 w-9 shrink-0 place-items-center rounded-md border ${meta.tone}`}
                        >
                          <Icon size={17} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{node.label}</span>
                          <span className="block text-xs text-muted-foreground">{meta.label}</span>
                          {node.type === 'condition' && (
                            <span className="mt-1 block text-xs text-muted-foreground">
                              Verdadero →{' '}
                              {draft.nodes.find(
                                (candidate) =>
                                  candidate.id ===
                                  draft.edges.find(
                                    (candidateEdge) =>
                                      candidateEdge.source === node.id &&
                                      candidateEdge.branch === 'true'
                                  )?.target
                              )?.label || 'Sin conexión'}
                              {' · '}Falso →{' '}
                              {draft.nodes.find(
                                (candidate) =>
                                  candidate.id ===
                                  draft.edges.find(
                                    (candidateEdge) =>
                                      candidateEdge.source === node.id &&
                                      candidateEdge.branch === 'false'
                                  )?.target
                              )?.label || 'Sin conexión'}
                            </span>
                          )}
                        </span>
                      </button>
                      {!locked && (
                        <div className="flex shrink-0 gap-1">
                          <button
                            type="button"
                            title="Eliminar etapa"
                            aria-label="Eliminar etapa"
                            onClick={(event) => {
                              event.stopPropagation();
                              removeNode(node.id);
                            }}
                            className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      )}
                    </div>
                    {index < draft.nodes.length - 1 && (
                      <div className="mx-auto flex h-7 items-center justify-center text-[11px] text-muted-foreground">
                        {draft.edges.find(
                          (candidate) =>
                            candidate.source === node.id &&
                            candidate.target === draft.nodes[index + 1]?.id
                        )?.branch === 'true'
                          ? 'Verdadero'
                          : draft.edges.find(
                                (candidate) =>
                                  candidate.source === node.id &&
                                  candidate.target === draft.nodes[index + 1]?.id
                              )?.branch === 'false'
                            ? 'Falso'
                            : '↓'}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <aside className="border-t border-border p-4 xl:border-l xl:border-t-0">
            <div className="flex items-center gap-2">
              <GitBranch size={16} className="text-muted-foreground" />
              <p className="text-sm font-medium">Configuración</p>
            </div>
            <label className="mt-4 block">
              <span className="text-sm">Nombre de la etapa</span>
              <input
                value={selected.label}
                onChange={(event) => updateSelected({ label: event.target.value })}
                className={inputClass}
              />
            </label>
            {selected.type === 'approval' && (
              <>
                <label className="mt-4 block">
                  <span className="text-sm">Tipo de responsable</span>
                  <select
                    value={String(selected.config.assignee_type || '')}
                    onChange={(event) => updateConfig('assignee_type', event.target.value)}
                    className={inputClass}
                  >
                    <option value="">Cualquier usuario autorizado</option>
                    <option value="user">Usuario</option>
                    <option value="member">Miembro</option>
                  </select>
                </label>
                {selected.config.assignee_type && (
                  <label className="mt-4 block">
                    <span className="text-sm">ID del responsable</span>
                    <input
                      value={String(selected.config.assignee_id || '')}
                      onChange={(event) => updateConfig('assignee_id', event.target.value)}
                      className={inputClass}
                    />
                  </label>
                )}
              </>
            )}
            {selected.type === 'signature' && (
              <label className="mt-4 block">
                <span className="text-sm">Avanzar cuando</span>
                <select
                  value={String(selected.config.completion_event || 'document.completed')}
                  onChange={(event) => updateConfig('completion_event', event.target.value)}
                  className={inputClass}
                >
                  <option value="document.completed">Documento completado</option>
                  <option value="participant.completion_committed">Participante completado</option>
                </select>
              </label>
            )}
            {selected.type === 'delay' && (
              <div className="mt-4 grid grid-cols-[1fr_120px] gap-2">
                <label>
                  <span className="text-sm">Duración</span>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={Number(selected.config.duration_value || 1)}
                    onChange={(event) => updateConfig('duration_value', Number(event.target.value))}
                    className={inputClass}
                  />
                </label>
                <label>
                  <span className="text-sm">Unidad</span>
                  <select
                    value={String(selected.config.duration_unit || 'hours')}
                    onChange={(event) => updateConfig('duration_unit', event.target.value)}
                    className={inputClass}
                  >
                    <option value="hours">Horas</option>
                    <option value="days">Días</option>
                  </select>
                </label>
              </div>
            )}
            {selected.type === 'notification' && (
              <div className="mt-4 space-y-4">
                <fieldset>
                  <legend className="text-sm">Canales disponibles</legend>
                  <div className="mt-2 space-y-2">
                    {capabilities.notification_channels.map((channel) => {
                      const selectedChannels = Array.isArray(selected.config.channels)
                        ? (selected.config.channels as string[])
                        : [];
                      return (
                        <label key={channel} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={selectedChannels.includes(channel)}
                            onChange={(event) =>
                              updateConfig(
                                'channels',
                                event.target.checked
                                  ? [...new Set([...selectedChannels, channel])]
                                  : selectedChannels.filter((value) => value !== channel)
                              )
                            }
                          />
                          {channel === 'in_app'
                            ? 'Docubox'
                            : channel === 'email'
                              ? 'Correo electrónico'
                              : 'SMS'}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                <label className="block">
                  <span className="text-sm">Destinatario</span>
                  <select
                    value={String(selected.config.recipient || 'owner')}
                    onChange={(event) => updateConfig('recipient', event.target.value)}
                    className={inputClass}
                  >
                    <option value="owner">Propietario del flujo</option>
                    <option value="participant">Participante del evento</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm">Título</span>
                  <input
                    value={String(selected.config.title || '')}
                    onChange={(event) => updateConfig('title', event.target.value)}
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <span className="text-sm">Mensaje</span>
                  <textarea
                    value={String(selected.config.message || '')}
                    onChange={(event) => updateConfig('message', event.target.value)}
                    className="mt-1.5 min-h-24 w-full rounded-md border border-border bg-background p-3 text-sm outline-none focus:border-primary"
                  />
                </label>
                <label className="block">
                  <span className="text-sm">Entrega</span>
                  <select
                    value={String(selected.config.delivery_policy || 'single')}
                    onChange={(event) => updateConfig('delivery_policy', event.target.value)}
                    className={inputClass}
                  >
                    <option value="single">Un solo canal</option>
                    <option value="fallback">Canal alterno si falla</option>
                    <option value="multidelivery">Todos los canales</option>
                  </select>
                </label>
              </div>
            )}
            {selected.type === 'action' && (
              <div className="mt-4 space-y-4">
                <label className="block">
                  <span className="text-sm">Acción existente</span>
                  <select
                    value={String(
                      (selected.config.action as Record<string, unknown> | undefined)?.type ||
                        'activity'
                    )}
                    onChange={(event) =>
                      updateConfig(
                        'action',
                        defaultAction(event.target.value, capabilities.notification_channels)
                      )
                    }
                    className={inputClass}
                  >
                    {capabilities.action_types.map((type) => (
                      <option key={type} value={type}>
                        {type === 'notify'
                          ? 'Notificar'
                          : type === 'activity'
                            ? 'Registrar actividad'
                            : type === 'webhook'
                              ? 'Enviar webhook'
                              : type === 'document_metadata'
                                ? 'Asignar metadata'
                                : type === 'create_task'
                                  ? 'Crear tarea'
                                  : type === 'request_nom151'
                                    ? 'Solicitar NOM-151'
                                    : 'Analizar con LucIA'}
                      </option>
                    ))}
                  </select>
                </label>
                {(() => {
                  const action =
                    selected.config.action && typeof selected.config.action === 'object'
                      ? (selected.config.action as Record<string, unknown>)
                      : {};
                  if (action.type === 'activity') {
                    return (
                      <label className="block">
                        <span className="text-sm">Resumen</span>
                        <input
                          value={String(action.summary || '')}
                          onChange={(event) => updateAction({ summary: event.target.value })}
                          className={inputClass}
                        />
                      </label>
                    );
                  }
                  if (action.type === 'webhook') {
                    return (
                      <label className="block">
                        <span className="text-sm">Webhook</span>
                        <select
                          value={String(action.endpoint_id || '')}
                          onChange={(event) => updateAction({ endpoint_id: event.target.value })}
                          className={inputClass}
                        >
                          <option value="">Seleccionar...</option>
                          {capabilities.webhooks.map((webhook) => (
                            <option key={webhook.id} value={webhook.id}>
                              {webhook.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  }
                  if (action.type === 'document_metadata') {
                    return (
                      <>
                        <label className="block">
                          <span className="text-sm">Nombre de metadata</span>
                          <input
                            value={String(action.name || '')}
                            onChange={(event) => updateAction({ name: event.target.value })}
                            className={inputClass}
                          />
                        </label>
                        <label className="block">
                          <span className="text-sm">Valor</span>
                          <input
                            value={String(action.value ?? '')}
                            onChange={(event) => updateAction({ value: event.target.value })}
                            className={inputClass}
                          />
                        </label>
                      </>
                    );
                  }
                  if (action.type === 'create_task') {
                    return (
                      <>
                        <label className="block">
                          <span className="text-sm">Título de la tarea</span>
                          <input
                            value={String(action.title || '')}
                            onChange={(event) => updateAction({ title: event.target.value })}
                            className={inputClass}
                          />
                        </label>
                        <label className="block">
                          <span className="text-sm">Descripción</span>
                          <textarea
                            value={String(action.description || '')}
                            onChange={(event) => updateAction({ description: event.target.value })}
                            className="mt-1.5 min-h-20 w-full rounded-md border border-border bg-background p-3 text-sm"
                          />
                        </label>
                      </>
                    );
                  }
                  if (action.type === 'notify') {
                    return (
                      <>
                        <label className="block">
                          <span className="text-sm">Título</span>
                          <input
                            value={String(action.title || '')}
                            onChange={(event) => updateAction({ title: event.target.value })}
                            className={inputClass}
                          />
                        </label>
                        <label className="block">
                          <span className="text-sm">Mensaje</span>
                          <textarea
                            value={String(action.message || '')}
                            onChange={(event) => updateAction({ message: event.target.value })}
                            className="mt-1.5 min-h-20 w-full rounded-md border border-border bg-background p-3 text-sm"
                          />
                        </label>
                      </>
                    );
                  }
                  return (
                    <p className="rounded-md border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
                      Esta acción reutiliza su configuración segura existente y no modifica el
                      documento firmado.
                    </p>
                  );
                })()}
              </div>
            )}
            {selected.type === 'webhook' && (
              <label className="mt-4 block">
                <span className="text-sm">Webhook activo</span>
                <select
                  value={String(selected.config.webhook_configuration_id || '')}
                  onChange={(event) => updateConfig('webhook_configuration_id', event.target.value)}
                  className={inputClass}
                >
                  <option value="">Seleccionar...</option>
                  {capabilities.webhooks.map((webhook) => (
                    <option key={webhook.id} value={webhook.id}>
                      {webhook.name}
                    </option>
                  ))}
                </select>
                <span className="mt-1.5 block text-xs text-muted-foreground">
                  El secreto permanece en Integraciones y nunca se copia al flujo.
                </span>
              </label>
            )}
            {selected.type === 'condition' &&
              (() => {
                const condition =
                  selected.config.condition && typeof selected.config.condition === 'object'
                    ? (selected.config.condition as Record<string, unknown>)
                    : {};
                const operator = String(condition.operator || 'equals');
                return (
                  <div className="mt-4 space-y-4">
                    <label className="block">
                      <span className="text-sm">Campo permitido</span>
                      <select
                        value={String(condition.field || 'document.status')}
                        onChange={(event) =>
                          updateConfig('condition', { ...condition, field: event.target.value })
                        }
                        className={inputClass}
                      >
                        {WORKFLOW_CONDITION_FIELDS.map((field) => (
                          <option key={field} value={field}>
                            {conditionFieldLabels[field]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-sm">Operador</span>
                      <select
                        value={operator}
                        onChange={(event) =>
                          updateConfig('condition', {
                            ...condition,
                            operator: event.target.value,
                            ...(['exists', 'not_exists'].includes(event.target.value)
                              ? { value: undefined }
                              : {}),
                          })
                        }
                        className={inputClass}
                      >
                        {AUTOMATION_CONDITION_OPERATORS.map((candidate) => (
                          <option key={candidate} value={candidate}>
                            {operatorLabels[candidate]}
                          </option>
                        ))}
                      </select>
                    </label>
                    {!['exists', 'not_exists'].includes(operator) && (
                      <label className="block">
                        <span className="text-sm">Valor</span>
                        <input
                          value={String(condition.value ?? '')}
                          onChange={(event) =>
                            updateConfig('condition', {
                              ...condition,
                              value:
                                operator === 'in'
                                  ? event.target.value
                                      .split(',')
                                      .map((value) => value.trim())
                                      .filter(Boolean)
                                  : event.target.value,
                            })
                          }
                          className={inputClass}
                        />
                      </label>
                    )}
                    <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                      La decisión Verdadero/Falso se conserva al ejecutarse y no se reevalúa en un
                      retry.
                    </div>
                  </div>
                );
              })()}
            {selected.type === 'end' && (
              <label className="mt-4 block">
                <span className="text-sm">Resultado</span>
                <select
                  value={String(selected.config.outcome || 'approved')}
                  onChange={(event) => updateConfig('outcome', event.target.value)}
                  className={inputClass}
                >
                  <option value="approved">Aprobado</option>
                  <option value="rejected">Rechazado</option>
                  <option value="cancelled">Cancelado</option>
                </select>
              </label>
            )}
          </aside>
        </div>
      </div>

      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-h-5 text-sm">
          {message ? (
            <span className="text-red-600">{message}</span>
          ) : validation.valid ? (
            <span className="inline-flex items-center gap-1.5 text-emerald-700">
              <CheckCircle2 size={15} /> Flujo válido
            </span>
          ) : (
            <span className="text-amber-700">{validation.issues[0]?.message}</span>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-10 rounded-md border border-border px-4 text-sm"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || !validation.valid}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save size={16} /> {saving ? 'Guardando...' : 'Guardar borrador'}
          </button>
        </div>
      </div>
    </section>
  );
}
