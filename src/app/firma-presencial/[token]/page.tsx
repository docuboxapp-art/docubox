'use client';

import { use, useEffect, useState } from 'react';
import { CheckCircle2, Clock3, LogOut, ShieldCheck } from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';
import { createClient } from '@/lib/supabase/client';

type SessionInfo = {
  status: string;
  expiresAt: string;
  participantName: string;
  documentName: string;
  available: boolean;
};

export default function InPersonSigningPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/firma-presencial/${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'La sesión no está disponible.');
        if (!cancelled) setInfo(body.data);
      })
      .catch(
        (cause) =>
          !cancelled &&
          setError(cause instanceof Error ? cause.message : 'La sesión no está disponible.')
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [token]);

  const startHandoff = async () => {
    setStarting(true);
    setError('');
    try {
      const claim = crypto.randomUUID();
      const response = await fetch(`/api/firma-presencial/${encodeURIComponent(token)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', claim }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'No fue posible iniciar la firma.');
      await createClient().auth.signOut({ scope: 'local' });
      window.location.replace(body.data.portalPath);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible iniciar la firma.');
      setStarting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8">
      <section className="w-full max-w-lg overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <AppLogo size={32} />
          <span className="inline-flex items-center gap-1.5 rounded-md bg-blue-50 px-2 py-1 text-xs font-600 text-primary">
            <ShieldCheck size={13} /> Firma presencial
          </span>
        </div>
        <div className="p-5 sm:p-6">
          {loading ? (
            <div className="flex min-h-48 items-center justify-center text-sm text-slate-500">
              Validando sesión...
            </div>
          ) : error && !info ? (
            <div className="min-h-48 py-8 text-center">
              <Clock3 className="mx-auto mb-3 text-slate-300" size={36} />
              <h1 className="text-lg font-600 text-slate-950">Sesión no disponible</h1>
              <p className="mt-2 text-sm text-slate-500">{error}</p>
            </div>
          ) : info ? (
            <>
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                <CheckCircle2 size={22} />
              </div>
              <h1 className="mt-4 text-xl font-600 text-slate-950">
                Entrega el dispositivo al participante
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                La sesión del propietario se cerrará antes de continuar. El participante solo podrá
                acceder a este documento y deberá identificarse con su acceso habitual.
              </p>
              <dl className="mt-5 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-slate-50 px-4">
                <div className="py-3">
                  <dt className="text-xs text-slate-500">Participante</dt>
                  <dd className="mt-0.5 text-sm font-600 text-slate-900">{info.participantName}</dd>
                </div>
                <div className="py-3">
                  <dt className="text-xs text-slate-500">Documento</dt>
                  <dd className="mt-0.5 text-sm font-600 text-slate-900">{info.documentName}</dd>
                </div>
                <div className="py-3">
                  <dt className="text-xs text-slate-500">Vigencia de la sesión</dt>
                  <dd className="mt-0.5 text-sm text-slate-700">
                    Hasta{' '}
                    {new Date(info.expiresAt).toLocaleTimeString('es-MX', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </dd>
                </div>
              </dl>
              {error && (
                <p
                  role="alert"
                  className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  {error}
                </p>
              )}
              <button
                type="button"
                onClick={startHandoff}
                disabled={!info.available || starting}
                className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-600 text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <LogOut size={16} />
                {starting ? 'Preparando acceso...' : 'Cerrar mi sesión y continuar'}
              </button>
              <p className="mt-3 text-center text-xs leading-5 text-slate-500">
                Al finalizar, el propietario deberá iniciar sesión nuevamente para recuperar el
                control.
              </p>
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}
