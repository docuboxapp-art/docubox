'use client';

import React, { Suspense, useState, useRef, useEffect, useCallback } from 'react';
import AppLayout from '@/components/AppLayout';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Search,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  CheckSquare,
  Send,
  AlertTriangle,
  Info,
  Check,
  RefreshCw,
  X,
  Eye,
  BookOpen,
  ExternalLink,
  Bell,
  Inbox,
  CalendarDays,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { updateNotifications } from '@/lib/notifications/client';
import { useAuth } from '@/contexts/AuthContext';

interface Notification {
  id: string;
  type: 'document' | 'task' | 'request' | 'alert' | 'info';
  title: string;
  description: string;
  created_at: string;
  read: boolean;
  priority: 'alta' | 'media' | 'baja';
  category?: string;
  severity?: 'info' | 'success' | 'warning' | 'critical';
  event_type?: string;
  entity_id?: string | null;
  action_url?: string | null;
  action_label?: string | null;
  metadata?: Record<string, unknown> | null;
}

const typeIcons: Record<string, React.ReactNode> = {
  document: <FileText size={16} className="text-[#1E6BFF]" />,
  task: <CheckSquare size={16} className="text-emerald-600" />,
  request: <Send size={16} className="text-violet-600" />,
  alert: <AlertTriangle size={16} className="text-rose-600" />,
  info: <Info size={16} className="text-slate-500" />,
};

const typeLabels: Record<string, string> = {
  document: 'Documento',
  task: 'Tarea',
  request: 'Solicitud',
  alert: 'Alerta',
  info: 'Información',
};

