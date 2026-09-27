'use client';

import { ArrowLeft, ChevronDown, History, Shield } from 'lucide-react';
import { formatLocalTimestampWithOffset } from '@/lib/datetime';

export interface ParticipantNotificationEvent {
  id: string;
  type: 'initial' | 'reminder';
  at: string | null;
  status: string;
}

export interface ParticipantDetails {
  participantName: string;
  method: string;
  action: string;
  status: string;
  signedAt: string | null;
  scope: 'full' | 'summary';
  notifications?: {
    initial: ParticipantNotificationEvent | null;
    lastReminder: ParticipantNotificationEvent | null;
    reminderCount: number | null;
    history: ParticipantNotificationEvent[];
  };
  evidence?: {
    id: string;
    signatureId: string | null;
    type: string;
    signedAt: string | null;
    otpVerified: boolean | null;
    ipAddress: string | null;
    userAgent: string | null;
    deviceType: string | null;
    timezone: string | null;
    consentAccepted: boolean | null;
    consentVersion: string | null;
    documentName: string | null;
    documentHash: string | null;
    signatureHash: string | null;
    certificateSubject: string | null;
    certificateRfc: string | null;
    certificateSerial: string | null;
    certificateNotBefore: string | null;
    certificateNotAfter: string | null;
    certificateStatus: string | null;
    certificateCheckedAt: string | null;
    algorithm: string | null;
    validationProvider: string | null;
    providerReference: string | null;
  } | null;
}

export function participantDetailDate(value?: string | null) {
  if (!value) return 'No registrada';
  return formatLocalTimestampWithOffset(value, { dateStyle: 'medium', timeStyle: 'short' });
}

function EvidenceLine({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-[104px_minmax(0,1fr)] gap-3 py-1.5 text-xs">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words text-slate-800">{value}</dd>
    </div>
  );
}

function evidenceKind(method: string, type?: string) {
  const value = `${method} ${type || ''}`.toLowerCase();
  if (value.includes('efirma') || value.includes('e.firma')) return 'efirma';
  if (value.includes('click')) return 'clicksign';
  return 'autografa';
}

