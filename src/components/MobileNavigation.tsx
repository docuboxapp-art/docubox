'use client';

import { useEffect, useRef, type ElementType } from 'react';
import Link from 'next/link';
import { Check, ChevronRight, Maximize2, Moon, Sun, UserPlus, X } from 'lucide-react';

type Item = { href: string; label: string; icon: ElementType };

export default function MobileNavigation({
  items,
  workspaces,
  workspaceId,
  onWorkspaceChange,
  isActive,
  onClose,
  isDark,
  onThemeChange,
  onJoinWorkspace,
  onToggleFullscreen,
}: {
  items: Item[];
  workspaces: { id: string; name: string }[];
  workspaceId?: string;
  onWorkspaceChange: (id: string) => void;
  isActive: (href: string) => boolean;
  onClose: () => void;
  isDark: boolean;
  onThemeChange: () => void;
  onJoinWorkspace: () => void;
  onToggleFullscreen: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const media = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = () => {
      if (media.matches) onClose();
    };
    media.addEventListener('change', closeOnDesktop);
    return () => {
      dialog?.close();
      document.body.style.overflow = previous;
      media.removeEventListener('change', closeOnDesktop);
    };
  }, [onClose]);
  return (
    <dialog
      ref={ref}
      aria-labelledby="mobile-navigation-title"
      className="mobile-navigation m-0 h-dvh max-h-dvh w-[min(88vw,360px)] max-w-none border-0 bg-card p-0 text-foreground shadow-2xl backdrop:bg-slate-950/40 backdrop:backdrop-blur-sm"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX > bounds.right || event.clientY > bounds.bottom) onClose();
      }}
    >
      <div className="flex h-full flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <div>
            <p className="text-xs font-medium text-primary">Docubox</p>
            <h2 id="mobile-navigation-title" className="text-lg font-semibold">
              Tu espacio de trabajo
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar menú"
            className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-muted"
          >
            <X size={20} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          <label className="mb-5 block rounded-xl border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
            Espacio de trabajo
            <select
              aria-label="Cambiar espacio de trabajo"
              value={workspaceId || ''}
              onChange={(event) => onWorkspaceChange(event.target.value)}
              className="mt-2 block min-h-11 w-full rounded-lg border border-border bg-card px-2 text-sm font-medium text-foreground"
            >
              {!workspaceId && (
                <option value="" disabled>
                  Seleccionar espacio
                </option>
              )}
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => {
              onClose();
              onJoinWorkspace();
            }}
            className="mb-4 flex min-h-11 w-full items-center gap-2 rounded-lg border border-dashed border-border px-3 text-left text-xs text-primary"
          >
            <UserPlus size={17} />
            Unirse a espacio de trabajo
          </button>
          <nav aria-label="Navegación móvil" className="space-y-1">
            {items.map(({ href, label, icon: Icon }) => (
              <Link
                key={label}
                href={href}
                prefetch={false}
                onClick={onClose}
                aria-current={isActive(href) ? 'page' : undefined}
                className={`flex min-h-12 items-center gap-3 rounded-xl px-3 py-3 text-sm ${isActive(href) ? 'bg-primary/10 font-semibold text-primary' : 'font-medium text-muted-foreground hover:bg-muted'}`}
              >
                <Icon size={19} className="shrink-0" />
                <span className="flex-1">{label}</span>
                {isActive(href) ? (
                  <Check size={16} />
                ) : (
                  <ChevronRight size={15} className="opacity-40" />
                )}
              </Link>
            ))}
          </nav>
        </div>
        <footer className="shrink-0 border-t border-border p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => {
              onClose();
              onToggleFullscreen();
            }}
            className="mb-2 flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium"
          >
            <Maximize2 size={18} />
            Ampliar o restaurar pantalla
          </button>
          <button
            type="button"
            onClick={onThemeChange}
            className="flex min-h-11 w-full items-center gap-3 rounded-xl bg-muted px-3 text-sm font-medium"
          >
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
            {isDark ? 'Usar tema claro' : 'Usar tema oscuro'}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
