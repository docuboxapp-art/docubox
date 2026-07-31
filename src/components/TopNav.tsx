'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRouter } from 'next/navigation';
import AppLogo from '@/components/ui/AppLogo';
import { Bell, ChevronDown, User, Home, FileText, Send, CheckSquare, Users, BarChart3, UserCircle, Store, Settings, CreditCard, LogOut, Menu, X, Check, Building2, UserPlus, Search, Loader2, PanelLeft, Maximize2, Minimize2, Sun, Moon, LayoutDashboard, FolderOpen, BookUser, BarChart2, HelpCircle, FileSignature, PenTool, ClipboardList, MoreVertical, Eye, Trash2, Info, ExternalLink, AlertTriangle, Sparkles } from 'lucide-react';
import { useWorkspace, type Workspace } from '@/contexts/WorkspaceContext';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useSidebar } from '@/contexts/SidebarContext';
import { useAppModules } from '@/contexts/AppModulesContext';
import LucIAChat from '@/components/LucIAChat';

const BASE_NAV_TABS = [
  { href: '/documents-dashboard', label: 'Inicio', icon: Home },
  { href: '/mis-documentos', label: 'Mis Documentos', icon: FileText },
  { href: '/participation-requests', label: 'Solicitudes Enviadas', icon: Send },
  { href: '/mis-participaciones', label: 'Mis Participaciones', icon: FileSignature },
  { href: '/pending-tasks', label: 'Tareas Pendientes', icon: CheckSquare },
  { href: '/contactos', label: 'Mis Contactos', icon: Users },
  // plantillas and formularios injected conditionally
  { href: '/reportes', label: 'Reportes', icon: BarChart3 },
];

const avatarMenuItems = [
  { icon: UserCircle, label: 'Mi perfil', href: '/mi-perfil' },
  { icon: Store, label: 'App Market', href: '/app-market' },
  { icon: Settings, label: 'Configuración', href: '/configuracion' },
  { icon: CreditCard, label: 'Plan y Facturación', href: '/facturacion' },
];

const BASE_SIDEBAR_NAV_SECTIONS = [
  {
    label: 'Principal',
    items: [
      { href: '/documents-dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { href: '/mis-documentos', icon: FolderOpen, label: 'Mis Documentos' },
      { href: '/pending-tasks', icon: CheckSquare, label: 'Tareas Pendientes' },
    ],
  },
  {
    label: 'Contactos',
    items: [
      { href: '/contactos', icon: BookUser, label: 'Mis Contactos' },
    ],
  },
  {
    label: 'Gestión',
    items: [
      { href: '/participation-requests', icon: Send, label: 'Solicitudes Enviadas' },
      { href: '/mis-participaciones', icon: FileSignature, label: 'Mis Participaciones' },
      // plantillas and formularios injected conditionally
    ],
  },
  {
    label: 'Sistema',
    items: [
      { href: '/reportes', icon: BarChart2, label: 'Reportes' },
      { href: '/facturacion', icon: CreditCard, label: 'Planes y Facturación' },
      { href: '/app-market', icon: Store, label: 'App Market' },
      { href: '/configuracion', icon: Settings, label: 'Configuración' },
    ],
  },
];

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
    return new Date(dateStr).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  } catch {
    return dateStr;
  }
}

