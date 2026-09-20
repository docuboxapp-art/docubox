'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowRightLeft, Check, Clock3, FileText, Loader2, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

type CustodyTransferRow = {
  id: string;
  document_id: string;
  source_workspace_id: string;
  destination_workspace_id: string;
  requested_at: string;
  reason: string;
  status: 'pending' | 'completed' | 'rejected' | 'cancelled' | 'expired';
  accepted_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  cancelled_at: string | null;
  completed_at: string | null;
  expires_at: string;
  correlation_id: string;
  document: {
    id: string;
    nombre: string | null;
    documento_id: string | null;
    estado: string | null;
    legal_hold_status: string | null;
    current_custodian_workspace_id: string | null;
  } | null;
  source_organization: {
    id: string;
    name: string | null;
    workspace_slug: string | null;
  } | null;
};

export function OrganizationCustodyInbox({ workspaceId }: { workspaceId: string }) {
  const { session } = useAuth();
  const [rows, setRows] = useState<CustodyTransferRow[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<{ id: string; action: 'accept' | 'reject' } | null>(
    null
  );
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const api = useCallback(
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
    try {
      const payload = await api(
        `/api/organizacion/custody-transfers?workspace_id=${encodeURIComponent(workspaceId)}`
      );
      setRows(payload.data || []);
      setEnabled(payload.enabled === true);
      setError('');
    } catch (cause) {
      setRows([]);
      setEnabled(false);
      const text = cause instanceof Error ? cause.message : '';
      if (!text.includes('permiso')) setError(text || 'No se pudieron cargar las solicitudes.');
    } finally {
      setLoading(false);
    }
  }, [api, session?.access_token, workspaceId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  const resolve = async () => {
    if (!selected) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const scope = 'documents.custody.receive';
      const reauthentication = await api('/api/organizacion/reauthenticate', {
        method: 'POST',
        body: JSON.stringify({ workspace_id: workspaceId, password, scopes: [scope] }),
      });
      await api('/api/organizacion/custody-transfers', {
        method: 'POST',
        headers: { 'X-Organization-Reauth': reauthentication.token },
        body: JSON.stringify({
          workspace_id: workspaceId,
          transfer_id: selected.id,
          action: selected.action,
          reason: selected.action === 'reject' ? reason : undefined,
          idempotency_key: crypto.randomUUID(),
        }),
      });
      setMessage(
        selected.action === 'accept'
          ? 'Custodia aceptada. El documento ya está disponible para la organización.'
          : 'Solicitud rechazada sin modificar el documento.'
      );
      setSelected(null);
      setPassword('');
      setReason('');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo responder la solicitud.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <section className="rounded-lg border border-border bg-background px-5 py-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" /> Cargando solicitudes de custodia...
        </div>
      </section>
    );
  }
  if (!enabled && !error) return null;

  const pending = rows.filter((row) => row.status === 'pending');
  return (
    <section className="rounded-lg border border-border bg-background overflow-hidden">
      <div className="flex items-start gap-3 border-b border-border px-5 py-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
          <ArrowRightLeft size={17} />
        </span>
        <div>
          <h3 className="text-sm font-medium text-foreground">Solicitudes de custodia recibidas</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Revisa y acepta explícitamente antes de que la organización adquiera custodia.
          </p>
        </div>
      </div>
      {error && (
        <div className="m-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      {message && (
        <div className="m-4 flex gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          <Check size={16} /> {message}
        </div>
      )}
      {pending.length ? (
        <div className="divide-y divide-border">
          {pending.map((row) => (
            <div key={row.id} className="px-5 py-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                    <FileText size={16} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {row.document?.nombre || 'Documento'}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {row.source_organization?.name || 'Organización origen'} ·{' '}
                      {row.document?.documento_id || 'Sin folio'}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{row.reason}</p>
                    <p className="mt-1 flex items-center gap-1 text-xs text-amber-700">
                      <Clock3 size={12} /> Vence{' '}
                      {new Intl.DateTimeFormat('es-MX', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(new Date(row.expires_at))}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelected({ id: row.id, action: 'reject' });
                      setPassword('');
                      setReason('');
                    }}
                    className="h-9 rounded-md border border-border px-3 text-sm text-muted-foreground hover:bg-muted"
                  >
                    Rechazar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected({ id: row.id, action: 'accept' });
                      setPassword('');
                      setReason('');
                    }}
                    className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-white"
                  >
                    Aceptar custodia
                  </button>
                </div>
              </div>
              {selected?.id === row.id && (
                <div className="mt-4 rounded-md border border-border bg-muted/30 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">
                      {selected?.action === 'accept' ? 'Confirmar aceptación' : 'Confirmar rechazo'}
                    </p>
                    <button
                      type="button"
                      onClick={() => setSelected(null)}
                      title="Cerrar"
                      aria-label="Cerrar confirmación"
                      className="grid h-8 w-8 place-items-center rounded-md hover:bg-muted"
                    >
                      <X size={15} />
                    </button>
                  </div>
                  {selected?.action === 'accept' && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      La organización será el custodio administrativo. No cambiarán firmas,
                      evidencia, retención ni Legal Hold.
                    </p>
                  )}
                  {selected?.action === 'reject' && (
                    <textarea
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="Motivo del rechazo"
                      rows={2}
                      className="mt-3 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm"
                    />
                  )}
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Confirma tu contraseña"
                    className="mt-3 h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                  />
                  <button
                    type="button"
                    disabled={
                      saving ||
                      !password ||
                      (selected?.action === 'reject' && reason.trim().length < 3)
                    }
                    onClick={() => void resolve()}
                    className="mt-3 h-10 rounded-md bg-primary px-4 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {saving ? 'Confirmando...' : 'Confirmar'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="px-5 py-8 text-center text-sm text-muted-foreground">
          No hay solicitudes pendientes.
        </div>
      )}
      {rows.some((row) => row.status === 'completed') && (
        <div className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
          Los documentos aceptados aparecen con acceso de custodia en su visor.{' '}
          {rows
            .filter((row) => row.status === 'completed')
            .slice(0, 1)
            .map((row) => (
              <Link
                key={row.id}
                href={`/visor-documento/${row.document_id}`}
                className="text-primary"
              >
                Abrir el más reciente
              </Link>
            ))}
        </div>
      )}
    </section>
  );
}
