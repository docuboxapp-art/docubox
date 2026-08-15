'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertCircle, ArrowLeft, CheckCircle2, Clock3, Download, FileCheck2, Fingerprint, Hash, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';

type VerificationResult = {
  verification_uuid: string;
  overall_status: string;
  document: { folio: string; body_hash_match: boolean; certified_pdf_hash_match: boolean };
  document_chain: { hash_match: boolean; seal_valid: boolean; key_version: string };
  document_seal: {
    seal_uuid: string;
    status: 'VALID' | 'INVALID' | 'UNVERIFIED' | 'REVOKED';
    document_chain_sha256: string;
    signature_algorithm: string;
    key_size_bits: number;
    signing_key_version: string;
    public_key_fingerprint_sha256: string;
    signed_at: string;
    seal_sha256: string;
    seal_base64_preview: string;
    downloads: string[];
  };
  evidence_chain: { manifest_hash_match: boolean; chain_hash_match: boolean; seal_valid: boolean; audit_chain_valid: boolean; key_version: string };
  timestamp: { standard: string; status: string; gen_time: string; timestamp_token_sha256: string } | null;
  certification_root_sha256: string;
};

export default function PublicCertificationVerificationPage() {
  const { verificationUuid } = useParams<{ verificationUuid: string }>();
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/verify/${encodeURIComponent(verificationUuid)}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'No fue posible verificar la certificacion.');
        return payload;
      })
      .then(setResult)
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : 'No fue posible verificar la certificacion.'));
  }, [verificationUuid]);

  return (
    <div className="min-h-screen bg-[#f6f8fb] text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <AppLogo className="[&_img]:h-auto [&_img]:w-[126px]" />
          <span className="text-xs font-600 text-slate-500">Certificacion criptografica</span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <Link href="/verificar-documento" className="inline-flex items-center gap-2 text-sm font-600 text-slate-500 hover:text-slate-950"><ArrowLeft size={16} />Verificacion de documentos</Link>
        {!result && !error && <div className="flex min-h-[460px] items-center justify-center gap-3 text-sm text-slate-500"><Loader2 size={22} className="animate-spin text-blue-600" />Validando cadenas, sellos y estampa...</div>}
        {error && <div className="mx-auto flex min-h-[460px] max-w-lg flex-col items-center justify-center text-center"><AlertCircle size={34} className="text-red-500" /><h1 className="mt-4 text-2xl font-600">Certificacion no disponible</h1><p className="mt-2 text-sm leading-6 text-slate-600">{error}</p></div>}
        {result && (
          <>
            <section className="mt-6 flex flex-col gap-5 border-b border-slate-200 pb-7 sm:flex-row sm:items-start sm:justify-between">
              <div><VerificationBadge status={result.overall_status} /><h1 className="mt-4 text-3xl font-600">{result.overall_status === 'VALID' ? 'Documento integro y certificado' : result.overall_status === 'REVOKED' ? 'Certificacion revocada' : 'Integridad no confirmada'}</h1><p className="mt-2 text-sm text-slate-500">Folio {result.document.folio}</p></div>
              <div className="rounded-md border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500"><p className="font-700 text-slate-900">UUID de verificacion</p><p className="mt-1 font-mono">{result.verification_uuid}</p></div>
            </section>
            <section className="mt-6 grid gap-4 md:grid-cols-2">
              <ValidationCard icon={FileCheck2} title="Documento" rows={[['Huella del cuerpo', result.document.body_hash_match], ['PDF certificado', result.document.certified_pdf_hash_match]]} />
              <ValidationCard icon={KeyRound} title="Cadena original" rows={[['Hash canonico', result.document_chain.hash_match], ['Sello KMS', result.document_chain.seal_valid], [`Llave ${result.document_chain.key_version}`, true]]} />
              <ValidationCard icon={ShieldCheck} title="Cadena de evidencia" rows={[['Manifiesto', result.evidence_chain.manifest_hash_match], ['Sello KMS', result.evidence_chain.seal_valid], ['Bitacora encadenada', result.evidence_chain.audit_chain_valid]]} />
              <ValidationCard icon={Clock3} title="Estampa RFC 3161" rows={result.timestamp ? [[result.timestamp.standard, result.timestamp.status === 'VALID'], [new Date(result.timestamp.gen_time).toLocaleString('es-MX', { timeZone: 'UTC' }) + ' UTC', true]] : [['No disponible', false]]} />
            </section>
            <section className="mt-5 overflow-hidden rounded-md border border-slate-200 bg-white">
              <header className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-md bg-blue-50 text-blue-600"><Fingerprint size={18} /></span><div><h2 className="text-sm font-700">Sello Digital Docubox</h2><p className="mt-0.5 text-xs text-slate-500">Proteccion criptografica de la Cadena Original Docubox</p></div></div>
                <SealBadge status={result.document_seal.status} />
              </header>
              <div className="grid gap-0 lg:grid-cols-[1fr_0.9fr]">
                <div className="space-y-4 p-5 lg:border-r lg:border-slate-200">
                  <SealValue label="Identificador del sello" value={result.document_seal.seal_uuid} />
                  <SealValue label="Hash de la cadena original" value={result.document_seal.document_chain_sha256} mono />
                  <div className="grid gap-4 sm:grid-cols-2"><SealValue label="Algoritmo" value={`${result.document_seal.signature_algorithm} / ${result.document_seal.key_size_bits} bits`} /><SealValue label="Version de llave" value={result.document_seal.signing_key_version} mono /></div>
                  <SealValue label="Huella SHA-256 de la llave publica" value={result.document_seal.public_key_fingerprint_sha256} mono />
                  <SealValue label="Fecha de generacion" value={new Date(result.document_seal.signed_at).toLocaleString('es-MX', { timeZone: 'UTC' }) + ' UTC'} />
                </div>
                <div className="p-5"><p className="text-xs font-700 uppercase text-slate-500">Sello Base64 abreviado</p><pre className="mt-3 max-h-44 overflow-auto whitespace-pre-wrap break-all rounded-md border border-slate-200 bg-slate-50 p-4 font-mono text-[11px] leading-5 text-slate-600">{result.document_seal.seal_base64_preview}</pre><p className="mt-3 text-xs leading-5 text-slate-500">La validacion utiliza siempre el sello completo. Esta abreviacion es solamente visual.</p></div>
              </div>
              <div className="border-t border-slate-200 px-5 py-4"><p className="text-xs font-700 uppercase text-slate-500">Artefactos de verificacion</p><div className="mt-3 flex flex-wrap gap-2">{result.document_seal.downloads.map((name) => <a key={name} href={`/api/verify/${encodeURIComponent(result.verification_uuid)}/artifacts/${encodeURIComponent(name)}`} className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-600 text-slate-700 transition hover:border-blue-300 hover:text-blue-700"><Download size={14} />{name}</a>)}</div></div>
            </section>
            <section className="mt-5 rounded-md border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><Hash size={17} className="text-blue-600" /><h2 className="text-sm font-700">Raiz de certificacion SHA-256</h2></div><p className="mt-3 break-all font-mono text-xs leading-6 text-slate-600">{result.certification_root_sha256}</p></section>
          </>
        )}
      </main>
    </div>
  );
}

function VerificationBadge({ status }: { status: string }) {
  if (status === 'VALID') return <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-700 text-emerald-700"><CheckCircle2 size={14} />Validacion exitosa</span>;
  if (status === 'REVOKED') return <span className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-700 text-amber-700"><AlertCircle size={14} />Llave revocada</span>;
  return <span className="inline-flex items-center gap-2 rounded-full bg-red-50 px-3 py-1 text-xs font-700 text-red-700"><AlertCircle size={14} />Validacion fallida</span>;
}

function SealBadge({ status }: { status: VerificationResult['document_seal']['status'] }) {
  const labels = { VALID: 'Valido', INVALID: 'Invalido', UNVERIFIED: 'No verificado', REVOKED: 'Llave revocada' };
  const valid = status === 'VALID';
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-700 ${valid ? 'bg-emerald-50 text-emerald-700' : status === 'REVOKED' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>{valid ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}{labels[status]}</span>;
}

function SealValue({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div><p className="text-[11px] font-700 uppercase text-slate-500">{label}</p><p className={`mt-1 break-all text-sm text-slate-900 ${mono ? 'font-mono text-xs leading-5' : ''}`}>{value || 'No disponible'}</p></div>;
}

function ValidationCard({ icon: Icon, title, rows }: { icon: React.ElementType; title: string; rows: Array<[string, boolean]> }) {
  return <div className="rounded-md border border-slate-200 bg-white"><header className="flex items-center gap-2 border-b border-slate-200 px-5 py-4"><Icon size={17} className="text-blue-600" /><h2 className="text-sm font-700">{title}</h2></header><div className="divide-y divide-slate-100">{rows.map(([label, valid]) => <div key={label} className="flex items-center justify-between gap-3 px-5 py-3 text-sm"><span className="text-slate-600">{label}</span><span className={`inline-flex items-center gap-1 text-xs font-700 ${valid ? 'text-emerald-700' : 'text-red-600'}`}>{valid ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}{valid ? 'Valido' : 'Invalido'}</span></div>)}</div></div>;
}
