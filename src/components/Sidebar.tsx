'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  LayoutDashboard,
  LayoutTemplate,
  Users,
  ShieldCheck,
  BarChart3,
  Settings,
  ChevronLeft,
  ChevronRight,
  Bell,
  CreditCard,
  Webhook,
  HelpCircle,
  LogOut,
  AlertTriangle,
  Send,
  CheckSquare,
  FolderOpen,
  UserPlus,
  BookUser,
  FileSignature,
  ClipboardList,
  Shield,
  FolderKanban,
  MailCheck,
  Landmark,
  Files,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import { useSidebar } from '@/contexts/SidebarContext';
import { useAppModules } from '@/contexts/AppModulesContext';

const BASE_NAV_SECTIONS = [
  {
    label: 'Principal',
    items: [
      { href: '/documents-dashboard', icon: LayoutDashboard, label: 'Dashboard', badge: null },
      { href: '/mis-documentos', icon: FolderOpen, label: 'Mis Documentos', badge: null },
      { href: '/pending-tasks', icon: CheckSquare, label: 'Tareas Pendientes', badge: 8 },
    ],
  },
  {
    label: 'Contactos',
    items: [{ href: '/contactos', icon: BookUser, label: 'Mis Contactos', badge: null }],
  },
  {
    label: 'Gestión',
    items: [
      { href: '/participation-requests', icon: Send, label: 'Solicitudes Enviadas', badge: 3 },
      {
        href: '/mis-participaciones',
        icon: FileSignature,
        label: 'Mis Participaciones',
        badge: null,
      },
      { href: '/documents-dashboard', icon: Users, label: 'Firmantes', badge: null },
      // Plantillas and Formularios are injected conditionally
      { href: '/documents-dashboard', icon: AlertTriangle, label: 'Certificados', badge: 2 },
      { href: '/registro', icon: UserPlus, label: 'Registrar Usuario', badge: null },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { href: '/documents-dashboard', icon: ShieldCheck, label: 'Auditoría', badge: null },
      { href: '/reportes', icon: BarChart3, label: 'Reportes', badge: null },
      { href: '/documents-dashboard', icon: Webhook, label: 'API & Webhooks', badge: null },
      { href: '/facturacion', icon: CreditCard, label: 'Facturación', badge: null },
    ],
  },
];

