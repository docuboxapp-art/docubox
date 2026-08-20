'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRouter } from 'next/navigation';
import AppLogo from '@/components/ui/AppLogo';
import {
  Bell,
  ChevronDown,
  User,
  Home,
  FileText,
  Send,
  CheckSquare,
  Users,
  BarChart3,
  UserCircle,
  Store,
  Settings,
  CreditCard,
  LogOut,
  Menu,
  X,
  Check,
  Building2,
  UserPlus,
  Search,
  Loader2,
  Maximize2,
  Minimize2,
  Sun,
  Moon,
  LayoutDashboard,
  FolderOpen,
  FolderKanban,
  MailCheck,
  Landmark,
  Files,
  BookUser,
  BarChart2,
  HelpCircle,
  FileSignature,
  LayoutTemplate,
  ClipboardList,
  Fingerprint,
  MoreVertical,
  Eye,
  Trash2,
  Info,
  ExternalLink,
  AlertTriangle,
  Sparkles,
  ChevronsRight,
  Zap,
  FilePlus2,
  Workflow,
  BadgeCheck,
} from 'lucide-react';
import { useWorkspace, type Workspace } from '@/contexts/WorkspaceContext';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useSidebar } from '@/contexts/SidebarContext';
import { useAppModules } from '@/contexts/AppModulesContext';
import LucIAChat from '@/components/LucIAChat';

