'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  BadgeCheck,
  Building2,
  ChevronRight,
  FileKey2,
  Fingerprint,
  IdCard,
  Landmark,
  Library,
  Network,
  Palette,
  ReceiptText,
  ScrollText,
  ShieldCheck,
  ShieldAlert,
  Users,
  UsersRound,
  Workflow,
} from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { createClient } from '@/lib/supabase/client';
import {
  canAccessOrganizationSection,
  filterOrganizationNavigation,
} from '@/lib/organization/navigation';

const navigation = [
  { href: '/organizacion', label: 'Resumen', icon: Building2, permission: 'organization.read' },
  {
    href: '/organizacion/perfil',
    label: 'Perfil de la organización',
    icon: Landmark,
    permission: 'organization.read',
  },
  { href: '/organizacion/miembros', label: 'Miembros', icon: Users, permission: 'members.read' },
  {
    href: '/organizacion/continuidad',
    label: 'Continuidad',
    icon: ShieldAlert,
    permission: 'members.offboard',
  },
  {
    href: '/organizacion/equipos',
    label: 'Equipos y áreas',
    icon: UsersRound,
    permission: 'teams.read',
  },
  {
    href: '/organizacion/roles',
    label: 'Roles y permisos',
    icon: ShieldCheck,
    permission: 'roles.read',
  },
  {
    href: '/organizacion/directorio',
    label: 'Directorio',
    icon: IdCard,
    permission: 'directory.read',
  },
  {
    href: '/organizacion/facultades',
    label: 'Facultades',
    icon: BadgeCheck,
    permission: 'authorities.read',
  },
  {
    href: '/organizacion/flujos',
    label: 'Flujos de aprobación',
    icon: Workflow,
    permission: 'workflows.read',
  },
  {
    href: '/organizacion/politicas-firma',
    label: 'Políticas de firma',
    icon: FileKey2,
    permission: 'signature_policies.read',
  },
  {
    href: '/organizacion/recursos',
    label: 'Plantillas y recursos',
    icon: Library,
    permission: 'resources.read',
  },
  {
    href: '/organizacion/seguridad',
    label: 'Seguridad',
    icon: Fingerprint,
    permission: 'security.read',
  },
  {
    href: '/organizacion/certificados',
    label: 'Certificados',
    icon: ScrollText,
    permission: 'certificates.read',
  },
  {
    href: '/organizacion/integraciones',
    label: 'Integraciones',
    icon: Network,
    permission: 'integrations.read',
  },
  {
    href: '/organizacion/marca-comunicaciones',
    label: 'Marca y comunicaciones',
    icon: Palette,
    permission: 'branding.read',
  },
  {
    href: '/organizacion/plan-consumo',
    label: 'Plan y consumo',
    icon: ReceiptText,
    permission: 'billing.read',
  },
  { href: '/organizacion/auditoria', label: 'Auditoría', icon: Activity, permission: 'audit.read' },
];

