'use client';

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  Archive, ArrowUpDown, BarChart3, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CirclePause, ClipboardCheck, ClipboardClock, ClipboardList, ClipboardMinus, ClipboardPenLine, Copy, Edit3, Eye,
  FilePlus2, FileText, Link2, Loader2, MoreHorizontal, Play, Plus,
  ListFilter, RotateCcw, Search, Send, Star, Trash2, Users, X,
} from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { BottomNotice } from '@/components/ui/BottomNotice';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import { formSaveError } from '@/lib/forms/lifecycle';
import { normalizeFormTemplate } from '@/lib/forms/schema';

interface FormRow {
  id: string;
  name: string;
  description?: string;
  status: 'draft' | 'in_review' | 'published' | 'paused' | 'archived';
  schema: unknown[];
  settings: Record<string, any>;
  updated_at: string;
  created_by: string;
  responseCount: number;
  typeName?: string;
  version_number?: number;
  revision_number?: number;
  published_at?: string;
  archived_from_status?: 'draft' | 'published' | 'paused' | null;
}

interface FormLaunch {
  id: string;
  template_id: string;
  recipient_name: string | null;
  recipient_email: string;
  created_at: string;
  expires_at: string | null;
  used_at: string | null;
}

interface ScheduledFormLaunch {
  id: string;
  template_id: string;
  recipient_name: string;
  recipient_email: string;
  scheduled_at: string;
  timezone: string;
  status: 'scheduled' | 'retrying' | 'processing' | 'failed';
  token_id: string | null;
  last_error: string | null;
}

type FormSort = '' | 'updated_desc' | 'updated_asc' | 'name_asc' | 'name_desc';
type FormFilter = 'auto' | 'all' | 'published' | 'draft' | 'archived' | 'favorites' | 'in_review' | 'paused';
type RemovalMode = 'checking' | 'delete' | 'archive';
const TABLE_PAGE_SIZE = 10;
const FORM_FAVORITES_KEY = 'formularios';

const canViewFormResponses = (status: FormRow['status']) => status === 'published' || status === 'paused';

