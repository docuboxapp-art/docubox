'use client';

import React, { Suspense, useState, useRef, useEffect, useCallback } from 'react';
import AppLayout from '@/components/AppLayout';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Search,
  ChevronDown,
  FileText,
  CheckSquare,
  Send,
  AlertTriangle,
  Info,
  Check,
  Trash2,
  RefreshCw,
  X,
  Eye,
  BookOpen,
  ExternalLink,
  Bell,
  Inbox,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface Notification {
  id: string;
  type: 'document' | 'task' | 'request' | 'alert' | 'info';
  title: string;
  description: string;
  created_at: string;
  read: boolean;
  priority: 'alta' | 'media' | 'baja';
  metadata?: Record<string, unknown> | null;
}

const typeIcons: Record<string, React.ReactNode> = {
  document: <FileText size={16} className="text-blue-500" />,
  task: <CheckSquare size={16} className="text-green-500" />,
  request: <Send size={16} className="text-purple-500" />,
  alert: <AlertTriangle size={16} className="text-red-500" />,
  info: <Info size={16} className="text-gray-400" />,
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
  onDelete: (id: string) => Promise<void>;
}

function NotificationDetailModal({
  notification: n,
  onClose,
  onMarkRead,
  onMarkUnread,
  onDelete,
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
    alta: { label: 'Alta', cls: 'bg-red-50 text-red-600 border border-red-200' },
    media: { label: 'Media', cls: 'bg-amber-50 text-amber-600 border border-amber-200' },
    baja: { label: 'Baja', cls: 'bg-primary/10 text-primary border border-primary/20' },
  };

  const typeColorCls: Record<string, string> = {
    document: 'bg-blue-50 text-blue-600',
    task: 'bg-green-50 text-green-600',
    request: 'bg-purple-50 text-purple-600',
    alert: 'bg-red-50 text-red-600',
    info: 'bg-muted text-muted-foreground',
  };

  const handleContextualAction = async () => {
    // Mark as read when taking action
    if (!n.read) await onMarkRead(n.id);
    if (n.type === 'document') {
      const docId = n.metadata?.document_id as string | undefined;
      if (docId) {
        router.push(`/visor-documento/${docId}`);
      } else {
        router.push('/mis-documentos');
      }
    } else if (n.type === 'task') {
      router.push('/pending-tasks');
    } else if (n.type === 'request') {
      router.push('/participation-requests');
    } else {
      router.push('/documents-dashboard');
    }
    onClose();
  };

  const contextualActionLabel = () => {
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
              className={`flex h-10 w-10 flex-none items-center justify-center rounded-lg ${n.read ? 'bg-slate-100 dark:bg-slate-800' : 'bg-blue-50 dark:bg-blue-950/50'}`}
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

          {/* Delete */}
          <button
            onClick={async () => {
              await onDelete(n.id);
              onClose();
            }}
            className="ml-auto flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-500 text-destructive transition-colors hover:bg-destructive/5"
          >
            <Trash2 size={14} />
            Eliminar
          </button>
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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [typeOpen, setTypeOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [detailNotif, setDetailNotif] = useState<Notification | null>(null);

  const typeRef = useRef<HTMLDivElement>(null);
  const priorityRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);

  const loadNotifications = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(200);
      if (!error && data) {
        setNotifications(data as Notification[]);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  // Auto-open detail modal when ?open=<id> is present in URL
  useEffect(() => {
    const openId = searchParams.get('open');
    if (!openId || notifications.length === 0) return;
    const target = notifications.find((n) => n.id === openId);
    if (target) {
      setDetailNotif(target);
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

  const filtered = notifications.filter((n) => {
    if (tab === 'unread' && n.read) return false;
    if (tab === 'read' && !n.read) return false;
    if (typeFilter !== 'todos' && n.type !== typeFilter) return false;
    if (priorityFilter !== 'todas' && n.priority !== priorityFilter) return false;
    if (
      search &&
      !n.title.toLowerCase().includes(search.toLowerCase()) &&
      !n.description.toLowerCase().includes(search.toLowerCase())
    )
      return false;
    return true;
  });

  const allSelected = filtered.length > 0 && filtered.every((n) => selectedIds.includes(n.id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !filtered.map((n) => n.id).includes(id)));
    } else {
      setSelectedIds((prev) => [...new Set([...prev, ...filtered.map((n) => n.id)])]);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  };

  // ── Single notification actions ──
  const markOneRead = async (id: string) => {
    const supabase = createClient();
    await supabase.from('notifications').update({ read: true }).eq('id', id);
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    // Update detail modal if open
    setDetailNotif((prev) => (prev?.id === id ? { ...prev, read: true } : prev));
  };

  const markOneUnread = async (id: string) => {
    const supabase = createClient();
    await supabase.from('notifications').update({ read: false }).eq('id', id);
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: false } : n)));
    setDetailNotif((prev) => (prev?.id === id ? { ...prev, read: false } : prev));
  };

  const deleteOne = async (id: string) => {
    const supabase = createClient();
    await supabase.from('notifications').delete().eq('id', id);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    setSelectedIds((prev) => prev.filter((i) => i !== id));
  };

  // ── Bulk actions ──
  // Determine if all selected are read or unread
  const selectedNotifs = notifications.filter((n) => selectedIds.includes(n.id));
  const allSelectedRead = selectedNotifs.length > 0 && selectedNotifs.every((n) => n.read);
  const allSelectedUnread = selectedNotifs.length > 0 && selectedNotifs.every((n) => !n.read);
  // Mixed: show both options
  const hasMixedSelection = selectedNotifs.length > 0 && !allSelectedRead && !allSelectedUnread;

  const markSelectedRead = async () => {
    if (!selectedIds.length) return;
    const supabase = createClient();
    await supabase.from('notifications').update({ read: true }).in('id', selectedIds);
    setNotifications((prev) =>
      prev.map((n) => (selectedIds.includes(n.id) ? { ...n, read: true } : n))
    );
    setSelectedIds([]);
    setActionsOpen(false);
  };

  const markSelectedUnread = async () => {
    if (!selectedIds.length) return;
    const supabase = createClient();
    await supabase.from('notifications').update({ read: false }).in('id', selectedIds);
    setNotifications((prev) =>
      prev.map((n) => (selectedIds.includes(n.id) ? { ...n, read: false } : n))
    );
    setSelectedIds([]);
    setActionsOpen(false);
  };

  const deleteSelected = async () => {
    if (!selectedIds.length) return;
    const supabase = createClient();
    await supabase.from('notifications').delete().in('id', selectedIds);
    setNotifications((prev) => prev.filter((n) => !selectedIds.includes(n.id)));
    setSelectedIds([]);
    setActionsOpen(false);
  };

  const markAllRead = async () => {
    if (!user) return;
    const supabase = createClient();
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', user.id)
      .eq('read', false);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setActionsOpen(false);
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <AppLayout>
      <div className="-mx-4 -my-4 min-h-[calc(100vh-8rem)] bg-[#f6f8fb] px-4 py-4 sm:-mx-6 sm:px-5 md:-my-6 lg:-mx-8 lg:px-6 xl:-mx-10 xl:px-7 dark:bg-background">
        <div className="mx-auto w-full max-w-[1600px]">
          {/* Header */}
          <div className="mb-4 flex flex-col gap-3 border-b border-slate-200/80 pb-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-700 text-slate-950 dark:text-white">
                Notificaciones
                {unreadCount > 0 && (
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-50 px-1.5 text-xs font-700 tabular-nums text-primary ring-1 ring-blue-100 dark:bg-blue-950/50 dark:ring-blue-900">
                    {unreadCount}
                  </span>
                )}
              </h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Consulta y administra las novedades de tu espacio de trabajo.
              </p>
            </div>
            <button
              onClick={loadNotifications}
              className="flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-600 text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
              Actualizar
            </button>
          </div>

          {/* Search and filters */}
          <section className="mb-3 overflow-visible rounded-lg border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:border-slate-700 dark:bg-slate-900">
            {/* Search + Filters row */}
            <div className="flex flex-wrap items-center gap-2 p-3">
              <div className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-md border border-slate-200 bg-slate-50/70 px-3 transition-colors focus-within:border-primary focus-within:bg-white focus-within:ring-2 focus-within:ring-primary/10 dark:border-slate-700 dark:bg-slate-800/70">
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
              <div className="relative flex-1 sm:flex-none" ref={typeRef}>
                <button
                  onClick={() => {
                    setTypeOpen(!typeOpen);
                    setPriorityOpen(false);
                  }}
                  className="flex h-9 w-full items-center justify-between gap-2 whitespace-nowrap rounded-md border border-slate-200 bg-white px-3 text-sm font-600 text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 sm:w-auto"
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
                        className={`w-full px-3 py-2 text-left text-sm transition-colors hover:bg-blue-50 hover:text-primary dark:hover:bg-blue-950/30 ${typeFilter === opt.value ? 'bg-blue-50 font-600 text-primary dark:bg-blue-950/30' : 'text-slate-700 dark:text-slate-200'}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Priority dropdown */}
              <div className="relative flex-1 sm:flex-none" ref={priorityRef}>
                <button
                  onClick={() => {
                    setPriorityOpen(!priorityOpen);
                    setTypeOpen(false);
                  }}
                  className="flex h-9 w-full items-center justify-between gap-2 whitespace-nowrap rounded-md border border-slate-200 bg-white px-3 text-sm font-600 text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 sm:w-auto"
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
                        className={`w-full px-3 py-2 text-left text-sm transition-colors hover:bg-blue-50 hover:text-primary dark:hover:bg-blue-950/30 ${priorityFilter === opt.value ? 'bg-blue-50 font-600 text-primary dark:bg-blue-950/30' : 'text-slate-700 dark:text-slate-200'}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Tabs + Actions row */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-3 dark:border-slate-700">
              <div className="flex min-w-0 items-center gap-4 overflow-x-auto">
                {[
                  { key: 'all', label: 'Todas' },
                  { key: 'unread', label: 'No Leídas' },
                  { key: 'read', label: 'Leídas' },
                ].map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key as 'all' | 'unread' | 'read')}
                    className={`h-11 whitespace-nowrap border-b-2 px-1 text-sm font-600 transition-colors ${
                      tab === t.key
                        ? 'border-primary text-primary'
                        : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Actions dropdown */}
              <div className="flex items-center gap-2">
                {selectedIds.length > 0 && (
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-600 text-primary dark:bg-blue-950/50">
                    {selectedIds.length} seleccionadas
                  </span>
                )}
                <div className="relative" ref={actionsRef}>
                  <button
                    onClick={() => setActionsOpen(!actionsOpen)}
                    className="flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-600 text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    Acciones
                    <ChevronDown size={13} className="text-muted-foreground" />
                  </button>
                  {actionsOpen && (
                    <div className="absolute right-0 top-full z-20 mt-1 min-w-[240px] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-[0_14px_35px_-20px_rgba(15,23,42,0.4)] dark:border-slate-700 dark:bg-slate-900">
                      {/* Bulk: mark as read — show when selection has unread items */}
                      {(allSelectedUnread || hasMixedSelection || selectedIds.length === 0) && (
                        <button
                          onClick={markSelectedRead}
                          disabled={selectedIds.length === 0}
                          className="w-full text-left px-4 py-2.5 text-sm text-foreground hover:bg-primary/5 hover:text-primary transition-all duration-100 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                          <Check size={14} />
                          Marcar seleccionadas como leídas
                        </button>
                      )}
                      {/* Bulk: mark as unread — show when selection has read items */}
                      {(allSelectedRead || hasMixedSelection) && (
                        <button
                          onClick={markSelectedUnread}
                          disabled={selectedIds.length === 0}
                          className="w-full text-left px-4 py-2.5 text-sm text-foreground hover:bg-primary/5 hover:text-primary transition-all duration-100 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                          <BookOpen size={14} />
                          Marcar seleccionadas como no leídas
                        </button>
                      )}
                      <button
                        onClick={markAllRead}
                        className="w-full text-left px-4 py-2.5 text-sm text-foreground hover:bg-primary/5 hover:text-primary transition-all duration-100 flex items-center gap-2"
                      >
                        <Check size={14} />
                        Marcar todas como leídas
                      </button>
                      <div className="border-t border-border my-1" />
                      <button
                        onClick={deleteSelected}
                        disabled={selectedIds.length === 0}
                        className="w-full text-left px-4 py-2.5 text-sm text-destructive hover:bg-destructive/5 transition-all duration-100 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        <Trash2 size={14} />
                        Eliminar seleccionadas
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Notifications list */}
          <section className="overflow-hidden rounded-lg border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:border-slate-700 dark:bg-slate-900">
            {/* Table header */}
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-slate-200 bg-slate-50/70 px-4 py-2.5 dark:border-slate-700 dark:bg-slate-800/60 md:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto_auto]">
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
                filtered.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => toggleSelect(n.id)}
                    className={`group grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3.5 transition-colors md:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto_auto] ${
                      selectedIds.includes(n.id)
                        ? 'bg-blue-50/70 shadow-[inset_2px_0_0_#2563eb] dark:bg-blue-950/30'
                        : n.read
                          ? 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                          : 'bg-blue-50/25 hover:bg-blue-50/60 dark:bg-blue-950/10 dark:hover:bg-blue-950/25'
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
                        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${n.read ? 'bg-slate-100 dark:bg-slate-800' : 'bg-blue-50 ring-1 ring-blue-100 dark:bg-blue-950/50 dark:ring-blue-900'}`}
                      >
                        {typeIcons[n.type] ?? typeIcons.info}
                      </div>
                      <div className="min-w-0">
                        <p
                          className={`flex items-center gap-2 text-sm leading-tight text-slate-800 dark:text-slate-100 ${!n.read ? 'font-700' : 'font-500'}`}
                        >
                          <span className="truncate">{n.title}</span>
                          {!n.read && (
                            <span className="h-1.5 w-1.5 flex-none rounded-full bg-primary" />
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
                          ? 'bg-blue-50 text-blue-600'
                          : n.type === 'task'
                            ? 'bg-green-50 text-green-600'
                            : n.type === 'request'
                              ? 'bg-purple-50 text-purple-600'
                              : n.type === 'alert'
                                ? 'bg-red-50 text-red-600'
                                : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {typeLabels[n.type] ?? 'Info'}
                    </span>
                    <span
                      className={`hidden whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-600 md:inline-flex ${
                        n.priority === 'alta'
                          ? 'bg-red-50 text-red-600 border border-red-200'
                          : n.priority === 'media'
                            ? 'bg-amber-50 text-amber-600 border border-amber-200'
                            : 'bg-primary/10 text-primary border border-primary/20'
                      }`}
                    >
                      {n.priority.charAt(0).toUpperCase() + n.priority.slice(1)}
                    </span>
                    <span className="hidden whitespace-nowrap text-xs text-slate-500 md:block">
                      {formatRelativeTime(n.created_at)}
                    </span>

                    {/* Ver detalle button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDetailNotif(n);
                      }}
                      className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-200 bg-white px-2.5 text-xs font-600 text-slate-600 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-primary dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-blue-950/30"
                    >
                      <Eye size={13} />
                      <span className="hidden sm:inline">Ver detalle</span>
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 dark:border-slate-700">
              <p className="text-xs text-slate-500">
                {filtered.length} notificación{filtered.length !== 1 ? 'es' : ''}
              </p>
              <button
                onClick={markAllRead}
                disabled={unreadCount === 0}
                className="text-xs font-600 text-primary transition-colors hover:text-primary/80 disabled:cursor-not-allowed disabled:text-slate-400"
              >
                Marcar todas como leídas
              </button>
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
          onDelete={deleteOne}
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