export default function TopNav() {
  const pathname = usePathname();
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [notifications, setNotifications] = useState<Array<{
    id: string | number;
    title: string;
    description: string;
    time: string;
    read: boolean;
    type?: string;
  }>>([]);

  // Notification interaction states
  const [selectedNotifIds, setSelectedNotifIds] = useState<Set<string | number>>(new Set());
  const [contextMenuId, setContextMenuId] = useState<string | number | null>(null);
  const [detailNotif, setDetailNotif] = useState<{
    id: string | number;
    title: string;
    description: string;
    time: string;
    read: boolean;
    type?: string;
    created_at?: string;
    priority?: string;
    metadata?: Record<string, unknown> | null;
  } | null>(null);

  // New feature states
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const [luciaOpen, setLuciaOpen] = useState(false);

  // Sidebar state from shared context
  const { sidebarOpen, setSidebarOpen } = useSidebar();

  // Join company modal state
  const [joinModalOpen, setJoinModalOpen] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinSuccess, setJoinSuccess] = useState(false);
  const [joinError, setJoinError] = useState('');

  const avatarRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { workspaces, activeWorkspace, loading: wsLoading, setActiveWorkspace, refreshWorkspaces } = useWorkspace();
  const { user, signOut } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const { isModuleActive, loading: modulesLoading } = useAppModules();
  const router = useRouter();

  // Derive display name and initials from real user
  const userFullName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Usuario';
  const userEmail = user?.email || '';
  const userInitials = userFullName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n: string) => n[0].toUpperCase())
    .join('');

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAllRead = async () => {
    if (!user) return;
    const supabase = createClient();
    await supabase.from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const markSelectedRead = async () => {
    if (!user || selectedNotifIds.size === 0) return;
    const supabase = createClient();
    const ids = Array.from(selectedNotifIds);
    await supabase.from('notifications').update({ read: true }).in('id', ids).eq('user_id', user.id);
    setNotifications((prev) => prev.map((n) => selectedNotifIds.has(n.id) ? { ...n, read: true } : n));
    setSelectedNotifIds(new Set());
  };

  const markOneRead = async (id: string | number) => {
    if (!user) return;
    const supabase = createClient();
    await supabase.from('notifications').update({ read: true }).eq('id', id).eq('user_id', user.id);
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
    setDetailNotif((prev) => prev && prev.id === id ? { ...prev, read: true } : prev);
    setContextMenuId(null);
  };

  const deleteNotification = async (id: string | number) => {
    if (!user) return;
    const supabase = createClient();
    await supabase.from('notifications').delete().eq('id', id).eq('user_id', user.id);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    setSelectedNotifIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    setContextMenuId(null);
  };

  const toggleSelectNotif = (id: string | number) => {
    setSelectedNotifIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Theme toggle — removed local useEffect, now handled by ThemeContext

  // Expand screen toggle
  useEffect(() => {
    if (isExpanded) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
    }
  }, [isExpanded]);

  // Focus search input when modal opens
  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [searchOpen]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) {
        setAvatarOpen(false);
      }
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false);
        setContextMenuId(null);
        setSelectedNotifIds(new Set());
      }
      if (workspaceRef.current && !workspaceRef.current.contains(e.target as Node)) {
        setWorkspaceOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Close search on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setSearchOpen(false);
        setSidebarOpen(false);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const getTabActive = (href: string) => {
    const base = href.split('?')[0];
    if (base === '/documents-dashboard' && !href.includes('?')) {
      return pathname === '/documents-dashboard';
    }
    return pathname === base;
  };

  const handleSelectWorkspace = (ws: Workspace) => {
    setActiveWorkspace(ws);
    setWorkspaceOpen(false);
  };

  const isPersonal = activeWorkspace?.workspaceType === 'personal';
  const displayName = wsLoading
    ? 'Cargando...'
    : isPersonal
      ? 'Espacio personal' : activeWorkspace?.name ?? 'Espacio Personal';

  // Open join modal
  const handleOpenJoinModal = () => {
    setWorkspaceOpen(false);
    setInviteCode('');
    setJoinError('');
    setJoinSuccess(false);
    setJoinLoading(false);
    setJoinModalOpen(true);
  };

  // Join workspace by invite code or name
  const handleJoinWorkspace = async () => {
    if (!inviteCode.trim()) return;
    setJoinLoading(true);
    setJoinError('');
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) throw new Error('No autenticado');

      // Search workspace by invite_code or name
      const { data: wsData, error: wsError } = await supabase
        .from('workspaces')
        .select('id, name')
        .or(`invite_code.eq.${inviteCode.trim()},name.ilike.${inviteCode.trim()}`)
        .eq('workspace_type', 'business')
        .limit(1)
        .single();

      if (wsError || !wsData) {
        setJoinError('No se encontró ningún espacio con ese código o nombre.');
        setJoinLoading(false);
        return;
      }

      // Check if already a member
      const { data: existing } = await supabase
        .from('workspace_members')
        .select('id')
        .eq('workspace_id', wsData.id)
        .eq('user_id', currentUser.id)
        .single();

      if (existing) {
        setJoinError('Ya eres miembro de este espacio de trabajo.');
        setJoinLoading(false);
        return;
      }

      const { error: insertError } = await supabase
        .from('workspace_members')
        .insert({ workspace_id: wsData.id, user_id: currentUser.id, role: 'member' });

      if (insertError) throw insertError;

      setJoinSuccess(true);
      await refreshWorkspaces();
    } catch (err: any) {
      setJoinError('Error al unirse. Intenta de nuevo.');
    } finally {
      setJoinLoading(false);
    }
  };

  // Load real notifications from Supabase
  useEffect(() => {
    if (!user) return;
    const supabase = createClient();

    const loadNotifications = async () => {
      const { data } = await supabase
        .from('notifications')
        .select('id, title, description, created_at, read, type, priority, metadata')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);
      if (data) {
        setNotifications(
          data.map((n: any) => ({
            id: n.id,
            title: n.title,
            description: n.description,
            time: formatRelativeTime(n.created_at),
            read: n.read,
            type: n.type,
            created_at: n.created_at,
            priority: n.priority,
            metadata: n.metadata,
          }))
        );
      }
    };

    loadNotifications();

    // Realtime subscription for new notifications
    const channel = supabase
      .channel('topnav-notifications')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        () => { loadNotifications(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  // Build dynamic nav tabs based on active modules
  const navTabs = [
    ...BASE_NAV_TABS.slice(0, 6), // up to Mis Contactos
    ...(isModuleActive('plantillas') ? [{ href: '/plantillas', label: 'Plantillas', icon: PenTool }] : []),
    ...(isModuleActive('formularios') ? [{ href: '/formularios', label: 'Formularios', icon: ClipboardList }] : []),
    ...BASE_NAV_TABS.slice(6), // Reportes and beyond
  ];

  // Build dynamic sidebar nav sections based on active modules
  const sidebarNavSections = BASE_SIDEBAR_NAV_SECTIONS.map((section) => {
    if (section.label !== 'Gestión') return section;
    const moduleItems: typeof section.items = [];
    if (isModuleActive('plantillas')) {
      moduleItems.push({ href: '/plantillas', icon: PenTool, label: 'Plantillas' });
    }
    if (isModuleActive('formularios')) {
      moduleItems.push({ href: '/formularios', icon: ClipboardList, label: 'Formularios' });
    }
    return { ...section, items: [...section.items, ...moduleItems] };
  });

  return (
    <>
      {/* TopNav header — primary bar always visible; secondary nav bar hidden when sidebar is open */}
      <header className={`fixed top-0 left-0 right-0 z-30 bg-background shadow-sm flex-shrink-0`}>
        {/* ── Primary top bar ── h-16, px-4 — ALWAYS VISIBLE */}
        <div className={`flex items-center h-16 px-4 ${!sidebarOpen ? 'border-b border-border/60' : 'border-b border-border'}`}>
          {/* Left section: hamburger (mobile) + logo + workspace */}
          <div className="flex items-center gap-6">
            {/* Hamburger — mobile only */}
            <button
              className="md:hidden w-10 h-10 rounded-md flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-primary transition-all duration-150"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Abrir menú"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>

            {/* Logo */}
            <Link href="/documents-dashboard" className="flex items-center gap-2 flex-shrink-0">
              <AppLogo size={32} className="h-8 w-auto object-contain" />
            </Link>

            {/* Workspace selector — hidden on mobile */}
            <div ref={workspaceRef} className="relative hidden md:block">
              <button
                onClick={() => setWorkspaceOpen(!workspaceOpen)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border bg-background hover:bg-muted/40 transition-colors text-sm w-80"
              >
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  {isPersonal
                    ? <User size={12} className="text-primary" />
                    : <Building2 size={12} className="text-primary" />
                  }
                </div>
                <div className="text-left flex-1 min-w-0">
                  <p className="text-[10px] font-600 uppercase tracking-widest text-muted-foreground leading-none mb-0.5">
                    Espacio de Trabajo
                  </p>
                  <p className="text-xs font-600 text-foreground truncate">{isPersonal ? 'Espacio personal' : displayName}</p>
                </div>
                <ChevronDown
                  size={12}
                  className={`text-muted-foreground flex-shrink-0 transition-transform duration-150 ${workspaceOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {workspaceOpen && (
                <div className="absolute left-0 top-12 w-80 bg-background border border-border rounded-xl shadow-lg z-50 overflow-hidden">
                  <div className="px-4 py-3 border-b border-border">
                    <p className="text-xs font-600 uppercase tracking-widest text-muted-foreground">
                      Cambiar Espacio
                    </p>
                  </div>

                  <div className="py-1">
                    {workspaces.length === 0 && !wsLoading && (
                      <div className="px-4 py-3 text-sm text-muted-foreground">
                        No hay espacios disponibles
                      </div>
                    )}

                    {workspaces.map((ws) => {
                      const isActive = activeWorkspace?.id === ws.id;
                      const isWsPersonal = ws.workspaceType === 'personal';
                      return (
                        <button
                          key={ws.id}
                          onClick={() => handleSelectWorkspace(ws)}
                          className={`flex items-center gap-3 w-full px-4 py-2.5 transition-all duration-150 group ${
                            isActive
                              ? 'bg-primary/10 hover:bg-primary/15' : 'hover:bg-primary/5'
                          }`}
                        >
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                            isActive ? 'bg-primary/20' : 'bg-primary/10'
                          }`}>
                            {isWsPersonal
                              ? <User size={14} className="text-primary" />
                              : <Building2 size={14} className="text-primary" />
                            }
                          </div>
                          <div className="flex-1 text-left min-w-0">
                            <p className={`text-sm truncate ${isActive ? 'font-600 text-primary' : 'font-500 text-foreground'}`}>
                              {ws.name}
                            </p>
                            {!isWsPersonal && (
                              <p className="text-[11px] text-muted-foreground capitalize">{ws.role}</p>
                            )}
                            {isWsPersonal && isActive && (
                              <p className="text-[11px] text-primary/70">Activo</p>
                            )}
                          </div>
                          {isActive && (
                            <Check size={14} className="text-primary flex-shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  <div className="border-t border-border py-1">
                    <button
                      onClick={handleOpenJoinModal}
                      className="flex items-center gap-3 w-full px-4 py-2.5 hover:bg-primary/5 transition-all duration-150 group text-sm text-foreground"
                    >
                      <div className="w-8 h-8 rounded-full border-2 border-dashed border-border flex items-center justify-center flex-shrink-0 group-hover:border-primary transition-colors">
                        <UserPlus size={14} className="text-muted-foreground group-hover:text-primary transition-colors" />
                      </div>
                      <span className="font-500 group-hover:text-primary transition-colors">
                        Unirse a espacio de trabajo
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Right section — action icons */}
          <div className="flex items-center gap-2">

            {/* LucIA Button — only visible when lucia module is active */}
            {user && !modulesLoading && isModuleActive('lucia') && (
              <button
                title="Pregúntale a LucIA"
                onClick={() => setLuciaOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/20 dark:hover:bg-blue-900/40 text-blue-600 dark:text-blue-400 text-sm font-medium transition-all duration-150 flex-shrink-0 border border-blue-100 dark:border-blue-800"
              >
                <Sparkles className="h-4 w-4" />
                <span className="hidden sm:inline">Pregúntale a LucIA</span>
              </button>
            )}

            {/* 1. Buscar */}
            <button
              title="Buscar"
              onClick={() => setSearchOpen(true)}
              className="w-10 h-10 rounded-md flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-primary transition-all duration-150 flex-shrink-0"
            >
              <Search className="h-5 w-5" />
            </button>

            {/* 2. Menú lateral */}
            <button
              title={sidebarOpen ? 'Cerrar menú lateral' : 'Abrir menú lateral'}
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className={`w-10 h-10 rounded-md flex items-center justify-center transition-all duration-150 flex-shrink-0 ${sidebarOpen ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-primary/10 hover:text-primary'}`}
            >
              <PanelLeft className="h-5 w-5" />
            </button>

            {/* 3. Expandir pantalla */}
            <button
              title={isExpanded ? 'Restaurar pantalla' : 'Expandir pantalla'}
              onClick={() => setIsExpanded(!isExpanded)}
              className="w-10 h-10 rounded-md flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-primary transition-all duration-150 flex-shrink-0"
            >
              {isExpanded ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
            </button>

            {/* 4. Vista claro/oscuro */}
            <button
              title={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
              onClick={toggleTheme}
              className="w-10 h-10 rounded-md flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-primary transition-all duration-150 flex-shrink-0"
            >
              {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>

            {/* 5. Notificaciones */}
            <div ref={bellRef} className="relative flex-shrink-0">
              <button
                title="Notificaciones"
                onClick={() => { setBellOpen(!bellOpen); setAvatarOpen(false); }}
                className="w-10 h-10 rounded-md flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-primary transition-all duration-150 relative"
              >
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 h-4 min-w-[1rem] px-0.5 bg-primary rounded-full flex items-center justify-center">
                    <span className="text-white text-[9px] font-700 leading-none">{unreadCount}</span>
                  </span>
                )}
              </button>

              {bellOpen && (
                <div className="absolute right-0 top-12 w-80 bg-background border border-border rounded-xl shadow-lg z-50 overflow-hidden">
                  {/* REMOVED: inline detail overlay — now handled by standalone modal below */}

                  <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <span className="text-base font-700 text-foreground">Notificaciones</span>
                    {selectedNotifIds.size > 0 ? (
                      <button
                        onClick={markSelectedRead}
                        className="text-sm font-500 text-primary hover:text-primary-700 hover:underline transition-colors duration-150"
                      >
                        Marcar como leídos
                      </button>
                    ) : null}
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {notifications.length === 0 && (
                      <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                        No hay notificaciones
                      </div>
                    )}
                    {notifications.map((n) => (
                      <div
                        key={n.id}
                        className={`relative flex items-start gap-2 px-3 py-3 transition-all duration-150 border-b border-border/50 last:border-0 group ${
                          selectedNotifIds.has(n.id) ? 'bg-primary/10' : !n.read ? 'bg-primary/[0.02] hover:bg-primary/5' : 'hover:bg-muted/40'
                        }`}
                      >
                        {/* Checkbox */}
                        <div className="flex-shrink-0 mt-1 flex items-center">
                          <input
                            type="checkbox"
                            checked={selectedNotifIds.has(n.id)}
                            onChange={() => toggleSelectNotif(n.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="w-4 h-4 rounded border-border accent-primary cursor-pointer"
                          />
                        </div>

                        {/* Icon */}
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <FileText size={14} className="text-primary" />
                        </div>

                        {/* Content — clickable to open standalone detail modal */}
                        <div
                          className="flex-1 min-w-0 cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            setContextMenuId(null);
                            setBellOpen(false);
                            setDetailNotif(n as any);
                          }}
                        >
                          <p className={`text-sm ${!n.read ? 'font-600 text-foreground' : 'font-500 text-foreground'}`}>{n.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">{n.description}</p>
                          <p className="text-[11px] text-muted-foreground mt-1">{n.time}</p>
                        </div>

                        {/* Context menu trigger */}
                        <div className="flex-shrink-0 relative">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setContextMenuId(contextMenuId === n.id ? null : n.id);
                            }}
                            className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
                          >
                            <MoreVertical size={14} />
                          </button>

                          {contextMenuId === n.id && (
                            <div className="absolute right-0 top-8 w-44 bg-background border border-border rounded-lg shadow-lg z-50 py-1 overflow-hidden">
                              <button
                                onClick={(e) => { e.stopPropagation(); setContextMenuId(null); setBellOpen(false); setDetailNotif(n as any); }}
                                className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-primary/5 hover:text-primary transition-colors w-full text-left"
                              >
                                <Eye size={14} className="flex-shrink-0" />
                                Ver detalle
                              </button>
                              {!n.read && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); markOneRead(n.id); }}
                                  className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-primary/5 hover:text-primary transition-colors w-full text-left"
                                >
                                  <Check size={14} className="flex-shrink-0" />
                                  Marcar como leído
                                </button>
                              )}
                              <button
                                onClick={(e) => { e.stopPropagation(); deleteNotification(n.id); }}
                                className="flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/5 transition-colors w-full text-left"
                              >
                                <Trash2 size={14} className="flex-shrink-0" />
                                Eliminar
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-border">
                    <Link
                      href="/notifications"
                      onClick={() => setBellOpen(false)}
                      className="flex items-center justify-center w-full py-3 text-sm font-500 text-primary hover:bg-primary/5 hover:text-primary-700 transition-all duration-150"
                    >
                      Ver todas las notificaciones
                    </Link>
                  </div>
                </div>
              )}
            </div>

            {/* 6. Gravatar — solo iniciales, sin nombre */}
            <div ref={avatarRef} className="relative flex-shrink-0">
              <button
                onClick={() => { setAvatarOpen(!avatarOpen); setBellOpen(false); }}
                className="flex items-center gap-2 rounded-full hover:bg-accent/50 px-2 py-1 transition-all duration-150"
                title="Mi cuenta"
              >
                <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-xs font-700">{userInitials || 'U'}</span>
                </div>
              </button>

              {avatarOpen && (
                <div className="absolute right-0 top-12 w-52 bg-background border border-border rounded-xl shadow-lg z-50 overflow-hidden py-1">
                  <div className="px-4 py-3 border-b border-border">
                    <p className="text-sm font-600 text-foreground truncate">{userFullName}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{userEmail}</p>
                  </div>
                  <div className="py-1">
                    {avatarMenuItems.map((item) => (
                      <Link
                        key={item.label}
                        href={item.href}
                        onClick={() => setAvatarOpen(false)}
                        className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-primary/5 hover:text-primary transition-all duration-150 group"
                      >
                        <item.icon size={15} className="text-muted-foreground group-hover:text-primary flex-shrink-0 transition-colors duration-150" />
                        {item.label}
                      </Link>
                    ))}
                  </div>
                  <div className="border-t border-border py-1">
                    <button
                      onClick={async () => { setAvatarOpen(false); await signOut(); }}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-destructive hover:bg-destructive/5 transition-all duration-150 w-full"
                    >
                      <LogOut size={15} className="flex-shrink-0" />
                      Cerrar sesión
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Secondary navigation bar ── desktop only — only rendered when sidebar is closed */}
        {!sidebarOpen && (
          <div className="hidden md:flex items-center h-10 px-4 gap-0 overflow-x-auto scrollbar-none bg-primary">
            {navTabs.map((tab) => {
              const isActive = getTabActive(tab.href);
              const TabIcon = tab.icon;
              return (
                <Link
                  key={tab.label}
                  href={tab.href}
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-500 whitespace-nowrap transition-all duration-150 relative h-10 ${
                    isActive
                      ? 'text-white font-600 bg-white/20' : 'text-white/80 hover:text-white hover:bg-white/10'
                  }`}
                >
                  <TabIcon className="h-4 w-4 flex-shrink-0" />
                  {tab.label}
                </Link>
              );
            })}
          </div>
        )}
      </header>

      {/* ── Search Modal ── */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/40 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setSearchOpen(false); }}
        >
          <div className="bg-background rounded-2xl shadow-xl w-full max-w-xl mx-4 overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
              <Search size={18} className="text-muted-foreground flex-shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar documentos, contactos, tareas..."
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
              <button
                onClick={() => setSearchOpen(false)}
                className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted/60 transition-colors"
              >
                <X size={15} />
              </button>
            </div>
            <div className="px-4 py-6 text-center">
              {searchQuery.trim() === '' ? (
                <div className="text-sm text-muted-foreground">
                  <Search size={32} className="mx-auto mb-3 opacity-30" />
                  <p>Escribe para buscar en toda la aplicación</p>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  <Loader2 size={24} className="mx-auto mb-3 animate-spin opacity-50" />
                  <p>Buscando "<span className="font-600 text-foreground">{searchQuery}</span>"...</p>
                </div>
              )}
            </div>
            <div className="px-4 py-2 border-t border-border flex items-center gap-4 text-[11px] text-muted-foreground">
              <span><kbd className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono">Esc</kbd> para cerrar</span>
              <span><kbd className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono">Enter</kbd> para buscar</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Lateral Sidebar — push layout, fixed left, below top bar ── */}
      <aside
        className={`fixed top-16 left-0 z-40 h-[calc(100vh-4rem)] w-72 bg-background border-r border-border shadow-xl flex flex-col transition-transform duration-300 ease-in-out ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
          {/* Nav */}
          <nav className="flex-1 overflow-y-auto py-3 px-2">
            {sidebarNavSections.map((section) => {
              const sectionItems = section.items.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    className={`flex items-center gap-3 px-2 py-2 rounded-lg mb-0.5 transition-all duration-150 group ${
                      isActive
                        ? 'bg-primary/10 text-primary font-600' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    <item.icon
                      size={17}
                      className={`flex-shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}`}
                    />
                    <span className="text-sm font-medium">{item.label}</span>
                  </Link>
                );
              });
              return (
                <div key={section.label} className="mb-4">
                  <p className="text-[10px] font-600 uppercase tracking-widest text-muted-foreground px-2 mb-1">
                    {section.label}
                  </p>
                  {sectionItems}
                </div>
              );
            })}
          </nav>
          {/* Bottom — only Notificaciones, Ayuda, Cerrar Sesión */}
          <div className="border-t border-border px-2 py-3 space-y-0.5">
            <Link
              href="/notifications"
              className="flex items-center gap-3 px-2 py-2 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-all duration-150 group"
            >
              <Bell size={17} className="flex-shrink-0" />
              <span className="text-sm font-medium">Notificaciones</span>
            </Link>
            <Link
              href="/documents-dashboard"
              className="flex items-center gap-3 px-2 py-2 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-all duration-150 group"
            >
              <HelpCircle size={17} className="flex-shrink-0" />
              <span className="text-sm font-medium">Ayuda</span>
            </Link>
            <button
              onClick={async () => { await signOut(); }}
              className="flex items-center gap-3 px-2 py-2 rounded-lg text-destructive hover:bg-destructive/5 transition-all duration-150 w-full"
            >
              <LogOut size={17} className="flex-shrink-0" />
              <span className="text-sm font-medium">Cerrar sesión</span>
            </button>
          </div>
        </aside>

      {/* LucIA Chat Modal */}
      <LucIAChat isOpen={luciaOpen} onClose={() => setLuciaOpen(false)} />

      {/* ── Notification Detail Modal (standalone, outside the dropdown) ── */}
      {detailNotif && (() => {
        const n = detailNotif;
        const typeIcons: Record<string, React.ReactNode> = {
          document: <FileText size={16} className="text-blue-500" />,
          task: <CheckSquare size={16} className="text-green-500" />,
          request: <Send size={16} className="text-purple-500" />,
          alert: <AlertTriangle size={16} className="text-red-500" />,
          info: <Info size={16} className="text-gray-400" />,
        };
        const typeLabels: Record<string, string> = {
          document: 'Documento', task: 'Tarea', request: 'Solicitud', alert: 'Alerta', info: 'Información',
        };
        const priorityConfig: Record<string, { label: string; cls: string }> = {
          alta: { label: 'Alta', cls: 'bg-red-50 text-red-600 border border-red-200' },
          media: { label: 'Media', cls: 'bg-amber-50 text-amber-600 border border-amber-200' },
          baja: { label: 'Baja', cls: 'bg-primary/10 text-primary border border-primary/20' },
        };
        const typeColorCls: Record<string, string> = {
          document: 'bg-blue-50 text-blue-600', task: 'bg-green-50 text-green-600',
          request: 'bg-purple-50 text-purple-600', alert: 'bg-red-50 text-red-600',
          info: 'bg-muted text-muted-foreground',
        };
        const nType = n.type ?? 'info';
        const nPriority = (n as any).priority ?? 'baja';
        const handleContextualAction = async () => {
          if (!n.read) await markOneRead(n.id);
          const meta = (n as any).metadata as Record<string, unknown> | null | undefined;
          if (nType === 'document') {
            const docId = meta?.document_id as string | undefined;
            router.push(docId ? `/visor-documento/${docId}` : '/mis-documentos');
          } else if (nType === 'task') {
            router.push('/pending-tasks');
          } else if (nType === 'request') {
            router.push('/participation-requests');
          } else {
            router.push('/documents-dashboard');
          }
          setDetailNotif(null);
          setBellOpen(false);
        };
        const contextualActionLabel = () => {
          if (nType === 'document') return 'Ver documento';
          if (nType === 'task') return 'Ver tarea';
          if (nType === 'request') return 'Ver solicitud';
          return 'Ver en dashboard';
        };
        return (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) setDetailNotif(null); }}
          >
            <div className="bg-background rounded-2xl shadow-xl w-full max-w-sm mx-4 overflow-hidden">
              {/* Header */}
              <div className="flex items-start gap-3 px-5 pt-5 pb-4">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${n.read ? 'bg-muted' : 'bg-primary/10'}`}>
                  {typeIcons[nType] ?? typeIcons.info}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-700 text-foreground leading-snug">{n.title}</p>
                  {!n.read && (
                    <span className="inline-flex items-center gap-1 text-xs text-primary font-500 mt-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
                      No leída
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setDetailNotif(null)}
                  className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted/60 transition-colors flex-shrink-0"
                >
                  <X size={15} />
                </button>
              </div>

              {/* Body */}
              <div className="px-5 pb-4 space-y-3">
                {/* Type + Priority */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-muted/40 rounded-lg p-2.5">
                    <p className="text-[10px] text-muted-foreground font-500 mb-1">Tipo de notificación</p>
                    <span className={`inline-flex items-center gap-1 text-xs font-600 px-1.5 py-0.5 rounded-full ${typeColorCls[nType] ?? typeColorCls.info}`}>
                      {typeIcons[nType]}
                      {typeLabels[nType] ?? 'Info'}
                    </span>
                  </div>
                  <div className="bg-muted/40 rounded-lg p-2.5">
                    <p className="text-[10px] text-muted-foreground font-500 mb-1">Prioridad</p>
                    <span className={`inline-flex text-xs font-600 px-1.5 py-0.5 rounded-full ${priorityConfig[nPriority]?.cls ?? priorityConfig.baja.cls}`}>
                      {priorityConfig[nPriority]?.label ?? nPriority}
                    </span>
                  </div>
                </div>

                {/* Description */}
                <div className="bg-muted/40 rounded-lg p-3">
                  <p className="text-[10px] text-muted-foreground font-500 mb-1">Detalle de la notificación</p>
                  <p className="text-xs text-foreground leading-relaxed">{n.description}</p>
                </div>

                {/* Date */}
                <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Info size={12} className="flex-shrink-0 mt-0.5" />
                  <span>
                    <span className="font-500 text-foreground">Fecha de creación:</span>{' '}
                    {n.time}
                    {(n as any).created_at && (
                      <span className="text-[10px] ml-1 text-muted-foreground/70">
                        ({(() => { try { return new Date((n as any).created_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } })()})
                      </span>
                    )}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="px-5 py-4 border-t border-border flex flex-wrap gap-2">
                <button
                  onClick={handleContextualAction}
                  className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white text-xs font-600 rounded-lg hover:bg-primary/90 transition-colors"
                >
                  <ExternalLink size={13} />
                  {contextualActionLabel()}
                </button>
                {!n.read && (
                  <button
                    onClick={() => markOneRead(n.id)}
                    className="flex items-center gap-1.5 px-3 py-2 border border-border text-xs font-500 rounded-lg hover:bg-muted transition-colors"
                  >
                    <Check size={13} />
                    Marcar como leída
                  </button>
                )}
                <button
                  onClick={() => { deleteNotification(n.id); setDetailNotif(null); }}
                  className="flex items-center gap-1.5 px-3 py-2 border border-destructive/30 text-destructive text-xs font-500 rounded-lg hover:bg-destructive/5 transition-colors"
                >
                  <Trash2 size={13} />
                  Eliminar
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Join Workspace Modal */}
      {joinModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-background rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
            <div className="flex items-start justify-between px-6 pt-6 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Building2 size={20} className="text-primary" />
                </div>
                <div>
                  <h2 className="text-base font-700 text-foreground">Unirse a espacio de trabajo</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Ingresa el código de invitación</p>
                </div>
              </div>
              <button
                onClick={() => setJoinModalOpen(false)}
                className="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted/60 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="px-6 pb-6">
              {!joinSuccess ? (
                <>
                  <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                    Solicita el código de invitación al administrador del espacio de trabajo al que deseas unirte.
                  </p>
                  <div className="mb-4">
                    <label className="block text-xs font-600 text-foreground mb-1.5">
                      Código de invitación o nombre del espacio
                    </label>
                    <input
                      type="text"
                      value={inviteCode}
                      onChange={(e) => { setInviteCode(e.target.value); setJoinError(''); }}
                      placeholder="Ej: EMPRESA-2024 o nombre del espacio"
                      className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                      onKeyDown={(e) => e.key === 'Enter' && handleJoinWorkspace()}
                    />
                    {joinError && (
                      <p className="text-xs text-red-500 mt-1.5">{joinError}</p>
                    )}
                  </div>
                  <div className="flex items-center justify-end gap-3 pt-2 border-t border-border">
                    <button
                      onClick={() => setJoinModalOpen(false)}
                      className="px-4 py-2 rounded-lg text-sm font-500 text-foreground hover:bg-muted/60 transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handleJoinWorkspace}
                      disabled={joinLoading || !inviteCode.trim()}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-600 bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {joinLoading ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <UserPlus size={14} />
                      )}
                      Unirse
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-center py-4">
                  <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                    <Check size={24} className="text-green-600" />
                  </div>
                  <p className="text-sm font-600 text-foreground mb-1">¡Te has unido exitosamente!</p>
                  <p className="text-xs text-muted-foreground mb-4">Ahora eres miembro del espacio de trabajo.</p>
                  <button
                    onClick={() => setJoinModalOpen(false)}
                    className="px-4 py-2 rounded-lg text-sm font-600 bg-primary text-white hover:bg-primary/90 transition-colors"
                  >
                    Cerrar
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