export function ParticipantEvidenceDrawer({
  data,
  loading,
  error,
  fallbackName,
  onClose,
  onActivity,
}: {
  data?: ParticipantDetails;
  loading: boolean;
  error?: string;
  fallbackName: string;
  onClose: () => void;
  onActivity: () => void;
}) {
  const evidence = data?.evidence;
  const kind = evidenceKind(data?.method || '', evidence?.type);
  const hasCertificate = Boolean(
    evidence?.certificateSubject || evidence?.certificateRfc || evidence?.certificateStatus
  );
  const otpLabel =
    evidence?.otpVerified === true
      ? 'Verificado'
      : evidence?.otpVerified === false
        ? 'No verificado'
        : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
        <button
          type="button"
          onClick={onClose}
          aria-label="Volver a participantes"
          title="Volver a participantes"
          className="flex h-8 w-8 flex-none items-center justify-center rounded-md text-slate-600 hover:bg-slate-100"
        >
          <ArrowLeft size={17} />
        </button>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">
            {data?.scope === 'summary' ? 'Resumen de firma' : 'Evidencia de firma'}
          </h3>
          <p className="truncate text-xs text-slate-500">{data?.participantName || fallbackName}</p>
        </div>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {loading && <p className="text-xs text-slate-500">Cargando evidencia...</p>}
        {error && (
          <p role="alert" className="text-xs text-red-700">
            {error}
          </p>
        )}
        {data && (
          <>
            <section>
              <h4 className="mb-2 text-[11px] font-semibold uppercase text-slate-500">
                Participación
              </h4>
              <dl className="divide-y divide-slate-100">
                <EvidenceLine label="Método" value={data.method} />
                <EvidenceLine label="Acto" value={data.action} />
                <EvidenceLine label="Estado" value={data.status} />
                <EvidenceLine label="Fecha y hora" value={participantDetailDate(data.signedAt)} />
              </dl>
            </section>

            {data.scope === 'summary' ? (
              <p className="border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500">
                Los datos de autenticación y contexto técnico de otros participantes están
                restringidos.
              </p>
            ) : (
              <>
                {evidence ? (
                  <>
                    <section className="border-t border-slate-100 pt-4">
                      <h4 className="mb-2 text-[11px] font-semibold uppercase text-slate-500">
                        Evento de firma
                      </h4>
                      <dl className="divide-y divide-slate-100">
                        <EvidenceLine
                          label="Fecha y hora"
                          value={participantDetailDate(evidence.signedAt || data.signedAt)}
                        />
                        <EvidenceLine label="Zona horaria" value={evidence.timezone} />
                        {kind === 'clicksign' && (
                          <EvidenceLine
                            label="Aceptación expresa"
                            value={
                              evidence.consentAccepted === true
                                ? 'Registrada'
                                : evidence.consentAccepted === false
                                  ? 'No registrada'
                                  : null
                            }
                          />
                        )}
                        {otpLabel && <EvidenceLine label="OTP" value={otpLabel} />}
                        {evidence.consentAccepted != null && kind !== 'clicksign' && (
                          <EvidenceLine
                            label="Consentimiento"
                            value={evidence.consentAccepted ? 'Aceptado' : 'No registrado'}
                          />
                        )}
                        <EvidenceLine label="Versión del texto" value={evidence.consentVersion} />
                      </dl>
                    </section>

                    {kind === 'efirma' && hasCertificate && (
                      <section className="border-t border-slate-100 pt-4">
                        <h4 className="mb-2 text-[11px] font-semibold uppercase text-slate-500">
                          Certificado SAT
                        </h4>
                        <dl className="divide-y divide-slate-100">
                          <EvidenceLine label="Titular" value={evidence.certificateSubject} />
                          <EvidenceLine label="RFC" value={evidence.certificateRfc} />
                          <EvidenceLine
                            label="Estado registrado"
                            value={evidence.certificateStatus}
                          />
                          {evidence.certificateCheckedAt && (
                            <EvidenceLine
                              label="Comprobado"
                              value={participantDetailDate(evidence.certificateCheckedAt)}
                            />
                          )}
                        </dl>
                      </section>
                    )}

                    <section className="border-t border-slate-100 pt-4">
                      <div className="flex items-center gap-2 text-slate-600">
                        <Shield size={15} />
                        <h4 className="text-[11px] font-semibold uppercase">Integridad asociada</h4>
                      </div>
                      <dl className="mt-2 divide-y divide-slate-100">
                        <EvidenceLine label="Documento" value={evidence.documentName} />
                        {evidence.documentHash && (
                          <EvidenceLine
                            label="Huella vinculada"
                            value={`SHA-256 · ${evidence.documentHash.slice(0, 16)}...`}
                          />
                        )}
                      </dl>
                    </section>

                    <details className="group border-t border-slate-100 pt-4">
                      <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-medium text-blue-700">
                        {kind === 'efirma'
                          ? 'Ver detalles criptográficos'
                          : 'Ver detalles técnicos'}
                        <ChevronDown
                          size={15}
                          className="transition-transform group-open:rotate-180"
                        />
                      </summary>
                      <dl className="mt-3 divide-y divide-slate-100">
                        <EvidenceLine label="ID del evento" value={evidence.id} />
                        <EvidenceLine label="ID de firma" value={evidence.signatureId} />
                        <EvidenceLine label="Dirección IP" value={evidence.ipAddress} />
                        <EvidenceLine label="Dispositivo" value={evidence.deviceType} />
                        <EvidenceLine label="Navegador" value={evidence.userAgent} />
                        {kind === 'efirma' && (
                          <EvidenceLine label="Serie" value={evidence.certificateSerial} />
                        )}
                        {kind === 'efirma' && (
                          <EvidenceLine label="Algoritmo" value={evidence.algorithm} />
                        )}
                        {kind === 'efirma' && (
                          <EvidenceLine label="Proveedor" value={evidence.validationProvider} />
                        )}
                        {kind === 'efirma' && (
                          <EvidenceLine label="Referencia" value={evidence.providerReference} />
                        )}
                        <EvidenceLine label="SHA-256 documento" value={evidence.documentHash} />
                        <EvidenceLine label="SHA-256 firma" value={evidence.signatureHash} />
                      </dl>
                    </details>
                  </>
                ) : (
                  <p className="border-t border-slate-100 pt-4 text-xs text-slate-500">
                    No hay evidencia técnica individual vinculada a esta participación.
                  </p>
                )}
                <button
                  type="button"
                  onClick={onActivity}
                  className="inline-flex items-center gap-2 text-xs font-medium text-blue-700 hover:underline"
                >
                  <History size={14} /> Ver actividad del documento
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
