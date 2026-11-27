'use client';

import { toast } from 'sonner';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { useState } from 'react';
import { HELP_FEEDBACK_REASONS } from '@/lib/help/model';
import styles from '../help.module.css';

function anonymousVoter() {
  const storageKey = 'docubox.help.voter';
  const created = crypto.randomUUID();
  try {
    const prior = localStorage.getItem(storageKey);
    if (prior && /^[0-9a-f-]{36}$/i.test(prior)) return prior;
    localStorage.setItem(storageKey, created);
  } catch {
    // The current component retains its identifier when storage is disabled.
  }
  return created;
}

export default function HelpFeedback({ slug }: { slug: string }) {
  const [choice, setChoice] = useState<boolean | null>(null);
  const [reason, setReason] = useState<keyof typeof HELP_FEEDBACK_REASONS | ''>('');
  const [voter, setVoter] = useState<string>();
  const [state, setState] = useState<'idle' | 'sending' | 'saved'>('idle');

  async function vote(helpful: boolean) {
    if (state !== 'idle') return;
    setState('sending');
    try {
      const id = voter ?? anonymousVoter();
      setVoter(id);
      const response = await fetch('/api/centro-ayuda/valoraciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          article: slug,
          voter: id,
          helpful,
          reason: !helpful && reason ? reason : null,
        }),
      });
      const result = await response.json();
      if (!response.ok || result.saved !== true) {
        throw new Error(
          response.status === 429
            ? 'Espera unos minutos para volver a intentarlo.'
            : 'No se pudo guardar tu valoración.'
        );
      }
      setState('saved');
    } catch (cause) {
      setState('idle');
      toast.error(
        cause instanceof Error && cause.message.startsWith('Espera')
          ? cause.message
          : 'No se pudo guardar tu valoración. Intenta de nuevo.'
      );
    }
  }

  return (
    <section
      className={styles.feedbackArea}
      aria-labelledby="help-feedback-heading"
      aria-busy={state === 'sending'}
    >
      <h2 id="help-feedback-heading" className="font-semibold">
        ¿Este artículo te ayudó?
      </h2>
      {state === 'saved' ? (
        <p role="status" className="mt-2 text-sm text-muted-foreground">
          Gracias. Guardamos tu valoración.
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className={styles.button}
              aria-pressed={choice === true}
              disabled={state === 'sending'}
              onClick={() => {
                setChoice(true);
                void vote(true);
              }}
            >
              <ThumbsUp size={15} aria-hidden="true" /> Sí
            </button>
            <button
              type="button"
              className={styles.button}
              aria-pressed={choice === false}
              disabled={state === 'sending'}
              onClick={() => setChoice(false)}
            >
              <ThumbsDown size={15} aria-hidden="true" /> No
            </button>
          </div>
          {choice === false && (
            <form
              className="mt-3 flex flex-wrap items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void vote(false);
              }}
            >
              <label className={styles.filterField}>
                Motivo opcional
                <select
                  value={reason}
                  disabled={state === 'sending'}
                  onChange={(event) => setReason(event.target.value as typeof reason)}
                >
                  <option value="">Seleccionar motivo</option>
                  {Object.entries(HELP_FEEDBACK_REASONS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <button className={styles.button} type="submit" disabled={state === 'sending'}>
                Enviar valoración
              </button>
            </form>
          )}
          {state === 'sending' && (
            <p className="mt-2 text-sm" role="status">
              Guardando valoración…
            </p>
          )}
        </>
      )}
    </section>
  );
}
