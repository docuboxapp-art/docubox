'use client';

import { useEffect, useId, useRef, type FormEvent, type ReactNode, type RefObject } from 'react';
import { Loader2, X } from 'lucide-react';

const secondaryButton =
  'inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:border-primary/35 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50';
const primaryButton =
  'inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 disabled:opacity-50';

export function EditorDialog({
  title,
  busy,
  error,
  children,
  onClose,
  onSubmit,
  submitLabel = 'Guardar',
  busyLabel = 'Guardando…',
  submitDisabled = false,
  destructive = false,
  initialFocus,
}: {
  title: string;
  busy: boolean;
  error: string;
  children: ReactNode;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitLabel?: string;
  busyLabel?: string;
  submitDisabled?: boolean;
  destructive?: boolean;
  initialFocus?: RefObject<HTMLElement | null>;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    initialFocus?.current?.focus();
    return () => dialog?.close();
  }, [initialFocus]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md rounded-lg border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-slate-950/40"
    >
      <form onSubmit={onSubmit} aria-busy={busy}>
        <header className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 sm:px-5">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          <button
            type="button"
            className={secondaryButton}
            aria-label="Cerrar"
            disabled={busy}
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <fieldset disabled={busy} className="space-y-3.5 px-4 py-4 sm:px-5">
          {children}
          {error && (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}
        </fieldset>
        <footer className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3 sm:px-5">
          <button
            type="button"
            className={secondaryButton}
            onClick={onClose}
            disabled={busy}
            autoFocus={destructive}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className={`${primaryButton}${destructive ? ' !bg-destructive text-destructive-foreground hover:!bg-destructive/90' : ''}`}
            disabled={busy || submitDisabled}
          >
            {busy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
            {busy ? busyLabel : submitLabel}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