const statusStyles: Record<FormRow['status'], { label: string; className: string; dot: string; icon: React.ElementType; iconClass: string }> = {
  draft: { label: 'Borrador', className: 'border-slate-200 bg-slate-50 text-slate-600', dot: 'bg-slate-400', icon: ClipboardPenLine, iconClass: 'border-slate-200 bg-slate-50 text-slate-600' },
  in_review: { label: 'En revisión', className: 'border-blue-200 bg-blue-50 text-blue-700', dot: 'bg-blue-500', icon: ClipboardClock, iconClass: 'border-blue-200 bg-blue-50 text-blue-700' },
  published: { label: 'Publicado', className: 'border-emerald-200 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500', icon: ClipboardCheck, iconClass: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  paused: { label: 'Pausado', className: 'border-amber-200 bg-amber-50 text-amber-700', dot: 'bg-amber-500', icon: ClipboardMinus, iconClass: 'border-amber-200 bg-amber-50 text-amber-700' },
  archived: { label: 'Archivado', className: 'border-slate-200 bg-slate-100 text-slate-500', dot: 'bg-slate-400', icon: ClipboardList, iconClass: 'border-slate-200 bg-slate-100 text-slate-500' },
};

export default function FormulariosPage() {
  const router = useRouter();
  const { activeWorkspace } = useWorkspace();
  const { user } = useAuth();
  const supabase = createClient();
  const [forms, setForms] = useState<FormRow[]>([]);
  const [launches, setLaunches] = useState<FormLaunch[]>([]);
  const [scheduledLaunches, setScheduledLaunches] = useState<ScheduledFormLaunch[]>([]);
  const [launchesError, setLaunchesError] = useState(false);
  const [clockTime, setClockTime] = useState(() => Date.now());
  const [formsSummaryOpen, setFormsSummaryOpen] = useState(false);
  const [responsesSummaryOpen, setResponsesSummaryOpen] = useState(true);
  const [pendingDialogOpen, setPendingDialogOpen] = useState(false);
  const [scheduledDialogOpen, setScheduledDialogOpen] = useState(false);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [pendingDialogError, setPendingDialogError] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<FormFilter>('auto');
  const [sortMode, setSortMode] = useState<FormSort>('');
  const [currentPage, setCurrentPage] = useState(1);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [favorites, setFavorites] = useState<string[]>([]);
  const [favoritesReady, setFavoritesReady] = useState(false);
  const [favoritePendingId, setFavoritePendingId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<FormRow | null>(null);
  const [removeMode, setRemoveMode] = useState<RemovalMode>('checking');
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const [notice, setNotice] = useState('');
  const [publicAccessInfo, setPublicAccessInfo] = useState<{ name: string; url: string; code: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const favoriteRequestPending = useRef(false);
  const removeRequestId = useRef(0);
  const loadRequestId = useRef(0);

  const loadForms = async () => {
    if (!activeWorkspace) return;
    const requestId = ++loadRequestId.current;
    const workspaceId = activeWorkspace.id;
    setLoading(true);
    setLaunches([]);
    setScheduledLaunches([]);
    setLaunchesError(false);
    const [{ data: templateData, error }, { data: responseData }, { data: typeData, error: typeError }] = await Promise.all([
      supabase.from('form_templates').select('*').eq('workspace_id', workspaceId).order('updated_at', { ascending: false }),
      supabase.from('form_responses').select('template_id').eq('workspace_id', workspaceId),
      supabase.from('tipo_documento').select('id, nombre'),
    ]);
    if (requestId !== loadRequestId.current) return;
    if (!error) {
      const templateIds = (templateData || []).map((item: { id: string }) => item.id);
      if (templateIds.length) {
        let launchResult;
        for (let attempt = 0; attempt < 3; attempt++) {
          launchResult = await supabase.from('form_tokens')
            .select('id,template_id,recipient_name,recipient_email,created_at,expires_at,used_at')
            .in('template_id', templateIds)
            .order('created_at', { ascending: false });
          if (requestId !== loadRequestId.current) return;
          if (!launchResult.error || (launchResult.status > 0 && launchResult.status < 500) || attempt === 2) break;
          await new Promise((resolve) => window.setTimeout(resolve, 300 * (attempt + 1)));
          if (requestId !== loadRequestId.current) return;
        }
        setLaunches(launchResult?.error ? [] : (launchResult?.data || []) as FormLaunch[]);
        setLaunchesError(Boolean(launchResult?.error));
        try {
          const { data: sessionData } = await supabase.auth.getSession();
          if (requestId !== loadRequestId.current) return;
          if (sessionData.session?.access_token) {
            const scheduledResponse = await fetch(`/api/formularios/lanzamientos/programar?workspace_id=${encodeURIComponent(workspaceId)}`, {
              headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
            });
            if (requestId !== loadRequestId.current) return;
            if (!scheduledResponse.ok) throw new Error('No se pudieron consultar los envíos programados.');
            const scheduled = await scheduledResponse.json();
            if (requestId !== loadRequestId.current) return;
            setScheduledLaunches(scheduled.schedules || []);
          }
        } catch {
          if (requestId === loadRequestId.current) setNotice('No se pudieron cargar los envíos programados.');
        }
      }
      if (requestId !== loadRequestId.current) return;
      const counts = (responseData || []).reduce<Record<string, number>>((acc, row: any) => {
        acc[row.template_id] = (acc[row.template_id] || 0) + 1;
        return acc;
      }, {});
      const typeNames = new Map((typeData || []).map((type: { id: string; nombre: string }) => [type.id, type.nombre]));
      setForms((templateData || []).map((item: any) => ({
        ...item,
        responseCount: counts[item.id] || 0,
        typeName: typeNames.get(item.settings?.documentTypeId) || (item.settings?.documentTypeId ? 'Tipo no disponible' : 'Sin clasificar'),
      })));
      if (typeError) setNotice('No se pudieron cargar los tipos de formulario.');
    } else {
      setNotice('No se pudieron cargar los formularios.');
    }
    setLoading(false);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadForms(); }, 0);
    return () => {
      window.clearTimeout(timer);
      loadRequestId.current++;
    };
  }, [activeWorkspace?.id]);
  useEffect(() => {
    const timer = window.setInterval(() => setClockTime(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    let active = true;
    const loadFavorites = async () => {
      setFavoritesReady(false);
      setFavorites([]);
      if (!user?.id) return;
      const { data, error } = await supabase.from('user_favorites').select('item_id')
        .eq('user_id', user.id).eq('storage_key', FORM_FAVORITES_KEY);
      if (!active) return;
      if (error) {
        setNotice('No se pudieron cargar tus formularios favoritos.');
        return;
      }
      setFavorites((data || []).map((row: { item_id: string }) => row.item_id));
      setFavoritesReady(true);
    };
    void loadFavorites();
    return () => { active = false; };
  }, [user?.id]);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node) || menuTriggerRef.current?.contains(event.target as Node)) return;
      setActiveMenu(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  useLayoutEffect(() => {
    if (!activeMenu) return;
    const positionMenu = () => {
      const trigger = menuTriggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      const rect = trigger.getBoundingClientRect();
      const width = menu.offsetWidth;
      const height = menu.offsetHeight;
      const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12));
      const below = rect.bottom + 8;
      const top = below + height <= window.innerHeight - 12
        ? below
        : Math.max(12, rect.top - height - 8);
      setMenuPosition((current) => current.top === top && current.left === left ? current : { top, left });
    };
    positionMenu();
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    return () => {
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
    };
  }, [activeMenu]);
  useEffect(() => {
    if (!activeMenu) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setActiveMenu(null);
      menuTriggerRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [activeMenu]);

  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  const filterCounts = useMemo(() => ({
    published: forms.filter((form) => form.status === 'published').length,
    draft: forms.filter((form) => form.status === 'draft').length,
    archived: forms.filter((form) => form.status === 'archived').length,
    favorites: forms.filter((form) => favoriteSet.has(form.id)).length,
    in_review: forms.filter((form) => form.status === 'in_review').length,
    paused: forms.filter((form) => form.status === 'paused').length,
  }), [forms, favoriteSet]);
  const selectedFilter = status === 'auto' ? (filterCounts.published ? 'published' : 'all') : status;
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('es-MX');
    return forms.filter((form) => {
      const matchesQuery = `${form.name} ${form.description || ''} ${form.typeName || ''}`.toLocaleLowerCase('es-MX').includes(normalizedQuery);
      return matchesQuery && (selectedFilter === 'all' || (selectedFilter === 'favorites' ? favoriteSet.has(form.id) : form.status === selectedFilter));
    }).sort((left, right) => {
      if (sortMode === 'name_asc') return left.name.localeCompare(right.name, 'es-MX');
      if (sortMode === 'name_desc') return right.name.localeCompare(left.name, 'es-MX');
      if (sortMode === 'updated_asc' || sortMode === 'updated_desc') {
        const difference = new Date(left.updated_at).getTime() - new Date(right.updated_at).getTime();
        return sortMode === 'updated_asc' ? difference : -difference;
      }
      return 0;
    });
  }, [forms, query, selectedFilter, sortMode, favoriteSet]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / TABLE_PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedForms = filtered.slice((safeCurrentPage - 1) * TABLE_PAGE_SIZE, safeCurrentPage * TABLE_PAGE_SIZE);
  const menuForm = paginatedForms.find((form) => form.id === activeMenu);

  const toggleFavorite = async (form: FormRow) => {
    if (!user || !favoritesReady || favoriteRequestPending.current) return;
    const wasFavorite = favoriteSet.has(form.id);
    favoriteRequestPending.current = true;
    setFavoritePendingId(form.id);
    setFavorites((current) => wasFavorite ? current.filter((id) => id !== form.id) : [...current, form.id]);
    try {
      const operation = wasFavorite
        ? supabase.from('user_favorites').delete().eq('user_id', user.id)
            .eq('storage_key', FORM_FAVORITES_KEY).eq('item_id', form.id)
        : supabase.from('user_favorites').upsert({ user_id: user.id, storage_key: FORM_FAVORITES_KEY, item_id: form.id },
            { onConflict: 'user_id,storage_key,item_id' });
      const { error } = await operation;
      if (error) throw error;
    } catch {
      setFavorites((current) => wasFavorite
        ? current.includes(form.id) ? current : [...current, form.id]
        : current.filter((id) => id !== form.id));
      setNotice('No fue posible actualizar tus favoritos.');
    } finally {
      favoriteRequestPending.current = false;
      setFavoritePendingId(null);
    }
  };

  const metrics = useMemo(() => ({
    total: forms.length,
    published: filterCounts.published,
    draft: filterCounts.draft,
    archived: filterCounts.archived,
    responses: forms.reduce((sum, form) => sum + form.responseCount, 0),
    launched: launches.length,
  }), [forms, filterCounts, launches]);
  const pendingLaunches = useMemo(() => {
    const unsentTokenIds = new Set(scheduledLaunches.map((schedule) => schedule.token_id).filter(Boolean));
    return launches.filter((launch) =>
      !unsentTokenIds.has(launch.id) && !launch.used_at &&
      (!launch.expires_at || new Date(launch.expires_at).getTime() > clockTime)
    );
  }, [launches, scheduledLaunches, clockTime]);
  const formNames = useMemo(() => new Map(forms.map((form) => [form.id, form.name])), [forms]);

  const managePendingLaunch = async (launch: FormLaunch, action: 'resend' | 'cancel') => {
    if (pendingActionId) return;
    setPendingActionId(launch.id);
    setPendingDialogError('');
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (sessionError || !accessToken) throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.');
      const response = await fetch(`/api/formularios/lanzamientos/${encodeURIComponent(launch.id)}`, {
        method: action === 'resend' ? 'POST' : 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No fue posible gestionar este enlace.');
      if (action === 'cancel') {
        setLaunches((current) => current.map((item) =>
          item.id === launch.id ? { ...item, expires_at: new Date(0).toISOString() } : item
        ));
      }
      setNotice(action === 'resend' ? `Recordatorio enviado a ${launch.recipient_email}.` : 'Enlace cancelado.');
    } catch (cause) {
      setPendingDialogError(cause instanceof Error ? cause.message : 'No fue posible gestionar este enlace.');
    } finally {
      setPendingActionId(null);
    }
  };

  const cancelScheduledLaunch = async (launch: ScheduledFormLaunch) => {
    if (pendingActionId) return;
    setPendingActionId(launch.id);
    setPendingDialogError('');
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.');
      const response = await fetch(`/api/formularios/lanzamientos/programar/${encodeURIComponent(launch.id)}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudo cancelar el envío.');
      setScheduledLaunches((current) => current.filter((item) => item.id !== launch.id));
      if (launch.token_id) setLaunches((current) => current.map((item) =>
        item.id === launch.token_id ? { ...item, expires_at: new Date(0).toISOString() } : item
      ));
      setNotice('Envío programado cancelado.');
    } catch (cause) {
      setPendingDialogError(cause instanceof Error ? cause.message : 'No se pudo cancelar el envío.');
    } finally {
      setPendingActionId(null);
    }
  };

  const duplicateForm = async (form: FormRow) => {
    if (!activeWorkspace || !user) return;
    const normalized = normalizeFormTemplate({ schema: form.schema as any, sections: form.settings?.sections, settings: form.settings as any });
    const { error } = await supabase.from('form_templates').insert({
      workspace_id: activeWorkspace.id,
      created_by: user.id,
      name: `${form.name} (copia)`,
      description: form.description || '',
      status: 'draft',
      schema: normalized.schema,
      settings: { ...normalized.settings, sections: normalized.sections },
    });
    if (!error) { setNotice('Formulario duplicado como borrador v1.0.'); loadForms(); }
    else setNotice(formSaveError(error));
  };

  const changeStatus = async (form: FormRow, nextStatus: 'published' | 'paused') => {
    if (!activeWorkspace || !['published', 'paused'].includes(form.status)) return;
    const { error } = await supabase.from('form_templates').update({ status: nextStatus })
      .eq('id', form.id).eq('workspace_id', activeWorkspace.id).eq('status', form.status).select('id').single();
    setActiveMenu(null);
    if (error) setNotice(formSaveError(error));
    else { setNotice(nextStatus === 'paused' ? 'Formulario pausado.' : 'Formulario reanudado.'); void loadForms(); }
  };

  const restoreForm = async (form: FormRow) => {
    if (!activeWorkspace || form.status !== 'archived') return;
    setActiveMenu(null);
    const restoreStatus = form.archived_from_status || (form.published_at ? 'published' : 'draft');
    const { error } = await supabase.from('form_templates').update({ status: restoreStatus })
      .eq('id', form.id).eq('workspace_id', activeWorkspace.id).eq('status', 'archived').select('id').single();
    if (error) setNotice(formSaveError(error));
    else { setNotice('Formulario reactivado.'); void loadForms(); }
  };

  const closeRemove = () => {
    if (removeBusy) return;
    removeRequestId.current += 1;
    setRemoveTarget(null);
  };

  const requestRemove = async (form: FormRow) => {
    setActiveMenu(null);
    setRemoveError('');
    setRemoveTarget(form);
    const requestId = ++removeRequestId.current;
    if (form.status !== 'draft' || form.published_at) {
      setRemoveMode('archive');
      return;
    }
    setRemoveMode('checking');
    const [{ count: tokenCount, error: tokenError }, { count: responseCount, error: responseError }] = await Promise.all([
      supabase.from('form_tokens').select('id', { count: 'exact', head: true }).eq('template_id', form.id),
      supabase.from('form_responses').select('id', { count: 'exact', head: true }).eq('template_id', form.id),
    ]);
    if (requestId !== removeRequestId.current) return;
    if (tokenError || responseError) {
      setRemoveMode('archive');
      setRemoveError('No se pudieron comprobar los datos vinculados. Para conservarlos, solo puedes archivar este borrador.');
      return;
    }
    setRemoveMode(tokenCount || responseCount ? 'archive' : 'delete');
  };

  const removeForm = async () => {
    if (!activeWorkspace || !removeTarget || removeBusy || removeMode === 'checking') return;
    const form = removeTarget;
    const removeDraft = removeMode === 'delete';
    setRemoveBusy(true);
    setRemoveError('');
    try {
      const query = removeDraft ? supabase.from('form_templates').delete() : supabase.from('form_templates').update({ status: 'archived' });
      const { error } = await query.eq('id', form.id).eq('workspace_id', activeWorkspace.id).eq('status', form.status).select('id').single();
      if (error) throw error;
      setNotice(removeDraft ? 'Borrador eliminado.' : 'Formulario archivado.');
      removeRequestId.current += 1;
      setRemoveTarget(null);
      void loadForms();
    } catch (cause) {
      const code = (cause as { code?: string })?.code;
      if (removeDraft && (code === '23503' || code === '23514')) {
        setRemoveMode('archive');
        setRemoveError('El borrador tiene datos vinculados y ya no puede eliminarse. Puedes archivarlo.');
      } else setRemoveError(formSaveError(cause));
    }
    finally { setRemoveBusy(false); }
  };

  const copyPublicLink = async (form: FormRow) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Inicia sesión para consultar el código.');
      const response = await fetch(`/api/formularios/publico/${encodeURIComponent(form.id)}/codigo`, {
        headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store',
      });
      const result = await response.json();
      if (!response.ok || !result.code) throw new Error(result.error || 'No se pudo consultar el código.');
      setPublicAccessInfo({ name: form.name, url: `${window.location.origin}/formulario-publico/${form.id}`, code: result.code });
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'No se pudo consultar el código de acceso.');
    }
  };

  return (
    <AppLayout noPadding>
      <div className="-mx-4 -my-4 min-h-[calc(100vh-4rem)] bg-[#f6f8fb] px-4 py-4 dark:bg-background sm:px-5 md:-my-6 md:py-5 lg:px-6">
        <div className="mx-auto w-full max-w-[1560px]">
          <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 dark:border-border sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-2xl font-600 text-slate-950 dark:text-foreground">Formularios</h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-muted-foreground">
                Crea, publica y administra formularios que generan documentos listos para firma.
              </p>
            </div>
            <div className="flex flex-wrap gap-2"><button type="button" onClick={() => router.push('/formularios/lanzar')} disabled={!forms.some((form) => form.status === 'published')} className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-primary bg-white px-4 text-sm font-600 text-primary transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"><Send size={16} /> Lanzar formulario</button><button
              type="button"
              onClick={() => router.push('/formularios/nuevo')}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-600 text-white shadow-sm transition-colors hover:bg-primary/90"
            >
              <Plus size={16} />
              Nuevo formulario
            </button></div>
          </header>

          <section className="mt-5 overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-border dark:bg-card">
            <button type="button" aria-expanded={formsSummaryOpen} aria-controls="form-summary-metrics" onClick={() => setFormsSummaryOpen((open) => !open)} className={`flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-slate-50 dark:hover:bg-muted/40 ${formsSummaryOpen ? 'border-b border-slate-200 dark:border-border' : ''}`}>
              <div>
                <h2 className="text-sm font-600 text-slate-950 dark:text-foreground">Resumen de formularios</h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-muted-foreground">Actividad del espacio de trabajo actual.</p>
              </div>
              <span className="flex shrink-0 items-center gap-3"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-600 text-slate-600 dark:bg-muted dark:text-muted-foreground">{metrics.total} {metrics.total === 1 ? 'formulario' : 'formularios'}</span><ChevronDown size={18} className={`text-slate-500 transition-transform ${formsSummaryOpen ? 'rotate-180' : ''}`} /></span>
            </button>
            {formsSummaryOpen && <div id="form-summary-metrics" className="grid grid-cols-2 divide-x divide-y divide-slate-200 dark:divide-border lg:grid-cols-4 lg:divide-y-0">
              <MetricCard icon={FileText} label="Total" value={metrics.total} />
              <MetricCard icon={CheckCircle2} label="Publicados" value={metrics.published} tone="emerald" />
              <MetricCard icon={ClipboardPenLine} label="Borrador" value={metrics.draft} tone="blue" />
              <MetricCard icon={Archive} label="Archivados" value={metrics.archived} tone="indigo" />
            </div>}
          </section>

          <section className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-border dark:bg-card">
            <button type="button" aria-expanded={responsesSummaryOpen} aria-controls="response-summary-metrics" onClick={() => setResponsesSummaryOpen((open) => !open)} className={`flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-slate-50 dark:hover:bg-muted/40 ${responsesSummaryOpen ? 'border-b border-slate-200 dark:border-border' : ''}`}>
              <div><h2 className="text-sm font-600 text-slate-950 dark:text-foreground">Resumen de respuestas</h2><p className="mt-0.5 text-xs text-slate-500 dark:text-muted-foreground">Lanzamientos y respuestas del espacio de trabajo actual.</p></div>
              <ChevronDown size={18} className={`shrink-0 text-slate-500 transition-transform ${responsesSummaryOpen ? 'rotate-180' : ''}`} />
            </button>
            {responsesSummaryOpen && <div id="response-summary-metrics" className="grid grid-cols-1 divide-y divide-slate-200 dark:divide-border sm:grid-cols-2 sm:divide-x lg:grid-cols-4 lg:divide-y-0">
              <MetricCard icon={Send} label="Total formularios lanzados" value={metrics.launched} tone="blue" />
              <MetricCard icon={BarChart3} label="Respuestas" value={metrics.responses} tone="emerald" />
              <button type="button" onClick={() => { setPendingDialogError(''); setScheduledDialogOpen(true); }} disabled={scheduledLaunches.length === 0} className="metric-action-card group flex min-h-24 items-center gap-3 px-5 py-4 text-left enabled:hover:bg-blue-50/50" aria-label={scheduledLaunches.length ? `Consultar ${scheduledLaunches.length} envíos programados` : 'Sin envíos programados'}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600"><ClipboardClock size={17} /></span>
                <span><span className="metric-action-value block text-xl font-600 tabular-nums text-slate-950 dark:text-foreground">{scheduledLaunches.length}</span><span className="metric-action-label flex items-center gap-1 text-xs text-slate-500 dark:text-muted-foreground">Envíos programados {scheduledLaunches.length > 0 && <ChevronRight size={11} className="text-primary" />}</span></span>
              </button>
              <button
                type="button"
                onClick={() => { setPendingDialogError(''); setPendingDialogOpen(true); }}
                disabled={pendingLaunches.length === 0}
                className="metric-action-card group flex min-h-24 items-center gap-3 px-5 py-4 text-left transition-colors enabled:hover:bg-blue-50/50 enabled:focus-visible:outline-none enabled:focus-visible:ring-2 enabled:focus-visible:ring-inset enabled:focus-visible:ring-primary/40 enabled:dark:hover:bg-muted/40"
                aria-label={pendingLaunches.length > 0 ? `Ver ${pendingLaunches.length} ${pendingLaunches.length === 1 ? 'respuesta pendiente' : 'respuestas pendientes'}` : 'Sin respuestas pendientes'}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-indigo-50 text-indigo-600">
                  <ClipboardClock size={17} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="metric-action-value block text-xl font-600 tabular-nums text-slate-950 dark:text-foreground">{pendingLaunches.length}</span>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="metric-action-label text-xs text-slate-500 dark:text-muted-foreground">Respuestas pendientes</span>
                    {pendingLaunches.length > 0 && <span className="metric-action-link inline-flex items-center gap-0.5 text-xs font-medium text-primary group-hover:underline">Ver <ChevronRight size={12} aria-hidden="true" /></span>}
                  </span>
                </span>
              </button>
            </div>}
            {responsesSummaryOpen && launchesError && <BottomNotice message="No se pudieron cargar los lanzamientos. Actualiza la página para ver las cifras correctas." tone="critical" />}
          </section>

          <div className="mb-3 mt-5 flex items-center gap-2">
            <h2 className="text-sm font-600 text-slate-950 dark:text-foreground">Mis formularios</h2>
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-600 text-primary dark:bg-primary/10">{filtered.length}</span>
          </div>
          <section className="mb-3 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-border dark:bg-card">
            <div className="flex flex-wrap items-center gap-2 p-3">
              <div className="relative min-w-[160px] flex-1">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => { setQuery(event.target.value); setCurrentPage(1); }}
                  placeholder="Buscar formularios..."
                  aria-label="Buscar formularios"
                  className="h-9 w-full rounded-md border border-slate-200 bg-slate-50/70 pl-9 pr-3 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/15 dark:border-border dark:bg-background dark:text-foreground"
                />
              </div>
              <div className="relative w-full sm:w-56">
                <ListFilter size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <select
                  value={selectedFilter}
                  onChange={(event) => { setStatus(event.target.value as FormFilter); setCurrentPage(1); }}
                  aria-label="Filtrar formularios por estado"
                  className="h-10 w-full appearance-none rounded-md border border-slate-200 bg-white pl-9 pr-9 text-sm text-slate-700 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15 dark:border-border dark:bg-background dark:text-foreground"
                >
                  {(filterCounts.published === 0 || selectedFilter === 'all') && <option value="all">Todos ({forms.length})</option>}
                  <option value="published">Publicadas ({filterCounts.published})</option>
                  <option value="draft">Borradores ({filterCounts.draft})</option>
                  <option value="archived">Archivadas ({filterCounts.archived})</option>
                  <option value="favorites">Favoritas ({filterCounts.favorites})</option>
                  {filterCounts.in_review > 0 && <option value="in_review">En revisión ({filterCounts.in_review})</option>}
                  {filterCounts.paused > 0 && <option value="paused">Pausadas ({filterCounts.paused})</option>}
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
              <div className="relative min-w-[150px]">
                <ArrowUpDown size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <select
                  value={sortMode}
                  onChange={(event) => { setSortMode(event.target.value as FormSort); setCurrentPage(1); }}
                  aria-label="Ordenar formularios"
                  className="h-9 w-full appearance-none rounded-md border border-slate-200 bg-white pl-9 pr-8 text-sm text-slate-700 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15 dark:border-border dark:bg-background dark:text-foreground"
                >
                  <option value="" disabled>Ordenar</option>
                  <option value="updated_desc">Más recientes</option>
                  <option value="updated_asc">Más antiguas</option>
                  <option value="name_asc">Nombre A-Z</option>
                  <option value="name_desc">Nombre Z-A</option>
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
            </div>
          </section>

          <section className="overflow-visible rounded-lg border border-slate-200 bg-white shadow-sm dark:border-border dark:bg-card">
          {loading ? (
            <div className="flex min-h-[320px] items-center justify-center"><Loader2 size={24} className="animate-spin text-primary" /></div>
          ) : filtered.length === 0 ? (
            <EmptyState onCreate={() => router.push('/formularios/nuevo')} filtered={Boolean(query || forms.length)} />
          ) : (
            <div className="overflow-x-auto rounded-lg">
              <table className="w-full min-w-[980px] table-fixed text-sm">
                <thead><tr className="border-b border-slate-200 bg-slate-50/80 text-left dark:border-border dark:bg-muted/40">
                  <TableHeading className="w-[36%]">Formulario</TableHeading>
                  <TableHeading className="w-[18%]">Tipo de formulario</TableHeading>
                  <TableHeading className="w-28">Estado</TableHeading>
                  <TableHeading className="w-36">Respuestas</TableHeading>
                  <TableHeading className="w-36">Última modificación</TableHeading>
                  <TableHeading className="w-52" align="right">Acciones</TableHeading>
                </tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-border">
                  {paginatedForms.map((form) => {
                    const formStyle = statusStyles[form.status] || statusStyles.draft;
                    const FormIcon = formStyle.icon;
                    const isFavorite = favoriteSet.has(form.id);
                    return (
                      <tr key={form.id} className="transition-colors hover:bg-slate-50/70 dark:hover:bg-muted/30">
                        <td className="px-3 py-3"><button type="button" onClick={() => router.push(`/formularios/nuevo?id=${form.id}`)} className="group flex w-full min-w-0 items-center gap-3 text-left"><span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border ${formStyle.iconClass}`}><FormIcon size={17} /></span><span className="min-w-0"><span className="block truncate text-sm font-500 text-slate-950 group-hover:text-primary dark:text-foreground">{form.name} <span className="text-xs font-normal text-slate-400">v{form.version_number || 1}.0{(form.revision_number || 1) > 1 ? ` · rev. ${form.revision_number}` : ''}</span></span>{form.description?.trim() && <span className="mt-0.5 block truncate !text-xs !font-normal text-slate-500 dark:text-muted-foreground">{form.description}</span>}</span></button></td>
                        <td className="px-3 py-3"><span className="block truncate text-xs text-slate-600 dark:text-muted-foreground" title={form.typeName}>{form.typeName}</span></td>
                        <td className="px-3 py-3"><StatusBadge status={form.status} /></td>
                        <td className="px-3 py-3">{canViewFormResponses(form.status) ? <button type="button" onClick={() => router.push(`/formularios/respuestas?id=${form.id}`)} className="inline-flex items-center gap-2 text-xs font-500 text-slate-700 hover:text-primary dark:text-foreground"><Users size={14} className="text-slate-400" /><span className="tabular-nums">{form.responseCount}</span><span className="text-slate-400">{form.responseCount === 1 ? 'respuesta' : 'respuestas'}</span></button> : <span className="text-xs text-slate-400" aria-label="Respuestas no disponibles">—</span>}</td>
                        <td className="whitespace-nowrap px-3 py-3"><span className="block text-xs font-500 text-slate-700 dark:text-foreground">{new Date(form.updated_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}</span><span className="mt-0.5 block text-[11px] text-slate-400">{new Date(form.updated_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</span></td>
                        <td className="relative px-3 py-3 text-right">
                          <div className="inline-flex items-center gap-1">
                            <button type="button" onClick={() => router.push(`/formularios/preview?id=${form.id}`)} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-blue-50 hover:text-primary" title="Vista previa" aria-label={`Vista previa de ${form.name}`}><Eye size={13} /></button>
                            {form.status === 'published' && <button type="button" onClick={() => { router.push(`/formularios/lanzar?id=${encodeURIComponent(form.id)}`); setActiveMenu(null); }} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-blue-50 hover:text-primary" title="Lanzar formulario" aria-label={`Lanzar formulario ${form.name}`}><Send size={13} /></button>}
                            <button
                              type="button"
                              onClick={() => void toggleFavorite(form)}
                              disabled={!favoritesReady || favoritePendingId !== null}
                              aria-pressed={isFavorite}
                              aria-label={isFavorite ? `Quitar ${form.name} de favoritos` : `Marcar ${form.name} como favorito`}
                              title={isFavorite ? 'Quitar de favoritos' : 'Marcar como favorito'}
                              className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors disabled:cursor-wait disabled:opacity-60 ${isFavorite ? 'bg-amber-50 text-amber-500 dark:bg-amber-500/10' : 'text-slate-400 hover:bg-amber-50 hover:text-amber-500 dark:hover:bg-amber-500/10'}`}
                            >
                              <Star size={13} fill={isFavorite ? 'currentColor' : 'none'} />
                            </button>
                            <button type="button" onClick={() => router.push(`/formularios/nuevo?id=${form.id}`)} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-blue-50 hover:text-primary" title={form.status === 'draft' ? 'Editar borrador' : 'Abrir formulario y versiones'} aria-label={`Abrir ${form.name}`}><Edit3 size={13} /></button>
                            <button
                              type="button"
                              onClick={(event) => {
                                if (activeMenu === form.id) {
                                  setActiveMenu(null);
                                  return;
                                }
                                menuTriggerRef.current = event.currentTarget;
                                const rect = event.currentTarget.getBoundingClientRect();
                                setMenuPosition({ top: rect.bottom + 8, left: Math.max(12, rect.right - 208) });
                                setActiveMenu(form.id);
                              }}
                              aria-expanded={activeMenu === form.id}
                              aria-controls={activeMenu === form.id ? 'form-actions-menu' : undefined}
                              className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-slate-100 hover:text-slate-700 ${activeMenu === form.id ? 'bg-slate-100 text-slate-700' : 'text-slate-400'}`}
                              title="Más acciones"
                              aria-label={`Más acciones para ${form.name}`}
                            ><MoreHorizontal size={15} /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          </section>
          {!loading && totalPages > 1 && (
            <div className="mt-4 flex flex-col gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-500 dark:border-border dark:bg-card sm:flex-row sm:items-center sm:justify-between">
              <span>Mostrando {(safeCurrentPage - 1) * TABLE_PAGE_SIZE + 1}–{Math.min(safeCurrentPage * TABLE_PAGE_SIZE, filtered.length)} de {filtered.length}</span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={safeCurrentPage === 1} className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-border" title="Página anterior" aria-label="Página anterior"><ChevronLeft size={15} /></button>
                <span className="min-w-20 text-center text-slate-600 dark:text-muted-foreground">{safeCurrentPage} de {totalPages}</span>
                <button type="button" onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} disabled={safeCurrentPage === totalPages} className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-border" title="Página siguiente" aria-label="Página siguiente"><ChevronRight size={15} /></button>
              </div>
            </div>
          )}
        </div>
      </div>

      {menuForm && typeof document !== 'undefined' && createPortal(
        <ActionMenu
          ref={menuRef}
          form={menuForm}
          position={menuPosition}
          onClose={() => setActiveMenu(null)}
          onPreview={() => router.push(`/formularios/preview?id=${menuForm.id}`)}
          onResponses={() => router.push(`/formularios/respuestas?id=${menuForm.id}`)}
          onLaunch={() => router.push(`/formularios/lanzar?id=${encodeURIComponent(menuForm.id)}`)}
          onCopyPublic={() => void copyPublicLink(menuForm)}
          onDuplicate={() => duplicateForm(menuForm)}
          onPause={() => changeStatus(menuForm, 'paused')}
          onResume={() => changeStatus(menuForm, 'published')}
          onDelete={() => requestRemove(menuForm)}
          onRestore={() => restoreForm(menuForm)}
        />,
        document.body
      )}
      {removeTarget && <RemoveDialog form={removeTarget} mode={removeMode} busy={removeBusy} error={removeError} onCancel={closeRemove} onConfirm={() => void removeForm()} />}
      {publicAccessInfo && <div role="dialog" aria-modal="true" aria-label="Enlace y código de acceso" className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/40 p-4">
        <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
          <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-950">Acceso público</h2><p className="mt-1 text-sm text-slate-500">{publicAccessInfo.name}</p></div><button type="button" onClick={() => setPublicAccessInfo(null)} aria-label="Cerrar"><X size={18} /></button></div>
          <p className="mt-5 text-sm text-slate-600">Comparte el enlace y el código. La persona deberá entrar con su cuenta y aprobar la prueba de vida.</p>
          <label className="mt-5 block text-xs font-medium text-slate-500">Enlace<input readOnly value={publicAccessInfo.url} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700" /></label>
          <label className="mt-4 block text-xs font-medium text-slate-500">Código de acceso<input readOnly value={publicAccessInfo.code} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-sm font-semibold tracking-wide text-slate-900" /></label>
          <button type="button" onClick={() => void navigator.clipboard.writeText(`${publicAccessInfo.url}\nCódigo: ${publicAccessInfo.code}`).then(() => setNotice('Enlace y código copiados.'))} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-white"><Copy size={15} /> Copiar enlace y código</button>
        </div>
      </div>}
      {pendingDialogOpen && <PendingResponsesDialog launches={pendingLaunches} formNames={formNames} busyId={pendingActionId} error={pendingDialogError} onClose={() => { if (!pendingActionId) setPendingDialogOpen(false); }} onResend={(launch) => void managePendingLaunch(launch, 'resend')} onCancelLink={(launch) => void managePendingLaunch(launch, 'cancel')} />}
      {scheduledDialogOpen && <ScheduledLaunchesDialog launches={scheduledLaunches} formNames={formNames} busyId={pendingActionId} error={pendingDialogError} onClose={() => { if (!pendingActionId) setScheduledDialogOpen(false); }} onCancel={(launch) => void cancelScheduledLaunch(launch)} />}
      {notice && <BottomNotice message={notice} onClose={() => setNotice('')} />}
    </AppLayout>
  );
}

const ActionMenu = React.forwardRef<HTMLDivElement, { form: FormRow; position: { top: number; left: number }; onClose: () => void; onPreview: () => void; onResponses: () => void; onLaunch: () => void; onCopyPublic: () => void; onDuplicate: () => void; onPause: () => void; onResume: () => void; onDelete: () => void; onRestore: () => void }>(function ActionMenu({ form, position, onClose, onPreview, onResponses, onLaunch, onCopyPublic, onDuplicate, onPause, onResume, onDelete, onRestore }, ref) {
  const closeAfter = (action: () => void) => () => { onClose(); action(); };
  return (
    <div id="form-actions-menu" ref={ref} style={position} role="group" aria-label={`Acciones de ${form.name}`} className="fixed z-[80] max-h-[calc(100vh-24px)] w-52 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1.5 text-left shadow-[0_18px_45px_-16px_rgba(15,23,42,0.3)] dark:border-border dark:bg-card">
      <MenuAction icon={Eye} label="Vista previa" onClick={closeAfter(onPreview)} />
      {canViewFormResponses(form.status) && <MenuAction icon={BarChart3} label="Ver respuestas" onClick={closeAfter(onResponses)} />}
      {form.status === 'published' && <><MenuAction icon={Send} label="Lanzar formulario" onClick={closeAfter(onLaunch)} /><MenuAction icon={Link2} label="Consultar código público" onClick={closeAfter(onCopyPublic)} /></>}
      <MenuAction icon={Copy} label="Duplicar" onClick={closeAfter(onDuplicate)} />
      {form.status === 'published' && <MenuAction icon={CirclePause} label="Pausar formulario" onClick={closeAfter(onPause)} />}
      {form.status === 'paused' && <MenuAction icon={Play} label="Reanudar formulario" onClick={closeAfter(onResume)} />}
      {(form.status !== 'in_review') && <div className="my-1 border-t border-slate-200 dark:border-border" />}
      {form.status !== 'archived' && form.status !== 'in_review' && <MenuAction icon={form.status === 'draft' && !form.published_at && form.responseCount === 0 ? Trash2 : Archive} label={form.status === 'draft' && !form.published_at && form.responseCount === 0 ? 'Eliminar borrador' : 'Archivar'} destructive={form.status === 'draft'} onClick={closeAfter(onDelete)} />}
      {form.status === 'archived' && <MenuAction icon={RotateCcw} label="Reactivar formulario" onClick={closeAfter(onRestore)} />}
    </div>
  );
});

function RemoveDialog({ form, mode, busy, error, onCancel, onConfirm }: { form: FormRow; mode: RemovalMode; busy: boolean; error: string; onCancel: () => void; onConfirm: () => void }) {
  const isDelete = mode === 'delete';
  const checking = mode === 'checking';
  const Icon = checking ? Loader2 : isDelete ? Trash2 : Archive;
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="remove-form-title"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}
      onKeyDown={(event) => { if (event.key === 'Escape' && !busy) onCancel(); }}
    >
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-2xl dark:border-border dark:bg-card">
        <div className="flex items-start gap-4">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${isDelete ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-600'}`}><Icon size={20} className={checking ? 'animate-spin' : ''} /></span>
          <div>
            <h2 id="remove-form-title" className="text-base font-semibold text-slate-900 dark:text-foreground">{checking ? 'Comprobando borrador' : isDelete ? 'Eliminar borrador' : 'Archivar formulario'}</h2>
            <p className="mt-0.5 text-sm text-slate-500">{checking ? 'Revisando enlaces y respuestas vinculadas.' : isDelete ? 'Esta acción no se puede deshacer.' : 'Se conservarán las versiones y respuestas.'}</p>
          </div>
        </div>
        <p className="mt-5 text-sm leading-6 text-slate-600 dark:text-muted-foreground">
          {checking ? 'Un momento mientras comprobamos si se puede eliminar ' : `¿Deseas ${isDelete ? 'eliminar' : 'archivar'} `}
          <span className="font-semibold text-slate-900 dark:text-foreground">&quot;{form.name}&quot;</span>{checking ? '?' : isDelete ? '? El borrador desaparecerá de Mis formularios.' : '? Ya no estará disponible para nuevos envíos.'}
        </p>
        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-6 flex gap-3">
          <button type="button" autoFocus onClick={onCancel} disabled={busy} className="h-10 flex-1 rounded-md border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-border dark:text-foreground">Cancelar</button>
          <button type="button" onClick={onConfirm} disabled={busy || checking} className={`flex h-10 flex-1 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold text-white disabled:opacity-50 ${isDelete ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-700 hover:bg-slate-800'}`}>
            {busy || checking ? <Loader2 size={15} className="animate-spin" /> : <Icon size={15} />}{checking ? 'Comprobando...' : busy ? 'Procesando...' : isDelete ? 'Eliminar' : 'Archivar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PendingResponsesDialog({ launches, formNames, busyId, error, onClose, onResend, onCancelLink }: {
  launches: FormLaunch[];
  formNames: Map<string, string>;
  busyId: string | null;
  error: string;
  onClose: () => void;
  onResend: (launch: FormLaunch) => void;
  onCancelLink: (launch: FormLaunch) => void;
}) {
  return <div role="dialog" aria-modal="true" aria-labelledby="pending-responses-title" className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}>
    <div className="flex max-h-[min(85vh,720px)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-border dark:bg-card">
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-border"><div><h2 id="pending-responses-title" className="text-base font-semibold text-slate-950 dark:text-foreground">Respuestas pendientes</h2><p className="mt-1 text-xs text-slate-500">Participantes con un enlace vigente que todavía no responden.</p></div><button type="button" onClick={onClose} disabled={Boolean(busyId)} aria-label="Cerrar pendientes" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-50"><X size={18} /></button></div>
<div className="overflow-y-auto p-5">{launches.length === 0 ? <p className="rounded-lg bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">No hay respuestas pendientes con enlaces vigentes.</p> : <div className="space-y-3">{launches.map((launch) => <div key={launch.id} className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-border"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900 dark:text-foreground">{launch.recipient_name || launch.recipient_email}</p><p className="mt-1 truncate text-xs font-medium text-slate-700 dark:text-foreground">Formulario: {formNames.get(launch.template_id) || 'Formulario'}</p><p className="truncate text-xs text-slate-500">{launch.recipient_email}</p><p className="mt-1 text-[11px] text-slate-500">Enviado: {new Date(launch.created_at).toLocaleDateString('es-MX')}{launch.expires_at ? ` · Vence: ${new Date(launch.expires_at).toLocaleString('es-MX')}` : ' · Sin vencimiento'}</p></div><div className="flex shrink-0 gap-2"><button type="button" onClick={() => onResend(launch)} disabled={Boolean(busyId)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-primary px-2.5 text-xs font-semibold text-primary hover:bg-blue-50 disabled:opacity-50">{busyId === launch.id ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Reenviar</button><button type="button" onClick={() => onCancelLink(launch)} disabled={Boolean(busyId)} className="h-8 rounded-md border border-slate-200 px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-border">Cancelar enlace</button></div></div>)}</div>}
      {error && <p role="alert" className="mt-4 text-xs text-red-600">{error}</p>}</div>
    </div>
  </div>;
}

function ScheduledLaunchesDialog({ launches, formNames, busyId, error, onClose, onCancel }: {
  launches: ScheduledFormLaunch[];
  formNames: Map<string, string>;
  busyId: string | null;
  error: string;
  onClose: () => void;
  onCancel: (launch: ScheduledFormLaunch) => void;
}) {
  return <div role="dialog" aria-modal="true" aria-labelledby="scheduled-launches-title" className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="flex max-h-[min(85vh,720px)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4"><div><h2 id="scheduled-launches-title" className="text-base font-semibold">Envíos programados</h2><p className="mt-1 text-xs text-slate-500">Invitaciones que se enviarán en la fecha indicada.</p></div><button type="button" onClick={onClose} disabled={Boolean(busyId)} aria-label="Cerrar envíos programados" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"><X size={18} /></button></div>
      <div className="space-y-3 overflow-y-auto p-5">{launches.length === 0 ? <p className="rounded-lg bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">No hay envíos programados.</p> : launches.map((launch) => <div key={launch.id} className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="truncate text-sm font-semibold">{launch.recipient_name}</p><p className="mt-1 truncate text-xs text-slate-700">Formulario: {formNames.get(launch.template_id) || 'Formulario'}</p><p className="truncate text-xs text-slate-500">{launch.recipient_email}</p><p className={`mt-1 text-[11px] ${launch.status === 'failed' ? 'text-red-600' : 'text-slate-500'}`}>Programado: {new Date(launch.scheduled_at).toLocaleString('es-MX', { timeZone: launch.timezone })} · {launch.timezone}{launch.status === 'retrying' ? ' · Reintentando' : launch.status === 'processing' ? ' · En proceso' : launch.status === 'failed' ? ' · No se pudo enviar' : ''}</p></div><button type="button" onClick={() => onCancel(launch)} disabled={Boolean(busyId) || launch.status === 'processing'} className="h-8 shrink-0 rounded-md border border-slate-200 px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">{busyId === launch.id ? 'Cancelando...' : 'Cancelar envío'}</button></div>)}{error && <p role="alert" className="text-xs text-red-600">{error}</p>}</div>
    </div>
  </div>;
}

function MetricCard({ icon: Icon, label, value, tone = 'zinc' }: { icon: React.ElementType; label: string; value: number; tone?: 'zinc' | 'emerald' | 'blue' | 'indigo' }) {
  const tones = { zinc: 'bg-slate-100 text-slate-600', emerald: 'bg-emerald-50 text-emerald-700', blue: 'bg-blue-50 text-blue-700', indigo: 'bg-indigo-50 text-indigo-600' };
  return <div className="flex min-h-24 items-center gap-3 px-5 py-4"><span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md ${tones[tone]}`}><Icon size={17} /></span><div><p className="text-xl font-600 tabular-nums text-slate-950 dark:text-foreground">{value}</p><p className="text-xs text-slate-500 dark:text-muted-foreground">{label}</p></div></div>;
}
function StatusBadge({ status }: { status: FormRow['status'] }) {
  const style = statusStyles[status] || statusStyles.draft;
  return <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-500 ${style.className}`}><span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />{style.label}</span>;
}
function TableHeading({ children, align = 'left', className = '' }: { children: React.ReactNode; align?: 'left' | 'right'; className?: string }) {
  return (
    <th className={`whitespace-nowrap px-3 py-3 text-xs font-medium text-slate-500 dark:text-muted-foreground ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}>
      {children}
    </th>
  );
}
function MenuAction({ icon: Icon, label, onClick, destructive }: { icon: React.ElementType; label: string; onClick: () => void; destructive?: boolean }) {
  return <button type="button" onClick={onClick} className={`flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${destructive ? 'text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30' : 'text-slate-700 hover:bg-slate-100 dark:text-foreground dark:hover:bg-muted'}`}><Icon size={14} className="shrink-0" />{label}</button>;
}
function EmptyState({ onCreate, filtered }: { onCreate: () => void; filtered: boolean }) {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center px-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-md border border-blue-200 bg-blue-50 text-primary dark:border-primary/20 dark:bg-primary/10">{filtered ? <Search size={21} /> : <FilePlus2 size={21} />}</span>
      <h3 className="mt-4 text-sm font-600 text-slate-950 dark:text-foreground">{filtered ? 'No encontramos formularios' : 'Crea tu primer formulario'}</h3>
      <p className="mt-2 max-w-sm text-xs leading-5 text-slate-500 dark:text-muted-foreground">{filtered ? 'Prueba con otro término o cambia el filtro de estado.' : 'Diseña las preguntas, configura el PDF espejo y define cómo se firmarán las respuestas.'}</p>
      {!filtered && <button type="button" onClick={onCreate} className="mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-xs font-600 text-white transition-colors hover:bg-primary/90"><Plus size={14} /> Nuevo formulario</button>}
    </div>
  );
}