export default function OrganizationShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { activeWorkspace, loading } = useWorkspace();
  const supabase = useMemo(() => createClient(), []);
  const [permissionKeys, setPermissionKeys] = useState<string[]>([]);
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);

  useEffect(() => {
    if (!activeWorkspace?.id || activeWorkspace.workspaceType !== 'business') {
      setPermissionKeys([]);
      setPermissionsLoaded(false);
      return;
    }
    if (activeWorkspace.role === 'owner' || activeWorkspace.role === 'admin') {
      setPermissionsLoaded(true);
      return;
    }
    let active = true;
    setPermissionsLoaded(false);
    supabase
      .rpc('get_my_organization_permissions', { ws_id: activeWorkspace.id })
      .then(({ data, error }) => {
        if (!active) return;
        setPermissionKeys(
          error ? [] : (data || []).map((item: { permission_key: string }) => item.permission_key)
        );
        setPermissionsLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [activeWorkspace?.id, activeWorkspace?.role, activeWorkspace?.workspaceType, supabase]);

  const visibleNavigation = useMemo(() => {
    if (!activeWorkspace) return [];
    const elevated = activeWorkspace.role === 'owner' || activeWorkspace.role === 'admin';
    if (!elevated && !permissionsLoaded) return [];
    return filterOrganizationNavigation(navigation, activeWorkspace.role, permissionKeys);
  }, [activeWorkspace, permissionKeys, permissionsLoaded]);
  const routePermission = useMemo(
    () =>
      navigation
        .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
        .sort((left, right) => right.href.length - left.href.length)[0]?.permission,
    [pathname]
  );
  const routeAllowed = activeWorkspace
    ? canAccessOrganizationSection(activeWorkspace.role, permissionKeys, routePermission)
    : false;

  if (loading) {
    return (
      <AppLayout noPadding>
        <div className="min-h-[420px] grid place-items-center text-sm text-muted-foreground">
          Cargando organización...
        </div>
      </AppLayout>
    );
  }

  if (!activeWorkspace || activeWorkspace.workspaceType !== 'business') {
    return (
      <AppLayout noPadding>
        <div className="max-w-xl mx-auto mt-16 bg-background border border-border rounded-lg p-8 text-center">
          <Building2 className="mx-auto text-muted-foreground" size={32} />
          <h1 className="mt-4 text-xl font-semibold text-foreground">
            Selecciona una organización
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Esta consola está disponible únicamente para espacios empresariales.
          </p>
          <Link
            href="/inicio"
            className="inline-flex mt-5 h-10 items-center px-4 rounded-md bg-primary text-white text-sm font-medium"
          >
            Volver al inicio
          </Link>
        </div>
      </AppLayout>
    );
  }

  if (permissionsLoaded && !routeAllowed) {
    return (
      <AppLayout noPadding>
        <div className="min-h-[520px] grid place-items-center bg-slate-50 px-5 dark:bg-background">
          <div className="w-full max-w-lg rounded-lg border border-border bg-background p-8 text-center">
            <ShieldAlert className="mx-auto text-amber-500" size={32} />
            <p className="mt-4 text-xs font-medium uppercase text-muted-foreground">
              Acceso restringido
            </p>
            <h1 className="mt-2 text-xl font-semibold text-foreground">
              No tienes permiso para consultar esta sección
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Solicita a un administrador el alcance correspondiente o vuelve al resumen de la
              organización.
            </p>
            <Link
              href="/organizacion"
              className="mt-5 inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-white"
            >
              Ir al resumen
            </Link>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout noPadding>
      <div className="-mx-4 -my-4 md:-my-6 min-h-[calc(100vh-104px)] bg-slate-50 dark:bg-background">
        <header className="bg-background border-b border-border px-5 lg:px-7 py-5">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-medium text-foreground truncate">
                {activeWorkspace.name}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Administración de la organización
              </p>
            </div>
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-emerald-50 text-emerald-700 px-3 py-1 text-xs font-medium border border-emerald-200">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Acceso{' '}
              {activeWorkspace.role}
            </span>
          </div>
        </header>
        <div className="lg:grid lg:grid-cols-[250px_minmax(0,1fr)] min-h-[calc(100vh-199px)]">
          <aside className="bg-background border-r border-border">
            <div className="lg:hidden overflow-x-auto border-b border-border px-3 py-2 flex gap-1">
              {visibleNavigation.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`whitespace-nowrap px-3 py-2 rounded-md text-sm ${active ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground'}`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
            <nav className="hidden lg:block p-3 sticky top-[104px] max-h-[calc(100vh-104px)] overflow-y-auto">
              {visibleNavigation.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`group flex items-center gap-3 min-h-10 px-3 rounded-md mb-0.5 text-sm transition-colors ${active ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                  >
                    <item.icon size={17} className="shrink-0" />
                    <span className="flex-1 truncate">{item.label}</span>
                    <ChevronRight
                      size={14}
                      className={`shrink-0 ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'}`}
                    />
                  </Link>
                );
              })}
            </nav>
          </aside>
          <main className="min-w-0 p-4 sm:p-5 lg:p-7">{children}</main>
        </div>
      </div>
    </AppLayout>
  );
}
