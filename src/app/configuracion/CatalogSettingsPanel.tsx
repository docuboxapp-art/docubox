'use client';

import { BottomNotice } from '@/components/ui/BottomNotice';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  ClipboardList,
  Eye,
  EyeOff,
  FileText,
  FolderKanban,
  Info,
  Layers,
  LayoutTemplate,
  Loader2,
  Pencil,
  Plus,
  Search,
  Tags,
  Trash2,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import { CatalogColorPicker } from '@/components/catalog/CatalogColorPicker';
import { EditorDialog } from '@/components/ui/EditorDialog';
import {
  builtInCatalog,
  catalogKey,
  catalogKinds,
  catalogVisibilityKey,
  documentCatalogs,
  isDocumentCatalog,
  validCatalogColor,
  type CatalogEntry,
  type CatalogKind,
  type DocumentCatalogKind,
} from '@/lib/catalog/classification';
import {
  savePersonalCatalogEntry,
  setCatalogHidden,
  usePersonalCatalog,
} from '@/lib/catalog/client';
import { readDocumentCatalogSettings } from '@/lib/catalog/document-reads';
import { createClient } from '@/lib/supabase/client';

type CatalogViewKind = Extract<CatalogKind, `${string}-type` | `${string}-tag`>;

const modules: { name: string; icon: LucideIcon; kinds: readonly CatalogViewKind[] }[] = [
  {
    name: 'Documentos',
    icon: FileText,
    kinds: ['document-type', 'document-tag'],
  },
  { name: 'Formularios', icon: ClipboardList, kinds: ['form-type', 'form-tag'] },
  {
    name: 'Plantillas',
    icon: LayoutTemplate,
    kinds: ['template-type', 'template-tag'],
  },
  { name: 'Expedientes', icon: FolderKanban, kinds: ['case-type', 'case-tag'] },
  { name: 'Contactos', icon: UsersRound, kinds: ['contact-tag'] },
];

const catalogs = {
  'contact-tag': {
    tab: 'Etiquetas',
    item: 'etiqueta',
    description: 'Etiquetas disponibles al clasificar contactos.',
  },
  'document-type': {
    tab: 'Tipo de documento',
    item: 'tipo',
    description: 'Administra los tipos que se pueden elegir al clasificar documentos.',
  },
  'document-group': { item: 'grupo' },
  'document-tag': {
    tab: 'Etiquetas',
    item: 'etiqueta',
    description: 'Etiquetas disponibles al clasificar documentos.',
  },
  'form-type': {
    tab: 'Tipo de formulario',
    item: 'tipo',
    description: 'Administra los tipos que aparecen al configurar un formulario.',
  },
  'form-group': { item: 'grupo' },
  'form-tag': {
    tab: 'Etiquetas',
    item: 'etiqueta',
    description: 'Etiquetas disponibles al clasificar formularios.',
  },
  'template-type': {
    tab: 'Tipo de plantilla',
    item: 'tipo',
    description: 'Administra los tipos que aparecen al crear una plantilla.',
  },
  'template-group': { item: 'grupo' },
  'template-tag': {
    tab: 'Etiquetas',
    item: 'etiqueta',
    description: 'Etiquetas disponibles al clasificar plantillas.',
  },
  'case-category': { item: 'categoría' },
  'case-type': {
    tab: 'Categorías y tipos',
    item: 'tipo',
    description: 'Administra los tipos que aparecen al elegir una categoría de expediente.',
  },
  'case-tag': {
    tab: 'Etiquetas',
    item: 'etiqueta',
    description: 'Estas etiquetas se pueden incluir en las plantillas de expediente.',
  },
} satisfies Record<CatalogKind, { tab?: string; item: string; description?: string }>;

