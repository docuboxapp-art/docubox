'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import type {
  OrganizationDelegationPolicy as DelegationPolicy,
  OrganizationDelegationPolicyMode,
} from '@/lib/organization/delegation-policy';

const modes: Array<{
  value: OrganizationDelegationPolicyMode;
  label: string;
  description: string;
}> = [
  {
    value: 'DISABLED',
    label: 'Deshabilitada',
    description: 'Ningún participante puede delegar su acto.',
  },
  {
    value: 'ORGANIZATION_ONLY',
    label: 'Miembros de la organización',
    description: 'Permite delegar únicamente a miembros internos activos.',
  },
  {
    value: 'AUTHORIZED_MEMBERS',
    label: 'Roles autorizados',
    description: 'Limita la delegación interna a los roles seleccionados.',
  },
];

const roleOptions = [
  ['owner', 'Propietario'],
  ['admin', 'Administrador'],
  ['member', 'Colaborador'],
] as const;

const emptyPolicy: DelegationPolicy = {
  mode: 'DISABLED',
  allowed_member_ids: [],
  allowed_roles: [],
};

export function OrganizationDelegationPolicy({
  workspaceId,
  canManage,
}: {
  workspaceId: string;
  canManage: boolean;
}) {
  const { session } = useAuth();
  const [policy, setPolicy] = useState<DelegationPolicy>(emptyPolicy);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    const response = await fetch(
      `/api/organizacion/delegation-policy?workspace_id=${encodeURIComponent(workspaceId)}`,
      { headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store' }
    );
    const payload = await response.json().catch(() => ({}));
    if (response.ok) setPolicy(payload.data || emptyPolicy);
    else setError(payload.error || 'No se pudo cargar la política.');
    setLoading(false);
  }, [session, workspaceId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  const save = async () => {
    if (!session?.access_token) return;
    setSaving(true);
    setError('');
    setMessage('');
    const response = await fetch('/api/organizacion/delegation-policy', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ workspace_id: workspaceId, ...policy }),
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) {
      setPolicy(payload.data || policy);
      setMessage('Política de delegación actualizada.');
    } else {
      setError(payload.error || 'No se pudo guardar la política.');
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 size={18} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-medium text-foreground">Política de delegación</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Define quién puede asumir un acto sin sustituir al participante original.
        </p>
      </div>
      <div className="grid gap-2 lg:grid-cols-3">
        {modes.map((mode) => (
          <button
            key={mode.value}
            type="button"
            disabled={!canManage}
            onClick={() =>
              setPolicy((current) => ({
                ...current,
                mode: mode.value,
                allowed_roles: mode.value === 'AUTHORIZED_MEMBERS' ? current.allowed_roles : [],
              }))
            }
            className={`min-h-24 rounded-md border p-4 text-left transition-colors ${
              policy.mode === mode.value
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/40'
            }`}
          >
            <span className="flex items-center justify-between gap-3 text-sm font-medium">
              {mode.label}
              {policy.mode === mode.value && <Check size={16} className="text-primary" />}
            </span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
              {mode.description}
            </span>
          </button>
        ))}
      </div>
      {policy.mode === 'AUTHORIZED_MEMBERS' && (
        <div className="rounded-md border border-border p-4">
          <p className="text-sm font-medium text-foreground">
            Roles que pueden recibir delegaciones
          </p>
          <div className="mt-3 flex flex-wrap gap-4">
            {roleOptions.map(([value, label]) => (
              <label key={value} className="inline-flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  disabled={!canManage}
                  checked={policy.allowed_roles.includes(value)}
                  onChange={(event) =>
                    setPolicy((current) => ({
                      ...current,
                      allowed_roles: event.target.checked
                        ? [...current.allowed_roles, value]
                        : current.allowed_roles.filter((role) => role !== value),
                    }))
                  }
                />
                {label}
              </label>
            ))}
          </div>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {message}
        </div>
      )}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={
            !canManage ||
            saving ||
            (policy.mode === 'AUTHORIZED_MEMBERS' &&
              policy.allowed_member_ids.length === 0 &&
              policy.allowed_roles.length === 0)
          }
          className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving && <Loader2 size={15} className="animate-spin" />}
          Guardar política
        </button>
      </div>
    </div>
  );
}
