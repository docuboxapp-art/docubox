'use client';

import { use, useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, LoaderCircle, ShieldCheck } from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';
import { createClient } from '@/lib/supabase/client';

export default function InPersonCompletedPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  const [verified, setVerified] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void fetch('/api/firma-presencial/context', { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json();
        if (
          !response.ok ||
          payload.data?.sessionId !== sessionId ||
          payload.data?.terminal !== true
        ) {
          throw new Error('SESSION_NOT_TERMINAL');
        }
        if (active) setVerified(true);
      })
      .catch(() => active && setError('La sesión presencial ya no está disponible.'));
    return () => {
      active = false;
    };
  }, [sessionId]);

  const recoverOwnerContext = async () => {
    setRecovering(true);
    setError('');
    try {
      await createClient().auth.signOut({ scope: 'local' });
      const response = await fetch('/api/firma-presencial/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'release_for_recovery' }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.data?.loginPath) throw new Error('RECOVERY_NOT_AVAILABLE');
      window.location.replace(payload.data.loginPath);
    } catch {
      setError('No fue posible iniciar la recuperación segura. Intenta nuevamente.');
      setRecovering(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8">
      <section className="w-full max-w-md overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <AppLogo size={32} />
          <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-xs font-600 text-emerald-700">
            <ShieldCheck size={13} aria-hidden="true" /> Sesión protegida
          </span>
        </div>
        <div className="p-6 text-center">
          {!verified && !error ? (
            <div className="flex min-h-52 items-center justify-center text-sm text-slate-500">
              <LoaderCircle size={17} className="mr-2 animate-spin" /> Cerrando sesión...
            </div>
          ) : verified ? (
            <>
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                <CheckCircle2 size={26} aria-hidden="true" />
              </span>
              <h1 className="mt-4 text-xl font-700 text-slate-950">Proceso completado</h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Devuelve el dispositivo a la persona que inició la sesión.
              </p>
              <button
                type="button"
                onClick={recoverOwnerContext}
                disabled={recovering}
                className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-600 text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {recovering ? (
                  <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
                ) : (
                  <KeyRound size={16} aria-hidden="true" />
                )}
                {recovering ? 'Preparando recuperación...' : 'Recuperar mi sesión'}
              </button>
              <p className="mt-3 text-xs leading-5 text-slate-500">
                Por seguridad, será necesario volver a iniciar sesión.
              </p>
            </>
          ) : (
            <div className="min-h-52 py-8">
              <ShieldCheck className="mx-auto text-slate-300" size={38} aria-hidden="true" />
              <h1 className="mt-4 text-lg font-700 text-slate-950">Sesión cerrada</h1>
              <p className="mt-2 text-sm text-slate-500">{error}</p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
