'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { ChevronDown, Ellipsis, EllipsisVertical, type LucideIcon } from 'lucide-react';

export type WorkspaceRowAction = {
  label: string;
  icon: LucideIcon;
  iconClassName?: string;
  fillIcon?: boolean;
} & ({ href: string } | { onSelect: () => void; disabled?: boolean });

function menuPosition(bounds: DOMRect, height: number) {
  return {
    left: Math.max(8, Math.min(bounds.right - 224, window.innerWidth - 232)),
    top:
      bounds.bottom + height + 8 > window.innerHeight
        ? Math.max(8, bounds.top - height - 4)
        : bounds.bottom + 4,
  };
}

export function WorkspaceRowActions({
  title,
  actions,
  buttonLabel,
  triggerVariant = 'compact',
  className = '',
  menuClassName = '',
}: {
  title: string;
  actions: WorkspaceRowAction[];
  buttonLabel?: string;
  triggerVariant?: 'compact' | 'outlined';
  className?: string;
  menuClassName?: string;
}) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const open = position !== null;

  function close(restoreFocus = false) {
    setPosition(null);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')
      ?.focus({ preventScroll: true });
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
        trigger.current?.focus({ preventScroll: true });
      }
    };
    const reposition = (event: Event) => {
      if (event.target instanceof Node && menu.current?.contains(event.target)) return;
      const bounds = trigger.current?.getBoundingClientRect();
      const height = menu.current?.getBoundingClientRect().height;
      if (
        triggerVariant === 'outlined' && bounds && height &&
        bounds.bottom > 0 && bounds.top < window.innerHeight &&
        bounds.right > 0 && bounds.left < window.innerWidth
      ) {
        setPosition(menuPosition(bounds, height));
      } else {
        setPosition(null);
      }
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
  }, [open, triggerVariant]);

  function toggle() {
    if (open) return close();
    const bounds = trigger.current?.getBoundingClientRect();
    if (!bounds) return;
    setPosition(menuPosition(bounds, actions.length * 44 + 16));
  }

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    const items = [
      ...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') || []),
    ];
    if (event.key === 'Tab') {
      close(true);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !items.length) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLElement);
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
  const label = `Acciones de ${title}`;
  const triggerClass = buttonLabel
    ? 'inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary'
    : triggerVariant === 'outlined'
    ? 'flex size-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
    : 'rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground';
  const TriggerIcon = triggerVariant === 'outlined' ? Ellipsis : EllipsisVertical;
  return (
    <div className={`flex justify-end ${className}`}>
      <button
        ref={trigger}
        type="button"
        aria-label={buttonLabel ? undefined : label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title="Acciones"
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (!open) toggle();
          }
        }}
        className={`${triggerClass} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40`}
      >
        {buttonLabel ? (
          <>
            {buttonLabel}
            <ChevronDown
              size={15}
              className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </>
        ) : (
          <TriggerIcon size={triggerVariant === 'outlined' ? 17 : 16} aria-hidden="true" />
        )}
      </button>
      {position &&
        createPortal(
          <div
            id={menuId}
            ref={menu}
            role="menu"
            aria-label={label}
            onKeyDown={navigate}
            onBlur={(event) => {
              if (
                event.relatedTarget !== trigger.current &&
                !event.currentTarget.contains(event.relatedTarget)
              ) {
                close();
              }
            }}
            className={`fixed z-[300] max-h-[calc(100dvh-16px)] w-56 max-w-[calc(100vw-16px)] overflow-y-auto rounded-xl border border-border bg-card py-1 shadow-xl ${menuClassName}`}
            style={position}
          >
            {actions.map((action) => {
              const Icon = action.icon;
              const content = (
                <>
                  <Icon
                    size={15}
                    className={action.iconClassName || 'text-muted-foreground'}
                    fill={action.fillIcon ? 'currentColor' : 'none'}
                    aria-hidden="true"
                  />
                  {action.label}
                </>
              );
              return 'href' in action ? (
                <Link
                  key={action.label}
                  role="menuitem"
                  href={action.href}
                  onClick={() => close()}
                  className={itemClass}
                >
                  {content}
                </Link>
              ) : (
                <button
                  key={action.label}
                  role="menuitem"
                  type="button"
                  disabled={action.disabled}
                  className={itemClass}
                  onClick={() => {
                    close(true);
                    action.onSelect();
                  }}
                >
                  {content}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </div>
  );
}
