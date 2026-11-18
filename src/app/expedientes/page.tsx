'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Archive,
  ArrowUpDown,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  CirclePause,
  ClipboardCheck,
  ClipboardClock,
  Eye,
  Edit3,
  FolderKanban,
  ListFilter,
  Loader2,
  MoreHorizontal,
  Play,
  Plus,
  RotateCcw,
  Search,
  Send,
  Star,
  X,
  type LucideIcon,
} from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { createClient } from '@/lib/supabase/client';
import { caseRequest } from '@/lib/case-files/runtime-client';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAuth } from '@/contexts/AuthContext';
import { type CaseFileSummary } from '@/lib/case-files/schema';
import { parseStoredCaseTemplate, toCaseTemplate, type StoredCaseTemplate } from '@/lib/case-files/template-builder';
import {
  CaseStatusBadge,
  CaseWorkspace,
  HumanEmpty,
  MetricCard,
  SectionHeader,
} from './components/CaseUI';
import CaseTemplatePreview from './components/CaseTemplatePreview';

export default function ExpedientesPage() {
  const router = useRouter();
  const { activeWorkspace } = useWorkspace();
  const { user } = useAuth();
  const [items, setItems] = useState<CaseFileSummary[]>([]);
  const [savedTemplates, setSavedTemplates] = useState<StoredCaseTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [responsesSummaryOpen, setResponsesSummaryOpen] = useState(false);
  const [responseMetrics, setResponseMetrics] = useState<{
    assigned: number;
    responses: number;
    inProgress: number;
    pending: number;
  } | null>(null);
  const [responsesLoading, setResponsesLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [activityFilter, setActivityFilter] = useState<
    'all' | 'with_cases' | 'completed' | 'without_cases' | 'favorites'
  >('all');
  const [typeStatusFilter, setTypeStatusFilter] = useState<
    'available' | 'all' | 'active' | 'draft' | 'paused' | 'archived'
  >('available');
  const [typeStatusBusyId, setTypeStatusBusyId] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<StoredCaseTemplate | null>(null);
  const [archiveError, setArchiveError] = useState('');
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [favoritesReady, setFavoritesReady] = useState(false);
  const [favoritePendingId, setFavoritePendingId] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState('');
  const [sortMode, setSortMode] = useState<'recent' | 'oldest' | 'name_asc' | 'name_desc'>(
    'recent'
  );
  const [openedType, setOpenedType] = useState<string | null>(null);
  const [dialogStatus, setDialogStatus] = useState<'all' | 'sealed'>('all');
  const [caseListMode, setCaseListMode] = useState<'view' | 'edit'>('view');
  const [editingCase, setEditingCase] = useState<{
    id: string;
    title: string;
    description: string;
    targetCloseAt: string;
  } | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [previewTypeId, setPreviewTypeId] = useState<string | null>(null);
  const [actionMenu, setActionMenu] = useState<{
    templateId: string;
    top: number;
    left: number;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setFavoritesReady(false);
      setFavoriteIds(new Set());
      if (!user?.id || !activeWorkspace?.id) return;
      createClient().from('user_favorites').select('item_id')
        .eq('user_id', user.id)
        .eq('storage_key', `expedientes-tipos:${activeWorkspace.id}`)
        .then(({ data, error }) => {
          if (cancelled) return;
          if (error) setActionNotice('No se pudieron cargar tus tipos de expediente favoritos.');
          else { setFavoriteIds(new Set((data || []).map((row) => row.item_id))); setFavoritesReady(true); }
        });
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [user?.id, activeWorkspace?.id]);

  const toggleFavorite = async (templateId: string) => {
    if (!user?.id || !activeWorkspace?.id || !favoritesReady || favoritePendingId) return;
    const wasFavorite = favoriteIds.has(templateId);
    const storageKey = `expedientes-tipos:${activeWorkspace.id}`;
    setFavoritePendingId(templateId);
    setFavoriteIds((current) => {
      const next = new Set(current);
      if (wasFavorite) next.delete(templateId); else next.add(templateId);
      return next;
    });
    const supabase = createClient();
    const operation = wasFavorite
      ? supabase.from('user_favorites').delete().eq('user_id', user.id).eq('storage_key', storageKey).eq('item_id', templateId)
      : supabase.from('user_favorites').upsert({ user_id: user.id, storage_key: storageKey, item_id: templateId }, { onConflict: 'user_id,storage_key,item_id' });
    const { error } = await operation;
    if (error) {
      setFavoriteIds((current) => {
        const next = new Set(current);
        if (wasFavorite) next.add(templateId); else next.delete(templateId);
        return next;
      });
      setActionNotice('No se pudo actualizar este favorito.');
    }
    setFavoritePendingId(null);
  };

  useEffect(() => {
    if (!activeWorkspace?.id) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const supabase = createClient();
      const [{ data, error }, { data: templateData, error: templateError }] = await Promise.all([supabase
        .from('case_files')
        .select('*')
        .eq('workspace_id', activeWorkspace.id)
        .order('updated_at', { ascending: false }), supabase
        .from('case_file_templates')
        .select('id,name,description,case_type,case_subtype,requirements_schema,status,archived_from_status')
        .eq('workspace_id', activeWorkspace.id)
        .order('updated_at', { ascending: false })]);
      if (cancelled) return;
      setSavedTemplates(templateError ? [] : (templateData || []) as StoredCaseTemplate[]);
      if (error) {
        setItems([]);
        setLoadError(true);
      } else {
        setItems((data || []).map(mapCaseRow));
        setLoadError(false);
      }
      setLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspace?.id]);

  useEffect(() => {
    if (!activeWorkspace?.id) return;
    let cancelled = false;
    const loadResponses = async () => {
      setResponsesLoading(true);
      setResponseMetrics(null);
      const supabase = createClient();
      const workspaceId = activeWorkspace.id;
      const [assigned, responses, inProgress, pending] = await Promise.all([
        supabase
          .from('case_file_forms')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId),
        supabase
          .from('case_file_form_submissions')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId)
          .not('submitted_at', 'is', null),
        supabase
          .from('case_file_forms')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId)
          .eq('status', 'in_progress'),
        supabase
          .from('case_file_forms')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId)
          .in('status', ['not_started', 'in_progress', 'observed']),
      ]);
      if (cancelled) return;
      if (!assigned.error && !responses.error && !inProgress.error && !pending.error) {
        setResponseMetrics({
          assigned: assigned.count ?? 0,
          responses: responses.count ?? 0,
          inProgress: inProgress.count ?? 0,
          pending: pending.count ?? 0,
        });
      }
      setResponsesLoading(false);
    };
    void loadResponses();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspace?.id]);

  const metrics = useMemo(
    () => ({
      active: items.filter((item) => !['sealed', 'cancelled'].includes(item.status)).length,
      review: items.filter((item) => item.status === 'in_review').length,
      observed: items.filter((item) => item.status === 'observed').length,
      completed: items.filter((item) => item.status === 'sealed').length,
    }),
    [items]
  );

  const allTemplates = savedTemplates.map(toCaseTemplate);
  const savedTemplateById = new Map(savedTemplates.map((template) => [template.id, template]));
  const savedRequirementCounts = new Map(savedTemplates.map((template) => [
    template.id,
    parseStoredCaseTemplate(template).sections.reduce((count, section) => count + section.items.length, 0),
  ]));
  const typeRows = allTemplates.map((template) => {
    const related = items.filter((item) => item.templateId === template.id);
    return {
      ...template,
      status: savedTemplateById.get(template.id)?.status ?? 'active',
      requirementCount: savedRequirementCounts.get(template.id) ?? template.requirements.length,
      total: related.length,
      editable: related.filter((item) => !['sealed', 'cancelled'].includes(item.status)).length,
      completed: related.filter((item) => item.status === 'sealed').length,
      lastActivity: related.reduce<string | null>(
        (latest, item) => (!latest || item.lastActivityAt > latest ? item.lastActivityAt : latest),
        null
      ),
    };
  });
  const filteredTypes = typeRows
    .filter((template) => {
      const matchesQuery = `${template.name} ${template.type} ${template.description}`
        .toLocaleLowerCase('es-MX')
        .includes(query.trim().toLocaleLowerCase('es-MX'));
      const matchesActivity =
        activityFilter === 'all' ||
        (activityFilter === 'with_cases' && template.total > 0) ||
        (activityFilter === 'completed' && template.completed > 0) ||
        (activityFilter === 'without_cases' && template.total === 0) ||
        (activityFilter === 'favorites' && favoriteIds.has(template.id));
      const matchesStatus = typeStatusFilter === 'all' ||
        (typeStatusFilter === 'available' ? template.status !== 'archived' : template.status === typeStatusFilter);
      return matchesQuery && matchesActivity && matchesStatus;
    })
    .sort((left, right) => {
      if (sortMode === 'name_asc') return left.name.localeCompare(right.name, 'es-MX');
      if (sortMode === 'name_desc') return right.name.localeCompare(left.name, 'es-MX');
      const difference = (left.lastActivity || '').localeCompare(right.lastActivity || '');
      return sortMode === 'oldest' ? difference : -difference;
    });
  const dialogCases = items.filter(
    (item) => item.templateId === openedType &&
      (caseListMode === 'edit' ? !['sealed', 'cancelled'].includes(item.status) :
        dialogStatus === 'all' || item.status === 'sealed')
  );
  const openCases = (
    caseType: string,
    selectedStatus: 'all' | 'sealed' = 'all',
    mode: 'view' | 'edit' = 'view'
  ) => {
    if(mode==='view'){router.push(selectedStatus==='sealed' ? `/expedientes/completados?tipo=${encodeURIComponent(caseType)}` : `/mis-documentos?pestana=expedientes&tipo=${encodeURIComponent(caseType)}`);return;}
    setOpenedType(caseType);
    setDialogStatus(selectedStatus);
    setCaseListMode(mode);
  };
  const beginEditCase = async (caseId: string) => {
    if (!activeWorkspace?.id || editLoading) return;
    setEditLoading(true);
    setEditError('');
    const { data, error } = await createClient().from('case_files')
      .select('id,title,description,target_close_at')
      .eq('id', caseId).eq('workspace_id', activeWorkspace.id).single();
    setEditLoading(false);
    if (error || !data) { setActionNotice('No se pudo abrir el expediente para editarlo.'); return; }
    setOpenedType(null);
    setEditingCase({
      id: data.id,
      title: data.title,
      description: data.description || '',
      targetCloseAt: data.target_close_at?.slice(0, 10) || '',
    });
  };
  const saveEditCase = async () => {
    if (!editingCase || !activeWorkspace?.id || editSaving) return;
    if (!editingCase.title.trim()) { setEditError('Escribe el nombre del expediente.'); return; }
    setEditSaving(true);
    setEditError('');
    let data:{id:string}|null=null,error:unknown=null;
    try {
      const source=await createClient().from('case_files').select('runtime_version').eq('id',editingCase.id).single();
      if(source.error)throw source.error;
      if(source.data.runtime_version===1){const snapshot=await caseRequest<{revision:string}>(`/api/expedientes/${editingCase.id}/control`);data=await caseRequest<{id:string}>(`/api/expedientes/${editingCase.id}/control`,{action:'metadata',revision:snapshot.revision,operationKey:crypto.randomUUID(),title:editingCase.title,description:editingCase.description,targetCloseAt:editingCase.targetCloseAt||null});}
      else {const saved=await createClient().from('case_files').update({title:editingCase.title.trim(),description:editingCase.description.trim(),target_close_at:editingCase.targetCloseAt||null}).eq('id',editingCase.id).eq('workspace_id',activeWorkspace.id).select('id').single();data=saved.data;error=saved.error;}
    }catch(cause){error=cause;}
    setEditSaving(false);
    if (error || !data) { setEditError('No se pudieron guardar los cambios. Inténtalo de nuevo.'); return; }
    setItems((current) => current.map((item) => item.id === editingCase.id
      ? { ...item, title: editingCase.title.trim(), targetCloseAt: editingCase.targetCloseAt || undefined }
      : item));
    setEditingCase(null);
    setActionNotice('Expediente actualizado.');
  };
  const changeTypeStatus = async (
    template: StoredCaseTemplate,
    nextStatus: StoredCaseTemplate['status']
  ) => {
    if (!activeWorkspace?.id || typeStatusBusyId) return;
    const valid =
      (template.status === 'active' && ['paused', 'archived'].includes(nextStatus)) ||
      (template.status === 'paused' && ['active', 'archived'].includes(nextStatus)) ||
      (template.status === 'draft' && nextStatus === 'archived') ||
      (template.status === 'archived' && nextStatus === (template.archived_from_status ?? 'active'));
    if (!valid) return;
    setTypeStatusBusyId(template.id);
    setArchiveError('');
    setActionNotice('');
    setActionMenu(null);
    const { data, error } = await createClient().from('case_file_templates')
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq('id', template.id)
      .eq('workspace_id', activeWorkspace.id)
      .eq('status', template.status)
      .select('id,status,archived_from_status')
      .single();
    setTypeStatusBusyId(null);
    if (error || !data) {
      const message = 'No se pudo cambiar el estado del tipo de expediente. Inténtalo de nuevo.';
      setActionNotice(message);
      if (archiveTarget?.id === template.id) setArchiveError(message);
      return;
    }
    setSavedTemplates((current) => current.map((item) => item.id === template.id
      ? { ...item, status: data.status as StoredCaseTemplate['status'], archived_from_status: data.archived_from_status as StoredCaseTemplate['archived_from_status'] }
      : item));
    setArchiveTarget(null);
    setPreviewTypeId(null);
    setActionNotice(nextStatus === 'paused' ? 'Tipo de expediente pausado.' :
      nextStatus === 'archived' ? 'Tipo de expediente archivado.' :
        template.status === 'archived' ? 'Tipo de expediente restaurado.' : 'Tipo de expediente reanudado.');
  };
  const previewTemplate = allTemplates.find((template) => template.id === previewTypeId);
  const previewSavedTemplate = savedTemplates.find((template) => template.id === previewTypeId);
  const previewDraft = previewSavedTemplate ? parseStoredCaseTemplate(previewSavedTemplate) : null;
  const menuTemplate = allTemplates.find((template) => template.id === actionMenu?.templateId);
  const menuSavedTemplate = menuTemplate ? savedTemplateById.get(menuTemplate.id) : undefined;
  const menuTypeRow = typeRows.find((template) => template.id === actionMenu?.templateId);

  useEffect(() => {
    if (!actionMenu) return;
    menuRef.current?.querySelector('button')?.focus();
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (
        menuRef.current?.contains(event.target as Node) ||
        menuTriggerRef.current?.contains(event.target as Node)
      )
        return;
      setActionMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActionMenu(null);
        menuTriggerRef.current?.focus();
      }
    };
    const closeOnViewportChange = () => setActionMenu(null);
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', closeOnViewportChange);
    window.addEventListener('scroll', closeOnViewportChange, true);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', closeOnViewportChange);
      window.removeEventListener('scroll', closeOnViewportChange, true);
    };
  }, [actionMenu]);

  useEffect(() => {
    if (!previewTypeId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewTypeId(null);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [previewTypeId]);

  useEffect(() => {
    if (!openedType) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenedType(null);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [openedType]);

  return (
    <AppLayout noPadding>
      <CaseWorkspace>
        <SectionHeader
          title="Expedientes"
          description="Gestiona expedientes digitales verificables en tu espacio de trabajo."
          action={
            <div className="module-page-actions flex flex-wrap gap-2"><button onClick={()=>router.push('/expedientes/lanzar')} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-white"><Send size={16}/>Lanzar expediente</button>
            <button
              onClick={() => router.push('/expedientes/nuevo')}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-600 text-primary-foreground shadow-[0_8px_18px_-12px_rgba(30, 107, 255,0.85)] transition hover:bg-primary/90"
            >
              <Plus size={16} /> Nuevo expediente
            </button></div>
          }
        />

        <section className="mb-4 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-border dark:bg-card">
          <button
            type="button"
            aria-expanded={summaryOpen}
            aria-controls="case-summary-metrics"
            onClick={() => setSummaryOpen((open) => !open)}
            className={`flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-slate-50 dark:hover:bg-muted/40 ${summaryOpen ? 'border-b border-slate-200 dark:border-border' : ''}`}
          >
            <span>
              <span className="block text-sm font-semibold text-slate-950 dark:text-foreground">
                Resumen de expedientes
              </span>
              <span className="mt-0.5 block text-xs text-slate-500 dark:text-muted-foreground">
                Estado de los expedientes del espacio de trabajo actual.
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-3">
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:bg-muted dark:text-muted-foreground">
                {items.length} {items.length === 1 ? 'expediente' : 'expedientes'}
              </span>
              <ChevronDown
                size={18}
                className={`text-slate-500 transition-transform ${summaryOpen ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </span>
          </button>
          <div
            id="case-summary-metrics"
            className={`${summaryOpen ? 'grid' : 'hidden'} grid-cols-2 divide-x divide-y divide-slate-200 dark:divide-border lg:grid-cols-4 lg:divide-y-0`}
          >
            <MetricCard
              icon={FolderKanban}
              label="Expedientes activos"
              value={metrics.active}
              detail="En integración, revisión o firma"
              tone="amber"
            />
            <MetricCard
              icon={ClipboardCheck}
              label="En revisión"
              value={metrics.review}
              detail="Información enviada por validar"
              tone="amber"
            />
            <MetricCard
              icon={AlertTriangle}
              label="Con observaciones"
              value={metrics.observed}
              detail="Requieren una corrección clara"
              tone="red"
            />
            <MetricCard
              icon={CheckCircle2}
              label="Completados"
              value={metrics.completed}
              detail="Cerrados y sellados"
              tone="green"
            />
          </div>
        </section>

        <section className="mb-4 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-border dark:bg-card">
          <button
            type="button"
            aria-expanded={responsesSummaryOpen}
            aria-controls="case-response-summary-metrics"
            onClick={() => setResponsesSummaryOpen((open) => !open)}
            className={`flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-slate-50 dark:hover:bg-muted/40 ${responsesSummaryOpen ? 'border-b border-slate-200 dark:border-border' : ''}`}
          >
            <span>
              <span className="block text-sm font-semibold text-slate-950 dark:text-foreground">
                Resumen de respuestas
              </span>
              <span className="mt-0.5 block text-xs text-slate-500 dark:text-muted-foreground">
                Formularios y respuestas vinculados a expedientes del espacio de trabajo actual.
              </span>
            </span>
            <ChevronDown
              size={18}
              className={`shrink-0 text-slate-500 transition-transform ${responsesSummaryOpen ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </button>
          {responsesSummaryOpen && (
            <div
              id="case-response-summary-metrics"
              className="grid grid-cols-1 divide-y divide-slate-200 dark:divide-border sm:grid-cols-2 sm:divide-x lg:grid-cols-4 lg:divide-y-0"
            >
              <ResponseMetric
                icon={Send}
                label="Formularios vinculados"
                value={responsesLoading ? '…' : (responseMetrics?.assigned ?? '—')}
                tone="blue"
              />
              <ResponseMetric
                icon={BarChart3}
                label="Respuestas"
                value={responsesLoading ? '…' : (responseMetrics?.responses ?? '—')}
                tone="green"
              />
              <ResponseMetric
                icon={ClipboardClock}
                label="En proceso"
                value={responsesLoading ? '…' : (responseMetrics?.inProgress ?? '—')}
                tone="blue"
              />
              <ResponseMetric
                icon={ClipboardClock}
                label="Respuestas pendientes"
                value={responsesLoading ? '…' : (responseMetrics?.pending ?? '—')}
                tone="indigo"
              />
            </div>
          )}
          {responsesSummaryOpen && !responsesLoading && !responseMetrics && (
            <p className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500 dark:border-border">
              No se pudo cargar el resumen de respuestas. Actualiza la página para intentarlo de
              nuevo.
            </p>
          )}
        </section>

        {loadError && (
          <div role="alert" className="mb-3 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertTriangle size={14} />
            No se pudieron cargar los expedientes. Actualiza la página para intentarlo de nuevo.
          </div>
        )}
        {actionNotice && (
          <div role="alert" className="mb-3 flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <span>{actionNotice}</span>
            <button type="button" onClick={() => setActionNotice('')} aria-label="Cerrar aviso"><X size={14} /></button>
          </div>
        )}

        <div className="mb-3 mt-5 flex items-center gap-2">
          <h2 className="text-sm font-600 text-slate-950 dark:text-foreground">
            Tipos de expedientes
          </h2>
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-600 text-primary">
            {filteredTypes.length}
          </span>
        </div>
        <section className="mb-3 overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-border dark:bg-card">
          <div className="flex flex-wrap items-center gap-2 p-3">
            <div className="relative min-w-[180px] flex-1">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
                placeholder="Buscar expedientes..."
                aria-label="Buscar tipos de expedientes"
                className="h-9 w-full rounded-md border border-slate-200 bg-slate-50/70 pl-9 pr-3 text-sm outline-none placeholder:text-slate-400 focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/15 dark:border-border dark:bg-background"
              />
            </div>
            <div className="relative w-full sm:w-56">
              <ListFilter
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
              />
              <select
                value={activityFilter}
                onChange={(event) => {
                  setActivityFilter(event.target.value as typeof activityFilter);
                }}
                aria-label="Filtrar tipos de expedientes"
                className="h-9 w-full appearance-none rounded-md border border-slate-200 bg-white pl-9 pr-9 text-sm text-slate-700 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 dark:border-border dark:bg-background dark:text-foreground"
              >
                <option value="all">Todos ({typeRows.length})</option>
                <option value="with_cases">
                  Con expedientes ({typeRows.filter((row) => row.total > 0).length})
                </option>
                <option value="completed">
                  Con completados ({typeRows.filter((row) => row.completed > 0).length})
                </option>
                <option value="without_cases">
                  Sin expedientes ({typeRows.filter((row) => row.total === 0).length})
                </option>
                <option value="favorites">Favoritos ({typeRows.filter((row) => favoriteIds.has(row.id)).length})</option>
              </select>
              <ChevronDown
                size={14}
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
            </div>
            <div className="relative w-full sm:w-44">
              <select
                value={typeStatusFilter}
                onChange={(event) => setTypeStatusFilter(event.target.value as typeof typeStatusFilter)}
                aria-label="Filtrar por estado del tipo de expediente"
                className="h-9 w-full appearance-none rounded-md border border-slate-200 bg-white px-3 pr-9 text-sm text-slate-700 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 dark:border-border dark:bg-background dark:text-foreground"
              >
                <option value="available">Disponibles ({typeRows.filter((row) => row.status !== 'archived').length})</option>
                <option value="active">Activos ({typeRows.filter((row) => row.status === 'active').length})</option>
                <option value="draft">Borradores ({typeRows.filter((row) => row.status === 'draft').length})</option>
                <option value="paused">Pausados ({typeRows.filter((row) => row.status === 'paused').length})</option>
                <option value="archived">Archivados ({typeRows.filter((row) => row.status === 'archived').length})</option>
                <option value="all">Todos los estados ({typeRows.length})</option>
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            </div>
            <div className="relative min-w-[150px]">
              <ArrowUpDown
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
              />
              <select
                value={sortMode}
                onChange={(event) => {
                  setSortMode(event.target.value as typeof sortMode);
                }}
                aria-label="Ordenar tipos de expedientes"
                className="h-9 w-full appearance-none rounded-md border border-slate-200 bg-white pl-9 pr-8 text-sm text-slate-700 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 dark:border-border dark:bg-background dark:text-foreground"
              >
                <option value="recent">Más recientes</option>
                <option value="oldest">Más antiguos</option>
                <option value="name_asc">Nombre A-Z</option>
                <option value="name_desc">Nombre Z-A</option>
              </select>
              <ChevronDown
                size={14}
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
            </div>
          </div>
        </section>
        <section className="mb-5 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-border dark:bg-card">
          {loading ? (
            <div className="flex min-h-64 items-center justify-center">
              <span className="h-7 w-7 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
            </div>
          ) : filteredTypes.length === 0 ? (
            <HumanEmpty
              title={typeRows.length === 0 ? 'Aún no hay tipos de expediente' : 'No hay tipos con estos filtros'}
              message={typeRows.length === 0
                ? 'Crea un tipo de expediente para definir sus requisitos y empezar a usarlo.'
                : 'Prueba con otra búsqueda o cambia los filtros.'}
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="responsive-data-table w-full min-w-[1220px] table-fixed text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/80 text-left dark:border-border dark:bg-muted/40">
                      <Heading className="w-[20%]">Expediente</Heading>
                      <Heading className="w-[11%]">Tipo de expediente</Heading>
                      <Heading className="w-[23%]">Descripción</Heading>
                      <Heading className="w-[9%]">Requisitos</Heading>
                      <Heading className="w-[11%]">Completados</Heading>
                      <Heading className="w-[11%]">Última actividad</Heading>
                      <Heading className="w-[15%]" align="right">
                        Acciones
                      </Heading>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-border">
                    {filteredTypes.map((template) => (
                      <tr
                        key={template.id}
                        className="transition hover:bg-slate-50/70 dark:hover:bg-muted/30"
                      >
                        <td data-label="Expediente" className="px-4 py-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-blue-100 bg-blue-50 text-primary">
                              <FolderKanban size={17} />
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate font-semibold text-slate-950 dark:text-foreground">
                                {template.name}
                              </span>
                              {savedTemplateById.has(template.id) && (
                                <span className={`block text-xs ${template.status === 'paused' ? 'text-amber-700' : template.status === 'archived' ? 'text-slate-400' : template.status === 'active' ? 'text-emerald-700' : 'text-slate-500'}`}>
                                  {template.status === 'paused' ? 'Pausado' : template.status === 'archived' ? 'Archivado' : template.status === 'active' ? 'Publicado' : 'Borrador'}
                                </span>
                              )}
                            </span>
                          </div>
                        </td>
                        <td data-label="Tipo de expediente" className="px-4 py-3 text-xs font-medium text-slate-700 dark:text-foreground">
                          {template.type}
                        </td>
                        <td data-label="Descripción" className="px-4 py-3 text-xs leading-5 text-slate-600 dark:text-muted-foreground">
                          {template.description}
                        </td>
                        <td data-label="Requisitos" className="px-4 py-3 text-xs tabular-nums text-slate-700 dark:text-foreground">
                          {template.requirementCount} {template.requirementCount === 1 ? 'requisito' : 'requisitos'}
                        </td>
                        <td data-label="Completados" className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => openCases(template.id, 'sealed')}
                            className="inline-flex items-center gap-2 text-xs font-500 text-slate-700 hover:text-primary dark:text-foreground"
                            aria-label={`Ver ${template.completed} expedientes completados de ${template.name}`}
                          >
                            <CheckCircle2 size={14} className="text-slate-400" />
                            <span className="tabular-nums">{template.completed}</span>
                            <span className="text-slate-400">
                              {template.completed === 1 ? 'completado' : 'completados'}
                            </span>
                          </button>
                        </td>
                        <td data-label="Última actividad" className="px-4 py-3 text-xs text-slate-600 dark:text-muted-foreground">
                          {template.lastActivity
                            ? formatDate(template.lastActivity)
                            : 'Sin actividad'}
                        </td>
                        <td data-label="Acciones" className="px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setPreviewTypeId(template.id)}
                              aria-label={`Vista previa de ${template.name}`}
                              title="Vista previa"
                              className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-blue-50 hover:text-primary"
                            >
                              <Eye size={15} />
                            </button>
                            <button
                              type="button"
                              disabled={template.status !== 'active'}
                              onClick={() =>
                                router.push(
                                  `/expedientes/lanzar?tipo=${encodeURIComponent(template.id)}`
                                )
                              }
                              aria-label={`Iniciar expediente de ${template.name}`}
                              title={template.status === 'active' ? 'Iniciar expediente' : 'Activa este tipo para iniciar un expediente'}
                              className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-blue-50 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <Send size={15} />
                            </button>
                            <button
                              type="button"
                              onClick={() => void toggleFavorite(template.id)}
                              disabled={!favoritesReady || Boolean(favoritePendingId)}
                              aria-label={`${favoriteIds.has(template.id) ? 'Quitar de favoritos' : 'Agregar a favoritos'}: ${template.name}`}
                              aria-pressed={favoriteIds.has(template.id)}
                              title={favoriteIds.has(template.id) ? 'Quitar de favoritos' : 'Agregar a favoritos'}
                              className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-amber-50 hover:text-amber-500 disabled:cursor-not-allowed disabled:opacity-50 ${favoriteIds.has(template.id) ? 'text-amber-500' : 'text-slate-400'}`}
                            >
                              <Star size={15} fill={favoriteIds.has(template.id) ? 'currentColor' : 'none'} />
                            </button>
                            <button
                              type="button"
                              onClick={() => openCases(template.id, 'all', 'edit')}
                              disabled={template.editable === 0}
                              aria-label={`Elegir expediente de ${template.name} para editar`}
                              title={template.editable === 0 ? 'No hay expedientes editables de este tipo' : 'Editar expediente'}
                              className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-blue-50 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <Edit3 size={15} />
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                if (actionMenu?.templateId === template.id) {
                                  setActionMenu(null);
                                  return;
                                }
                                menuTriggerRef.current = event.currentTarget;
                                const rect = event.currentTarget.getBoundingClientRect();
                                const menuWidth = 224;
                                const menuHeight = savedTemplateById.has(template.id) ? 280 : 160;
                                setActionMenu({
                                  templateId: template.id,
                                  top:
                                    rect.bottom + menuHeight + 8 <= window.innerHeight - 12
                                      ? rect.bottom + 8
                                      : Math.max(12, rect.top - menuHeight - 8),
                                  left: Math.max(
                                    12,
                                    Math.min(
                                      rect.right - menuWidth,
                                      window.innerWidth - menuWidth - 12
                                    )
                                  ),
                                });
                              }}
                              disabled={typeStatusBusyId === template.id}
                              aria-expanded={actionMenu?.templateId === template.id}
                              aria-haspopup="menu"
                              aria-controls={
                                actionMenu?.templateId === template.id
                                  ? 'case-type-actions-menu'
                                  : undefined
                              }
                              aria-label={`Más acciones para ${template.name}`}
                              title="Más acciones"
                              className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-slate-100 hover:text-slate-700 ${actionMenu?.templateId === template.id ? 'bg-slate-100 text-slate-700' : 'text-slate-400'}`}
                            >
                              <MoreHorizontal size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
        {actionMenu && menuTemplate && (
          <div
            id="case-type-actions-menu"
            ref={menuRef}
            role="menu"
            aria-label={`Acciones de ${menuTemplate.name}`}
            style={{ top: actionMenu.top, left: actionMenu.left }}
            className="fixed z-[90] max-h-[calc(100dvh-24px)] w-56 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1.5 text-left shadow-[0_18px_45px_-16px_rgba(15,23,42,0.3)] dark:border-border dark:bg-card"
          >
            <CaseMenuAction
              icon={Eye}
              label="Vista previa"
              onClick={() => {
                setActionMenu(null);
                setPreviewTypeId(menuTemplate.id);
              }}
            />
            {menuSavedTemplate && menuSavedTemplate.status !== 'archived' && (
              <CaseMenuAction
                icon={Edit3}
                label="Editar tipo de expediente"
                onClick={() => {
                  setActionMenu(null);
                  router.push(`/expedientes/nuevo?id=${encodeURIComponent(menuTemplate.id)}`);
                }}
              />
            )}
            <CaseMenuAction
              icon={FolderKanban}
              label="Ver expedientes"
              onClick={() => {
                setActionMenu(null);
                openCases(menuTemplate.id);
              }}
            />
            {(menuTypeRow?.completed ?? 0) > 0 && (
              <CaseMenuAction
                icon={CheckCircle2}
                label="Ver completados"
                onClick={() => {
                  setActionMenu(null);
                  openCases(menuTemplate.id, 'sealed');
                }}
              />
            )}
            {menuSavedTemplate?.status === 'active' && (
              <CaseMenuAction
                icon={CirclePause}
                label="Pausar tipo de expediente"
                onClick={() => void changeTypeStatus(menuSavedTemplate, 'paused')}
              />
            )}
            {menuSavedTemplate?.status === 'paused' && (
              <CaseMenuAction
                icon={Play}
                label="Reanudar tipo de expediente"
                onClick={() => void changeTypeStatus(menuSavedTemplate, 'active')}
              />
            )}
            {menuSavedTemplate?.status === 'archived' ? (
              <CaseMenuAction
                icon={RotateCcw}
                label="Restaurar tipo de expediente"
                onClick={() => void changeTypeStatus(menuSavedTemplate, menuSavedTemplate.archived_from_status ?? 'active')}
              />
            ) : menuSavedTemplate && (
              <CaseMenuAction
                icon={Archive}
                label="Archivar tipo de expediente"
                onClick={() => {
                  setArchiveTarget(menuSavedTemplate);
                  setArchiveError('');
                  setActionMenu(null);
                }}
              />
            )}
          </div>
        )}
        {archiveTarget && (
          <div
            className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/45 p-4"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !typeStatusBusyId) setArchiveTarget(null);
            }}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="archive-case-type-title"
              className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-border dark:bg-card"
            >
              <h2 id="archive-case-type-title" className="text-base font-semibold">Archivar tipo de expediente</h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-muted-foreground">
                ¿Archivar «{archiveTarget.name}»? Dejará de estar disponible para iniciar nuevos
                expedientes. Los expedientes existentes conservarán su estado y podrán consultarse.
              </p>
              {archiveError && <p role="alert" className="mt-3 text-sm text-red-600">{archiveError}</p>}
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" disabled={Boolean(typeStatusBusyId)} onClick={() => setArchiveTarget(null)} className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium disabled:opacity-50 dark:border-border">Cancelar</button>
                <button type="button" disabled={Boolean(typeStatusBusyId)} onClick={() => void changeTypeStatus(archiveTarget, 'archived')} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white disabled:opacity-50">
                  {typeStatusBusyId ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />}
                  Archivar
                </button>
              </div>
            </section>
          </div>
        )}
        {previewTemplate && (
          <CaseTemplatePreview
            template={previewTemplate}
            draft={previewDraft}
            savedStatus={previewSavedTemplate?.status}
            onClose={() => setPreviewTypeId(null)}
            onAction={() => {
              if (previewSavedTemplate?.status === 'archived') {
                void changeTypeStatus(previewSavedTemplate, previewSavedTemplate.archived_from_status ?? 'active');
                return;
              }
              const path = previewSavedTemplate
                ? `/expedientes/nuevo?id=${encodeURIComponent(previewTemplate.id)}`
                : `/expedientes/nuevo?tipo=${encodeURIComponent(previewTemplate.id)}`;
              setPreviewTypeId(null);
              router.push(path);
            }}
          />
        )}
        {openedType && (
          <div
            className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/45 p-4"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setOpenedType(null);
            }}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="case-list-title"
              className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-border dark:bg-card"
            >
              <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-border">
                <div>
                  <h2
                    id="case-list-title"
                    className="text-base font-semibold text-slate-950 dark:text-foreground"
                  >
                    {caseListMode === 'edit' ? 'Elegir expediente para editar' : dialogStatus === 'sealed' ? 'Expedientes completados' : 'Expedientes'} ·{' '}
                {allTemplates.find(t=>t.id===openedType)?.name||'Expedientes'}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {dialogCases.length} {dialogCases.length === 1 ? 'expediente' : 'expedientes'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpenedType(null)}
                  aria-label="Cerrar listado de expedientes"
                  className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
                >
                  <X size={18} />
                </button>
              </header>
              {caseListMode === 'view' && <div className="flex gap-2 border-b border-slate-200 px-5 py-3 dark:border-border">
                <button
                  type="button"
                  onClick={() => setDialogStatus('all')}
                  aria-pressed={dialogStatus === 'all'}
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium ${dialogStatus === 'all' ? 'border-primary bg-blue-50 text-primary' : 'border-slate-200 text-slate-600'}`}
                >
                  Todos
                </button>
                <button
                  type="button"
                  onClick={() => setDialogStatus('sealed')}
                  aria-pressed={dialogStatus === 'sealed'}
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium ${dialogStatus === 'sealed' ? 'border-primary bg-blue-50 text-primary' : 'border-slate-200 text-slate-600'}`}
                >
                  Completados
                </button>
              </div>}
              <div className="min-h-0 overflow-y-auto p-4">
                {dialogCases.length === 0 ? (
                  <div className="py-12 text-center text-sm text-slate-500">
                    No hay expedientes {caseListMode === 'edit' ? 'editables' : dialogStatus === 'sealed' ? 'completados' : 'registrados'}{' '}
                    de este tipo.
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {dialogCases.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => caseListMode === 'edit' ? void beginEditCase(item.id) : router.push(`/expedientes/${item.id}`)}
                          disabled={editLoading}
                          className="flex w-full items-start justify-between gap-3 rounded-lg border border-slate-200 p-3 text-left transition hover:border-primary/40 hover:bg-blue-50/40 dark:border-border"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-slate-950 dark:text-foreground">
                              {item.title}
                            </span>
                            <span className="mt-1 block text-xs text-slate-500">
                              {item.folio} · {item.participant}
                            </span>
                          </span>
                          <span className="flex items-center gap-2">{caseListMode === 'edit' && <Edit3 size={15} className="text-primary" />}<CaseStatusBadge status={item.status} /></span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </div>
        )}
        {editingCase && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/45 p-4">
            <section role="dialog" aria-modal="true" aria-labelledby="edit-case-title" className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-border dark:bg-card">
              <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-border">
                <h2 id="edit-case-title" className="text-base font-semibold">Editar expediente</h2>
                <button type="button" onClick={() => setEditingCase(null)} aria-label="Cerrar edición" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"><X size={18} /></button>
              </header>
              <div className="space-y-4 p-5">
                <label className="block text-sm font-medium">Nombre del expediente
                  <input value={editingCase.title} onChange={(event) => setEditingCase({ ...editingCase, title: event.target.value })} className="mt-1.5 h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-primary dark:border-border dark:bg-background" />
                </label>
                <label className="block text-sm font-medium">Descripción
                  <textarea value={editingCase.description} onChange={(event) => setEditingCase({ ...editingCase, description: event.target.value })} rows={3} className="mt-1.5 w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-primary dark:border-border dark:bg-background" />
                </label>
                <label className="block text-sm font-medium">Fecha objetivo de cierre
                  <input type="date" value={editingCase.targetCloseAt} onChange={(event) => setEditingCase({ ...editingCase, targetCloseAt: event.target.value })} className="mt-1.5 h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-primary dark:border-border dark:bg-background" />
                </label>
                {editError && <p role="alert" className="text-sm text-red-600">{editError}</p>}
              </div>
              <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4 dark:border-border">
                <button type="button" onClick={() => setEditingCase(null)} className="h-9 rounded-md border border-slate-200 px-4 text-sm font-medium dark:border-border">Cancelar</button>
                <button type="button" onClick={() => void saveEditCase()} disabled={editSaving} className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-white disabled:opacity-60">{editSaving ? 'Guardando…' : 'Guardar cambios'}</button>
              </footer>
            </section>
          </div>
        )}
      </CaseWorkspace>
    </AppLayout>
  );
}

function mapCaseRow(row: any): CaseFileSummary {
  return {
    id: row.id,
    templateId: row.template_id,
    folio: row.folio,
    title: row.title,
    caseType: row.case_type,
    caseSubtype: row.case_subtype,
    participant: row.subject_name || 'Sin participante',
    responsible: row.responsible_area || 'Sin asignar',
    status: row.status,
    progress: row.progress || 0,
    priority: row.priority,
    sensitivity: row.sensitivity_level,
    pendingItems: row.pending_items || 0,
    openObservations: row.open_observations || 0,
    targetCloseAt: row.target_close_at,
    lastActivityAt: row.updated_at,
  };
}

function Heading({
  children,
  align = 'left',
  className = '',
}: {
  children: ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <th
      className={`px-4 py-3 text-xs font-semibold text-slate-500 ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}
    >
      {children}
    </th>
  );
}

function ResponseMetric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
  tone: 'blue' | 'green' | 'indigo';
}) {
  const iconTone = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-emerald-50 text-emerald-600',
    indigo: 'bg-indigo-50 text-indigo-600',
  }[tone];
  return (
    <div className="flex min-h-24 items-center gap-3 px-5 py-4">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${iconTone}`}>
        <Icon size={17} aria-hidden="true" />
      </span>
      <span>
        <span className="block text-xl font-semibold tabular-nums text-slate-950 dark:text-foreground">
          {value}
        </span>
        <span className="block text-xs text-slate-500 dark:text-muted-foreground">{label}</span>
      </span>
    </div>
  );
}

function CaseMenuAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50 hover:text-primary focus-visible:bg-slate-50 focus-visible:outline-none dark:text-foreground dark:hover:bg-muted/40"
    >
      <Icon size={15} aria-hidden="true" />
      {label}
    </button>
  );
}

function formatDate(value?: string) {
  if (!value) return 'Sin fecha';
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value;
  return new Date(normalized).toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
