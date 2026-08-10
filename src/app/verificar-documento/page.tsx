'use client';

import { FormEvent, useRef, useState } from 'react';
import {
  ArrowRight,
  Clock3,
  FileSearch,
  Fingerprint,
  Hash,
  Loader2,
  QrCode,
  ShieldCheck,
  UploadCloud,
} from 'lucide-react';
import type { PublicVerificationResult } from '@/lib/public-verification/types';
import PublicVerificationShell from './components/PublicVerificationShell';
import VerificationResultView from './components/VerificationResultView';

type Method = 'lookup' | 'document' | 'hash' | 'nom151' | 'timestamp';

const methods: Array<{
  id: Method;
  label: string;
  description: string;
  icon: React.ElementType;
  group: 'quick' | 'technical';
}> = [
  {
    id: 'lookup',
    label: 'QR, folio o código',
    description: 'Consulta el registro y todas sus evidencias disponibles.',
    icon: QrCode,
    group: 'quick',
  },
  {
    id: 'document',
    label: 'Verificar documento',
    description: 'Calcula localmente la huella SHA-256 de un PDF.',
    icon: FileSearch,
    group: 'quick',
  },
  {
    id: 'hash',
    label: 'Consultar huella',
    description: 'Identifica un artefacto mediante su hash SHA-256.',
    icon: Hash,
    group: 'quick',
  },
  {
    id: 'nom151',
    label: 'Constancia NOM-151',
    description: 'Valida una constancia mediante el proveedor configurado.',
    icon: ShieldCheck,
    group: 'technical',
  },
  {
    id: 'timestamp',
    label: 'Estampa RFC 3161',
    description: 'Comprueba estructura, firma, TSA y messageImprint.',
    icon: Clock3,
    group: 'technical',
  },
];

