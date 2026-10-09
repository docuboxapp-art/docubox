'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2, ShieldCheck } from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';
import { createClient } from '@/lib/supabase/client';

export default function PublicFormEntryPage() {
  const params = useParams();
  const router = useRouter();
  const formId = params.formId as string;
  const [error, setError] = useState('');
  const [requiresLogin, setRequiresLogin] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const {
        data: { session },
      } = await createClient().auth.getSession();
      if (!active) return;
      if (!session?.access_token) {
        setRequiresLogin(true);
        return;
      }
      try {
        const response = await fetch(
          `/api/formularios/publico/${encodeURIComponent(formId)}/claim`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${session.access_token}` },
            cache: 'no-store',
          }
        );
        const result = await response.json();
        if (!active) return;
        if (response.status === 401) {
          setRequiresLogin(true);
          return;
        }
        if (!response.ok || !result.url)
          throw new Error(result.error || 'No se pudo abrir el formulario.');
        router.replace(result.url);
      } catch (cause) {
        if (active)
          setError(cause instanceof Error ? cause.message : 'No se pudo abrir el formulario.');
      }
    })();
    return () => {
      active = false;
    };
  }, [formId, router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
        <AppLogo className="mx-auto" />
        <ShieldCheck size={28} className="mx-auto mt-7 text-primary" />
        <h1 className="mt-4 text-lg font-semibold">Formulario público</h1>
        {requiresLogin ? (
          <>
            <p className="mt-2 text-sm text-slate-600">
              Inicia sesión con una cuenta registrada y un correo verificado para responder. La
              prueba de vida se solicitará al firmar.
            </p>
            <a
              href={`/login?redirect=${encodeURIComponent(`/formulario-publico/${formId}`)}`}
              className="mt-5 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-white"
            >
              Iniciar sesión
            </a>
          </>
        ) : error ? (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {error}
          </p>
        ) : (
          <p className="mt-3 flex items-center justify-center gap-2 text-sm text-slate-600">
            <Loader2 size={16} className="animate-spin" /> Preparando tu formulario…
          </p>
        )}
      </section>
    </main>
  );
}
