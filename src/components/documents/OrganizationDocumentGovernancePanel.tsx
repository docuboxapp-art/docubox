'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowRightLeft, Check, Loader2, ShieldCheck, Trash2, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

type Row = Record<string, any>;

export function OrganizationDocumentGovernancePanel({
  documentId,
  workspaceId,
  participants,
}: {
  documentId: string;
  workspaceId: string;
  participants: Row[];
}) {
  const { session } = useAuth();
  const [tab, setTab] = useState<'custody' | 'delegation' | 'retention'>('custody');
  const [data, setData] = useState<Row>({
    history: [],
    members: [],
    policies: [],
    assignments: [],
  });
  const [delegations, setDelegations] = useState<Row[]>([]);
  const [delegationContext, setDelegationContext] = useState<Row | null>(null);
  const [loadingDelegationContext, setLoadingDelegationContext] = useState(false);
  const [form, setForm] = useState<Row>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const request = useCallback(
    async (path: string, init?: Parameters<typeof fetch>[1]) => {
      const response = await fetch(path, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || ''}`,
          ...(init?.headers || {}),
        },
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'No se pudo completar la operación.');
      return payload;
    },
    [session?.access_token]
  );

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    setError('');
    try {
      const [governance, delegationResult, delegationPolicyResult] = await Promise.all([
        request(
          `/api/documentos/${documentId}/custody?workspace_id=${encodeURIComponent(workspaceId)}`
        ),
        request(
          `/api/documentos/${documentId}/delegations?workspace_id=${encodeURIComponent(workspaceId)}`
        ),
        request(
          `/api/organizacion/delegation-policy?workspace_id=${encodeURIComponent(workspaceId)}`
        ),
      ]);
      setData({ ...governance, delegationPolicy: delegationPolicyResult.data });
      setDelegations(delegationResult.data || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar la gobernanza.');
    } finally {
      setLoading(false);
    }
  }, [documentId, request, session?.access_token, workspaceId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  const mutate = async (path: string, method: 'POST' | 'PATCH', body: Row, success: string) => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await request(path, { method, body: JSON.stringify(body) });
      setForm({});
      setDelegationContext(null);
      setMessage(success);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar el cambio.');
    } finally {
      setSaving(false);
    }
  };

  const reauthenticate = async (scope: string, password: string) => {
    const result = await request('/api/organizacion/reauthenticate', {
      method: 'POST',
      body: JSON.stringify({ workspace_id: workspaceId, password, scopes: [scope] }),
    });
    return String(result.token || '');
  };

  const requestCrossTenantCustody = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const token = await reauthenticate(
        'documents.custody.transfer',
        String(form.cross_tenant_password || '')
      );
      await request(`/api/documentos/${documentId}/custody`, {
        method: 'PUT',
        headers: { 'X-Organization-Reauth': token },
        body: JSON.stringify({
          workspace_id: workspaceId,
          destination_organization: form.destination_organization,
          reason: form.cross_tenant_reason,
          idempotency_key: crypto.randomUUID(),
        }),
      });
      setForm({});
      setMessage('Solicitud enviada a la organización destino.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo solicitar la transferencia.');
    } finally {
      setSaving(false);
    }
  };

  const cancelCrossTenantCustody = async (transferId: string) => {
    setSaving(true);
    setError('');
    try {
      const token = await reauthenticate(
        'documents.custody.transfer',
        String(form.cancel_transfer_password || '')
      );
      await request('/api/organizacion/custody-transfers', {
        method: 'POST',
        headers: { 'X-Organization-Reauth': token },
        body: JSON.stringify({
          workspace_id: workspaceId,
          transfer_id: transferId,
          action: 'cancel',
          idempotency_key: crypto.randomUUID(),
        }),
      });
      setForm({});
      setMessage('Solicitud cancelada.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cancelar la solicitud.');
    } finally {
      setSaving(false);
    }
  };

  const members = data.members || [];
  const memberLabel = (member: Row) => {
    const profile = Array.isArray(member.user_profiles)
      ? member.user_profiles[0]
      : member.user_profiles;
    return profile?.full_name || profile?.email || 'Miembro';
  };
  const participantOptions = participants.filter((participant) => participant.participant_ref_id);
  const delegateOptions = delegationContext?.group ? delegationContext.candidates || [] : members;

  const selectDelegationParticipant = async (participantReferenceId: string) => {
    setForm((value) => ({
      ...value,
      participant_reference_id: participantReferenceId,
      delegate_member_id: '',
    }));
    setDelegationContext(null);
    if (!participantReferenceId) return;
    setLoadingDelegationContext(true);
    setError('');
    try {
      const query = new URLSearchParams({
        workspace_id: workspaceId,
        participant_reference_id: participantReferenceId,
      });
      const result = await request(`/api/documentos/${documentId}/delegations?${query}`);
      setDelegationContext(result.data || null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo validar el participante.');
    } finally {
      setLoadingDelegationContext(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex border-b border-slate-200 px-3" role="tablist">
        {(
          [
            ['custody', 'Custodia'],
            ['delegation', 'Delegación'],
            ['retention', 'Retención'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => {
              setTab(key);
              setMessage('');
              setError('');
            }}
            className={`border-b-2 px-3 py-3 text-xs ${tab === key ? 'border-primary font-medium text-primary' : 'border-transparent text-slate-500'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin" />
            Cargando...
          </div>
        ) : (
          <div className="space-y-4">
            {error && (
              <div
                role="alert"
                className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
              >
                {error}
              </div>
            )}
            {message && (
              <div className="flex gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                <Check size={14} />
                {message}
              </div>
            )}

            {tab === 'custody' && (
              <>
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    Transferir custodia administrativa
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    La firma, los participantes y la evidencia histórica no cambian.
                  </p>
                </div>
                <select
                  value={form.custodian_member_id || ''}
                  onChange={(event) =>
                    setForm((value) => ({ ...value, custodian_member_id: event.target.value }))
                  }
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                >
                  <option value="">Selecciona un custodio</option>
                  {members.map((member: Row) => (
                    <option key={member.id} value={member.id}>
                      {memberLabel(member)}
                    </option>
                  ))}
                </select>
                <textarea
                  value={form.custody_reason || ''}
                  onChange={(event) =>
                    setForm((value) => ({ ...value, custody_reason: event.target.value }))
                  }
                  placeholder="Motivo de la transferencia"
                  rows={3}
                  className="w-full resize-none rounded-md border border-slate-200 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  disabled={
                    saving ||
                    !form.custodian_member_id ||
                    String(form.custody_reason || '').trim().length < 3
                  }
                  onClick={() =>
                    void mutate(
                      `/api/documentos/${documentId}/custody`,
                      'POST',
                      {
                        workspace_id: workspaceId,
                        custodian_member_id: form.custodian_member_id,
                        reason: form.custody_reason,
                        idempotency_key: crypto.randomUUID(),
                      },
                      'Custodia transferida.'
                    )
                  }
                  className="h-10 w-full rounded-md bg-primary px-4 text-sm font-medium text-white disabled:opacity-50"
                >
                  Transferir custodia
                </button>
                <HistoryRows
                  rows={data.history || []}
                  empty="Aún no hay transferencias de custodia."
                  dateKey="transferred_at"
                />
                {data.cross_tenant_enabled && (
                  <div className="space-y-3 border-t border-slate-200 pt-4">
                    <div>
                      <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
                        <ArrowRightLeft size={15} /> Transferir a otra organización
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Requiere aceptación del destino. El tenant histórico, la firma y la
                        evidencia permanecen sin cambios.
                      </p>
                    </div>
                    {!['completado', 'vencido', 'cancelado', 'rechazado'].includes(
                      String(data.document?.estado || '').toLowerCase()
                    ) ? (
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                        Disponible cuando el documento alcance un estado terminal.
                      </div>
                    ) : (
                      <>
                        <label className="block">
                          <span className="text-xs font-medium text-slate-700">
                            Identificador de la organización destino
                          </span>
                          <input
                            value={form.destination_organization || ''}
                            onChange={(event) =>
                              setForm((value) => ({
                                ...value,
                                destination_organization: event.target.value,
                              }))
                            }
                            placeholder="organizacion-destino"
                            className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm"
                          />
                        </label>
                        <textarea
                          value={form.cross_tenant_reason || ''}
                          onChange={(event) =>
                            setForm((value) => ({
                              ...value,
                              cross_tenant_reason: event.target.value,
                            }))
                          }
                          placeholder="Motivo de la transferencia"
                          rows={3}
                          className="w-full resize-none rounded-md border border-slate-200 px-3 py-2 text-sm"
                        />
                        <label className="block">
                          <span className="text-xs font-medium text-slate-700">
                            Confirma tu contraseña
                          </span>
                          <input
                            type="password"
                            autoComplete="current-password"
                            value={form.cross_tenant_password || ''}
                            onChange={(event) =>
                              setForm((value) => ({
                                ...value,
                                cross_tenant_password: event.target.value,
                              }))
                            }
                            className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm"
                          />
                        </label>
                        <button
                          type="button"
                          disabled={
                            saving ||
                            String(form.destination_organization || '').trim().length < 2 ||
                            String(form.cross_tenant_reason || '').trim().length < 3 ||
                            !form.cross_tenant_password ||
                            (data.transfers || []).some(
                              (transfer: Row) => transfer.status === 'pending'
                            )
                          }
                          onClick={() => void requestCrossTenantCustody()}
                          className="h-10 w-full rounded-md bg-primary px-4 text-sm font-medium text-white disabled:opacity-50"
                        >
                          Solicitar transferencia
                        </button>
                      </>
                    )}
                    <div className="space-y-2">
                      {(data.transfers || []).map((transfer: Row) => (
                        <div
                          key={transfer.id}
                          className="rounded-md border border-slate-200 px-3 py-2"
                        >
                          <div className="flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-medium text-slate-800">
                                {transfer.destination_name}
                              </p>
                              <p className="mt-0.5 text-[11px] text-slate-500">
                                {transfer.status === 'pending'
                                  ? `Pendiente hasta ${new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(new Date(transfer.expires_at))}`
                                  : transfer.status}
                              </p>
                            </div>
                            {transfer.status === 'pending' &&
                              transfer.source_workspace_id === workspaceId && (
                                <button
                                  type="button"
                                  title="Cancelar solicitud"
                                  aria-label="Cancelar solicitud de custodia"
                                  onClick={() =>
                                    setForm((value) => ({
                                      ...value,
                                      cancel_transfer_id: transfer.id,
                                      cancel_transfer_password: '',
                                    }))
                                  }
                                  className="grid h-8 w-8 place-items-center rounded-md text-red-500 hover:bg-red-50"
                                >
                                  <X size={14} />
                                </button>
                              )}
                          </div>
                          {form.cancel_transfer_id === transfer.id && (
                            <div className="mt-3 border-t border-slate-100 pt-3">
                              <input
                                type="password"
                                autoComplete="current-password"
                                value={form.cancel_transfer_password || ''}
                                onChange={(event) =>
                                  setForm((value) => ({
                                    ...value,
                                    cancel_transfer_password: event.target.value,
                                  }))
                                }
                                placeholder="Confirma tu contraseña"
                                className="h-9 w-full rounded-md border border-slate-200 px-3 text-xs"
                              />
                              <div className="mt-2 flex justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setForm((value) => ({
                                      ...value,
                                      cancel_transfer_id: '',
                                      cancel_transfer_password: '',
                                    }))
                                  }
                                  className="h-8 rounded-md border border-slate-200 px-3 text-xs"
                                >
                                  Conservar
                                </button>
                                <button
                                  type="button"
                                  disabled={saving || !form.cancel_transfer_password}
                                  onClick={() => void cancelCrossTenantCustody(transfer.id)}
                                  className="h-8 rounded-md bg-red-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                                >
                                  Cancelar solicitud
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {tab === 'delegation' && (
              <>
                <div>
                  <p className="text-sm font-medium text-slate-900">Delegar participación</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Solo se permite hacia miembros internos activos. El participante original se
                    conserva.
                  </p>
                </div>
                {data.delegationPolicy?.mode === 'DISABLED' && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    La política de la organización mantiene la delegación deshabilitada.
                  </div>
                )}
                <select
                  disabled={data.delegationPolicy?.mode === 'DISABLED'}
                  value={form.participant_reference_id || ''}
                  onChange={(event) => void selectDelegationParticipant(event.target.value)}
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                >
                  <option value="">Participante original</option>
                  {participantOptions.map((participant) => (
                    <option
                      key={participant.participant_ref_id}
                      value={participant.participant_ref_id}
                    >
                      {participant.name || participant.nombre || participant.email}
                    </option>
                  ))}
                </select>
                <select
                  disabled={data.delegationPolicy?.mode === 'DISABLED' || loadingDelegationContext}
                  value={form.delegate_member_id || ''}
                  onChange={(event) =>
                    setForm((value) => ({ ...value, delegate_member_id: event.target.value }))
                  }
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                >
                  <option value="">
                    {loadingDelegationContext ? 'Validando grupo...' : 'Miembro delegado'}
                  </option>
                  {delegateOptions.map((member: Row) => {
                    const memberId = member.member_id || member.id;
                    return (
                      <option key={memberId} value={memberId}>
                        {member.name || memberLabel(member)}
                      </option>
                    );
                  })}
                </select>
                {delegationContext?.group && (
                  <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                    {delegationContext.group.name} · Política{' '}
                    {delegationContext.group.completion_policy}. Solo se muestran miembros elegibles
                    del mismo grupo.
                  </div>
                )}
                <textarea
                  disabled={data.delegationPolicy?.mode === 'DISABLED'}
                  value={form.delegation_reason || ''}
                  onChange={(event) =>
                    setForm((value) => ({ ...value, delegation_reason: event.target.value }))
                  }
                  placeholder="Motivo de la delegación"
                  rows={3}
                  className="w-full resize-none rounded-md border border-slate-200 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  disabled={
                    saving ||
                    data.delegationPolicy?.mode === 'DISABLED' ||
                    !form.participant_reference_id ||
                    !form.delegate_member_id ||
                    String(form.delegation_reason || '').trim().length < 3
                  }
                  onClick={() =>
                    void mutate(
                      `/api/documentos/${documentId}/delegations`,
                      'POST',
                      {
                        action: 'create',
                        workspace_id: workspaceId,
                        participant_reference_id: form.participant_reference_id,
                        delegate_member_id: form.delegate_member_id,
                        reason: form.delegation_reason,
                        idempotency_key: crypto.randomUUID(),
                      },
                      'Delegación creada.'
                    )
                  }
                  className="h-10 w-full rounded-md bg-primary px-4 text-sm font-medium text-white disabled:opacity-50"
                >
                  Crear delegación
                </button>
                <div className="space-y-2">
                  {delegations.map((delegation) => (
                    <div
                      key={delegation.id}
                      className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-slate-800">
                          {delegation.status === 'active'
                            ? 'Delegación activa'
                            : 'Delegación finalizada'}
                        </p>
                        <p className="truncate text-[11px] text-slate-500">{delegation.reason}</p>
                      </div>
                      {delegation.status === 'active' && (
                        <button
                          type="button"
                          aria-label="Revocar delegación"
                          onClick={() =>
                            void mutate(
                              `/api/documentos/${documentId}/delegations`,
                              'POST',
                              {
                                action: 'revoke',
                                workspace_id: workspaceId,
                                delegation_id: delegation.id,
                                idempotency_key: crypto.randomUUID(),
                              },
                              'Delegación revocada.'
                            )
                          }
                          className="grid h-8 w-8 place-items-center rounded-md text-red-500 hover:bg-red-50"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            {tab === 'retention' && (
              <>
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    Aplicar política de retención
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Legal Hold conserva prioridad y nunca se libera desde esta acción.
                  </p>
                </div>
                <select
                  value={form.policy_id || ''}
                  onChange={(event) =>
                    setForm((value) => ({ ...value, policy_id: event.target.value }))
                  }
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                >
                  <option value="">Selecciona una política</option>
                  {(data.policies || []).map((policy: Row) => (
                    <option key={policy.id} value={policy.id}>
                      {policy.name} · {policy.duration_value} {policy.duration_unit}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={saving || !form.policy_id}
                  onClick={() =>
                    void mutate(
                      `/api/documentos/${documentId}/custody`,
                      'PATCH',
                      { workspace_id: workspaceId, policy_id: form.policy_id },
                      'Política de retención aplicada.'
                    )
                  }
                  className="h-10 w-full rounded-md bg-primary px-4 text-sm font-medium text-white disabled:opacity-50"
                >
                  Aplicar política
                </button>
                <HistoryRows
                  rows={data.assignments || []}
                  empty="Este documento no tiene una política asignada."
                  dateKey="applied_at"
                />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function HistoryRows({ rows, empty, dateKey }: { rows: Row[]; empty: string; dateKey: string }) {
  if (!rows.length)
    return (
      <p className="rounded-md border border-dashed border-slate-200 px-3 py-5 text-center text-xs text-slate-500">
        {empty}
      </p>
    );
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.id} className="rounded-md border border-slate-200 px-3 py-2">
          <div className="flex items-center gap-2">
            <ShieldCheck size={14} className="text-emerald-600" />
            <span className="text-xs font-medium text-slate-800">{row.status || 'Registrado'}</span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            {row[dateKey]
              ? new Intl.DateTimeFormat('es-MX', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }).format(new Date(row[dateKey]))
              : ''}
          </p>
        </div>
      ))}
    </div>
  );
}
