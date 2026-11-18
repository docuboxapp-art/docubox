'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { ChevronRight, EllipsisVertical, Eye, Folder, Star } from 'lucide-react';

export default function CaseRowActions({
  id,
  title,
  favorite,
  moveDisabled,
  favoriteDisabled,
  onMove,
  onFavorite,
  onPreview,
}: {
  id: string;
  title: string;
  favorite: boolean;
  moveDisabled: boolean;
  favoriteDisabled: boolean;
  onMove: () => void;
  onFavorite: () => void;
  onPreview: () => void;
}) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const open = position !== null;
  function close(restoreFocus = false) {
    setPosition(null);
    if (restoreFocus) trigger.current?.focus();
  }
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menu.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        setPosition(null);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setPosition(null);
        trigger.current?.focus();
      }
    };
    const reposition = (event: Event) => {
      if (event.target instanceof Node && menu.current?.contains(event.target)) return;
      setPosition(null);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);
  function toggle() {
    if (open) return close();
    const bounds = trigger.current?.getBoundingClientRect();
    if (!bounds) return;
    const height = 192;
    setPosition({
      left: Math.max(8, Math.min(bounds.right - 224, window.innerWidth - 232)),
      top:
        bounds.bottom + height + 8 > window.innerHeight
          ? Math.max(8, bounds.top - height - 4)
          : bounds.bottom + 4,
    });
  }
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    const items = [
      ...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') || []),
    ];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Tab') {
      close(true);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    items[
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    ]?.focus();
  }
  const itemClass =
    'flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-muted focus:bg-muted focus:outline-none disabled:opacity-40';
  return (
    <div className="case-row-actions flex justify-end">
      <button
        ref={trigger}
        type="button"
        aria-label={`Acciones de ${title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (!open) toggle();
          }
        }}
        className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <EllipsisVertical size={16} />
      </button>
      {position &&
        createPortal(
          <div
            id={menuId}
            ref={menu}
            role="menu"
            aria-label={`Acciones de ${title}`}
            onKeyDown={navigate}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) close();
            }}
            className="fixed z-[300] max-h-[calc(100dvh-16px)] w-56 max-w-[calc(100vw-16px)] overflow-y-auto rounded-xl border border-border bg-white py-1 shadow-xl dark:bg-card"
            style={position}
          >
            <Link
              role="menuitem"
              href={`/expedientes/${id}`}
              onClick={() => close()}
              className={itemClass}
            >
              <ChevronRight size={15} className="text-muted-foreground" />
              Consultar expediente
            </Link>
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                close(true);
                onPreview();
              }}
              className={itemClass}
            >
              <Eye size={15} className="text-muted-foreground" />
              Vista previa
            </button>
            <button
              role="menuitem"
              type="button"
              disabled={moveDisabled}
              onClick={() => {
                close(true);
                onMove();
              }}
              className={itemClass}
            >
              <Folder size={15} className="text-muted-foreground" />
              Mover a carpeta
            </button>
            <button
              role="menuitem"
              type="button"
              disabled={favoriteDisabled}
              onClick={() => {
                close(true);
                onFavorite();
              }}
              className={itemClass}
            >
              <Star
                size={15}
                className={favorite ? 'text-amber-500' : 'text-muted-foreground'}
                fill={favorite ? 'currentColor' : 'none'}
              />
              {favorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}
            </button>
          </div>,
          document.body
        )}
    </div>
  );
}
