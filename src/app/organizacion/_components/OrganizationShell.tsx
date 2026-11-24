'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowUpRight, Building2, ChevronRight, ShieldAlert } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { organizationSections } from '@/lib/organization/sections';
import OrganizationNavigation from './OrganizationNavigation';
import { OrganizationAccessProvider } from './OrganizationAccessContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { createClient } from '@/lib/supabase/client';
import {
  canAccessOrganizationSection,
  filterOrganizationNavigation,
  organizationRouteMatches,
} from '@/lib/organization/navigation';

const navigation = organizationSections;

export default function OrganizationShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { activeWorkspace, loading } = useWorkspace();
  const supabase = useMemo(() => createClient(), []);
  const [permissionKeys, setPermissionKeys] = useState<string[]>([]);
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const [permissionScope, setPermissionScope] = useState('');
  const [permissionError, setPermissionError] = useState(false);
  const [permissionRetry, setPermissionRetry] = useState(0);

  useEffect(() => {
    if (!activeWorkspace?.id || activeWorkspace.workspaceType !== 'business') {
      return;
    }
    if (activeWorkspace.role === 'owner' || activeWorkspace.role === 'admin') {
      return;
    }
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    Promise.resolve()
      .then(() => {
        if (!active) return null;
        setPermissionsLoaded(false);
        setPermissionError(false);
        return supabase
          .rpc('get_my_organization_permissions', { ws_id: activeWorkspace.id })
          .abortSignal(controller.signal);
      })
      .then((result) => {
        if (!active || !result) return;
        const { data, error } = result;
        if (error) throw error;
        setPermissionKeys(
          (data || []).map((item: { permission_key: string }) => item.permission_key)
        );
        setPermissionScope(`${activeWorkspace.id}:${activeWorkspace.role}`);
        setPermissionsLoaded(true);
      })
      .catch(() => {
        if (!active) return;
        setPermissionKeys([]);
        setPermissionError(true);
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [
    activeWorkspace?.id,
    activeWorkspace?.role,
    activeWorkspace?.workspaceType,
    supabase,
    permissionRetry,
  ]);

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

  const currentSection = navigation
    .filter((item) => organizationRouteMatches(pathname, item.href))
    .sort((a, b) => b.href.length - a.href.length)[0];
  const elevated = activeWorkspace?.role === 'owner' || activeWorkspace?.role === 'admin';
  const permissionsReady =
    elevated ||
    (permissionsLoaded && permissionScope === `${activeWorkspace?.id}:${activeWorkspace?.role}`);

  if (permissionError && !elevated && activeWorkspace?.workspaceType === 'business') {
    return (
      <AppLayout noPadding>
        <div className="min-h-[420px] flex flex-col items-center justify-center gap-4 p-5 text-center">
          <p role="alert" className="text-sm text-muted-foreground">
            No se pudieron comprobar los permisos de la organización.
          </p>
          <button
            type="button"
            onClick={() => setPermissionRetry((value) => value + 1)}
            className="h-10 rounded-md border border-border px-4 text-sm font-medium"
          >
            Volver a intentar
          </button>
        </div>
      </AppLayout>
    );
  }

  if (loading || (activeWorkspace?.workspaceType === 'business' && !permissionsReady)) {
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
    <AppLayout>
      <div className="organization-console bg-slate-50 dark:bg-background">
        <header className="organization-header bg-background border-b border-border px-5 lg:px-7 py-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <span className="organization-workspace-mark">
                <Building2 size={21} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="organization-eyebrow">Consola de organización</p>
                <h1 className="text-lg font-medium text-foreground truncate">
                  {activeWorkspace.name}
                </h1>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <Link
                href="/mi-espacio"
                prefetch={false}
                className="organization-workspace-link hidden xl:inline-flex"
              >
                Ir a mi espacio
                <ArrowUpRight size={15} aria-hidden="true" />
              </Link>
              <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-primary/5 text-primary px-3 py-1 text-xs font-medium border border-primary/10">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Acceso{' '}
                {{ owner: 'de propietario', admin: 'de administrador', member: 'de miembro' }[
                  activeWorkspace.role
                ] || activeWorkspace.role}
              </span>
            </div>
          </div>
        </header>
        <div className="lg:grid lg:grid-cols-[258px_minmax(0,1fr)] min-h-[calc(100vh-199px)]">
          <OrganizationNavigation items={visibleNavigation} pathname={pathname} />
          <main key={activeWorkspace.id} className="organization-main min-w-0 p-4 sm:p-5 lg:p-7">
            <OrganizationAccessProvider role={activeWorkspace.role} permissionKeys={permissionKeys}>
              <nav aria-label="Ruta de navegación" className="organization-breadcrumb">
                <Link href="/organizacion" prefetch={false}>
                  Administración
                </Link>
                <ChevronRight size={12} aria-hidden="true" />
                <span aria-current="page">{currentSection?.label || 'Organización'}</span>
              </nav>
              {children}
            </OrganizationAccessProvider>
          </main>
        </div>
      </div>
    </AppLayout>
  );
}
