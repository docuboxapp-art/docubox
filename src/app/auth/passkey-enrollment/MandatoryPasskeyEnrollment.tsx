'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { useWebAuthn } from '@/hooks/useWebAuthn';

export default function MandatoryPasskeyEnrollment({ redirectTo }: { redirectTo: string }) {
  const { registerDesktop, loading, error } = useWebAuthn();
  const router = useRouter();
  const [deviceName, setDeviceName] = useState('Dispositivo de administración');

  const enroll = async () => {
    const result = await registerDesktop(deviceName.trim() || 'Dispositivo de administración');
    if (result.success) router.push(redirectTo);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <section className="w-full max-w-md border border-slate-200 bg-white shadow-sm">
        <header className="border-b border-slate-200 px-6 py-5">
          <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-blue-50 text-blue-700">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold text-slate-950">Protege tu acceso administrativo</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Registra una passkey con la protección biométrica o el PIN seguro de este dispositivo.
          </p>
        </header>

        <div className="space-y-5 px-6 py-6">
          <label className="block text-sm font-medium text-slate-800">
            Nombre del dispositivo
            <input
              value={deviceName}
              onChange={(event) => setDeviceName(event.target.value)}
              maxLength={80}
              autoComplete="off"
              className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
            />
          </label>

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
            onClick={enroll}
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <KeyRound className="h-4 w-4" aria-hidden="true" />
            )}
            {loading ? 'Registrando passkey...' : 'Registrar passkey'}
          </button>

          <p className="text-xs leading-5 text-slate-500">
            Docubox conserva la clave pública. La clave privada permanece protegida por tu
            dispositivo.
          </p>
        </div>
      </section>
    </main>
  );
}