const BASE_NAV_TABS = [
  { href: '/inicio', label: 'Inicio', icon: Home },
  { href: '/mis-documentos', label: 'Mis Documentos', icon: FileText },
  { href: '/mis-solicitudes', label: 'Solicitudes Enviadas', icon: Send },
  { href: '/mis-participaciones', label: 'Mis Participaciones', icon: FileSignature },
  { href: '/mis-tareas', label: 'Tareas Pendientes', icon: CheckSquare },
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
      { href: '/inicio', icon: LayoutDashboard, label: 'Dashboard' },
      { href: '/mis-documentos', icon: FolderOpen, label: 'Mis Documentos' },
      { href: '/mis-tareas', icon: CheckSquare, label: 'Tareas Pendientes' },
    ],
  },
  {
    label: 'Contactos',
    items: [{ href: '/contactos', icon: BookUser, label: 'Mis Contactos' }],
  },
  {
    label: 'Gestión',
    items: [
      { href: '/mis-solicitudes', icon: Send, label: 'Solicitudes Enviadas' },
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

type GlobalSearchResult = {
  id: string;
  type: 'document' | 'folder' | 'contact' | 'task';
  title: string;
  subtitle: string;
  href: string;
  status?: string;
};

const RECENT_SEARCHES_KEY = 'docubox_recent_searches';
const SEARCH_COLLAPSED_KEY = 'docubox_search_collapsed';

function getDocumentSearchStyle(status?: string) {
  switch ((status || '').toLowerCase()) {
    case 'en_proceso':
    case 'en_progreso':
      return 'bg-blue-50 text-blue-600';
    case 'en_espera':
    case 'pendiente':
      return 'bg-orange-50 text-orange-600';
    case 'completado':
      return 'bg-emerald-50 text-emerald-600';
    case 'rechazado':
      return 'bg-red-50 text-red-600';
    case 'vencido':
      return 'bg-pink-50 text-pink-600';
    case 'cancelado':
    case 'borrador':
    default:
      return 'bg-slate-100 text-slate-500';
  }
}

function getDocumentSearchStatusLabel(status?: string) {
  if (!status) return 'Sin estado';
  if (status === 'en_proceso' || status === 'en_progreso') return 'En progreso';
  return status.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
}

export default function TopNav() {
  const pathname = usePathname();
  const usesWorkspaceChrome =
    pathname === '/inicio' ||
    pathname === '/mis-documentos' ||
    pathname === '/mis-solicitudes' ||
    pathname === '/mis-participaciones' ||
    pathname === '/mis-tareas' ||
    pathname === '/plantillas' ||
    pathname.startsWith('/formularios') ||
    pathname.startsWith('/expedientes') ||
    pathname.startsWith('/certificaciones') ||
    pathname === '/reportes' ||
    pathname === '/app-market' ||
    pathname === '/mi-perfil' ||
    pathname.startsWith('/organizacion') ||
    pathname.startsWith('/colabora') ||
    pathname === '/contactos' ||
    pathname.startsWith('/configuracion/verificacion-identidad') ||
    pathname.startsWith('/visor-documento/');
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [notifications, setNotifications] = useState<
    Array<{
      id: string | number;
      title: string;
      description: string;
      time: string;
      read: boolean;
      type?: string;
    }>
  >([]);

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
  const [searchResults, setSearchResults] = useState<GlobalSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [searchCollapsed, setSearchCollapsed] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [luciaOpen, setLuciaOpen] = useState(false);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);

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
  const searchRef = useRef<HTMLDivElement>(null);
  const quickActionsRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchPanelInputRef = useRef<HTMLInputElement>(null);
  const recentSearchesRef = useRef<string[]>([]);

  const {
    workspaces,
    activeWorkspace,
    loading: wsLoading,
    setActiveWorkspace,
    refreshWorkspaces,
  } = useWorkspace();
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
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', user.id)
      .eq('read', false);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const markSelectedRead = async () => {
    if (!user || selectedNotifIds.size === 0) return;
    const supabase = createClient();
    const ids = Array.from(selectedNotifIds);
    await supabase
      .from('notifications')
      .update({ read: true })
      .in('id', ids)
      .eq('user_id', user.id);
    setNotifications((prev) =>
      prev.map((n) => (selectedNotifIds.has(n.id) ? { ...n, read: true } : n))
    );
    setSelectedNotifIds(new Set());
  };

  const markOneRead = async (id: string | number) => {
    if (!user) return;
    const supabase = createClient();
    await supabase.from('notifications').update({ read: true }).eq('id', id).eq('user_id', user.id);
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setDetailNotif((prev) => (prev && prev.id === id ? { ...prev, read: true } : prev));
    setContextMenuId(null);
  };

  const deleteNotification = async (id: string | number) => {
    if (!user) return;
    const supabase = createClient();
    await supabase.from('notifications').delete().eq('id', id).eq('user_id', user.id);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    setSelectedNotifIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setContextMenuId(null);
  };

  const toggleSelectNotif = (id: string | number) => {
    setSelectedNotifIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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

  useEffect(() => {
    try {
      setSearchCollapsed(localStorage.getItem(SEARCH_COLLAPSED_KEY) === 'true');
    } catch {
      setSearchCollapsed(false);
    }
  }, []);

  useEffect(() => {
    if (!user?.id) {
      recentSearchesRef.current = [];
      setRecentSearches([]);
      return;
    }

    try {
      const userKey = `${RECENT_SEARCHES_KEY}:${user.id}`;
      const stored = localStorage.getItem(userKey) || localStorage.getItem(RECENT_SEARCHES_KEY);
      const parsed = stored ? JSON.parse(stored) : [];
      const validSearches = Array.isArray(parsed)
        ? parsed
            .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            .slice(0, 5)
        : [];
      recentSearchesRef.current = validSearches;
      setRecentSearches(validSearches);
      if (validSearches.length > 0) localStorage.setItem(userKey, JSON.stringify(validSearches));
      localStorage.removeItem(RECENT_SEARCHES_KEY);
    } catch {
      recentSearchesRef.current = [];
      setRecentSearches([]);
    }
  }, [user?.id]);

  // Focus the visible search field when the anchored panel opens.
  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => {
        if (searchInputRef.current?.offsetParent) searchInputRef.current.focus();
        else searchPanelInputRef.current?.focus();
      }, 50);
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
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
      if (quickActionsRef.current && !quickActionsRef.current.contains(e.target as Node)) {
        setQuickActionsOpen(false);
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
        setQuickActionsOpen(false);
        setSidebarOpen(false);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const getTabActive = (href: string) => {
    const base = href.split('?')[0];
    if (base === '/inicio' && !href.includes('?')) {
      return pathname === '/inicio';
    }
    if (base === '/mis-documentos' && pathname.startsWith('/visor-documento/')) {
      return true;
    }
    if (base === '/organizacion') {
      return pathname.startsWith('/organizacion');
    }
    if (base === '/colabora') {
      return pathname.startsWith('/colabora');
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
      ? userFullName
      : (activeWorkspace?.name ?? 'Espacio Personal');

  const rememberSearch = (value: string) => {
    const cleaned = value.trim();
    if (!cleaned) return;
    const next = [
      cleaned,
      ...recentSearchesRef.current.filter((item) => item.toLowerCase() !== cleaned.toLowerCase()),
    ].slice(0, 5);
    recentSearchesRef.current = next;
    try {
      const storageKey = user?.id ? `${RECENT_SEARCHES_KEY}:${user.id}` : RECENT_SEARCHES_KEY;
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Recent searches remain available for this session if storage is unavailable.
    }
    setRecentSearches(next);
  };

  const clearRecentSearches = () => {
    recentSearchesRef.current = [];
    setRecentSearches([]);
    try {
      const storageKey = user?.id ? `${RECENT_SEARCHES_KEY}:${user.id}` : RECENT_SEARCHES_KEY;
      localStorage.removeItem(storageKey);
    } catch {
      // Ignore storage access failures.
    }
  };

  const updateSearchCollapsed = (collapsed: boolean) => {
    setSearchCollapsed(collapsed);
    try {
      localStorage.setItem(SEARCH_COLLAPSED_KEY, String(collapsed));
    } catch {
      // Keep the preference in component state if storage is unavailable.
    }
    if (collapsed) {
      setSearchOpen(false);
    } else {
      setSearchOpen(true);
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  };

  const handleSearchResult = (result: GlobalSearchResult) => {
    rememberSearch(searchQuery || result.title);
    setSearchOpen(false);
    router.push(result.href);
  };

  const applySuggestedSearch = (value: string) => {
    setSearchQuery(value);
    setSearchOpen(true);
  };

  useEffect(() => {
    const query = searchQuery.trim();
    if (!searchOpen || query.length < 2 || !user) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      setSearchLoading(true);
      const supabase = createClient();
      const safeQuery = query
        .replace(/[,%()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const statusQuery = /progreso/i.test(safeQuery)
        ? 'en_proceso'
        : /completad/i.test(safeQuery)
          ? 'completado'
          : /pendient/i.test(safeQuery)
            ? 'pendiente'
            : safeQuery;
      const textPattern = `%${safeQuery}%`;
      const statusPattern = `%${statusQuery}%`;

      try {
        const documentsRequest = supabase
          .from('documentos')
          .select('id, nombre, descripcion, estado, updated_at')
          .eq('owner_id', user.id)
          .is('deleted_at', null)
          .or(
            `nombre.ilike.${textPattern},descripcion.ilike.${textPattern},estado.ilike.${statusPattern}`
          )
          .order('updated_at', { ascending: false })
          .limit(5);

        const contactsRequest = supabase
          .from('contacts')
          .select('id, nombre, apellido_paterno, apellido_materno, email')
          .eq('user_id', user.id)
          .or(
            `nombre.ilike.${textPattern},apellido_paterno.ilike.${textPattern},apellido_materno.ilike.${textPattern},email.ilike.${textPattern}`
          )
          .limit(4);

        const foldersRequest = supabase
          .from('carpetas')
          .select('id, nombre, descripcion, parent_id, created_at')
          .eq('owner_id', user.id)
          .or(`nombre.ilike.${textPattern},descripcion.ilike.${textPattern}`)
          .order('created_at', { ascending: false })
          .limit(5);

        const tasksRequest = activeWorkspace?.id
          ? supabase
              .from('tareas')
              .select('id, title, description, estado, due_date')
              .eq('workspace_id', activeWorkspace.id)
              .or(
                `title.ilike.${textPattern},description.ilike.${textPattern},estado.ilike.${statusPattern}`
              )
              .order('created_at', { ascending: false })
              .limit(4)
          : Promise.resolve({ data: [], error: null });

        const [documentsResponse, foldersResponse, contactsResponse, tasksResponse] =
          await Promise.all([documentsRequest, foldersRequest, contactsRequest, tasksRequest]);
        if (cancelled) return;

        const documentResults: GlobalSearchResult[] = (documentsResponse.data || []).map(
          (item: any) => ({
            id: item.id,
            type: 'document',
            title: item.nombre || 'Documento sin nombre',
            subtitle: `Documento · ${getDocumentSearchStatusLabel(item.estado)}`,
            href: `/visor-documento/${item.id}`,
            status: item.estado,
          })
        );
        const folderResults: GlobalSearchResult[] = (foldersResponse.data || []).map(
          (item: any) => ({
            id: item.id,
            type: 'folder',
            title: item.nombre || 'Carpeta sin nombre',
            subtitle: item.descripcion
              ? `Carpeta · ${item.descripcion}`
              : item.parent_id
                ? 'Subcarpeta'
                : 'Carpeta',
            href: `/mis-documentos?carpeta=${encodeURIComponent(item.id)}`,
          })
        );
        const contactResults: GlobalSearchResult[] = (contactsResponse.data || []).map(
          (item: any) => ({
            id: item.id,
            type: 'contact',
            title:
              [item.nombre, item.apellido_paterno, item.apellido_materno]
                .filter(Boolean)
                .join(' ') ||
              item.email ||
              'Contacto',
            subtitle: item.email ? `Contacto · ${item.email}` : 'Contacto',
            href: `/contactos?contact=${item.id}`,
          })
        );
        const taskResults: GlobalSearchResult[] = (tasksResponse.data || []).map((item: any) => ({
          id: item.id,
          type: 'task',
          title: item.title || 'Tarea sin nombre',
          subtitle: `Tarea · ${(item.estado || 'pendiente').replace(/_/g, ' ')}`,
          href: `/mis-tareas?task=${item.id}`,
        }));

        setSearchResults([...documentResults, ...folderResults, ...contactResults, ...taskResults]);
      } catch {
        if (!cancelled) setSearchResults([]);
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [activeWorkspace?.id, searchOpen, searchQuery, user]);

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
    const supabase = createClient();
    setJoinLoading(true);
    setJoinError('');
    try {
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser();
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
        () => {
          loadNotifications();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const isBusinessWorkspace = activeWorkspace?.workspaceType === 'business';
  const canManageOrganization =
    isBusinessWorkspace &&
    (activeWorkspace?.role === 'owner' || activeWorkspace?.role === 'admin');

  // Build dynamic nav tabs based on active modules
  const navTabs = [
    ...BASE_NAV_TABS.slice(0, 6), // up to Mis Contactos
    ...(isModuleActive('plantillas')
      ? [{ href: '/plantillas', label: 'Plantillas', icon: LayoutTemplate }]
      : []),
    ...(isModuleActive('formularios')
      ? [{ href: '/formularios', label: 'Formularios', icon: ClipboardList }]
      : []),
    ...(isModuleActive('expedientes')
      ? [{ href: '/expedientes', label: 'Expedientes', icon: FolderKanban }]
      : []),
    ...(isModuleActive('notifica')
      ? [{ href: '/notificaciones', label: 'Notifica', icon: MailCheck }]
      : []),
    ...(isModuleActive('credit-titles')
      ? [{ href: '/credit-titles', label: 'Titulos de Credito', icon: Landmark }]
      : []),
    ...(isModuleActive('bulk-signatures')
      ? [{ href: '/firmas-masivas', label: 'Firmas Masivas', icon: Files }]
      : []),
    ...(isModuleActive('certifica')
      ? [{ href: '/certificaciones', label: 'Certifica', icon: BadgeCheck }]
      : []),
    ...(isModuleActive('firmado-prueba-vida')
      ? [{ href: '/configuracion/verificacion-identidad', label: 'Identidad', icon: Fingerprint }]
      : []),
    ...(canManageOrganization
      ? [{ href: '/organizacion', label: 'Mi organización', icon: Building2 }]
      : []),
    ...(isBusinessWorkspace && (canManageOrganization || activeWorkspace?.collaborationEnabled)
      ? [{ href: '/colabora', label: 'Colaboración', icon: Workflow }]
      : []),
    ...BASE_NAV_TABS.slice(6), // Reportes and beyond
  ];

  const accountMenuItems = canManageOrganization
    ? [
        { icon: Building2, label: 'Mi organización', href: '/organizacion' },
        { icon: Workflow, label: 'Colaboración', href: '/colabora' },
        ...avatarMenuItems,
      ]
    : isBusinessWorkspace && activeWorkspace?.collaborationEnabled
      ? [{ icon: Workflow, label: 'Colaboración', href: '/colabora' }, ...avatarMenuItems]
      : avatarMenuItems;

  // Build dynamic sidebar nav sections based on active modules
  const sidebarNavSections = BASE_SIDEBAR_NAV_SECTIONS.map((section) => {
    if (section.label === 'Principal') {
      const businessItems: typeof section.items = [];
      if (canManageOrganization) {
        businessItems.push({ href: '/organizacion', icon: Building2, label: 'Mi organización' });
      }
      if (isBusinessWorkspace && (canManageOrganization || activeWorkspace?.collaborationEnabled)) {
        businessItems.push({ href: '/colabora', icon: Workflow, label: 'Colaboración' });
      }
      return { ...section, items: [...section.items, ...businessItems] };
    }
    if (section.label !== 'Gestión') return section;
    const moduleItems: typeof section.items = [];
    if (isModuleActive('plantillas')) {
      moduleItems.push({ href: '/plantillas', icon: LayoutTemplate, label: 'Plantillas' });
    }
    if (isModuleActive('formularios')) {
      moduleItems.push({ href: '/formularios', icon: ClipboardList, label: 'Formularios' });
    }
    if (isModuleActive('expedientes')) {
      moduleItems.push({ href: '/expedientes', icon: FolderKanban, label: 'Expedientes' });
    }
    if (isModuleActive('notifica')) {
      moduleItems.push({ href: '/notificaciones', icon: MailCheck, label: 'Notifica' });
    }
    if (isModuleActive('credit-titles')) {
      moduleItems.push({ href: '/credit-titles', icon: Landmark, label: 'Titulos de Credito' });
    }
    if (isModuleActive('bulk-signatures')) {
      moduleItems.push({ href: '/firmas-masivas', icon: Files, label: 'Firmas Masivas' });
    }
    if (isModuleActive('certifica')) {
      moduleItems.push({ href: '/certificaciones', icon: BadgeCheck, label: 'Docubox Certifica' });
    }
    if (isModuleActive('firmado-prueba-vida')) {
      moduleItems.push({
        href: '/configuracion/verificacion-identidad',
        icon: Fingerprint,
        label: 'Verificacion de identidad',
      });
    }
    return { ...section, items: [...section.items, ...moduleItems] };
  });

  return (
    <>
      {/* TopNav header — primary bar always visible; secondary nav bar hidden when sidebar is open */}
      <header
        className={`fixed top-0 left-0 right-0 z-30 flex-shrink-0 bg-background/95 backdrop-blur-xl ${
          usesWorkspaceChrome ? 'border-b border-slate-200/80 shadow-none' : 'shadow-sm'
        }`}
      >
        {/* ── Primary top bar ── h-16, px-4 — ALWAYS VISIBLE */}
        <div
          className={`flex items-center h-16 px-4 lg:px-6 ${
            !sidebarOpen ? 'border-b border-border/60' : 'border-b border-border'
          }`}
        >
          {/* Left section: hamburger (mobile) + logo + workspace */}
          <div className="flex items-center gap-8">
            {/* Hamburger — mobile only */}
            <button
              className="md:hidden w-10 h-10 rounded-md flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-primary transition-all duration-150"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Abrir menú"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>

            {/* Logo */}
            <Link href="/inicio" className="flex items-center gap-2 flex-shrink-0">
              <AppLogo size={32} className="[&_img]:h-auto [&_img]:w-[126px]" />
            </Link>

            {/* Workspace selector — hidden on mobile */}
            <div ref={workspaceRef} className="relative hidden md:block">
              <button
                onClick={() => setWorkspaceOpen(!workspaceOpen)}
                className={`flex h-10 items-center gap-2.5 rounded-lg border bg-background px-3 text-sm transition-colors hover:bg-slate-50 focus:outline-none ${
                  usesWorkspaceChrome
                    ? 'w-80 border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.03)] 2xl:w-[22rem]'
                    : 'w-80 border-border'
                } ${workspaceOpen ? 'border-primary/50 bg-white ring-2 ring-primary/10' : ''}`}
              >
                <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-primary/10">
                  {isPersonal ? (
                    <User size={15} className="text-primary" />
                  ) : (
                    <Building2 size={15} className="text-primary" />
                  )}
                </div>
                <div className="text-left flex-1 min-w-0">
                  <p className="text-[10px] font-600 uppercase leading-none tracking-[0.1em] text-slate-500">
                    {isPersonal ? 'Espacio de Trabajo Personal' : 'Espacio de Trabajo'}
                  </p>
                  <p className="mt-0.5 truncate text-sm font-600 leading-none text-slate-950">
                    {displayName}
                  </p>
                </div>
                <ChevronDown
                  size={12}
                  className={`text-muted-foreground flex-shrink-0 transition-transform duration-150 ${workspaceOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {workspaceOpen && (
                <div className="absolute left-0 top-11 z-50 w-full overflow-hidden rounded-lg border border-border bg-background shadow-lg">
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
                            isActive ? 'bg-primary/10 hover:bg-primary/15' : 'hover:bg-primary/5'
                          }`}
                        >
                          <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                              isActive ? 'bg-primary/20' : 'bg-primary/10'
                            }`}
                          >
                            {isWsPersonal ? (
                              <User size={14} className="text-primary" />
                            ) : (
                              <Building2 size={14} className="text-primary" />
                            )}
                          </div>
                          <div className="flex-1 text-left min-w-0">
                            <p
                              className={`text-sm truncate ${isActive ? 'font-600 text-primary' : 'font-500 text-foreground'}`}
                            >
                              {isWsPersonal ? userFullName : ws.name}
                            </p>
                            {isWsPersonal ? (
                              <>
                                <p className="mt-0.5 text-[11px] text-muted-foreground">
                                  Espacio personal
                                </p>
                                {isActive && (
                                  <p className="mt-0.5 text-[11px] font-medium text-emerald-600">
                                    Activo
                                  </p>
                                )}
                              </>
                            ) : (
                              <p className="text-[11px] text-muted-foreground capitalize">
                                {ws.role}
                              </p>
                            )}
                          </div>
                          {isActive && <Check size={14} className="text-primary flex-shrink-0" />}
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
                        <UserPlus
                          size={14}
                          className="text-muted-foreground group-hover:text-primary transition-colors"
                        />
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
          <div className="flex items-center gap-0">
            {/* LucIA Button — only visible when lucia module is active */}
            {user && !modulesLoading && isModuleActive('lucia') && (
              <button
                title="Pregúntale a LucIA"
                onClick={() => setLuciaOpen(true)}
                className="mr-2 flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-blue-100 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-600 transition-all duration-150 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/40"
              >
                <Sparkles className="h-4 w-4" />
                <span className="hidden sm:inline">Pregúntale a LucIA</span>
              </button>
            )}

            {/* 1. Buscar */}
            <div ref={searchRef} className="relative flex-shrink-0">
              {usesWorkspaceChrome ? (
                searchCollapsed ? (
                  <button
                    title="Buscar"
                    onClick={() => updateSearchCollapsed(false)}
                    className="hidden h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-all duration-150 hover:bg-primary/10 hover:text-primary lg:flex"
                  >
                    <Search className="h-5 w-5" />
                  </button>
                ) : (
                  <div
                    className={`hidden h-10 items-center gap-2 rounded-lg border bg-slate-50 px-3 transition-[width,border-color,background-color,box-shadow] lg:flex lg:w-[26rem] 2xl:w-[30rem] ${searchOpen ? 'border-primary/50 bg-white ring-2 ring-primary/10' : 'border-slate-200 hover:border-slate-300'}`}
                  >
                    <Search
                      className={`h-5 w-5 flex-shrink-0 ${searchOpen ? 'text-primary' : 'text-slate-500'}`}
                    />
                    <input
                      ref={searchInputRef}
                      value={searchQuery}
                      onFocus={() => setSearchOpen(true)}
                      onChange={(event) => {
                        setSearchQuery(event.target.value);
                        setSearchOpen(true);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          if (searchResults[0]) handleSearchResult(searchResults[0]);
                          else rememberSearch(searchQuery);
                        }
                      }}
                      placeholder="Buscar en Docubox..."
                      className="min-w-0 flex-1 bg-transparent text-sm text-slate-950 outline-none placeholder:text-slate-500"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => {
                          setSearchQuery('');
                          searchInputRef.current?.focus();
                        }}
                        title="Limpiar búsqueda"
                        className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-200/70 hover:text-slate-700"
                      >
                        <X size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => updateSearchCollapsed(true)}
                      title="Colapsar barra de búsqueda"
                      className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border-l border-slate-200 pl-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-primary"
                    >
                      <ChevronsRight size={15} />
                    </button>
                  </div>
                )
              ) : (
                <button
                  title="Buscar"
                  onClick={() => setSearchOpen((open) => !open)}
                  className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-all duration-150 hover:bg-primary/10 hover:text-primary"
                >
                  <Search className="h-5 w-5" />
                </button>
              )}

              {usesWorkspaceChrome && (
                <button
                  title="Buscar"
                  onClick={() => setSearchOpen((open) => !open)}
                  className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-all duration-150 hover:bg-primary/10 hover:text-primary lg:hidden"
                >
                  <Search className="h-5 w-5" />
                </button>
              )}

              {searchOpen && (
                <div className="absolute right-0 top-12 z-50 w-[min(34rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_18px_45px_rgba(15,23,42,0.16)]">
                  <div
                    className={`${usesWorkspaceChrome && !searchCollapsed ? 'lg:hidden' : ''} flex items-center gap-2 border-b border-slate-200 px-3 py-2.5`}
                  >
                    <Search size={17} className="flex-shrink-0 text-primary" />
                    <input
                      ref={searchPanelInputRef}
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          if (searchResults[0]) handleSearchResult(searchResults[0]);
                          else rememberSearch(searchQuery);
                        }
                      }}
                      placeholder="Buscar documentos, contactos o tareas..."
                      className="min-w-0 flex-1 bg-transparent text-sm text-slate-950 outline-none placeholder:text-slate-400"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        title="Limpiar búsqueda"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>

                  <div className="max-h-[min(32rem,calc(100vh-7rem))] overflow-y-auto">
                    {searchQuery.trim().length < 2 ? (
                      <section className="px-4 py-3.5">
                        <div className="mb-2.5 flex items-center justify-between">
                          <p className="text-xs font-700 uppercase text-slate-500">
                            Búsquedas recientes
                          </p>
                          {recentSearches.length > 0 && (
                            <button
                              onClick={clearRecentSearches}
                              className="text-xs font-600 text-slate-400 hover:text-red-600"
                            >
                              Limpiar
                            </button>
                          )}
                        </div>
                        {recentSearches.length > 0 ? (
                          <div className="space-y-0.5">
                            {recentSearches.map((item) => (
                              <button
                                key={item}
                                onClick={() => applySuggestedSearch(item)}
                                className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50 hover:text-primary"
                              >
                                <Search size={14} className="text-slate-400" />
                                <span className="min-w-0 flex-1 truncate">{item}</span>
                                <ChevronDown size={14} className="-rotate-90 text-slate-300" />
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="py-3 text-sm text-slate-400">
                            Todavía no tienes búsquedas recientes.
                          </p>
                        )}
                      </section>
                    ) : searchLoading ? (
                      <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-slate-500">
                        <Loader2 size={17} className="animate-spin text-primary" />
                        Buscando en tu espacio de trabajo...
                      </div>
                    ) : searchResults.length > 0 ? (
                      <section className="py-2">
                        <div className="flex items-center justify-between px-4 py-2">
                          <p className="text-xs font-700 uppercase text-slate-500">Resultados</p>
                          <span className="text-xs text-slate-400">
                            {searchResults.length} encontrados
                          </span>
                        </div>
                        {searchResults.map((result) => {
                          const ResultIcon =
                            result.type === 'document'
                              ? FileText
                              : result.type === 'folder'
                                ? FolderOpen
                                : result.type === 'contact'
                                  ? Users
                                  : CheckSquare;
                          const iconStyle =
                            result.type === 'document'
                              ? getDocumentSearchStyle(result.status)
                              : result.type === 'folder'
                                ? 'bg-amber-50 text-amber-600'
                                : result.type === 'contact'
                                  ? 'bg-emerald-50 text-emerald-600'
                                  : 'bg-amber-50 text-amber-600';
                          return (
                            <button
                              key={`${result.type}-${result.id}`}
                              onClick={() => handleSearchResult(result)}
                              className="group flex w-full items-center gap-3 border-t border-slate-100 px-4 py-3 text-left transition-colors first:border-t-0 hover:bg-slate-50"
                            >
                              <span
                                className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md ${iconStyle}`}
                              >
                                <ResultIcon size={17} />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-700 text-slate-900">
                                  {result.title}
                                </span>
                                <span className="mt-0.5 block truncate text-xs capitalize text-slate-500">
                                  {result.subtitle}
                                </span>
                              </span>
                              <ExternalLink
                                size={15}
                                className="text-slate-300 transition-colors group-hover:text-primary"
                              />
                            </button>
                          );
                        })}
                      </section>
                    ) : (
                      <div className="px-6 py-10 text-center">
                        <Search size={26} className="mx-auto mb-3 text-slate-300" />
                        <p className="text-sm font-700 text-slate-800">
                          No encontramos coincidencias
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          Prueba con el nombre de un documento, carpeta, contacto o tarea.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* 2. Acciones rápidas */}
            <div ref={quickActionsRef} className="relative hidden flex-shrink-0 md:block">
              <button
                title="Acciones rápidas"
                aria-label="Acciones rápidas"
                aria-expanded={quickActionsOpen}
                onClick={() => {
                  setQuickActionsOpen((open) => !open);
                  setBellOpen(false);
                  setAvatarOpen(false);
                }}
                className={`flex h-10 w-10 items-center justify-center rounded-md transition-colors duration-150 ${
                  quickActionsOpen
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-primary/10 hover:text-primary'
                }`}
              >
                <Zap className="h-5 w-5" />
              </button>

              {quickActionsOpen && (
                <div className="absolute right-0 top-12 z-50 w-64 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_14px_36px_rgba(15,23,42,0.14)]">
                  <div className="border-b border-slate-200 px-4 py-3">
                    <p className="text-sm font-700 text-slate-950">Acciones rápidas</p>
                    <p className="mt-0.5 text-xs text-slate-500">Inicia una tarea frecuente.</p>
                  </div>
                  <div className="p-1.5">
                    {[
                      {
                        label: 'Crear documento',
                        description: 'Iniciar un nuevo flujo',
                        href: '/crear-documento',
                        icon: FilePlus2,
                      },
                      {
                        label: 'Crear desde plantilla',
                        description: 'Usar un formato guardado',
                        href: '/plantillas',
                        icon: LayoutTemplate,
                      },
                      {
                        label: 'Mis contactos',
                        description: 'Consultar participantes',
                        href: '/contactos',
                        icon: Users,
                      },
                      {
                        label: 'Tareas pendientes',
                        description: 'Revisar acciones por completar',
                        href: '/mis-tareas',
                        icon: CheckSquare,
                      },
                    ].map((action) => {
                      const ActionIcon = action.icon;
                      return (
                        <button
                          key={action.href}
                          type="button"
                          onClick={() => {
                            setQuickActionsOpen(false);
                            router.push(action.href);
                          }}
                          className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-slate-50"
                        >
                          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                            <ActionIcon size={16} />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-600 text-slate-900">
                              {action.label}
                            </span>
                            <span className="mt-0.5 block text-xs text-slate-500">
                              {action.description}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* 3. Centro de ayuda */}
            <button
              title="Centro de ayuda"
              aria-label="Centro de ayuda"
              onClick={() => router.push('/ayuda-firmado')}
              className="hidden h-10 w-10 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-primary/10 hover:text-primary md:flex"
            >
              <HelpCircle className="h-5 w-5" />
            </button>

            {/* 4. Expandir pantalla */}
            <button
              title={isExpanded ? 'Restaurar pantalla' : 'Expandir pantalla'}
              onClick={() => setIsExpanded(!isExpanded)}
              className="w-10 h-10 rounded-md flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-primary transition-all duration-150 flex-shrink-0"
            >
              {isExpanded ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
            </button>

            {/* 5. Vista claro/oscuro */}
            <button
              title={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
              onClick={toggleTheme}
              className="w-10 h-10 rounded-md flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-primary transition-all duration-150 flex-shrink-0"
            >
              {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>

            {/* 6. Notificaciones */}
            <div ref={bellRef} className="relative flex-shrink-0">
              <button
                title="Notificaciones"
                onClick={() => {
                  setBellOpen(!bellOpen);
                  setAvatarOpen(false);
                }}
                className="w-10 h-10 rounded-md flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-primary transition-all duration-150 relative"
              >
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 h-4 min-w-[1rem] px-0.5 bg-primary rounded-full flex items-center justify-center">
                    <span className="text-white text-[9px] font-700 leading-none">
                      {unreadCount}
                    </span>
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
                          selectedNotifIds.has(n.id)
                            ? 'bg-primary/10'
                            : !n.read
                              ? 'bg-primary/[0.02] hover:bg-primary/5'
                              : 'hover:bg-muted/40'
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
                          <p
                            className={`text-sm ${!n.read ? 'font-600 text-foreground' : 'font-500 text-foreground'}`}
                          >
                            {n.title}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">
                            {n.description}
                          </p>
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
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setContextMenuId(null);
                                  setBellOpen(false);
                                  setDetailNotif(n as any);
                                }}
                                className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-primary/5 hover:text-primary transition-colors w-full text-left"
                              >
                                <Eye size={14} className="flex-shrink-0" />
                                Ver detalle
                              </button>
                              {!n.read && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    markOneRead(n.id);
                                  }}
                                  className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-primary/5 hover:text-primary transition-colors w-full text-left"
                                >
                                  <Check size={14} className="flex-shrink-0" />
                                  Marcar como leído
                                </button>
                              )}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteNotification(n.id);
                                }}
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
                onClick={() => {
                  setAvatarOpen(!avatarOpen);
                  setBellOpen(false);
                }}
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
                    {accountMenuItems.map((item) => (
                      <Link
                        key={item.label}
                        href={item.href}
                        onClick={() => setAvatarOpen(false)}
                        className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-primary/5 hover:text-primary transition-all duration-150 group"
                      >
                        <item.icon
                          size={15}
                          className="text-muted-foreground group-hover:text-primary flex-shrink-0 transition-colors duration-150"
                        />
                        {item.label}
                      </Link>
                    ))}
                  </div>
                  <div className="border-t border-border py-1">
                    <button
                      onClick={async () => {
                        setAvatarOpen(false);
                        await signOut();
                      }}
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
          <div
            className={`hidden h-10 items-center overflow-x-auto px-4 scrollbar-none md:flex ${
              usesWorkspaceChrome ? 'gap-1 bg-white lg:px-6' : 'gap-0 bg-primary'
            }`}
          >
            {navTabs.map((tab) => {
              const isActive = getTabActive(tab.href);
              const TabIcon = tab.icon;
              return (
                <Link
                  key={tab.label}
                  href={tab.href}
                  className={`relative flex h-10 items-center gap-2 whitespace-nowrap px-4 py-2 text-sm font-500 transition-all duration-150 ${
                    usesWorkspaceChrome
                      ? isActive
                        ? 'text-primary font-700 after:absolute after:inset-x-4 after:bottom-0 after:h-0.5 after:bg-primary'
                        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-950'
                      : isActive
                        ? 'bg-white/20 font-600 text-white'
                        : 'text-white/80 hover:bg-white/10 hover:text-white'
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

      {/* ── Lateral Sidebar — push layout, fixed left, below top bar ── */}
      <aside
        className={`fixed top-16 left-0 z-40 h-[calc(100vh-4rem)] w-64 2xl:w-72 bg-white border-r border-slate-200/90 shadow-[4px_0_18px_rgba(15,23,42,0.04)] flex flex-col transition-transform duration-300 ease-in-out ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <div className="space-y-1">
            {sidebarNavSections
              .flatMap((section) => section.items)
              .map((item) => {
                const isActive = getTabActive(item.href);
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    className={`group relative flex min-h-10 items-center gap-3 rounded-md border px-3 py-2 text-sm transition-all duration-150 ${
                      isActive
                        ? 'border-blue-100 bg-blue-50/90 font-600 text-blue-700 shadow-[inset_3px_0_0_#1E6BFF]'
                        : 'border-transparent font-500 text-slate-600 hover:border-slate-200/80 hover:bg-slate-50 hover:text-slate-950'
                    }`}
                  >
                    <item.icon
                      size={18}
                      strokeWidth={isActive ? 2.1 : 1.8}
                      className={`flex-shrink-0 transition-colors ${
                        isActive ? 'text-blue-600' : 'text-slate-400 group-hover:text-slate-700'
                      }`}
                    />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
          </div>
        </nav>
        {/* Bottom — only Notificaciones, Ayuda, Cerrar Sesión */}
        <div className="space-y-1 border-t border-slate-200/90 bg-slate-50/40 px-3 py-3">
          <Link
            href="/notifications"
            className="group flex min-h-10 items-center gap-3 rounded-md border border-transparent px-3 py-2 text-sm font-500 text-slate-600 transition-all duration-150 hover:border-slate-200/80 hover:bg-white hover:text-slate-950"
          >
            <Bell
              size={18}
              strokeWidth={1.8}
              className="flex-shrink-0 text-slate-400 group-hover:text-slate-700"
            />
            <span>Notificaciones</span>
          </Link>
          <Link
            href="/inicio"
            className="group flex min-h-10 items-center gap-3 rounded-md border border-transparent px-3 py-2 text-sm font-500 text-slate-600 transition-all duration-150 hover:border-slate-200/80 hover:bg-white hover:text-slate-950"
          >
            <HelpCircle
              size={18}
              strokeWidth={1.8}
              className="flex-shrink-0 text-slate-400 group-hover:text-slate-700"
            />
            <span>Ayuda</span>
          </Link>
          <button
            onClick={async () => {
              await signOut();
            }}
            className="flex min-h-10 w-full items-center gap-3 rounded-md border border-transparent px-3 py-2 text-sm font-500 text-red-500 transition-all duration-150 hover:border-red-100 hover:bg-red-50 hover:text-red-600"
          >
            <LogOut size={18} strokeWidth={1.8} className="flex-shrink-0" />
            <span>Cerrar sesión</span>
          </button>
        </div>
      </aside>

      {/* LucIA Chat Modal */}
      <LucIAChat isOpen={luciaOpen} onClose={() => setLuciaOpen(false)} />

      {/* ── Notification Detail Modal (standalone, outside the dropdown) ── */}
      {detailNotif &&
        (() => {
          const n = detailNotif;
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
          const nType = n.type ?? 'info';
          const nPriority = (n as any).priority ?? 'baja';
          const handleContextualAction = async () => {
            if (!n.read) await markOneRead(n.id);
            const meta = (n as any).metadata as Record<string, unknown> | null | undefined;
            if (nType === 'document') {
              const docId = meta?.document_id as string | undefined;
              router.push(docId ? `/visor-documento/${docId}` : '/mis-documentos');
            } else if (nType === 'task') {
              router.push('/mis-tareas');
            } else if (nType === 'request') {
              router.push('/mis-solicitudes');
            } else {
              router.push('/inicio');
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
              onClick={(e) => {
                if (e.target === e.currentTarget) setDetailNotif(null);
              }}
            >
              <div className="bg-background rounded-2xl shadow-xl w-full max-w-sm mx-4 overflow-hidden">
                {/* Header */}
                <div className="flex items-start gap-3 px-5 pt-5 pb-4">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${n.read ? 'bg-muted' : 'bg-primary/10'}`}
                  >
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
                      <p className="text-[10px] text-muted-foreground font-500 mb-1">
                        Tipo de notificación
                      </p>
                      <span
                        className={`inline-flex items-center gap-1 text-xs font-600 px-1.5 py-0.5 rounded-full ${typeColorCls[nType] ?? typeColorCls.info}`}
                      >
                        {typeIcons[nType]}
                        {typeLabels[nType] ?? 'Info'}
                      </span>
                    </div>
                    <div className="bg-muted/40 rounded-lg p-2.5">
                      <p className="text-[10px] text-muted-foreground font-500 mb-1">Prioridad</p>
                      <span
                        className={`inline-flex text-xs font-600 px-1.5 py-0.5 rounded-full ${priorityConfig[nPriority]?.cls ?? priorityConfig.baja.cls}`}
                      >
                        {priorityConfig[nPriority]?.label ?? nPriority}
                      </span>
                    </div>
                  </div>

                  {/* Description */}
                  <div className="bg-muted/40 rounded-lg p-3">
                    <p className="text-[10px] text-muted-foreground font-500 mb-1">
                      Detalle de la notificación
                    </p>
                    <p className="text-xs text-foreground leading-relaxed">{n.description}</p>
                  </div>

                  {/* Date */}
                  <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Info size={12} className="flex-shrink-0 mt-0.5" />
                    <span>
                      <span className="font-500 text-foreground">Fecha de creación:</span> {n.time}
                      {(n as any).created_at && (
                        <span className="text-[10px] ml-1 text-muted-foreground/70">
                          (
                          {(() => {
                            try {
                              return new Date((n as any).created_at).toLocaleDateString('es-MX', {
                                day: 'numeric',
                                month: 'long',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              });
                            } catch {
                              return '';
                            }
                          })()}
                          )
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
                    onClick={() => {
                      deleteNotification(n.id);
                      setDetailNotif(null);
                    }}
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
                  <h2 className="text-base font-700 text-foreground">
                    Unirse a espacio de trabajo
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Ingresa el código de invitación
                  </p>
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
                    Solicita el código de invitación al administrador del espacio de trabajo al que
                    deseas unirte.
                  </p>
                  <div className="mb-4">
                    <label className="block text-xs font-600 text-foreground mb-1.5">
                      Código de invitación o nombre del espacio
                    </label>
                    <input
                      type="text"
                      value={inviteCode}
                      onChange={(e) => {
                        setInviteCode(e.target.value);
                        setJoinError('');
                      }}
                      placeholder="Ej: EMPRESA-2024 o nombre del espacio"
                      className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                      onKeyDown={(e) => e.key === 'Enter' && handleJoinWorkspace()}
                    />
                    {joinError && <p className="text-xs text-red-500 mt-1.5">{joinError}</p>}
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
                  <p className="text-sm font-600 text-foreground mb-1">
                    ¡Te has unido exitosamente!
                  </p>
                  <p className="text-xs text-muted-foreground mb-4">
                    Ahora eres miembro del espacio de trabajo.
                  </p>
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
