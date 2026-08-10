'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Download,
  Eye,
  FileCheck2,
  Fingerprint,
  LockKeyhole,
  ShieldAlert,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
import type {
  PublicCertificationDetails,
  PublicVerificationResult,
  VerificationCheck,
  VerificationStatus,
} from '@/lib/public-verification/types';
import { STATUS_LABELS } from '@/lib/public-verification/types';

type Tone = ReturnType<typeof statusTone>;

export default function VerificationResultView({ result }: { result: PublicVerificationResult }) {
  const tone = statusTone(result.overallStatus);
  const documentHash = preferredHash(result, 'SIGNED_DOCUMENT') || preferredHash(result);
  const evidenceHash = result.certification?.evidenceChain.hash || null;

  return (
    <section className="mt-8 space-y-6">
      <StatusHeader result={result} tone={tone} />

      {result.document && (
        <>
          <SummaryStrip result={result} />
          <DocumentDetails result={result} documentHash={documentHash} />
          <ParticipantsTable result={result} />
          <CertificationScope result={result} />
          <IntegrityControls result={result} />
          <TimestampCard certification={result.certification || null} />
          <FingerprintsCard documentHash={documentHash} evidenceHash={evidenceHash} />
          <TechnicalAnnex certification={result.certification || null} />
          <DocumentAccess result={result} />
          <LegalBasis result={result} />
        </>
      )}

      {!result.document && <TechnicalOnlyResult result={result} />}

      {result.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-4">
          {result.warnings.map((warning) => (
            <p key={warning} className="flex items-start gap-2 text-sm leading-6 text-amber-800">
              <AlertTriangle size={16} className="mt-1 shrink-0" />
              {warning}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

function StatusHeader({ result, tone }: { result: PublicVerificationResult; tone: Tone }) {
  return (
    <div className={`rounded-lg border bg-white ${tone.border}`}>
      <div className="flex flex-col gap-5 px-5 py-6 sm:flex-row sm:items-start sm:justify-between sm:px-7">
        <div className="flex min-w-0 items-start gap-4">
          <span
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-md ${tone.icon}`}
          >
            <tone.Icon size={22} />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-700 uppercase text-[#71717a]">Verificación integral</p>
            <h2 className="mt-1 text-xl font-650 text-[#18181b] sm:text-2xl">{result.headline}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#52525b]">{result.message}</p>
          </div>
        </div>
        <span
          className={`inline-flex h-8 shrink-0 items-center rounded-full px-3 text-xs font-700 ${tone.badge}`}
        >
          {STATUS_LABELS[result.overallStatus]}
        </span>
      </div>
    </div>
  );
}

function SummaryStrip({ result }: { result: PublicVerificationResult }) {
  if (!result.document) return null;
  return (
    <dl className="grid overflow-hidden rounded-lg border border-[#dbe3ef] bg-[#f7f9ff] sm:grid-cols-3">
      <SummaryCell label="Folio" value={result.document.folio} mono />
      <SummaryCell label="Completado (UTC)" value={formatUtc(result.document.completedAt)} />
      <SummaryCell label="Participantes" value={String(result.document.participantCount)} />
    </dl>
  );
}

function DocumentDetails({
  result,
  documentHash,
}: {
  result: PublicVerificationResult;
  documentHash: string | null;
}) {
  const document = result.document!;
  const rows = [
    ['Identificador', document.id],
    ['Título', document.name],
    ['Espacio de trabajo', document.workspace],
    ['Páginas', document.pageCount ? String(document.pageCount) : 'No disponible'],
    ['SHA-256', documentHash || 'No registrado'],
    ['Creado', formatUtc(document.createdAt)],
  ];
  return (
    <section className="overflow-hidden rounded-lg border border-[#ebebf0] bg-white">
      <SectionHeader title="Datos del documento" icon={FileCheck2} />
      <dl>
        {rows.map(([label, value], index) => (
          <div
            key={label}
            className={`grid gap-1 px-5 py-3 text-sm sm:grid-cols-[190px_minmax(0,1fr)] ${index ? 'border-t border-[#ebebf0]' : ''}`}
          >
            <dt className="text-xs font-700 uppercase text-[#71809a]">{label}</dt>
            <dd
              className={`${label === 'SHA-256' || label === 'Identificador' ? 'break-all font-mono text-xs' : ''} text-[#18181b]`}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ParticipantsTable({ result }: { result: PublicVerificationResult }) {
  const participants = result.document?.participants || [];
  return (
    <section className="overflow-hidden rounded-lg border border-[#ebebf0] bg-white">
      <SectionHeader title="Participantes y estado de firma" icon={UsersRound} />
      {participants.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-[#14213d] text-[10px] font-700 uppercase text-white">
              <tr>
                <th className="px-5 py-3">Nombre</th>
                <th className="px-4 py-3">Correo</th>
                <th className="px-4 py-3">Rol</th>
                <th className="px-4 py-3">Método</th>
                <th className="px-4 py-3">Firmado (UTC)</th>
                <th className="px-5 py-3 text-right">Estado</th>
              </tr>
            </thead>
            <tbody>
              {participants.map((participant, index) => (
                <tr
                  key={`${participant.name}-${index}`}
                  className="border-t border-[#ebebf0] first:border-t-0"
                >
                  <td className="px-5 py-4 font-650 text-[#18181b]">{participant.name}</td>
                  <td className="px-4 py-4 text-[#52525b]">
                    {participant.email || 'No disponible'}
                  </td>
                  <td className="px-4 py-4 text-[#52525b]">{participant.role}</td>
                  <td className="px-4 py-4 text-[#52525b]">
                    {participant.signatureMethod || 'Firma electrónica'}
                  </td>
                  <td className="px-4 py-4 text-[#52525b]">{formatUtc(participant.signedAt)}</td>
                  <td className="px-5 py-4 text-right">
                    <span
                      className={`inline-flex items-center gap-1.5 ${participantTone(participant.status).text}`}
                    >
                      {(() => {
                        const ParticipantIcon = participantTone(participant.status).Icon;
                        return <ParticipantIcon size={15} />;
                      })()}
                      {participantStatus(participant.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState text="No hay participantes públicos asociados a este registro." />
      )}
    </section>
  );
}

function CertificationScope({ result }: { result: PublicVerificationResult }) {
  const certification = result.certification;
  const documentStatus = strongestStatus(checksFor(result.checks, 'DOCUMENT_INTEGRITY'));
  const evidenceStatus = strongestStatus(checksFor(result.checks, 'EVIDENCE_CHAIN'));
  const timestampStatus = strongestStatus(checksFor(result.checks, 'RFC3161'));
  return (
    <section className="overflow-hidden rounded-lg border border-[#ebebf0] bg-white">
      <SectionHeader title="Alcance de la certificación" icon={ShieldCheck} />
      <div className="grid md:grid-cols-2">
        <ScopeItem
          title="Integridad del documento"
          description="Detecta cambios posteriores en el PDF registrado."
          status={documentStatus}
        />
        <ScopeItem
          title="Sello digital Docubox"
          description="Vincula la cadena original con la certificación."
          status={certification?.documentSeal.valid ? 'VERIFIED' : 'NOT_PRESENT'}
        />
        <ScopeItem
          title="Cadena de evidencia"
          description="Protege archivos, eventos y constancias."
          status={evidenceStatus}
        />
        <ScopeItem
          title="Estampa de tiempo"
          description="Fija una referencia temporal verificable."
          status={certification?.timestamp?.valid ? 'VERIFIED' : timestampStatus}
        />
      </div>
    </section>
  );
}

function IntegrityControls({ result }: { result: PublicVerificationResult }) {
  const certification = result.certification;
  const controls: Array<[string, VerificationStatus, string]> = [
    [
      'Hash SHA-256 del PDF',
      strongestStatus(checksFor(result.checks, 'DOCUMENT_INTEGRITY')),
      'Huella documental',
    ],
    [
      'Sello digital Docubox',
      certification?.documentSeal.valid ? 'VERIFIED' : 'NOT_PRESENT',
      certification?.documentSeal.valid ? 'Válido' : 'No presente',
    ],
    [
      'Cadena de evidencia',
      certification?.evidenceChain.valid ? 'VERIFIED' : 'NOT_PRESENT',
      certification?.evidenceChain.valid ? 'Íntegra' : 'No consolidada',
    ],
    [
      'Estampa RFC 3161',
      certification?.timestamp?.valid ? 'VERIFIED' : 'NOT_PRESENT',
      certification?.timestamp?.valid ? 'Válida' : 'No registrada',
    ],
    [
      'Constancia NOM-151',
      strongestStatus(checksFor(result.checks, 'NOM151')),
      checkSummary(checksFor(result.checks, 'NOM151')),
    ],
    [
      'Bitácora encadenada',
      certification?.audit.valid ? 'VERIFIED' : 'NOT_PRESENT',
      certification?.audit.valid ? 'Sin alteraciones' : 'No consolidada',
    ],
  ];
  return (
    <section className="overflow-hidden rounded-lg border border-[#ebebf0] bg-white">
      <SectionHeader title="Controles de integridad aplicados" icon={Fingerprint} />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3">
        {controls.map(([label, status, detail]) => (
          <ControlItem key={label} label={label} status={status} detail={detail} />
        ))}
      </div>
    </section>
  );
}

function TimestampCard({ certification }: { certification: PublicCertificationDetails | null }) {
  const timestamp = certification?.timestamp || null;
  const tone = statusTone(timestamp?.valid ? 'VERIFIED' : 'NOT_PRESENT');
  return (
    <section
      className={`overflow-hidden rounded-lg border bg-white ${timestamp ? 'border-indigo-200' : 'border-[#ebebf0]'}`}
    >
      <div className={`${timestamp ? 'bg-indigo-50/70' : 'bg-[#fafafa]'} px-5 py-5 sm:px-7`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-lg font-650 text-[#312e81]">Estampa de tiempo</h3>
          <span
            className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-2 text-xs font-700 ${tone.badge}`}
          >
            <tone.Icon size={16} />
            {timestamp?.valid ? 'Válida' : 'No registrada'}
          </span>
        </div>
        {timestamp ? (
          <dl className="mt-5 grid gap-x-10 gap-y-4 sm:grid-cols-2">
            <KeyValue label="Fecha y hora UTC" value={formatUtc(timestamp.generatedAt)} />
            <KeyValue label="Estándar" value={timestamp.standard || 'RFC 3161'} />
            <KeyValue label="Autoridad TSA" value={timestamp.tsaName || 'No disponible'} />
            <KeyValue label="Algoritmo" value={timestamp.algorithm || 'SHA-256'} />
            <KeyValue label="Política TSA" value={timestamp.policyOid || 'No disponible'} />
            <KeyValue label="Token SHA-256" value={timestamp.tokenHash || 'No disponible'} mono />
          </dl>
        ) : (
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[#52525b]">
            Este registro no contiene un token RFC 3161 verificable. La fecha de firma registrada no
            se presenta como una estampa criptográfica.
          </p>
        )}
      </div>
    </section>
  );
}

function FingerprintsCard({
  documentHash,
  evidenceHash,
}: {
  documentHash: string | null;
  evidenceHash: string | null;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-[#ebebf0] bg-white">
      <SectionHeader title="Huellas criptográficas principales" icon={Fingerprint} />
      <dl className="px-5 py-2 sm:px-7">
        <HashRow label="Documento" value={documentHash} />
        <HashRow label="Evidencia" value={evidenceHash} bordered />
      </dl>
    </section>
  );
}

function TechnicalAnnex({ certification }: { certification: PublicCertificationDetails | null }) {
  const blocks = [
    {
      number: 1,
      title: 'Cadena original Docubox',
      description: 'Texto canónico que representa el documento certificado.',
      content: certification?.documentChain.displayText,
      valid: certification?.documentChain.valid,
      accent: 'indigo',
    },
    {
      number: 2,
      title: 'Sello digital Docubox',
      description: 'Resultado criptográfico aplicado a la cadena original.',
      content: certification
        ? technicalSealText(
            certification.documentSeal.hash,
            certification.documentSeal.algorithm,
            certification.documentSeal.keyVersion,
            certification.documentSeal.signaturePreview
          )
        : null,
      valid: certification?.documentSeal.valid,
      accent: 'emerald',
    },
    {
      number: 3,
      title: 'Cadena de evidencia',
      description: 'Manifiesto canónico del paquete de evidencia y de la bitácora.',
      content: certification?.evidenceChain.displayText,
      valid: certification?.evidenceChain.valid,
      accent: 'indigo',
    },
    {
      number: 4,
      title: 'Sello de la cadena de evidencia',
      description: 'Permite detectar sustituciones, eliminaciones o alteraciones.',
      content: certification
        ? technicalSealText(
            certification.evidenceSeal.hash,
            certification.evidenceSeal.algorithm,
            certification.evidenceSeal.keyVersion,
            certification.evidenceSeal.signaturePreview
          )
        : null,
      valid: certification?.evidenceSeal.valid,
      accent: 'emerald',
    },
  ] as const;

  return (
    <section>
      <div className="mb-4">
        <h3 className="text-xl font-650 text-[#18181b]">Anexo técnico de validación</h3>
        <p className="mt-1 text-sm leading-6 text-[#52525b]">
          Representación pública abreviada. Los valores completos permanecen en el expediente
          técnico.
        </p>
      </div>
      <div className="space-y-4">
        {blocks.map((block) => (
          <TechnicalBlock key={block.number} {...block} />
        ))}
      </div>
    </section>
  );
}

function DocumentAccess({ result }: { result: PublicVerificationResult }) {
  const [expanded, setExpanded] = useState(false);
  const document = result.document;
  if (!document) return null;

  if (!document.isPublic || !document.documentUrl) {
    return (
      <section className="rounded-lg border border-[#ebebf0] bg-white px-5 py-6 sm:px-7">
        <div className="flex items-start gap-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[#f4f4f5] text-[#71717a]">
            <LockKeyhole size={20} />
          </span>
          <div>
            <h3 className="font-650 text-[#18181b]">Documento privado</h3>
            <p className="mt-1 text-sm leading-6 text-[#52525b]">
              La integridad puede consultarse con el folio, pero el archivo final no está disponible
              para ver ni descargar.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-lg border border-[#ebebf0] bg-white">
      <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <div className="flex items-start gap-3">
          <Eye size={20} className="mt-0.5 text-[#4f46e5]" />
          <div>
            <h3 className="font-650 text-[#18181b]">Documento final público</h3>
            <p className="mt-1 text-sm text-[#52525b]">
              El propietario autorizó su consulta temporal.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#dbe3ef] px-4 text-sm font-650 text-[#18181b] hover:bg-[#f8f8fb]"
          >
            <Eye size={16} />
            {expanded ? 'Ocultar' : 'Ver documento'}
          </button>
          <a
            href={document.documentUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#4f46e5] px-4 text-sm font-650 text-white hover:bg-[#4338ca]"
          >
            <Download size={16} />
            Descargar
          </a>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-[#ebebf0] bg-[#f4f6fa] p-3 sm:p-5">
          <iframe
            src={document.documentUrl}
            title={`Documento ${document.folio}`}
            className="h-[72vh] min-h-[520px] w-full bg-white"
          />
        </div>
      )}
    </section>
  );
}

function LegalBasis({ result }: { result: PublicVerificationResult }) {
  return (
    <section className="rounded-lg border border-[#dbe3ef] bg-[#f7f9ff] px-5 py-5 sm:px-7">
      <h3 className="text-xs font-700 uppercase text-[#14213d]">Fundamento y alcance</h3>
      <p className="mt-2 text-xs leading-5 text-[#52525b]">
        Esta consulta acredita el estado técnico observado por Docubox al{' '}
        {formatDate(result.checkedAt)}. La validez jurídica depende del método de firma, las
        evidencias disponibles y la legislación aplicable. La consulta pública no sustituye una
        resolución de autoridad.
      </p>
      <p className="mt-2 text-xs leading-5 text-[#52525b]">
        Los correos se muestran enmascarados. CURP, RFC, IP, geolocalización, biometría y rutas
        privadas permanecen protegidos.
      </p>
    </section>
  );
}

function TechnicalOnlyResult({ result }: { result: PublicVerificationResult }) {
  const checks = result.checks;
  return (
    <section className="overflow-hidden rounded-lg border border-[#ebebf0] bg-white">
      <SectionHeader title="Comprobaciones técnicas" icon={ShieldCheck} />
      <div className="divide-y divide-[#ebebf0]">
        {checks.map((check) => (
          <CheckRow key={`${check.engine}-${check.checkType}`} check={check} />
        ))}
      </div>
    </section>
  );
}

function ScopeItem({
  title,
  description,
  status,
}: {
  title: string;
  description: string;
  status: VerificationStatus;
}) {
  const tone = statusTone(status);
  return (
    <div className="flex min-h-[92px] items-start gap-3 border-t border-[#ebebf0] px-5 py-4 odd:md:border-r">
      <tone.Icon size={19} className={`mt-0.5 shrink-0 ${tone.text}`} />
      <div>
        <p className="text-sm font-650 text-[#18181b]">{title}</p>
        <p className="mt-1 text-xs leading-5 text-[#64748b]">{description}</p>
        <p className={`mt-1 text-[11px] font-650 ${tone.text}`}>{STATUS_LABELS[status]}</p>
      </div>
    </div>
  );
}

function ControlItem({
  label,
  status,
  detail,
}: {
  label: string;
  status: VerificationStatus;
  detail: string;
}) {
  const tone = statusTone(status);
  return (
    <div className="flex min-h-[82px] items-start gap-3 border-t border-[#ebebf0] px-5 py-4">
      <tone.Icon size={18} className={`mt-0.5 shrink-0 ${tone.text}`} />
      <div>
        <p className="text-sm font-650 text-[#18181b]">{label}</p>
        <p className={`mt-1 text-xs ${tone.text}`}>{detail}</p>
      </div>
    </div>
  );
}

function TechnicalBlock({
  number,
  title,
  description,
  content,
  valid,
  accent,
}: {
  number: number;
  title: string;
  description: string;
  content?: string | null;
  valid?: boolean;
  accent: 'indigo' | 'emerald';
}) {
  return (
    <article className="relative overflow-hidden rounded-lg border border-[#dbe3ef] bg-white px-5 py-5 sm:px-7">
      <span
        className={`absolute inset-y-0 left-0 w-1 ${accent === 'emerald' ? 'bg-emerald-600' : 'bg-[#4f46e5]'}`}
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h4 className="text-sm font-700 uppercase text-[#18181b]">
            {number}. {title}
          </h4>
          <p className="mt-1 text-xs leading-5 text-[#64748b]">{description}</p>
        </div>
        <span
          className={`w-fit rounded-full px-2.5 py-1 text-[10px] font-700 ${valid ? 'bg-emerald-50 text-emerald-700' : 'bg-[#f4f4f5] text-[#71717a]'}`}
        >
          {valid ? 'Verificado' : 'No disponible'}
        </span>
      </div>
      <pre className="mt-4 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border border-[#dbe3ef] bg-[#f5f7fb] p-4 font-mono text-[11px] leading-5 text-[#334155]">
        {content ? abbreviateTechnical(content) : 'No generado para este documento.'}
      </pre>
    </article>
  );
}

function CheckRow({ check }: { check: VerificationCheck }) {
  const tone = statusTone(check.status);
  return (
    <div className="flex items-start gap-3 px-5 py-4 sm:px-7">
      <tone.Icon size={18} className={`mt-0.5 shrink-0 ${tone.text}`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-650 text-[#18181b]">{checkTypeLabel(check.checkType)}</p>
          <span className={`w-fit rounded-full px-2 py-1 text-[10px] font-700 ${tone.badge}`}>
            {STATUS_LABELS[check.status]}
          </span>
        </div>
        <p className="mt-1 text-sm leading-6 text-[#52525b]">{check.message}</p>
      </div>
    </div>
  );
}

function SectionHeader({ title, icon: Icon }: { title: string; icon: React.ElementType }) {
  return (
    <div className="flex items-center gap-2 border-b border-[#ebebf0] px-5 py-4 sm:px-7">
      <Icon size={17} className="text-[#4f46e5]" />
      <h3 className="text-base font-650 text-[#18181b]">{title}</h3>
    </div>
  );
}

function SummaryCell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="border-b border-[#dbe3ef] px-5 py-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <dt className="text-[10px] font-700 uppercase text-[#71809a]">{label}</dt>
      <dd
        className={`mt-1 break-words text-sm text-[#14213d] ${mono ? 'font-mono text-xs' : 'font-650'}`}
      >
        {value}
      </dd>
    </div>
  );
}

function KeyValue({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[150px_minmax(0,1fr)]">
      <dt className="text-xs font-700 uppercase text-[#64748b]">{label}</dt>
      <dd className={`${mono ? 'break-all font-mono text-[11px]' : 'text-sm'} text-[#18181b]`}>
        {value}
      </dd>
    </div>
  );
}

function HashRow({
  label,
  value,
  bordered,
}: {
  label: string;
  value: string | null;
  bordered?: boolean;
}) {
  return (
    <div
      className={`grid gap-2 py-4 sm:grid-cols-[130px_minmax(0,1fr)] ${bordered ? 'border-t border-[#ebebf0]' : ''}`}
    >
      <dt className="text-xs font-700 uppercase text-[#64748b]">{label}</dt>
      <dd className="break-all font-mono text-xs leading-5 text-[#18181b]">
        {value || 'No disponible'}
      </dd>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center px-5 text-center">
      <ShieldAlert size={22} className="text-[#a1a1aa]" />
      <p className="mt-3 max-w-xl text-sm leading-6 text-[#71717a]">{text}</p>
    </div>
  );
}

function checksFor(checks: VerificationCheck[], engine: VerificationCheck['engine']) {
  return checks.filter((check) => check.engine === engine);
}

function strongestStatus(checks: VerificationCheck[]): VerificationStatus {
  const priority: VerificationStatus[] = [
    'TAMPERED',
    'HASH_MISMATCH',
    'INVALID_SIGNATURE',
    'INVALID',
    'UNTRUSTED_CERTIFICATE',
    'UNTRUSTED_PROVIDER',
    'SERVICE_UNAVAILABLE',
    'INDETERMINATE',
    'NOT_VERIFIED',
    'REGISTERED',
    'VERIFIED_WITH_WARNINGS',
    'VERIFIED_OFFLINE',
    'VERIFIED',
    'NOT_PRESENT',
    'NOT_APPLICABLE',
  ];
  return (
    priority.find((status) => checks.some((check) => check.status === status)) || 'NOT_PRESENT'
  );
}

function statusTone(status: VerificationStatus) {
  if (['VERIFIED', 'VERIFIED_OFFLINE'].includes(status))
    return {
      Icon: CheckCircle2,
      border: 'border-emerald-200',
      icon: 'bg-emerald-100 text-emerald-700',
      badge: 'bg-emerald-100 text-emerald-800',
      text: 'text-emerald-600',
    };
  if (
    ['VERIFIED_WITH_WARNINGS', 'REGISTERED', 'NOT_VERIFIED', 'REVOCATION_UNKNOWN'].includes(status)
  )
    return {
      Icon: AlertTriangle,
      border: 'border-amber-200',
      icon: 'bg-amber-100 text-amber-700',
      badge: 'bg-amber-100 text-amber-800',
      text: 'text-amber-600',
    };
  if (['INVALID', 'TAMPERED', 'HASH_MISMATCH', 'INVALID_SIGNATURE'].includes(status))
    return {
      Icon: ShieldAlert,
      border: 'border-red-200',
      icon: 'bg-red-100 text-red-700',
      badge: 'bg-red-100 text-red-800',
      text: 'text-red-600',
    };
  return {
    Icon: Clock3,
    border: 'border-[#ebebf0]',
    icon: 'bg-[#f4f4f5] text-[#71717a]',
    badge: 'bg-[#f4f4f5] text-[#52525b]',
    text: 'text-[#71717a]',
  };
}

function preferredHash(result: PublicVerificationResult, preferredType?: string) {
  return (
    result.artifactMatches.find((artifact) => artifact.type === preferredType)?.hash ||
    result.artifactMatches[0]?.hash ||
    null
  );
}

function technicalSealText(
  hash?: string | null,
  algorithm?: string | null,
  keyVersion?: string | null,
  signature?: string | null
) {
  return [
    `HASH=${hash || 'NO_DISPONIBLE'}`,
    `ALGORITHM=${algorithm || 'NO_DISPONIBLE'}`,
    `KEY_ID=${keyVersion || 'NO_DISPONIBLE'}`,
    '',
    signature || 'FIRMA_NO_DISPONIBLE',
  ].join('\n');
}

function abbreviateTechnical(value: string) {
  const normalized = value.trim();
  if (normalized.length <= 900) return normalized;
  return `${normalized.slice(0, 720)}\n... CONTENIDO ABREVIADO EN ESTA VISTA ...\n${normalized.slice(-120)}`;
}

function participantStatus(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.includes('firm')) return 'Firmado';
  if (normalized.includes('complet')) return 'Completado';
  return checkTypeLabel(value);
}

function participantTone(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.includes('rechaz') || normalized.includes('cancel')) {
    return { Icon: ShieldAlert, text: 'text-red-700' };
  }
  if (normalized.includes('firm') || normalized.includes('complet')) {
    return { Icon: CheckCircle2, text: 'text-emerald-700' };
  }
  return { Icon: Clock3, text: 'text-amber-700' };
}

function checkSummary(checks: VerificationCheck[]) {
  const check = checks[0];
  if (!check) return 'No registrada';
  return STATUS_LABELS[check.status];
}

function checkTypeLabel(value: string) {
  return value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatUtc(value?: string | null) {
  if (!value) return 'No disponible';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No disponible';
  return (
    new Intl.DateTimeFormat('es-MX', {
      dateStyle: 'medium',
      timeStyle: 'medium',
      timeZone: 'UTC',
    }).format(date) + ' UTC'
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
