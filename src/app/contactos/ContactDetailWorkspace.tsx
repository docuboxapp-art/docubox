'use client';

import { PaginatedTableScrollArea } from '@/components/workspaces/TableScrollArea';
import { BottomNotice } from '@/components/ui/BottomNotice';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  Bell,
  CheckCircle2,
  ClipboardList,
  Clock3,
  ExternalLink,
  FileText,
  FolderClosed,
  Link2,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  Search,
  Send,
  Star,
  Tag,
  Trash2,
  UserRound,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { CatalogColorPicker } from '@/components/catalog/CatalogColorPicker';
import {
  builtInCatalog,
  catalogKey,
  catalogVisibilityKey,
  contactTagColor,
  contactTagGroups,
  splitContactTag,
} from '@/lib/catalog/classification';
import { savePersonalCatalogEntry, usePersonalCatalog } from '@/lib/catalog/client';
import { ProfileCommunicationDialog } from '@/components/profiles/ProfileCommunication';
import { TableSortHeading } from '@/components/workspaces/TableSortButton';
import { useTableOrdering } from '@/components/workspaces/useTableOrdering';
import { compareListDates, compareTableValues, tableDate } from '@/lib/workspaces/list-order';
import { profilePrivacy } from '@/lib/profile-privacy/client';
import type { SharedProfile } from '@/lib/profile-privacy/model';
import { useAuth } from '@/contexts/AuthContext';
import { useAppModules } from '@/contexts/AppModulesContext';
import { getDocumentStatusConfig, getParticipationStatusConfig } from '@/lib/documentStatusConfig';
import {
  CONTACT_FIELD_COLUMNS,
  type ContactFieldRow,
  type ContactResourceKind,
} from '@/lib/contacts/detail';
import {
  getContactParticipationStatus,
  isPendingContactParticipation,
  type ContactParticipationStatus,
} from '@/lib/contacts/document-participation';
import {
  canRemindDocumentParticipant,
  reminderAction,
  type ReminderParticipant,
} from '@/lib/contacts/document-reminders';
import type { ContactGroupChange, ContactGroups } from '@/lib/contacts/groups';
import {
  ContactCustomInformation,
  ContactRelationships,
  type RelatedContactOption,
} from './ContactExtraDetails';
import { ContactProfileHeader } from './ContactProfileHeader';
import { ContactResourcesPanel } from './ContactResourcesPanel';
import { ContactGroupsPanel } from './ContactGroupsPanel';
import { ContactReminderDialog, type ContactReminder } from './ContactReminderDialog';
import {
  ContactPanelHeading,
  ContactEditorDialog,
  contactButton,
  contactCard,
  contactControl,
} from './contact-detail-ui';

export interface DetailContact {
  id: string;
  nombre: string;
  apellido_paterno: string | null;
  apellido_materno: string | null;
  email: string | null;
  telefono: string | null;
  rfc: string | null;
  curp: string | null;
  tipo_persona?: string | null;
  direccion?: string | null;
  etiqueta_rol?: string | null;
  tags?: string[] | null;
  created_at: string;
}

type Tab =
  | 'resumen'
  | 'informacion'
  | 'documentos'
  | 'formularios'
  | 'expedientes'
  | 'identidad-documentacion'
  | 'actividad'
  | 'notas'
  | 'historial';
const tabs: { id: Tab; label: string; resourceKinds?: ContactResourceKind[] }[] = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'informacion', label: 'Información' },
  { id: 'documentos', label: 'Documentos' },
  { id: 'formularios', label: 'Formularios', resourceKinds: ['formularios'] },
  { id: 'expedientes', label: 'Expedientes', resourceKinds: ['expedientes'] },
  {
    id: 'identidad-documentacion',
    label: 'Identidad y documentación',
    resourceKinds: ['identidad', 'aportada'],
  },
  { id: 'actividad', label: 'Actividad' },
  { id: 'notas', label: 'Notas' },
  { id: 'historial', label: 'Historial' },
];
const documentStatuses = {
  todos: 'Todos',
  pendiente: 'Pendientes',
  sin_revisar: 'Sin revisar',
  en_revision: 'En revisión',
  en_espera: 'En espera',
  firmo: 'Firmados',
  aprobo: 'Aprobados',
  completado: 'Completados',
  rechazo: 'Rechazados',
  cancelo: 'Cancelados',
  revocado: 'Revocados',
  urgente_atencion: 'Urgente atención',
  participacion_vencida: 'Participación vencida',
  sin_accion: 'Sin acción',
} satisfies Record<ContactParticipationStatus | 'todos', string>;
const extraParticipationBadges: Partial<
  Record<ContactParticipationStatus, { label: string; badgeClass: string }>
> = {
  pendiente: {
    label: 'Pendiente',
    badgeClass: 'bg-amber-50 text-amber-700 border border-amber-200',
  },
  en_espera: getDocumentStatusConfig('en_espera'),
  completado: getDocumentStatusConfig('completado'),
  revocado: {
    label: 'Acceso revocado',
    badgeClass: 'bg-slate-100 text-slate-600 border border-slate-200',
  },
  sin_accion: {
    label: 'Sin acción pendiente',
    badgeClass: 'bg-slate-100 text-slate-600 border border-slate-200',
  },
};
const profilePersonTypeLabels = new Map([
  ['fisica', 'Persona física'],
  ['física', 'Persona física'],
  ['moral', 'Persona moral'],
]);
type Note = { id: string; content: string; created_at: string; user_id: string };
type Participant = ReminderParticipant & {
  email?: string;
  rol?: string;
  role?: string;
  accion?: string;
};
type Document = {
  id: string;
  nombre: string;
  status: ContactParticipationStatus;
  created_at: string;
  participant: Participant;
  reminder?: ContactReminder;
};
type DocumentEvent = {
  id: string;
  documento_id: string;
  action: string;
  category: string | null;
  created_at: string;
  actor_email: string | null;
  details: Record<string, unknown> | null;
};
type HistoryEvent = {
  id: string;
  date: string;
  label: string;
  detail: string;
  kind: 'contact' | 'tag' | 'group' | 'note' | 'request';
};
type ActivityEvent = {
  id: string;
  documentId: string;
  date: string;
  type: 'solicitud' | 'firma' | 'recordatorio' | 'rechazo';
  label: string;
  detail: string;
};

const normalize = (value: unknown) =>
  String(value ?? '')
    .trim()
    .toLocaleLowerCase('es-MX');
const dateTime = (value: string) =>
  new Date(value).toLocaleString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
const dateOnly = (value: string) =>
  new Date(value).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
const fullName = (contact: DetailContact) =>
  [contact.nombre, contact.apellido_paterno, contact.apellido_materno]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('es-MX')
    .replace(
      /(^|[\s'-])([a-záéíóúüñ])/g,
      (_, separator: string, letter: string) => separator + letter.toLocaleUpperCase('es-MX')
    );
const initials = (contact: DetailContact) =>
  [contact.nombre?.[0], contact.apellido_paterno?.[0]].filter(Boolean).join('').toUpperCase() ||
  'C';
const card = contactCard;

function noteParts(content: string) {
  const lineBreak = content.indexOf('\n');
  return lineBreak > 0
    ? { title: content.slice(0, lineBreak), body: content.slice(lineBreak + 1) }
    : { title: 'Nota interna', body: content };
}

function ReadOnlyRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="grid gap-1 border-b border-slate-100 py-3 text-sm last:border-0 sm:grid-cols-[165px_1fr]">
      <dt className="text-slate-500">{label}</dt>
      <dd className="break-words text-slate-800">{value || 'Sin información'}</dd>
    </div>
  );
}

