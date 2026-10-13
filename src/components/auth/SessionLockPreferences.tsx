'use client';

import { useState } from 'react';
import { Clock3, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

const OPTIONS = [
  { minutes: 5, label: '5 min' },
  { minutes: 20, label: '20 min' },
  { minutes: 45, label: '45 min' },
] as const;

type Props = {
  compact?: boolean;
  userId?: string;
  currentMinutes?: number;
  currentDismissed?: boolean;
};

export function SessionLockPreferences({
  compact = false,
  userId,
  currentMinutes = 45,
  currentDismissed = false,
}: Props) {
  const [minutes, setMinutes] = useState(currentMinutes);
  const [dismissed, setDismissed] = useState(currentDismissed);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const changed = minutes !== currentMinutes || dismissed !== currentDismissed;

  const save = async () => {
    if (!userId || !changed || saving) return;
    setSaving(true);
    setError('');
    const supabase = createClient();
    try {
      const { data, error: updateError } = await supabase
        .from('user_profiles')
        .update({ session_lock_minutes: minutes, session_warning_dismissed: dismissed })
        .eq('id', userId)
        .select('id')
        .single();
      if (updateError || !data) throw updateError || new Error('No se guardó la preferencia.');

      // The changed deadline must never continue under a previously authenticated view.
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
      if (signOutError) throw signOutError;
      try {
        const channel = new BroadcastChannel('docubox-session');
        channel.postMessage({ type: 'SIGN_OUT', reason: 'preferences' });
        channel.close();
      } catch {
        /* BroadcastChannel is optional. */
      }
      window.location.replace('/login?reason=preferences-updated');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar la preferencia.');
      setSaving(false);
    }
  };

  return (
    <div
      className={
        compact
          ? 'space-y-3 border-t border-border pt-4'
          : 'rounded-xl border border-border bg-white p-5 space-y-4'
      }
    >
      <div className="flex items-start gap-2">
        <Clock3 size={compact ? 16 : 18} className="mt-0.5 shrink-0 text-primary" />
        <div>
          <h3 className="text-sm font-600 text-foreground">Bloqueo por inactividad</h3>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            Elige cuándo cerrar tu sesión sin actividad. El límite máximo es 45 minutos; para
            superadministradores es 15 minutos.
          </p>
        </div>
      </div>
      <fieldset className="flex flex-wrap gap-2" disabled={saving}>
        <legend className="sr-only">Tiempo de inactividad</legend>
        {OPTIONS.map((option) => (
          <label
            key={option.minutes}
            className={`cursor-pointer rounded-lg border px-3 py-2 text-sm font-600 transition-colors ${minutes === option.minutes ? 'border-primary bg-primary/10 text-primary' : 'border-border text-foreground hover:bg-muted/50'}`}
          >
            <input
              className="sr-only"
              type="radio"
              name={compact ? 'session-lock-modal' : 'session-lock-profile'}
              value={option.minutes}
              checked={minutes === option.minutes}
              onChange={() => setMinutes(option.minutes)}
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          className="mt-1 accent-primary"
          checked={dismissed}
          disabled={saving}
          onChange={(event) => setDismissed(event.target.checked)}
        />
        <span>No volver a mostrar el aviso previo al cierre de sesión</span>
      </label>
      <p className="text-xs leading-5 text-muted-foreground">
        Aunque ocultes el aviso, la sesión se cerrará al cumplirse el tiempo. Podrás cambiar esta
        opción en Mi perfil → Seguridad.
      </p>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={!changed || saving}
        onClick={() => void save()}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-600 text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving && <Loader2 size={15} className="animate-spin" />}
        Guardar y cerrar sesión
      </button>
    </div>
  );
}
