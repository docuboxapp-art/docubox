'use client';

import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, KeyRound, Loader2, Mail, ShieldCheck, X } from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';
import PublicFormMobileBiometricModal from './PublicFormMobileBiometricModal';
import PublicFormExpressRegistration from './PublicFormExpressRegistration';

export default function PublicFormCodeEntry({ formId }: { formId?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const invitedEmail = searchParams.get('email') || '';
  const validInvitedEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invitedEmail.trim());
  const [email, setEmail] = useState(invitedEmail.trim().toLowerCase());
  const [identitySelected, setIdentitySelected] = useState(validInvitedEmail);
  const [code, setCode] = useState('');
  const [codeVerified, setCodeVerified] = useState(false);
  const [checkingCode, setCheckingCode] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileError, setMobileError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [accountExists, setAccountExists] = useState<boolean | null>(null);
  const [canRegister, setCanRegister] = useState(false);

  const changeIdentity = () => {
    setCodeVerified(false);
    setMobileOpen(false);
    setIdentitySelected(false);
    setAccountExists(null);
    setCanRegister(false);
    setCode('');
  };

  const checkEmail = (address: string) => {
    const normalized = address.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      setError('Ingresa un correo electrónico válido.');
      return;
    }
    setError('');
    setEmail(normalized);
    setIdentitySelected(true);
  };

  const continueWithEmail = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    checkEmail(email);
  };

  const verifyCode = async () => {
    if (!code.trim()) {
      setError('Ingresa el código que recibiste por correo.');
      return;
    }
    setCheckingCode(true);
    setError('');
    try {
      const response = await fetch('/api/formularios/publico/verificar-codigo', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, formId, email }),
      });
      const result = await response.json();
      if (!response.ok || result.valid !== true)
        throw new Error(result.error || 'El código no es válido.');
      setCodeVerified(true);
      setAccountExists(result.accountExists === true);
      setCanRegister(result.canRegister === true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo comprobar el código.');
    } finally {
      setCheckingCode(false);
    }
  };

  const submit = async (mobileSessionToken: string, enrollmentToken?: string) => {
    if (!codeVerified) return;
    setBusy(true);
    setMobileError('');
    try {
      const response = await fetch(
        formId
          ? `/api/formularios/publico/${encodeURIComponent(formId)}/claim`
          : '/api/formularios/publico/claim',
        {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, email, mobileSessionToken, enrollmentToken }),
        }
      );
      const result = await response.json();
      if (!response.ok || !result.url)
        throw new Error(result.error || 'No se pudo abrir el formulario.');
      router.replace(result.url);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'No se pudo abrir el formulario.';
      if (enrollmentToken) setError(message);
      else setMobileError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <section className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-7 shadow-sm sm:p-9">
        <AppLogo />
        <span className="mt-8 inline-flex items-center gap-2 rounded-md bg-blue-50 px-3 py-1.5 text-xs font-medium text-primary">
          <KeyRound size={15} /> Acceso a formulario público
        </span>
        <h1 className="mt-4 text-2xl font-semibold text-slate-950">Acreditar identidad</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Identifícate con tu correo y comprueba el código que recibiste por separado. Después
          realizarás la prueba de vida para abrir el formulario.
        </p>
        {identitySelected ? (
          <>
            <div className="mt-6 flex items-center justify-between rounded-md bg-blue-50 px-3 py-2 text-sm text-slate-700">
              <span className="flex items-center gap-2">
                <Mail size={16} /> {email}
              </span>
              <button type="button" onClick={changeIdentity} className="text-primary">
                Cambiar
              </button>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Comprueba el código recibido por separado. Después haremos la prueba de vida sin
              pedirte que inicies sesión. Si ya registraste tu identificación, solo tomarás una
              selfie.
            </p>
            <label className="mt-5 block text-sm font-medium text-slate-700">
              Código de acceso
              <input
                autoComplete="off"
                value={code}
                disabled={checkingCode || codeVerified}
                onChange={(event) => {
                  setCode(event.target.value.toUpperCase());
                  setCodeVerified(false);
                  setError('');
                }}
                placeholder="8 caracteres"
                className="mt-2 w-full rounded-md border border-slate-200 px-3 py-3 font-mono text-sm uppercase outline-none focus:border-primary disabled:bg-slate-50"
              />
            </label>
            {codeVerified ? (
              <p
                role="status"
                className="mt-4 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-700"
              >
                <CheckCircle2 size={17} /> Código correcto. Continúa con tu identidad.
              </p>
            ) : (
              <button
                type="button"
                onClick={() => void verifyCode()}
                disabled={checkingCode || !code.trim()}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-md border border-primary px-4 py-2.5 text-sm font-medium text-primary disabled:opacity-50"
              >
                {checkingCode && <Loader2 size={16} className="animate-spin" />} Comprobar código
              </button>
            )}
            {codeVerified && accountExists === false && !canRegister && (
              <p role="alert" className="mt-4 text-sm text-amber-700">
                Solicita una nueva invitación con un código individual para crear tu cuenta desde
                este formulario.
              </p>
            )}
            {codeVerified && accountExists === false && canRegister && (
              <PublicFormExpressRegistration
                email={email}
                formId={formId}
                code={code}
                onRegistered={(enrollmentToken) => {
                  setAccountExists(true);
                  if (enrollmentToken) void submit('', enrollmentToken);
                }}
              />
            )}
            {codeVerified && accountExists === true && (
              <button
                type="button"
                onClick={() => {
                  setMobileError('');
                  setMobileOpen(true);
                }}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 text-sm font-medium text-white"
              >
                <ShieldCheck size={16} /> Verificar en móvil y acceder
              </button>
            )}
            {codeVerified && (
              <button
                type="button"
                onClick={() => {
                  setCodeVerified(false);
                  setCode('');
                }}
                className="mt-3 w-full text-sm text-primary"
              >
                Usar otro código
              </button>
            )}
          </>
        ) : null}
        {error && (
          <p role="alert" className="mt-4 text-sm text-red-600">
            {error}
          </p>
        )}
      </section>
      {mobileOpen && (
        <PublicFormMobileBiometricModal
          formId={formId}
          code={code}
          email={email}
          busy={busy}
          error={mobileError}
          onClose={() => setMobileOpen(false)}
          onVerified={submit}
        />
      )}
      {!identitySelected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form
            onSubmit={(event) => void continueWithEmail(event)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="identity-modal-title"
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="identity-modal-title" className="text-lg font-semibold text-slate-950">
                  Acreditar identidad
                </h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  Ingresa el correo de la invitación. Después comprobarás el código que recibiste
                  por separado.
                </p>
              </div>
              <button
                type="button"
                onClick={() => router.push('/')}
                aria-label="Cerrar"
                className="text-slate-500"
              >
                <X size={18} />
              </button>
            </div>
            <label className="mt-5 block text-sm font-medium text-slate-700">
              Correo electrónico
              <input
                type="email"
                autoComplete="email"
                autoFocus
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-2 w-full rounded-md border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-primary"
              />
            </label>
            {error && (
              <p role="alert" className="mt-3 text-sm text-red-600">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={!email.trim()}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
            >
              <ShieldCheck size={16} /> Continuar
            </button>
          </form>
        </div>
      )}
    </main>
  );
}