function formatRelativeTime(dateStr: string): string {
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'hace un momento';
    if (mins < 60) return `hace ${mins} minuto${mins !== 1 ? 's' : ''}`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `hace ${hours} hora${hours !== 1 ? 's' : ''}`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `hace ${days} día${days !== 1 ? 's' : ''}`;
    return new Date(dateStr).toLocaleDateString('es-MX', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatFullDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('es-MX', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

// ─── Detail Modal ────────────────────────────────────────────────────────────
interface DetailModalProps {
  notification: Notification;
  onClose: () => void;
  onMarkRead: (id: string) => Promise<void>;
  onMarkUnread: (id: string) => Promise<void>;
}

function NotificationDetailModal({
  notification: n,
  onClose,
  onMarkRead,
  onMarkUnread,
}: DetailModalProps) {
  const router = useRouter();

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const priorityConfig: Record<string, { label: string; cls: string }> = {
    alta: { label: 'Alta', cls: 'border border-rose-200 bg-rose-50 text-rose-700' },
    media: { label: 'Media', cls: 'border border-amber-200 bg-amber-50 text-amber-700' },
    baja: { label: 'Baja', cls: 'border border-slate-200 bg-slate-100 text-slate-600' },
  };

  const typeColorCls: Record<string, string> = {
    document: 'bg-[#1E6BFF]/10 text-[#1E6BFF]',
    task: 'bg-emerald-50 text-emerald-700',
    request: 'bg-violet-50 text-violet-700',
    alert: 'bg-rose-50 text-rose-700',
    info: 'bg-slate-100 text-slate-600',
  };

  const handleContextualAction = async () => {
    // Mark as read when taking action
    if (!n.read) await onMarkRead(n.id);
    const documentId = [
      n.entity_id,
      n.metadata?.document_id,
      n.metadata?.documentoId,
      n.metadata?.documentId,
    ].find((value): value is string => typeof value === 'string' && value.length > 0);

    if (n.type === 'document' && documentId) {
      router.push(`/visor-documento/${documentId}`);
    } else if (n.action_url?.startsWith('/')) {
      router.push(n.action_url);
    } else if (n.type === 'document') {
      router.push('/mis-documentos');
    } else if (n.type === 'task') {
      router.push('/mis-tareas');
    } else if (n.type === 'request') {
      router.push('/mis-solicitudes');
    } else {
      router.push('/inicio');
    }
    onClose();
  };

  const contextualActionLabel = () => {
    if (n.action_label) return n.action_label;
    if (n.type === 'document') return 'Ver documento';
    if (n.type === 'task') return 'Ver tarea';
    if (n.type === 'request') return 'Ver solicitud';
    return 'Ver en dashboard';
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="notification-detail-title"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-950/35 backdrop-blur-[2px]" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-[560px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.18)] dark:border-slate-700 dark:bg-slate-900">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={`flex h-10 w-10 flex-none items-center justify-center rounded-lg ${n.read ? 'bg-slate-100 dark:bg-slate-800' : 'bg-primary/10 dark:bg-primary/20'}`}
            >
              {typeIcons[n.type] ?? typeIcons.info}
            </div>
            <div className="min-w-0">
              <h2
                id="notification-detail-title"
                className="text-base font-700 leading-snug text-slate-950 dark:text-white"
              >
                {n.title}
              </h2>
              {!n.read && (
                <span className="mt-1 inline-flex items-center gap-1.5 text-xs font-600 text-primary">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
                  No leída
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-9 w-9 flex-none items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:hover:bg-slate-800 dark:hover:text-white"
            aria-label="Cerrar detalle"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-5 px-5 py-5">
          {/* Meta row */}
          <div className="grid grid-cols-2 divide-x divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
            <div className="p-3.5">
              <p className="mb-1.5 text-xs font-600 text-slate-500">Tipo</p>
              <span
                className={`inline-flex items-center gap-1.5 text-xs font-600 px-2 py-0.5 rounded-full ${typeColorCls[n.type] ?? typeColorCls.info}`}
              >
                {typeIcons[n.type]}
                {typeLabels[n.type] ?? 'Info'}
              </span>
            </div>
            <div className="p-3.5">
              <p className="mb-1.5 text-xs font-600 text-slate-500">Prioridad</p>
              <span
                className={`inline-flex text-xs font-600 px-2 py-0.5 rounded-full ${priorityConfig[n.priority]?.cls ?? ''}`}
              >
                {priorityConfig[n.priority]?.label ?? n.priority}
              </span>
            </div>
          </div>

          {/* Description */}
          <div>
            <p className="mb-1.5 text-xs font-600 text-slate-500">Detalle</p>
            <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
              {n.description}
            </p>
          </div>

          {/* Date */}
          <div className="flex items-start gap-2 border-t border-slate-100 pt-4 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <Info size={14} className="flex-shrink-0" />
            <span>
              <span className="font-600 text-slate-700 dark:text-slate-200">Fecha:</span>{' '}
              {formatRelativeTime(n.created_at)}
              <span className="text-xs ml-1 text-muted-foreground/70">
                ({formatFullDate(n.created_at)})
              </span>
            </span>
          </div>
        </div>

        {/* Actions footer */}
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 bg-slate-50/60 px-5 py-4 dark:border-slate-700 dark:bg-slate-950/40">
          {/* Contextual action */}
          <button
            onClick={handleContextualAction}
            className="flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-600 text-white transition-colors hover:bg-primary/90"
          >
            <ExternalLink size={14} />
            {contextualActionLabel()}
          </button>

          {/* Mark read / unread */}
          {n.read ? (
            <button
              onClick={async () => {
                await onMarkUnread(n.id);
                onClose();
              }}
              className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-500 text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <BookOpen size={14} />
              Marcar como no leída
            </button>
          ) : (
            <button
              onClick={async () => {
                await onMarkRead(n.id);
                onClose();
              }}
              className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-500 text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Check size={14} />
              Marcar como leída
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
function NotificationsContent() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'all' | 'unread' | 'read'>('all');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('todos');
  const [priorityFilter, setPriorityFilter] = useState('todas');
  const [timeFilter, setTimeFilter] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [timeFilterAnchor, setTimeFilterAnchor] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [typeOpen, setTypeOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [detailNotif, setDetailNotif] = useState<Notification | null>(null);

  const typeRef = useRef<HTMLDivElement>(null);
  const priorityRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);

  const loadNotifications = useCallback(async () => {
    if (!user) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);
    try {
      const supabase = createClient();
      const fields =
        'id, type, title, description, created_at, read, priority, metadata, entity_id, action_url, action_label';
      let { data, error } = await supabase
        .from('notifications')
        .select(fields)
        .eq('user_id', user.id)
        .is('archived_at', null)
        .order('created_at', { ascending: false })
        .limit(200);

      // Older database schemas may not yet include archived_at. The feed remains
      // available while that migration is being applied.
      if (error?.code === '42703' || error?.code === 'PGRST204') {
        const fallback = await supabase
          .from('notifications')
          .select(fields)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(200);
        data = fallback.data;
        error = fallback.error;
      }

      if (error) throw error;

      if (!error && data) {
        setNotifications(data as Notification[]);
        setTimeFilterAnchor(Date.now());
      }
    } catch (caught) {
      setNotifications([]);
      setLoadError(
        caught instanceof Error
          ? caught.message
          : 'No fue posible consultar las notificaciones en este momento.'
      );
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadNotifications();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadNotifications]);

  // Auto-open detail modal when ?open=<id> is present in URL
  useEffect(() => {
    const openId = searchParams.get('open');
    if (!openId || notifications.length === 0) return;
    const target = notifications.find((n) => n.id === openId);
    if (target) {
      const timer = window.setTimeout(() => setDetailNotif(target), 0);
      return () => window.clearTimeout(timer);
    }
  }, [searchParams, notifications]);

  // Realtime subscription
  useEffect(() => {
    if (!user) return;
    const supabase = createClient();
    const channel = supabase
      .channel('notifications-page')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        () => {
          loadNotifications();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, loadNotifications]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (typeRef.current && !typeRef.current.contains(e.target as Node)) setTypeOpen(false);
      if (priorityRef.current && !priorityRef.current.contains(e.target as Node))
        setPriorityOpen(false);
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node))
        setActionsOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const matchesCurrentFilters = (n: Notification) => {
    if (timeFilter !== 'all' && timeFilterAnchor > 0) {
      const days = timeFilter === '7d' ? 7 : timeFilter === '30d' ? 30 : 90;
      const since = timeFilterAnchor - days * 24 * 60 * 60 * 1000;
      if (new Date(n.created_at).getTime() < since) return false;
    }
    if (typeFilter !== 'todos' && n.type !== typeFilter) return false;
    if (priorityFilter !== 'todas' && n.priority !== priorityFilter) return false;
    if (
      search &&
      !n.title.toLowerCase().includes(search.toLowerCase()) &&
      !n.description.toLowerCase().includes(search.toLowerCase())
    )
      return false;
    return true;
  };

  const scopedNotifications = notifications.filter(matchesCurrentFilters);
  const tabCounts = {
    all: scopedNotifications.length,
    unread: scopedNotifications.filter((notification) => !notification.read).length,
    read: scopedNotifications.filter((notification) => notification.read).length,
  };
  const filtered = scopedNotifications.filter((notification) => {
    if (tab === 'unread') return !notification.read;
    if (tab === 'read') return notification.read;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedNotifications = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const allSelected =
    pagedNotifications.length > 0 && pagedNotifications.every((n) => selectedIds.includes(n.id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds((prev) =>
        prev.filter((id) => !pagedNotifications.map((notification) => notification.id).includes(id))
      );
    } else {
      setSelectedIds((prev) => [
        ...new Set([...prev, ...pagedNotifications.map((notification) => notification.id)]),
      ]);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  };

  // ── Single notification actions ──
  const markOneRead = async (id: string) => {
    await updateNotifications('read', [id]);
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    // Update detail modal if open
    setDetailNotif((prev) => (prev?.id === id ? { ...prev, read: true } : prev));
  };

  const markOneUnread = async (id: string) => {
    await updateNotifications('unread', [id]);
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: false } : n)));
    setDetailNotif((prev) => (prev?.id === id ? { ...prev, read: false } : prev));
  };

  // ── Bulk actions ──
  // Determine if all selected are read or unread
  const selectedNotifs = notifications.filter((n) => selectedIds.includes(n.id));
  const allSelectedRead = selectedNotifs.length > 0 && selectedNotifs.every((n) => n.read);
  const markSelectedRead = async () => {
    if (!selectedIds.length) return;
    await updateNotifications('read', selectedIds);
    setNotifications((prev) =>
      prev.map((n) => (selectedIds.includes(n.id) ? { ...n, read: true } : n))
    );
    setSelectedIds([]);
    setActionsOpen(false);
  };

  const markSelectedUnread = async () => {
    if (!selectedIds.length) return;
    await updateNotifications('unread', selectedIds);
    setNotifications((prev) =>
      prev.map((n) => (selectedIds.includes(n.id) ? { ...n, read: false } : n))
    );
    setSelectedIds([]);
    setActionsOpen(false);
  };

  const markAllRead = async () => {
    if (!user) return;
    await updateNotifications('read');
    setNotifications((prev) => prev.map((notification) => ({ ...notification, read: true })));
    setActionsOpen(false);
  };

  return (
    <AppLayout>
      <div className="-mx-4 -my-4 min-h-[calc(100vh-8rem)] bg-slate-50 px-4 py-5 sm:-mx-6 sm:px-6 md:-my-6 lg:-mx-8 lg:px-8 xl:-mx-10 xl:px-10 dark:bg-background">
        <div className="mx-auto w-full max-w-[1520px]">
          {/* Header */}
          <header className="mb-5 flex flex-col gap-4 border-b border-slate-200/80 pb-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-2xl font-700 tracking-normal text-slate-950 dark:text-white">
                Notificaciones
              </h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Consulta y administra las novedades de tu espacio de trabajo.
              </p>
            </div>
            <button
              onClick={loadNotifications}
              className="flex h-9 w-full items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3.5 text-sm font-600 text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 sm:w-auto dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
              Actualizar
            </button>
          </header>

          {/* Search and filters */}
          <section className="mb-4 overflow-visible rounded-lg border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:border-slate-700 dark:bg-slate-900">
            {/* Search + Filters row */}
            <div className="flex flex-col gap-2.5 p-3 sm:flex-row sm:items-center">
              <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border border-slate-200 bg-slate-50/70 px-3 transition-colors focus-within:border-primary focus-within:bg-white focus-within:ring-2 focus-within:ring-primary/10 dark:border-slate-700 dark:bg-slate-800/70">
                <Search size={15} className="flex-shrink-0 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar por palabra clave..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-200"
                />
              </div>

              {/* Type dropdown */}
              <div className="relative sm:flex-none" ref={typeRef}>
                <button
                  onClick={() => {
                    setTypeOpen(!typeOpen);
                    setPriorityOpen(false);
                  }}
                  className="flex h-10 w-full items-center justify-between gap-2 whitespace-nowrap rounded-md border border-slate-200 bg-white px-3 text-sm font-600 text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 sm:w-auto"
                >
                  {typeFilter === 'todos' ? 'Todos los tipos' : typeLabels[typeFilter]}
                  <ChevronDown size={14} className="text-muted-foreground" />
                </button>
                {typeOpen && (
                  <div className="absolute right-0 top-full z-20 mt-1 min-w-[180px] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-[0_14px_35px_-20px_rgba(15,23,42,0.4)] dark:border-slate-700 dark:bg-slate-900">
                    {[
                      { value: 'todos', label: 'Todos los tipos' },
                      { value: 'document', label: 'Documento' },
                      { value: 'task', label: 'Tarea' },
                      { value: 'request', label: 'Solicitud' },
                      { value: 'alert', label: 'Alerta' },
                      { value: 'info', label: 'Información' },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => {
                          setTypeFilter(opt.value);
                          setTypeOpen(false);
                        }}
                        className={`w-full px-3 py-2 text-left text-sm transition-colors hover:bg-primary/5 hover:text-primary ${typeFilter === opt.value ? 'bg-primary/10 font-600 text-primary dark:bg-primary/20' : 'text-slate-700 dark:text-slate-200'}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Priority dropdown */}
              <div className="relative sm:flex-none" ref={priorityRef}>
                <button
                  onClick={() => {
                    setPriorityOpen(!priorityOpen);
                    setTypeOpen(false);
                  }}
                  className="flex h-10 w-full items-center justify-between gap-2 whitespace-nowrap rounded-md border border-slate-200 bg-white px-3 text-sm font-600 text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 sm:w-auto"
                >
                  {priorityFilter === 'todas'
                    ? 'Todas las prioridades'
                    : priorityFilter.charAt(0).toUpperCase() + priorityFilter.slice(1)}
                  <ChevronDown size={14} className="text-muted-foreground" />
                </button>
                {priorityOpen && (
                  <div className="absolute right-0 top-full z-20 mt-1 min-w-[190px] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-[0_14px_35px_-20px_rgba(15,23,42,0.4)] dark:border-slate-700 dark:bg-slate-900">
                    {[
                      { value: 'todas', label: 'Todas las prioridades' },
                      { value: 'alta', label: 'Alta' },
                      { value: 'media', label: 'Media' },
                      { value: 'baja', label: 'Baja' },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => {
                          setPriorityFilter(opt.value);
                          setPriorityOpen(false);
                        }}
                        className={`w-full px-3 py-2 text-left text-sm transition-colors hover:bg-primary/5 hover:text-primary ${priorityFilter === opt.value ? 'bg-primary/10 font-600 text-primary dark:bg-primary/20' : 'text-slate-700 dark:text-slate-200'}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <label className="flex h-10 w-full items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-600 text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-within:ring-2 focus-within:ring-primary/25 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 sm:w-auto">
                <CalendarDays size={14} className="text-slate-400" />
                <select
                  value={timeFilter}
                  onChange={(event) => {
                    setTimeFilter(event.target.value as typeof timeFilter);
                    setTimeFilterAnchor(Date.now());
                  }}
                  className="min-w-0 bg-transparent text-sm font-600 text-slate-600 outline-none dark:text-slate-300"
                  aria-label="Periodo de notificaciones"
                >
                  <option value="7d">Últimos 7 días</option>
                  <option value="30d">Último mes</option>
                  <option value="90d">Últimos 3 meses</option>
                  <option value="all">Todo el historial</option>
                </select>
              </label>
            </div>

            {/* Tabs + Actions row */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-3 dark:border-slate-700">
              <div className="flex min-w-0 items-center gap-4 overflow-x-auto">
                {[
                  { key: 'all', label: 'Todas', count: tabCounts.all },
                  { key: 'unread', label: 'No leídas', count: tabCounts.unread },
                  { key: 'read', label: 'Leídas', count: tabCounts.read },
                ].map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key as 'all' | 'unread' | 'read')}
                    className={`inline-flex h-11 items-center gap-1.5 whitespace-nowrap border-b-2 px-1 text-sm font-600 transition-colors ${
                      tab === t.key
                        ? 'border-[#1E6BFF] text-[#1E6BFF]'
                        : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    <span>{t.label}</span>
                    <span
                      className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-700 tabular-nums ${
                        tab === t.key
                          ? 'bg-[#1E6BFF]/10 text-[#1E6BFF]'
                          : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      {t.count}
                    </span>
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                {selectedIds.length > 0 && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-600 text-primary dark:bg-primary/20">
                    {selectedIds.length} seleccionadas
                  </span>
                )}
                <div className="relative" ref={actionsRef}>
                  <button
                    onClick={() => setActionsOpen((open) => !open)}
                    className="flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-600 text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    Acciones
                    <ChevronDown size={13} className="text-muted-foreground" />
                  </button>
                  {actionsOpen && (
                    <div className="absolute right-0 top-full z-20 mt-1 min-w-[240px] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-[0_14px_35px_-20px_rgba(15,23,42,0.4)] dark:border-slate-700 dark:bg-slate-900">
                      {selectedIds.length > 0 ? (
                        <button
                          onClick={allSelectedRead ? markSelectedUnread : markSelectedRead}
                          className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-primary/5 hover:text-primary"
                        >
                          {allSelectedRead ? <BookOpen size={14} /> : <Check size={14} />}
                          {allSelectedRead
                            ? 'Marcar seleccionadas como no leídas'
                            : 'Marcar seleccionadas como leídas'}
                        </button>
                      ) : (
                        <button
                          onClick={markAllRead}
                          className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-primary/5 hover:text-primary"
                        >
                          <Check size={14} />
                          Marcar todas como leídas
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Notifications list */}
          <section className="overflow-hidden rounded-lg border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:border-slate-700 dark:bg-slate-900">
            {/* Table header */}
            <div className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-3 border-b border-slate-200 bg-slate-50/70 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/60 md:grid-cols-[20px_minmax(280px,1fr)_112px_104px_120px_152px]">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                className="w-4 h-4 rounded border-border accent-primary cursor-pointer"
              />
              <span className="text-xs font-600 text-slate-500">Notificación</span>
              <span className="hidden text-xs font-600 text-slate-500 md:block">Tipo</span>
              <span className="hidden text-xs font-600 text-slate-500 md:block">Prioridad</span>
              <span className="hidden text-xs font-600 text-slate-500 md:block">Tiempo</span>
              <span className="text-xs font-600 text-slate-500">Acción</span>
            </div>

            {/* Notification rows */}
            <div className="divide-y divide-border">
              {loading ? (
                <div className="flex flex-col items-center justify-center gap-3 py-20">
                  <svg
                    className="h-6 w-6 animate-spin text-primary"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  <p className="text-sm text-muted-foreground">Cargando notificaciones...</p>
                </div>
              ) : loadError ? (
                <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
                  <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-rose-50 text-rose-600 ring-1 ring-rose-100 dark:bg-rose-950/30 dark:text-rose-300 dark:ring-rose-900">
                    <AlertTriangle size={20} />
                  </div>
                  <p className="text-sm font-600 text-slate-700 dark:text-slate-200">
                    No fue posible cargar las notificaciones
                  </p>
                  <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">
                    Verifica tu conexión e inténtalo de nuevo.
                  </p>
                  <button
                    onClick={loadNotifications}
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-600 text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  >
                    <RefreshCw size={14} />
                    Reintentar
                  </button>
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
                  <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-50 text-slate-400 ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
                    {notifications.length === 0 ? <Bell size={20} /> : <Inbox size={20} />}
                  </div>
                  <p className="text-sm font-600 text-slate-700 dark:text-slate-200">
                    {notifications.length === 0
                      ? 'No tienes notificaciones pendientes'
                      : 'No encontramos resultados'}
                  </p>
                  <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">
                    {notifications.length === 0
                      ? 'Cuando ocurra algo importante en tu espacio, aparecerá aquí.'
                      : 'Prueba cambiando la búsqueda o los filtros seleccionados.'}
                  </p>
                </div>
              ) : (
                pagedNotifications.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => toggleSelect(n.id)}
                    className={`group grid cursor-pointer grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3.5 transition-colors md:grid-cols-[20px_minmax(280px,1fr)_112px_104px_120px_152px] ${
                      selectedIds.includes(n.id)
                        ? 'bg-[#1E6BFF]/[0.08] shadow-[inset_2px_0_0_#1E6BFF] dark:bg-[#1E6BFF]/20'
                        : n.read
                          ? 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                          : 'bg-white shadow-[inset_2px_0_0_#1E6BFF] hover:bg-[#1E6BFF]/[0.03] dark:bg-slate-900 dark:hover:bg-[#1E6BFF]/10'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(n.id)}
                      onChange={() => toggleSelect(n.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 rounded border-border accent-primary cursor-pointer"
                    />
                    <div className="flex min-w-0 items-start gap-3">
                      <div
                        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${n.read ? 'bg-slate-100 dark:bg-slate-800' : 'bg-[#1E6BFF]/10 ring-1 ring-[#1E6BFF]/15 dark:bg-[#1E6BFF]/20'}`}
                      >
                        {typeIcons[n.type] ?? typeIcons.info}
                      </div>
                      <div className="min-w-0">
                        <p
                          className={`flex items-center gap-2 text-sm leading-tight text-slate-800 dark:text-slate-100 ${!n.read ? 'font-700' : 'font-500'}`}
                        >
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              setDetailNotif(n);
                            }}
                            className="truncate text-left transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
                            title="Ver detalle de la notificación"
                          >
                            {n.title}
                          </button>
                          {!n.read && (
                            <span className="h-1.5 w-1.5 flex-none rounded-full bg-[#1E6BFF]" />
                          )}
                        </p>
                        <p className="mt-1 line-clamp-1 text-xs text-slate-500 dark:text-slate-400">
                          {n.description}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 md:hidden">
                          <span className="text-[11px] font-600 text-slate-500">
                            {typeLabels[n.type] ?? 'Info'}
                          </span>
                          <span className="text-[11px] text-slate-400">·</span>
                          <span className="text-[11px] text-slate-500">
                            {formatRelativeTime(n.created_at)}
                          </span>
                        </div>
                      </div>
                    </div>
                    <span
                      className={`hidden whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-500 md:inline-flex ${
                        n.type === 'document'
                          ? 'bg-[#1E6BFF]/10 text-[#1E6BFF]'
                          : n.type === 'task'
                            ? 'bg-emerald-50 text-emerald-700'
                            : n.type === 'request'
                              ? 'bg-violet-50 text-violet-700'
                              : n.type === 'alert'
                                ? 'bg-rose-50 text-rose-700'
                                : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {typeLabels[n.type] ?? 'Info'}
                    </span>
                    <span
                      className={`hidden whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-600 md:inline-flex ${
                        n.priority === 'alta'
                          ? 'border border-rose-200 bg-rose-50 text-rose-700'
                          : n.priority === 'media'
                            ? 'border border-amber-200 bg-amber-50 text-amber-700'
                            : 'border border-slate-200 bg-slate-100 text-slate-600'
                      }`}
                    >
                      {n.priority.charAt(0).toUpperCase() + n.priority.slice(1)}
                    </span>
                    <span className="hidden whitespace-nowrap text-xs text-slate-500 md:block">
                      {formatRelativeTime(n.created_at)}
                    </span>

                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          void (n.read ? markOneUnread(n.id) : markOneRead(n.id));
                        }}
                        title={n.read ? 'Marcar como no leída' : 'Marcar como leída'}
                        aria-label={n.read ? 'Marcar como no leída' : 'Marcar como leída'}
                        className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-primary/10"
                      >
                        {n.read ? <BookOpen size={14} /> : <Check size={15} />}
                      </button>
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          setDetailNotif(n);
                        }}
                        title="Ver detalle"
                        aria-label="Ver detalle"
                        className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-primary/10"
                      >
                        <Eye size={13} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-slate-700">
              <label className="flex items-center gap-2 text-xs text-slate-500">
                <span>Registros por página</span>
                <select
                  value={pageSize}
                  onChange={(event) => setPageSize(Number(event.target.value))}
                  className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-600 text-slate-700 outline-none focus:ring-2 focus:ring-primary/25 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  aria-label="Registros por página"
                >
                  {[15, 30, 50, 100].map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex items-center justify-between gap-3 sm:justify-end">
                <span className="text-xs text-slate-500">
                  {filtered.length === 0 ? '0 de 0' : `${currentPage} de ${totalPages}`}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={currentPage === 1}
                    aria-label="Página anterior"
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  >
                    <ChevronLeft size={15} />
                  </button>
                  <button
                    onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                    disabled={currentPage === totalPages}
                    aria-label="Página siguiente"
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  >
                    <ChevronRight size={15} />
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Detail Modal */}
      {detailNotif && (
        <NotificationDetailModal
          notification={detailNotif}
          onClose={() => setDetailNotif(null)}
          onMarkRead={markOneRead}
          onMarkUnread={markOneUnread}
        />
      )}
    </AppLayout>
  );
}

export default function NotificationsPage() {
  return (
    <Suspense fallback={null}>
      <NotificationsContent />
    </Suspense>
  );
}
