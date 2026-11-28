import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { CircleAlert, ShieldCheck } from 'lucide-react';
import PublicVerificationShell from '@/app/verificar-documento/components/PublicVerificationShell';
import { enforcePublicRateLimit } from '@/lib/public-verification/gateway';
import { findPublicSignatureStamp } from '@/lib/public-verification/signature-stamp';
import { parseSignatureVerificationReference } from '@/lib/signatures/verification-link';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Verificación de firma | Docubox',
  robots: { index: false, follow: false, noarchive: true },
  referrer: 'no-referrer',
};

const signatureDate = new Intl.DateTimeFormat('es-MX', {
  dateStyle: 'long',
  timeStyle: 'medium',
  timeZone: 'UTC',
});

async function lookupSignature(reference: string) {
  const notFound = { error: 'No se encontró un registro disponible para esta firma.' };
  const evidenceId = parseSignatureVerificationReference(reference);
  if (!evidenceId) return notFound;

  try {
    const request = { headers: await headers() };
    const deadline = AbortSignal.timeout(8_000);
    if (!(await enforcePublicRateLimit(request, 'signature-stamp', 30, deadline))) {
      return { error: 'Demasiadas consultas. Intenta de nuevo en un minuto.' };
    }

    const stamp = await findPublicSignatureStamp(createServiceClient(deadline), evidenceId);
    return stamp ? { stamp } : notFound;
  } catch (error) {
    console.error('[public-signature-stamp] lookup failed', {
      code: error && typeof error === 'object' && 'code' in error ? error.code : null,
    });
    return { error: 'No pudimos consultar la firma en este momento. Intenta de nuevo.' };
  }
}

export default async function VerifySignaturePage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;
  const result = await lookupSignature(reference);
  const stamp = 'stamp' in result ? result.stamp : null;
  const fields = stamp && [
    ['Firmante (iniciales)', stamp.signerInitials],
    ['Método de firma', stamp.method],
    ['Fecha y hora', `${signatureDate.format(new Date(stamp.signedAt))} UTC`],
    ['Huella SHA-256 (inicio)', stamp.fingerprintPrefix],
  ];

  return (
    <PublicVerificationShell>
      <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6 sm:py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Verificación de firma</h1>
        {fields ? (
          <section
            className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
            aria-labelledby="signature-status"
          >
            <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4 sm:px-6">
              <ShieldCheck size={22} className="text-emerald-700" aria-hidden />
              <h2 id="signature-status" className="font-semibold">
                Firma registrada
              </h2>
            </div>
            <dl className="grid gap-4 px-5 py-5 sm:grid-cols-2 sm:px-6">
              {fields.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-sm text-slate-600">{label}</dt>
                  <dd className="mt-1 break-words text-sm font-medium">
                    {value || 'Sin información'}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="border-t border-slate-200 px-5 py-4 text-sm text-slate-600 sm:px-6">
              Este QR consulta el registro de la firma. Para comprobar la integridad del PDF, usa la{' '}
              <Link
                href="/verificar-documento"
                className="text-primary underline underline-offset-2"
              >
                verificación del documento
              </Link>
              .
            </p>
          </section>
        ) : (
          <p
            role="alert"
            className="mt-5 flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-700"
          >
            <CircleAlert size={18} className="shrink-0 text-amber-600" aria-hidden />
            {'error' in result && result.error}
          </p>
        )}
      </main>
    </PublicVerificationShell>
  );
}
