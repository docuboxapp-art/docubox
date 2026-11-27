'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  Users,
  Search,
  Plus,
  Check,
  LayoutGrid,
  LayoutList,
  ChevronDown,
  X,
  SlidersHorizontal,
  ArrowUpDown,
  Maximize2,
  Minimize2,
  Filter,
  UserPlus,
} from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import ResponsiveFilterBar from '@/components/ResponsiveFilterBar';
import { BottomNotice } from '@/components/ui/BottomNotice';
import { ProfileCommunicationButton } from '@/components/profiles/ProfileCommunication';
import { ContactRequestsPanel } from '@/components/profiles/ContactRequestsPanel';
import WorkspacePageHeader from '@/components/workspaces/WorkspacePageHeader';
import TablePagination, { useTablePagination } from '@/components/workspaces/TablePagination';
import { useColumnReorder } from '@/components/workspaces/useColumnReorder';
import PersonalizarVistaModal from '@/app/mis-documentos/components/PersonalizarVistaModal';
import { createClient } from '@/lib/supabase/client';
import { compareTableValues } from '@/lib/workspaces/list-order';
import { moveViewColumn } from '@/lib/workspaces/view-order';
import { useAuth } from '@/contexts/AuthContext';
import { normalizeContactEmail } from '@/lib/contacts/detail';
import { useContactRequests } from '@/lib/profile-privacy/useContactRequests';
import {
  contactName,
  contactTags,
  EMPTY_CONTACT_SUMMARY,
  summarizeContactDocuments,
  type AgendaContact,
  type AgendaDocument,
} from '@/lib/contacts/agenda';
import { DEFAULT_CONTACT_VIEW, type ContactFilterId } from '@/lib/contacts/view-preferences';
import {
  applyContactGroupChange,
  loadContactGroups,
  type ContactGroupChange,
  type ContactGroups,
} from '@/lib/contacts/groups';
import ContactDetailWorkspace from './ContactDetailWorkspace';
import { ContactAgendaSidebar, type ContactScope } from './ContactAgendaSidebar';
import {
  ContactAgendaCard,
  ContactAgendaTable,
  contactSortColumns,
  type ContactAgendaRow,
  type ContactSort,
} from './ContactAgendaTable';
import { ContactGroupDeleteDialog } from './ContactGroupDeleteDialog';
import { ContactGroupEditorDialog } from './ContactGroupEditorDialog';
import { ContactQuickPreview, type ContactPreviewNote } from './ContactQuickPreview';
import { ContactEditorDialog } from './contact-detail-ui';
import { AddContactDialog } from './AddContactDialog';
import { useContactView } from './useContactView';

const CONTACT_FAVORITES_KEY = 'contactos';
const EMPTY_FILTERS: Record<ContactFilterId, string> = {
  tipo: '',
  favoritos: '',
  pendientes: '',
  etiqueta: '',
  grupo: '',
  seguimiento: '',
};
const EMPTY_DOCUMENTS: AgendaDocument[] = [];
const contactKind = (contact: AgendaContact) =>
  /moral|empresa/i.test(contact.tipo_persona || '') ? 'empresas' : 'personas';

const contactSortPresets = [
  { column: 'contacto', direction: 'asc', label: 'Nombre A–Z' },
  { column: 'contacto', direction: 'desc', label: 'Nombre Z–A' },
  { column: 'alta', direction: 'desc', label: 'Más recientes' },
  { column: 'alta', direction: 'asc', label: 'Más antiguos' },
] as const;