export default function Sidebar() {
  const { sidebarCollapsed: collapsed, setSidebarCollapsed: setCollapsed } = useSidebar();
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const { isModuleActive } = useAppModules();

  const userFullName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Usuario';
  const userEmail = user?.email || '';
  const userInitials =
    userFullName
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((n: string) => n[0].toUpperCase())
      .join('') || 'U';

  // Build nav sections with conditional module items
  const navSections = BASE_NAV_SECTIONS.map((section) => {
    if (section.label !== 'Gestión') return section;
    const moduleItems: typeof section.items = [];
    if (isModuleActive('plantillas')) {
      moduleItems.push({
        href: '/plantillas',
        icon: LayoutTemplate,
        label: 'Plantillas',
        badge: null,
      });
    }
    if (isModuleActive('formularios')) {
      moduleItems.push({
        href: '/formularios',
        icon: ClipboardList,
        label: 'Formularios',
        badge: null,
      });
    }
    if (isModuleActive('expedientes')) {
      moduleItems.push({
        href: '/expedientes',
        icon: FolderKanban,
        label: 'Expedientes',
        badge: null,
      });
    }
    if (isModuleActive('notifica')) {
      moduleItems.push({
        href: '/notificaciones',
        icon: MailCheck,
        label: 'Notifica',
        badge: null,
      });
    }
    if (isModuleActive('credit-titles')) {
      moduleItems.push({
        href: '/credit-titles',
        icon: Landmark,
        label: 'Titulos de Credito',
        badge: null,
      });
    }
    if (isModuleActive('bulk-signatures')) {
      moduleItems.push({
        href: '/firmas-masivas',
        icon: Files,
        label: 'Firmas Masivas',
        badge: null,
      });
    }
    if (isModuleActive('firmado-prueba-vida')) {
      moduleItems.push({
        href: '/configuracion/verificacion-identidad',
        icon: ShieldCheck,
        label: 'Verificacion de identidad',
        badge: null,
      });
    }
    // Insert module items after Firmantes (index 2), before Certificados
    const sectionItems = [...section.items];
    sectionItems.splice(3, 0, ...moduleItems);
    return { ...section, items: sectionItems };
  });

  // Load unread notifications count
  useEffect(() => {
    if (!user) return;
    const supabase = createClient();

    const fetchCount = async () => {
      try {
        const { count } = await supabase
          .from('notifications')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('read', false);
        setUnreadCount(count ?? 0);
      } catch {
        // silent
      }
    };

    fetchCount();

    const channel = supabase
      .channel('sidebar-notifications')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          fetchCount();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  return (
    <aside
      className={`fixed top-16 left-0 z-40 flex-col bg-background border-r border-border transition-all duration-300 ease-in-out h-[calc(100vh-4rem)]
        hidden md:flex
        ${collapsed ? 'w-20' : 'w-64 2xl:w-72'}
      `}
    >
      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-4 z-50 w-6 h-6 rounded-full bg-background border border-border flex items-center justify-center shadow-card hover:bg-muted transition-colors duration-150"
        aria-label={collapsed ? 'Expandir menú' : 'Colapsar menú'}
      >
        {collapsed ? (
          <ChevronRight size={12} className="text-muted-foreground" />
        ) : (
          <ChevronLeft size={12} className="text-muted-foreground" />
        )}
      </button>
      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto scrollbar-thin py-3 px-2">
        {navSections?.map((section) => (
          <div key={`section-${section?.label}`} className="mb-4">
            {!collapsed && (
              <p className="text-[10px] font-600 uppercase tracking-widest text-muted-foreground px-2 mb-1">
                {section?.label}
              </p>
            )}
            {section?.items?.map((item) => {
              const isActive =
                pathname === item?.href && item?.label === 'Dashboard'
                  ? true
                  : pathname === item?.href && item?.href !== '/documents-dashboard'
                    ? true
                    : false;
              return (
                <Link
                  key={`nav-${item?.label}`}
                  href={item?.href}
                  title={collapsed ? item?.label : undefined}
                  className={`flex items-center gap-3 px-2 py-2 rounded-lg mb-0.5 transition-all duration-150 group relative ${
                    isActive
                      ? 'bg-primary/10 text-primary font-600'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  <item.icon
                    size={18}
                    className={`flex-shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}`}
                  />
                  {!collapsed && (
                    <>
                      <span className="text-sm font-medium flex-1 whitespace-nowrap">
                        {item?.label}
                      </span>
                      {item?.badge !== null && (
                        <span className="ml-auto bg-secondary text-secondary-foreground text-[10px] font-700 px-1.5 py-0.5 rounded-full tabular-nums">
                          {item?.badge}
                        </span>
                      )}
                    </>
                  )}
                  {collapsed && item?.badge !== null && (
                    <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-secondary rounded-full" />
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      {/* Bottom section */}
      <div className="border-t border-border px-2 py-3 space-y-0.5 bg-background">
        <Link
          href="/notifications"
          className={`flex items-center gap-3 px-2 py-2 rounded-lg transition-all duration-150 group relative ${
            pathname === '/notifications'
              ? 'bg-primary/10 text-primary font-600'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
          title={collapsed ? 'Notificaciones' : undefined}
        >
          <Bell
            size={18}
            className={`flex-shrink-0 ${pathname === '/notifications' ? 'text-primary' : 'group-hover:text-foreground'}`}
          />
          {!collapsed && (
            <>
              <span className="text-sm font-medium flex-1">Notificaciones</span>
              {unreadCount > 0 && (
                <span className="ml-auto bg-primary text-white text-[10px] font-700 px-1.5 py-0.5 rounded-full tabular-nums">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </>
          )}
          {collapsed && unreadCount > 0 && (
            <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-primary rounded-full" />
          )}
        </Link>
        <Link
          href="/documents-dashboard"
          className="flex items-center gap-3 px-2 py-2 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-all duration-150 group"
          title={collapsed ? 'Ayuda' : undefined}
        >
          <HelpCircle size={18} className="flex-shrink-0 group-hover:text-foreground" />
          {!collapsed && <span className="text-sm font-medium">Ayuda</span>}
        </Link>
        <Link
          href="/settings/security"
          className="flex items-center gap-3 px-2 py-2 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-all duration-150 group"
          title={collapsed ? 'Seguridad' : undefined}
        >
          <Shield size={18} className="flex-shrink-0 group-hover:text-foreground" />
          {!collapsed && <span className="text-sm font-medium">Seguridad</span>}
        </Link>
        <Link
          href="/configuracion"
          className="flex items-center gap-3 px-2 py-2 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-all duration-150 group"
          title={collapsed ? 'Configuración' : undefined}
        >
          <Settings size={18} className="flex-shrink-0 group-hover:text-foreground" />
          {!collapsed && <span className="text-sm font-medium">Configuración</span>}
        </Link>

        {/* User profile */}
        <div
          className={`flex items-center gap-2 px-2 py-2 mt-1 rounded-lg border border-border bg-muted ${collapsed ? 'justify-center' : ''}`}
        >
          <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
            <span className="text-white text-[11px] font-700">{userInitials}</span>
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-xs font-600 text-foreground truncate">{userFullName}</p>
              <p className="text-[10px] text-muted-foreground truncate">{userEmail}</p>
            </div>
          )}
          {!collapsed && (
            <button
              onClick={async () => {
                await signOut();
              }}
              className="text-muted-foreground hover:text-destructive transition-colors"
              title="Cerrar sesión"
            >
              <LogOut size={14} />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
