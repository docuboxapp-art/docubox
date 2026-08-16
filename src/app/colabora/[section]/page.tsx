'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
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

type Row = Record<string, unknown> & { id: string };

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
  return String(value).replaceAll('_', ' ');
}

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
  const { activeWorkspace } = useWorkspace();
  const api = useCollaborationApi();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [createdLink, setCreatedLink] = useState('');
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
    const needsMembers = ['tareas', 'revisiones'].includes(section);
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
        ? api<{ data: { members: typeof members } }>(
            `/api/colabora/overview?workspace_id=${activeWorkspace.id}`
          )
        : Promise.resolve({ data: { members: [] as typeof members } }),
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
        setMembers(overview.data.members || []);
        setReviewVersions(versions.data || []);
        setSpaces(spaceResult.data || []);
        setDocuments(documentResult.data || []);
      })
      .catch(() => {
        setMembers([]);
        setReviewVersions([]);
        setSpaces([]);
        setDocuments([]);
      });
  }, [activeWorkspace?.id, api, section]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeWorkspace?.id) return;
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
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
          reviewer_ids: [values.reviewer_id],
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
          recipient_email: values.recipient_email,
          space_id: values.space_id || null,
          due_at: values.due_at ? new Date(String(values.due_at)).toISOString() : null,
          items: [
            {
              item_type: values.item_type || 'document',
              title: values.item_title,
              description: values.item_description || null,
              required: true,
            },
          ],
        };
      if (section === 'salas')
        body = {
          ...body,
          room_type: 'counterparty',
          expires_at: new Date(String(values.expires_at)).toISOString(),
          otp_required: true,
          downloads_allowed: false,
          watermark_enabled: true,
          guests: values.guest_email
            ? [{ name: values.guest_name, email: values.guest_email }]
            : [],
        };
      if (section === 'automatizaciones')
        body = {
          ...body,
          trigger_definition: { event: values.trigger_event || 'task.created' },
          conditions: [],
          actions: [{ type: 'notify', target: 'owner' }],
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
        one_time_credentials?: Array<{ path?: string; token?: string }>;
      }>(path, { method: 'POST', body: JSON.stringify(body) });
      saved();
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
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/30"
      role="dialog"
      aria-modal="true"
    >
      <button aria-label="Cerrar" className="absolute inset-0 cursor-default" onClick={close} />
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
                {section === 'salas' ? 'Sala e invitacion creadas' : 'Solicitud creada y enviada'}
              </p>
              <p className="mt-1 text-xs leading-5 text-emerald-700">
                Conserva este enlace. Por seguridad, solo se muestra en este momento.
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
                Revisor principal
                <select
                  required
                  name="reviewer_id"
                  className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                >
                  <option value="">Seleccionar revisor</option>
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
              <div className="border-t border-border pt-5">
                <p className="text-sm font-medium text-foreground">Primer requisito</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Podras ampliar el checklist desde el detalle de la solicitud.
                </p>
              </div>
              <label className="block text-sm font-medium">
                Tipo de requisito
                <select
                  name="item_type"
                  className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                >
                  <option value="document">Documento</option>
                  <option value="form">Formulario</option>
                  <option value="identity">Identidad</option>
                  <option value="signature">Firma</option>
                </select>
              </label>
              <label className="block text-sm font-medium">
                Nombre del requisito
                <input
                  required
                  name="item_title"
                  placeholder="Ej. Constancia de situacion fiscal"
                  className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                />
              </label>
              <label className="block text-sm font-medium">
                Indicaciones
                <textarea
                  name="item_description"
                  rows={3}
                  className="mt-2 w-full rounded-md border border-border bg-background p-3 text-sm"
                />
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
            </>
          )}
          {section === 'automatizaciones' && (
            <label className="block text-sm font-medium">
              Evento
              <select
                name="trigger_event"
                className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
              >
                <option value="task.created">Tarea creada</option>
                <option value="review.approved">Revision aprobada</option>
                <option value="request.completed">Solicitud completada</option>
              </select>
            </label>
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
    </div>
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
  const definition = sections[section];
  const searchParams = useSearchParams();
  const { activeWorkspace } = useWorkspace();
  const { access, can } = useCollaboration();
  const api = useCollaborationApi();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [createOpen, setCreateOpen] = useState(searchParams.get('new') === '1');
  const proEntitlement = collaborationSectionEntitlements[section];
  const proAvailable = !proEntitlement || hasCollaborationEntitlement(access, proEntitlement, {
    proFeature: true,
  });

  const markActivityRead = async () => {
    if (!activeWorkspace?.id) return;
    try {
      await api('/api/colabora/activity', {
        method: 'PATCH',
        body: JSON.stringify({ workspace_id: activeWorkspace.id, action: 'mark_read' }),
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar la actividad.');
    }
  };

  const load = useCallback(async () => {
    if (!activeWorkspace?.id || !definition || !proAvailable) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const path =
        definition.resource === 'tasks'
          ? '/api/colabora/tasks'
          : section === 'calendario'
            ? '/api/colabora/calendar'
            : `/api/colabora/resources/${definition.resource}`;
      const payload = await api<{ data: Row[] }>(
        `${path}?workspace_id=${activeWorkspace.id}${status ? `&status=${status}` : ''}`
      );
      setRows(payload.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar la informacion.');
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace?.id, api, definition, proAvailable, status]);

  useEffect(() => {
    load();
  }, [load]);
  const filtered = useMemo(
    () =>
      !search
        ? rows
        : rows.filter((row) => JSON.stringify(row).toLowerCase().includes(search.toLowerCase())),
    [rows, search]
  );
  if (!definition)
    return (
      <div className="rounded-lg border border-border bg-background p-8">
        <h1 className="text-xl font-medium">Seccion no disponible</h1>
      </div>
    );
  if (!proAvailable) {
    const canManagePlan = access.canManageSubscription
      || access.membershipRole === 'owner'
      || access.permissions.includes('subscription.manage_addons');
    return (
      <div className="mx-auto grid min-h-[520px] max-w-[920px] place-items-center">
        <section className="w-full overflow-hidden rounded-lg border border-border bg-background">
          <div className="border-b border-border p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
              <LockKeyhole size={20} />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-medium text-foreground">{definition.title}</h2>
              <span className="rounded border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">PRO</span>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Función no disponible en el plan actual. Contacta a tu administrador.
            </p>
          </div>
          {canManagePlan && (
            <div className="flex items-center justify-between gap-4 p-5">
              <p className="text-sm text-muted-foreground">Actualiza a Colabora Pro para habilitar esta capacidad.</p>
              <Link href="/app-market" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-white">
                Actualizar a Pro
              </Link>
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
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
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row">
          <label className="relative flex-1">
            <Search className="absolute left-3 top-3 text-muted-foreground" size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`Buscar en ${definition.title.toLowerCase()}...`}
              className="h-10 w-full rounded-md border border-border bg-background pl-10 pr-3 text-sm outline-none focus:border-primary"
            />
          </label>
          <label className="relative sm:w-52">
            <Filter className="absolute left-3 top-3 text-muted-foreground" size={16} />
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="h-10 w-full appearance-none rounded-md border border-border bg-background pl-10 pr-3 text-sm"
            >
              <option value="">Todos los estados</option>
              <option value="active">Activo</option>
              <option value="draft">Borrador</option>
              <option value="pending">Pendiente</option>
              <option value="completed">Completado</option>
            </select>
          </label>
        </div>
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  {definition.columns.map((column) => (
                    <th key={column.key} className="px-5 py-3 font-medium">
                      {column.label}
                    </th>
                  ))}
                  {definition.detail && <th className="w-14 px-5 py-3" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((row) => (
                  <tr key={row.id} className="hover:bg-muted/30">
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
                    {definition.detail && (
                      <td className="px-5 py-3.5">
                        <Link
                          href={
                            section === 'revisiones'
                              ? `/documentos/${row.document_id}/revision`
                              : `${definition.detail}/${row.id}`
                          }
                          aria-label="Abrir"
                          className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-primary"
                        >
                          <ArrowRight size={16} />
                        </Link>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
      {createOpen && (
        <CreatePanel section={section} close={() => setCreateOpen(false)} saved={load} />
      )}
    </div>
  );
}
