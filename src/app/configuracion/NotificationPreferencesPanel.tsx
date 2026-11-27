'use client';

import { toast } from 'sonner';
import { useEffect, useState } from 'react';
import { Bell, Loader2, Save } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { NOTIFICATION_CATEGORIES, type NotificationCategory } from '@/lib/notifications/policy';

type Channels = { email_enabled: boolean; in_app_enabled: boolean };
type Preferences = Record<NotificationCategory, Channels>;
const defaultChannels: Channels = { email_enabled: true, in_app_enabled: true };
const categories: Record<NotificationCategory, string> = {
  DOCUMENT: 'Documentos y comentarios',
  SIGNATURE: 'Solicitudes de firma y firmas',
  WORKFLOW: 'Solicitudes enviadas y flujos',
  APPROVAL: 'Aprobaciones',
  SECURITY: 'Seguridad y verificación de identidad',
  ORGANIZATION: 'Espacios de trabajo y organización',
  BILLING: 'Facturación',
  CERTIFICATION: 'Certificaciones',
  RETENTION: 'Conservación documental',
  SYSTEM: 'Actualizaciones del sistema',
  ACCOUNT: 'Cuenta',
  REMINDER: 'Recordatorios y vencimientos',
};
const channels = [
  { key: 'email_enabled', label: 'Correo electrónico' },
  { key: 'in_app_enabled', label: 'En Docubox' },
] as const;

export function NotificationPreferencesPanel({ userId }: { userId: string }) {
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [savedPreferences, setSavedPreferences] = useState<Preferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState('');
  const changed = preferences && savedPreferences
    ? NOTIFICATION_CATEGORIES.filter((category) => channels.some(({ key }) =>
        preferences[category][key] !== savedPreferences[category][key]
      ))
    : [];

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const { data, error } = await createClient()
          .from('notification_preferences')
          .select('category,email_enabled,in_app_enabled')
          .eq('user_id', userId)
          .abortSignal(controller.signal);
        if (error) throw error;
        const byCategory = new Map(data.map(({ category, ...settings }) => [category, settings]));
        if (!controller.signal.aborted) {
          const loaded = Object.fromEntries(
            NOTIFICATION_CATEGORIES.map((category) => [category, byCategory.get(category) ?? defaultChannels])
          ) as Preferences;
          setPreferences(loaded);
          setSavedPreferences(loaded);
        }
      } catch {
        if (!controller.signal.aborted) setError('No se pudieron cargar tus preferencias.');
      }
    }
    void load();
    return () => controller.abort();
  }, [retry, userId]);

  async function save() {
    if (!preferences || busy || !changed.length) return;
    setBusy(true);
    setError('');
    try {
      const rows = changed.map((category) => ({
        user_id: userId,
        category,
        ...preferences[category],
        updated_at: new Date().toISOString(),
      }));
      const { data, error } = await createClient()
        .from('notification_preferences')
        .upsert(rows, { onConflict: 'user_id,category' })
        .select('category');
      if (error || data?.length !== rows.length) throw error ?? new Error('save_not_confirmed');
      setSavedPreferences(preferences);
      toast.success('Preferencias guardadas.');
    } catch {
      toast.error('No se pudieron guardar tus preferencias. Puedes volver a intentarlo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-semibold">Notificaciones</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Elige en qué canales recibir cada tipo de notificación.
          </p>
        </div>
        <button
          type="button"
          disabled={busy || !changed.length}
          onClick={() => void save()}
          className="inline-flex min-h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          Guardar preferencias
        </button>
      </header>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
          {!preferences && (
            <button type="button" className="ml-2 underline" onClick={() => { setError(''); setRetry((value) => value + 1); }}>
              Reintentar
            </button>
          )}
        </p>
      )}
      {!error && !preferences && <p role="status" className="text-sm text-muted-foreground">Cargando preferencias…</p>}
      {preferences && (
        <fieldset disabled={busy} className="min-w-0 overflow-x-auto rounded-lg border border-border bg-card">
          <legend className="sr-only">Canales por tipo de notificación</legend>
          <table className="w-full text-sm">
            <thead className="workspace-table-heading border-b border-border bg-muted/40 text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 text-left font-medium">Tipo de evento</th>
                {channels.map(({ key, label }) => (
                  <th key={key} scope="col" className="min-w-24 px-2 py-3 font-medium">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {NOTIFICATION_CATEGORIES.map((category) => (
                <tr key={category}>
                  <th scope="row" className="px-4 py-2.5 text-left font-medium">{categories[category]}</th>
                  {channels.map(({ key, label }) => (
                    <td key={key} className="px-2 text-center">
                      <input
                        type="checkbox"
                        className="size-4 cursor-pointer accent-primary"
                        aria-label={`${categories[category]} · ${label}`}
                        checked={preferences[category][key]}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setPreferences({ ...preferences, [category]: { ...preferences[category], [key]: checked } });
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </fieldset>
      )}
      <div className="flex items-start gap-2 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        <Bell size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <p>Entrega inmediata. Los avisos obligatorios de seguridad y los avisos críticos se mantienen activos.</p>
          <p className="mt-1">SMS, alertas del navegador y resúmenes programados están pendientes de habilitación.</p>
        </div>
      </div>
    </div>
  );
}
