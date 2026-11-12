'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Circle,
  AlertCircle,
  RefreshCw,
  Loader2,
  FileText,
  ShieldCheck,
  PenLine,
  LockKeyhole,
  X,
  ExternalLink,
} from 'lucide-react';
import { caseRequest } from '@/lib/case-files/runtime-client';
import { CaseInvitationPanel } from './CaseInvitationPanel';
import type { publicCaseRuntime } from '@/lib/case-files/runtime.server';

type Control = ReturnType<typeof publicCaseRuntime>;
type Options = {
  members: { id: string; name: string; role: string }[];
  documents: { id: string; nombre: string }[];
  responses: { id: string; template_id: string; folio: string; submitted_at: string }[];
  verifications: { id: string; created_at: string }[];
};
const panel = 'rounded-lg border border-slate-200 bg-white p-5 dark:border-border dark:bg-card';
const button =
  'inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium disabled:opacity-50 dark:border-border';
const primary = button + ' border-primary bg-primary text-white';
const input =
  'min-h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-border dark:bg-background';
const labelStatus = (status: unknown) =>
  ({
    accepted: 'Revisión aceptada',
    observed: 'Requiere corrección',
    rejected: 'Rechazado',
    approved: 'Aprobado',
    pending: 'Pendiente',
    signed: 'Firmado',
    committed: 'Confirmado',
  })[String(status)] || 'Pendiente';

