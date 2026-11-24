'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  CheckCircle2,
  ChevronLeft,
  Clock3,
  ExternalLink,
  FileText,
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
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

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
  empresa?: string | null;
  cargo?: string | null;
  direccion?: string | null;
  etiqueta_rol?: string | null;
  tags?: string[] | null;
  created_at: string;
}

type Tab = 'resumen' | 'informacion' | 'documentos' | 'actividad' | 'notas' | 'historial';
type AgendaField = {
  id: string;
  contact_id: string;
  field_name: string;
  field_value: string | null;
  created_at: string;
};
type Note = { id: string; content: string; created_at: string; user_id: string };
type Profile = {
  rfc: string | null;
  curp: string | null;
  regimen_fiscal: string | null;
  codigo_postal: string | null;
  estado: string | null;
  municipio: string | null;
  colonia: string | null;
  calle: string | null;
  num_exterior: string | null;
  num_interior: string | null;
};
type Participant = {
  email?: string;
  rol?: string;
  role?: string;
  accion?: string;
  sub_estado?: string;
  status?: string;
  estado?: string;
};
type Document = {
  id: string;
  nombre: string;
  estado: string | null;
  created_at: string;
  participant: Participant;
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

const categories = ['Tipo', 'Relación', 'Área'] as const;
const tagOptions: Record<(typeof categories)[number], string[]> = {
  Tipo: ['Cliente', 'Proveedor', 'Colaborador', 'Notaría', 'Otro'],
  Relación: ['Recurrente', 'Prospecto', 'Estratégico'],
  Área: ['Comercial', 'Legal', 'Fiscal', 'Operaciones'],
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
const card = 'rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]';

function classifyTag(value: string): { category: string; label: string; raw: string } {
  const match = value.match(/^(Tipo|Relación|Área):\s*(.+)$/i);
  if (match)
    return {
      category: categories.find((item) => normalize(item) === normalize(match[1])) || 'Tipo',
      label: match[2].trim(),
      raw: value,
    };
  const category = categories.find((item) =>
    tagOptions[item].some((option) => normalize(option) === normalize(value))
  );
  return { category: category || 'Otros', label: value, raw: value };
}

function noteParts(content: string) {
  const lineBreak = content.indexOf('\n');
  return lineBreak > 0
    ? { title: content.slice(0, lineBreak), body: content.slice(lineBreak + 1) }
    : { title: 'Nota interna', body: content };
}

function participantStatus(document: Document) {
  const state = normalize(
    document.participant.sub_estado || document.participant.status || document.participant.estado
  );
  if (['firmo', 'firmado', 'aprobo', 'aprobado', 'completado'].includes(state)) return 'firmado';
  if (['rechazo', 'rechazado'].includes(state)) return 'rechazado';
  if (['cancelo', 'cancelado'].includes(state) || normalize(document.estado) === 'cancelado')
    return 'cancelado';
  if (
    ['en_progreso', 'en_espera', 'pendiente', 'en_revision', 'sin_revisar'].includes(state) ||
    ['en_progreso', 'en_espera'].includes(normalize(document.estado))
  )
    return 'pendiente';
  return 'otro';
}

function ReadOnlyRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="grid gap-1 border-b border-slate-100 py-3 text-sm last:border-0 sm:grid-cols-[165px_1fr]">
      <dt className="text-slate-500">{label}</dt>
      <dd className="break-words text-slate-800">{value || 'Sin información'}</dd>
    </div>
  );
}