const filters = [
  ['all', 'Todas'],
  ['default', 'Predeterminadas'],
  ['custom', 'Personalizadas'],
  ['hidden', 'Ocultas'],
] as const;
type Filter = (typeof filters)[number][0];
type Draft = { kind: CatalogKind; id?: string; name: string; group: string; color: string };
type CatalogData = Awaited<ReturnType<typeof readDocumentCatalogSettings>>;
type CatalogSection = { name: string; group?: CatalogEntry; entries: CatalogEntry[] };

const card = 'rounded-lg border border-border bg-card shadow-sm';
const button =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50';
const primary =
  'inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50';
const input =
  'min-h-10 w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60';
const filterButton =
  'workspace-filter-pill workspace-filter-trigger inline-flex min-h-8 items-center justify-center rounded-md border border-transparent px-3 hover:bg-card aria-pressed:border-border aria-pressed:bg-card aria-pressed:shadow-sm focus-visible:outline-2 focus-visible:outline-primary';
const moduleButton =
  'col-span-2 inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent px-1 text-xs font-medium text-foreground/80 transition-colors hover:bg-card/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50 disabled:opacity-50 aria-pressed:border-border aria-pressed:bg-card aria-pressed:text-primary aria-pressed:shadow-sm sm:min-h-9 sm:gap-2 sm:px-3.5 sm:text-sm motion-reduce:transition-none [&:nth-last-child(-n+2)]:col-span-3';
const catalogTab =
  'inline-flex min-h-10 items-center whitespace-nowrap border-b-2 border-transparent px-2.5 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50 disabled:opacity-50 aria-pressed:border-primary aria-pressed:text-primary sm:px-3';
const rowAction =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50 disabled:opacity-50';
const secondaryRowAction = `${rowAction} text-muted-foreground hover:bg-muted hover:text-foreground`;

function useDocumentCatalog(userId: string, kind: DocumentCatalogKind | undefined) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    userId: string;
    kind: DocumentCatalogKind;
    revision: number;
    data?: CatalogData;
    failed?: boolean;
  }>();
  useEffect(() => {
    if (!kind) return;
    const stop = new AbortController();
    const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(12_000)]);
    const request = { userId, kind, revision };
    async function load() {
      try {
        const data = await readDocumentCatalogSettings(createClient(), request.kind, signal);
        if (!stop.signal.aborted) setState({ ...request, data });
      } catch {
        if (!stop.signal.aborted) {
          setState((previous) => ({
            ...request,
            failed: true,
            data: previous?.userId === userId && previous.kind === kind ? previous.data : undefined,
          }));
        }
      }
    }
    void load();
    return () => stop.abort();
  }, [userId, kind, revision]);
  const current = state?.userId === userId && state.kind === kind ? state : undefined;
  return {
    data: current?.data,
    failed: Boolean(current?.failed && current.revision === revision),
    loading: Boolean(kind && current?.revision !== revision),
    refresh: () => setRevision((value) => value + 1),
  };
}

