'use client';

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Building2, ChevronRight, Loader2, LockKeyhole, Sparkles } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { CollaborationProvider, useCollaboration } from '@/contexts/CollaborationContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { collaborationAccessLabel } from '@/lib/collaboration/domain';
import { collaborationNavigation } from '@/lib/collaboration/navigation';
import { useCollaborationApi } from '@/lib/collaboration/client';

function ShellContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { activeWorkspace, loading: workspaceLoading, refreshWorkspaces } = useWorkspace();
  const { access, loading, refresh, can } = useCollaboration();
  const api = useCollaborationApi();
  const [activating, setActivating] = useState(false);
  const [activationError, setActivationError] = useState('');
  const canManageSubscription = access.canManageSubscription
    || access.membershipRole === 'owner'
    || access.permissions.includes('subscription.manage_addons');

  const visibleNavigation = useMemo(
    () => collaborationNavigation.filter((item) => can(item.permission)),
    [can],
  );
  const standardNavigation = useMemo(
    () => visibleNavigation.filter((item) => item.classification !== 'pro'),
    [visibleNavigation],
  );
  const proNavigation = useMemo(() => {
    const activeStatuses = ['trialing', 'active', 'past_due'];
    const hasActiveProAccess =
      access.commercialTier === 'pro'
      || visibleNavigation.some(
        (item) =>
          item.classification === 'pro'
          && 'entitlement' in item
          && activeStatuses.includes(access.entitlements[item.entitlement]?.status || ''),
      );
    return hasActiveProAccess
      ? visibleNavigation.filter((item) => item.classification === 'pro')
      : [];
  }, [access.commercialTier, access.entitlements, visibleNavigation]);

  const renderNavigationItem = (item: (typeof collaborationNavigation)[number]) => {
    const active =
      pathname === item.href
      || (item.href !== '/colabora' && pathname.startsWith(`${item.href}/`));
    const proAvailable =
      item.classification !== 'pro'
      || ('entitlement' in item
        && ['trialing', 'active', 'past_due'].includes(
          access.entitlements[item.entitlement]?.status || '',
        ));

    return (
      <Link
        key={item.href}
        href={item.href}
        aria-disabled={!proAvailable}
        className={`group flex min-h-10 shrink-0 items-center gap-3 rounded-md px-3 text-sm transition-colors lg:mb-0.5 ${
          active
            ? 'bg-primary/10 font-medium text-primary'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        }`}
      >
        <item.icon size={17} />
        <span className="whitespace-nowrap lg:flex-1">{item.label}</span>
        {item.classification === 'pro' && (
          <span
            className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
              proAvailable
                ? 'border-primary/20 bg-primary/10 text-primary'
                : 'border-border bg-muted text-muted-foreground'
            }`}
          >
            PRO
          </span>
        )}
        <ChevronRight
          size={14}
          className={`hidden lg:block ${
            active ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'
          }`}
        />
      </Link>
    );
  };

  const startTrial = async () => {
    if (!activeWorkspace?.id) return;
    setActivating(true);
    setActivationError('');
    try {
      await api('/api/colabora/access', {
        method: 'POST',
        body: JSON.stringify({ workspace_id: activeWorkspace.id, action: 'start_trial', product_key: 'docubox_colabora' }),
      });
      await Promise.all([refresh(), refreshWorkspaces()]);
      router.push('/colabora/configuracion-inicial');
    } catch (error) {
      setActivationError(error instanceof Error ? error.message : 'No se pudo iniciar la prueba.');
    } finally {
      setActivating(false);
    }
  };

  if (loading || workspaceLoading) {
    return <AppLayout noPadding><div className="min-h-[520px] grid place-items-center"><div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={17} className="animate-spin" /> Cargando Colabora...</div></div></AppLayout>;
  }

  if (!activeWorkspace || activeWorkspace.workspaceType !== 'business') {
    return <AppLayout noPadding><div className="min-h-[560px] grid place-items-center bg-slate-50 px-4 dark:bg-background"><div className="w-full max-w-lg rounded-lg border border-border bg-background p-8 text-center"><Building2 size={34} className="mx-auto text-primary" /><h1 className="mt-4 text-xl font-medium text-foreground">Colabora vive en una organizacion</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Selecciona un espacio empresarial activo para usar tareas, revisiones y salas compartidas.</p><Link href="/inicio" className="mt-5 inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-white">Volver al inicio</Link></div></div></AppLayout>;
  }

  if (!access.accessible) {
    return <AppLayout noPadding><div className="min-h-[560px] grid place-items-center bg-slate-50 px-4 dark:bg-background"><div className="w-full max-w-2xl overflow-hidden rounded-lg border border-border bg-background"><div className="border-b border-border px-7 py-6"><div className="flex h-11 w-11 items-center justify-center rounded-md bg-primary/10 text-primary"><Sparkles size={23} /></div><h1 className="mt-5 text-2xl font-medium text-foreground">Docubox Colabora</h1><p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Un centro de trabajo para coordinar tareas, revisar versiones, solicitar documentos y colaborar con contrapartes sin perder trazabilidad.</p></div><div className="grid gap-px bg-border sm:grid-cols-3"><div className="bg-background p-5"><p className="text-sm font-medium">Trabajo coordinado</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Responsables, fechas, bloqueos y dependencias.</p></div><div className="bg-background p-5"><p className="text-sm font-medium">Revision medible</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Versiones, comentarios formales y aprobaciones.</p></div><div className="bg-background p-5"><p className="text-sm font-medium">Control empresarial</p><p className="mt-1 text-xs leading-5 text-muted-foreground">RBAC, aislamiento por organizacion y auditoria.</p></div></div><div className="flex flex-col gap-3 px-7 py-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium text-foreground">{canManageSubscription ? `Prueba disponible para ${activeWorkspace.name}` : 'Complemento no disponible para tu perfil'}</p><p className="text-xs text-muted-foreground">{canManageSubscription ? 'La activacion queda registrada en el backend.' : 'Contacta al propietario o al administrador de facturacion de tu organizacion.'}</p>{activationError && <p className="mt-2 text-xs text-red-600">{activationError}</p>}</div>{canManageSubscription && <button onClick={startTrial} disabled={activating} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white disabled:opacity-60">{activating && <Loader2 size={15} className="animate-spin" />} Iniciar prueba</button>}</div></div></div></AppLayout>;
  }

  return (
    <AppLayout noPadding>
      <div className="-mx-4 -my-4 min-h-[calc(100vh-104px)] bg-slate-50 md:-my-6 dark:bg-background">
        <header className="border-b border-border bg-background px-5 py-5 lg:px-7">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div><h1 className="text-2xl font-medium text-foreground">Docubox Colabora</h1><p className="mt-1 text-sm text-muted-foreground">Trabajo documental de {activeWorkspace.name}</p></div>
            <div className="flex items-center gap-2"><span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${access.writeAllowed ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{collaborationAccessLabel(access)}</span>{!access.writeAllowed && <LockKeyhole size={16} className="text-amber-600" />}</div>
          </div>
        </header>
        <div className="lg:grid lg:grid-cols-[238px_minmax(0,1fr)]">
          <aside className="border-r border-border bg-background">
            <nav className="flex gap-1 overflow-x-auto border-b border-border p-3 lg:sticky lg:top-[104px] lg:block lg:max-h-[calc(100vh-104px)] lg:overflow-y-auto lg:border-b-0">
              <p className="hidden px-3 pb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground lg:block">
                Colabora
              </p>
              {standardNavigation.map(renderNavigationItem)}
              {proNavigation.length > 0 && (
                <>
                  <div className="mx-2 h-8 w-px shrink-0 self-center bg-border lg:my-3 lg:h-auto lg:w-auto lg:border-t lg:bg-transparent" />
                  <p className="shrink-0 self-center px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground lg:mb-2 lg:self-auto lg:px-3">
                    Colabora Pro
                  </p>
                  {proNavigation.map(renderNavigationItem)}
                </>
              )}
            </nav>
          </aside>
          <main className="min-w-0 p-4 sm:p-5 lg:p-7">{children}</main>
        </div>
      </div>
    </AppLayout>
  );
}

export default function ColaboraShell({ children }: { children: ReactNode }) {
  return <CollaborationProvider><ShellContent>{children}</ShellContent></CollaborationProvider>;
}
