'use client';

import { use, useEffect, useState } from 'react';
import { KeyRound, LoaderCircle, ShieldAlert } from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';
import { createClient } from '@/lib/supabase/client';

export default function RecoverInPersonOwnerPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const recover = async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      if (!data.session?.access_token) {
        window.location.replace(
          `/login?redirect=${encodeURIComponent(`/firma-presencial/recuperar/${sessionId}`)}`
        );
        return;
      }
      const response = await fetch('/api/firma-presencial/recover', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${data.session.access_token}`,
        },
        body: JSON.stringify({ sessionId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.data?.returnPath) {
        if (active) setError('La cuenta autenticada no puede recuperar esta sesión.');
        return;
      }
      window.location.replace(payload.data.returnPath);
    };
    void recover();
    return () => {
      active = false;
    };
  }, [sessionId]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8">
      <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
        <AppLogo size={32} className="mx-auto" />
        {error ? (
          <>
            <ShieldAlert size={38} className="mx-auto mt-7 text-amber-500" aria-hidden="true" />
            <h1 className="mt-4 text-lg font-600 text-slate-950">
              No fue posible recuperar la sesión
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">{error}</p>
            <button
              type="button"
              onClick={async () => {
                await createClient().auth.signOut({ scope: 'local' });
                window.location.replace('/login');
              }}
              className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-600 text-white"
            >
              <KeyRound size={16} aria-hidden="true" /> Iniciar sesión nuevamente
            </button>
          </>
        ) : (
          <div className="flex min-h-52 items-center justify-center text-sm text-slate-500">
            <LoaderCircle size={17} className="mr-2 animate-spin" aria-hidden="true" />
            Verificando al propietario...
          </div>
        )}
      </section>
    </main>
  );
}