function CatalogEditor({
  draft,
  groups,
  tagGroups,
  update,
  busy,
  error,
  enabled,
  onClose,
  onSubmit,
}: {
  draft: Draft;
  groups: CatalogEntry[];
  tagGroups: string[];
  update: (draft: Draft) => void;
  busy: boolean;
  error: string;
  enabled: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { kind } = draft;
  const title = `${draft.id ? 'Editar' : 'Agregar'} ${catalogs[kind].item}`;
  const selectGroup = kind.endsWith('-type');
  const groupLabel = kind === 'case-type' ? 'Categoría' : 'Grupo';
  const nameInput = useRef<HTMLInputElement>(null);
  return (
    <EditorDialog
      title={title}
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={onSubmit}
      submitDisabled={!enabled}
      initialFocus={nameInput}
    >
      <label className="grid gap-1.5 text-sm font-medium">
        Nombre
        <input
          ref={nameInput}
          required
          maxLength={80}
          className={input}
          value={draft.name}
          onChange={(event) => update({ ...draft, name: event.target.value })}
        />
      </label>
      {selectGroup && (
        <label className="grid gap-1.5 text-sm font-medium">
          {groupLabel}
          {draft.id && kind === 'case-type' ? (
            <select
              required
              className={input}
              value={draft.group}
              onChange={(event) => update({ ...draft, group: event.target.value })}
            >
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              readOnly
              className={`${input} bg-muted/40`}
              value={groups.find((group) => group.id === draft.group)?.name ?? 'Grupo anterior'}
            />
          )}
        </label>
      )}
      {kind === 'case-tag' && (
        <label className="grid gap-1.5 text-sm font-medium">
          Categoría de la etiqueta (opcional)
          <input
            maxLength={80}
            className={input}
            list="catalog-tag-groups"
            value={draft.group}
            onChange={(event) => update({ ...draft, group: event.target.value })}
          />
          <datalist id="catalog-tag-groups">
            {tagGroups.map((group) => (
              <option key={group} value={group} />
            ))}
          </datalist>
          <span className="text-xs font-normal text-muted-foreground">
            Elige una categoría existente o escribe una nueva.
          </span>
        </label>
      )}
      {kind.endsWith('-tag') && (
        <CatalogColorPicker value={draft.color} onChange={(color) => update({ ...draft, color })} />
      )}
    </EditorDialog>
  );
}

export function CatalogSettingsPanel({ userId }: { userId: string }) {
  const [kind, setKind] = useState<CatalogViewKind>(modules[0].kinds[0]);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Draft>();
  const [deleting, setDeleting] = useState<CatalogEntry>();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();
  const personal = usePersonalCatalog(userId);
  const isContactCatalog = kind === 'contact-tag';
  const nativeKind = isDocumentCatalog(kind) ? kind : undefined;
  const documents = useDocumentCatalog(userId, nativeKind);
  const definition = nativeKind ? documentCatalogs[nativeKind] : undefined;
  const groupKind =
    kind === 'case-type'
      ? 'case-category'
      : definition && 'groupKind' in definition
        ? definition.groupKind
        : undefined;
  const activeModule = modules.find(({ kinds }) => kinds.includes(kind)) ?? modules[0];
  const { description } = catalogs[kind];
  const addKind = groupKind ?? kind;
  const groupLabel = groupKind === 'case-category' ? 'categoría' : 'grupo';
  const title = groupKind
    ? kind === 'case-type'
      ? 'Categorías y tipos de expedientes'
      : `Grupos y ${catalogKinds[kind].toLocaleLowerCase('es')}`
    : catalogKinds[kind];

  const options = nativeKind
    ? (documents.data?.entries ?? [])
    : [...builtInCatalog, ...personal.entries];
  const entries = options.filter((entry) => entry.kind === kind && !entry.archived);
  const editing = entries.find((entry) => entry.id === draft?.id);
  const isHidden = (entry: CatalogEntry) =>
    personal.hidden.has(catalogVisibilityKey(entry.kind, entry.id));
  const availableGroups =
    groupKind === 'case-category'
      ? options.filter((entry) => entry.kind === groupKind)
      : (documents.data?.groups ?? []);
  const knownGroups = new Map(availableGroups.map((group) => [group.id, group]));
  const activeGroups = availableGroups.filter((entry) => !entry.archived);
  const previousGroup =
    groupKind && editing?.group && !activeGroups.some(({ id }) => id === editing.group)
      ? (knownGroups.get(editing.group) ?? {
          id: editing.group,
          kind: groupKind,
          name: kind === 'case-type' ? 'Categoría anterior' : 'Grupo anterior',
          group: '',
        })
      : undefined;
  const editorGroups = previousGroup ? [...activeGroups, previousGroup] : activeGroups;
  const tagGroups =
    kind === 'case-tag'
      ? Array.from(new Set(entries.map(({ group }) => group).filter(Boolean)))
      : [];

  const preferencesReady = !personal.loading && !personal.error && !personal.unavailable;
  const documentReady = Boolean(documents.data && !documents.failed && !documents.loading);
  const entriesWritable = nativeKind
    ? documentReady && !documents.data?.legacy && !documents.data?.groupsUnavailable
    : preferencesReady;
  const visibilityWritable = preferencesReady && (!nativeKind || documentReady);
  const syncing = personal.loading || documents.loading;
  const personalFailed = personal.error && !personal.loading;
  const groupsFailed = documents.data?.groupsUnavailable && !documents.loading;
  const failed = documents.failed || personalFailed || groupsFailed;
  const searchTerm = catalogKey(search);
  const grouped = new Map<string, CatalogSection>(
    activeGroups.map((group) => [group.id, { name: group.name, group, entries: [] }])
  );
  for (const entry of entries) {
    const groupId = isContactCatalog ? '' : entry.group;
    const group = knownGroups.get(groupId);
    const section = grouped.get(groupId) ?? {
      name: groupKind ? (group?.name ?? `Sin ${groupLabel} disponible`) : groupId,
      group,
      entries: [],
    };
    section.entries.push(entry);
    grouped.set(groupId, section);
  }
  function matchesFilter(entry: CatalogEntry, hidden: boolean) {
    if (filter === 'hidden') return hidden;
    if (filter === 'custom') return Boolean(entry.custom);
    if (filter === 'default') return !entry.custom;
    return true;
  }
  const sections = [...grouped].flatMap(([id, section]) => {
    const { group, name } = section;
    const hiddenByGroup = group ? Boolean(group.archived || isHidden(group)) : Boolean(groupKind);
    const visibleEntries = section.entries.filter(
      (entry) =>
        matchesFilter(entry, hiddenByGroup || isHidden(entry)) &&
        catalogKey(`${entry.name} ${name}`).includes(searchTerm)
    );
    const showGroup =
      group &&
      !group.archived &&
      matchesFilter(group, hiddenByGroup) &&
      catalogKey(name).includes(searchTerm);
    if (!showGroup && !visibleEntries.length) return [];
    visibleEntries.sort((left, right) => left.name.localeCompare(right.name, 'es'));
    return [
      {
        id,
        name,
        group,
        hiddenByGroup,
        hasEntries: section.entries.length > 0,
        entries: visibleEntries,
      },
    ];
  });
  const emptyText = syncing
    ? 'Cargando opciones…'
    : failed || (personal.unavailable && (filter === 'custom' || filter === 'hidden'))
      ? 'Vista sin datos confirmados. Reintenta la carga del catálogo.'
      : searchTerm
        ? 'No hay coincidencias para esta búsqueda.'
        : {
            all: 'Aún no hay opciones en este catálogo.',
            default: 'Este catálogo no tiene opciones predeterminadas.',
            custom: 'Aún no tienes opciones personalizadas en este catálogo.',
            hidden: 'No tienes opciones ocultas en este catálogo.',
          }[filter];

  function changeCatalog(next: CatalogViewKind) {
    if (next === kind || busy) return;
    setKind(next);
    setFilter('all');
    setSearch('');
    setFeedback(undefined);
  }

  function closeEditor() {
    setDraft(undefined);
    setDeleting(undefined);
    setFeedback(undefined);
  }

  function openEditor(
    entry: Pick<CatalogEntry, 'kind'> &
      Partial<Pick<CatalogEntry, 'id' | 'name' | 'group' | 'color'>>
  ) {
    setFeedback(undefined);
    setDraft({
      kind: entry.kind,
      id: entry.id,
      name: entry.name ?? '',
      group: entry.group ?? (entry.kind === 'contact-tag' ? 'Personalizada' : ''),
      color: validCatalogColor(entry.color),
    });
  }

  async function run(
    action: () => Promise<void>,
    success: string,
    reload: 'personal' | 'documents'
  ) {
    if (busy) return;
    setBusy(true);
    setFeedback(undefined);
    try {
      await action();
      if (reload === 'documents') documents.refresh();
      else personal.refresh();
      setDraft(undefined);
      setDeleting(undefined);
      setFeedback({ text: success });
    } catch (error) {
      setFeedback({
        text:
          (error as { code?: string } | null)?.code === '23505'
            ? 'Ya existe una opción personalizada con ese nombre.'
            : 'No se pudo guardar el cambio. Intenta nuevamente.',
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !entriesWritable) return;
    const draftKind = draft.kind;
    const needsGroup = draftKind.endsWith('-type');
    const name = draft.name.trim();
    // Contact assignments use the stored category as part of their identifier.
    const group = draftKind === 'contact-tag' ? draft.group : draft.group.trim();
    if (!name || (needsGroup && !editorGroups.some(({ id }) => id === group))) {
      setFeedback({ text: 'Revisa el nombre y la clasificación de la opción.', error: true });
      return;
    }
    const catalogEntries = draftKind === groupKind ? activeGroups : entries;
    if (
      catalogEntries.some(
        (entry) =>
          entry.id !== draft.id &&
          catalogKey(entry.name) === catalogKey(name) &&
          catalogKey(entry.group) === catalogKey(group)
      )
    ) {
      setFeedback({ text: 'Ya existe una opción con ese nombre.', error: true });
      return;
    }
    void run(
      async () => {
        if (!isDocumentCatalog(draftKind)) {
          await savePersonalCatalogEntry(
            userId,
            { kind: draftKind, name, group, color: draft.color },
            draft.id
          );
        } else {
          const { table: tableName, scope } = documentCatalogs[draftKind];
          const table = createClient().from(tableName);
          const values =
            tableName === 'etiquetas' ? { nombre: name, color: draft.color } : { nombre: name };
          const query = draft.id
            ? table
                .update(values)
                .eq('id', draft.id)
                .eq('catalog_owner_id', userId)
                .eq('catalog_archived', false)
            : table.insert({
                ...values,
                catalog_owner_id: userId,
                catalog_scope: scope,
                ...(tableName === 'grupo_tipo_documento' && { orden: 1000 }),
                ...(tableName === 'tipo_documento' && { grupo_id: group }),
              });
          const result = await query.select('id').single();
          if (result.error) throw result.error;
        }
        if (!draft.id) {
          if (!needsGroup || filter === 'default' || filter === 'hidden') setFilter('custom');
          setSearch('');
        }
      },
      'Opción guardada.',
      isDocumentCatalog(draftKind) ? 'documents' : 'personal'
    );
  }

  function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deleting || !entriesWritable) return;
    const entry = deleting;
    void run(
      async () => {
        const db = createClient();
        const query = isDocumentCatalog(entry.kind)
          ? db
              .from(documentCatalogs[entry.kind].table)
              .update({ catalog_archived: true })
              .eq('catalog_owner_id', userId)
              .eq('catalog_archived', false)
              .eq('id', entry.id)
          : db
              .from('user_catalog_entries')
              .update({ archived: true })
              .eq('user_id', userId)
              .eq('kind', entry.kind)
              .eq('archived', false)
              .eq('id', entry.id);
        const result = await query.select('id').single();
        if (result.error) throw result.error;
      },
      'Opción eliminada del catálogo.',
      isDocumentCatalog(entry.kind) ? 'documents' : 'personal'
    );
  }

  function renderBadges(entry: CatalogEntry, hiddenLabel?: string) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] leading-4">
        <span className="rounded-md bg-muted px-2 py-0.5 text-muted-foreground">
          {entry.custom ? 'Personalizada' : 'Predeterminada'}
        </span>
        {hiddenLabel && (
          <span className="rounded-md border border-border px-2 text-muted-foreground">
            {hiddenLabel}
          </span>
        )}
      </div>
    );
  }

  function renderActions(
    entry: CatalogEntry,
    { isGroup = false, hiddenByGroup = false }: { isGroup?: boolean; hiddenByGroup?: boolean } = {}
  ) {
    const hidden = isHidden(entry);
    const toggleLabel = `${hidden ? 'Mostrar' : 'Ocultar'}${isGroup ? ` ${groupLabel}` : ''}`;
    const parent = groupLabel === 'categoría' ? 'La categoría' : 'El grupo';
    const feedbackText = isGroup
      ? hidden
        ? `${parent} vuelve a estar disponible en los selectores.`
        : `${parent} y sus tipos se ocultaron de los selectores.`
      : hidden
        ? 'La opción ya aparece en los selectores.'
        : 'La opción se ocultó de los selectores.';
    const canToggle =
      visibilityWritable &&
      (!documents.data?.legacy || entry.kind === 'document-type' || entry.kind === 'document-tag');
    return (
      <>
        {!hiddenByGroup && (
          <button
            type="button"
            className={secondaryRowAction}
            disabled={busy || !canToggle}
            aria-label={`${toggleLabel} ${entry.name}`}
            onClick={() =>
              void run(
                () => setCatalogHidden(userId, entry.kind, entry.id, !hidden),
                feedbackText,
                'personal'
              )
            }
          >
            {hidden ? (
              <Eye size={15} aria-hidden="true" />
            ) : (
              <EyeOff size={15} aria-hidden="true" />
            )}
            {toggleLabel}
          </button>
        )}
        {entry.custom && (
          <>
            <button
              type="button"
              className={secondaryRowAction}
              disabled={busy || !entriesWritable}
              aria-label={`Editar ${entry.name}`}
              onClick={() => openEditor(entry)}
            >
              <Pencil size={14} aria-hidden="true" /> Editar
            </button>
            <button
              type="button"
              className={`${rowAction} text-destructive hover:bg-destructive/10`}
              disabled={busy || !entriesWritable}
              aria-label={`Eliminar ${entry.name}`}
              onClick={() => {
                setFeedback(undefined);
                setDeleting(entry);
              }}
            >
              <Trash2 size={14} aria-hidden="true" /> Eliminar
            </button>
          </>
        )}
      </>
    );
  }

  return (
    <section className="min-w-0 space-y-4" aria-labelledby="catalog-settings-title">
      <header className="border-b border-slate-200/80 pb-4 dark:border-border">
        <h1 id="catalog-settings-title" className="text-2xl font-600 text-foreground">
          Catálogos y etiquetas
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Administra los tipos, grupos y etiquetas de cada módulo.
        </p>
      </header>
      <div
        role="group"
        aria-label="Módulos de catálogo"
        className="grid w-full max-w-full grid-cols-6 gap-1 rounded-lg border border-border/70 bg-slate-200/75 p-1 md:flex md:w-fit md:flex-wrap dark:bg-slate-800"
      >
        {modules.map(({ name, icon: Icon, kinds }) => (
          <button
            key={name}
            type="button"
            aria-pressed={kinds.includes(kind)}
            disabled={busy}
            onClick={() => changeCatalog(kinds[0])}
            className={moduleButton}
          >
            <Icon size={16} className="shrink-0 max-[379px]:hidden" aria-hidden="true" />
            {name}
          </button>
        ))}
      </div>
      <section className={card} aria-labelledby="active-catalog-title">
        <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
          <div className="min-w-0 flex-1 basis-56">
            <h2 id="active-catalog-title" className="text-base font-semibold text-foreground">
              {title}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
          <button
            type="button"
            className={`${primary} shrink-0`}
            disabled={busy || !entriesWritable}
            onClick={() => openEditor({ kind: addKind })}
          >
            <Plus size={16} aria-hidden="true" />
            Agregar {catalogs[addKind].item}
          </button>
        </header>
        {activeModule.kinds.length > 1 && (
          <div
            role="group"
            aria-label={`Catálogos de ${activeModule.name}`}
            className="flex flex-wrap gap-x-1 px-4 sm:gap-x-2 sm:px-5"
          >
            {activeModule.kinds.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={kind === option}
                disabled={busy}
                onClick={() => changeCatalog(option)}
                className={catalogTab}
              >
                {catalogs[option].tab}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2.5 border-y border-border bg-muted/30 px-4 py-3 sm:gap-3 sm:px-5">
          <div className="relative w-full min-w-0 sm:min-w-48 sm:flex-1">
            <Search
              size={16}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              className={`${input} appearance-none pl-9 pr-10 [&::-webkit-search-cancel-button]:appearance-none`}
              aria-label="Buscar opciones del catálogo"
              placeholder="Buscar en el catálogo…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && (
              <button
                type="button"
                aria-label="Limpiar búsqueda"
                onClick={() => setSearch('')}
                className="absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"
              >
                <X size={15} aria-hidden="true" />
              </button>
            )}
          </div>
          <div
            role="group"
            aria-label="Filtrar opciones"
            className="grid w-full max-w-full grid-cols-2 gap-1 rounded-lg bg-muted p-1 sm:flex sm:w-fit sm:flex-wrap"
          >
            {filters.map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
                className={filterButton}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2 px-4 pt-3 empty:hidden sm:px-5">
          {failed && (
            <div
              role="status"
              className="flex flex-wrap items-center gap-2.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
            >
              <AlertCircle size={17} className="shrink-0" aria-hidden="true" />
              <p className="min-w-0 flex-1 basis-40">
                No se pudo completar la carga. Se muestran las opciones disponibles.
              </p>
              <button
                type="button"
                className={`${button} text-foreground`}
                onClick={() => {
                  if (personalFailed) personal.refresh();
                  if (documents.failed || groupsFailed) documents.refresh();
                }}
              >
                Reintentar
              </button>
            </div>
          )}
          {personal.unavailable && !personal.loading && (
            <div
              role="status"
              className="flex flex-wrap items-center gap-2.5 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground"
            >
              <Info size={16} className="shrink-0 text-primary" aria-hidden="true" />
              <p className="min-w-0 flex-1 basis-40">
                La administración personal requiere la activación del catálogo en Supabase.
              </p>
              <button
                type="button"
                className={button}
                disabled={personal.loading}
                onClick={personal.refresh}
              >
                Reintentar
              </button>
            </div>
          )}
          {nativeKind && documents.data?.legacy && (
            <p
              className="flex gap-2.5 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground"
              role="status"
            >
              <Info size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
              Las opciones personales de este módulo requieren activar la nueva versión del
              catálogo.
            </p>
          )}
          {feedback && !draft && !deleting && <BottomNotice message={feedback.text} tone={feedback.error ? 'critical' : 'success'} onClose={() => setFeedback(undefined)} />}
          {sections.length > 0 && syncing && (
            <p className="flex items-center gap-2 py-1 text-sm text-muted-foreground" role="status">
              <Loader2 size={15} className="animate-spin text-primary" aria-hidden="true" />
              Actualizando el catálogo…
            </p>
          )}
        </div>
        {sections.length ? (
          <div className="divide-y divide-border">
            {sections.map(({ id, name, group, hiddenByGroup, hasEntries, entries }) => (
              <section key={id} aria-label={name || undefined}>
                {name && (
                  <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-muted/60 px-4 py-2.5 sm:px-5">
                    <div className="flex min-w-0 flex-1 basis-36 flex-wrap items-center gap-x-2.5 gap-y-1">
                      <h3 className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-foreground/80">
                        <Layers
                          size={14}
                          className="shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                        <span className="[overflow-wrap:anywhere]">{name}</span>
                      </h3>
                      {group &&
                        renderBadges(
                          group,
                          group.archived ? 'Archivado' : hiddenByGroup ? 'Tipos ocultos' : undefined
                        )}
                    </div>
                    {group && !group.archived && (
                      <div className="ml-auto flex flex-wrap justify-end gap-1">
                        <button
                          type="button"
                          className={`${rowAction} text-primary hover:bg-primary/10`}
                          disabled={busy || !entriesWritable}
                          aria-label={`Agregar ${catalogs[kind].item} en ${group.name}`}
                          onClick={() =>
                            openEditor({
                              kind,
                              group: group.id,
                              color: group.color,
                            })
                          }
                        >
                          <Plus size={15} aria-hidden="true" /> Agregar {catalogs[kind].item}
                        </button>
                        {renderActions(group, { isGroup: true })}
                      </div>
                    )}
                  </header>
                )}
                {entries.length ? (
                  <ul className="divide-y divide-border/70">
                    {entries.map((entry) => (
                      <li
                        key={entry.id}
                        className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-2.5 pr-4 hover:bg-muted/20 sm:pr-5 ${group ? 'pl-7 sm:pl-10' : 'pl-4 sm:pl-5'}`}
                      >
                        <div className="flex min-w-0 flex-1 basis-36 items-center gap-2.5">
                          {kind.endsWith('-tag') ? (
                            <span
                              className="size-3 shrink-0 rounded-full"
                              style={{ backgroundColor: validCatalogColor(entry.color) }}
                              aria-hidden="true"
                            />
                          ) : (
                            <Tags
                              size={15}
                              className="shrink-0 text-muted-foreground"
                              aria-hidden="true"
                            />
                          )}
                          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                            <p className="text-sm font-medium [overflow-wrap:anywhere]">
                              {entry.name}
                            </p>
                            {renderBadges(
                              entry,
                              isHidden(entry)
                                ? 'Oculta'
                                : hiddenByGroup
                                  ? groupLabel === 'categoría'
                                    ? 'Oculta por la categoría'
                                    : 'Oculta por el grupo'
                                  : undefined
                            )}
                          </div>
                        </div>
                        <div className="ml-auto flex flex-wrap justify-end gap-1.5 empty:hidden">
                          {renderActions(entry, { hiddenByGroup })}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-4 py-3 text-sm text-muted-foreground sm:px-10">
                    {hasEntries
                      ? 'No hay tipos que coincidan con el filtro.'
                      : 'Aún no hay tipos aquí.'}
                  </p>
                )}
              </section>
            ))}
          </div>
        ) : (
          <p
            className="flex min-h-24 items-center justify-center gap-2 px-4 pb-3 text-center text-sm text-muted-foreground"
            role="status"
          >
            {syncing && (
              <Loader2
                size={16}
                className="shrink-0 animate-spin text-primary"
                aria-hidden="true"
              />
            )}
            {emptyText}
          </p>
        )}
      </section>
      {draft && (
        <CatalogEditor
          draft={draft}
          groups={editorGroups}
          tagGroups={tagGroups}
          update={setDraft}
          busy={busy}
          error={feedback?.error ? feedback.text : ''}
          enabled={entriesWritable}
          onClose={closeEditor}
          onSubmit={save}
        />
      )}
      {deleting && (
        <EditorDialog
          title={`Eliminar ${catalogs[deleting.kind].item}`}
          busy={busy}
          error={feedback?.error ? feedback.text : ''}
          onClose={closeEditor}
          onSubmit={remove}
          submitLabel="Eliminar"
          busyLabel="Eliminando…"
          submitDisabled={!entriesWritable}
          destructive
        >
          <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
            «{deleting.name}» saldrá del catálogo.
            {deleting.kind === groupKind && ' Sus tipos se ocultarán de los selectores.'} Las
            asignaciones anteriores se conservan.
          </p>
        </EditorDialog>
      )}
    </section>
  );
}
