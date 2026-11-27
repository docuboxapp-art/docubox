'use client';

import { BottomNotice } from '@/components/ui/BottomNotice';
import { collaborationLabels, collaborationStatusOptions } from '@/lib/collaboration/presentation';
import RequestItemsEditor from '../_components/RequestItemsEditor';
import BulkTaskActions from '../_components/BulkTaskActions';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import TableScrollArea from '@/components/workspaces/TableScrollArea';
import TablePagination, { useTablePagination } from '@/components/workspaces/TablePagination';
import { TableSortButton } from '@/components/workspaces/TableSortButton';
import { useTableOrdering } from '@/components/workspaces/useTableOrdering';
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  Check,
  Filter,
  Loader2,
  LockKeyhole,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useCollaboration } from '@/contexts/CollaborationContext';
import { useCollaborationApi } from '@/lib/collaboration/client';
import { hasCollaborationEntitlement } from '@/lib/collaboration/domain';
import { collaborationSectionEntitlements } from '@/lib/collaboration/navigation';
import { tableAriaSort, tableDate, type ListDirection } from '@/lib/workspaces/list-order';
import { DEFAULT_TABLE_PAGE_SIZE, shouldShowTablePagination } from '@/lib/workspaces/table-pagination';

type Row = Record<string, unknown> & { id: string };

function rowLink(section: string, row: Row, detail?: string) {
  if (section === 'revisiones') return `/documentos/${row.document_id}/revision`;
  if (section === 'calendario' || section === 'actividad') {
    const type = String(row.source_type || row.resource_type || '');
    const id = encodeURIComponent(String(row.resource_id || row.id));
    const paths: Record<string, string> = {
      task: 'tareas',
      review: 'revisiones',
      space: 'espacios',
      collaboration_space: 'espacios',
      document_request: 'solicitudes',
      collaboration_document_request: 'solicitudes',
      collaboration_room: 'salas',
      room: 'salas',
      collaboration_automation: 'automatizaciones',
    };
    if (type === 'review')
      return row.document_id ? `/documentos/${row.document_id}/revision` : '/colabora/revisiones';
    if (type === 'document') return `/documentos/${id}`;
    if (type === 'milestone') return row.space_id ? `/colabora/espacios/${row.space_id}` : null;
    return paths[type] ? `/colabora/${paths[type]}/${id}` : null;
  }
  return detail ? `${detail}/${row.id}` : null;
}

const sections: Record<
  string,
  {
    title: string;
    description: string;
    resource: string;
    permission: string;
    createPermission?: string;
    singular: string;
    columns: Array<{ key: string; label: string }>;
    detail?: string;
  }
> = {
  tareas: {
    title: 'Tareas',
    description: 'Trabajo asignado, bloqueos, fechas y dependencias.',
    resource: 'tasks',
    permission: 'tasks.view',
    createPermission: 'tasks.create',
    singular: 'tarea',
    detail: '/colabora/tareas',
    columns: [
      { key: 'title', label: 'Tarea' },
      { key: 'responsible_name', label: 'Responsable' },
      { key: 'prioridad', label: 'Prioridad' },
      { key: 'estado', label: 'Estado' },
      { key: 'due_date', label: 'Vencimiento' },
    ],
  },
  revisiones: {
    title: 'Revisiones',
    description: 'Rondas activas, comentarios y decisiones sobre versiones.',
    resource: 'reviews',
    permission: 'reviews.view',
    createPermission: 'reviews.create',
    singular: 'revision',
    detail: '/documentos',
    columns: [
      { key: 'title', label: 'Revision' },
      { key: 'round_number', label: 'Ronda' },
      { key: 'status', label: 'Estado' },
      { key: 'due_at', label: 'Vencimiento' },
    ],
  },
  espacios: {
    title: 'Espacios',
    description: 'Clientes, proyectos y operaciones con contexto compartido.',
    resource: 'spaces',
    permission: 'collaboration_spaces.view',
    createPermission: 'collaboration_spaces.create',
    singular: 'espacio',
    detail: '/colabora/espacios',
    columns: [
      { key: 'name', label: 'Espacio' },
      { key: 'space_type', label: 'Tipo' },
      { key: 'confidentiality', label: 'Confidencialidad' },
      { key: 'status', label: 'Estado' },
    ],
  },
  calendario: {
    title: 'Calendario',
    description: 'Hitos, vencimientos y compromisos del equipo.',
    resource: 'milestones',
    permission: 'collaboration_spaces.view',
    createPermission: 'collaboration_spaces.create',
    singular: 'hito',
    columns: [
      { key: 'title', label: 'Hito' },
      { key: 'source_type', label: 'Origen' },
      { key: 'status', label: 'Estado' },
      { key: 'starts_at', label: 'Inicio' },
      { key: 'due_at', label: 'Vencimiento' },
    ],
  },
  actividad: {
    title: 'Actividad',
    description: 'Eventos relevantes dentro de tu alcance autorizado.',
    resource: 'activity',
    permission: 'collaboration.view_dashboard',
    singular: 'evento',
    columns: [
      { key: 'summary', label: 'Evento' },
      { key: 'resource_type', label: 'Recurso' },
      { key: 'visibility', label: 'Visibilidad' },
      { key: 'occurred_at', label: 'Fecha' },
    ],
  },
  solicitudes: {
    title: 'Solicitudes documentales',
    description: 'Recopila archivos y formularios con seguimiento claro.',
    resource: 'requests',
    permission: 'requests.view',
    createPermission: 'requests.create',
    singular: 'solicitud',
    detail: '/colabora/solicitudes',
    columns: [
      { key: 'folio', label: 'Folio' },
      { key: 'title', label: 'Solicitud' },
      { key: 'recipient_name', label: 'Destinatario' },
      { key: 'status', label: 'Estado' },
      { key: 'due_at', label: 'Vencimiento' },
    ],
  },
  salas: {
    title: 'Salas externas',
    description: 'Acceso controlado para contrapartes e invitados.',
    resource: 'rooms',
    permission: 'rooms.view',
    createPermission: 'rooms.create',
    singular: 'sala',
    detail: '/colabora/salas',
    columns: [
      { key: 'name', label: 'Sala' },
      { key: 'room_type', label: 'Tipo' },
      { key: 'status', label: 'Estado' },
      { key: 'expires_at', label: 'Expira' },
    ],
  },
  automatizaciones: {
    title: 'Automatizaciones',
    description: 'Reglas versionadas con ejecución observable.',
    resource: 'automations',
    permission: 'automations.view',
    createPermission: 'automations.manage',
    singular: 'automatizacion',
    detail: '/colabora/automatizaciones',
    columns: [
      { key: 'name', label: 'Automatizacion' },
      { key: 'status', label: 'Estado' },
      { key: 'current_version', label: 'Version' },
      { key: 'consecutive_failures', label: 'Fallos' },
    ],
  },
  negociacion: {
    title: 'Negociacion',
    description: 'Cambios de cláusulas y posiciones internas sin perder contexto.',
    resource: 'negotiations',
    permission: 'reviews.view',
    createPermission: 'reviews.create',
    singular: 'asunto',
    detail: '/colabora/negociacion',
    columns: [
      { key: 'clause_reference', label: 'Clausula' },
      { key: 'requested_change', label: 'Cambio solicitado' },
      { key: 'status', label: 'Estado' },
      { key: 'updated_at', label: 'Actualizacion' },
    ],
  },
  comites: {
    title: 'Comites',
    description: 'Agenda, quórum y decisiones trazables.',
    resource: 'committees',
    permission: 'collaboration_spaces.view',
    createPermission: 'collaboration_spaces.create',
    singular: 'comite',
    detail: '/colabora/comites',
    columns: [
      { key: 'name', label: 'Comite' },
      { key: 'purpose', label: 'Objetivo' },
      { key: 'status', label: 'Estado' },
      { key: 'scheduled_at', label: 'Sesion' },
    ],
  },
  cierres: {
    title: 'Salas de cierre',
    description: 'Condiciones de liberación, firma y sellado final.',
    resource: 'closings',
    permission: 'collaboration_spaces.view',
    createPermission: 'collaboration_spaces.create',
    singular: 'cierre',
    detail: '/colabora/cierres',
    columns: [
      { key: 'name', label: 'Cierre' },
      { key: 'status', label: 'Estado' },
      { key: 'released_at', label: 'Liberado' },
      { key: 'sealed_at', label: 'Sellado' },
    ],
  },
};