export default function ContactDetailWorkspace({
  contact,
  onClose,
  onUpdated,
  catalogTags = [],
}: {
  contact: DetailContact;
  onClose: () => void;
  onUpdated: () => void;
  catalogTags?: string[];
}) {
  const router = useRouter();
  const { user } = useAuth();
  const userId = user?.id;
  const [tab, setTab] = useState<Tab>('resumen');
  const [documents, setDocuments] = useState<Document[]>([]);
  const [documentEvents, setDocumentEvents] = useState<DocumentEvent[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [fields, setFields] = useState<AgendaField[]>([]);
  const [allGroupNames, setAllGroupNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [tagDialog, setTagDialog] = useState(false);
  const [groupDialog, setGroupDialog] = useState<'assign' | 'create' | null>(null);
  const [tagCategory, setTagCategory] = useState<(typeof categories)[number]>('Tipo');
  const [tagValue, setTagValue] = useState('');
  const [groupValue, setGroupValue] = useState('');
  const [documentSearch, setDocumentSearch] = useState('');
  const [documentFilter, setDocumentFilter] = useState<
    'todos' | 'pendiente' | 'firmado' | 'rechazado'
  >('todos');
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
    const [noteResult, fieldResult, groupResult] = await Promise.all([
      client
        .from('contact_notes')
        .select('id,content,created_at,user_id')
        .eq('contact_id', contact.id)
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
      client
        .from('contact_custom_fields')
        .select('id,contact_id,field_name,field_value,created_at')
        .eq('contact_id', contact.id)
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
      client
        .from('contact_custom_fields')
        .select('field_value')
        .eq('user_id', userId)
        .eq('field_name', 'contact_group'),
    ]);
    if (noteResult.error || fieldResult.error || groupResult.error) throw new Error('agenda');
    setNotes(noteResult.data || []);
    setFields(fieldResult.data || []);
    setAllGroupNames(
      Array.from(
        new Set(
          (groupResult.data || [])
            .map((row) => row.field_value)
            .filter((value): value is string => Boolean(value))
        )
      ).sort((a, b) => a.localeCompare(b, 'es'))
    );
  }, [contact.id, userId]);

  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const client = createClient();
        const [agenda, docsResult, profileResult] = await Promise.allSettled([
          loadAgenda(),
          contact.email
            ? client
                .from('documentos')
                .select('id,nombre,estado,created_at,participantes')
                .eq('owner_id', user.id)
                .not('participantes', 'is', null)
            : Promise.resolve({ data: [], error: null }),
          contact.email
            ? client
                .from('user_profiles')
                .select(
                  'rfc,curp,regimen_fiscal,codigo_postal,estado,municipio,colonia,calle,num_exterior,num_interior'
                )
                .eq('email', contact.email)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        ]);
        if (!active) return;
        if (profileResult.status === 'fulfilled' && !profileResult.value.error)
          setProfile(profileResult.value.data);
        if (agenda.status === 'rejected')
          setNotice('No se pudieron cargar las notas y la organización de este contacto.');
        if (docsResult.status === 'fulfilled' && !docsResult.value.error) {
          const email = normalize(contact.email);
          const matched: Document[] = (docsResult.value.data || []).flatMap((row) => {
            const participant = Array.isArray(row.participantes)
              ? row.participantes.find((item: Participant) => normalize(item.email) === email)
              : null;
            return participant && normalize(row.estado) !== 'borrador'
              ? [
                  {
                    id: row.id,
                    nombre: row.nombre || 'Sin título',
                    estado: row.estado,
                    created_at: row.created_at,
                    participant,
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
        } else setNotice('No se pudo cargar la actividad documental de este contacto.');
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
      ).map(classifyTag),
    [contact.etiqueta_rol, contact.tags]
  );
  const groups = fields.filter(
    (field) => field.field_name === 'contact_group' && field.field_value
  );
  const importantIds = new Set(
    fields
      .filter((field) => field.field_name === 'note_important')
      .map((field) => field.field_value)
  );
  const firmados = documents.filter((document) => participantStatus(document) === 'firmado').length;
  const pendientes = documents.filter(
    (document) => participantStatus(document) === 'pendiente'
  ).length;
  const filteredDocuments = documents
    .filter(
      (document) =>
        (documentFilter === 'todos' || participantStatus(document) === documentFilter) &&
        (!documentSearch.trim() || normalize(document.nombre).includes(normalize(documentSearch)))
    )
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
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
      ...fields
        .filter((field) => field.field_name === 'contact_group' && field.field_value)
        .map((field) => ({
          id: field.id,
          date: field.created_at,
          label: 'Grupo asignado',
          detail: field.field_value || '',
          kind: 'group' as const,
        })),
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
  const saveTag = async () => {
    if (!user?.id || !tagValue.trim() || busy) return;
    const value = `${tagCategory}: ${tagValue.trim()}`;
    if (
      tags.some(
        (tag) => tag.category === tagCategory && normalize(tag.label) === normalize(tagValue)
      )
    ) {
      setTagDialog(false);
      return;
    }
    setBusy(true);
    setNotice('');
    const { error } = await createClient()
      .from('contacts')
      .update({ tags: [...(contact.tags || []), value] })
      .eq('id', contact.id)
      .eq('user_id', user.id);
    if (error) setNotice('No se pudo asignar la etiqueta.');
    else {
      await addHistory('Etiqueta asignada', value);
      await loadAgenda();
      onUpdated();
      setTagValue('');
      setTagDialog(false);
    }
    setBusy(false);
  };
  const removeTag = async (value: string) => {
    if (!user?.id || busy) return;
    setBusy(true);
    setNotice('');
    const isLegacyRole =
      value === `Tipo: ${contact.etiqueta_rol}` && !(contact.tags || []).includes(value);
    const changes = isLegacyRole
      ? { etiqueta_rol: null }
      : { tags: (contact.tags || []).filter((tag) => tag !== value) };
    const { error } = await createClient()
      .from('contacts')
      .update(changes)
      .eq('id', contact.id)
      .eq('user_id', user.id);
    if (error) setNotice('No se pudo quitar la etiqueta.');
    else {
      await addHistory('Etiqueta retirada', value);
      await loadAgenda();
      onUpdated();
    }
    setBusy(false);
  };
  const saveGroup = async () => {
    if (!user?.id || !groupValue.trim() || busy) return;
    const value = groupValue.trim();
    if (groups.some((field) => normalize(field.field_value) === normalize(value))) {
      setGroupDialog(null);
      return;
    }
    setBusy(true);
    setNotice('');
    const { error } = await createClient().from('contact_custom_fields').insert({
      contact_id: contact.id,
      user_id: user.id,
      field_name: 'contact_group',
      field_value: value,
    });
    if (error) setNotice('No se pudo asignar el grupo.');
    else {
      await loadAgenda();
      onUpdated();
      setGroupDialog(null);
      setGroupValue('');
    }
    setBusy(false);
  };
  const removeGroup = async (field: AgendaField) => {
    if (!user?.id || busy) return;
    setBusy(true);
    setNotice('');
    const { error } = await createClient()
      .from('contact_custom_fields')
      .delete()
      .eq('id', field.id)
      .eq('user_id', user.id)
      .eq('contact_id', contact.id);
    if (error) setNotice('No se pudo quitar el grupo.');
    else {
      await addHistory('Grupo retirado', field.field_value || '');
      await loadAgenda();
      onUpdated();
    }
    setBusy(false);
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

  const tabButton = (key: Tab, label: string) => (
    <button
      key={key}
      type="button"
      role="tab"
      aria-selected={tab === key}
      onClick={() => setTab(key)}
      className={
        'whitespace-nowrap border-b-2 px-4 py-3 text-sm transition-colors ' +
        (tab === key
          ? 'border-primary font-medium text-primary'
          : 'border-transparent text-slate-600 hover:text-primary')
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
  ) => {
    const Icon = icon;
    return (
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Icon size={17} className="text-primary" />
          {title}
        </h3>
        {action && (
          <button type="button" onClick={action} className="text-xs text-primary hover:underline">
            {actionLabel}
          </button>
        )}
      </div>
    );
  };
  const documentBadge = (document: Document) => {
    const status = participantStatus(document);
    const colors: Record<string, string> = {
      firmado: 'bg-emerald-50 text-emerald-700',
      pendiente: 'bg-amber-50 text-amber-700',
      rechazado: 'bg-red-50 text-red-700',
      cancelado: 'bg-slate-100 text-slate-600',
      otro: 'bg-blue-50 text-blue-700',
    };
    return (
      <span className={'rounded-full px-2.5 py-1 text-xs ' + colors[status]}>
        {status === 'otro'
          ? document.estado || 'En seguimiento'
          : status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };
  const tagCatalog = Array.from(
    new Set([
      ...tagOptions[tagCategory],
      ...catalogTags
        .map(classifyTag)
        .filter((tag) => tag.category === tagCategory)
        .map((tag) => tag.label),
    ])
  );

  return (
    <div className="app-page-bleed app-page-frame bg-[#f6f8fb] dark:bg-background">
      <div className="app-page-width">
        <button
          type="button"
          onClick={onClose}
          className="mb-5 flex items-center gap-1 text-sm text-slate-500 hover:text-primary"
        >
          <ChevronLeft size={16} /> Mis contactos <span className="mx-2">/</span>{' '}
          <span className="text-slate-700">{fullName(contact)}</span>
        </button>
        <header className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary text-xl font-semibold text-white">
              {initials(contact)}
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold text-slate-950">
                {fullName(contact)}
              </h1>
              <p className="text-sm text-slate-600">
                {contact.empresa || contact.tipo_persona || 'Contacto'}
              </p>
              <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
                {contact.email && (
                  <span className="flex items-center gap-1">
                    <Mail size={13} />
                    {contact.email}
                  </span>
                )}
                {contact.telefono && (
                  <span className="flex items-center gap-1">
                    <Phone size={13} />
                    {contact.telefono}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            disabled={!contact.email && !contact.telefono}
            onClick={() =>
              router.push(`/crear-documento?contact=${encodeURIComponent(contact.id)}`)
            }
            className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send size={16} /> Usar en nueva solicitud
          </button>
        </header>
        {notice && (
          <p
            role="alert"
            className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800"
          >
            {notice}
          </p>
        )}
        <div className="grid gap-4 lg:grid-cols-[290px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <section className={card}>
              {sectionTitle(Tag, 'Etiquetas', () => setTagDialog(true), 'Gestionar etiquetas')}
              <div className="space-y-2 p-4">
                {tags.length ? (
                  categories.map((category) => {
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
                              key={tag.label}
                              className="rounded-full bg-blue-50 px-2 py-1 text-primary"
                            >
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
                {tags
                  .filter((tag) => tag.category === 'Otros')
                  .map((tag) => (
                    <span
                      key={tag.label}
                      className="mr-1 inline-block rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600"
                    >
                      {tag.label}
                    </span>
                  ))}
              </div>
            </section>
            <section className={card}>
              {sectionTitle(Users, 'Grupos de contactos')}
              <div className="space-y-2 p-4">
                {groups.length ? (
                  groups.map((group) => (
                    <div
                      key={group.id}
                      className="flex items-center justify-between rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                    >
                      <span className="truncate">{group.field_value}</span>
                      <button
                        type="button"
                        onClick={() => void removeGroup(group)}
                        disabled={busy}
                        aria-label={`Quitar del grupo ${group.field_value}`}
                        className="ml-2 text-slate-400 hover:text-red-600"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">
                    Este contacto no pertenece a ningún grupo.
                  </p>
                )}
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setGroupValue('');
                      setGroupDialog('assign');
                    }}
                    className="rounded-md border border-slate-200 px-2 py-2 text-xs text-primary hover:bg-blue-50"
                  >
                    <Plus size={13} className="mr-1 inline" />
                    Asignar a grupo
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setGroupValue('');
                      setGroupDialog('create');
                    }}
                    className="rounded-md border border-slate-200 px-2 py-2 text-xs text-primary hover:bg-blue-50"
                  >
                    <Users size={13} className="mr-1 inline" />
                    Crear grupo
                  </button>
                </div>
              </div>
            </section>
            <section className={card}>
              {sectionTitle(FileText, 'Resumen rápido')}
              <dl className="px-4">
                <ReadOnlyRow label="Tipo de persona" value={contact.tipo_persona} />
                <ReadOnlyRow label="Empresa" value={contact.empresa} />
                <ReadOnlyRow label="Cargo" value={contact.cargo} />
                <ReadOnlyRow label="Agregado" value={dateOnly(contact.created_at)} />
              </dl>
            </section>
          </aside>
          <main className="min-w-0">
            <div
              role="tablist"
              aria-label="Ficha del contacto"
              className={card + ' mb-4 flex overflow-x-auto border-b-0 px-2'}
            >
              {tabButton('resumen', 'Resumen')}
              {tabButton('informacion', 'Información')}
              {tabButton('documentos', 'Documentos')}
              {tabButton('actividad', 'Actividad')}
              {tabButton('notas', 'Notas')}
              {tabButton('historial', 'Historial')}
            </div>
            {loading && (
              <div className={card + ' p-8 text-center text-sm text-slate-500'}>
                Cargando ficha del contacto…
              </div>
            )}
            {!loading && tab === 'resumen' && (
              <div className="space-y-4">
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
                      {documents
                        .slice()
                        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
                        .slice(0, 4)
                        .map((document) => (
                          <div key={document.id} className="flex items-center gap-3 py-3 text-sm">
                            <FileText size={17} className="shrink-0 text-primary" />
                            <span className="min-w-0 flex-1 truncate text-slate-800">
                              {document.nombre}
                            </span>
                            {documentBadge(document)}
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
              <div className="space-y-4">
                <section className={card}>
                  {sectionTitle(Users, 'Información de contacto')}
                  <dl className="grid gap-x-8 px-5 pb-2 md:grid-cols-2">
                    <ReadOnlyRow label="Tipo de persona" value={contact.tipo_persona} />
                    <ReadOnlyRow label="Nombre completo" value={fullName(contact)} />
                    <ReadOnlyRow label="Correo electrónico" value={contact.email} />
                    <ReadOnlyRow label="Teléfono" value={contact.telefono} />
                    <ReadOnlyRow label="Empresa" value={contact.empresa} />
                    <ReadOnlyRow label="Cargo" value={contact.cargo} />
                  </dl>
                </section>
                <section className={card}>
                  {sectionTitle(FileText, 'Datos fiscales')}
                  <dl className="grid gap-x-8 px-5 pb-2 md:grid-cols-2">
                    <ReadOnlyRow label="RFC" value={profile?.rfc || contact.rfc} />
                    <ReadOnlyRow label="CURP" value={profile?.curp || contact.curp} />
                    <ReadOnlyRow label="Régimen fiscal" value={profile?.regimen_fiscal} />
                  </dl>
                </section>
                <section className={card}>
                  {sectionTitle(MapPin, 'Dirección')}
                  <dl className="px-5 pb-2">
                    <ReadOnlyRow label="Dirección" value={contact.direccion} />
                    {profile && (
                      <div className="grid gap-x-8 md:grid-cols-2">
                        <ReadOnlyRow label="Código postal" value={profile.codigo_postal} />
                        <ReadOnlyRow label="Estado" value={profile.estado} />
                        <ReadOnlyRow label="Municipio o alcaldía" value={profile.municipio} />
                        <ReadOnlyRow label="Colonia" value={profile.colonia} />
                        <ReadOnlyRow label="Calle" value={profile.calle} />
                        <ReadOnlyRow label="Número exterior" value={profile.num_exterior} />
                        <ReadOnlyRow label="Número interior" value={profile.num_interior} />
                      </div>
                    )}
                  </dl>
                </section>
              </div>
            )}
            {!loading && tab === 'documentos' && (
              <section className={card}>
                {sectionTitle(FileText, 'Documentos del contacto')}
                <div className="flex flex-wrap gap-2 p-4">
                  <div className="relative min-w-[220px] flex-1">
                    <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
                    <input
                      type="search"
                      value={documentSearch}
                      onChange={(event) => setDocumentSearch(event.target.value)}
                      placeholder="Buscar documentos..."
                      className="h-9 w-full rounded-md border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-primary"
                    />
                  </div>
                  {(['todos', 'pendiente', 'firmado', 'rechazado'] as const).map((filter) => (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => setDocumentFilter(filter)}
                      className={
                        'rounded-md border px-3 text-xs ' +
                        (documentFilter === filter
                          ? 'border-primary/30 bg-blue-50 text-primary'
                          : 'border-slate-200 text-slate-600')
                      }
                    >
                      {filter === 'todos'
                        ? 'Todos'
                        : filter === 'pendiente'
                          ? 'Pendientes'
                          : filter === 'firmado'
                            ? 'Firmados'
                            : 'Rechazados'}
                    </button>
                  ))}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">Documento</th>
                        <th className="px-4 py-3 font-medium">Rol</th>
                        <th className="px-4 py-3 font-medium">Estado</th>
                        <th className="px-4 py-3 font-medium">Acción pendiente</th>
                        <th className="px-4 py-3 font-medium">Última actividad</th>
                        <th className="px-4 py-3 font-medium">Abrir</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredDocuments.map((document) => (
                        <tr key={document.id}>
                          <td className="px-4 py-3 font-medium text-slate-800">
                            {document.nombre}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {document.participant.rol ||
                              document.participant.role ||
                              'Participante'}
                          </td>
                          <td className="px-4 py-3">{documentBadge(document)}</td>
                          <td className="px-4 py-3 text-slate-600">
                            {participantStatus(document) === 'pendiente'
                              ? document.participant.accion || 'Participación pendiente'
                              : '—'}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-500">
                            {dateOnly(
                              documentEvents.find((event) => event.documento_id === document.id)
                                ?.created_at || document.created_at
                            )}
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
                  {!filteredDocuments.length && (
                    <p className="p-8 text-center text-sm text-slate-500">
                      No hay documentos que coincidan con los filtros.
                    </p>
                  )}
                </div>
                <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
                  Mostrando {filteredDocuments.length} de {documents.length} documentos
                </p>
              </section>
            )}
            {!loading && tab === 'actividad' && (
              <section className={card}>
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
              <section className={card}>
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
              <section className={card}>
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
                  <table className="w-full min-w-[580px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">Fecha</th>
                        <th className="px-4 py-3 font-medium">Evento</th>
                        <th className="px-4 py-3 font-medium">Detalle</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredHistory.map((event) => (
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
                  {!filteredHistory.length && (
                    <p className="p-8 text-center text-sm text-slate-500">
                      No hay registros en esta categoría.
                    </p>
                  )}
                </div>
              </section>
            )}
          </main>
        </div>
      </div>
      {(tagDialog || groupDialog) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setTagDialog(false);
              setGroupDialog(null);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={
              tagDialog
                ? 'Gestionar etiquetas'
                : groupDialog === 'create'
                  ? 'Crear grupo'
                  : 'Asignar a grupo'
            }
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">
                {tagDialog
                  ? 'Gestionar etiquetas'
                  : groupDialog === 'create'
                    ? 'Crear grupo'
                    : 'Asignar a grupo'}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setTagDialog(false);
                  setGroupDialog(null);
                }}
                aria-label="Cerrar"
                className="text-slate-500"
              >
                <X size={18} />
              </button>
            </div>
            {tagDialog ? (
              <>
                <div className="mb-4 space-y-2">
                  {tags.map((tag) => {
                    const value = tag.raw;
                    return (
                      <div
                        key={value}
                        className="flex items-center justify-between rounded-md border border-slate-100 px-3 py-2 text-sm"
                      >
                        <span>
                          {tag.category}: {tag.label}
                        </span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void removeTag(value)}
                          aria-label={`Quitar ${value}`}
                          className="text-slate-400 hover:text-red-600"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    );
                  })}
                </div>
                <label className="block text-xs text-slate-600">
                  Categoría
                  <select
                    value={tagCategory}
                    onChange={(event) => {
                      setTagCategory(event.target.value as typeof tagCategory);
                      setTagValue('');
                    }}
                    className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                  >
                    {categories.map((category) => (
                      <option key={category}>{category}</option>
                    ))}
                  </select>
                </label>
                <label className="mt-3 block text-xs text-slate-600">
                  Etiqueta
                  <input
                    list="contact-tag-options"
                    value={tagValue}
                    onChange={(event) => setTagValue(event.target.value)}
                    maxLength={80}
                    placeholder="Selecciona o escribe una etiqueta"
                    className="mt-1 h-9 w-full rounded-md border border-slate-200 px-3 text-sm"
                  />
                  <datalist id="contact-tag-options">
                    {tagCatalog.map((option) => (
                      <option key={option} value={option} />
                    ))}
                  </datalist>
                </label>
                <button
                  type="button"
                  disabled={!tagValue.trim() || busy}
                  onClick={() => void saveTag()}
                  className="mt-4 w-full rounded-md bg-primary px-4 py-2 text-sm text-white disabled:opacity-50"
                >
                  Asignar etiqueta
                </button>
              </>
            ) : (
              <>
                <p className="mb-3 text-sm text-slate-500">
                  Un contacto puede pertenecer a varios grupos.
                </p>
                {groupDialog === 'assign' && allGroupNames.length > 0 ? (
                  <label className="block text-xs text-slate-600">
                    Grupo existente
                    <select
                      value={groupValue}
                      onChange={(event) => setGroupValue(event.target.value)}
                      className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                    >
                      <option value="">Selecciona un grupo</option>
                      {allGroupNames
                        .filter(
                          (name) =>
                            !groups.some(
                              (group) => normalize(group.field_value) === normalize(name)
                            )
                        )
                        .map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                    </select>
                  </label>
                ) : (
                  <label className="block text-xs text-slate-600">
                    Nombre del grupo
                    <input
                      value={groupValue}
                      onChange={(event) => setGroupValue(event.target.value)}
                      maxLength={80}
                      placeholder="Ej. Proveedores frecuentes"
                      className="mt-1 h-9 w-full rounded-md border border-slate-200 px-3 text-sm"
                    />
                  </label>
                )}
                {groupDialog === 'assign' && !allGroupNames.length && (
                  <p className="mt-2 text-xs text-slate-500">
                    Aún no hay grupos. Escribe el nombre del primero.
                  </p>
                )}
                <button
                  type="button"
                  disabled={!groupValue.trim() || busy}
                  onClick={() => void saveGroup()}
                  className="mt-4 w-full rounded-md bg-primary px-4 py-2 text-sm text-white disabled:opacity-50"
                >
                  {groupDialog === 'create' ? 'Crear y asignar grupo' : 'Asignar grupo'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
