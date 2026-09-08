'use client';

import { use, useEffect, useState } from 'react';
import {
  Bitcoin,
  CheckCircle2,
  Clock3,
  FileCheck2,
  ShieldCheck,
  Upload,
  XCircle,
} from 'lucide-react';

type Evidence = Record<string, any> & { validations: Record<string, boolean> };

const labels: Record<string, string> = {
  document_integrity: 'Documento íntegro',
  sha256_matches: 'SHA-256 coincide',
  manifest_matches: 'Manifest coincide',
  opentimestamps_proof_valid: 'Prueba OpenTimestamps válida',
  bitcoin_attestation_found: 'Attestación Bitcoin encontrada',
  bitcoin_anchor_verified: 'Anclaje Bitcoin verificado',
};

export default function BlockchainVerificationPage({
  params,
}: {
  params: Promise<{ publicToken: string }>;
}) {
  const { publicToken } = use(params);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [error, setError] = useState('');
  const [verification, setVerification] = useState<Record<string, any> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/verify/blockchain/${publicToken}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('No se encontró la evidencia solicitada.');
        setEvidence(await response.json());
      })
      .catch((reason) => setError(reason.message));
  }, [publicToken]);

  async function verifyFile(file: File) {
    setBusy(true);
    setVerification(null);
    const body = new FormData();
    body.set('file', file);
    try {
      const response = await fetch(`/api/verify/blockchain/${publicToken}`, {
        method: 'POST',
        body,
      });
      const result = await response.json();
      setVerification(result);
    } finally {
      setBusy(false);
    }
  }

  if (error)
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
        <p className="text-sm text-red-700">{error}</p>
      </main>
    );
  if (!evidence)
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50">
        <p className="text-sm text-slate-500">Consultando evidencia...</p>
      </main>
    );
  const verified = evidence.status === 'VERIFIED';
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-4">
          <span className="text-2xl font-semibold">Docubox</span>
          <span className="h-7 w-px bg-slate-200" />
          <span className="text-sm text-slate-600">Verificación blockchain</span>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-5 py-8">
        <section className="border-y border-slate-200 bg-white px-5 py-6">
          <div className="flex items-start gap-4">
            <div
              className={`grid h-11 w-11 place-items-center rounded-lg ${verified ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}
            >
              {verified ? <ShieldCheck /> : <Clock3 />}
            </div>
            <div>
              <h1 className="text-xl font-semibold">
                {verified ? 'Anclaje Bitcoin verificado' : 'Esperando anclaje Bitcoin'}
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                Prueba portable OpenTimestamps asociada al documento final. El documento no se
                publica en blockchain.
              </p>
            </div>
          </div>
        </section>
        <div className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_.85fr]">
          <section className="border border-slate-200 bg-white p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Bitcoin className="h-4 w-4" />
              Resumen técnico
            </h2>
            <dl className="mt-5 space-y-4 text-sm">
              {[
                ['Protocolo', evidence.protocol],
                ['Blockchain', evidence.blockchain],
                ['Bloque Bitcoin', evidence.bitcoin_block_height],
                ['Hash del bloque', evidence.bitcoin_block_hash],
                ['SHA-256 del documento', evidence.document_sha256],
                ['SHA-256 del manifest', evidence.manifest_sha256],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <dt className="text-xs font-medium uppercase text-slate-500">{label}</dt>
                  <dd className="mt-1 break-all font-mono text-xs">{value || 'Pendiente'}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="border border-slate-200 bg-white p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <FileCheck2 className="h-4 w-4" />
              Validaciones
            </h2>
            <ul className="mt-4 space-y-3">
              {Object.entries(evidence.validations).map(([key, valid]) => (
                <li key={key} className="flex items-center gap-2 text-sm">
                  {valid ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Clock3 className="h-4 w-4 text-amber-600" />
                  )}
                  <span>{labels[key]}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
        <section className="mt-6 border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold">Verificar archivo</h2>
          <p className="mt-1 text-sm text-slate-600">
            Selecciona el PDF para recalcular su SHA-256 y compararlo con la evidencia.
          </p>
          <label className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            <Upload className="h-4 w-4" />
            {busy ? 'Verificando...' : 'Seleccionar PDF'}
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              disabled={busy}
              onChange={(event) => event.target.files?.[0] && verifyFile(event.target.files[0])}
            />
          </label>
          {verification && (
            <div
              className={`mt-4 flex items-start gap-3 border px-4 py-3 text-sm ${verification.document_hash_matches ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}
            >
              {verification.document_hash_matches ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : (
                <XCircle className="h-5 w-5" />
              )}
              <span>
                {verification.document_hash_matches
                  ? 'El archivo coincide con la huella criptográfica originalmente anclada.'
                  : 'El archivo presentado no coincide con la huella criptográfica originalmente anclada.'}
              </span>
            </div>
          )}
        </section>
        <section className="mt-6 flex flex-wrap gap-3">
          {verified && (
            <a
              href={`/api/verify/blockchain/${publicToken}/artifacts/certificate`}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Descargar constancia
            </a>
          )}
          {evidence.proof_sha256 && (
            <a
              href={`/api/verify/blockchain/${publicToken}/artifacts/proof`}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
            >
              Descargar prueba .ots
            </a>
          )}
        </section>
      </div>
    </main>
  );
}