function ContactFilterMenu({
  label,
  value,
  options,
  allLabel,
  open,
  disabled = false,
  onToggle,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  allLabel: string;
  open: boolean;
  disabled?: boolean;
  onToggle: () => void;
  onChange: (value: string) => void;
}) {
  const selectedLabel = options.find((option) => option.value === value)?.label || value;
  return (
    <div className="relative">
      <div
        className={
          'group flex min-h-8 max-w-full items-center rounded-md border text-xs font-normal transition-colors sm:max-w-[28rem] ' +
          (disabled
            ? 'border-border bg-card opacity-60'
            : value
              ? 'border-primary/25 bg-primary/5 text-primary'
              : 'border-border bg-card hover:bg-muted')
        }
      >
        <button
          type="button"
          onClick={onToggle}
          disabled={disabled}
          aria-expanded={open}
          aria-haspopup="menu"
          data-active={!disabled && Boolean(value)}
          className="workspace-filter-trigger flex min-h-8 min-w-0 items-center gap-1 px-2.5 py-1 text-left font-normal disabled:cursor-not-allowed"
        >
          <span className="min-w-0 whitespace-normal break-words">
            {label}
            {value && <span className="filter-selected-value">: {selectedLabel}</span>}
          </span>
          <ChevronDown size={13} className="shrink-0" aria-hidden="true" />
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label={`Quitar filtro ${label}`}
            title={`Quitar filtro ${label}`}
            className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-primary/70 transition-colors hover:bg-primary/10 hover:text-primary"
          >
            <X size={12} aria-hidden="true" />
          </button>
        )}
      </div>
      {open && (
        <div
          role="menu"
          aria-label={`Filtrar por ${label.toLowerCase()}`}
          className="absolute left-0 top-full z-[200] mt-1 max-h-[60vh] min-w-44 max-w-64 overflow-y-auto rounded-lg border border-border bg-card py-1 font-normal shadow-lg"
        >
          {[{ value: '', label: allLabel }, ...options].map(
            ({ value: optionValue, label: optionLabel }) => (
              <button
                key={optionValue}
                type="button"
                role="menuitemradio"
                aria-checked={value === optionValue}
                onClick={() => onChange(optionValue)}
                className={
                  'workspace-filter-option flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted ' +
                  (value === optionValue ? 'bg-primary/5' : '')
                }
              >
                <span className="w-4 shrink-0">
                  {value === optionValue && <Check size={14} aria-hidden="true" />}
                </span>
                <span className="break-words">{optionLabel}</span>
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
export default function ContactosPage() {
  return (
    <React.Suspense fallback={null}>
      <ContactosContent />
    </React.Suspense>
  );
}

function ContactosContent() {
  const { user } = useAuth();
  return <ContactAgenda key={user?.id} userId={user?.id} />;
}

function ContactAgenda({ userId }: { userId?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = useContactView(userId);
  const [contacts, setContacts] = useState<AgendaContact[]>([]);
  const contactLoad = useRef(0);
  const lastApprovedContacts = useRef<string | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => new Set());
  const [favoritesReady, setFavoritesReady] = useState(false);
  const [favoritePendingId, setFavoritePendingId] = useState<string | null>(null);
  const [favoriteNotice, setFavoriteNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [documentResult, setDocumentResult] = useState<{
    owner: string;
    rows: AgendaDocument[];
    error: boolean;
  } | null>(null);
  const [documentRequest, setDocumentRequest] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [groupState, setGroupState] = useState<{
    userId: string;
    collection: ContactGroups | null;
    failed: boolean;
  } | null>(null);
  const groupRequest = useRef(0);
  const [sort, setSort] = useState<ContactSort>(contactSortPresets[0]);
  const [showSort, setShowSort] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [openFilterDropdown, setOpenFilterDropdown] = useState<
    ContactFilterId | 'aplicados' | null
  >(null);
  const filterDropdownRef = useRef<HTMLElement>(null);
  const [isWideView, setIsWideView] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const showRequests = searchParams.get('vista') === 'solicitudes';
  const requests = useContactRequests({ enabled: Boolean(userId), watch: showRequests, userId });
  const approvedContacts = requests.data
    ? requests.data.sent
        .flatMap(({ contactId }) => (contactId ? [contactId] : []))
        .sort()
        .join(',')
    : null;
  const pendingIncoming =
    requests.data?.received.filter(({ status }) => status === 'pending').length ?? 0;
  const requestCount = pendingIncoming + requests.acceptedUnread;
  const requestCountLabel = [
    pendingIncoming === 1 ? '1 recibida pendiente' : pendingIncoming > 1 ? `${pendingIncoming} recibidas pendientes` : '',
    requests.acceptedUnread === 1
      ? '1 enviada aceptada'
      : requests.acceptedUnread > 1 ? `${requests.acceptedUnread} enviadas aceptadas` : '',
  ].filter(Boolean).join(' · ');
  const [groupDialog, setGroupDialog] = useState<
    { type: 'create' } | { type: 'edit' | 'delete'; groupId: string } | null
  >(null);
  const [agendaNotice, setAgendaNotice] = useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [viewingContactId, setViewingContactId] = useState<string | null>(null);
  const [previewNotes, setPreviewNotes] = useState<{
    owner: string;
    contactId: string;
    rows: ContactPreviewNote[];
    error: boolean;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AgendaContact | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const deleteRequest = useRef(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');

  useEffect(() => {
    if (!openFilterDropdown) return;
    const closeOutside = (event: PointerEvent) => {
      if (!filterDropdownRef.current?.contains(event.target as Node)) setOpenFilterDropdown(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenFilterDropdown(null);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [openFilterDropdown]);

  const loadContacts = useCallback(async (background = false) => {
    if (!userId) return;
    const revision = ++contactLoad.current;
    if (!background) setLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .eq('user_id', userId)
        .order('nombre', { ascending: true });
      if (error || !data) return;
      if (revision === contactLoad.current) setContacts(data);
      return data;
    } catch {
      /* Keep the current agenda if the request fails. */
    } finally {
      if (revision === contactLoad.current) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (approvedContacts === null) return;
    const previous = lastApprovedContacts.current;
    lastApprovedContacts.current = approvedContacts;
    if (previous !== null && previous !== approvedContacts) void loadContacts(true);
  }, [approvedContacts, loadContacts]);

  const loadGroups = useCallback(async () => {
    if (!userId) return;
    const request = ++groupRequest.current;
    try {
      const collection = await loadContactGroups(createClient(), userId);
      if (request === groupRequest.current) setGroupState({ userId, collection, failed: false });
    } catch {
      if (request === groupRequest.current) {
        setGroupState((current) => ({
          userId,
          collection: current && current.userId === userId ? current.collection : null,
          failed: true,
        }));
      }
    }
  }, [userId]);

  const updateGroups = (change: ContactGroupChange) => {
    groupRequest.current++;
    setGroupState((current) =>
      current && current.userId === userId && current.collection
        ? { ...current, collection: applyContactGroupChange(current.collection, change) }
        : current
    );
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadContacts();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadContacts]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadGroups();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadGroups]);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    const loadFavorites = async () => {
      try {
        const { data, error } = await createClient()
          .from('user_favorites')
          .select('item_id')
          .eq('user_id', userId)
          .eq('storage_key', CONTACT_FAVORITES_KEY);
        if (!active) return;
        if (error) throw error;
        setFavoriteIds(new Set((data || []).map((row) => row.item_id)));
        setFavoritesReady(true);
      } catch {
        if (active) setFavoriteNotice('No se pudieron cargar tus contactos favoritos.');
      }
    };
    void loadFavorites();
    return () => {
      active = false;
    };
  }, [userId]);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    async function loadDocuments(owner: string) {
      try {
        const client = createClient();
        const rows: AgendaDocument[] = [];
        const batchSize = 500;
        for (let offset = 0; active; offset += batchSize) {
          const { data, error } = await client
            .from('documentos')
            .select(
              'id,nombre,estado,created_at,participantes,fecha_vencimiento,tiene_vencimiento,priority,es_urgente'
            )
            .eq('owner_id', owner)
            .not('participantes', 'is', null)
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .order('id')
            .range(offset, offset + batchSize - 1);
          if (error) throw error;
          rows.push(...((data || []) as AgendaDocument[]));
          if (!data || data.length < batchSize) break;
        }
        if (active) {
          setDocumentResult({ owner, rows, error: false });
          setNow(Date.now());
        }
      } catch {
        if (active) setDocumentResult({ owner, rows: [], error: true });
      }
    }
    void loadDocuments(userId);
    return () => {
      active = false;
    };
  }, [userId, documentRequest]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!contacts.length || typeof window === 'undefined') return;
    const contactId = new URLSearchParams(window.location.search).get('contact');
    if (contactId && contacts.some((contact) => contact.id === contactId)) {
      const timer = window.setTimeout(() => setPreviewId(contactId), 0);
      return () => window.clearTimeout(timer);
    }
  }, [contacts]);
  useEffect(() => {
    if (!previewId || !userId) return;
    let active = true;
    async function loadNotes(owner: string, contactId: string) {
      try {
        const { data, error } = await createClient()
          .from('contact_notes')
          .select('id,content,created_at')
          .eq('user_id', owner)
          .eq('contact_id', contactId)
          .order('created_at', { ascending: false })
          .limit(8);
        if (error) throw error;
        if (active) setPreviewNotes({ owner, contactId, rows: data || [], error: false });
      } catch {
        if (active) setPreviewNotes({ owner, contactId, rows: [], error: true });
      }
    }
    void loadNotes(userId, previewId);
    return () => {
      active = false;
    };
  }, [previewId, userId]);

  const currentDocuments = documentResult?.owner === userId ? documentResult : null;
  const documents = currentDocuments?.rows || EMPTY_DOCUMENTS;
  const documentsLoaded = Boolean(currentDocuments && !currentDocuments.error);
  const documentsError = Boolean(currentDocuments?.error);
  const summaries = useMemo(() => summarizeContactDocuments(documents, now), [documents, now]);

  const currentGroupState = groupState?.userId === userId ? groupState : null;
  const contactGroups = currentGroupState?.collection ?? null;
  const currentContactIds = new Set(contacts.map((contact) => contact.id));
  const groupsByContact = new Map<string, string[]>();
  const agendaGroups =
    contactGroups?.groups.map((group) => {
      let count = 0;
      for (const member of group.members) {
        if (!currentContactIds.has(member.contactId)) continue;
        count++;
        const names = groupsByContact.get(member.contactId) || [];
        names.push(group.name);
        groupsByContact.set(member.contactId, names);
      }
      return { id: group.id, name: group.name, icon: group.icon, count };
    }) ?? null;
  const activeGroup = contactGroups?.groups.find((group) => group.id === filters.grupo);
  const managedGroup = groupDialog && 'groupId' in groupDialog
    ? contactGroups?.groups.find((group) => group.id === groupDialog.groupId)
    : undefined;
  const groupContactIds = new Set(activeGroup?.members.map((member) => member.contactId));
  const agendaRows: ContactAgendaRow[] = contacts.map((contact, index) => ({
    contact,
    index,
    summary: summaries.get(normalizeContactEmail(contact.email)) || EMPTY_CONTACT_SUMMARY,
    groups: groupsByContact.get(contact.id) || [],
    favorite: favoriteIds.has(contact.id),
  }));
  const favoriteCount = agendaRows.filter((row) => row.favorite).length;
  const followUpCount = agendaRows.filter(({ summary }) => summary.followUp).length;
  const tags = [...new Set(contacts.flatMap(contactTags))].sort((a, b) => a.localeCompare(b, 'es'));
  const normalizedSearch = search.trim().toLocaleLowerCase('es-MX');
  const sortValue = contactSortColumns[sort.column]?.value;
  const filtered = agendaRows
    .filter(({ contact, summary, favorite }) => {
      const haystack = [
        contactName(contact),
        contact.email,
        contact.telefono,
        contact.rfc,
        ...contactTags(contact),
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('es-MX');
      return (
        (!normalizedSearch || haystack.includes(normalizedSearch)) &&
        (!filters.tipo || contactKind(contact) === filters.tipo) &&
        (!filters.favoritos || favorite) &&
        (!filters.pendientes || summary.pending > 0) &&
        (!filters.etiqueta || contactTags(contact).includes(filters.etiqueta)) &&
        (!activeGroup || groupContactIds.has(contact.id)) &&
        (!filters.seguimiento || summary.followUp !== null)
      );
    })
    .sort((a, b) => {
      const order = sortValue ? compareTableValues(sortValue(a), sortValue(b), sort.direction) : 0;
      return (
        order ||
        contactName(a.contact).localeCompare(contactName(b.contact), 'es') ||
        a.contact.id.localeCompare(b.contact.id)
      );
    });

  function changeSort(next: ContactSort) {
    setSort(next);
    setPage(1);
    setShowSort(false);
  }

  const pagination = useTablePagination(filtered.length);
  const setPage = pagination.onPageChange;
  const visible = filtered.slice(pagination.start, pagination.end);
  const previewRow = agendaRows.find((row) => row.contact.id === previewId);
  const notesResult =
    previewNotes?.owner === userId && previewNotes?.contactId === previewId ? previewNotes : null;
  const options: Record<
    ContactFilterId,
    { all: string; entries: { value: string; label: string }[]; disabled?: boolean }
  > = {
    tipo: {
      all: 'Todos los tipos',
      entries: [
        { value: 'personas', label: 'Personas' },
        { value: 'empresas', label: 'Empresas' },
      ],
    },
    favoritos: {
      all: 'Todos los contactos',
      entries: [{ value: 'favorites', label: 'Solo favoritos' }],
      disabled: !favoritesReady,
    },
    pendientes: {
      all: 'Todos los contactos',
      entries: [{ value: 'pending', label: 'Con pendientes' }],
      disabled: !documentsLoaded,
    },
    etiqueta: {
      all: 'Todas las etiquetas',
      entries: tags.map((tag) => ({ value: tag, label: tag })),
    },
    grupo: {
      all: 'Todos los grupos',
      entries: (agendaGroups || []).map((group) => ({ value: group.id, label: group.name })),
      disabled: !agendaGroups,
    },
    seguimiento: {
      all: 'Todos los contactos',
      entries: [{ value: 'active', label: 'En seguimiento' }],
      disabled: !documentsLoaded,
    },
  };
  const activeFilterSelections = view.value.filters.flatMap(({ id, label }) => {
    const entry = filters[id] && options[id].entries.find((item) => item.value === filters[id]);
    return entry ? [{ key: id, label: `${label}: ${entry.label}` }] : [];
  });
  const activeFilterCount = activeFilterSelections.length;
  const scope: ContactScope = activeGroup
    ? 'group'
    : filters.seguimiento
      ? 'follow-up'
      : filters.favoritos
        ? 'favorites'
        : 'all';
  const visibleFields = view.value.columns.filter((field) => field.visible);
  const columnReorder = useColumnReorder(
    visibleFields,
    view.ready && !customizeOpen
      ? async (from, to) => {
          const columns = moveViewColumn(view.value.columns, from, to);
          if (columns) await view.save({ ...view.value, columns });
        }
      : undefined
  );
  const cardFields = view.value.gridColumns.filter((field) => field.selected);
  const visibleFilters = view.value.filters.filter((field) => field.visible);

  function selectOnly(values: Partial<typeof EMPTY_FILTERS> = {}) {
    setFilters({ ...EMPTY_FILTERS, ...values });
    setPage(1);
    setOpenFilterDropdown(null);
  }

  function selectScope(value: Exclude<ContactScope, 'group'>) {
    if (value === 'favorites') selectOnly({ favoritos: 'favorites' });
    else if (value === 'follow-up') selectOnly({ seguimiento: 'active' });
    else selectOnly();
  }

  function applyFilter(key: ContactFilterId, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
    setOpenFilterDropdown(null);
  }

  function openPreview(contact: AgendaContact) {
    if (previewId === contact.id) {
      closePreview();
      return;
    }
    setPreviewId(contact.id);
    window.history.replaceState(null, '', '/contactos?contact=' + encodeURIComponent(contact.id));
  }

  function closePreview() {
    setPreviewId(null);
    window.history.replaceState(null, '', '/contactos');
  }

  function openFullContact(contact: AgendaContact) {
    if (previewId) closePreview();
    setFavoriteNotice('');
    setViewingContactId(contact.id);
  }

  function openRequests() {
    router.push('/contactos?vista=solicitudes');
    requests.reload();
  }

  function handleContactRequest(status: 'pending' | 'approved' | 'saved') {
    setShowSearchModal(false);
    if (status === 'pending') {
      openRequests();
      toast.success('Solicitud enviada. El contacto se agregará cuando la persona la apruebe.');
    } else {
      requests.reload();
      void loadContacts(true);
      toast.success('Contacto agregado a tu agenda.');
    }
  }

  async function openApprovedContact(contactId: string) {
    const contact =
      contacts.find(({ id }) => id === contactId) ??
      (await loadContacts(true))?.find(({ id }) => id === contactId);
    if (!contact) {
      requests.reload();
      toast.error('No se pudo abrir el contacto. Actualiza la agenda e inténtalo de nuevo.');
      return;
    }
    router.replace('/contactos');
    openFullContact(contact);
  }

  const toggleFavorite = async (contact: AgendaContact) => {
    if (!userId || !favoritesReady || favoritePendingId) return;
    const wasFavorite = favoriteIds.has(contact.id);
    setFavoritePendingId(contact.id);
    setFavoriteNotice('');
    setFavoriteIds((current) => {
      const next = new Set(current);
      if (wasFavorite) next.delete(contact.id);
      else next.add(contact.id);
      return next;
    });
    try {
      const supabase = createClient();
      const operation = wasFavorite
        ? supabase
            .from('user_favorites')
            .delete()
            .eq('user_id', userId)
            .eq('storage_key', CONTACT_FAVORITES_KEY)
            .eq('item_id', contact.id)
        : supabase
            .from('user_favorites')
            .upsert(
              { user_id: userId, storage_key: CONTACT_FAVORITES_KEY, item_id: contact.id },
              { onConflict: 'user_id,storage_key,item_id' }
            );
      const { error } = await operation;
      if (error) throw error;
    } catch {
      setFavoriteIds((current) => {
        const next = new Set(current);
        if (wasFavorite) next.add(contact.id);
        else next.delete(contact.id);
        return next;
      });
      setFavoriteNotice('No fue posible actualizar este contacto favorito.');
    } finally {
      setFavoritePendingId(null);
    }
  };
  const handleDelete = async () => {
    if (!userId || !deleteTarget || deleteRequest.current) return;
    const { id } = deleteTarget;
    deleteRequest.current = true;
    setDeleting(true);
    setDeleteError('');
    try {
      const { data, error } = await createClient()
        .from('contacts')
        .delete()
        .eq('id', id)
        .eq('user_id', userId)
        .select('id')
        .maybeSingle();
      if (error || !data) throw new Error('No se pudo confirmar la eliminación.');
      setContacts((previous) => previous.filter((contact) => contact.id !== id));
      void loadGroups();
      setFavoriteIds((previous) => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
      if (previewId === id) closePreview();
      setDeleteTarget(null);
      setAgendaNotice('Contacto eliminado.');
    } catch {
      setDeleteError('No se pudo eliminar el contacto. Intenta de nuevo.');
    } finally {
      deleteRequest.current = false;
      setDeleting(false);
    }
  };

  const actions = {
    favoritesEnabled: favoritesReady && !favoritePendingId,
    onPreview: openPreview,
    onOpen: openFullContact,
    onFavorite: (contact: AgendaContact) => void toggleFavorite(contact),
    onDelete: (contact: AgendaContact) => {
      setDeleteError('');
      setDeleteTarget(contact);
    },
  };
  const viewingContact = contacts.find((contact) => contact.id === viewingContactId);
  if (viewingContact && !showRequests) {
    const contact = viewingContact;
    return (
      <AppLayout noPadding>
        <ContactDetailWorkspace
          key={contact.id}
          contact={contact}
          onClose={() => {
            setViewingContactId(null);
            setDocumentRequest((request) => request + 1);
          }}
          onUpdated={() => void loadContacts()}
          contactGroups={contactGroups}
          groupsLoadError={Boolean(currentGroupState?.failed)}
          onReloadGroups={() => void loadGroups()}
          onGroupChange={updateGroups}
          catalogTags={contacts.flatMap(contactTags)}
          relatedContacts={contacts.map((item) => ({
            id: item.id,
            name: contactName(item),
            email: item.email,
          }))}
          onOpenContact={(id) => {
            const related = contacts.find((item) => item.id === id);
            if (related) openFullContact(related);
          }}
          favorite={favoriteIds.has(contact.id)}
          canFavorite={favoritesReady && !favoritePendingId}
          favoriteError={favoriteNotice}
          onFavorite={() => void toggleFavorite(contact)}
        />
      </AppLayout>
    );
  }

  const toolbarButton =
    'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-primary disabled:opacity-45';

  if (showRequests) {
    return (
      <AppLayout noPadding>
        <div className="app-page-frame app-page-bleed bg-[#f6f8fb] dark:bg-background">
          <div className="app-page-width space-y-4">
            <WorkspacePageHeader
              title="Solicitudes de contacto"
              description="Gestiona quién quiere agregarte y consulta el estado de tus solicitudes."
            >
              <Link href="/mi-perfil?section=privacidad" className={toolbarButton}>
                Configurar privacidad
              </Link>
              <button
                type="button"
                className={toolbarButton}
                onClick={() => {
                  setViewingContactId(null);
                  router.push('/contactos');
                  void loadContacts(true);
                }}
              >
                Volver a contactos
              </button>
            </WorkspacePageHeader>
            <ContactRequestsPanel {...requests} onOpenContact={(id) => void openApprovedContact(id)} />
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout noPadding>
      <div
        className={`app-page-frame bg-[#f6f8fb] dark:bg-background ${isWideView ? 'fixed inset-0 z-[100] overflow-y-auto' : 'app-page-bleed'}`}
      >
        <div
          className={
            isWideView
              ? 'w-full min-w-0'
              : 'app-page-width xl:flex xl:min-h-[calc(100dvh-var(--app-header-height)-2*var(--app-page-top))] xl:flex-col'
          }
        >
          <WorkspacePageHeader
            title="Contactos"
            description="Gestiona tu agenda y consulta los documentos compartidos."
          >
            {userId && (
              <button
                type="button"
                className={toolbarButton}
                onClick={openRequests}
                title={requestCountLabel || undefined}
                aria-label={requestCountLabel ? `Solicitudes de contacto · ${requestCountLabel}` : undefined}
              >
                <UserPlus size={15} aria-hidden="true" /> Solicitudes de contacto
                {requestCount > 0 && (
                  <span
                    aria-hidden="true"
                    className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground tabular-nums"
                  >
                    {requestCount > 99 ? '99+' : requestCount}
                  </span>
                )}
              </button>
            )}
            <ProfileCommunicationButton label="Mensajes y notas" />
            <button
              type="button"
              onClick={() => setShowSearchModal(true)}
              className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
            >
              <Plus size={16} aria-hidden="true" /> Agregar contacto
            </button>
          </WorkspacePageHeader>
          {favoriteNotice && <BottomNotice message={favoriteNotice} tone="critical" onClose={() => setFavoriteNotice('')} />}
          <div className="flex min-w-0 flex-col gap-4 xl:flex-1 xl:flex-row xl:gap-7">
            {!isWideView && (
              <ContactAgendaSidebar
                scope={scope}
                groupId={activeGroup?.id}
                groups={agendaGroups}
                groupsError={Boolean(currentGroupState?.failed)}
                canCreateGroup={Boolean(userId && contactGroups)}
                counts={{
                  all: loading ? undefined : contacts.length,
                  favorites: favoritesReady && !loading ? favoriteCount : undefined,
                  followUp: documentsLoaded && !loading ? followUpCount : undefined,
                }}
                onScope={selectScope}
                onGroup={(id) => selectOnly({ grupo: id })}
                onRetry={() => void loadGroups()}
                onCreateGroup={() => setGroupDialog({ type: 'create' })}
                onEditGroup={(groupId) => setGroupDialog({ type: 'edit', groupId })}
                onDeleteGroup={(groupId) => setGroupDialog({ type: 'delete', groupId })}
              />
            )}
            <div className="flex min-w-0 flex-1 items-start gap-4">
              <main className="min-w-0 flex-1">
                <section
                  ref={filterDropdownRef}
                  className="case-toolbar mb-3 rounded-lg border border-border bg-card shadow-sm"
                  aria-label="Buscar y filtrar contactos"
                >
                  <div className="flex flex-wrap items-center gap-2 p-3">
                    <div className="case-toolbar-search relative min-w-[160px] flex-1">
                      <Search
                        size={15}
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <input
                        type="search"
                        value={search}
                        onChange={(event) => {
                          setSearch(event.target.value);
                          setPage(1);
                        }}
                        placeholder="Buscar contactos…"
                        aria-label="Buscar contactos por nombre, correo, teléfono o RFC"
                        className="h-9 w-full rounded-md border border-border bg-muted/50 pl-9 pr-9 text-sm focus:border-primary focus:bg-card focus:outline-none focus:ring-2 focus:ring-primary/15 [&::-webkit-search-cancel-button]:appearance-none"
                      />
                      {search && (
                        <button
                          type="button"
                          onClick={() => {
                            setSearch('');
                            setPage(1);
                          }}
                          aria-label="Borrar búsqueda"
                          className="absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <X size={14} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    {activeFilterCount > 0 && (
                      <div className="relative shrink-0">
                        <div className="flex min-h-9 items-center rounded-md border border-primary/25 bg-card text-xs text-primary">
                          <button
                            type="button"
                            onClick={() =>
                              setOpenFilterDropdown((current) =>
                                current === 'aplicados' ? null : 'aplicados'
                              )
                            }
                            aria-expanded={openFilterDropdown === 'aplicados'}
                            aria-label={`Filtros aplicados: ${activeFilterCount}`}
                            data-active="true"
                            className="workspace-filter-pill workspace-filter-trigger flex items-center gap-1.5 self-stretch px-2"
                          >
                            <Filter size={13} aria-hidden="true" /> <span>Filtros aplicados</span>
                            <span className="filter-selected-value">({activeFilterCount})</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => selectOnly()}
                            aria-label="Quitar todos los filtros"
                            title="Quitar todos los filtros"
                            className="grid size-8 place-items-center border-l border-primary/25 text-primary/70 hover:bg-primary/5 hover:text-primary"
                          >
                            <X size={14} aria-hidden="true" />
                          </button>
                        </div>
                        {openFilterDropdown === 'aplicados' && (
                          <div
                            role="group"
                            aria-label="Criterios aplicados"
                            className="absolute left-0 top-full z-[200] mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card p-1.5 shadow-lg"
                          >
                            {activeFilterSelections.map(({ key, label }) => (
                              <div
                                key={key}
                                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                              >
                                <span className="min-w-0 flex-1 break-words">{label}</span>
                                <button
                                  type="button"
                                  onClick={() => applyFilter(key, '')}
                                  aria-label={`Quitar ${label}`}
                                  className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted"
                                >
                                  <X size={14} aria-hidden="true" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <div
                      className="relative"
                      onBlur={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget)) setShowSort(false);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') setShowSort(false);
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setShowSort((open) => !open)}
                        aria-expanded={showSort}
                        aria-haspopup="menu"
                        className={toolbarButton}
                      >
                        <ArrowUpDown size={14} aria-hidden="true" /> Ordenar
                      </button>
                      {showSort && (
                        <div
                          role="menu"
                          aria-label="Ordenar contactos"
                          className="absolute left-0 top-full z-30 mt-1 w-44 rounded-lg border border-border bg-card py-1 shadow-lg"
                        >
                          {contactSortPresets.map(({ column, direction, label }) => {
                            const selected = sort.column === column && sort.direction === direction;
                            return (
                              <button
                                key={label}
                                type="button"
                                role="menuitemradio"
                                aria-checked={selected}
                                onClick={() => changeSort({ column, direction })}
                                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted ${selected ? 'text-primary' : 'text-foreground'}`}
                              >
                                <span className="w-4">
                                  {selected && <Check size={14} aria-hidden="true" />}
                                </span>
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div className="inline-flex min-h-9 items-center rounded-md border border-border bg-card p-0.5">
                      {(
                        [
                          { mode: 'list', label: 'Vista de lista', icon: LayoutList },
                          { mode: 'grid', label: 'Vista de cuadrícula', icon: LayoutGrid },
                        ] as const
                      ).map(({ mode, label, icon: Icon }) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setViewMode(mode)}
                          aria-label={label}
                          aria-pressed={viewMode === mode}
                          className={`grid h-8 w-9 place-items-center rounded focus-visible:outline-primary ${viewMode === mode ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60'}`}
                        >
                          <Icon size={16} aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setOpenFilterDropdown(null);
                        setCustomizeOpen(true);
                      }}
                      aria-label="Personalizar vista"
                      aria-haspopup="dialog"
                      title="Personalizar vista"
                      disabled={!view.ready || columnReorder.saving}
                      className={toolbarButton}
                    >
                      <SlidersHorizontal size={16} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsWideView((wide) => !wide)}
                      aria-label={isWideView ? 'Salir de vista amplia' : 'Vista amplia'}
                      title={isWideView ? 'Salir de vista amplia' : 'Vista amplia'}
                      className={toolbarButton}
                    >
                      {isWideView ? (
                        <Minimize2 size={16} aria-hidden="true" />
                      ) : (
                        <Maximize2 size={16} aria-hidden="true" />
                      )}
                    </button>
                  </div>
                  {visibleFilters.length > 0 && (
                    <ResponsiveFilterBar>
                      <div className="mis-documentos-filters flex flex-wrap items-center gap-2 border-t border-border bg-muted/40 px-3 py-2.5">
                        {visibleFilters.map(({ id, label }) => (
                          <ContactFilterMenu
                            key={id}
                            label={label}
                            value={id === 'grupo' ? activeGroup?.id || '' : filters[id]}
                            options={options[id].entries}
                            allLabel={options[id].all}
                            disabled={options[id].disabled}
                            open={openFilterDropdown === id}
                            onToggle={() =>
                              setOpenFilterDropdown((current) => (current === id ? null : id))
                            }
                            onChange={(value) => applyFilter(id, value)}
                          />
                        ))}
                      </div>
                    </ResponsiveFilterBar>
                  )}
                </section>
                {view.error && (
                  <p role="status" className="mb-3 text-sm text-muted-foreground">
                    No se pudo cargar la personalización.{' '}
                    <button
                      type="button"
                      onClick={view.retry}
                      className="font-medium text-primary hover:underline"
                    >
                      Reintentar
                    </button>
                  </p>
                )}
                {documentsError && (
                  <p role="status" className="mb-3 text-sm text-muted-foreground">
                    No se pudo cargar el seguimiento documental.{' '}
                    <button
                      type="button"
                      onClick={() => setDocumentRequest((request) => request + 1)}
                      className="font-medium text-primary hover:underline"
                    >
                      Reintentar
                    </button>
                  </p>
                )}
                {view.widthError && (
                  <p role="status" className="mb-3 text-sm text-muted-foreground">
                    No se pudo guardar el ancho de las columnas.{' '}
                    <button
                      type="button"
                      onClick={view.retryWidths}
                      className="font-medium text-primary hover:underline"
                    >
                      Reintentar
                    </button>
                  </p>
                )}
                {columnReorder.error && (
                  <p role="alert" className="mb-3 text-sm text-destructive">{columnReorder.error}</p>
                )}
                {loading ? (
                  <div
                    role="status"
                    className="rounded-lg border border-border bg-card py-24 text-center text-sm text-muted-foreground"
                  >
                    Cargando contactos…
                  </div>
                ) : !filtered.length ? (
                  <div className="rounded-lg border border-border bg-card px-5 py-20 text-center">
                    <Users
                      size={27}
                      className="mx-auto mb-3 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <p className="font-medium text-foreground">
                      {activeGroup && !activeGroup.members.length
                        ? 'El grupo todavía no tiene contactos'
                        : contacts.length
                          ? 'Sin resultados'
                          : 'Tu agenda de contactos está vacía'}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {activeGroup && !activeGroup.members.length
                        ? 'Abre la ficha de un contacto para asignarlo a este grupo.'
                        : contacts.length
                          ? 'Prueba con otra búsqueda o cambia los filtros.'
                          : 'Agrega tu primer contacto para comenzar.'}
                    </p>
                  </div>
                ) : viewMode === 'grid' ? (
                  <div
                    className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${previewRow ? '' : '2xl:grid-cols-3'}`}
                  >
                    {visible.map((row) => (
                      <ContactAgendaCard
                        key={row.contact.id}
                        row={row}
                        fields={cardFields}
                        actions={actions}
                        documentsLoaded={documentsLoaded}
                        active={previewId === row.contact.id}
                      />
                    ))}
                  </div>
                ) : (
                  <ContactAgendaTable
                    rows={visible}
                    fields={visibleFields}
                    documentsLoaded={documentsLoaded}
                    previewId={previewId}
                    actions={actions}
                    widths={view.widths}
                    sort={sort}
                    onSort={changeSort}
                    onResizeColumn={view.ready ? view.resizeColumn : undefined}
                    columnMovement={columnReorder.movement}
                  />
                )}
                {!loading && (
                  <div className="mt-3 overflow-hidden rounded-lg border border-border">
                    <TablePagination {...pagination} />
                  </div>
                )}
              </main>
              {previewRow && (
                <ContactQuickPreview
                  key={previewRow.contact.id}
                  row={previewRow}
                  documentsLoaded={documentsLoaded}
                  documentsError={documentsError}
                  notes={notesResult?.rows || []}
                  loadingNotes={!notesResult}
                  notesError={Boolean(notesResult?.error)}
                  favoritesEnabled={actions.favoritesEnabled}
                  onFavorite={() => actions.onFavorite(previewRow.contact)}
                  onClose={closePreview}
                  onOpen={() => openFullContact(previewRow.contact)}
                />
              )}
            </div>
          </div>
          {showSearchModal && (
            <AddContactDialog
              onClose={() => setShowSearchModal(false)}
              onRequestSaved={handleContactRequest}
            />
          )}
          {userId && (groupDialog?.type === 'create' || (groupDialog?.type === 'edit' && managedGroup)) && (
            <ContactGroupEditorDialog
              key={managedGroup?.id ?? 'create'}
              group={managedGroup}
              userId={userId}
              onClose={() => setGroupDialog(null)}
              onSaved={(group) => {
                updateGroups({ group });
                setGroupDialog(null);
                setAgendaNotice(managedGroup ? 'Grupo actualizado.' : 'Grupo creado.');
              }}
            />
          )}
          {userId && groupDialog?.type === 'delete' && managedGroup && contactGroups && (
            <ContactGroupDeleteDialog
              key={managedGroup.id}
              group={managedGroup}
              destinations={contactGroups.groups.filter((group) => group.id !== managedGroup.id)}
              onClose={() => setGroupDialog(null)}
              onDeleted={(destination) => {
                updateGroups({ deletedGroupId: managedGroup.id });
                if (filters.grupo === managedGroup.id) applyFilter('grupo', destination?.id ?? '');
                setGroupDialog(null);
                setAgendaNotice(destination ? 'Grupo eliminado y contactos reasignados.' : 'Grupo eliminado.');
                void loadGroups();
              }}
            />
          )}
          {deleteTarget && (
            <ContactEditorDialog
              title="Eliminar contacto"
              submitLabel="Eliminar contacto"
              busyLabel="Eliminando…"
              destructive
              busy={deleting}
              error={deleteError}
              onClose={() => setDeleteTarget(null)}
              onSubmit={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
            >
              <p className="text-sm text-muted-foreground">
                Se quitará a{' '}
                <strong className="text-foreground">{contactName(deleteTarget)}</strong> de tu
                agenda, junto con sus notas y asignaciones a grupos. Esta acción es permanente.
              </p>
            </ContactEditorDialog>
          )}
          {agendaNotice && (
            <BottomNotice
              message={agendaNotice}
              tone="success"
              onClose={() => setAgendaNotice('')}
            />
          )}
          {customizeOpen && view.ready && (
            <PersonalizarVistaModal
              open
              onClose={() => setCustomizeOpen(false)}
              columns={view.value.columns}
              filters={view.value.filters}
              gridColumns={view.value.gridColumns}
              defaultColumns={DEFAULT_CONTACT_VIEW.columns}
              defaultFilters={DEFAULT_CONTACT_VIEW.filters}
              defaultGridColumns={DEFAULT_CONTACT_VIEW.gridColumns}
              mandatoryColumnLabel="Contacto"
              entityLabel="contacto"
              onSave={view.save}
            />
          )}
        </div>
      </div>
    </AppLayout>
  );
}
