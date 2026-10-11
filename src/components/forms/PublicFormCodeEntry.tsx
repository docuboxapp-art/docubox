'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, KeyRound, Loader2, Mail, ShieldCheck, X } from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';
import { createClient } from '@/lib/supabase/client';
import PublicFormMobileBiometricModal from './PublicFormMobileBiometricModal';

export default function PublicFormCodeEntry({ formId }: { formId?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const invitedEmail = searchParams.get('email') || '';
  const [email, setEmail] = useState(invitedEmail);
  const [sessionEmail, setSessionEmail] = useState('');
  const [identitySelected, setIdentitySelected] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const autoCheckedEmail = useRef(false);
  const [code, setCode] = useState('');
  const [codeVerified, setCodeVerified] = useState(false);
  const [checkingCode, setCheckingCode] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileError, setMobileError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);

  useEffect(() => {
    let active = true;
    void createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (active) {
          setSessionEmail(data.user?.email?.trim().toLowerCase() || '');
          setNeedsLogin(!data.user);
          setAuthChecking(false);
        }
      })
      .catch(() => {
        if (active) {
          setNeedsLogin(true);
          setAuthChecking(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const changeIdentity = () => {
    setCodeVerified(false);
    setMobileOpen(false);
    setIdentitySelected(false);
  };

  const checkEmail = useCallback(
    async (address: string) => {
      const normalized = address.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
        setError('Ingresa un correo electrónico válido.');
        return;
      }
      setCheckingEmail(true);
      setError('');
      try {
        const response = await fetch('/api/auth/check-login-options', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({ email: normalized }),
        });
        if (!response.ok) throw new Error('No se pudo consultar la cuenta. Inténtalo de nuevo.');
        const result: { found?: boolean } = await response.json();
        if (!result.found) {
          router.push(
            `/formulario-publico/registro?${new URLSearchParams({
              ...(formId ? { formId } : {}),
              email: normalized,
            })}`
          );
          return;
        }
        setEmail(normalized);
        setNeedsLogin(sessionEmail !== normalized);
        setIdentitySelected(true);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'No se pudo consultar la cuenta.');
      } finally {
        setCheckingEmail(false);
      }
    },
    [formId, router, sessionEmail]
  );

  useEffect(() => {
    if (authChecking || autoCheckedEmail.current || !invitedEmail.trim()) return;
    autoCheckedEmail.current = true;
    void checkEmail(invitedEmail);
  }, [authChecking, checkEmail, invitedEmail]);

  const continueWithEmail = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void checkEmail(email);
  };

  const verifyCode = async () => {
    if (!code.trim()) {
      setError('Ingresa el código que recibiste por correo.');
      return;
    }
    setCheckingCode(true);
    setError('');
    try {
      const {
        data: { session },
      } = await createClient().auth.getSession();
      if (!session || session.user.email?.trim().toLowerCase() !== email.trim().toLowerCase()) {
        setNeedsLogin(true);
        setError('Inicia sesión con el correo que acreditaste para continuar.');
        return;
      }
      const response = await fetch('/api/formularios/publico/verificar-codigo', {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ code, formId }),
      });
      const result = await response.json();
      if (!response.ok || result.valid !== true)
        throw new Error(result.error || 'El código no es válido.');
      setCodeVerified(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo comprobar el código.');
    } finally {
      setCheckingCode(false);
    }
  };

  const submit = async (mobileSessionToken: string) => {
    if (!codeVerified) return;
    setBusy(true);
    setMobileError('');
    try {
      const {
        data: { session },
      } = await createClient().auth.getSession();
      if (!session || session.user.email?.trim().toLowerCase() !== email.trim().toLowerCase()) {
        setMobileError('Inicia sesión con el correo que acreditaste para continuar.');
        return;
      }
      const response = await fetch(
        formId
          ? `/api/formularios/publico/${encodeURIComponent(formId)}/claim`
          : '/api/formularios/publico/claim',
        {
          method: 'POST',
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ code, mobileSessionToken }),
        }
      );
      const result = await response.json();
      if (!response.ok || !result.url)
        throw new Error(result.error || 'No se pudo abrir el formulario.');
      router.replace(result.url);
    } catch (cause) {
      setMobileError(cause instanceof Error ? cause.message : 'No se pudo abrir el formulario.');
    } finally {
      setBusy(false);
    }
  };

  const returnPath = formId
    ? `/formulario-publico/${formId}?email=${encodeURIComponent(email)}`
    : `/formulario-publico/codigo?email=${encodeURIComponent(email)}`;
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
        {identitySelected && authChecking ? (
          <p className="mt-6 flex items-center gap-2 text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin" /> Comprobando tu cuenta…
          </p>
        ) : identitySelected && needsLogin ? (
          <div className="mt-6 space-y-3">
            <p className="text-sm text-slate-600">
              Encontramos tu cuenta. Inicia sesión con <strong>{email}</strong> para continuar con
              la prueba de vida.
            </p>
            {sessionEmail && sessionEmail !== email && (
              <p className="text-xs text-amber-700">
                La sesión actual corresponde a otro correo. Cambia de cuenta para continuar.
              </p>
            )}
            <a
              href={`/login?redirect=${encodeURIComponent(returnPath)}&email=${encodeURIComponent(email)}`}
              className="inline-flex w-full justify-center rounded-md bg-primary px-4 py-3 text-sm font-medium text-white"
            >
              Iniciar sesión
            </a>
            <button type="button" onClick={changeIdentity} className="w-full text-sm text-primary">
              Usar otro correo
            </button>
          </div>
        ) : identitySelected ? (
          <>
            <div className="mt-6 flex items-center justify-between rounded-md bg-blue-50 px-3 py-2 text-sm text-slate-700">
              <span className="flex items-center gap-2">
                <Mail size={16} /> {email}
              </span>
              <button type="button" onClick={changeIdentity} className="text-primary">
                Cambiar
              </button>
            </div>
            <p className="mt-4 flex items-center gap-2 text-sm font-medium text-emerald-700">
              <CheckCircle2 size={17} /> Ya existe una cuenta con este correo.
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Comprueba el código recibido por separado. Cuando sea correcto, continúa con la
              captura móvil de identidad y prueba de vida.
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
                <CheckCircle2 size={17} /> Código correcto. Ya puedes continuar a la captura móvil.
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
            {codeVerified && (
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
                  {checkingEmail
                    ? 'Estamos comprobando si este correo ya tiene cuenta en Docubox.'
                    : 'Ingresa el correo con el que responderás el formulario. Buscaremos tu cuenta para indicarte el siguiente paso.'}
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
                disabled={checkingEmail}
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
              disabled={checkingEmail || authChecking}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
            >
              {checkingEmail ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <ShieldCheck size={16} />
              )}{' '}
              Continuar
            </button>
          </form>
        </div>
      )}
    </main>
  );
}