export default function PublicDocumentVerificationPage() {
  const [method, setMethod] = useState<Method>('lookup');
  const [identifier, setIdentifier] = useState('');
  const [hash, setHash] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<PublicVerificationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const resultRef = useRef<HTMLDivElement>(null);

  const selectMethod = (value: Method) => {
    setMethod(value);
    setResult(null);
    setError('');
    setFile(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);
    try {
      let response: Response;
      if (method === 'lookup') {
        const value = identifier.trim();
        if (!value) throw new Error('Ingresa el folio, código o token del documento.');
        response = await fetch(`/api/public/v1/verifications/${encodeURIComponent(value)}`, {
          cache: 'no-store',
        });
      } else if (method === 'hash') {
        response = await fetch('/api/public/v1/verifications/hash', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ algorithm: 'SHA-256', hash }),
        });
      } else {
        if (!file) throw new Error('Selecciona el archivo que deseas verificar.');
        if (
          method === 'document' &&
          file.type !== 'application/pdf' &&
          !file.name.toLowerCase().endsWith('.pdf')
        )
          throw new Error('Selecciona un archivo PDF.');
        const maxSize = method === 'document' ? 30 * 1024 * 1024 : 8 * 1024 * 1024;
        if (file.size > maxSize)
          throw new Error(
            `El archivo supera el límite de ${Math.round(maxSize / 1024 / 1024)} MB.`
          );
        const fileHash = await sha256File(file);
        if (method === 'document') {
          response = await fetch('/api/public/v1/verifications/document', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              algorithm: 'SHA-256',
              hash: fileHash,
              method: 'DOCUMENT',
              fileName: file.name,
              fileSize: file.size,
            }),
          });
        } else {
          const artifactBase64 = await fileToBase64(file);
          response = await fetch(
            `/api/public/v1/verifications/${method === 'nom151' ? 'nom151' : 'timestamp'}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                hash: fileHash,
                fileName: file.name,
                fileSize: file.size,
                artifactBase64,
              }),
            }
          );
        }
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No fue posible completar la verificación.');
      setResult(data as PublicVerificationResult);
      window.setTimeout(
        () => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        50
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'No fue posible completar la verificación.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <PublicVerificationShell>
      <main className="mx-auto w-full max-w-[1180px] px-4 py-9 sm:px-6 sm:py-12">
        <section className="border-b border-[#ebebf0] pb-8">
          <p className="text-xs font-700 uppercase text-[#4f46e5]">Docubox</p>
          <h1 className="mt-2 text-3xl font-650 text-[#18181b] sm:text-4xl">
            Centro de Verificación
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-[#52525b]">
            Comprueba la integridad y las evidencias criptográficas asociadas a un documento.
          </p>
        </section>

        <div className="mt-8 grid items-start gap-7 lg:grid-cols-[330px_minmax(0,1fr)]">
          <aside className="overflow-hidden rounded-lg border border-[#ebebf0] bg-white">
            <MethodGroup
              title="Verificación rápida"
              methods={methods.filter((item) => item.group === 'quick')}
              selected={method}
              onSelect={selectMethod}
            />
            <MethodGroup
              title="Verificación técnica"
              methods={methods.filter((item) => item.group === 'technical')}
              selected={method}
              onSelect={selectMethod}
              bordered
            />
          </aside>

          <section className="rounded-lg border border-[#ebebf0] bg-white p-5 shadow-[0_8px_28px_rgba(24,24,27,0.04)] sm:p-7">
            <MethodForm
              method={method}
              identifier={identifier}
              hash={hash}
              file={file}
              loading={loading}
              error={error}
              onIdentifier={setIdentifier}
              onHash={setHash}
              onFile={setFile}
              onSubmit={submit}
            />
          </section>
        </div>

        <div ref={resultRef}>{result && <VerificationResultView result={result} />}</div>
      </main>
    </PublicVerificationShell>
  );
}

function MethodGroup({
  title,
  methods: items,
  selected,
  onSelect,
  bordered,
}: {
  title: string;
  methods: typeof methods;
  selected: Method;
  onSelect: (method: Method) => void;
  bordered?: boolean;
}) {
  return (
    <div className={bordered ? 'border-t border-[#ebebf0]' : ''}>
      <h2 className="px-4 pb-2 pt-4 text-[10px] font-700 uppercase text-[#a1a1aa]">{title}</h2>
      <div className="p-2 pt-0">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            className={`flex w-full items-start gap-3 rounded-md px-3 py-3 text-left transition-colors ${selected === item.id ? 'bg-indigo-50 text-[#4f46e5]' : 'text-[#52525b] hover:bg-[#f8f8fb]'}`}
          >
            <item.icon size={18} className="mt-0.5 shrink-0" />
            <span>
              <span className={`block text-sm ${selected === item.id ? 'font-650' : 'font-600'}`}>
                {item.label}
              </span>
              <span className="mt-0.5 block text-xs leading-5 text-[#71717a]">
                {item.description}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function MethodForm(props: {
  method: Method;
  identifier: string;
  hash: string;
  file: File | null;
  loading: boolean;
  error: string;
  onIdentifier: (value: string) => void;
  onHash: (value: string) => void;
  onFile: (file: File | null) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const selected = methods.find((item) => item.id === props.method)!;
  return (
    <form onSubmit={props.onSubmit}>
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-indigo-50 text-[#4f46e5]">
          <selected.icon size={20} />
        </span>
        <div>
          <h2 className="text-xl font-650 text-[#18181b]">{selected.label}</h2>
          <p className="mt-1 text-sm leading-6 text-[#52525b]">{selected.description}</p>
        </div>
      </div>
      <div className="mt-7">
        {props.method === 'lookup' && (
          <Field label="Folio, código o token">
            <div className="relative">
              <QrCode
                size={18}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#a1a1aa]"
              />
              <input
                value={props.identifier}
                onChange={(event) => props.onIdentifier(event.target.value)}
                autoComplete="off"
                placeholder="DBX-2026-00003482 o 7KMQ-29PD-X81F"
                className="h-11 w-full rounded-md border border-[#d4d4d8] bg-white pl-11 pr-4 text-sm outline-none focus:border-[#4f46e5] focus:ring-2 focus:ring-indigo-100"
              />
            </div>
          </Field>
        )}
        {props.method === 'hash' && (
          <Field label="Huella SHA-256">
            <div className="relative">
              <Fingerprint size={18} className="absolute left-3.5 top-4 text-[#a1a1aa]" />
              <textarea
                value={props.hash}
                onChange={(event) => props.onHash(event.target.value)}
                rows={3}
                placeholder="64 caracteres hexadecimales"
                className="w-full resize-none rounded-md border border-[#d4d4d8] bg-white py-3 pl-11 pr-4 font-mono text-xs outline-none focus:border-[#4f46e5] focus:ring-2 focus:ring-indigo-100"
              />
            </div>
          </Field>
        )}
        {['document', 'nom151', 'timestamp'].includes(props.method) && (
          <FileDrop
            file={props.file}
            accept={
              props.method === 'document'
                ? '.pdf,application/pdf'
                : props.method === 'nom151'
                  ? '.xml,.tst,.tsr,.p7s,.p7m,.der,.bin'
                  : '.tst,.tsr,.p7s,.p7m,.der,.bin'
            }
            onFile={props.onFile}
          />
        )}
      </div>
      {props.error && (
        <p
          role="alert"
          className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {props.error}
        </p>
      )}
      <div className="mt-6 flex items-center justify-between border-t border-[#ebebf0] pt-5">
        <p className="max-w-md text-xs leading-5 text-[#71717a]">
          Los PDF se comparan por huella local. Los validadores técnicos solo confirman resultados
          emitidos por motores criptográficos configurados.
        </p>
        <button
          type="submit"
          disabled={props.loading}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-[#4f46e5] px-4 text-sm font-650 text-white hover:bg-[#4338ca] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {props.loading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <ArrowRight size={16} />
          )}
          {props.loading ? 'Verificando' : 'Verificar'}
        </button>
      </div>
    </form>
  );
}

function FileDrop({
  file,
  accept,
  onFile,
}: {
  file: File | null;
  accept: string;
  onFile: (file: File | null) => void;
}) {
  return (
    <label className="flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-[#c7c7d1] bg-[#fafafa] px-5 text-center hover:border-[#4f46e5] hover:bg-indigo-50/30">
      <UploadCloud size={28} className="text-[#4f46e5]" />
      <span className="mt-3 text-sm font-650 text-[#18181b]">
        {file ? file.name : 'Selecciona o arrastra un archivo'}
      </span>
      <span className="mt-1 text-xs text-[#71717a]">
        {file
          ? formatBytes(file.size)
          : 'El archivo se procesa de forma temporal para la comprobación.'}
      </span>
      <input
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(event) => onFile(event.target.files?.[0] || null)}
      />
    </label>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-650 text-[#18181b]">{label}</span>
      {children}
    </label>
  );
}
async function sha256File(file: File) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
async function fileToBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  return btoa(binary);
}
function formatBytes(value: number) {
  return value < 1024 * 1024
    ? `${Math.ceil(value / 1024)} KB`
    : `${(value / 1024 / 1024).toFixed(1)} MB`;
}
