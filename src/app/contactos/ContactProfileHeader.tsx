'use client';

import { BottomNotice } from '@/components/ui/BottomNotice';
import { useEffect, useRef } from 'react';
import { ChevronDown, Mail, Phone, Star, X, type LucideIcon } from 'lucide-react';
import { contactButton, contactCard, contactPrimaryButton } from './contact-detail-ui';

export type ContactHeaderAction = {
  label: string;
  icon: LucideIcon;
  run: () => void;
  disabled?: boolean;
};

export function ContactProfileHeader({
  name,
  initials,
  personType,
  email,
  phone,
  onClose,
  favorite,
  canFavorite,
  onFavorite,
  actions,
  notice,
  favoriteError,
}: {
  name: string;
  initials: string;
  personType?: string | null;
  email?: string | null;
  phone?: string | null;
  onClose: () => void;
  favorite: boolean;
  canFavorite: boolean;
  onFavorite: () => void;
  actions: ContactHeaderAction[];
  notice: { text: string; error?: boolean } | null;
  favoriteError: string;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const actionButton = useRef<HTMLElement>(null);
  const favoriteLabel = favorite ? 'Quitar de favoritos' : 'Agregar a favoritos';

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const menu = details.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target))
        menu.open = false;
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, []);

  function closeMenu() {
    if (details.current) details.current.open = false;
    actionButton.current?.focus();
  }

  return (
    <header className={`${contactCard} mb-4 px-4 py-4 sm:px-5`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3 sm:items-center sm:gap-4">
          <span
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-primary/15 bg-primary/10 text-lg font-semibold text-primary sm:h-14 sm:w-14"
            aria-hidden="true"
          >
            {initials}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <h1 className="min-w-0 break-words text-xl font-semibold leading-tight text-foreground sm:text-2xl">
                {name}
              </h1>
              {personType && (
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                  {personType}
                </span>
              )}
            </div>
            {(email || phone) && (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
                {email && (
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Mail size={14} className="shrink-0" aria-hidden="true" />
                    <span className="min-w-0 break-all">{email}</span>
                  </span>
                )}
                {phone && (
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Phone size={14} className="shrink-0" aria-hidden="true" />
                    <span className="break-words">{phone}</span>
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2">
          <button
            type="button"
            title={favoriteLabel}
            aria-label={favoriteLabel}
            aria-pressed={favorite}
            disabled={!canFavorite}
            onClick={onFavorite}
            className={`${contactButton} min-w-9 px-0 ${favorite ? 'border-amber-300 bg-amber-50 text-amber-600 dark:border-amber-600/40 dark:bg-amber-500/10 dark:text-amber-300' : 'text-muted-foreground'}`}
          >
            <Star size={17} fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" />
          </button>
          <button type="button" onClick={onClose} className={contactButton}>
            <X size={16} aria-hidden="true" /> Cerrar
          </button>
          <details
            ref={details}
            className="group relative"
            onKeyDown={(event) => {
              if (event.key === 'Escape' && details.current?.open) {
                event.stopPropagation();
                closeMenu();
              }
            }}
          >
            <summary
              ref={actionButton}
              className={`${contactPrimaryButton} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
            >
              Acciones{' '}
              <ChevronDown
                size={16}
                className="transition-transform group-open:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <ul className="absolute right-0 z-20 mt-2 w-56 max-w-[calc(100vw-2.5rem)] rounded-lg border border-border bg-card p-1.5 shadow-lg">
              {actions.map(({ label, icon: Icon, run, disabled }) => (
                <li key={label}>
                  <button
                    type="button"
                    disabled={disabled}
                    className="flex min-h-9 w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-sm text-foreground hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:opacity-45"
                    onClick={() => {
                      closeMenu();
                      run();
                    }}
                  >
                    <Icon size={15} className="shrink-0 text-primary" aria-hidden="true" /> {label}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        </div>
      </div>
      {favoriteError && <BottomNotice message={favoriteError} tone="critical" />}
      {notice && <BottomNotice message={notice.text} tone={notice.error ? 'critical' : 'neutral'} />}
    </header>
  );
}