function display(value: unknown, key: string) {
  if (value == null || value === '') return '—';
  if (key.includes('at') || key.includes('date')) {
    const parsed = new Date(String(value));
    if (!Number.isNaN(parsed.getTime()))
      return new Intl.DateTimeFormat('es-MX', {
        dateStyle: 'medium',
        timeStyle: key.includes('at') ? 'short' : undefined,
      }).format(parsed);
  }
  return collaborationLabels[String(value)] || String(value).replaceAll('_', ' ');
}

const isDateColumn = (key: string) => /_(at|date)$/.test(key);

function statusClass(value: unknown) {
  const status = String(value || '');
  if (['active', 'approved', 'completed', 'succeeded', 'sealed', 'released'].includes(status))
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (
    ['blocked', 'bloqueada', 'failed', 'error', 'expired', 'cancelled', 'rejected'].includes(status)
  )
    return 'bg-red-50 text-red-700 border-red-200';
  if (['pending', 'draft', 'new', 'nueva', 'in_review', 'en_revision', 'trialing'].includes(status))
    return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-blue-50 text-blue-700 border-blue-200';
}

function CreatePanel({
  section,
  close,
  saved,
}: {
  section: string;
  close: () => void;
  saved: () => void;
}) {
  const definition = sections[section];
  const createDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    createDialog.current?.showModal();
  }, []);
  const searchParams = useSearchParams();
  const { activeWorkspace } = useWorkspace();
  const api = useCollaborationApi();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [createdLink, setCreatedLink] = useState('');
  const [createdInvitationStatus, setCreatedInvitationStatus] = useState('');
  const [members, setMembers] = useState<
    Array<{
      user_id: string;
      role: string;
      user_profiles?:
        { full_name?: string; email?: string } | Array<{ full_name?: string; email?: string }>;
    }>
  >([]);
  const [reviewVersions, setReviewVersions] = useState<
    Array<{
      id: string;
      document_id: string;
      version_number: number;
      status: string;
      documentos?:
        | { nombre?: string; documento_id?: string }
        | Array<{ nombre?: string; documento_id?: string }>;
    }>
  >([]);
  const [spaces, setSpaces] = useState<Array<{ id: string; name: string }>>([]);
  const [documents, setDocuments] = useState<Array<{ id: string; nombre: string; estado: string }>>(
    []
  );

  useEffect(() => {
    if (!activeWorkspace?.id) return;
    const needsMembers = ['tareas', 'revisiones', 'solicitudes'].includes(section);
    const needsSpaces = [
      'calendario',
      'solicitudes',
      'salas',
      'negociacion',
      'comites',
      'cierres',
    ].includes(section);
    const needsDocuments = section === 'negociacion';
    if (!needsMembers && !needsSpaces && !needsDocuments) return;
    Promise.all([
      needsMembers
        ? api<{ data: typeof members }>(
            `/api/colabora/catalog?workspace_id=${activeWorkspace.id}&type=members`
          )
        : Promise.resolve({ data: [] as typeof members }),
      section === 'revisiones'
        ? api<{ data: typeof reviewVersions }>(
            `/api/colabora/resources/versions?workspace_id=${activeWorkspace.id}`
          )
        : Promise.resolve({ data: [] as typeof reviewVersions }),
      needsSpaces
        ? api<{ data: typeof spaces }>(
            `/api/colabora/resources/spaces?workspace_id=${activeWorkspace.id}&status=active`
          )
        : Promise.resolve({ data: [] as typeof spaces }),
      needsDocuments
        ? api<{ data: typeof documents }>(
            `/api/colabora/catalog?workspace_id=${activeWorkspace.id}&type=documents`
          )
        : Promise.resolve({ data: [] as typeof documents }),
    ])
      .then(([overview, versions, spaceResult, documentResult]) => {
        setMembers(overview.data || []);
        setReviewVersions(versions.data || []);
        setSpaces(spaceResult.data || []);
        setDocuments(documentResult.data || []);
      })
      .catch((cause) => {
        setMembers([]);
        setReviewVersions([]);
        setSpaces([]);
        setDocuments([]);
        setError(cause instanceof Error ? cause.message : 'No se pudieron cargar las opciones.');
      });
  }, [activeWorkspace?.id, api, section]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeWorkspace?.id || createdLink) return;
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(form.entries());
    setSaving(true);
    setError('');
    try {
      let body: Record<string, unknown> = { workspace_id: activeWorkspace.id, ...values };
      if (section === 'tareas')
        body = {
          ...body,
          tipo: 'revisar_documento',
          prioridad: values.prioridad || 'media',
          confidentiality: 'internal',
          assigned_to: values.assigned_to || null,
          due_date: values.due_date ? new Date(String(values.due_date)).toISOString() : null,
        };
      if (section === 'revisiones') {
        const version = reviewVersions.find((item) => item.id === values.document_version_id);
        if (!version) throw new Error('Selecciona una version documental valida.');
        body = {
          workspace_id: activeWorkspace.id,
          title: values.title,
          document_id: version.document_id,
          document_version_id: version.id,
          reviewer_ids: form.getAll('reviewer_ids').map(String),
          due_at: values.due_at ? new Date(String(values.due_at)).toISOString() : null,
        };
      }
      if (section === 'espacios')
        body = { ...body, space_type: values.space_type || 'project', confidentiality: 'internal' };
      if (section === 'calendario')
        body = { ...body, due_at: new Date(String(values.due_at)).toISOString() };
      if (section === 'solicitudes')
        body = {
          workspace_id: activeWorkspace.id,
          title: values.title,
          description: values.description || null,
          recipient_name: values.recipient_name,
          responsible_user_id: values.responsible_user_id || null,
          recipient_email: values.recipient_email,
          space_id: values.space_id || null,
          due_at: values.due_at ? new Date(String(values.due_at)).toISOString() : null,
          items: JSON.parse(String(values.items || '[]')),
          send_invitation: values.send_invitation !== undefined,
        };
      if (section === 'salas')
        body = {
          ...body,
          room_type: 'counterparty',
          expires_at: new Date(String(values.expires_at)).toISOString(),
          otp_required: true,
          downloads_allowed: false,
          watermark_enabled: true,
          send_invitation: values.send_invitation !== undefined,
          guests: values.guest_email
            ? [{ name: values.guest_name, email: values.guest_email }]
            : [],
        };
      if (section === 'automatizaciones')
        body = {
          ...body,
          trigger_definition: { event_type: values.trigger_event || 'document.completed' },
          conditions: values.condition_field
            ? [
                {
                  field: values.condition_field,
                  operator: values.condition_operator || 'equals',
                  ...(!['exists', 'not_exists'].includes(String(values.condition_operator))
                    ? { value: values.condition_value }
                    : {}),
                },
              ]
            : [],
          actions:
            values.action_type === 'activity'
              ? [
                  {
                    type: 'activity',
                    summary: values.action_message || 'Automatización documental ejecutada.',
                  },
                ]
              : values.action_type === 'webhook'
                ? [{ type: 'webhook' }]
                : values.action_type === 'document_metadata'
                  ? [
                      {
                        type: 'document_metadata',
                        name: values.metadata_name,
                        value: values.metadata_value,
                      },
                    ]
                  : values.action_type === 'create_task'
                    ? [
                        {
                          type: 'create_task',
                          title: values.action_message || 'Revisar documento',
                          assigned_to: 'owner',
                        },
                      ]
                    : values.action_type === 'request_nom151'
                      ? [{ type: 'request_nom151' }]
                      : [
                          {
                            type: 'notify',
                            target: 'owner',
                            title: values.action_message || undefined,
                            channels: [values.notification_channel || 'in_app'],
                            delivery_policy: 'single',
                          },
                        ],
        };
      if (section === 'negociacion')
        body = {
          workspace_id: activeWorkspace.id,
          space_id: values.space_id || null,
          document_id: values.document_id,
          clause_reference: values.clause_reference,
          original_text: values.original_text || null,
          requested_change: values.requested_change,
          internal_position: values.internal_position || null,
        };
      if (section === 'comites')
        body = {
          workspace_id: activeWorkspace.id,
          space_id: values.space_id || null,
          name: values.name,
          purpose: values.description || null,
          scheduled_at: values.scheduled_at
            ? new Date(String(values.scheduled_at)).toISOString()
            : null,
          quorum_minimum: Number(values.quorum_minimum || 1),
          first_agenda_item: values.first_agenda_item,
        };
      if (section === 'cierres')
        body = {
          workspace_id: activeWorkspace.id,
          space_id: values.space_id || null,
          name: values.name,
          conditions: [values.first_condition],
        };
      const path =
        section === 'tareas'
          ? '/api/colabora/tasks'
          : `/api/colabora/resources/${definition.resource}`;
      const result = await api<{
        one_time_credentials?: Array<{ path?: string; token?: string; delivery_status?: string }>;
        data?: { invitation_status?: string };
      }>(path, { method: 'POST', body: JSON.stringify(body) });
      saved();
      setCreatedInvitationStatus(
        result.data?.invitation_status || result.one_time_credentials?.[0]?.delivery_status || ''
      );
      const credential = result.one_time_credentials?.[0];
      if (['solicitudes', 'salas'].includes(section) && credential?.path) {
        setCreatedLink(`${window.location.origin}${credential.path}`);
        return;
      }
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo crear el recurso.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <dialog
      ref={createDialog}
      aria-label={`Crear ${definition.singular}`}
      className="colabora-create-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) close();
      }}
    >
      <div className="relative h-full w-full max-w-lg overflow-y-auto border-l border-border bg-background shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background px-6 py-5">
          <div>
            <p className="text-xs font-medium uppercase text-primary">Nuevo recurso</p>
            <h2 className="mt-1 text-xl font-medium text-foreground">
              Crear {definition.singular}
            </h2>
          </div>
          <button
            onClick={close}
            className="grid h-9 w-9 place-items-center rounded-md border border-border text-muted-foreground hover:bg-muted"
          >
            <X size={18} />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-5 p-6">
          {createdLink && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm font-medium text-emerald-800">
                {section === 'salas' ? 'Sala e invitacion creadas' : 'Solicitud creada'}
              </p>
              <p className="mt-1 text-xs leading-5 text-emerald-700">
                {createdInvitationStatus === 'sent'
                  ? 'La invitación se envió al correo del destinatario.'
                  : createdInvitationStatus === 'failed'
                    ? 'La solicitud se guardó, pero no se pudo enviar el correo. Comparte este enlace o reintenta desde el detalle.'
                    : 'Puedes compartir este enlace o enviar una invitación desde el detalle.'}
              </p>
              <div className="mt-3 flex gap-2">
                <input
                  readOnly
                  value={createdLink}
                  className="h-10 min-w-0 flex-1 rounded-md border border-emerald-200 bg-white px-3 text-xs"
                />
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(createdLink)}
                  className="h-10 rounded-md border border-emerald-300 bg-white px-3 text-xs font-medium text-emerald-800"
                >
                  Copiar
                </button>
              </div>
            </div>
          )}
          {section !== 'negociacion' && (
            <label className="block text-sm font-medium text-foreground">
              {section === 'solicitudes'
                ? 'Titulo de la solicitud'
                : section === 'calendario'
                  ? 'Nombre del hito'
                  : section === 'revisiones'
                    ? 'Nombre de la ronda'
                    : 'Nombre'}
              <input
                required
                name={
                  ['tareas', 'calendario', 'solicitudes', 'revisiones'].includes(section)
                    ? 'title'
                    : 'name'
                }
                className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary"
              />
            </label>
          )}
          {!['salas', 'revisiones', 'negociacion', 'cierres'].includes(section) && (
            <label className="block text-sm font-medium text-foreground">
              Descripcion
              <textarea
                name="description"
                rows={4}
                className="mt-2 w-full rounded-md border border-border bg-background p-3 text-sm outline-none focus:border-primary"
              />
            </label>
          )}
          {section === 'revisiones' && (
            <>
              <label className="block text-sm font-medium">
                Version documental
                <select
                  required
                  name="document_version_id"
                  className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                >
                  <option value="">Seleccionar version</option>
                  {reviewVersions
                    .filter((version) => !['sent', 'signed', 'obsolete'].includes(version.status))
                    .map((version) => {
                      const document = Array.isArray(version.documentos)
                        ? version.documentos[0]
                        : version.documentos;
                      return (
                        <option key={version.id} value={version.id}>
                          {document?.nombre || document?.documento_id || version.document_id} - v
                          {version.version_number}
                        </option>
                      );
                    })}
                </select>
              </label>
              <label className="block text-sm font-medium">
                Revisores
                <select
                  required
                  multiple
                  name="reviewer_ids"
                  aria-label="Revisores"
                  className="mt-2 min-h-28 w-full rounded-md border border-border bg-background px-3 py-2"
                >
                  {members.map((member) => {
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
                <span className="mt-1 block text-xs font-normal text-muted-foreground">
                  Puedes seleccionar a varios miembros de la organización.
                </span>
              </label>
              <label className="block text-sm font-medium">
                Vencimiento
                <input
                  name="due_at"
                  type="datetime-local"
                  className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                />
              </label>
            </>
          )}
          {section === 'tareas' && (
            <>
              <label className="block text-sm font-medium">
                Responsable
                <select
                  name="assigned_to"
                  className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                >
                  <option value="">Sin asignar</option>
                  {members.map((member) => {
                    const profile = Array.isArray(member.user_profiles)
                      ? member.user_profiles[0]
                      : member.user_profiles;
                    return (
                      <option key={member.user_id} value={member.user_id}>
                        {profile?.full_name || profile?.email || member.user_id} - {member.role}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label className="block text-sm font-medium">
                Prioridad
                <select
                  name="prioridad"
                  className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                >
                  <option value="media">Media</option>
                  <option value="alta">Alta</option>
                  <option value="critica">Critica</option>
                  <option value="baja">Baja</option>
                </select>
              </label>
              <label className="block text-sm font-medium">
                Vencimiento
                <input
                  name="due_date"
                  type="datetime-local"
                  className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                />
              </label>
            </>
          )}
          {section === 'espacios' && (
            <label className="block text-sm font-medium">
              Tipo
              <select
                name="space_type"
                className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
              >
                <option value="project">Proyecto</option>
                <option value="client">Cliente</option>
                <option value="operation">Operacion</option>
                <option value="contract">Contrato</option>
              </select>
            </label>
          )}
          {section === 'calendario' && (
            <>
              <SpaceSelect spaces={spaces} />
              <label className="block text-sm font-medium">
                Vencimiento
                <input
                  required
                  name="due_at"
                  type="datetime-local"
                  className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                />
              </label>
            </>
          )}
          {section === 'solicitudes' && (
            <>
              <SpaceSelect spaces={spaces} />
              <label className="block text-sm font-medium">
                Destinatario
                <input
                  required
                  name="recipient_name"
                  className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                />
              </label>
              <label className="block text-sm font-medium">
                Correo
                <input
                  required
                  type="email"
                  name="recipient_email"
                  className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                />
              </label>
              <label className="block text-sm font-medium">
                Vencimiento
                <input
                  name="due_at"
                  type="datetime-local"
                  className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                />
              </label>
              <RequestItemsEditor
                key={String(activeWorkspace?.id)}
                initialFormId={searchParams.get('form_id') || ''}
              />
              <label className="block text-sm font-medium">
                Responsable de la solicitud
                <select
                  name="responsible_user_id"
                  className="mt-2 h-10 w-full rounded-md border border-border bg-background px-3"
                >
                  <option value="">Quien crea la solicitud</option>
                  {members.map((member) => {
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
                <span className="mt-1 block text-xs font-normal text-muted-foreground">
                  Recibirá el aviso cuando las entregas estén listas para revisar.
                </span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="send_invitation" defaultChecked />
                Enviar invitación al destinatario por correo
              </label>
            </>
          )}
          {section === 'salas' && (
            <>
              <SpaceSelect spaces={spaces} />
              <label className="block text-sm font-medium">
                Proposito
                <textarea
                  name="purpose"
                  rows={3}
                  className="mt-2 w-full rounded-md border border-border bg-background p-3"
                />
              </label>
              <label className="block text-sm font-medium">
                Expira
                <input
                  required
                  name="expires_at"
                  type="datetime-local"
                  className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm font-medium">
                  Invitado
                  <input
                    name="guest_name"
                    className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                  />
                </label>
                <label className="block text-sm font-medium">
                  Correo
                  <input
                    type="email"
                    name="guest_email"
                    className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                  />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="send_invitation" defaultChecked />
                Enviar invitación por correo
              </label>
            </>
          )}
          {section === 'automatizaciones' && (
            <div className="space-y-4">
              <label className="block text-sm font-medium">
                CUANDO
                <select
                  name="trigger_event"
                  className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                >
                  <option value="document.sent">Documento enviado</option>
                  <option value="participant.completion_committed">
                    Participante completó su acción
                  </option>
                  <option value="document.completed">Documento completado</option>
                  <option value="document.cancelled">Documento cancelado</option>
                  <option value="document.expired">Documento vencido</option>
                </select>
              </label>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block text-sm font-medium">
                  SI (opcional)
                  <select
                    name="condition_field"
                    className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                  >
                    <option value="">Sin condición</option>
                    <option value="document.status">Estado del documento</option>
                    <option value="document.type_id">Tipo de documento</option>
                    <option value="metadata.classification">Metadata: classification</option>
                    <option value="package.status">Estado del paquete</option>
                  </select>
                </label>
                <label className="block text-sm font-medium">
                  Operador
                  <select
                    name="condition_operator"
                    className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                  >
                    <option value="equals">Es igual a</option>
                    <option value="not_equals">No es igual a</option>
                    <option value="exists">Existe</option>
                    <option value="not_exists">No existe</option>
                    <option value="contains">Contiene</option>
                  </select>
                </label>
                <label className="block text-sm font-medium">
                  Valor
                  <input
                    name="condition_value"
                    className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                  />
                </label>
              </div>
              <label className="block text-sm font-medium">
                ENTONCES
                <select
                  name="action_type"
                  className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                >
                  <option value="notify">Notificar</option>
                  <option value="activity">Registrar actividad</option>
                  <option value="webhook">Enviar webhook</option>
                  <option value="document_metadata">Asignar metadata de gestión</option>
                  <option value="create_task">Crear tarea</option>
                  <option value="request_nom151">Solicitar NOM-151</option>
                </select>
              </label>
              <label className="block text-sm font-medium">
                Mensaje o título
                <input
                  name="action_message"
                  maxLength={180}
                  className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium">
                  Canal de notificación
                  <select
                    name="notification_channel"
                    className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                  >
                    <option value="in_app">Docubox</option>
                    <option value="email">Correo electrónico</option>
                    <option value="sms">SMS</option>
                  </select>
                </label>
                <label className="block text-sm font-medium">
                  Nombre de metadata
                  <input
                    name="metadata_name"
                    maxLength={120}
                    className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                  />
                </label>
              </div>
              <label className="block text-sm font-medium">
                Valor de metadata
                <input
                  name="metadata_value"
                  maxLength={2000}
                  className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                />
              </label>
            </div>
          )}
          {section === 'negociacion' && (
            <>
              <SpaceSelect spaces={spaces} />
              <label className="block text-sm font-medium">
                Documento
                <select
                  required
                  name="document_id"
                  className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                >
                  <option value="">Seleccionar documento</option>
                  {documents.map((document) => (
                    <option key={document.id} value={document.id}>
                      {document.nombre} · {document.estado}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium">
                Referencia de clausula
                <input
                  required
                  name="clause_reference"
                  placeholder="Ej. 4.2 Vigencia"
                  className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                />
              </label>
              <label className="block text-sm font-medium">
                Texto original
                <textarea
                  name="original_text"
                  rows={3}
                  className="mt-2 w-full rounded-md border border-border bg-background p-3"
                />
              </label>
              <label className="block text-sm font-medium">
                Cambio solicitado
                <textarea
                  required
                  name="requested_change"
                  rows={4}
                  className="mt-2 w-full rounded-md border border-border bg-background p-3"
                />
              </label>
              <label className="block text-sm font-medium">
                Posicion interna
                <textarea
                  name="internal_position"
                  rows={3}
                  className="mt-2 w-full rounded-md border border-border bg-background p-3"
                />
              </label>
            </>
          )}
          {section === 'comites' && (
            <>
              <SpaceSelect spaces={spaces} />
              <label className="block text-sm font-medium">
                Fecha de sesion
                <input
                  name="scheduled_at"
                  type="datetime-local"
                  className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                />
              </label>
              <label className="block text-sm font-medium">
                Quorum minimo
                <input
                  required
                  name="quorum_minimum"
                  type="number"
                  min={1}
                  defaultValue={1}
                  className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                />
              </label>
              <label className="block text-sm font-medium">
                Primer punto de agenda
                <input
                  required
                  name="first_agenda_item"
                  className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                />
              </label>
            </>
          )}
          {section === 'cierres' && (
            <>
              <SpaceSelect spaces={spaces} />
              <label className="block text-sm font-medium">
                Primera condicion de cierre
                <textarea
                  required
                  name="first_condition"
                  rows={3}
                  className="mt-2 w-full rounded-md border border-border bg-background p-3"
                />
              </label>
            </>
          )}
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2 border-t border-border pt-5">
            <button
              type="button"
              onClick={close}
              className="h-10 rounded-md border border-border px-4 text-sm"
            >
              Cancelar
            </button>
            <button
              disabled={saving || Boolean(createdLink)}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white disabled:opacity-60"
            >
              {saving && <Loader2 size={15} className="animate-spin" />} Crear
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}

function SpaceSelect({ spaces }: { spaces: Array<{ id: string; name: string }> }) {
  return (
    <label className="block text-sm font-medium">
      Espacio relacionado
      <select
        name="space_id"
        className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
      >
        <option value="">Sin espacio</option>
        {spaces.map((space) => (
          <option key={space.id} value={space.id}>
            {space.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function ColaboraSectionPage() {
  const section = String(useParams<{ section: string }>().section || '');
  const { activeWorkspace } = useWorkspace();
  return <ColaboraSection key={`${section}:${activeWorkspace?.id || ''}`} section={section} />;
}
function ColaboraSection({ section }: { section: string }) {
  const definition = sections[section];
  const resource = definition?.resource;
  const searchParams = useSearchParams();
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id;
  const { access, can } = useCollaboration();
  const api = useCollaborationApi();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [createOpen, setCreateOpen] = useState(searchParams.get('new') === '1');
  const [workingRow, setWorkingRow] = useState('');
  const [selectedTasks, setSelectedTasks] = useState<string[]>([]);
  const [taskSort, setTaskSort] = useState<{ key: string; direction: ListDirection } | null>(null);
  const [bulkNotice, setBulkNotice] = useState('');
  const [taskPage, setTaskPage] = useState(1),
    [taskTotal, setTaskTotal] = useState(0),
    [taskPriority, setTaskPriority] = useState(''),
    [taskDue, setTaskDue] = useState(''),
    [taskMine, setTaskMine] = useState(false),
    [taskSearch, setTaskSearch] = useState('');
  useEffect(() => {
    if (section !== 'tareas') return;
    const timer = setTimeout(() => {
      setTaskSearch(search);
      setTaskPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, section]);
  const selectable = section === 'tareas' && (can('tasks.edit', true) || can('tasks.assign', true));
  const hasActions = Boolean(definition?.detail) || ['calendario', 'actividad'].includes(section);
  const proEntitlement = collaborationSectionEntitlements[section];
  const proAvailable =
    !proEntitlement ||
    hasCollaborationEntitlement(access, proEntitlement, {
      proFeature: true,
    });

  const markActivityRead = async () => {
    if (!workspaceId) return;
    try {
      await api('/api/colabora/activity', {
        method: 'PATCH',
        body: JSON.stringify({ workspace_id: workspaceId, action: 'mark_read' }),
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar la actividad.');
    }
  };
  const completeMilestone = async (id: string) => {
    if (!workspaceId) return;
    setWorkingRow(id);
    setError('');
    try {
      await api(`/api/colabora/milestones/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ workspace_id: workspaceId, action: 'complete' }),
      });
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo completar el hito.');
    } finally {
      setWorkingRow('');
    }
  };

  const [refreshKey, setRefreshKey] = useState(0);
  const load = () => setRefreshKey((value) => value + 1);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      if (!workspaceId || !resource || !proAvailable) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError('');
      try {
        const path =
          resource === 'tasks'
            ? '/api/colabora/tasks'
            : section === 'calendario'
              ? '/api/colabora/calendar'
              : '/api/colabora/resources/' + resource;
        const taskParams = new URLSearchParams({
          page: String(taskPage),
          page_size: String(DEFAULT_TABLE_PAGE_SIZE),
        });
        if (taskPriority) taskParams.set('priority', taskPriority);
        if (taskDue) taskParams.set('due', taskDue);
        if (taskMine) taskParams.set('mine', '1');
        if (taskSearch) taskParams.set('search', taskSearch);
        if (taskSort) {
          taskParams.set('sort', taskSort.key);
          taskParams.set('direction', taskSort.direction);
        }
        const payload = await api<{ data: Row[]; total?: number }>(
          path +
            '?workspace_id=' +
            workspaceId +
            (status ? '&status=' + encodeURIComponent(status) : '') +
            (resource === 'tasks' ? '&' + taskParams.toString() : '')
        );
        if (active) {
          setRows(payload.data);
          if (resource === 'tasks') setTaskTotal(payload.total ?? payload.data.length);
        }
      } catch (cause) {
        if (active)
          setError(cause instanceof Error ? cause.message : 'No se pudo cargar la información.');
      } finally {
        if (active) setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [
    workspaceId,
    api,
    resource,
    proAvailable,
    section,
    status,
    refreshKey,
    taskPage,
    taskPriority,
    taskDue,
    taskMine,
    taskSearch,
    taskSort,
  ]);
  const filtered = useMemo(
    () =>
      !search
        ? rows
        : rows.filter((row) => JSON.stringify(row).toLowerCase().includes(search.toLowerCase())),
    [rows, search]
  );
  const { orderedRows, sortHeading } = useTableOrdering(filtered, Object.fromEntries(
    (resource === 'tasks' ? [] : definition?.columns ?? []).map(({ key }) => [key, (row: Row) => {
      const value = row[key];
      if (value == null || value === '') return null;
      if (isDateColumn(key)) return tableDate(String(value));
      return typeof value === 'number' ? value : display(value, key);
    }])
  ));
  const pagination = useTablePagination(orderedRows.length, JSON.stringify([resource, search]));
  const pageRows = orderedRows.slice(pagination.start, pagination.end);
  const selectableRows = pageRows.slice(0, 25);
  const selectedItems = filtered
    .filter((row) => selectedTasks.includes(row.id))
    .map((row) => ({
      id: row.id,
      title: String(row.title || ''),
      optimistic_version: Number(row.optimistic_version),
    }));
  if (!definition)
    return (
      <div className="rounded-lg border border-border bg-background p-8">
        <h1 className="text-xl font-medium">Seccion no disponible</h1>
      </div>
    );
  if (!proAvailable) {
    const canManagePlan =
      access.canManageSubscription ||
      access.membershipRole === 'owner' ||
      access.permissions.includes('subscription.manage_addons');
    return (
      <div className="mx-auto grid min-h-[520px] max-w-[920px] place-items-center">
        <section className="w-full overflow-hidden rounded-lg border border-border bg-background">
          <div className="border-b border-border p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
              <LockKeyhole size={20} />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-medium text-foreground">{definition.title}</h2>
              <span className="rounded border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                PRO
              </span>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Función no disponible en el plan actual. Contacta a tu administrador.
            </p>
          </div>
          {canManagePlan && (
            <div className="flex items-center justify-between gap-4 p-5">
              <p className="text-sm text-muted-foreground">
                Actualiza a Colabora Pro para habilitar esta capacidad.
              </p>
              <Link
                href="/app-market"
                className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-white"
              >
                Actualizar a Pro
              </Link>
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="app-page-width space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-medium text-foreground">{definition.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{definition.description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {section === 'actividad' && (
            <button
              onClick={markActivityRead}
              className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-medium text-foreground"
            >
              Marcar como leido
            </button>
          )}
          {definition.createPermission && can(definition.createPermission, true) && (
            <button
              onClick={() => setCreateOpen(true)}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white"
            >
              <Plus size={16} /> Crear {definition.singular}
            </button>
          )}
        </div>
      </div>
      <section className="overflow-hidden rounded-lg border border-border bg-background">
        {bulkNotice && <BottomNotice message={bulkNotice} tone="success" onClose={() => setBulkNotice('')} />}
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row">
          <label className="relative flex-1">
            <Search className="absolute left-3 top-3 text-muted-foreground" size={17} />
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setSelectedTasks([]);
              }}
              placeholder={`Buscar en ${definition.title.toLowerCase()}...`}
              className="h-10 w-full rounded-md border border-border bg-background pl-10 pr-3 text-sm outline-none focus:border-primary"
            />
          </label>
          {section !== 'actividad' && (
            <label className="relative sm:w-52">
              <Filter className="absolute left-3 top-3 text-muted-foreground" size={16} />
              <select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setTaskPage(1);
                  setSelectedTasks([]);
                }}
                className="h-10 w-full appearance-none rounded-md border border-border bg-background pl-10 pr-3 text-sm"
              >
                <option value="">Todos los estados</option>
                {[
                  ...new Set([
                    ...(collaborationStatusOptions[section] || []),
                    ...rows.map((row) => String(row.status || row.estado || '')).filter(Boolean),
                  ]),
                ].map((value) => (
                  <option key={value} value={value}>
                    {collaborationLabels[value] || value.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {section === 'tareas' && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/20 px-4 py-3">
            <select
              aria-label="Filtrar prioridad de tareas"
              value={taskPriority}
              onChange={(e) => {
                setTaskPriority(e.target.value);
                setTaskPage(1);
                setSelectedTasks([]);
              }}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="">Todas las prioridades</option>
              <option value="critica">Crítica</option>
              <option value="alta">Alta</option>
              <option value="media">Normal</option>
              <option value="baja">Baja</option>
            </select>
            <select
              aria-label="Filtrar vencimiento de tareas"
              value={taskDue}
              onChange={(e) => {
                setTaskDue(e.target.value);
                setTaskPage(1);
                setSelectedTasks([]);
              }}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="">Cualquier vencimiento</option>
              <option value="overdue">Vencidas</option>
              <option value="soon">Por vencer (72 h)</option>
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={taskMine}
                onChange={(e) => {
                  setTaskMine(e.target.checked);
                  setTaskPage(1);
                  setSelectedTasks([]);
                }}
              />
              Asignadas a mí
            </label>
          </div>
        )}
        {selectable && workspaceId && selectedItems.length > 0 && (
          <BulkTaskActions
            workspaceId={workspaceId}
            items={selectedItems}
            finished={(message) => {
              setBulkNotice(message);
              setSelectedTasks([]);
              load();
            }}
          />
        )}
        {error ? (
          <div className="m-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <AlertCircle size={17} className="mb-2" />
            {error}
          </div>
        ) : loading ? (
          <div className="grid min-h-64 place-items-center">
            <Loader2 className="animate-spin text-primary" size={22} />
          </div>
        ) : filtered.length ? (
          <TableScrollArea
            label={`Tabla de ${definition.title.toLocaleLowerCase('es-MX')}`}
            footer={<TablePagination {...pagination} />}
          >
            <table className="w-full min-w-[760px] text-left">
              <thead className="workspace-table-heading">
                <tr>
                  {selectable && (
                    <th className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label="Seleccionar hasta 25 tareas de esta página"
                        checked={
                          selectableRows.every((row) => selectedTasks.includes(row.id))
                        }
                        onChange={(e) =>
                          setSelectedTasks(
                            e.target.checked ? selectableRows.map((row) => row.id) : []
                          )
                        }
                      />
                    </th>
                  )}
                  {definition.columns.map(({ key, label }) => {
                    if (resource !== 'tasks') return (
                      <th key={key} className="px-5 py-3" {...sortHeading(key, label, isDateColumn(key) ? 'desc' : 'asc')} />
                    );
                    if (key === 'prioridad') return <th key={key} scope="col" className="px-5 py-3">{label}</th>;
                    const direction = taskSort?.key === key ? taskSort.direction : undefined;
                    return (
                      <th key={key} scope="col" className="px-5 py-3" aria-sort={tableAriaSort(direction)}>
                        <TableSortButton
                          label={label}
                          direction={direction}
                          onSort={(direction) => {
                            setTaskSort({ key, direction });
                            setTaskPage(1);
                            setSelectedTasks([]);
                          }}
                        />
                      </th>
                    );
                  })}
                  {hasActions && (
                    <th scope="col" className="workspace-table-actions py-3">
                      Acciones
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pageRows.map((row) => (
                  <tr key={row.id} className="hover:bg-muted/30">
                    {selectable && (
                      <td className="px-4 py-3.5">
                        <input
                          type="checkbox"
                          aria-label={`Seleccionar tarea ${row.title || row.id}`}
                          checked={selectedTasks.includes(row.id)}
                          disabled={selectedItems.length >= 25 && !selectedTasks.includes(row.id)}
                          onChange={(e) =>
                            setSelectedTasks((ids) =>
                              e.target.checked
                                ? [...ids, row.id]
                                : ids.filter((id) => id !== row.id)
                            )
                          }
                        />
                      </td>
                    )}
                    {definition.columns.map((column, index) => (
                      <td
                        key={column.key}
                        className={`px-5 py-3.5 text-sm ${index === 0 ? 'font-medium text-foreground' : 'text-muted-foreground'}`}
                      >
                        {['status', 'estado', 'prioridad', 'confidentiality'].includes(
                          column.key
                        ) ? (
                          <span
                            className={`inline-flex rounded-full border px-2 py-0.5 text-xs capitalize ${statusClass(row[column.key])}`}
                          >
                            {display(row[column.key], column.key)}
                          </span>
                        ) : (
                          display(row[column.key], column.key)
                        )}
                      </td>
                    ))}
                    {hasActions && (
                      <td className="workspace-table-actions py-3.5">
                        <div className="flex items-center justify-center gap-2">
                          {section === 'calendario' &&
                            row.source_type === 'milestone' &&
                            !['completed', 'cancelled'].includes(String(row.status)) &&
                            can('collaboration_spaces.create', true) && (
                              <button
                                disabled={Boolean(workingRow)}
                                onClick={() => completeMilestone(row.id)}
                                aria-label={`Completar hito ${row.title}`}
                                className="colabora-icon-button text-primary"
                              >
                                {workingRow === row.id ? (
                                  <Loader2 size={15} className="animate-spin" />
                                ) : (
                                  <Check size={15} />
                                )}
                              </button>
                            )}
                          {rowLink(section, row, definition.detail) && (
                            <Link
                              href={rowLink(section, row, definition.detail)!}
                              aria-label="Abrir"
                              className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-primary"
                            >
                              <ArrowRight size={16} />
                            </Link>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScrollArea>
        ) : (
          <div className="px-5 py-20 text-center">
            <CalendarDays size={28} className="mx-auto text-muted-foreground/60" />
            <p className="mt-3 text-sm font-medium text-foreground">
              No hay {definition.title.toLowerCase()}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Los elementos autorizados aparecerán aquí.
            </p>
          </div>
        )}
      </section>
      {section === 'tareas' && shouldShowTablePagination(taskTotal) && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>
            {taskTotal} tareas · Página {taskPage} de{' '}
            {Math.max(1, Math.ceil(taskTotal / DEFAULT_TABLE_PAGE_SIZE))}
          </span>
          <div className="flex gap-2">
            <button
              disabled={loading || taskPage <= 1}
              onClick={() => {
                setSelectedTasks([]);
                setTaskPage((value) => value - 1);
              }}
              className="h-9 rounded-md border border-border bg-background px-3 disabled:opacity-40"
            >
              Anterior
            </button>
            <button
              disabled={loading || taskPage * DEFAULT_TABLE_PAGE_SIZE >= taskTotal}
              onClick={() => {
                setSelectedTasks([]);
                setTaskPage((value) => value + 1);
              }}
              className="h-9 rounded-md border border-border bg-background px-3 disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
      {createOpen && (
        <CreatePanel section={section} close={() => setCreateOpen(false)} saved={load} />
      )}
    </div>
  );
}
