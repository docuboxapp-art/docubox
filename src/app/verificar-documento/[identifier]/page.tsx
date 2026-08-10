'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';
import type { PublicVerificationResult } from '@/lib/public-verification/types';
import PublicVerificationShell from '../components/PublicVerificationShell';
import VerificationResultView from '../components/VerificationResultView';

export default function PublicVerificationDetailPage() {
  const { identifier } = useParams<{ identifier: string }>();
  const [result, setResult] = useState<PublicVerificationResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!identifier) return;
    const controller = new AbortController();
    fetch(`/api/public/v1/verifications/${encodeURIComponent(identifier)}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'No fue posible verificar el documento.');
        return data;
      })
      .then(setResult)
      .catch((requestError) => {
        if (requestError?.name !== 'AbortError')
          setError(
            requestError instanceof Error
              ? requestError.message
              : 'No fue posible verificar el documento.'
          );
      });
    return () => controller.abort();
  }, [identifier]);

  return (
    <PublicVerificationShell>
      <main className="mx-auto min-h-[calc(100vh-129px)] w-full max-w-[1180px] px-4 py-8 sm:px-6 sm:py-10">
        <Link
          href="/verificar-documento"
          className="inline-flex items-center gap-2 text-sm font-600 text-[#52525b] hover:text-[#18181b]"
        >
          <ArrowLeft size={16} />
          Nueva verificación
        </Link>
        {!result && !error && (
          <div className="flex min-h-[460px] flex-col items-center justify-center gap-3 text-sm text-[#71717a]">
            <Loader2 size={26} className="animate-spin text-[#4f46e5]" />
            Ejecutando verificación integral...
          </div>
        )}
        {error && (
          <div className="mx-auto flex min-h-[460px] max-w-xl flex-col items-center justify-center text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-md bg-red-50 text-red-600">
              <AlertCircle size={24} />
            </span>
            <h1 className="mt-4 text-xl font-650">Verificación no disponible</h1>
            <p className="mt-2 text-sm leading-6 text-[#52525b]">{error}</p>
          </div>
        )}
        {result && <VerificationResultView result={result} />}
      </main>
    </PublicVerificationShell>
  );
}