function ProfileField({
  label,
  value,
  icon: Icon,
  className,
}: {
  label: string;
  value?: string | null;
  icon?: LucideIcon;
  className?: string;
}) {
  const content = value?.trim();
  return (
    <div className={className}>
      <dt className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</dt>
      <dd
        className={`flex min-h-10 min-w-0 items-center gap-2 rounded-md border border-border bg-muted/60 px-3 py-2 text-sm ${content ? 'text-foreground' : 'text-muted-foreground'}`}
      >
        {Icon && <Icon size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />}
        <span className="min-w-0 [overflow-wrap:anywhere]">{content || 'Sin información'}</span>
      </dd>
    </div>
  );
}

export default function ContactDetailWorkspace({
  contact,
  onClose,
  onUpdated,
  catalogTags = [],
  relatedContacts,
  onOpenContact,
  favorite,
  canFavorite,
  favoriteError,
  onFavorite,
  contactGroups,
  groupsLoadError,
  onReloadGroups,
  onGroupChange,
}: {
  contact: DetailContact;
  onClose: () => void;
  onUpdated: () => void;
  catalogTags?: string[];
  relatedContacts: RelatedContactOption[];
  onOpenContact: (id: string) => void;
  favorite: boolean;
  canFavorite: boolean;
  favoriteError: string;
  onFavorite: () => void;
  contactGroups: ContactGroups | null;
  groupsLoadError: boolean;
  onReloadGroups: () => void;
  onGroupChange: (change: ContactGroupChange) => void;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const { isModuleActive } = useAppModules();
  const userId = user?.id;
  const [tab, setTab] = useState<Tab>('resumen');
  const [documents, setDocuments] = useState<Document[]>([]);
  const [documentEvents, setDocumentEvents] = useState<DocumentEvent[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [profile, setProfile] = useState<SharedProfile | null>(null);
  const [fields, setFields] = useState<ContactFieldRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [agendaUnavailable, setAgendaUnavailable] = useState(false);
  const [notice, setNotice] = useState('');
  const [headerNotice, setHeaderNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [relationshipDialog, setRelationshipDialog] = useState(false);
  const [reminderDialog, setReminderDialog] = useState(false);
  const [communicationOpen, setCommunicationOpen] = useState(false);
  const [documentsUnavailable, setDocumentsUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tagDialog, setTagDialog] = useState(false);
  const [tagCategory, setTagCategory] = useState('Tipo');
  const [tagValue, setTagValue] = useState('');
  const [customTagCategory, setCustomTagCategory] = useState('Personalizada');
  const [customTagColor, setCustomTagColor] = useState('#2563eb');
  const [tagError, setTagError] = useState('');
  const personalCatalog = usePersonalCatalog(userId, true);
  const [documentSearch, setDocumentSearch] = useState('');
  const [documentFilter, setDocumentFilter] = useState<keyof typeof documentStatuses>('todos');
  const [documentOrder, setDocumentOrder] = useState('recent');
  const [activityFilter, setActivityFilter] = useState<
    'todos' | 'solicitud' | 'firma' | 'recordatorio' | 'rechazo'
  >('todos');
  const [noteFilter, setNoteFilter] = useState<'todas' | 'recientes' | 'importantes'>('todas');
  const [historyFilter, setHistoryFilter] = useState<
    'todos' | 'clasificacion' | 'solicitudes' | 'notas'
  >('todos');
  const [noteTitle, setNoteTitle] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [noteImportant, setNoteImportant] = useState(false);

  const loadAgenda = useCallback(async () => {
    if (!userId) return;
    const client = createClient();
    const [noteResult, fieldResult] = await Promise.all([
      client
        .from('contact_notes')
        .select('id,content,created_at,user_id')
        .eq('contact_id', contact.id)
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
      client
        .from('contact_custom_fields')
        .select(CONTACT_FIELD_COLUMNS)
        .eq('contact_id', contact.id)
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
    ]);
    if (noteResult.error || fieldResult.error) throw new Error('agenda');
    setAgendaUnavailable(false);
    setNotes(noteResult.data || []);
    setFields(fieldResult.data || []);
  }, [contact.id, userId]);

  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    const load = async () => {
      setLoading(true);
      setDocumentsUnavailable(false);
      try {
        const client = createClient();
        const [agenda, docsResult, profileResult] = await Promise.allSettled([
          loadAgenda(),
          contact.email
            ? client
                .from('documentos')
                .select(
                  'id,nombre,estado,created_at,participantes,fecha_vencimiento,tiene_vencimiento,deleted_at'
                )
                .eq('owner_id', user.id)
                .not('participantes', 'is', null)
            : Promise.resolve({ data: [], error: null }),
          profilePrivacy<{ fields: SharedProfile }>('profile', { contactId: contact.id }),
        ]);
        if (!active) return;
        setProfile(profileResult.status === 'fulfilled' ? profileResult.value.fields : null);
        if (agenda.status === 'rejected') {
          setAgendaUnavailable(true);
          setNotice('No se pudieron cargar las notas y la organización de este contacto.');
        }
        if (docsResult.status === 'fulfilled' && !docsResult.value.error) {
          const email = normalize(contact.email);
          const now = Date.now();
          const matched: Document[] = (docsResult.value.data || []).flatMap((row) => {
            const participants: Participant[] = Array.isArray(row.participantes)
              ? row.participantes.filter(
                  (item: Participant) => item && normalize(item.email) === email
                )
              : [];
            const participant = participants[0];
            const recipient = participants.find((item) =>
              canRemindDocumentParticipant(item, row, now)
            );
            const action = recipient && reminderAction(recipient);
            const reminder =
              recipient?.email && action
                ? {
                    id: row.id,
                    name: row.nombre || 'Sin título',
                    email: recipient.email,
                    action,
                    sentAt: participants
                      .map((item) => item.fecha_recordatorio)
                      .filter((date): date is string => Boolean(date))
                      .sort()
                      .at(-1),
                  }
                : undefined;
            return participant && normalize(row.estado) !== 'borrador'
              ? [
                  {
                    id: row.id,
                    nombre: row.nombre || 'Sin título',
                    status: getContactParticipationStatus(participant, row, now),
                    created_at: row.created_at,
                    participant,
                    reminder,
                  },
                ]
              : [];
          });
          setDocuments(matched);
          if (matched.length) {
            const eventsResult = await client
              .from('document_activity_log')
              .select('id,documento_id,action,category,created_at,actor_email,details')
              .in(
                'documento_id',
                matched.map((item) => item.id)
              )
              .order('created_at', { ascending: false })
              .limit(200);
            if (active && !eventsResult.error)
              setDocumentEvents((eventsResult.data || []) as DocumentEvent[]);
          }
        } else {
          setDocumentsUnavailable(true);
          setNotice('No se pudo cargar la actividad documental de este contacto.');
        }
      } catch {
        if (active) setNotice('No se pudo cargar la ficha completa.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [contact.id, contact.email, loadAgenda, user?.id]);

  const tags = useMemo(
    () =>
      Array.from(
        new Set([
          ...(contact.etiqueta_rol ? [`Tipo: ${contact.etiqueta_rol}`] : []),
          ...(contact.tags || []),
        ])
      ).map(splitContactTag),
    [contact.etiqueta_rol, contact.tags]
  );
  const importantIds = new Set(
    fields
      .filter((field) => field.field_name === 'note_important')
      .map((field) => field.field_value)
  );
  const documentRows = useMemo(() => {
    const latestActivity = new Map<string, string>();
    for (const event of documentEvents) {
      if (!latestActivity.has(event.documento_id))
        latestActivity.set(event.documento_id, event.created_at);
    }
    return documents.map((document) => ({
      ...document,
      role: document.participant.rol || document.participant.role || 'Participante',
      action: isPendingContactParticipation(document.status)
        ? document.participant.accion || 'Participación pendiente'
        : '',
      lastActivity: latestActivity.get(document.id) || document.created_at,
    }));
  }, [documents, documentEvents]);
  const firmados = documentRows.filter((row) => row.status === 'firmo').length;
  const pendientes = documentRows.filter((row) => isPendingContactParticipation(row.status)).length;
  const documentQuery = normalize(documentSearch);
  const filteredDocuments = documentRows
    .filter(
      (row) =>
        normalize(row.nombre).includes(documentQuery) &&
        (documentFilter === 'todos' ||
          (documentFilter === 'pendiente'
            ? isPendingContactParticipation(row.status)
            : row.status === documentFilter))
    )
    .sort((a, b) => {
      if (documentOrder === 'name' || documentOrder === 'name_desc') {
        return compareTableValues(a.nombre, b.nombre, documentOrder === 'name' ? 'asc' : 'desc');
      }
      if (documentOrder === 'status_asc' || documentOrder === 'status_desc') {
        return compareTableValues(
          (extraParticipationBadges[a.status] ?? getParticipationStatusConfig(a.status)).label,
          (extraParticipationBadges[b.status] ?? getParticipationStatusConfig(b.status)).label,
          documentOrder === 'status_asc' ? 'asc' : 'desc'
        );
      }
      return compareListDates(a.lastActivity, b.lastActivity, documentOrder === 'oldest' ? 'asc' : 'desc');
    });
  const documentHasFilters = documentQuery || documentFilter !== 'todos';
  const activity = useMemo(() => {
    const email = normalize(contact.email);
    const items: ActivityEvent[] = documents.map((document) => ({
      id: `request-${document.id}`,
      documentId: document.id,
      date: document.created_at,
      type: 'solicitud',
      label: 'Solicitud enviada',
      detail: document.nombre,
    }));
    documentEvents.forEach((event) => {
      const details = event.details || {};
      const target = normalize(
        details.participant_email || details.email || details.recipient_email
      );
      if (normalize(event.actor_email) !== email && target !== email) return;
      const action = normalize(event.action);
      const type =
        action.includes('reminder') || action.includes('recordatorio')
          ? 'recordatorio'
          : action.includes('reject') || action.includes('rechaz')
            ? 'rechazo'
            : action.includes('sign') ||
                action.includes('firm') ||
                action.includes('approv') ||
                action.includes('aproba')
              ? 'firma'
              : null;
      if (!type) return;
      const document = documents.find((item) => item.id === event.documento_id);
      items.push({
        id: event.id,
        documentId: event.documento_id,
        date: event.created_at,
        type,
        label:
          type === 'recordatorio'
            ? 'Recordatorio enviado'
            : type === 'rechazo'
              ? 'Rechazó un documento'
              : 'Participó en un documento',
        detail: document?.nombre || 'Documento',
      });
    });
    return items.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  }, [contact.email, documentEvents, documents]);
  const history: HistoryEvent[] = (
    [
      {
        id: 'created',
        date: contact.created_at,
        label: 'Contacto agregado',
        detail: 'Se agregó a la agenda.',
        kind: 'contact',
      },
      ...(contactGroups?.groups ?? []).flatMap((group) => {
        const membership = group.members.find((member) => member.contactId === contact.id);
        return membership
          ? [
              {
                id: `group-${group.id}`,
                date: membership.assignedAt,
                label: 'Grupo asignado',
                detail: group.name,
                kind: 'group' as const,
              },
            ]
          : [];
      }),
      ...fields
        .filter((field) => field.field_name === 'agenda_history' && field.field_value)
        .map((field) => ({
          id: field.id,
          date: field.created_at,
          label: field.field_value?.split(' · ')[0] || 'Cambio de agenda',
          detail: field.field_value?.split(' · ').slice(1).join(' · ') || '',
          kind: (field.field_value?.startsWith('Etiqueta') ? 'tag' : 'group') as 'tag' | 'group',
        })),
      ...notes.map((note) => ({
        id: `note-${note.id}`,
        date: note.created_at,
        label: 'Nota creada',
        detail: noteParts(note.content).title,
        kind: 'note' as const,
      })),
      ...documents.map((document) => ({
        id: `use-${document.id}`,
        date: document.created_at,
        label: 'Utilizado en solicitud',
        detail: document.nombre,
        kind: 'request' as const,
      })),
    ] as HistoryEvent[]
  ).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const filteredHistory = history.filter(
    (event) =>
      historyFilter === 'todos' ||
      (historyFilter === 'clasificacion'
        ? ['tag', 'group'].includes(event.kind)
        : historyFilter === 'solicitudes'
          ? event.kind === 'request'
          : event.kind === 'note')
  );
  const historyOrder = useTableOrdering(filteredHistory, {
    date: (event) => tableDate(event.date),
    label: (event) => event.label,
  });
  const visibleNotes = notes
    .filter((note) => noteFilter !== 'importantes' || importantIds.has(note.id))
    .slice(0, noteFilter === 'recientes' ? 5 : undefined);

  const addHistory = async (label: string, detail: string) => {
    if (!user?.id) return;
    const { error } = await createClient()
      .from('contact_custom_fields')
      .insert({
        contact_id: contact.id,
        user_id: user.id,
        field_name: 'agenda_history',
        field_value: `${label} · ${detail}`,
      });
    if (error) setNotice('El cambio se guardó, pero no se pudo registrar en el historial.');
  };
  const writeTag = async (value: string, remove: boolean) => {
    if (!userId) throw new Error('contact-tag');
    const db = createClient();
    if (!personalCatalog.unavailable) {
      const { data, error } = await db.rpc('set_contact_catalog_tag', {
        p_contact: contact.id, p_tag: value, p_remove: remove,
      });
      if (error || data !== true) throw new Error('contact-tag');
      return;
    }
    const existing = contact.tags || [];
    const values = remove ? existing.filter((tag) => tag !== value) : [...new Set([...existing, value])];
    const legacyRole = remove && value === `Tipo: ${contact.etiqueta_rol}`;
    const { error } = await db.from('contacts').update({ tags: values, ...(legacyRole && { etiqueta_rol: null }) })
      .eq('id', contact.id).eq('user_id', userId).select('id').single();
    if (error) throw error;
  };
  const saveTag = async () => {
    if (!user?.id || !tagValue.trim() || busy || personalCatalog.loading || personalCatalog.error) return;
    const name = tagValue.trim();
    const custom = activeTagCategory === '__custom__';
    const enteredGroup = custom ? customTagCategory.trim() : activeTagCategory;
    const group = categoriesByName.get(catalogKey(enteredGroup)) ?? enteredGroup;
    if (!group || group.includes(':')) {
      setTagError('Escribe una categoría sin dos puntos.');
      return;
    }
    if (
      tags.some(
        (tag) => catalogKey(tag.category) === catalogKey(group) && catalogKey(tag.label) === catalogKey(name)
      )
    ) {
      setTagDialog(false);
      return;
    }
    setBusy(true);
    setTagError('');
    try {
      const existing = contactCatalog.find((entry) => !entry.archived && catalogKey(entry.group) === catalogKey(group) && catalogKey(entry.name) === catalogKey(name));
      const value = existing ? `${existing.group}: ${existing.name}` : `${group}: ${name}`;
      if (custom) {
        if (personalCatalog.unavailable) return;
        if (existing && personalCatalog.hidden.has(catalogVisibilityKey(existing.kind, existing.id))) {
          setTagError('Esta etiqueta está oculta. Puedes volver a mostrarla en Configuración.');
          return;
        }
        if (!existing) {
          await savePersonalCatalogEntry(user.id, { kind: 'contact-tag', name, group, color: customTagColor });
          personalCatalog.refresh();
        }
      } else if (!tagCatalog.includes(name)) {
        setTagError('Selecciona una etiqueta del catálogo.');
        return;
      }
      await writeTag(value, false);
      onUpdated();
      setTagValue('');
      setTagDialog(false);
      try {
        await addHistory('Etiqueta asignada', value);
        await loadAgenda();
      } catch {
        setNotice('La etiqueta se asignó. No se pudo actualizar el historial.');
      }
    } catch {
      setTagError('No se pudo guardar la etiqueta. Intenta nuevamente.');
    } finally {
      setBusy(false);
    }
  };
  const removeTag = async (value: string) => {
    if (!user?.id || busy) return;
    setBusy(true);
    setTagError('');
    try {
      await writeTag(value, true);
      onUpdated();
      try {
        await addHistory('Etiqueta retirada', value);
        await loadAgenda();
      } catch {
        setNotice('La etiqueta se retiró. No se pudo actualizar el historial.');
      }
    } catch {
      setTagError('No se pudo quitar la etiqueta. Intenta nuevamente.');
    } finally {
      setBusy(false);
    }
  };
  const recordGroupRemoval = async (name: string) => {
    setNotice('');
    try {
      await addHistory('Grupo retirado', name);
      await loadAgenda();
    } catch {
      setNotice('El contacto se retiró del grupo. No se pudo actualizar el historial.');
    }
  };
  const saveNote = async () => {
    if (!user?.id || !noteBody.trim() || busy) return;
    setBusy(true);
    setNotice('');
    const content = noteTitle.trim() ? `${noteTitle.trim()}\n${noteBody.trim()}` : noteBody.trim();
    const { data, error } = await createClient()
      .from('contact_notes')
      .insert({ contact_id: contact.id, user_id: user.id, content })
      .select('id')
      .single();
    if (error || !data) setNotice('No se pudo guardar la nota.');
    else {
      if (noteImportant) {
        const mark = await createClient().from('contact_custom_fields').insert({
          contact_id: contact.id,
          user_id: user.id,
          field_name: 'note_important',
          field_value: data.id,
        });
        if (mark.error) setNotice('La nota se guardó, pero no se pudo marcar como importante.');
      }
      setNoteTitle('');
      setNoteBody('');
      setNoteImportant(false);
      await loadAgenda();
    }
    setBusy(false);
  };
  const toggleImportant = async (note: Note) => {
    if (!user?.id || busy) return;
    setBusy(true);
    setNotice('');
    const existing = fields.find(
      (field) => field.field_name === 'note_important' && field.field_value === note.id
    );
    const client = createClient();
    const { error } = existing
      ? await client
          .from('contact_custom_fields')
          .delete()
          .eq('id', existing.id)
          .eq('user_id', user.id)
          .eq('contact_id', contact.id)
      : await client.from('contact_custom_fields').insert({
          contact_id: contact.id,
          user_id: user.id,
          field_name: 'note_important',
          field_value: note.id,
        });
    if (error) setNotice('No se pudo cambiar la importancia de la nota.');
    else await loadAgenda();
    setBusy(false);
  };

  function updateCustomField(updated: ContactFieldRow) {
    setFields((current) => [updated, ...current.filter((field) => field.id !== updated.id)]);
  }

  async function copyEmail() {
    if (!contact.email) return;
    try {
      await navigator.clipboard.writeText(contact.email);
      setHeaderNotice({ text: 'Correo copiado.' });
    } catch {
      setHeaderNotice({ text: 'No se pudo copiar el correo.', error: true });
    }
  }

  const contactQuery = `contact=${encodeURIComponent(contact.id)}`;
  const registeredPersonType = profile?.personalidad_juridica?.trim() || contact.tipo_persona;
  const personType =
    profilePersonTypeLabels.get(normalize(registeredPersonType)) || registeredPersonType;
  const registeredName =
    profile?.full_name?.trim() ||
    [profile?.nombre, profile?.apellido_paterno, profile?.apellido_materno]
      .filter(Boolean)
      .join(' ')
      .trim();
  const resourceKinds = tabs.find(({ id }) => id === tab)?.resourceKinds;
  const panelProps = {
    role: 'tabpanel',
    id: 'contact-detail-panel',
    'aria-labelledby': `contact-detail-tab-${tab}`,
    tabIndex: 0,
  };
  const tabButton = (key: Tab, label: string) => (
    <button
      key={key}
      id={`contact-detail-tab-${key}`}
      type="button"
      role="tab"
      aria-selected={tab === key}
      aria-controls="contact-detail-panel"
      tabIndex={tab === key ? 0 : -1}
      onClick={() => setTab(key)}
      className={
        'whitespace-nowrap border-b-2 px-3 py-3 text-sm transition-colors focus-visible:bg-primary/10 focus-visible:outline-none ' +
        (tab === key
          ? 'border-primary font-medium text-primary'
          : 'border-transparent text-muted-foreground hover:text-primary')
      }
    >
      {label}
    </button>
  );
  const sectionTitle = (
    icon: typeof FileText,
    title: string,
    action?: () => void,
    actionLabel?: string
  ) => (
    <ContactPanelHeading icon={icon} title={title}>
      {action && (
        <button type="button" onClick={action} className="text-xs text-primary hover:underline">
          {actionLabel}
        </button>
      )}
    </ContactPanelHeading>
  );
  const documentBadge = (status: ContactParticipationStatus) => {
    const { label, badgeClass } =
      extraParticipationBadges[status] ?? getParticipationStatusConfig(status);
    return (
      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs ${badgeClass}`}>{label}</span>
    );
  };
  const contactCatalog = [...builtInCatalog, ...personalCatalog.entries].filter((entry) => entry.kind === 'contact-tag');
  const visibleTags = contactCatalog.filter((entry) => !entry.archived &&
    !personalCatalog.hidden.has(catalogVisibilityKey(entry.kind, entry.id))
  );
  const knownTags = new Set(contactCatalog.map((entry) => catalogKey(`${entry.group}: ${entry.name}`)));
  const legacyTags = catalogTags.map(splitContactTag).filter((tag) => !knownTags.has(catalogKey(`${tag.category}: ${tag.label}`)));
  const categoriesByName = new Map<string, string>();
  for (const category of [
    ...contactTagGroups.map((group) => group.name),
    ...visibleTags.map((tag) => tag.group),
    ...legacyTags.map((tag) => tag.category),
  ]) {
    const key = catalogKey(category);
    if (key && !categoriesByName.has(key)) {
      categoriesByName.set(key, category);
    }
  }
  const selectableCategories = [...categoriesByName.values()];
  const activeTagCategory = tagCategory === '__custom__'
    ? tagCategory
    : (categoriesByName.get(catalogKey(tagCategory)) ?? selectableCategories[0] ?? '__custom__');
  const tagCatalog = [...new Set([
    ...visibleTags.filter((tag) => catalogKey(tag.group) === catalogKey(activeTagCategory)).map((tag) => tag.name),
    ...legacyTags.filter((tag) => catalogKey(tag.category) === catalogKey(activeTagCategory)).map((tag) => tag.label),
  ])].sort((a, b) => a.localeCompare(b, 'es'));

  return (
    <div className="app-page-bleed app-page-frame bg-[#f6f8fb] dark:bg-background">
      {communicationOpen && <ProfileCommunicationDialog initialContext={{ contactId: contact.id }} onClose={() => setCommunicationOpen(false)} />}
      <div className="app-page-width">
        <ContactProfileHeader
          name={fullName(contact)}
          initials={initials(contact)}
          personType={contact.tipo_persona}
          email={contact.email}
          phone={contact.telefono}
          onClose={onClose}
          favorite={favorite}
          canFavorite={canFavorite}
          onFavorite={onFavorite}
          favoriteError={favoriteError}
          notice={headerNotice}
          actions={[
            { label: 'Comunicación directa', icon: MessageSquare, run: () => setCommunicationOpen(true) },
            {
              label: 'Enviar recordatorio',
              icon: Bell,
              run: () => setReminderDialog(true),
            },
            ...(isModuleActive('formularios')
              ? [
                  {
                    label: 'Lanzar formulario',
                    icon: ClipboardList,
                    disabled: !contact.email,
                    run: () => router.push(`/formularios/lanzar?${contactQuery}`),
                  },
                ]
              : []),
            ...(isModuleActive('expedientes')
              ? [
                  {
                    label: 'Lanzar expediente',
                    icon: FolderClosed,
                    disabled: !contact.email,
                    run: () => router.push(`/expedientes/lanzar?${contactQuery}`),
                  },
                ]
              : []),
            {
              label: 'Copiar correo',
              icon: Mail,
              disabled: !contact.email,
              run: () => void copyEmail(),
            },
            { label: 'Agregar nota', icon: MessageSquare, run: () => setTab('notas') },
            { label: 'Gestionar etiquetas', icon: Tag, run: () => setTagDialog(true) },
            {
              label: 'Vincular contacto',
              icon: Link2,
              disabled: !userId || agendaUnavailable || relatedContacts.length < 2,
              run: () => setRelationshipDialog(true),
            },
          ]}
        />
        {notice && <BottomNotice message={notice} tone="critical" onClose={() => setNotice('')} />}
        <div className="grid gap-4 lg:grid-cols-[290px_minmax(0,1fr)]">
          <main className="min-w-0 lg:col-start-2 lg:row-start-1">
            <div
              role="tablist"
              aria-label="Ficha del contacto"
              className={card + ' mb-4 flex overflow-x-auto px-2 [scrollbar-width:thin]'}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const index = tabs.findIndex(({ id }) => id === tab);
                const target =
                  tabs[
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? tabs.length - 1
                        : (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length
                  ].id;
                setTab(target);
                document.getElementById(`contact-detail-tab-${target}`)?.focus();
              }}
            >
              {tabs.map(({ id, label }) => tabButton(id, label))}
            </div>
            {loading && !resourceKinds && (
              <div {...panelProps} className={card + ' p-8 text-center text-sm text-slate-500'}>
                Cargando ficha del contacto…
              </div>
            )}
            {!loading && tab === 'resumen' && (
              <div {...panelProps} className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    [
                      FileText,
                      documents.length,
                      'Documentos compartidos',
                      'text-primary bg-blue-50',
                    ],
                    [
                      CheckCircle2,
                      firmados,
                      'Firmados por este contacto',
                      'text-emerald-600 bg-emerald-50',
                    ],
                    [Clock3, pendientes, 'Pendientes de su acción', 'text-amber-600 bg-amber-50'],
                    [MessageSquare, notes.length, 'Notas internas', 'text-violet-600 bg-violet-50'],
                  ].map(([Glyph, count, label, tone]) => {
                    const Icon = Glyph as typeof FileText;
                    return (
                      <div key={label as string} className={card + ' flex items-center gap-3 p-4'}>
                        <div className={'rounded-full p-3 ' + tone}>
                          <Icon size={21} />
                        </div>
                        <div>
                          <p className="text-xl font-semibold text-slate-950">{count as number}</p>
                          <p className="text-xs text-slate-500">{label as string}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
                  <section className={card}>
                    {sectionTitle(
                      FileText,
                      'Documentos recientes',
                      () => setTab('documentos'),
                      'Ver todos'
                    )}
                    <div className="divide-y divide-slate-100 px-4">
                      {documentRows
                        .slice()
                        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
                        .slice(0, 4)
                        .map((document) => (
                          <div key={document.id} className="flex items-center gap-3 py-3 text-sm">
                            <FileText size={17} className="shrink-0 text-primary" />
                            <span className="min-w-0 flex-1 truncate text-slate-800">
                              {document.nombre}
                            </span>
                            {documentBadge(document.status)}
                            <span className="hidden text-xs text-slate-500 sm:block">
                              {dateOnly(document.created_at)}
                            </span>
                          </div>
                        ))}
                      {!documents.length && (
                        <p className="py-6 text-sm text-slate-500">Sin documentos compartidos.</p>
                      )}
                    </div>
                  </section>
                  <section className={card}>
                    {sectionTitle(
                      Activity,
                      'Actividad reciente',
                      () => setTab('actividad'),
                      'Ver todo'
                    )}
                    <div className="space-y-3 p-4">
                      {activity.slice(0, 4).map((event) => (
                        <div key={event.id} className="border-l-2 border-blue-200 pl-3 text-sm">
                          <p className="font-medium text-slate-800">{event.label}</p>
                          <p className="truncate text-slate-600">{event.detail}</p>
                          <p className="text-xs text-slate-400">{dateTime(event.date)}</p>
                        </div>
                      ))}
                      {!activity.length && (
                        <p className="text-sm text-slate-500">
                          Sin actividad documental registrada.
                        </p>
                      )}
                    </div>
                  </section>
                </div>
                <section className={card}>
                  {sectionTitle(
                    MessageSquare,
                    'Notas recientes',
                    () => setTab('notas'),
                    'Ver todas'
                  )}
                  <div className="divide-y divide-slate-100 px-4">
                    {notes.slice(0, 3).map((note) => (
                      <div
                        key={note.id}
                        className="grid gap-1 py-3 text-sm sm:grid-cols-[180px_1fr_auto]"
                      >
                        <span className="font-medium text-slate-800">
                          {noteParts(note.content).title}
                        </span>
                        <span className="truncate text-slate-600">
                          {noteParts(note.content).body}
                        </span>
                        <span className="text-xs text-slate-400">{dateTime(note.created_at)}</span>
                      </div>
                    ))}
                    {!notes.length && (
                      <p className="py-5 text-sm text-slate-500">Aún no hay notas.</p>
                    )}
                  </div>
                </section>
              </div>
            )}
            {!loading && tab === 'informacion' && (
              <div {...panelProps} className="grid grid-cols-1 gap-4">
                <section className={card}>
                  <ContactPanelHeading icon={UserRound} title="Datos de identidad" />
                  <dl className="grid gap-4 p-4 sm:p-5 md:grid-cols-2">
                    <ProfileField label="Tipo de persona" value={personType} />
                    <ProfileField label="CURP" value={profile?.curp || contact.curp} />
                    <ProfileField label="Nombre" value={profile?.nombre || contact.nombre} />
                    <ProfileField
                      label="Apellido paterno"
                      value={profile?.apellido_paterno || contact.apellido_paterno}
                    />
                    <ProfileField
                      label="Apellido materno"
                      value={profile?.apellido_materno || contact.apellido_materno}
                    />
                    <ProfileField
                      label="Nombre completo / Razón social"
                      value={registeredName || fullName(contact)}
                    />
                    <ProfileField label="Correo electrónico" value={contact.email} icon={Mail} />
                    <ProfileField
                      label="Número de teléfono"
                      value={profile?.phone || contact.telefono}
                      icon={Phone}
                    />
                  </dl>
                </section>
                <section className={card}>
                  {sectionTitle(FileText, 'Datos fiscales')}
                  <dl className="grid gap-4 p-4 sm:p-5 md:grid-cols-2">
                    <ProfileField label="RFC" value={profile?.rfc || contact.rfc} />
                    <ProfileField label="Régimen fiscal" value={profile?.regimen_fiscal} />
                  </dl>
                </section>
                <section className={card}>
                  {sectionTitle(MapPin, 'Domicilio fiscal')}
                  <dl className="grid gap-4 p-4 sm:p-5 md:grid-cols-2">
                    <ProfileField
                      label="Código postal"
                      value={profile?.codigo_postal}
                      className="md:col-start-1"
                    />
                    <ProfileField
                      label="Estado"
                      value={profile?.estado}
                      className="md:col-start-1"
                    />
                    <ProfileField label="Municipio o alcaldía" value={profile?.municipio} />
                    <ProfileField label="Colonia" value={profile?.colonia} />
                    <ProfileField label="Localidad" value={profile?.localidad} />
                    <ProfileField label="Calle" value={profile?.calle} className="md:col-span-2" />
                    <ProfileField label="Número exterior" value={profile?.num_exterior} />
                    <ProfileField label="Número interior" value={profile?.num_interior} />
                    {contact.direccion?.trim() && (
                      <ProfileField
                        label="Dirección de la agenda"
                        value={contact.direccion}
                        className="md:col-span-2"
                      />
                    )}
                  </dl>
                </section>
                {userId && (
                  <ContactCustomInformation
                    contactId={contact.id}
                    userId={userId}
                    rows={fields}
                    onSaved={updateCustomField}
                    unavailable={agendaUnavailable}
                    contacts={relatedContacts}
                  />
                )}
              </div>
            )}
            {!loading && tab === 'documentos' && (
              <section {...panelProps} className={card}>
                {sectionTitle(FileText, 'Documentos del contacto')}
                <div className="space-y-3 border-b border-border px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <label className="relative min-w-0 flex-1 basis-48">
                      <span className="sr-only">Buscar documentos</span>
                      <Search
                        size={15}
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <input
                        type="search"
                        value={documentSearch}
                        onChange={(event) => setDocumentSearch(event.target.value)}
                        placeholder="Buscar documentos…"
                        className={`${contactControl} w-full pl-9`}
                      />
                    </label>
                    <select
                      aria-label="Ordenar documentos"
                      className={contactControl}
                      value={documentOrder}
                      onChange={(event) => setDocumentOrder(event.target.value)}
                    >
                      <option value="recent">Actividad más reciente</option>
                      <option value="oldest">Actividad más antigua</option>
                      <option value="name">Nombre de A a Z</option>
                      <option value="name_desc">Nombre de Z a A</option>
                      <option value="status_asc">Estado ascendente</option>
                      <option value="status_desc">Estado descendente</option>
                    </select>
                  </div>
                  <div
                    role="group"
                    aria-label="Estado de la participación"
                    className="flex gap-2 overflow-x-auto px-0.5 py-0.5 [scrollbar-width:thin]"
                  >
                    {(Object.keys(documentStatuses) as (keyof typeof documentStatuses)[]).map(
                      (filter) => (
                        <button
                          key={filter}
                          type="button"
                          onClick={() => setDocumentFilter(filter)}
                          aria-pressed={documentFilter === filter}
                          className={`${contactButton} workspace-filter-pill workspace-filter-trigger shrink-0 whitespace-nowrap ${documentFilter === filter ? 'border-primary/30 bg-primary/10' : ''}`}
                        >
                          {documentStatuses[filter]}
                        </button>
                      )
                    )}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <PaginatedTableScrollArea items={filteredDocuments} label="Documentos del contacto">
                    {(pageRows) => (
                      <table className="w-full min-w-[680px] text-left text-sm">
                        <thead className="workspace-table-heading">
                          <tr>
                            <TableSortHeading label="Documento" sort={documentOrder} ascending="name" descending="name_desc" onSort={setDocumentOrder} />
                            <th className="px-4 py-3 font-medium">Rol</th>
                            <TableSortHeading label="Estado de participación" sort={documentOrder} ascending="status_asc" descending="status_desc" onSort={setDocumentOrder} />
                            <th className="px-4 py-3 font-medium">Acción pendiente</th>
                            <TableSortHeading label="Última actividad" sort={documentOrder} ascending="oldest" descending="recent" onSort={setDocumentOrder} defaultDirection="desc" />
                            <th className="px-4 py-3 font-medium">Abrir</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {pageRows.map((document) => (
                            <tr key={document.id}>
                              <td className="px-4 py-3 font-medium text-slate-800">
                                {document.nombre}
                              </td>
                              <td className="px-4 py-3 text-slate-600">{document.role}</td>
                              <td className="px-4 py-3">{documentBadge(document.status)}</td>
                              <td className="px-4 py-3 text-slate-600">{document.action || '—'}</td>
                              <td className="px-4 py-3 text-xs text-slate-500">
                                {dateOnly(document.lastActivity)}
                              </td>
                              <td className="px-4 py-3">
                                <button
                                  type="button"
                                  onClick={() => router.push(`/visor-documento/${document.id}`)}
                                  aria-label={`Abrir ${document.nombre}`}
                                  title="Abrir documento"
                                  className="text-primary hover:text-blue-700"
                                >
                                  <ExternalLink size={16} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </PaginatedTableScrollArea>
                  {!filteredDocuments.length && (
                    <p className="p-8 text-center text-sm text-slate-500">
                      {documentHasFilters
                        ? 'No hay documentos que coincidan con los filtros.'
                        : 'Aún no hay documentos compartidos con este contacto.'}
                    </p>
                  )}
                </div>
              </section>
            )}
            {resourceKinds && (
              <div {...panelProps} className="space-y-4">
                {resourceKinds.map((kind) => (
                  <ContactResourcesPanel
                    key={kind}
                    kind={kind}
                    contactId={contact.id}
                    hasEmail={Boolean(contact.email?.trim())}
                  />
                ))}
              </div>
            )}
            {!loading && tab === 'actividad' && (
              <section {...panelProps} className={card}>
                <div className="flex flex-wrap gap-2 p-4">
                  {(['todos', 'solicitud', 'firma', 'recordatorio', 'rechazo'] as const).map(
                    (filter) => (
                      <button
                        key={filter}
                        type="button"
                        onClick={() => setActivityFilter(filter)}
                        className={
                          'rounded-md border px-3 py-2 text-xs ' +
                          (activityFilter === filter
                            ? 'border-primary bg-primary text-white'
                            : 'border-slate-200 text-slate-600')
                        }
                      >
                        {filter === 'todos'
                          ? 'Todo'
                          : filter === 'solicitud'
                            ? 'Solicitudes'
                            : filter === 'firma'
                              ? 'Firmas'
                              : filter === 'recordatorio'
                                ? 'Recordatorios'
                                : 'Rechazos'}
                      </button>
                    )
                  )}
                </div>
                <div className="space-y-3 px-4 pb-5">
                  {activity
                    .filter((event) => activityFilter === 'todos' || event.type === activityFilter)
                    .map((event) => (
                      <div
                        key={event.id}
                        className="flex items-center gap-4 rounded-md border border-slate-200 px-4 py-3"
                      >
                        <div
                          className={
                            'rounded-full p-2 ' +
                            (event.type === 'firma'
                              ? 'bg-emerald-50 text-emerald-600'
                              : event.type === 'rechazo'
                                ? 'bg-red-50 text-red-600'
                                : event.type === 'recordatorio'
                                  ? 'bg-amber-50 text-amber-600'
                                  : 'bg-blue-50 text-primary')
                          }
                        >
                          {event.type === 'firma' ? (
                            <CheckCircle2 size={18} />
                          ) : event.type === 'rechazo' ? (
                            <XCircle size={18} />
                          ) : event.type === 'recordatorio' ? (
                            <Clock3 size={18} />
                          ) : (
                            <Send size={18} />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-800">{event.label}</p>
                          <p className="truncate text-xs text-slate-600">{event.detail}</p>
                        </div>
                        <span className="text-xs text-slate-500">{dateTime(event.date)}</span>
                      </div>
                    ))}
                  {!activity.some(
                    (event) => activityFilter === 'todos' || event.type === activityFilter
                  ) && (
                    <p className="py-8 text-center text-sm text-slate-500">
                      No hay eventos en esta categoría.
                    </p>
                  )}
                </div>
              </section>
            )}
            {!loading && tab === 'notas' && (
              <section {...panelProps} className={card}>
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
                  <h2 className="mr-auto text-sm font-semibold text-slate-900">Notas internas</h2>
                  {(['todas', 'recientes', 'importantes'] as const).map((filter) => (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => setNoteFilter(filter)}
                      className={
                        'rounded-md border px-3 py-2 text-xs ' +
                        (noteFilter === filter
                          ? 'border-primary/30 bg-blue-50 text-primary'
                          : 'border-slate-200 text-slate-600')
                      }
                    >
                      {filter.charAt(0).toUpperCase() + filter.slice(1)}
                    </button>
                  ))}
                </div>
                <div className="space-y-3 p-4">
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <input
                      value={noteTitle}
                      onChange={(event) => setNoteTitle(event.target.value)}
                      placeholder="Título de la nota (opcional)"
                      maxLength={120}
                      className="mb-2 h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                    />
                    <textarea
                      value={noteBody}
                      onChange={(event) => setNoteBody(event.target.value)}
                      placeholder="Escribe una nota de seguimiento..."
                      rows={3}
                      className="w-full rounded-md border border-slate-200 bg-white p-3 text-sm"
                    />
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <label className="flex items-center gap-2 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          checked={noteImportant}
                          onChange={(event) => setNoteImportant(event.target.checked)}
                        />
                        Marcar como importante
                      </label>
                      <button
                        type="button"
                        disabled={!noteBody.trim() || busy}
                        onClick={() => void saveNote()}
                        className="rounded-md bg-primary px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
                      >
                        <Plus size={14} className="mr-1 inline" />
                        Agregar nota
                      </button>
                    </div>
                  </div>
                  {visibleNotes.map((note) => (
                    <article key={note.id} className="rounded-md border border-slate-200 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-semibold text-slate-900">
                          {noteParts(note.content).title}
                        </h3>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void toggleImportant(note)}
                          aria-label={
                            importantIds.has(note.id) ? 'Quitar importancia' : 'Marcar importante'
                          }
                          aria-pressed={importantIds.has(note.id)}
                          className={
                            importantIds.has(note.id)
                              ? 'text-amber-500'
                              : 'text-slate-400 hover:text-amber-500'
                          }
                        >
                          <Star
                            size={17}
                            fill={importantIds.has(note.id) ? 'currentColor' : 'none'}
                          />
                        </button>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
                        {noteParts(note.content).body}
                      </p>
                      <p className="mt-3 text-xs text-slate-400">{dateTime(note.created_at)}</p>
                    </article>
                  ))}
                  {!visibleNotes.length && (
                    <p className="py-6 text-center text-sm text-slate-500">
                      No hay notas en esta categoría.
                    </p>
                  )}
                </div>
              </section>
            )}
            {!loading && tab === 'historial' && (
              <section {...panelProps} className={card}>
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
                  <h2 className="mr-auto text-sm font-semibold text-slate-900">
                    Historial de la agenda
                  </h2>
                  {(['todos', 'clasificacion', 'solicitudes', 'notas'] as const).map((filter) => (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => setHistoryFilter(filter)}
                      className={
                        'rounded-md border px-3 py-2 text-xs ' +
                        (historyFilter === filter
                          ? 'border-primary/30 bg-blue-50 text-primary'
                          : 'border-slate-200 text-slate-600')
                      }
                    >
                      {filter === 'todos'
                        ? 'Todo'
                        : filter === 'clasificacion'
                          ? 'Clasificación'
                          : filter === 'solicitudes'
                            ? 'Uso en solicitudes'
                            : 'Notas'}
                    </button>
                  ))}
                </div>
                <div className="overflow-x-auto">
                  <PaginatedTableScrollArea items={historyOrder.orderedRows} label="Historial del contacto">
                    {(pageRows) => (
                      <table className="w-full min-w-[580px] text-left text-sm">
                        <thead className="workspace-table-heading">
                          <tr>
                            <th className="px-4 py-3" {...historyOrder.sortHeading('date', 'Fecha')} />
                            <th className="px-4 py-3" {...historyOrder.sortHeading('label', 'Evento')} />
                            <th scope="col" className="px-4 py-3">Detalle</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {pageRows.map((event) => (
                            <tr key={event.id}>
                              <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                                {dateTime(event.date)}
                              </td>
                              <td className="px-4 py-3 font-medium text-slate-800">{event.label}</td>
                              <td className="px-4 py-3 text-slate-600">{event.detail}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </PaginatedTableScrollArea>
                  {!filteredHistory.length && (
                    <p className="p-8 text-center text-sm text-slate-500">
                      No hay registros en esta categoría.
                    </p>
                  )}
                </div>
              </section>
            )}
          </main>
          <aside
            aria-label="Clasificación y relaciones del contacto"
            className="min-w-0 space-y-4 lg:col-start-1 lg:row-start-1"
          >
            <section className={card}>
              {sectionTitle(Tag, 'Etiquetas', () => setTagDialog(true), 'Gestionar etiquetas')}
              <div className="space-y-2 p-4">
                {tags.length ? (
                  [...new Set(tags.map((tag) => tag.category))].map((category) => {
                    const values = tags.filter((tag) => tag.category === category);
                    return values.length ? (
                      <div
                        key={category}
                        className="grid grid-cols-[82px_1fr] items-start gap-2 text-xs"
                      >
                        <span className="pt-1 text-slate-500">{category}</span>
                        <div className="flex flex-wrap gap-1">
                          {values.map((tag) => (
                            <span
                              key={tag.raw}
                              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2 py-1 text-foreground"
                            >
                              <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: contactTagColor(contactCatalog, tag.category, tag.label) }} />
                              {tag.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null;
                  })
                ) : (
                  <p className="text-sm text-slate-500">Sin etiquetas.</p>
                )}
              </div>
            </section>
            <ContactGroupsPanel
              contactId={contact.id}
              userId={userId}
              collection={contactGroups}
              loadError={groupsLoadError}
              onRetry={onReloadGroups}
              onChange={onGroupChange}
              onRemoved={(name) => void recordGroupRemoval(name)}
            />
            {userId && (
              <ContactRelationships
                contactId={contact.id}
                userId={userId}
                contacts={relatedContacts}
                rows={fields}
                onSaved={updateCustomField}
                loading={loading}
                unavailable={agendaUnavailable}
                dialogOpen={relationshipDialog}
                setDialogOpen={setRelationshipDialog}
                onOpenContact={onOpenContact}
              />
            )}
            <section className={card}>
              {sectionTitle(FileText, 'Resumen rápido')}
              <dl className="px-4">
                <ReadOnlyRow label="Tipo de persona" value={contact.tipo_persona} />
                <ReadOnlyRow label="Agregado" value={dateOnly(contact.created_at)} />
              </dl>
            </section>
          </aside>
        </div>
      </div>
      {reminderDialog && (
        <ContactReminderDialog
          contactName={fullName(contact)}
          email={contact.email}
          reminders={documents.flatMap((document) =>
            document.reminder ? [document.reminder] : []
          )}
          loading={loading}
          unavailable={documentsUnavailable}
          onClose={() => setReminderDialog(false)}
          onSent={(id, sentAt) =>
            setDocuments((current) =>
              current.map((document) =>
                document.id === id && document.reminder
                  ? { ...document, reminder: { ...document.reminder, sentAt } }
                  : document
              )
            )
          }
        />
      )}
      {tagDialog && (
        <ContactEditorDialog
          title="Gestionar etiquetas"
          onClose={() => { setTagDialog(false); setTagError(''); setTagValue(''); }}
          onSubmit={(event) => { event.preventDefault(); void saveTag(); }}
          busy={busy}
          error={tagError}
          submitLabel="Asignar etiqueta"
          submitDisabled={!tagValue.trim() || personalCatalog.loading || personalCatalog.error}
        >
          {tags.length > 0 && (
            <ul aria-label="Etiquetas asignadas" className="max-h-36 space-y-1.5 overflow-y-auto">
              {tags.map((tag) => (
                <li key={tag.raw} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-1.5 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: contactTagColor(contactCatalog, tag.category, tag.label) }} />
                    <span className="[overflow-wrap:anywhere]">{tag.category}: {tag.label}</span>
                  </span>
                  <button type="button" className="shrink-0 rounded p-1.5 text-muted-foreground hover:text-destructive"
                    onClick={() => void removeTag(tag.raw)} aria-label={`Quitar ${tag.raw}`}>
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label className="grid gap-1.5 text-sm font-medium">
            Categoría
            <select value={activeTagCategory} className={contactControl} onChange={(event) => {
              setTagCategory(event.target.value); setTagValue(''); setTagError('');
            }}>
              {selectableCategories.map((category) => <option key={category}>{category}</option>)}
              <option value="__custom__" disabled={personalCatalog.unavailable}>Otra categoría · Crear etiqueta</option>
            </select>
          </label>
          {personalCatalog.error ? (
            <p className="text-sm text-destructive" role="alert">
              No se pudo cargar el catálogo. <button type="button" className="underline" onClick={personalCatalog.refresh}>Reintentar</button>
            </p>
          ) : personalCatalog.loading ? <p className="text-sm text-muted-foreground" role="status">Cargando etiquetas…</p>
          : activeTagCategory === '__custom__' ? (
            <>
              <label className="grid gap-1.5 text-sm font-medium">Nombre de la categoría
                <input required maxLength={80} className={contactControl} value={customTagCategory} onChange={(event) => setCustomTagCategory(event.target.value)} />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">Nombre de la etiqueta
                <input required maxLength={80} className={contactControl} value={tagValue} onChange={(event) => setTagValue(event.target.value)} />
              </label>
              <CatalogColorPicker value={customTagColor} onChange={setCustomTagColor} />
            </>
          ) : (
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Etiqueta</legend>
              <div className="flex max-h-44 flex-wrap content-start gap-2 overflow-y-auto p-0.5">
                {tagCatalog.map((name) => {
                  const assigned = tags.some((tag) => catalogKey(tag.category) === catalogKey(activeTagCategory) && catalogKey(tag.label) === catalogKey(name));
                  return (
                    <button type="button" key={name} aria-pressed={tagValue === name} disabled={assigned}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50 ${tagValue === name ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted'}`}
                      onClick={() => setTagValue(name)}>
                      <span className="size-2.5 rounded-full" style={{ backgroundColor: contactTagColor(contactCatalog, activeTagCategory, name) }} />
                      {name}
                    </button>
                  );
                })}
                {!tagCatalog.length && <p className="text-sm text-muted-foreground">Sin etiquetas disponibles en esta categoría.</p>}
              </div>
            </fieldset>
          )}
        </ContactEditorDialog>
      )}
    </div>
  );
}
