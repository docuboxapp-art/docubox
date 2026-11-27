'use client';

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  SlidersHorizontal,
  Maximize2,
  Minimize2,
  FolderKanban,
  Folder,
  FolderPlus,
  Zap,
  Loader2,
  Send,
  Star,
  X,
} from 'lucide-react';
import { caseCategories } from '@/lib/case-files/category-catalog';
import { caseOrderColumns, caseOrderOptions } from '@/lib/case-files/consultation-order';
import { getTableSortDirection, tableAriaSort } from '@/lib/workspaces/list-order';
import { moveViewColumn } from '@/lib/workspaces/view-order';
import { useColumnReorder } from '@/components/workspaces/useColumnReorder';
import { addCaseFolder, moveCaseToFolder } from '@/lib/case-files/folders';
import { useCaseFolders } from './useCaseFolders';
import { useCaseView } from './useCaseView';
import {
  CASE_COLUMN_MAX_WIDTH,
  CASE_COLUMN_WIDTHS,
  CASE_VIEW_COLUMNS,
  CASE_VIEW_FILTERS,
  CASE_VIEW_GRID,
  caseColumnMinWidth,
} from '@/lib/case-files/view-preferences';
const CustomizeCaseView = dynamic(
  () => import('@/app/mis-documentos/components/PersonalizarVistaModal'),
  { ssr: false }
);
import AppLayout from '@/components/AppLayout';
import ResponsiveSidebar from '@/components/ResponsiveSidebar';
import WorkspaceTabs from '@/components/workspaces/WorkspaceTabs';
import WorkspaceLayout from '@/components/workspaces/WorkspaceLayout';
import WorkspacePageHeader from '@/components/workspaces/WorkspacePageHeader';
import ResizableTableHeader from '@/components/workspaces/ResizableTableHeader';
import TableScrollArea from '@/components/workspaces/TableScrollArea';
import TablePagination from '@/components/workspaces/TablePagination';
import { WORKSPACE_ACTIONS_COLUMN_WIDTH } from '@/lib/workspaces/table-layout';
import { DEFAULT_TABLE_PAGE_SIZE, type TablePageSize } from '@/lib/workspaces/table-pagination';
import { TableSortButton } from '@/components/workspaces/TableSortButton';
import WorkspaceTableToolbar, { WorkspaceTableViewToggle } from '@/components/WorkspaceTableToolbar';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { caseRequest } from '@/lib/case-files/runtime-client';
import { subscribeToCaseListReturn } from '@/lib/case-files/consultation-refresh';
import { createClient } from '@/lib/supabase/client';
import { CASE_STATUS_META, type CaseFileStatus } from '@/lib/case-files/schema';
import { CaseStatusBadge } from './CaseUI';
import CaseResultDetail from './CaseResultDetail';
import CaseRowActions from './CaseRowActions';
import LaunchDialog from '../lanzar/LaunchDialog';
import SavedCaseFilters from './SavedCaseFilters';
import CaseFilterSelect, { CaseDateRangeFilter } from './CaseFilterSelect';
import type { CaseFilterValues } from '@/lib/case-files/saved-filters';

export type CaseBrowserRow = {
  id: string;
  title: string;
  folio: string;
  templateName: string;
  case_type: string;
  case_subtype: string | null;
  template_id: string;
  subject_name: string;
  issuerName: string;
  responsibleNames: string[];
  status: CaseFileStatus;
  progress: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  target_close_at: string | null;
  tags: string[];
  priority: string;
  favorite: boolean;
  canManage: boolean;
  isScheduled: boolean;
  participants: { id: string; name: string; email: string; role: string }[];
  delivery: { sent: number; total: number };
  launch: { access_mode: string; scheduled_at: string | null; timezone: string } | null;
};
type Result = {
  items: CaseBrowserRow[];
  total: number;
  page: number;
  pageSize: number;
  templates: { id: string; name: string }[];
  tags: string[];
  classifications: { category: string; subtype: string | null }[];
};
const control =
  'h-10 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-600 outline-none transition-colors hover:border-slate-300 focus:border-primary focus:ring-2 focus:ring-primary/10 dark:border-border dark:bg-card dark:text-foreground';
export const caseDate = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Sin fecha';

