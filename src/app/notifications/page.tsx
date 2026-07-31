'use client';

import React, { Suspense, useState, useRef, useEffect, useCallback } from 'react';
import AppLayout from '@/components/AppLayout';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Search, ChevronDown, FileText, CheckSquare, Send, AlertTriangle, Info,
  Check, Trash2, RefreshCw, X, Eye, BookOpen, ExternalLink
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
    return new Date(dateStr).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function formatFullDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('es-MX', {
      day: 'numeric', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
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

function NotificationDetailModal({ notification: n, onClose, onMarkRead, onMarkUnread, onDelete }: DetailModalProps) {
  const router = useRouter();

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${n.read ? 'bg-muted' : 'bg-primary/10'}`}>
              {typeIcons[n.type] ?? typeIcons.info}
            </div>
            <div>
              <h2 className="text-base font-700 text-foreground leading-tight">{n.title}</h2>
              {!n.read && (
                <span className="inline-flex items-center gap-1 text-xs text-primary font-500 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
                  No leída
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* Meta row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-muted/40 rounded-xl p-3">
              <p className="text-xs text-muted-foreground font-500 mb-1">Tipo de notificación</p>
              <span className={`inline-flex items-center gap-1.5 text-xs font-600 px-2 py-0.5 rounded-full ${typeColorCls[n.type] ?? typeColorCls.info}`}>
                {typeIcons[n.type]}
                {typeLabels[n.type] ?? 'Info'}
              </span>
            </div>
            <div className="bg-muted/40 rounded-xl p-3">
              <p className="text-xs text-muted-foreground font-500 mb-1">Prioridad</p>
              <span className={`inline-flex text-xs font-600 px-2 py-0.5 rounded-full ${priorityConfig[n.priority]?.cls ?? ''}`}>
                {priorityConfig[n.priority]?.label ?? n.priority}
              </span>
            </div>
          </div>

          {/* Description */}
          <div className="bg-muted/40 rounded-xl p-4">
            <p className="text-xs text-muted-foreground font-500 mb-1.5">Detalle de la notificación</p>
            <p className="text-sm text-foreground leading-relaxed">{n.description}</p>
          </div>

          {/* Date */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Info size={14} className="flex-shrink-0" />
            <span>
              <span className="font-500 text-foreground">Fecha de creación:</span>{' '}
              {formatRelativeTime(n.created_at)}
              <span className="text-xs ml-1 text-muted-foreground/70">({formatFullDate(n.created_at)})</span>
            </span>
          </div>
        </div>

        {/* Actions footer */}
        <div className="px-6 pb-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
          {/* Contextual action */}
          <button
            onClick={handleContextualAction}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-600 rounded-lg hover:bg-primary/90 transition-colors"
          >
            <ExternalLink size={14} />
            {contextualActionLabel()}
          </button>

          {/* Mark read / unread */}
          {n.read ? (
            <button
              onClick={async () => { await onMarkUnread(n.id); onClose(); }}
              className="flex items-center gap-2 px-4 py-2 border border-border text-sm font-500 rounded-lg text-foreground hover:bg-muted transition-colors"
            >
              <BookOpen size={14} />
              Marcar como no leída
            </button>
          ) : (
            <button
              onClick={async () => { await onMarkRead(n.id); onClose(); }}
              className="flex items-center gap-2 px-4 py-2 border border-border text-sm font-500 rounded-lg text-foreground hover:bg-muted transition-colors"
            >
              <Check size={14} />
              Marcar como leída
            </button>
          )}

          {/* Delete */}
          <button
            onClick={async () => { await onDelete(n.id); onClose(); }}
            className="flex items-center gap-2 px-4 py-2 border border-destructive/30 text-sm font-500 rounded-lg text-destructive hover:bg-destructive/5 transition-colors ml-auto"
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, () => {
        loadNotifications();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, loadNotifications]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (typeRef.current && !typeRef.current.contains(e.target as Node)) setTypeOpen(false);
      if (priorityRef.current && !priorityRef.current.contains(e.target as Node)) setPriorityOpen(false);
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) setActionsOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = notifications.filter((n) => {
    if (tab === 'unread' && n.read) return false;
    if (tab === 'read' && !n.read) return false;
    if (typeFilter !== 'todos' && n.type !== typeFilter) return false;
    if (priorityFilter !== 'todas' && n.priority !== priorityFilter) return false;
    if (search && !n.title.toLowerCase().includes(search.toLowerCase()) && !n.description.toLowerCase().includes(search.toLowerCase())) return false;
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
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]);
  };

  // ── Single notification actions ──
  const markOneRead = async (id: string) => {
    const supabase = createClient();
    await supabase.from('notifications').update({ read: true }).eq('id', id);
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
    // Update detail modal if open
    setDetailNotif((prev) => prev?.id === id ? { ...prev, read: true } : prev);
  };

  const markOneUnread = async (id: string) => {
    const supabase = createClient();
    await supabase.from('notifications').update({ read: false }).eq('id', id);
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: false } : n));
    setDetailNotif((prev) => prev?.id === id ? { ...prev, read: false } : prev);
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
    setNotifications((prev) => prev.map((n) => selectedIds.includes(n.id) ? { ...n, read: true } : n));
    setSelectedIds([]);
    setActionsOpen(false);
  };

  const markSelectedUnread = async () => {
    if (!selectedIds.length) return;
    const supabase = createClient();
    await supabase.from('notifications').update({ read: false }).in('id', selectedIds);
    setNotifications((prev) => prev.map((n) => selectedIds.includes(n.id) ? { ...n, read: false } : n));
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
    await supabase.from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setActionsOpen(false);
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <AppLayout noPadding>
      <div className="px-4 sm:px-6 lg:px-8 pt-2 pb-4 md:pb-6 w-full min-h-[calc(100vh-8rem)]">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Info size={24} className="text-primary" />
              Notificaciones
              {unreadCount > 0 && (
                <span className="ml-1 bg-primary text-white text-xs font-700 px-2 py-0.5 rounded-full tabular-nums">
                  {unreadCount}
                </span>
              )}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Tu centro de alertas para documentos, seguridad y sistema.</p>
          </div>
          <button
            onClick={loadNotifications}
            className="flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-all duration-150"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Actualizar
          </button>
        </div>

        {/* Card container */}
        <div className="bg-white border border-border rounded-xl overflow-hidden">
          {/* Search + Filters row */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
            <div className="flex-1 flex items-center gap-2 border border-border rounded-lg px-3 py-2 bg-white focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10 transition-all duration-150">
              <Search size={15} className="text-muted-foreground flex-shrink-0" />
              <input
                type="text"
                placeholder="Buscar por palabra clave..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 text-sm outline-none text-foreground placeholder-muted-foreground bg-transparent"
              />
            </div>

            {/* Type dropdown */}
            <div className="relative" ref={typeRef}>
              <button
                onClick={() => { setTypeOpen(!typeOpen); setPriorityOpen(false); }}
                className="flex items-center gap-2 border border-border rounded-lg px-3 py-2 text-sm text-foreground bg-white hover:bg-primary/5 hover:border-primary/30 hover:text-primary whitespace-nowrap transition-all duration-150"
              >
                {typeFilter === 'todos' ? 'Todos los tipos' : typeLabels[typeFilter]}
                <ChevronDown size={14} className="text-muted-foreground" />
              </button>
              {typeOpen && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-border rounded-xl shadow-lg z-20 min-w-[160px] overflow-hidden">
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
                      onClick={() => { setTypeFilter(opt.value); setTypeOpen(false); }}
                      className={`w-full text-left px-4 py-2.5 text-sm hover:bg-primary/5 hover:text-primary transition-all duration-100 ${typeFilter === opt.value ? 'text-primary font-600 bg-primary/5' : 'text-foreground'}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Priority dropdown */}
            <div className="relative" ref={priorityRef}>
              <button
                onClick={() => { setPriorityOpen(!priorityOpen); setTypeOpen(false); }}
                className="flex items-center gap-2 border border-border rounded-lg px-3 py-2 text-sm text-foreground bg-white hover:bg-primary/5 hover:border-primary/30 hover:text-primary whitespace-nowrap transition-all duration-150"
              >
                {priorityFilter === 'todas' ? 'Todas las prioridades' : priorityFilter.charAt(0).toUpperCase() + priorityFilter.slice(1)}
                <ChevronDown size={14} className="text-muted-foreground" />
              </button>
              {priorityOpen && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-border rounded-xl shadow-lg z-20 min-w-[180px] overflow-hidden">
                  {[
                    { value: 'todas', label: 'Todas las prioridades' },
                    { value: 'alta', label: 'Alta' },
                    { value: 'media', label: 'Media' },
                    { value: 'baja', label: 'Baja' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => { setPriorityFilter(opt.value); setPriorityOpen(false); }}
                      className={`w-full text-left px-4 py-2.5 text-sm hover:bg-primary/5 hover:text-primary transition-all duration-100 ${priorityFilter === opt.value ? 'text-primary font-600 bg-primary/5' : 'text-foreground'}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Tabs + Actions row */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
            <div className="flex items-center gap-1">
              {[
                { key: 'all', label: 'Todas' },
                { key: 'unread', label: 'No Leídas' },
                { key: 'read', label: 'Leídas' },
              ].map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key as 'all' | 'unread' | 'read')}
                  className={`px-3 py-1.5 rounded-lg text-sm font-500 transition-all duration-150 ${
                    tab === t.key ? 'bg-primary text-white shadow-sm' : 'text-muted-foreground hover:bg-primary/5 hover:text-primary'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Actions dropdown */}
            <div className="flex items-center gap-2">
              {selectedIds.length > 0 && (
                <span className="text-xs text-primary font-600 bg-primary/10 px-2 py-0.5 rounded-full">
                  {selectedIds.length} seleccionadas
                </span>
              )}
              <div className="relative" ref={actionsRef}>
                <button
                  onClick={() => setActionsOpen(!actionsOpen)}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-sm text-foreground bg-white hover:bg-primary/5 hover:border-primary/30 hover:text-primary transition-all duration-150"
                >
                  Acciones
                  <ChevronDown size={13} className="text-muted-foreground" />
                </button>
                {actionsOpen && (
                  <div className="absolute right-0 top-full mt-1 bg-white border border-border rounded-xl shadow-lg z-20 min-w-[220px] overflow-hidden">
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

          {/* Table header */}
          <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] items-center gap-3 px-4 py-2 border-b border-border bg-muted/20">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              className="w-4 h-4 rounded border-border accent-primary cursor-pointer"
            />
            <span className="text-xs font-600 uppercase tracking-wide text-muted-foreground">Notificación</span>
            <span className="text-xs font-600 uppercase tracking-wide text-muted-foreground">Tipo</span>
            <span className="text-xs font-600 uppercase tracking-wide text-muted-foreground">Prioridad</span>
            <span className="text-xs font-600 uppercase tracking-wide text-muted-foreground">Tiempo</span>
            <span className="text-xs font-600 uppercase tracking-wide text-muted-foreground">Acción</span>
          </div>

          {/* Notification rows */}
          <div className="divide-y divide-border">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <svg className="animate-spin h-6 w-6 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <p className="text-sm text-muted-foreground">Cargando notificaciones...</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Info size={36} className="text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">
                  {notifications.length === 0
                    ? 'No tienes notificaciones aún.'
                    : 'No hay notificaciones que coincidan con los filtros.'}
                </p>
              </div>
            ) : (
              filtered.map((n) => (
                <div
                  key={n.id}
                  onClick={() => toggleSelect(n.id)}
                  className={`grid grid-cols-[auto_1fr_auto_auto_auto_auto] items-center gap-3 px-4 py-3.5 cursor-pointer transition-all duration-150 group ${
                    selectedIds.includes(n.id)
                      ? 'bg-primary/5 border-l-2 border-l-primary'
                      : n.read
                      ? 'hover:bg-muted/40' :'bg-primary/[0.02] hover:bg-primary/5'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(n.id)}
                    onChange={() => toggleSelect(n.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-4 h-4 rounded border-border accent-primary cursor-pointer"
                  />
                  <div className="flex items-start gap-3 min-w-0">
                    {!n.read && <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-1.5" />}
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${n.read ? 'bg-muted' : 'bg-primary/10'}`}>
                      {typeIcons[n.type] ?? typeIcons.info}
                    </div>
                    <div className="min-w-0">
                      <p className={`text-sm leading-tight ${!n.read ? 'font-600 text-foreground' : 'font-500 text-foreground'} group-hover:text-primary transition-colors duration-150`}>
                        {n.title}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{n.description}</p>
                    </div>
                  </div>
                  <span className={`text-xs font-500 px-2 py-0.5 rounded-full whitespace-nowrap ${
                    n.type === 'document' ? 'bg-blue-50 text-blue-600' :
                    n.type === 'task' ? 'bg-green-50 text-green-600' :
                    n.type === 'request' ? 'bg-purple-50 text-purple-600' :
                    n.type === 'alert' ? 'bg-red-50 text-red-600' : 'bg-muted text-muted-foreground'
                  }`}>
                    {typeLabels[n.type] ?? 'Info'}
                  </span>
                  <span className={`text-xs font-600 px-2 py-0.5 rounded-full whitespace-nowrap ${
                    n.priority === 'alta' ? 'bg-red-50 text-red-600 border border-red-200' :
                    n.priority === 'media' ? 'bg-amber-50 text-amber-600 border border-amber-200' : 'bg-primary/10 text-primary border border-primary/20'
                  }`}>
                    {n.priority.charAt(0).toUpperCase() + n.priority.slice(1)}
                  </span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{formatRelativeTime(n.created_at)}</span>

                  {/* Ver detalle button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDetailNotif(n);
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-500 text-primary border border-primary/30 rounded-lg bg-primary/5 hover:bg-primary hover:text-white transition-all duration-150 whitespace-nowrap"
                  >
                    <Eye size={12} />
                    Ver detalle
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-border flex items-center justify-between">
            <p className="text-xs text-muted-foreground">{filtered.length} notificación{filtered.length !== 1 ? 'es' : ''}</p>
            <button
              onClick={markAllRead}
              className="text-xs font-500 text-primary hover:text-primary-700 hover:underline transition-colors duration-150"
            >
              Marcar todas como leídas
            </button>
          </div>
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
