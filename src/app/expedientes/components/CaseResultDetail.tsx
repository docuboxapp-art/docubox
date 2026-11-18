'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, ClipboardList, Eye, FileText, FolderKanban, Loader2 } from 'lucide-react';
import type { publicCaseRuntime } from '@/lib/case-files/runtime.server';
import { caseRequest } from '@/lib/case-files/runtime-client';
import { CaseStatusBadge } from './CaseUI';
import type { CaseBrowserRow } from './CaseBrowser';

type Detail = ReturnType<typeof publicCaseRuntime>;
const date = (value: string) =>
  new Date(value).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
export default function CaseResultDetail({
  row,
  onChange,
}: {
  row: CaseBrowserRow;
  onChange?: () => void;
}) {
  const [tab, setTab] = useState<'documents' | 'forms' | 'closure'>('documents');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [access, setAccess] = useState<{ url: string; code: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  useEffect(() => {
    let live = true;
    caseRequest<Detail>(`/api/expedientes/${row.id}/control`)
      .then((value) => {
        if (live) setDetail(value);
      })
      .catch(() => {
        if (live)
          setError(
            'No se pudo cargar el detalle. Puedes abrir el expediente completo para consultar su información.'
          );
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [row.id]);
  async function launchAction(action: 'access' | 'cancel') {
    setBusy(true);
    setError('');
    try {
      const result = await caseRequest<{ access: { url: string; code: string } }>(
        `/api/expedientes/${row.id}/lanzamiento`,
        { action }
      );
      if (action === 'access') setAccess(result.access);
      else {
        setConfirmCancel(false);
        onChange?.();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo completar la operación.');
    } finally {
      setBusy(false);
    }
  }
  const items = (detail?.items || []).filter((item) =>
    tab === 'forms' ? item.kind === 'form' : item.kind !== 'form'
  );
  const subject = row.participants.find((person) => person.role === 'subject');
  return (
    <>
      <div className="space-y-4 p-5">
        <div>
          <h2 className="text-sm font-semibold">Detalle del expediente</h2>
          <p className="mt-1 text-xs text-slate-400">{row.folio}</p>
        </div>
        <div>
          <p className="text-sm font-medium">{subject?.name || row.subject_name || row.title}</p>
          {subject?.email && <p className="mt-1 text-xs text-slate-500">{subject.email}</p>}
        </div>
        <CaseStatusBadge status={row.status} />
        <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 dark:bg-muted">
          <div>
            <p className="text-[10px] uppercase text-slate-500">Apertura</p>
            <p className="mt-1 text-xs">{date(row.created_at)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase text-slate-500">
              {row.closed_at ? 'Cierre' : 'Última actividad'}
            </p>
            <p className="mt-1 text-xs">{date(row.closed_at || row.updated_at)}</p>
          </div>
        </div>
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>Avance del expediente</span>
          <span className="font-semibold text-primary">{row.progress}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full bg-primary"
            style={{ width: `${Math.min(100, Math.max(0, row.progress))}%` }}
          />
        </div>
      </div>
      <div className="flex border-y border-slate-200 dark:border-border">
        {(
          [
            ['documents', 'Documentos', FileText],
            ['forms', 'Formularios', ClipboardList],
            ['closure', 'Cierre', CheckCircle2],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            aria-pressed={tab === id}
            className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 border-b-2 py-3 text-xs ${tab === id ? 'border-primary text-primary' : 'border-transparent text-slate-500'}`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>
      <div className="space-y-4 p-5">
        <Link
          href={`/expedientes/${row.id}?tab=${tab === 'forms' ? 'formularios' : tab === 'closure' ? 'cierre' : 'documentos'}`}
          className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-white"
        >
          <Eye size={16} />
          Ver expediente completo
        </Link>
        {loading ? (
          <p role="status" className="flex items-center gap-2 py-4 text-xs text-slate-500">
            <Loader2 size={16} className="animate-spin" />
            Cargando información…
          </p>
        ) : error ? (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        ) : tab === 'closure' ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold">Condiciones de cierre</p>
            {detail?.conditions.map((condition) => (
              <div key={condition.key} className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs font-medium">{condition.reason}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {condition.status === 'satisfied'
                    ? 'Cumplida'
                    : condition.status === 'not_applicable'
                      ? 'No aplica'
                      : 'Pendiente'}
                </p>
              </div>
            ))}
            {Boolean(detail?.rootHash) && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
                <p className="font-medium">Expediente cerrado y sellado</p>
                <p className="mt-1 break-all font-mono text-[10px]">{String(detail?.rootHash)}</p>
              </div>
            )}
          </div>
        ) : items.length ? (
          items.map((item) => (
            <div key={item.id} className="rounded-lg border border-slate-200 p-3">
              <p className="text-sm font-medium">{item.title}</p>
              <p className="mt-1 text-xs text-slate-500">
                {item.applicable === false
                  ? 'No aplica'
                  : item.received
                    ? 'Recibido'
                    : 'Pendiente de entrega'}
                {item.required ? ' · Obligatorio' : ''}
              </p>
              {item.received && (
                <Link
                  href={`/expedientes/${row.id}?tab=${tab === 'forms' ? 'formularios' : 'documentos'}`}
                  className="mt-2 inline-flex items-center gap-1 text-xs text-primary"
                >
                  <Eye size={13} />
                  Consultar {tab === 'forms' ? 'formulario vinculado' : 'documento'}
                </Link>
              )}
            </div>
          ))
        ) : (
          <div className="py-6 text-center text-xs text-slate-500">
            <FolderKanban size={22} className="mx-auto mb-3 text-slate-300" />
            No hay {tab === 'forms' ? 'formularios' : 'documentos'} vinculados.
          </div>
        )}
        <div className="border-t border-slate-100 pt-4 text-xs text-slate-500">
          <p>
            Responsable:{' '}
            <span className="text-slate-700">{row.responsibleNames?.join(', ') || 'Sin asignar'}</span>
          </p>
          <p className="mt-2">
            Invitaciones: {row.delivery.sent} de {row.delivery.total} enviadas
          </p>
          {row.launch && (
            <p className="mt-2">
              Acceso: {row.launch.access_mode === 'public' ? 'Público con código' : 'Privado'}
            </p>
          )}
        </div>
        {row.canManage && row.launch?.access_mode === 'public' && row.status !== 'cancelled' && (
          <button
            disabled={busy}
            onClick={() => void launchAction('access')}
            className="text-xs text-primary disabled:opacity-50"
          >
            Consultar enlace y código
          </button>
        )}
        {access && (
          <div className="space-y-3 rounded-lg border border-slate-200 p-3">
            <label className="block text-xs text-slate-500">
              Enlace
              <input
                readOnly
                value={access.url}
                className="mt-1 h-9 w-full rounded border border-slate-200 px-2 text-xs"
              />
            </label>
            <label className="block text-xs text-slate-500">
              Código
              <input
                readOnly
                value={access.code}
                className="mt-1 h-9 w-full rounded border border-slate-200 px-2 font-mono"
              />
            </label>
            <button onClick={() => setAccess(null)} className="text-xs text-slate-500">
              Ocultar acceso
            </button>
          </div>
        )}
        {row.canManage && row.isScheduled && row.status !== 'cancelled' && (
          <div>
            {!confirmCancel ? (
              <button onClick={() => setConfirmCancel(true)} className="text-xs text-red-600">
                Cancelar envío programado
              </button>
            ) : (
              <div className="rounded border border-red-200 p-3 text-xs">
                <p>Se revocarán los enlaces y no se enviarán las invitaciones.</p>
                <div className="mt-3 flex gap-4">
                  <button
                    disabled={busy}
                    onClick={() => void launchAction('cancel')}
                    className="text-red-600"
                  >
                    Confirmar cancelación
                  </button>
                  <button disabled={busy} onClick={() => setConfirmCancel(false)}>
                    Volver
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
