'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';

export function useCollaborationReason() {
  const dialog = useRef<HTMLDialogElement>(null),
    resolver = useRef<((value: string | null) => void) | null>(null);
  const [prompt, setPrompt] = useState<{ title: string; description: string } | null>(null),
    [value, setValue] = useState('');
  useEffect(() => {
    if (prompt) dialog.current?.showModal();
    else dialog.current?.close();
  }, [prompt]);
  useEffect(
    () => () => {
      resolver.current?.(null);
      resolver.current = null;
    },
    []
  );
  const finish = (answer: string | null) => {
    resolver.current?.(answer);
    resolver.current = null;
    setPrompt(null);
    setValue('');
  };
  const ask = (title: string, description = 'Indica el motivo de esta acción.') =>
    new Promise<string | null>((resolve) => {
      resolver.current?.(null);
      resolver.current = resolve;
      setValue('');
      setPrompt({ title, description });
    });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (value.trim()) finish(value.trim());
  };
  const modal = (
    <dialog
      ref={dialog}
      aria-label={prompt?.title || 'Motivo de la acción'}
      className="colabora-dialog"
      onCancel={(event) => {
        event.preventDefault();
        finish(null);
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) finish(null);
      }}
    >
      {prompt && (
        <form onSubmit={submit}>
          <div className="colabora-dialog-header">
            <h3>{prompt.title}</h3>
            <button type="button" aria-label="Cerrar" onClick={() => finish(null)}>
              <X size={18} />
            </button>
          </div>
          <div className="space-y-3 p-5">
            <p className="text-sm text-muted-foreground">{prompt.description}</p>
            <label className="block text-sm">
              Motivo
              <textarea
                required
                autoFocus
                maxLength={2000}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                rows={4}
                className="mt-2 w-full rounded-md border border-border bg-background p-3"
              />
            </label>
          </div>
          <div className="colabora-dialog-footer">
            <button
              type="button"
              onClick={() => finish(null)}
              className="colabora-secondary-button"
            >
              Cancelar
            </button>
            <button className="colabora-primary-button" disabled={!value.trim()}>
              Continuar
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
  return [ask, modal] as const;
}
