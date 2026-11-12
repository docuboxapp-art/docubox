'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2, ShieldCheck, LogIn, UserPlus } from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';
import CaseIdentityModal from '@/components/case-files/CaseIdentityModal';
import { createClient } from '@/lib/supabase/client';
type Entry = {
  ready: boolean;
  mode: 'private' | 'public' | 'legacy';
  needsLogin: boolean;
  needsCode: boolean;
  needsLiveness: boolean;
  needsRegistration?: boolean;
  wrongAccount?: boolean;
};
export default function CaseEntryGate({ token, initial }: { token: string; initial: Entry }) {
  const router = useRouter(),
    [entry, setEntry] = useState(initial),
    [email, setEmail] = useState(''),
    [code, setCode] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [mobile, setMobile] = useState(false);
  const path = `/expediente/${token}`;
  async function request(body: Record<string, unknown>) {
    const auth = await createClient().auth.getSession();
    const r = await fetch('/api/public/case-entry', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-case-invitation': token,
        ...(auth.data.session ? { Authorization: `Bearer ${auth.data.session.access_token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'No se pudo comprobar el acceso.');
    return j.data;
  }
  async function enter(capture?: string) {
    setBusy(true);
    setError('');
    try {
      const next = await request({
        action: capture ? 'complete' : 'enter',
        mobileSessionToken: capture,
      });
      setEntry(next);
      if (next.ready) {
        setMobile(false);
        router.refresh();
      } else if (
        next.needsLiveness &&
        !next.needsCode &&
        !next.needsLogin &&
        !next.needsRegistration
      )
        setMobile(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo abrir el expediente.');
    } finally {
      setBusy(false);
    }
  }
  async function checkCode() {
    setBusy(true);
    setError('');
    try {
      await request({ action: 'code', code, email });
      const next = await request({ action: 'enter' });
      setEntry(next);
      if (next.ready) router.refresh();
      else if (next.needsLiveness && !next.needsCode && !next.needsLogin && !next.needsRegistration)
        setMobile(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo comprobar el código.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <section className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-7 shadow-sm">
        <AppLogo />
        <span className="mt-7 inline-flex items-center gap-2 rounded-md bg-blue-50 px-3 py-1.5 text-xs font-medium text-primary">
          <ShieldCheck size={15} />
          {entry.mode === 'public' ? 'Acceso con código' : 'Invitación privada'}
        </span>
        <h1 className="mt-4 text-2xl font-semibold">Abrir expediente</h1>
        {entry.needsCode ? (
          <div className="mt-5 space-y-4">
            <p className="text-sm leading-6 text-slate-500">
              Escribe el correo de la invitación y el código que recibiste por separado. Después
              comprobarás tu identidad sin iniciar sesión.
            </p>
            <label className="block text-sm">
              Correo electrónico
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 h-11 w-full rounded-lg border border-slate-200 px-3"
              />
            </label>
            <label className="block text-sm">
              Código de acceso
              <input
                autoComplete="one-time-code"
                value={code}
                maxLength={20}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="mt-1 h-11 w-full rounded-lg border border-slate-200 px-3 font-mono tracking-widest"
              />
            </label>
            <button
              disabled={busy || !email || !code}
              onClick={() => void checkCode()}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
              Comprobar código
            </button>
          </div>
        ) : entry.needsLogin || entry.needsRegistration ? (
          <div className="mt-5 space-y-3">
            <p className="text-sm leading-6 text-slate-500">
              {entry.needsRegistration
                ? 'Crea tu acceso personal con el correo de la invitación y verifica tu correo. Después vuelve a esta pestaña para continuar con el código y la prueba de vida.'
                : entry.wrongAccount
                  ? 'La cuenta abierta no corresponde al correo de la invitación. Cambia de cuenta para continuar.'
                  : 'Inicia sesión con el correo al que se envió la invitación. Si aún no tienes cuenta, crea tu acceso y vuelve a esta pestaña.'}
            </p>
            {!entry.needsRegistration && (
              <a
                href={`/login?redirect=${encodeURIComponent(path)}`}
                className="flex h-11 items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-white"
              >
                <LogIn size={16} />
                Iniciar sesión
              </a>
            )}
            <a
              href="/registro"
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 text-sm"
            >
              <UserPlus size={16} />
              Crear mi acceso
            </a>
            <button
              disabled={busy}
              onClick={() => void enter()}
              className="w-full py-2 text-sm text-primary"
            >
              {entry.needsRegistration
                ? 'Ya creé mi acceso, continuar'
                : 'Ya inicié sesión, comprobar acceso'}
            </button>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <p className="text-sm leading-6 text-slate-500">
              Escanea el código QR con tu teléfono y completa la prueba de vida para acceder a tu
              expediente. Al terminar, esta pantalla comprobará tu identidad y abrirá el expediente.
            </p>
            <button
              disabled={busy}
              onClick={() => void enter()}
              className="h-11 w-full rounded-lg bg-primary text-sm font-medium text-white"
            >
              Verificar identidad con QR
            </button>
          </div>
        )}
        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}
        {mobile && (
          <CaseIdentityModal
            invitation={token}
            busy={busy}
            error={error}
            onClose={() => setMobile(false)}
            onVerified={async (capture) => {
              await enter(capture);
            }}
          />
        )}
      </section>
    </main>
  );
}
