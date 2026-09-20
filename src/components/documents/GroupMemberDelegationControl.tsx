'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronDown, Loader2, RotateCcw, UserRoundCog, X } from 'lucide-react';

type Candidate = {
  member_id: string;
  name: string;
  email?: string | null;
};

type ActiveDelegation = {
  id: string;
  reason: string;
  workspace_members?: {
    user_profiles?: { full_name?: string | null; email?: string | null } | null;
  } | null;
};

type DelegationContext = {
  eligible: boolean;
  self_delegation: boolean;
  group?: { name: string; completion_policy: 'ALL' | 'ANY_ONE' } | null;
  active_delegation?: ActiveDelegation | null;
  candidates: Candidate[];
};

export function GroupMemberDelegationControl({
  documentId,
  workspaceId,
  participantReferenceId,
  accessToken,
}: {
  documentId: string;
  workspaceId: string;
  participantReferenceId: string;
  accessToken: string;
}) {
  const [context, setContext] = useState<DelegationContext | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [delegateMemberId, setDelegateMemberId] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const request = useCallback(
    async (init?: Parameters<typeof fetch>[1]) => {
      const query = new URLSearchParams({
        workspace_id: workspaceId,
        participant_reference_id: participantReferenceId,
      });
      const response = await fetch(`/api/documentos/${documentId}/delegations?${query}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          ...(init?.headers || {}),
        },
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const failure = new Error(payload.error || 'No se pudo administrar la delegación.');
        Object.assign(failure, { code: payload.code, status: response.status });
        throw failure;
      }
      return payload;
    },
    [accessToken, documentId, participantReferenceId, workspaceId]
  );

  const load = useCallback(async () => {
    try {
      const payload = await request();
      setContext(payload.data || null);
    } catch (cause) {
      const failure = cause as Error & { status?: number };
      if (failure.status !== 403 && failure.status !== 404) {
        setError(failure.message);
      }
      setContext(null);
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  const mutate = async (body: Record<string, unknown>, successMessage: string) => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await request({ method: 'POST', body: JSON.stringify(body) });
      setMessage(successMessage);
      setExpanded(false);
      setDelegateMemberId('');
      setReason('');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar la delegación.');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !context?.self_delegation) return null;
  const active = context.active_delegation;
  if (!context.eligible && !active) return null;
  const profile = active?.workspace_members?.user_profiles;
  const delegateLabel = profile?.full_name || profile?.email || 'Miembro delegado';

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-start gap-3 p-4">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-blue-50 text-primary">
          <UserRoundCog size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-900">Delegación de participación</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {active
              ? `Tu posición en ${context.group?.name || 'el grupo'} está delegada a ${delegateLabel}.`
              : `Puedes delegar tu posición en ${context.group?.name || 'este grupo'} a otro miembro elegible.`}
          </p>
          {context.group && (
            <p className="mt-1 text-[11px] text-slate-400">
              Política del grupo: {context.group.completion_policy}
            </p>
          )}
        </div>
        {active ? (
          <button
            type="button"
            disabled={saving}
            onClick={() =>
              void mutate(
                {
                  action: 'revoke',
                  workspace_id: workspaceId,
                  delegation_id: active.id,
                  idempotency_key: crypto.randomUUID(),
                },
                'Delegación revocada. Tu posición vuelve a estar disponible.'
              )
            }
            className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            Revocar
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
            aria-expanded={expanded}
          >
            Delegar
            {expanded ? <X size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
      </div>

      {expanded && !active && (
        <div className="space-y-3 border-t border-slate-200 p-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-700">
              Miembro delegado
            </span>
            <select
              value={delegateMemberId}
              onChange={(event) => setDelegateMemberId(event.target.value)}
              className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
            >
              <option value="">Selecciona un miembro del grupo</option>
              {context.candidates.map((candidate) => (
                <option key={candidate.member_id} value={candidate.member_id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-700">Motivo</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Describe brevemente el motivo"
              className="w-full resize-none rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
          </label>
          {context.candidates.length === 0 && (
            <p className="text-xs text-amber-700">
              No hay otro miembro elegible del grupo que cumpla la política vigente.
            </p>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              disabled={
                saving ||
                !delegateMemberId ||
                reason.trim().length < 3 ||
                context.candidates.length === 0
              }
              onClick={() =>
                void mutate(
                  {
                    action: 'create',
                    workspace_id: workspaceId,
                    participant_reference_id: participantReferenceId,
                    delegate_member_id: delegateMemberId,
                    reason,
                    idempotency_key: crypto.randomUUID(),
                  },
                  'Delegación creada. El miembro seleccionado puede actuar por esta posición.'
                )
              }
              className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-xs font-medium text-white disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Confirmar delegación
            </button>
          </div>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="border-t border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700"
        >
          {error}
        </div>
      )}
      {message && (
        <div className="border-t border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700">
          {message}
        </div>
      )}
    </section>
  );
}
