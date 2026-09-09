'use client';

import { useEffect, useState, type ElementType } from 'react';
import { useParams } from 'next/navigation';
import { CheckCircle2, Clock3, FileCheck2, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';
import { formatUtcTimestamp } from '@/lib/datetime';

type Result = {
  packageId: string;
  evidenceVersion: string;
  document: { folio: string | null; sha256: string };
  closedAt: string;
  signatureCount: number;
  status: 'valid' | 'valid_with_pending_certifications' | 'invalid' | 'incomplete';
  integrity: Record<string, string>;
  certifications: Record<string, string>;
  verifiedAt: string;
  errors: string[];
};

const labels: Record<string, string> = {
  document: 'Documento PDF',
  xml: 'XML',
  schema: 'Esquema XSD',
  evidenceChain: 'Cadena de evidencia',
  docuboxSignature: 'Firma criptográfica Docubox',
  pades: 'Firma PAdES-B-T del PDF',
  efirma: 'Evidencia de e.firma',
  rfc3161: 'Estampa RFC 3161',
  openTimestamps: 'OpenTimestamps / Bitcoin',
  nom151: 'NOM-151',
};

export default function EvidenceV2VerificationPage() {
  const { token } = useParams<{ token: string }>();
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/public/v2/verifications/${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok)
          throw new Error(payload.error || 'No fue posible verificar la evidencia.');
        return payload;
      })
      .then(setResult)
      .catch((requestError) =>
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'No fue posible verificar la evidencia.'
        )
      );
  }, [token]);

  const valid = result && result.status !== 'invalid' && result.status !== 'incomplete';
  return (
    <div className="min-h-screen bg-[#f6f8fb] text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <AppLogo />
          <span className="text-xs font-semibold text-slate-500">Evidence Package v2</span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        {!result && !error && (
          <div className="flex min-h-[420px] items-center justify-center gap-3 text-sm text-slate-600">
            <Loader2 size={22} className="animate-spin text-blue-600" /> Verificando PDF, XML,
            cadena y firma Docubox
          </div>
        )}
        {error && (
          <div className="flex min-h-[420px] flex-col items-center justify-center text-center">
            <ShieldAlert size={36} className="text-red-500" />
            <h1 className="mt-4 text-2xl font-semibold">Evidencia no disponible</h1>
            <p className="mt-2 text-sm text-slate-600">{error}</p>
          </div>
        )}
        {result && (
          <>
            <section className="border-b border-slate-200 pb-7">
              <span
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${valid ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}
              >
                {valid ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}
                {result.status === 'valid'
                  ? 'Verificación completa'
                  : result.status === 'valid_with_pending_certifications'
                    ? 'Íntegro con certificaciones pendientes'
                    : 'Verificación no superada'}
              </span>
              <h1 className="mt-4 text-3xl font-semibold">Paquete de evidencia verificable</h1>
              <p className="mt-2 text-sm text-slate-600">
                Folio {result.document.folio || 'sin folio'} · {result.signatureCount} firma
                {result.signatureCount === 1 ? '' : 's'} · Cerrado{' '}
                {formatUtcTimestamp(result.closedAt)}
              </p>
            </section>
            <section className="mt-6 grid gap-4 md:grid-cols-2">
              <StatusPanel
                title="Integridad criptográfica"
                icon={ShieldCheck}
                values={result.integrity}
              />
              <StatusPanel
                title="Certificaciones externas"
                icon={Clock3}
                values={result.certifications}
              />
            </section>
            <section className="mt-5 border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-2">
                <FileCheck2 size={17} className="text-blue-600" />
                <h2 className="text-sm font-semibold">Identificadores verificables</h2>
              </div>
              <p className="mt-4 break-all font-mono text-xs leading-5 text-slate-600">
                SHA-256 PDF: {result.document.sha256}
              </p>
              <p className="mt-2 break-all font-mono text-xs leading-5 text-slate-600">
                Package ID: {result.packageId}
              </p>
              <p className="mt-4 text-xs text-slate-500">
                Verificado {formatUtcTimestamp(result.verifiedAt)}
              </p>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function StatusPanel({
  title,
  icon: Icon,
  values,
}: {
  title: string;
  icon: ElementType;
  values: Record<string, string>;
}) {
  return (
    <section className="border border-slate-200 bg-white">
      <header className="flex items-center gap-2 border-b border-slate-200 px-5 py-4">
        <Icon size={17} className="text-blue-600" />
        <h2 className="text-sm font-semibold">{title}</h2>
      </header>
      <div className="divide-y divide-slate-100">
        {Object.entries(values).map(([key, value]) => {
          const positive = value === 'valid';
          const pending = ['pending', 'not_applicable', 'unavailable', 'not_checked'].includes(
            value
          );
          return (
            <div key={key} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
              <span className="text-slate-600">{labels[key] || key}</span>
              <span
                className={`text-xs font-semibold ${positive ? 'text-emerald-700' : pending ? 'text-amber-700' : 'text-red-600'}`}
              >
                {positive ? 'Válido' : pending ? 'Pendiente / no aplica' : 'Inválido'}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
