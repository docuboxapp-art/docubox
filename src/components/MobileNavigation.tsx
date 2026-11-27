'use client';

import { useEffect, useRef, useState, type ElementType } from 'react';
import Link from 'next/link';
import { Building2, Check, ChevronDown, LogOut, Moon, Sun, User, UserPlus, X } from 'lucide-react';
import type { Workspace } from '@/contexts/WorkspaceContext';
import AppLogo from './ui/AppLogo';

type NavigationGroup = {
  label: string;
  items: { href: string; label: string; icon: ElementType }[];
};

type WorkspaceOption = Pick<Workspace, 'id' | 'name' | 'workspaceType'>;

const workspaceTypes = { personal: 'Espacio personal', business: 'Organización' } as const;
const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary';

export default function MobileNavigation({
  groups,
  workspaces,
  workspaceId,
  workspaceLoading,
  onWorkspaceChange,
  pathname,
  isActive,
  onClose,
  isDark,
  onThemeChange,
  onJoinWorkspace,
  onSignOut,
}: {
  groups: NavigationGroup[];
  workspaces: WorkspaceOption[];
  workspaceId?: string;
  workspaceLoading: boolean;
  onWorkspaceChange: (id: string) => void;
  pathname: string;
  isActive: (href: string) => boolean;
  onClose: () => void;
  isDark: boolean;
  onThemeChange: () => void;
  onJoinWorkspace: () => void;
  onSignOut: () => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const workspaceTriggerRef = useRef<HTMLButtonElement>(null);
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const [signOutStatus, setSignOutStatus] = useState<'idle' | 'pending' | 'error'>('idle');
  const activeWorkspace = workspaces.find((workspace) => workspace.id === workspaceId);
  const WorkspaceIcon = activeWorkspace?.workspaceType === 'business' ? Building2 : User;
  const workspaceName =
    activeWorkspace?.name ||
    (workspaceLoading
      ? 'Cargando espacios…'
      : workspaces.length
        ? 'Selecciona un espacio'
        : 'Sin espacio asignado');
  const activeHref = groups
    .flatMap((group) => group.items)
    .reduce((current, { href }) => {
      if (href.length <= current.length) return current;
      return isActive(href) || pathname.startsWith(`${href}/`) ? href : current;
    }, '');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const desktop = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = () => {
      if (desktop.matches) {
        dialog.close();
        onClose();
      }
    };
    desktop.addEventListener('change', closeOnDesktop);
    closeOnDesktop();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      desktop.removeEventListener('change', closeOnDesktop);
    };
  }, [onClose]);

  function closeMenu() {
    dialogRef.current?.close();
    onClose();
  }

  function closeWorkspacePicker() {
    setWorkspacePickerOpen(false);
    workspaceTriggerRef.current?.focus();
  }

  async function handleSignOut() {
    setSignOutStatus('pending');
    try {
      await onSignOut();
      closeMenu();
    } catch {
      setSignOutStatus('error');
    }
  }

  return (
    <dialog
      id="mobile-navigation"
      ref={dialogRef}
      aria-labelledby="mobile-navigation-title"
      className="mobile-navigation fixed inset-y-0 left-0 right-auto m-0 h-dvh max-h-dvh w-[calc(100%_-_1.25rem)] max-w-[380px] overflow-hidden rounded-r-2xl border-0 bg-card p-0 text-foreground shadow-2xl backdrop:bg-slate-950/50"
      onCancel={(event) => {
        event.preventDefault();
        if (workspacePickerOpen) closeWorkspacePicker();
        else closeMenu();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const { left, top, right, bottom } = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < left ||
          event.clientX > right ||
          event.clientY < top ||
          event.clientY > bottom
        )
          closeMenu();
      }}
    >
      <div className="flex h-full flex-col pl-[env(safe-area-inset-left)]">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 pb-2.5 pt-[max(.625rem,env(safe-area-inset-top))]">
          <h2 id="mobile-navigation-title" className="sr-only">
            Menú de Docubox
          </h2>
          <div aria-hidden="true">
            <AppLogo imageClassName="h-auto w-[114px]" />
          </div>
          <button
            type="button"
            onClick={closeMenu}
            aria-label="Cerrar menú"
            className={`grid size-11 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground hover:text-foreground ${focusRing}`}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3 pt-3">
          <section
            aria-label="Espacio de trabajo"
            className="mb-4 overflow-hidden rounded-xl border border-border bg-muted/50"
          >
            <button
              ref={workspaceTriggerRef}
              type="button"
              aria-label={`Opciones del espacio de trabajo. ${workspaceName}`}
              aria-expanded={workspacePickerOpen}
              aria-controls="mobile-workspace-options"
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-primary/5 ${workspacePickerOpen ? 'rounded-b-none' : ''} ${focusRing}`}
              onClick={() => setWorkspacePickerOpen((open) => !open)}
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary dark:text-blue-300">
                <WorkspaceIcon size={19} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium text-muted-foreground">
                  {activeWorkspace
                    ? workspaceTypes[activeWorkspace.workspaceType]
                    : 'Espacio de trabajo'}
                </span>
                <span className="mt-0.5 block break-words text-sm font-semibold leading-snug">
                  {workspaceName}
                </span>
              </span>
              <ChevronDown
                size={16}
                aria-hidden="true"
                className={`shrink-0 text-muted-foreground ${workspacePickerOpen ? 'rotate-180' : ''}`}
              />
            </button>
            <div
              id="mobile-workspace-options"
              hidden={!workspacePickerOpen}
              className="border-t border-border bg-card"
            >
              {workspaces.length > 0 && (
                <ul className="max-h-[35dvh] overflow-y-auto overscroll-contain border-b border-border p-1.5">
                  {workspaces.map((workspace) => {
                    const selected = workspace.id === workspaceId;
                    const Icon = workspace.workspaceType === 'business' ? Building2 : User;
                    return (
                      <li key={workspace.id}>
                        <button
                          type="button"
                          aria-pressed={selected}
                          onClick={() => {
                            if (!selected) onWorkspaceChange(workspace.id);
                            closeWorkspacePicker();
                          }}
                          className={`flex min-h-11 w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left ${focusRing} ${selected ? 'bg-primary/10 text-primary dark:text-blue-300' : 'hover:bg-muted'}`}
                        >
                          <Icon size={16} className="shrink-0" aria-hidden="true" />
                          <span className="min-w-0 flex-1 break-words text-sm">
                            {workspace.name}
                            <span className="block text-xs text-muted-foreground">
                              {workspaceTypes[workspace.workspaceType]}
                            </span>
                          </span>
                          {selected && <Check size={16} className="shrink-0" aria-hidden="true" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <button
                type="button"
                onClick={() => {
                  closeMenu();
                  onJoinWorkspace();
                }}
                className={`flex min-h-11 w-full items-center gap-2 rounded-b-xl px-3 text-left text-sm font-medium text-primary hover:bg-primary/5 dark:text-blue-300 ${focusRing}`}
              >
                <UserPlus size={17} className="shrink-0" aria-hidden="true" />
                Unirse a un espacio de trabajo
              </button>
            </div>
          </section>

          <nav aria-label="Navegación móvil" className="space-y-3.5">
            {groups.map((group) => (
              <div key={group.label}>
                <p className="mb-1 px-3 text-xs font-medium text-muted-foreground">{group.label}</p>
                <ul className="space-y-0.5">
                  {group.items.map(({ href, label, icon: Icon }) => {
                    const selected = href === activeHref;
                    return (
                      <li key={href}>
                        <Link
                          href={href}
                          prefetch={false}
                          onClick={closeMenu}
                          aria-current={selected ? 'page' : undefined}
                          className={`flex min-h-11 items-center gap-2.5 rounded-lg px-3 py-2 text-sm ${focusRing} ${selected ? 'bg-primary/10 font-semibold text-primary dark:text-blue-300' : 'font-medium text-foreground hover:bg-muted'}`}
                        >
                          <Icon
                            size={18}
                            className={`shrink-0 ${selected ? '' : 'text-muted-foreground'}`}
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1">{label}</span>
                          {selected && <Check size={16} className="shrink-0" aria-hidden="true" />}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <footer className="shrink-0 border-t border-border bg-card px-3 pt-2.5 pb-[max(.625rem,env(safe-area-inset-bottom))]">
          {signOutStatus === 'error' && (
            <p role="alert" className="mb-2 px-1 text-xs text-red-700 dark:text-red-300">
              No se pudo cerrar la sesión. Intenta de nuevo.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onThemeChange}
              className={`flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-muted/50 px-2 py-2 text-xs font-medium hover:bg-muted ${focusRing}`}
            >
              {isDark ? (
                <Sun size={17} aria-hidden="true" />
              ) : (
                <Moon size={17} aria-hidden="true" />
              )}
              {isDark ? 'Tema claro' : 'Tema oscuro'}
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signOutStatus === 'pending'}
              className={`flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border px-2 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-wait disabled:opacity-70 dark:text-red-300 dark:hover:bg-red-950/40 ${focusRing}`}
            >
              <LogOut size={17} className="shrink-0" aria-hidden="true" />
              {signOutStatus === 'pending' ? 'Cerrando sesión…' : 'Cerrar sesión'}
            </button>
          </div>
        </footer>
      </div>
    </dialog>
  );
}
