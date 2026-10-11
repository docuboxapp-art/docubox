'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AlertCircle, CheckCircle2, FileCheck2, Hash, Loader2, ShieldCheck } from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';

interface ValidationData {
  valid: boolean;
  verification_status: 'pending' | 'verified' | 'mismatch' | 'unavailable';
  response_id: string;
  folio: string;
  form_name: string;
  submitted_at: string;
  sha256_hash?: string | null;
}

const validationCopy = {
  verified: {
    title: 'PDF de respuestas íntegro',
    description: 'El PDF de respuestas almacenado coincide con la huella SHA-256 registrada al generarlo.',
  },
  pending: {
    title: 'PDF de respuestas pendiente',
    description: 'La respuesta está registrada, pero todavía no hay un PDF disponible para verificar.',
  },
  mismatch: {
    title: 'Integridad no confirmada',
    description: 'El PDF de respuestas almacenado no coincide con la huella registrada. No debe considerarse verificado.',
  },
  unavailable: {
    title: 'No se pudo verificar el PDF',
    description: 'No fue posible recuperar el PDF de respuestas para comprobar su integridad. Intenta nuevamente más tarde.',
  },
};

export default function ValidateFormDocumentPage() {
  const id = useParams().id as string;
  const [data, setData] = useState<ValidationData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/validate-form-document?id=${encodeURIComponent(id)}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'No se pudo verificar la respuesta.');
        if (!payload.verification_status) throw new Error('La verificación del PDF no está disponible.');
        setData(payload);
      })
      .catch((requestError) => {
        if (requestError?.name !== 'AbortError') {
          setError(requestError instanceof Error ? requestError.message : 'No se pudo verificar.');
        }
      });
    return () => controller.abort();
  }, [id]);

  const verification = data ? validationCopy[data.verification_status] : null;
  const verified = data?.verification_status === 'verified' && data.valid;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F8F8FB] p-4">
      <main className="w-full max-w-lg rounded-md border border-[#EBEBF0] bg-white shadow-sm">
        <header className="flex items-center justify-between border-b border-[#EBEBF0] p-5">
          <AppLogo />
          <span className="flex items-center gap-1.5 text-xs font-medium text-[#52525B]">
            <ShieldCheck size={14} /> Verificación de respuestas
          </span>
        </header>
        {!data && !error ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center gap-3 text-sm text-[#71717A]">
            <Loader2 size={24} className="animate-spin text-[#4F46E5]" />
            Comprobando el PDF almacenado...
          </div>
        ) : error ? (
          <div className="p-8 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
              <AlertCircle size={23} />
            </span>
            <h1 className="mt-4 text-lg font-semibold">Verificación no disponible</h1>
            <p className="mt-2 text-sm text-[#71717A]">{error}</p>
          </div>
        ) : data && verification ? (
          <div className="p-8">
            <span className={`flex h-12 w-12 items-center justify-center rounded-full ${verified ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
              {verified ? <CheckCircle2 size={24} /> : <AlertCircle size={24} />}
            </span>
            <h1 className="mt-4 text-xl font-semibold text-[#18181B]">{verification.title}</h1>
            <p className="mt-2 text-sm leading-6 text-[#71717A]">{verification.description}</p>
            <p className="mt-3 text-xs leading-5 text-[#64748B]">
              Esta comprobación corresponde al PDF generado con las respuestas del formulario. La firma y la certificación del PDF final se verifican por separado.
            </p>
            <dl className="mt-6 space-y-4 rounded-md bg-[#F8F8FB] p-4">
              <Info label="Formulario" value={data.form_name} icon={FileCheck2} />
              <Info label="Folio" value={data.folio} />
              <Info label="Enviado" value={new Date(data.submitted_at).toLocaleString('es-MX')} />
              {data.sha256_hash && <Info label="SHA-256 del PDF de respuestas" value={data.sha256_hash} icon={Hash} mono />}
            </dl>
          </div>
        ) : null}
      </main>
    </div>
  );
}

function Info({ label, value, icon: Icon, mono }: { label: string; value: string; icon?: React.ElementType; mono?: boolean }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-[#71717A]">
        {Icon && <Icon size={11} />}{label}
      </dt>
      <dd className={`mt-1 break-all text-xs text-[#27272A] ${mono ? 'font-mono leading-5' : 'font-medium'}`}>{value}</dd>
    </div>
  );
}