export function CaseControlPanel({
  caseId,
  mode,
  onChanged,
}: {
  caseId: string;
  mode: string;
  onChanged: () => void;
}) {
  const [view, setView] = useState<Control | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState<Record<string, string>>({});
  const [issueDates, setIssueDates] = useState<Record<string, string>>({});
  const [dialog, setDialog] = useState<{
    action: string;
    decision?: string;
    itemId?: string;
  } | null>(null);
  const [reason, setReason] = useState('');
  const [affected, setAffected] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState(false);
  const [challenge, setChallenge] = useState<Record<string, string>>({});
  const [codes, setCodes] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    try {
      const [data, available] = await Promise.all([
        caseRequest<Control>(`/api/expedientes/${caseId}/control`),
        caseRequest<Options>(`/api/expedientes/opciones?caseId=${caseId}`),
      ]);
      setView(data);
      setOptions(available);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar la evidencia.');
    } finally {
      setLoading(false);
    }
  }, [caseId]);
  useEffect(() => {
    let active = true;
    Promise.all([
      caseRequest<Control>(`/api/expedientes/${caseId}/control`),
      caseRequest<Options>(`/api/expedientes/opciones?caseId=${caseId}`),
    ])
      .then(([data, available]) => {
        if (active) {
          setView(data);
          setOptions(available);
          setError('');
        }
      })
      .catch((cause) => {
        if (active)
          setError(cause instanceof Error ? cause.message : 'No se pudo cargar la evidencia.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [caseId]);
  useEffect(() => {
    if (!dialog) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) setDialog(null);
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [dialog, busy]);
  const act = async (action: string, details: Record<string, unknown> = {}) => {
    if (busy || !view) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const data = await caseRequest<Control>(`/api/expedientes/${caseId}/control`, {
        action,
        revision: view.revision,
        operationKey: crypto.randomUUID(),
        ...details,
      });
      setView(data);
      setDialog(null);
      setReason('');
      setAffected([]);
      setConfirmation(false);
      setNotice(
        data.status === 'sealed'
          ? 'Expediente completado. La instantánea y sus evidencias quedaron conservadas.'
          : 'Operación registrada. Los controles se comprobaron en el servidor.'
      );
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo completar la operación.');
    } finally {
      setBusy(false);
    }
  };
  const otp = async (itemId: string, action: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const data = await caseRequest<{ challengeId?: string; verified?: boolean }>(
        `/api/expedientes/${caseId}/correo`,
        { action, itemId, challengeId: challenge[itemId], code: codes[itemId] }
      );
      if (data.challengeId) {
        setChallenge((current) => ({ ...current, [itemId]: data.challengeId! }));
        setNotice('Código enviado al correo del participante.');
      } else if (!data.verified) setError('El código no es válido o ya venció.');
      else {
        setNotice('Correo verificado para este expediente.');
        await load();
        onChanged();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo verificar el correo.');
    } finally {
      setBusy(false);
    }
  };
  const downloadManifest = async () => {
    const session = await (await import('@/lib/supabase/client')).createClient().auth.getSession();
    const response = await fetch(`/api/expedientes/${caseId}/manifest`, {
      headers: { Authorization: `Bearer ${session.data.session?.access_token || ''}` },
    });
    if (!response.ok) {
      setError('No se pudo descargar la instantánea.');
      return;
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = `expediente-${caseId}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  if (loading)
    return (
      <div className={panel}>
        <Loader2 className="animate-spin text-primary" aria-label="Cargando controles" />
      </div>
    );
  if (!view)
    return (
      <div className={panel}>
        <p role="alert" className="text-sm text-red-700">
          {error || 'No se pudo cargar el expediente.'}
        </p>
        <button type="button" className={button + ' mt-3'} onClick={() => void load()}>
          Reintentar
        </button>
      </div>
    );
  const closed = view.status === 'sealed' || view.status === 'cancelled';
  const show = (...modes: string[]) => modes.includes(mode);
  const items = view.items.filter((item) =>
    mode === 'formularios'
      ? item.kind === 'form'
      : mode === 'documentos'
        ? item.kind !== 'form'
        : true
  );
  return (
    <div className="space-y-4">
      {view.canManageInvitations && mode === 'resumen' && (
        <CaseInvitationPanel
          caseId={caseId}
          allowSend={!closed && view.status !== 'cancelled'}
          onChanged={() => void load()}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          Los resultados proceden de versiones y decisiones registradas.
        </p>
        <button
          type="button"
          className={button}
          disabled={busy}
          onClick={() => (closed ? void load() : void act('refresh'))}
        >
          <RefreshCw size={14} />
          Actualizar controles
        </button>
      </div>
      {show('resumen', 'cierre') && (
        <section className={panel}>
          <h2 className="mb-3 text-sm font-semibold">Responsables del expediente</h2>
          <div className="flex flex-wrap gap-3">
            {view.responsibilities.map(({ kind, label, userId }) => (
              <label key={kind} className="flex items-center gap-2 text-sm">
                <span>{label}</span>
                {view.canOrganize && !closed ? (
                  <select
                    aria-label={
                      kind === 'approver'
                        ? 'Reasignar aprobador'
                        : kind === 'owner'
                          ? 'Reasignar responsable del expediente'
                          : 'Reasignar responsable del cierre'
                    }
                    className={input}
                    disabled={busy}
                    value={userId}
                    onChange={(event) => {
                      if (event.target.value)
                        void act('assign', { kind, userId: event.target.value });
                    }}
                  >
                    <option value="">Sin asignar</option>
                    {options?.members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name} · {member.role}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="font-medium">
                    {options?.members.find((m) => m.id === userId)?.name || 'Sin asignar'}
                  </span>
                )}
              </label>
            ))}
          </div>
        </section>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
        </div>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800"
        >
          {notice}
        </p>
      )}
      {show('resumen', 'cierre') && (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className={panel}>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck size={18} className="text-primary" />
              Condiciones de revisión y cierre
            </h2>
            <ul className="mt-4 divide-y divide-slate-100 dark:divide-border">
              {view.conditions.map((condition) => (
                <li key={condition.key} className="flex gap-3 py-3 text-sm">
                  {condition.status === 'satisfied' ? (
                    <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-600" />
                  ) : condition.status === 'blocking' || condition.status === 'failed' ? (
                    <AlertCircle size={17} className="mt-0.5 shrink-0 text-amber-600" />
                  ) : (
                    <Circle size={17} className="mt-0.5 shrink-0 text-slate-400" />
                  )}
                  <div>
                    <p>{condition.reason}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {
                        {
                          satisfied: 'Comprobado',
                          pending: 'Pendiente',
                          blocking: 'Bloqueante',
                          failed: 'No se pudo evaluar',
                          not_applicable: 'No aplica',
                        }[condition.status]
                      }
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
          <aside className="space-y-4">
            <section className={panel}>
              <h2 className="text-sm font-semibold">Aprobación final</h2>
              <p className="mt-2 text-sm text-slate-500">
                {view.approval.enabled
                  ? view.approval.stale
                    ? 'La evidencia cambió; se necesita una nueva decisión.'
                    : labelStatus(view.approval.decision)
                  : 'Esta política no exige aprobación final.'}
              </p>
              {view.approval.enabled && view.approval.canDecide && !closed && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={primary}
                    disabled={busy || !view.approval.ready}
                    onClick={() => void act('approval', { decision: 'approved' })}
                  >
                    Aprobar expediente
                  </button>
                  <button
                    type="button"
                    className={button}
                    disabled={busy}
                    onClick={() => setDialog({ action: 'approval', decision: 'corrections' })}
                  >
                    Solicitar correcciones
                  </button>
                  <button
                    type="button"
                    className={button}
                    disabled={busy}
                    onClick={() => setDialog({ action: 'approval', decision: 'rejected' })}
                  >
                    Rechazar
                  </button>
                </div>
              )}
            </section>
            <section className={panel}>
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <LockKeyhole size={17} />
                Finalización
              </h2>
              <p className="mt-2 text-sm text-slate-500">
                {view.status === 'cancelled'
                  ? 'Expediente cancelado. Su historial se conserva para consulta.'
                  : view.status === 'sealed'
                    ? 'Expediente completado. El histórico no admite cambios ordinarios.'
                    : view.completion.mode === 'automatic'
                      ? 'Se completa automáticamente al cumplir todas las condiciones.'
                      : 'Al cumplir las condiciones requiere la confirmación del responsable.'}
              </p>
              {!closed && view.completion.mode === 'manual' && (
                <button
                  type="button"
                  className={primary + ' mt-4'}
                  disabled={busy || !view.completion.canClose}
                  onClick={() => setDialog({ action: 'close' })}
                >
                  Confirmar cierre
                </button>
              )}
              {view.status === 'sealed' && (
                <>
                  <p className="mt-3 break-all text-xs text-slate-500">
                    SHA-256: {String(view.rootHash || '')}
                  </p>
                  <button
                    type="button"
                    className={button + ' mt-4'}
                    onClick={() => void downloadManifest()}
                  >
                    Descargar instantánea verificable
                  </button>
                  <p className="mt-2 text-xs text-slate-500">
                    Resumen de integración. No se ha solicitado una certificación externa.
                  </p>
                </>
              )}
            </section>
          </aside>
        </div>
      )}
      {show('documentos', 'formularios') && (
        <section className={panel}>
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
            <FileText size={17} />
            Contenido y revisiones
          </h2>
          <div className="divide-y divide-slate-100 dark:divide-border">
            {items.map((item) => (
              <article key={String(item.id)} className="space-y-3 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold">{String(item.title)}</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      {item.received
                        ? item.requiresReview
                          ? labelStatus(item.review)
                          : 'Entrega recibida'
                        : 'Entrega pendiente'}
                      {item.required ? ' · Obligatorio' : ' · Opcional'}
                    </p>
                  </div>
                  {Boolean(item.documentId) && (
                    <a
                      className="inline-flex items-center gap-1 text-sm text-primary"
                      href={`/visor-documento/${item.documentId}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink size={14} />
                      Abrir documento
                    </a>
                  )}
                </div>
                {!closed && (
                  <div className="flex flex-wrap gap-2">
                    <label className="min-w-48 flex-1">
                      <span className="sr-only">Vincular a {String(item.title)}</span>
                      <select
                        className={input}
                        value={source[String(item.id)] || ''}
                        onChange={(event) =>
                          setSource((current) => ({
                            ...current,
                            [String(item.id)]: event.target.value,
                          }))
                        }
                      >
                        <option value="">
                          {item.kind === 'form'
                            ? 'Seleccionar respuesta completada…'
                            : 'Seleccionar documento guardado…'}
                        </option>
                        {item.kind === 'form'
                          ? options?.responses
                              .filter((response) => response.template_id === item.sourceId)
                              .map((response) => (
                                <option key={response.id} value={response.id}>
                                  {response.folio || 'Respuesta'} ·{' '}
                                  {new Date(response.submitted_at).toLocaleDateString('es-MX')}
                                </option>
                              ))
                          : options?.documents.map((document) => (
                              <option key={document.id} value={document.id}>
                                {document.nombre}
                              </option>
                            ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className={button}
                      disabled={busy || !source[String(item.id)]}
                      onClick={() =>
                        void act('attach', {
                          itemId: item.id,
                          sourceId: source[String(item.id)],
                          kind: item.kind === 'form' ? 'form' : 'document',
                          issueDate: issueDates[item.id] || null,
                        })
                      }
                    >
                      Vincular versión
                    </button>
                    {(item.askIssueDate || item.validityDays) && (
                      <label className="text-xs text-slate-500">
                        Fecha de emisión
                        <input
                          required
                          type="date"
                          className={input}
                          value={issueDates[item.id] || ''}
                          onChange={(event) =>
                            setIssueDates((current) => ({
                              ...current,
                              [item.id]: event.target.value,
                            }))
                          }
                        />
                      </label>
                    )}
                    {item.kind !== 'form' && (
                      <a
                        className={button}
                        href={
                          item.kind === 'document_template'
                            ? '/crear-documento'
                            : '/crear-documento'
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        Crear documento
                      </a>
                    )}
                  </div>
                )}
                {view.canOrganize && !closed && (
                  <div className="flex flex-wrap gap-2">
                    {item.requiresReview === true && (
                      <select
                        aria-label={`Reasignar revisor de ${item.title}`}
                        className={input}
                        disabled={busy}
                        value={String(item.reviewerId || '')}
                        onChange={(event) =>
                          void act('assign', {
                            kind: 'reviewer',
                            itemId: item.id,
                            userId: event.target.value,
                          })
                        }
                      >
                        <option value="">Seleccionar revisor…</option>
                        {options?.members.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.name} · {member.role}
                          </option>
                        ))}
                      </select>
                    )}
                    {item.conditional === true && (
                      <button
                        type="button"
                        className={button}
                        onClick={() =>
                          setDialog({ action: 'applicability', itemId: String(item.id) })
                        }
                      >
                        Definir aplicabilidad
                      </button>
                    )}
                  </div>
                )}
                {item.canReview === true && !closed && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={primary}
                      disabled={busy}
                      onClick={() => void act('review', { itemId: item.id, decision: 'accepted' })}
                    >
                      Aceptar revisión
                    </button>
                    <button
                      type="button"
                      className={button}
                      disabled={busy}
                      onClick={() =>
                        setDialog({
                          action: 'review',
                          itemId: String(item.id),
                          decision: 'observed',
                        })
                      }
                    >
                      Solicitar corrección
                    </button>
                    <button
                      type="button"
                      className={button}
                      disabled={busy}
                      onClick={() =>
                        setDialog({
                          action: 'review',
                          itemId: String(item.id),
                          decision: 'rejected',
                        })
                      }
                    >
                      Rechazar entrega
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
      {show('identidad') && (
        <section className={panel}>
          <h2 className="mb-4 text-sm font-semibold">Verificaciones del expediente</h2>
          {view.checks.map((check) => (
            <article
              key={String(check.id)}
              className="space-y-3 border-b border-slate-100 py-4 last:border-0"
            >
              <h3 className="text-sm font-semibold">
                {String(check.method)} · {labelStatus(check.status)}
              </h3>
              {!closed && check.method === 'email_otp' ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    className={button}
                    type="button"
                    disabled={busy}
                    onClick={() => void otp(String(check.id), 'send')}
                  >
                    Enviar código al participante
                  </button>
                  {challenge[String(check.id)] && (
                    <>
                      <label>
                        <span className="sr-only">Código de correo</span>
                        <input
                          className={input}
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          maxLength={6}
                          value={codes[String(check.id)] || ''}
                          onChange={(event) =>
                            setCodes((current) => ({
                              ...current,
                              [String(check.id)]: event.target.value,
                            }))
                          }
                          placeholder="Código de seis dígitos"
                        />
                      </label>
                      <button
                        type="button"
                        className={primary}
                        disabled={busy}
                        onClick={() => void otp(String(check.id), 'verify')}
                      >
                        Verificar código
                      </button>
                    </>
                  )}
                </div>
              ) : (
                !closed && (
                  <div className="flex gap-2">
                    <label className="flex-1">
                      <span className="sr-only">Evidencia de verificación</span>
                      <select
                        className={input}
                        value={source[String(check.id)] || ''}
                        onChange={(event) =>
                          setSource((current) => ({
                            ...current,
                            [String(check.id)]: event.target.value,
                          }))
                        }
                      >
                        <option value="">Seleccionar evidencia…</option>
                        {['tax', 'representative', 'custom'].includes(String(check.method))
                          ? view.items
                              .filter((item) => item.bindingId && item.review === 'accepted')
                              .map((item) => (
                                <option key={String(item.id)} value={String(item.bindingId)}>
                                  {String(item.title)} · revisión documental
                                </option>
                              ))
                          : options?.verifications.map((proof) => (
                              <option key={proof.id} value={proof.id}>
                                Identidad acreditada ·{' '}
                                {new Date(proof.created_at).toLocaleDateString('es-MX')}
                              </option>
                            ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className={button}
                      disabled={busy || !source[String(check.id)]}
                      onClick={() =>
                        void act('verify', { itemId: check.id, sourceId: source[String(check.id)] })
                      }
                    >
                      Vincular evidencia
                    </button>
                  </div>
                )
              )}
            </article>
          ))}
        </section>
      )}
      {show('firmas') && (
        <section className={panel}>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <PenLine size={17} />
            Firma de documentos
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            {view.signatures.ready
              ? 'Los controles previos permiten continuar en el flujo de firma del documento.'
              : 'Completa los controles y la aprobación configurados antes de firmar.'}
          </p>
          <ul className="mt-4 divide-y divide-slate-100">
            {view.signatures.documents.map((document) => (
              <li
                key={String(document.itemId)}
                className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
              >
                <span>
                  {String(document.title)} · {document.signed ? 'Firma comprobada' : 'Pendiente'}
                </span>
                <a
                  className={button}
                  href={`/crear-documento?draft=${document.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Abrir flujo de firma
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      {show('hitos') && (
        <section className={panel}>
          <h2 className="text-sm font-semibold">Etapas y controles</h2>
          {view.stages.map((stage) => (
            <div
              key={stage.id}
              className="flex items-center justify-between gap-3 border-b border-slate-100 py-3 text-sm"
            >
              <span>
                {stage.title} · {stage.status === 'completed' ? 'Completada' : 'Pendiente'}
              </span>
              {stage.canConfirm && !closed && (
                <button
                  className={button}
                  type="button"
                  disabled={busy}
                  onClick={() => void act('stage', { stageId: stage.id })}
                >
                  Confirmar etapa
                </button>
              )}
            </div>
          ))}
        </section>
      )}
      {dialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/45 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="case-decision-title"
            className="w-full max-w-xl rounded-xl bg-white p-5 shadow-xl dark:bg-card"
          >
            <header className="flex items-center justify-between">
              <h2 id="case-decision-title" className="font-semibold">
                {dialog.action === 'applicability'
                  ? 'Definir aplicabilidad'
                  : dialog.action === 'close'
                    ? 'Confirmar cierre del expediente'
                    : dialog.decision === 'rejected'
                      ? 'Registrar rechazo'
                      : 'Solicitar correcciones'}
              </h2>
              <button
                type="button"
                aria-label="Cerrar confirmación"
                onClick={() => setDialog(null)}
              >
                <X size={18} />
              </button>
            </header>
            {dialog.action === 'close' ? (
              <label className="my-5 flex gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={confirmation}
                  onChange={(event) => setConfirmation(event.target.checked)}
                />
                Confirmo el cierre con las evidencias y decisiones de la versión actual. El servidor
                volverá a comprobar todas las condiciones.
              </label>
            ) : (
              <>
                {dialog.action === 'applicability' && (
                  <label className="mt-4 flex gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={confirmation}
                      onChange={(event) => setConfirmation(event.target.checked)}
                    />
                    Este requisito aplica al sujeto del expediente
                  </label>
                )}
                <label className="mt-4 block text-sm">
                  Motivo
                  <textarea
                    autoFocus
                    className={input + ' mt-2 min-h-24 py-2'}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    maxLength={2000}
                  />
                </label>
                {dialog.action === 'approval' && dialog.decision === 'corrections' && (
                  <fieldset className="mt-4 space-y-2">
                    <legend className="mb-2 text-sm font-medium">
                      Elementos que requieren corrección
                    </legend>
                    {view.items.map((item) => (
                      <label key={String(item.id)} className="flex gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={affected.includes(String(item.id))}
                          onChange={(event) =>
                            setAffected((current) =>
                              event.target.checked
                                ? [...current, String(item.id)]
                                : current.filter((id) => id !== item.id)
                            )
                          }
                        />
                        {String(item.title)}
                      </label>
                    ))}
                  </fieldset>
                )}
              </>
            )}
            <footer className="mt-5 flex justify-end gap-2">
              <button type="button" className={button} onClick={() => setDialog(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className={primary}
                disabled={
                  busy ||
                  (dialog.action === 'close'
                    ? !confirmation
                    : !reason.trim() ||
                      (dialog.action === 'approval' &&
                        dialog.decision === 'corrections' &&
                        !affected.length))
                }
                onClick={() =>
                  void act(dialog.action, {
                    decision: dialog.decision,
                    itemId: dialog.itemId,
                    reason,
                    itemIds: affected,
                    applies: confirmation,
                  })
                }
              >
                {busy ? 'Registrando…' : 'Confirmar'}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
