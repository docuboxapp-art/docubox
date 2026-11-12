'use client';
import { useEffect, useState } from 'react';
import { Loader2, Mail, RefreshCw, Send, ShieldX } from 'lucide-react';
import { caseRequest } from '@/lib/case-files/runtime-client';
import type { DeliverySummary, InvitationSummary } from '@/lib/case-files/invitations';
import { BottomNotice } from '@/components/ui/BottomNotice';

const labels: Record<InvitationSummary['status'], string> = {
  scheduled: 'Envío programado',
  pending: 'Pendiente de envío',
  sending: 'Enviando',
  retrying: 'Pendiente de reintento',
  failed: 'No enviada',
  sent: 'Enviada',
  attention: 'Requiere nueva invitación',
  expired: 'Vencida',
  revoked: 'Revocada',
};
export function CaseInvitationPanel({
  caseId,
  onChanged,
  allowSend = true,
}: {
  caseId: string;
  onChanged?: () => void;
  allowSend?: boolean;
}) {
  const [data, setData] = useState<DeliverySummary | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [confirmation, setConfirmation] = useState<{
    invitation: InvitationSummary;
    action: 'renew' | 'revoke';
    operationKey: string;
  } | null>(null);
  useEffect(() => {
    let live = true;
    caseRequest<DeliverySummary>(`/api/expedientes/${caseId}/invitaciones`)
      .then((value) => {
        if (live) setData(value);
      })
      .catch(() => {
        if (live) setError('No se pudo consultar el envío de invitaciones.');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [caseId]);
  const act = async (action: 'retry' | 'renew' | 'revoke', selection = confirmation) => {
    if (busy || (!allowSend && action !== 'revoke')) return;
    setBusy(true);
    setError('');
    try {
      const value = await caseRequest<DeliverySummary>(`/api/expedientes/${caseId}/invitaciones`, {
        action,
        ...(selection
          ? { invitationId: selection.invitation.id, operationKey: selection.operationKey }
          : {}),
      });
      setData(value);
      setConfirmation(null);
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron enviar las invitaciones.');
    } finally {
      setBusy(false);
    }
  };
  if (loading)
    return (
      <section
        role="status"
        className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500"
      >
        <Loader2 size={16} className="animate-spin" />
        Consultando invitaciones...
      </section>
    );
  if (data?.total === 0) return null;
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Mail size={16} className="text-primary" />
            Invitaciones a participantes
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            {data
              ? `${data.sent} de ${data.total} invitaciones enviadas. Cada persona recibe su enlace personal.`
              : 'Consulta el resultado del envío.'}
          </p>
        </div>
        {data && (data.pending > 0 || data.invitations.some((i) => i.status === 'failed')) && (
          <button
            type="button"
            disabled={busy || !allowSend}
            onClick={() => void act('retry', null)}
            aria-disabled={!allowSend}
            className="flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-xs font-medium text-primary disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Reintentar pendientes
          </button>
        )}
      </div>
      {data && (
        <ul className="mt-4 divide-y divide-slate-100">
          {data.invitations.map((invitation) => (
            <li key={invitation.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-medium">{invitation.name}</p>
                <p className="break-all text-xs text-slate-500">{invitation.email}</p>
              </div>
              <span
                className={`rounded-md px-2 py-1 text-xs ${invitation.status === 'sent' ? 'bg-emerald-50 text-emerald-700' : ['failed', 'attention'].includes(invitation.status) ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-500'}`}
              >
                {labels[invitation.status]}
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  title={
                    allowSend
                      ? 'Enviar nueva invitación'
                      : 'El expediente ya no admite nuevas invitaciones'
                  }
                  aria-label={`Enviar nueva invitación a ${invitation.name}`}
                  disabled={busy || !allowSend}
                  onClick={() =>
                    setConfirmation({
                      invitation,
                      action: 'renew',
                      operationKey: crypto.randomUUID(),
                    })
                  }
                  className="rounded-md p-2 text-slate-500 hover:bg-blue-50 hover:text-primary disabled:opacity-50"
                >
                  <Send size={14} />
                </button>
                {invitation.status !== 'revoked' && (
                  <button
                    type="button"
                    title="Revocar enlace"
                    aria-label={`Revocar enlace de ${invitation.name}`}
                    disabled={busy}
                    onClick={() =>
                      setConfirmation({
                        invitation,
                        action: 'revoke',
                        operationKey: crypto.randomUUID(),
                      })
                    }
                    className="rounded-md p-2 text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                  >
                    <ShieldX size={14} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {confirmation && (
        <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 p-4">
          <p className="text-sm text-slate-700">
            {confirmation.action === 'renew'
              ? `Se enviará un nuevo enlace a ${confirmation.invitation.name} y se invalidará el anterior.`
              : `Se invalidará el enlace de ${confirmation.invitation.name}. Su participación se conserva.`}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(confirmation.action)}
              className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
            >
              {busy
                ? 'Procesando...'
                : confirmation.action === 'renew'
                  ? 'Enviar nueva invitación'
                  : 'Revocar enlace'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmation(null)}
              className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
      {!data && (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              setData(
                await caseRequest<DeliverySummary>(`/api/expedientes/${caseId}/invitaciones`)
              );
              setError('');
            } catch {
              setError('No se pudo consultar el envío de invitaciones.');
            } finally {
              setBusy(false);
            }
          }}
          className="mt-3 text-sm font-medium text-primary"
        >
          Reintentar consulta
        </button>
      )}
      <p className="mt-3 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-400">
        Enviada indica que el proveedor aceptó el correo; no confirma su lectura. Una invitación no
        verifica identidad ni autoriza firmas o cierre.
      </p>
      {error && <BottomNotice message={error} tone="critical" onClose={() => setError('')} />}
    </section>
  );
}
