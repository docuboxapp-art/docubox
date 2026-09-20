'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

type Policy = {
  id: string;
  name: string;
  description?: string | null;
  version: number;
  duration_value: number;
  duration_unit: 'days' | 'months' | 'years';
  completion_action: 'review' | 'eligible_for_purge';
  status: string;
};

export function OrganizationRetentionPolicies({
  workspaceId,
  canManage,
}: {
  workspaceId: string;
  canManage: boolean;
}) {
  const { session } = useAuth();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    description: '',
    duration_value: 1,
    duration_unit: 'years' as const,
    completion_action: 'review' as const,
  });

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    const response = await fetch(
      `/api/organizacion/retention-policies?workspace_id=${encodeURIComponent(workspaceId)}`,
      { headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store' }
    );
    const payload = await response.json().catch(() => ({}));
    setPolicies(response.ok ? payload.data || [] : []);
    setError(response.ok ? '' : payload.error || 'No se pudieron cargar las políticas.');
    setLoading(false);
  }, [session, workspaceId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!session?.access_token) return;
    setSaving(true);
    setError('');
    const response = await fetch('/api/organizacion/retention-policies', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ workspace_id: workspaceId, ...form, applies_to: {} }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) setError(payload.error || 'No se pudo crear la política.');
    else {
      setShowForm(false);
      setForm({
        name: '',
        description: '',
        duration_value: 1,
        duration_unit: 'years',
        completion_action: 'review',
      });
      await load();
    }
    setSaving(false);
  };

  const unitLabel = { days: 'días', months: 'meses', years: 'años' };
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-foreground">Políticas de retención</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Define periodos internos. Docubox no presupone plazos legales automáticos.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setShowForm((value) => !value)}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white"
          >
            <Plus size={15} />
            Nueva política
          </button>
        )}
      </div>
      {error && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}
      {showForm && (
        <form
          onSubmit={submit}
          className="grid gap-3 rounded-md border border-border bg-background p-4 sm:grid-cols-2"
        >
          <label className="text-sm text-foreground">
            Nombre
            <input
              required
              minLength={3}
              value={form.name}
              onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))}
              className="mt-1 h-10 w-full rounded-md border border-border px-3"
            />
          </label>
          <label className="text-sm text-foreground">
            Duración
            <div className="mt-1 flex gap-2">
              <input
                required
                type="number"
                min={1}
                max={1200}
                value={form.duration_value}
                onChange={(event) =>
                  setForm((value) => ({ ...value, duration_value: Number(event.target.value) }))
                }
                className="h-10 w-24 rounded-md border border-border px-3"
              />
              <select
                value={form.duration_unit}
                onChange={(event) =>
                  setForm((value) => ({
                    ...value,
                    duration_unit: event.target.value as typeof form.duration_unit,
                  }))
                }
                className="h-10 flex-1 rounded-md border border-border bg-background px-3"
              >
                <option value="days">Días</option>
                <option value="months">Meses</option>
                <option value="years">Años</option>
              </select>
            </div>
          </label>
          <label className="text-sm text-foreground sm:col-span-2">
            Descripción
            <input
              value={form.description}
              onChange={(event) =>
                setForm((value) => ({ ...value, description: event.target.value }))
              }
              className="mt-1 h-10 w-full rounded-md border border-border px-3"
            />
          </label>
          <label className="text-sm text-foreground sm:col-span-2">
            Al terminar el periodo
            <select
              value={form.completion_action}
              onChange={(event) =>
                setForm((value) => ({
                  ...value,
                  completion_action: event.target.value as typeof form.completion_action,
                }))
              }
              className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3"
            >
              <option value="review">Requiere revisión</option>
              <option value="eligible_for_purge">Elegible para depuración</option>
            </select>
          </label>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="h-9 rounded-md border border-border px-4 text-sm"
            >
              Cancelar
            </button>
            <button
              disabled={saving}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}Guardar
            </button>
          </div>
        </form>
      )}
      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 size={18} className="animate-spin text-muted-foreground" />
        </div>
      ) : policies.length ? (
        <div className="divide-y divide-border rounded-md border border-border">
          {policies.map((policy) => (
            <div key={policy.id} className="flex items-start justify-between gap-4 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">{policy.name}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {policy.duration_value} {unitLabel[policy.duration_unit]} · v{policy.version}
                  {policy.description ? ` · ${policy.description}` : ''}
                </p>
              </div>
              <span className="text-xs text-muted-foreground">{policy.status}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          Aún no hay políticas configuradas.
        </div>
      )}
    </div>
  );
}