export default function CaseBrowser(props: { mode?: 'workspace' | 'completed' }) {
  const { activeWorkspace } = useWorkspace();
  return <CaseBrowserContent key={activeWorkspace?.id || 'loading'} {...props} />;
}
function CaseBrowserContent({ mode = 'workspace' }: { mode?: 'workspace' | 'completed' }) {
  const params = useSearchParams();
  const { activeWorkspace } = useWorkspace();
  const completed = mode === 'completed';
  const folders = useCaseFolders(activeWorkspace?.id);
  const viewPreferences = useCaseView(activeWorkspace?.id);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [resizeDraft, setResizeDraft] = useState<{ id: string; width: number } | null>(null);
  const visibleColumns = viewPreferences.value.columns.filter((column) => column.visible);
  const columnReorder = useColumnReorder(
    visibleColumns,
    viewPreferences.ready && !customizeOpen
      ? async (from, to) => {
          const columns = moveViewColumn(viewPreferences.value.columns, from, to);
          if (columns) await viewPreferences.save({ ...viewPreferences.value, columns });
        }
      : undefined
  );
  const tableColumns = [{ id: 'title', label: 'Expediente' }, ...visibleColumns].map((column) => ({
    ...column,
    width:
      resizeDraft?.id === column.id
        ? resizeDraft.width
        : (viewPreferences.widths[column.id] ?? CASE_COLUMN_WIDTHS[column.id]),
  }));
  const dataColumnsWidth = tableColumns.reduce((total, column) => total + column.width, 0);
  const tableMinWidth = dataColumnsWidth + WORKSPACE_ACTIONS_COLUMN_WIDTH;
  const visibleGridRows = viewPreferences.value.gridColumns.filter((column) => column.selected);
  const [folderId, setFolderId] = useState('');
  const [folderDialog, setFolderDialog] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderDescription, setFolderDescription] = useState('');
  const [folderError, setFolderError] = useState('');
  const [moving, setMoving] = useState<CaseBrowserRow | null>(null);
  const [moveTarget, setMoveTarget] = useState('');
  const [category, setCategory] = useState('');
  const [subtype, setSubtype] = useState('');
  const [responsible, setResponsible] = useState('');
  const [type, setType] = useState(params.get('tipo') || '');
  const [status, setStatus] = useState(params.get('estado') || (completed ? 'sealed' : 'all'));
  const [scope, setScope] = useState('all');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [priority, setPriority] = useState('');
  const [tag, setTag] = useState('');
  const [access, setAccess] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [scheduled, setScheduled] = useState(false);
  const [sort, setSort] = useState('recent');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<TablePageSize>(DEFAULT_TABLE_PAGE_SIZE);
  const [refresh, setRefresh] = useState(0);
  const [listing, setListing] = useState<{ key: string; result: Result } | null>(null);
  const data = listing?.result;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [moreStatus, setMoreStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const moreTarget = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<CaseBrowserRow | null>(null);
  const [favoriteBusy, setFavoriteBusy] = useState<string | null>(null);
  const [grid, setGrid] = useState(false);
  const [wide, setWide] = useState(false);
  const workspaceId = activeWorkspace?.id;
  const requestParams = new URLSearchParams({
    workspaceId: workspaceId || '',
    page: String(page),
    size: String(grid && !completed ? DEFAULT_TABLE_PAGE_SIZE : pageSize),
    q: search,
    estado: status,
    vista: scope,
    orden: sort,
    fecha: completed ? 'cierre' : 'apertura',
  });
  for (const [key, value] of Object.entries({
    tipo: type,
    categoria: category,
    subtipo: subtype,
    responsable: responsible,
    carpeta: folderId,
    desde: from,
    hasta: to,
    acceso: access,
    prioridad: priority,
    etiqueta: tag,
    envio: scheduled ? 'scheduled' : '',
  }))
    if (value) requestParams.set(key, value);
  const queryString = requestParams.toString();
  const requestKey = `${queryString}:${refresh}`;
  const moreFailed = moreStatus === 'error';
  const hasMore =
    grid &&
    !completed &&
    !loading &&
    listing?.key === requestKey &&
    data !== undefined &&
    data.page * data.pageSize < data.total;

  useEffect(() => {
    if (!wide) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const exit = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setWide(false);
    };
    window.addEventListener('keydown', exit);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', exit);
    };
  }, [wide]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(query);
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (!activeWorkspace?.id) return;
    return subscribeToCaseListReturn(() => setRefresh((value) => value + 1));
  }, [activeWorkspace?.id]);
  useEffect(() => {
    if (!workspaceId) return;
    let live = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      setMoreStatus('idle');
      caseRequest<Result>(`/api/expedientes/consultar?${queryString}`)
        .then((result) => {
          if (!live) return;
          const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
          if (result.page > lastPage) {
            setPage(lastPage);
            return;
          }
          setListing({ key: requestKey, result });
          setSelectedId((current) =>
            result.items.some((row) => row.id === current) ? current : result.items[0]?.id || null
          );
        })
        .catch((cause) => {
          if (live) {
            setListing(null);
            setError(
              cause instanceof Error && cause.message === 'SESSION_POLICY_UNAVAILABLE'
                ? 'El servicio de sesión no está disponible temporalmente. Reintenta en unos momentos.'
                : cause instanceof Error
                  ? cause.message
                  : 'No se pudieron consultar los expedientes.'
            );
          }
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }, 0);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [queryString, requestKey, workspaceId]);

  useEffect(() => {
    const target = moreTarget.current;
    if (!hasMore || !data || !target || moreFailed) return;
    let live = true;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!live || !entry?.isIntersecting) return;
        observer.disconnect();
        setMoreStatus('loading');
        const params = new URLSearchParams(queryString);
        params.set('page', String(data.page + 1));
        caseRequest<Result>(`/api/expedientes/consultar?${params}`)
          .then((result) => {
            if (!live) return;
            setMoreStatus('idle');
            setListing((current) => {
              if (!current || current.key !== requestKey || current.result !== data) return current;
              const existing = new Set(data.items.map((row) => row.id));
              return {
                key: requestKey,
                result: {
                  ...result,
                  items: [...data.items, ...result.items.filter((row) => !existing.has(row.id))],
                },
              };
            });
          })
          .catch(() => {
            if (live) setMoreStatus('error');
          });
      },
      { rootMargin: '0px 0px 160px' }
    );
    observer.observe(target);
    return () => {
      live = false;
      observer.disconnect();
    };
    // Only an error pauses the observer. The loading indicator must not cancel its request.
  }, [data, hasMore, moreFailed, queryString, requestKey]);

  function change(setter: (value: string) => void, value: string) {
    setter(value);
    setPage(1);
  }
  function applySavedFilters(values: CaseFilterValues) {
    setFolderId('');
    setCategory(values.category);
    setSubtype(values.subtype);
    setResponsible(values.responsible);
    setType(values.type);
    setStatus(values.status);
    setScope(values.scope);
    setQuery(values.query);
    setSearch(values.query);
    setPriority(values.priority);
    setTag(values.tag);
    setAccess(values.access);
    setFrom(values.from);
    setTo(values.to);
    setScheduled(values.scheduled);
    setSort(values.sort);
    setPage(1);
  }
  function reset(clearSearch = true) {
    setFolderId('');
    setCategory('');
    setSubtype('');
    setResponsible('');
    setType('');
    setStatus(completed ? 'sealed' : 'all');
    setScope('all');
    if (clearSearch) {
      setQuery('');
      setSearch('');
    }
    setPriority('');
    setTag('');
    setAccess('');
    setFrom('');
    setTo('');
    setScheduled(false);
    setPage(1);
  }
  async function favorite(row: CaseBrowserRow) {
    if (!activeWorkspace || favoriteBusy) return;
    setFavoriteBusy(row.id);
    try {
      const client = createClient();
      const { data: session } = await client.auth.getUser();
      if (!session.user) throw new Error('Inicia sesión para guardar favoritos.');
      const key = `expedientes:${activeWorkspace.id}`;
      const result = row.favorite
        ? await client
            .from('user_favorites')
            .delete()
            .eq('user_id', session.user.id)
            .eq('storage_key', key)
            .eq('item_id', row.id)
        : await client
            .from('user_favorites')
            .upsert(
              { user_id: session.user.id, storage_key: key, item_id: row.id },
              { onConflict: 'user_id,storage_key,item_id' }
            );
      if (result.error) throw new Error('No se pudo actualizar el favorito.');
      setRefresh((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el favorito.');
    } finally {
      setFavoriteBusy(null);
    }
  }
  const selected = data?.items.find((row) => row.id === selectedId);
  const categoryOptions = [
    ...new Set([
      ...caseCategories.map((c) => c.name),
      ...(data?.classifications || []).map((c) => c.category).filter(Boolean),
    ]),
  ].map((name) => ({ id: name, name }));
  const subtypeOptions = [
    ...new Set([
      ...caseCategories
        .filter((c) => !category || c.name === category)
        .flatMap((c) => c.types.map((t) => t.name)),
      ...(data?.classifications || [])
        .filter((c) => !category || c.category === category)
        .map((c) => c.subtype)
        .filter((v): v is string => !!v),
    ]),
  ].map((name) => ({ id: name, name }));
  const statusDefault = completed ? 'sealed' : 'all';
  const scopeOptions = [
    { id: 'all', name: 'Todos los expedientes' },
    { id: 'favorites', name: 'Mis favoritos' },
    ...(completed ? [] : [
      { id: 'active', name: 'En seguimiento' },
      { id: 'due', name: 'Por vencer (72 h)' },
    ]),
  ];
  const templateOptions = data?.templates.map(({ id, name }) => ({ id, name })) ?? [];
  const scopeLabel = scopeOptions.find((option) => option.id === scope)?.name ??
    (scope === 'mine' ? 'Soy responsable' : scope === 'due' ? 'Por vencer (72 h)' : 'En seguimiento');
  const criteria = [
    folderId && {
      label: 'Carpeta: ' + (folders.folders.find((f) => f.id === folderId)?.name || 'Seleccionada'),
      clear: () => change(setFolderId, ''),
    },
    category && {
      label: 'Categoría: ' + category,
      clear: () => change(setCategory, ''),
    },
    subtype && { label: 'Tipo: ' + subtype, clear: () => change(setSubtype, '') },
    responsible && { label: 'Responsable: Soy responsable', clear: () => change(setResponsible, '') },
    type && {
      label: `Nombre del tipo de expediente: ${templateOptions.find((option) => option.id === type)?.name || 'Seleccionado'}`,
      clear: () => change(setType, ''),
    },
    status !== statusDefault && {
      label: `Estado: ${CASE_STATUS_META[status as CaseFileStatus]?.label ?? 'Todos los estados'}`,
      clear: () => change(setStatus, statusDefault),
    },
    scope !== 'all' && {
      label: `Seguimiento y favoritos: ${scopeLabel}`,
      clear: () => change(setScope, 'all'),
    },
    priority && {
      label: `Prioridad: ${priority === 'urgent' ? 'Urgente' : priority === 'high' ? 'Alta' : priority === 'normal' ? 'Normal' : 'Baja'}`,
      clear: () => change(setPriority, ''),
    },
    tag && { label: `Etiqueta: ${tag}`, clear: () => change(setTag, '') },
    access && {
      label: access === 'public' ? 'Acceso: Público con código' : 'Acceso: Privado',
      clear: () => change(setAccess, ''),
    },
    (from || to) && {
      label: `${completed ? 'Fecha de cierre' : 'Fecha de creación'}: ${from || 'Desde el inicio'} – ${to || 'Sin límite'}`,
      clear: () => { setFrom(''); setTo(''); setPage(1); },
    },
    scheduled && {
      label: 'Envíos programados',
      clear: () => {
        setScheduled(false);
        setPage(1);
      },
    },
  ].filter((value): value is { label: string; clear: () => void } => Boolean(value));
  const filterSelect = (
    label: string,
    value: string,
    setter: (value: string) => void,
    options: { id: string; name: string }[],
    clearValue = ''
  ) => (
    <CaseFilterSelect
      label={label}
      value={value}
      emptyValue={clearValue}
      onChange={(selected) => change(setter, selected)}
      onClear={value === clearValue ? undefined : () => change(setter, clearValue)}
      options={[
        {
          id: label === 'Estado' ? 'all' : clearValue,
          name:
            label === 'Estado'
              ? 'Todos los estados'
              : label === 'Acceso'
                ? 'Todas las modalidades'
                : label === 'Prioridad'
                  ? 'Todas las prioridades'
                  : label === 'Categoría de expediente'
                    ? 'Todas las categorías'
                    : label === 'Responsable'
                      ? 'Todos los responsables'
                      : label === 'Etiquetas'
                        ? 'Todas las etiquetas'
                        : 'Todos los tipos',
        },
        ...options,
      ]}
    />
  );
  const filterControls: Record<string, ReactNode> = {
    category: filterSelect(
      'Categoría de expediente',
      category,
      (value) => {
        setCategory(value);
        if (value && value !== category) setSubtype('');
      },
      categoryOptions
    ),
    subtype: filterSelect('Tipo de expediente', subtype, setSubtype, subtypeOptions),
    template: filterSelect('Nombre del tipo de expediente', type, setType, templateOptions),
    scope: (
      <CaseFilterSelect
        label="Seguimiento y favoritos"
        value={scope}
        options={scope === 'mine' ? [...scopeOptions, { id: 'mine', name: 'Soy responsable' }] : scopeOptions}
        onChange={(value) => change(setScope, value)}
        onClear={() => change(setScope, 'all')}
      />
    ),
    responsible: filterSelect('Responsable', responsible, setResponsible, [
      { id: 'me', name: 'Soy responsable' },
    ]),
    status: filterSelect(
      'Estado',
      status,
      setStatus,
      Object.entries(CASE_STATUS_META).map(([id, meta]) => ({ id, name: meta.label })),
      statusDefault
    ),
    priority: filterSelect('Prioridad', priority, setPriority, [
      { id: 'low', name: 'Baja' },
      { id: 'normal', name: 'Normal' },
      { id: 'high', name: 'Alta' },
      { id: 'urgent', name: 'Urgente' },
    ]),
    tag: filterSelect(
      'Etiquetas',
      tag,
      setTag,
      (data?.tags || []).map((name) => ({ id: name, name }))
    ),
    access: filterSelect('Acceso', access, setAccess, [
      { id: 'private', name: 'Privado' },
      { id: 'public', name: 'Público con código' },
    ]),
    dates: (
      <CaseDateRangeFilter
        label={completed ? 'Fecha de cierre' : 'Fecha de creación'}
        from={from}
        to={to}
        onChange={(nextFrom, nextTo) => {
          setFrom(nextFrom);
          setTo(nextTo);
          setPage(1);
        }}
      />
    ),
    scheduled: !completed && (
      <CaseFilterSelect
        label="Envío"
        value={scheduled ? 'scheduled' : ''}
        onClear={() => { setScheduled(false); setPage(1); }}
        options={[
          { id: '', name: 'Todos los envíos' },
          { id: 'scheduled', name: 'Programados' },
        ]}
        onChange={(value) => {
          setScheduled(value === 'scheduled');
          setPage(1);
        }}
      />
    ),
  };
  const visibleFilterItems = viewPreferences.value.filters.filter(
    (item) => item.visible && filterControls[item.id]
  );
  const filters = (
    <WorkspaceTableToolbar
      label="Barra de expedientes"
      searchLabel="Buscar expedientes"
      query={query}
      onQueryChange={setQuery}
      applied={criteria}
      onClearFilters={() => reset(false)}
      controls={
        <>
          <CaseFilterSelect
            label="Ordenar expedientes"
            value={sort}
            sortControl
            options={caseOrderOptions}
            onChange={(value) => change(setSort, value)}
            onRefresh={() => setRefresh((v) => v + 1)}
            refreshing={loading}
          />
          {!completed && (
            <WorkspaceTableViewToggle
              value={grid ? 'grid' : 'list'}
              onChange={(value) => {
                const nextGrid = value === 'grid';
                if (nextGrid !== grid) setPage(1);
                setGrid(nextGrid);
              }}
            />
          )}
          <button
            type="button"
            aria-label="Personalizar vista"
            disabled={!viewPreferences.ready || columnReorder.saving}
            onClick={() => setCustomizeOpen(true)}
            title="Personalizar vista"
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:border-slate-300 hover:bg-muted/50 hover:text-foreground disabled:opacity-50"
          >
            <SlidersHorizontal size={16} />
          </button>
          <button
            type="button"
            aria-label={wide ? 'Salir de vista amplia' : 'Vista amplia'}
            title={wide ? 'Salir de vista amplia' : 'Vista amplia'}
            aria-pressed={wide}
            onClick={() => setWide((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:border-slate-300 hover:bg-muted/50 hover:text-foreground disabled:opacity-50"
          >
            {wide ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </>
      }
      filters={visibleFilterItems.length > 0 && visibleFilterItems.map((item) => (
        <Fragment key={item.id}>{filterControls[item.id]}</Fragment>
      ))}
    />
  );
  const empty = (
    <div className="flex min-h-72 flex-col items-center justify-center p-8 text-center">
      <FolderKanban size={30} className="mb-4 text-primary" />
      <h2 className="text-sm font-semibold">
        {completed && status === 'sealed'
          ? 'Aún no hay expedientes completados'
          : 'No hay expedientes con estos filtros'}
      </h2>
      <p className="mt-2 max-w-sm text-sm text-slate-500">
        {completed && status === 'sealed'
          ? 'Aquí aparecerán los expedientes cerrados de este tipo.'
          : 'Prueba con otros criterios o limpia los filtros.'}
      </p>
      {(criteria.length > 0 || query) && (
        <button onClick={() => reset()} className="mt-4 text-sm text-primary">
          Restablecer filtros
        </button>
      )}
    </div>
  );
  const paging = data && (!grid || completed) && (
    <TablePagination
      total={data.total}
      page={data.page}
      pageSize={pageSize}
      onPageChange={setPage}
      onPageSizeChange={(size) => {
        setPageSize(size);
        setPage(1);
      }}
      disabled={loading || listing?.key !== requestKey}
    />
  );
  const actions = (row: CaseBrowserRow) => (
    <CaseRowActions
      id={row.id}
      title={row.title}
      favorite={row.favorite}
      moveDisabled={!folders.ready}
      favoriteDisabled={favoriteBusy !== null}
      onMove={() => {
        setMoving(row);
        setMoveTarget(folders.folders.find((f) => f.caseIds.includes(row.id))?.id || '');
        setFolderError('');
      }}
      onFavorite={() => void favorite(row)}
      onPreview={() => setPreview(row)}
    />
  );
  function caseValue(row: CaseBrowserRow, id: string): ReactNode {
    switch (id) {
      case 'type':
        return (
          <>
            <p className="text-xs">{row.case_subtype || 'Sin especificar'}</p>
            <p className="mt-1 text-xs text-slate-400">{row.templateName}</p>
          </>
        );
      case 'participant':
        return (
          <>
            <p className="text-xs">{row.subject_name || 'Sin participante'}</p>
            <p className="mt-1 text-xs text-slate-400">
              {row.participants.length}{' '}
              {row.participants.length === 1 ? 'participante' : 'participantes'}
            </p>
          </>
        );
      case 'status':
        return (
          <>
            <CaseStatusBadge status={row.status} />
            {row.isScheduled && <p className="mt-2 text-xs text-primary">Envío programado</p>}
          </>
        );
      case 'progress':
        return <Progress value={row.progress} />;
      case 'updated':
        return caseDate(row.updated_at);
      case 'category':
        return row.case_type || 'Sin especificar';
      case 'priority':
        return (
          <span
            className={
              row.priority === 'urgent'
                ? 'inline-flex items-center gap-1 text-orange-600'
                : 'text-slate-600'
            }
          >
            {row.priority === 'urgent' && <Zap size={13} />}
            {{ low: 'Baja', normal: 'Normal', high: 'Alta', urgent: 'Urgente' }[row.priority] ||
              'Sin especificar'}
          </span>
        );
      case 'folio':
        return row.folio;
      case 'responsible':
        return row.responsibleNames?.length ? row.responsibleNames.join(', ') : 'Sin asignar';
      case 'issuer':
        return row.issuerName || 'Sin especificar';
      case 'created':
        return caseDate(row.created_at);
      case 'due':
        return row.target_close_at ? caseDate(row.target_close_at) : 'Sin vencimiento';
      case 'access':
        return row.launch?.access_mode === 'public'
          ? 'Público con código'
          : row.launch?.access_mode === 'private'
            ? 'Privado'
            : 'Sin especificar';
      case 'tags':
        return row.tags.length ? row.tags.join(', ') : 'Sin etiquetas';
      default:
        return null;
    }
  }
  const list = loading ? (
    <div
      role="status"
      className="flex min-h-72 items-center justify-center gap-2 text-sm text-slate-500"
    >
      <Loader2 size={20} className="animate-spin text-primary" />
      Consultando expedientes…
    </div>
  ) : error ? (
    <div className="flex min-h-72 flex-col items-center justify-center gap-3 p-8 text-center">
      <AlertTriangle size={26} className="text-amber-500" />
      <h2 className="text-sm font-semibold">No se pudieron cargar los expedientes</h2>
      <button onClick={() => setRefresh((v) => v + 1)} className={control}>
        Reintentar consulta
      </button>
    </div>
  ) : !data?.items.length ? (
    empty
  ) : completed ? (
    <div>
      {data.items.map((row) => (
        <button
          key={row.id}
          onClick={() => setSelectedId(row.id)}
          aria-pressed={selectedId === row.id}
          className={`flex w-full items-center gap-3 border-t border-slate-100 p-5 text-left transition-colors ${selectedId === row.id ? 'bg-primary/5' : 'hover:bg-slate-50'}`}
        >
          <span className="rounded-lg bg-blue-50 p-3 text-primary">
            <FolderKanban size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {row.subject_name || row.title}
            </span>
            <span className="mt-1 block truncate text-xs text-slate-500">
              {row.title} · {row.folio}
            </span>
            <span className="mt-1 block text-xs text-slate-500">
              {row.closed_at
                ? `Cierre: ${caseDate(row.closed_at)}`
                : `Última actividad: ${caseDate(row.updated_at)}`}
            </span>
          </span>
          <CaseStatusBadge status={row.status} />
        </button>
      ))}
    </div>
  ) : grid ? (
    <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
      {data.items.map((row) => (
        <article key={row.id} className="case-card rounded-lg border border-slate-200 p-4">
          <div className="mb-4 flex items-start justify-between gap-2">
            <FolderKanban size={22} className="text-primary" />
          </div>
          <Link
            href={`/expedientes/${row.id}`}
            className="text-sm font-semibold hover:text-primary"
          >
            {row.title}
          </Link>
          {row.priority === 'urgent' && (
            <span className="mt-2 inline-flex items-center gap-1 text-xs text-orange-600">
              <Zap size={12} />
              Urgente
            </span>
          )}
          <div className="case-card-fields mt-3 lg:block lg:space-y-3">
            {visibleGridRows.map((column) => (
              <div key={column.id} className="text-xs text-slate-600">
                <p className="mb-1 text-[11px] text-slate-400">{column.label}</p>
                {caseValue(row, column.id)}
              </div>
            ))}
          </div>
          <div className="mt-3 border-t border-slate-100 pt-2">{actions(row)}</div>
        </article>
      ))}
    </div>
  ) : (
    <TableScrollArea label="Tabla de expedientes">
      <table
        className="responsive-data-table workspace-actions-table w-full text-left text-sm xl:table-fixed"
        style={{ minWidth: tableMinWidth }}
      >
        <colgroup>
          {/* The data columns share any extra space while the actions column stays fixed. */}
          {tableColumns.map(({ id, width }) => (
            <col key={id} style={{ width: `${(width / dataColumnsWidth) * 100}%` }} />
          ))}
          <col style={{ width: WORKSPACE_ACTIONS_COLUMN_WIDTH }} />
        </colgroup>
        <thead className="workspace-table-heading">
          <tr>
            {tableColumns.map(({ id, label, width }) => {
              const ordering = caseOrderColumns[id];
              const direction =
                ordering && getTableSortDirection(sort, ordering.ascending, ordering.descending);
              return (
                <ResizableTableHeader
                  key={id}
                  colKey={id}
                  movement={columnReorder.movement(id, label)}
                  width={width}
                  minWidth={caseColumnMinWidth(id)}
                  maxWidth={CASE_COLUMN_MAX_WIDTH}
                  ariaSort={ordering ? tableAriaSort(direction) : undefined}
                  resizeLabel={`Ajustar ancho de ${label}`}
                  onResize={
                    viewPreferences.ready ? (id, width) => setResizeDraft({ id, width }) : undefined
                  }
                  onResizeEnd={(id, width) => {
                    setResizeDraft(null);
                    viewPreferences.resizeColumn(id, width);
                  }}
                  className="px-4 py-3 max-xl:[&>[role=separator]]:hidden"
                >
                  {ordering ? (
                    <TableSortButton
                      label={label}
                      direction={direction}
                      defaultDirection={ordering.defaultDirection}
                      onSort={(next) =>
                        change(setSort, next === 'asc' ? ordering.ascending : ordering.descending)
                      }
                    />
                  ) : (
                    <span className="block truncate" title={label}>
                      {label}
                    </span>
                  )}
                </ResizableTableHeader>
              );
            })}
            <th scope="col" className="workspace-table-actions py-3">
              Acciones
            </th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((row) => (
            <tr key={row.id} className="hover:bg-blue-50/25">
              <td className="break-words px-4 py-4">
                <Link
                  href={`/expedientes/${row.id}`}
                  className="font-medium text-foreground hover:text-primary"
                >
                  {row.title}
                </Link>
                {row.priority === 'urgent' && (
                  <span className="ml-2 inline-flex items-center gap-1 rounded bg-orange-50 px-1.5 py-0.5 text-xs font-normal text-orange-600">
                    <Zap size={12} />
                    Urgente
                  </span>
                )}
                {!visibleColumns.some((column) => column.id === 'folio') && (
                  <p className="mt-1 text-xs text-muted-foreground">{row.folio}</p>
                )}
              </td>
              {visibleColumns.map((column) => (
                <td
                  key={column.id}
                  data-label={column.label}
                  className="break-words px-4 py-4 text-xs font-normal text-muted-foreground [&_.font-medium]:font-normal"
                >
                  {caseValue(row, column.id)}
                </td>
              ))}
              <td
                data-label="Acciones"
                className="workspace-table-actions py-4 xl:[&>.case-row-actions]:justify-center"
              >
                {actions(row)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScrollArea>
  );
  const caseHeading = (
    <WorkspacePageHeader
      title={completed ? 'Expedientes completados' : 'Expedientes'}
      description={
        completed
          ? `${data?.templates.find((t) => t.id === type)?.name || 'Expedientes'} · ${data?.total ?? '…'} registros`
          : undefined
      }
    >
      {completed ? (
        <Link href="/expedientes" className={`${control} inline-flex items-center gap-2`}>
          <X size={15} />
          Cerrar
        </Link>
      ) : (
        <>
          <button
            disabled={!folders.ready}
            onClick={() => {
              setFolderName('');
              setFolderDescription('');
              setFolderError('');
              setFolderDialog(true);
            }}
            className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-600 text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
          >
            <FolderPlus size={16} className="text-primary" />
            Crear Carpeta
          </button>
          <Link
            href="/expedientes/lanzar"
            className="flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-white shadow-[0_8px_18px_-12px_rgba(30,107,255,0.85)] transition-colors hover:bg-primary/90"
          >
            <Send size={16} aria-hidden="true" />
            Lanzar Expediente
          </Link>
        </>
      )}
    </WorkspacePageHeader>
  );

  return (
    <AppLayout noPadding={wide || !completed}>
      <WorkspaceLayout
        standaloneClassName={
          wide
            ? 'fixed inset-0 z-[100] flex overflow-y-auto bg-[#f6f8fb] dark:bg-background'
            : completed
              ? 'w-full'
              : undefined
        }
      >
        {!completed && !wide && <WorkspaceTabs active="expedientes" heading={caseHeading} />}
        {!completed && !wide && (
          <ResponsiveSidebar
            label="Filtros y carpetas de expedientes"
            className="workspace-sidebar w-60 shrink-0 rounded-lg border border-slate-200 bg-white p-3 lg:pt-5 xl:col-start-1 xl:row-start-2 xl:mb-5 xl:mt-4 2xl:w-64 dark:border-border dark:bg-card"
          >
            {([
              {
                heading: 'Principal',
                items: [
                  ['all', 'Mis expedientes', FolderKanban],
                  ['favorites', 'Mis favoritos', Star],
                ],
              },
              {
                heading: 'Seguimiento',
                items: [
                  ['active', 'En seguimiento', Clock3],
                  ['sealed', 'Completados', CheckCircle2],
                  ['observed', 'Con observaciones', AlertTriangle],
                  ['due', 'Por vencer (72 h)', Clock3],
                ],
              },
            ] as const).map((group) => (
              <section key={group.heading} className="mb-5">
                <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                  {group.heading}
                </p>
                {group.items.map(([id, label, Icon]) => {
                  const state = ['sealed', 'observed'].includes(id),
                    active =
                      !folderId && (state ? status === id : scope === id && status === 'all');
                  return (
                    <button
                      key={id}
                      onClick={() => {
                        setFolderId('');
                        setScope(state ? 'all' : id);
                        setStatus(state ? id : 'all');
                        setPage(1);
                      }}
                      aria-pressed={active}
                      className={`mb-1 flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-medium ${active ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-50 dark:text-muted-foreground'}`}
                    >
                      <Icon size={17} className={id === 'favorites' ? 'text-amber-400' : ''} />
                      <span className="flex-1">{label}</span>
                    </button>
                  );
                })}
              </section>
            ))}
            <section className="mb-5" aria-label="Carpetas de expedientes">
              <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                Mis carpetas
              </p>
              {folders.error ? (
                <div role="alert" className="px-3 text-xs text-red-600">
                  {folders.error}
                  <button className="ml-2 text-primary" onClick={folders.retry}>
                    Reintentar
                  </button>
                </div>
              ) : !folders.ready ? (
                <p className="px-3 text-xs text-slate-400">Cargando carpetas…</p>
              ) : folders.folders.length ? (
                folders.folders.map((f) => (
                  <button
                    key={f.id}
                    title={f.description || f.name}
                    aria-pressed={folderId === f.id}
                    onClick={() => {
                      reset();
                      setFolderId(f.id);
                    }}
                    className={`mb-1 flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-medium ${folderId === f.id ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-50'}`}
                  >
                    <Folder size={17} className="shrink-0 text-amber-500" />
                    <span className="flex-1 truncate">{f.name}</span>
                  </button>
                ))
              ) : (
                <p className="px-3 text-xs text-slate-400">Sin carpetas</p>
              )}
            </section>
            {activeWorkspace?.id && (
              <SavedCaseFilters
                workspaceId={activeWorkspace.id}
                current={{
                  category,
                  subtype,
                  responsible,
                  type,
                  status,
                  scope,
                  query,
                  priority,
                  tag,
                  access,
                  from,
                  to,
                  scheduled,
                  sort,
                }}
                templates={data?.templates || []}
                tags={data?.tags || []}
                onApply={applySavedFilters}
              />
            )}
          </ResponsiveSidebar>
        )}
        <main
          className={
            completed && !wide
              ? ''
              : `min-w-0 flex-1 pb-4 pt-4 md:pb-5 xl:col-start-2 xl:row-start-2 ${wide ? 'px-4 sm:px-5 lg:px-6 xl:px-7' : ''}`
          }
        >
          {(completed || wide) && caseHeading}
          {viewPreferences.error && !completed && (
            <p role="alert" className="mb-4 text-sm text-amber-700">
              {viewPreferences.error}{' '}
              <button onClick={viewPreferences.retry} className="text-primary">
                Reintentar personalización
              </button>
            </p>
          )}
          {viewPreferences.widthError && !completed && (
            <p role="alert" className="mb-4 text-sm text-amber-700">
              No se pudo guardar el ancho de las columnas.{' '}
              <button type="button" onClick={viewPreferences.retryWidths} className="text-primary">
                Reintentar guardado
              </button>
            </p>
          )}
          {columnReorder.error && !completed && (
            <p role="alert" className="mb-4 text-sm text-destructive">{columnReorder.error}</p>
          )}
          {error && (
            <p
              role="alert"
              className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
            >
              {error}
            </p>
          )}
          {completed ? (
            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
              <section className="min-h-[65vh] overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-border dark:bg-card">
                <div className="p-4">
                  {filters}
                  <p className="text-xs text-slate-500">{data?.total ?? 0} expedientes</p>
                </div>
                {list}
                {paging}
              </section>
              <aside
                aria-label="Detalle del expediente"
                className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-border dark:bg-card"
              >
                {!loading && selected ? (
                  <CaseResultDetail key={`${selected.id}:${selected.updated_at}`} row={selected} />
                ) : (
                  <div className="p-8 text-sm text-slate-500">
                    {loading
                      ? 'Cargando detalle…'
                      : 'Selecciona un expediente para consultar su información, documentos y formularios.'}
                  </div>
                )}
              </aside>
            </div>
          ) : (
            <>
              {filters}
              <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-border dark:bg-card">
                {list}
                {paging}
              </section>
              {hasMore && (
                <div ref={moreTarget} className="min-h-px pt-2 text-center text-sm text-slate-500">
                  {moreStatus === 'loading' && (
                    <p role="status" className="py-2">
                      Cargando más expedientes…
                    </p>
                  )}
                  {moreStatus === 'error' && (
                    <div className="py-2">
                      <p role="alert">No se pudieron cargar más expedientes.</p>
                      <button
                        type="button"
                        className="mt-1 text-primary hover:underline"
                        onClick={() => setMoreStatus('idle')}
                      >
                        Reintentar
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </main>
      </WorkspaceLayout>
      {customizeOpen && (
        <CustomizeCaseView
          open
          onClose={() => setCustomizeOpen(false)}
          columns={viewPreferences.value.columns}
          filters={viewPreferences.value.filters}
          gridColumns={viewPreferences.value.gridColumns}
          defaultColumns={CASE_VIEW_COLUMNS}
          defaultFilters={CASE_VIEW_FILTERS}
          defaultGridColumns={CASE_VIEW_GRID}
          mandatoryColumnLabel="Expediente"
          entityLabel="expediente"
          onSave={async (value) => {
            await viewPreferences.save(value);
          }}
        />
      )}
      {folderDialog && (
        <LaunchDialog
          title="Crear carpeta"
          description="Organiza tus expedientes dentro de Mi Espacio."
          onClose={() => {
            if (!folders.busy) setFolderDialog(false);
          }}
          footer={
            <>
              <button
                disabled={folders.busy}
                onClick={() => setFolderDialog(false)}
                className={control}
              >
                Cancelar
              </button>
              <button
                disabled={folders.busy}
                onClick={async () => {
                  try {
                    setFolderError('');
                    await folders.save(
                      addCaseFolder(folders.folders, {
                        id: crypto.randomUUID(),
                        name: folderName,
                        description: folderDescription,
                        caseIds: [],
                      })
                    );
                    setFolderDialog(false);
                  } catch (e) {
                    setFolderError(e instanceof Error ? e.message : 'No se pudo crear la carpeta.');
                  }
                }}
                className="h-10 rounded-lg bg-primary px-4 text-sm font-medium text-white disabled:opacity-50"
              >
                {folders.busy ? 'Guardando…' : 'Crear carpeta'}
              </button>
            </>
          }
        >
          <label className="block text-sm font-medium">
            Nombre <span className="text-red-500">*</span>
            <input
              autoFocus
              maxLength={80}
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              className={control + ' mt-2 w-full'}
              placeholder="Ej. Contratos 2026"
            />
          </label>
          <label className="mt-4 block text-sm font-medium">
            Descripción
            <input
              maxLength={200}
              value={folderDescription}
              onChange={(e) => setFolderDescription(e.target.value)}
              className={control + ' mt-2 w-full'}
            />
          </label>
          {folderError && (
            <p role="alert" className="mt-4 text-sm text-red-600">
              {folderError}
            </p>
          )}
        </LaunchDialog>
      )}
      {moving && (
        <LaunchDialog
          title="Mover a carpeta"
          description={moving.title}
          onClose={() => {
            if (!folders.busy) setMoving(null);
          }}
          footer={
            <>
              <button disabled={folders.busy} onClick={() => setMoving(null)} className={control}>
                Cancelar
              </button>
              <button
                disabled={folders.busy}
                onClick={async () => {
                  try {
                    setFolderError('');
                    await folders.save(moveCaseToFolder(folders.folders, moving.id, moveTarget));
                    setMoving(null);
                    setRefresh((v) => v + 1);
                  } catch (e) {
                    setFolderError(
                      e instanceof Error ? e.message : 'No se pudo mover el expediente.'
                    );
                  }
                }}
                className="h-10 rounded-lg bg-primary px-4 text-sm font-medium text-white disabled:opacity-50"
              >
                {folders.busy ? 'Guardando…' : 'Mover expediente'}
              </button>
            </>
          }
        >
          <label className="block text-sm font-medium">
            Carpeta
            <select
              aria-label="Carpeta"
              value={moveTarget}
              onChange={(e) => setMoveTarget(e.target.value)}
              className={control + ' mt-2 w-full'}
            >
              <option value="">Sin carpeta</option>
              {folders.folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          {folderError && (
            <p role="alert" className="mt-4 text-sm text-red-600">
              {folderError}
            </p>
          )}
        </LaunchDialog>
      )}
      {preview && (
        <LaunchDialog
          title={preview.title}
          description={preview.folio}
          onClose={() => setPreview(null)}
        >
          <CaseResultDetail
            key={preview.id}
            row={preview}
            onChange={() => {
              setPreview(null);
              setRefresh((v) => v + 1);
            }}
          />
        </LaunchDialog>
      )}
    </AppLayout>
  );
}
function Progress({ value }: { value: number }) {
  return (
    <>
      <p className="text-xs tabular-nums">{value}%</p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
    </>
  );
}
