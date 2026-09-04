'use client';

import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useWebAuthn } from '@/hooks/useWebAuthn';

export default function MandatoryPasskeyVerification({
  email,
  redirectTo,
}: {
  email: string;
  redirectTo: string;
}) {
  const { authenticateWithDevice, loading, error } = useWebAuthn();
  const router = useRouter();

  const verify = async () => {
    const result = await authenticateWithDevice(email);
    if (result.success) {
      router.push(`/login/totp-verification?redirect=${encodeURIComponent(redirectTo)}`);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <section className="w-full max-w-md border border-slate-200 bg-white shadow-sm">
        <header className="border-b border-slate-200 px-6 py-5">
          <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-blue-50 text-blue-700">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold text-slate-950">Confirma tu passkey</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            El acceso al Control Plane requiere una verificación resistente a phishing.
          </p>
        </header>
        <div className="space-y-5 px-6 py-6">
          {error ? (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
            >
              {error}
            </div>
          ) : null}
          <button
            type="button"
            onClick={verify}
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <KeyRound className="h-4 w-4" aria-hidden="true" />
            )}
            {loading ? 'Verificando passkey...' : 'Continuar con passkey'}
          </button>
          <p className="text-xs leading-5 text-slate-500">
            Después de esta verificación se solicitará el código TOTP del autenticador.
          </p>
        </div>
      </section>
    </main>
  );
}
