'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Command, Menu, PanelLeftClose, PanelLeftOpen, Search, ShieldCheck, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  findPlatformNavGroup,
  findPlatformNavItem,
  permissionAllows,
  platformNavigation,
} from '@/lib/platform-admin/navigation';

type SuperadminShellProps = {
  children: ReactNode;
  role: string;
  permissions: string[];
  requiresStepUp: boolean;
};

export default function SuperadminShell({
  children,
  role,
  permissions,
  requiresStepUp,
}: SuperadminShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const current = findPlatformNavItem(pathname);
  const currentGroup = findPlatformNavGroup(pathname);
  const commandItems = useMemo(
    () =>
      platformNavigation
        .flatMap((group) => group.items.map((navItem) => ({ ...navItem, group: group.label })))
        .filter((navItem) => permissionAllows(permissions, navItem.permission))
        .filter((navItem) => {
          const query = commandQuery.trim().toLocaleLowerCase('es-MX');
          if (!query) return true;
          return `${navItem.label} ${navItem.group} ${navItem.description}`
            .toLocaleLowerCase('es-MX')
            .includes(query);
        })
        .slice(0, 12),
    [commandQuery, permissions]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
      if (event.key === 'Escape') setCommandOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const openCommandItem = (href: string) => {
    setCommandOpen(false);
    setCommandQuery('');
    router.push(href);
  };

  const navigation = (
    <nav className="scrollbar-thin flex-1 overflow-y-auto px-2 pb-5" aria-label="Control Plane">
      {platformNavigation.map((group, groupIndex) => {
        const items = group.items.filter((item) => permissionAllows(permissions, item.permission));
        if (items.length === 0) return null;
        return (
          <div key={`${group.label}-${groupIndex}`} className="mb-4">
            {group.label && !collapsed ? (
              <p className="mb-1 px-3 text-[10px] font-semibold uppercase text-slate-500">
                {group.label}
              </p>
            ) : null}
            <div className="space-y-0.5">
              {items.map((item) => {
                const active = current?.href === item.href;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    onClick={() => setMobileOpen(false)}
                    className={`flex h-9 items-center rounded-md px-3 text-sm transition-colors ${
                      active
                        ? 'bg-white text-slate-950'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    } ${collapsed ? 'justify-center' : 'gap-3'}`}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {!collapsed ? <span className="truncate">{item.label}</span> : null}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-slate-950 dark:bg-[#0d0f12] dark:text-slate-100">
      <aside
        className={`fixed inset-y-0 left-0 z-40 hidden border-r border-slate-800 bg-[#111419] transition-[width] duration-200 lg:flex lg:flex-col ${
          collapsed ? 'w-[68px]' : 'w-64'
        }`}
      >
        <div
          className={`flex h-16 items-center border-b border-slate-800 ${collapsed ? 'justify-center px-2' : 'px-4'}`}
        >
          {collapsed ? (
            <Image
              src="/assets/images/docubox-isotipo-2026.png"
              alt="Docubox"
              width={30}
              height={30}
            />
          ) : (
            <div className="flex min-w-0 items-center gap-3">
              <Image src="/assets/images/docubox-isotipo-2026.png" alt="" width={30} height={30} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">Docubox</p>
                <p className="truncate text-[11px] text-slate-400">Control Plane</p>
              </div>
            </div>
          )}
        </div>
        <div className="px-2 pt-3">{navigation}</div>
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="m-2 flex h-9 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-white"
          aria-label={collapsed ? 'Expandir menú' : 'Contraer menú'}
          title={collapsed ? 'Expandir menú' : 'Contraer menú'}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Cerrar menú"
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative flex h-full w-72 flex-col bg-[#111419] shadow-xl">
            <div className="flex h-16 items-center justify-between border-b border-slate-800 px-4">
              <div className="flex items-center gap-3">
                <Image
                  src="/assets/images/docubox-isotipo-2026.png"
                  alt=""
                  width={30}
                  height={30}
                />
                <div>
                  <p className="text-sm font-semibold text-white">Docubox</p>
                  <p className="text-[11px] text-slate-400">Control Plane</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-md text-slate-300 hover:bg-slate-800"
                aria-label="Cerrar menú"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-2 pt-3">{navigation}</div>
          </aside>
        </div>
      ) : null}

      <div
        className={`transition-[padding] duration-200 ${collapsed ? 'lg:pl-[68px]' : 'lg:pl-64'}`}
      >
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-[#121418] sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-slate-600 lg:hidden"
              aria-label="Abrir menú"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{current?.label ?? 'Inicio'}</p>
              <p className="truncate text-xs text-slate-500">
                {currentGroup?.label || 'Control Plane'} / {current?.label ?? 'Inicio'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCommandOpen(true)}
              className="hidden h-9 min-w-52 items-center gap-2 rounded-md border border-slate-200 px-3 text-left text-sm text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800 md:flex"
              aria-label="Abrir búsqueda global"
            >
              <Search className="h-4 w-4" />
              <span className="flex-1">Buscar en Control Plane</span>
              <span className="text-xs">Ctrl K</span>
            </button>
            {requiresStepUp ? (
              <span className="hidden items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800 sm:flex">
                <ShieldCheck className="h-3.5 w-3.5" />
                Reautenticación crítica
              </span>
            ) : null}
            <span className="max-w-48 truncate rounded-md bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              {role}
            </span>
            <Link
              href="/inicio"
              className="hidden h-9 items-center rounded-md border border-slate-200 px-3 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 sm:flex"
            >
              Ir a Docubox
            </Link>
          </div>
        </header>
        <main className="min-h-[calc(100vh-64px)]">{children}</main>
      </div>

      {commandOpen ? (
        <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/50 px-4 pt-[12vh]">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Cerrar búsqueda"
            onClick={() => setCommandOpen(false)}
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Búsqueda global del Control Plane"
            className="relative w-full max-w-2xl overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-[#121418]"
          >
            <div className="flex h-14 items-center gap-3 border-b border-slate-200 px-4 dark:border-slate-700">
              <Search className="h-5 w-5 text-slate-400" />
              <input
                autoFocus
                value={commandQuery}
                onChange={(event) => setCommandQuery(event.target.value)}
                placeholder="Buscar módulo autorizado..."
                className="h-full flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-slate-400 focus:ring-0"
              />
              <button
                type="button"
                onClick={() => setCommandOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Cerrar búsqueda"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[55vh] overflow-y-auto p-2">
              {commandItems.map((navItem) => {
                const Icon = navItem.icon;
                return (
                  <button
                    key={navItem.href}
                    type="button"
                    onClick={() => openCommandItem(navItem.href)}
                    className="flex w-full items-center gap-3 rounded-md px-3 py-3 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{navItem.label}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {navItem.group || 'Inicio'} · {navItem.description}
                      </span>
                    </span>
                  </button>
                );
              })}
              {commandItems.length === 0 ? (
                <p className="px-3 py-10 text-center text-sm text-slate-500">
                  No hay módulos autorizados que coincidan.
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-2 border-t border-slate-200 px-4 py-2 text-xs text-slate-500 dark:border-slate-700">
              <Command className="h-3.5 w-3.5" />
              La búsqueda solo incluye módulos permitidos para tu rol.
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
