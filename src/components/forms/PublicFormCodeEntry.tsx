'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { Camera, KeyRound, Loader2, Mail, ShieldCheck, X } from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';
import { createClient } from '@/lib/supabase/client';

export default function PublicFormCodeEntry({ formId }: { formId?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const invitedEmail = searchParams.get('email') || '';
  const [email, setEmail] = useState(invitedEmail);
  const [sessionEmail, setSessionEmail] = useState('');
  const [identitySelected, setIdentitySelected] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const autoCheckedEmail = useRef(false);
  const [code, setCode] = useState('');
  const [selfie, setSelfie] = useState('');
  const [cameraOn, setCameraOn] = useState(false);
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

  useEffect(() => {
    return () => {
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const changeIdentity = () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setCameraOn(false);
    setSelfie('');
    setIdentitySelected(false);
  };

  useEffect(() => {
    if (cameraOn && video.current && stream.current) {
      video.current.srcObject = stream.current;
      void video.current.play();
    }
  }, [cameraOn]);

  const startCamera = async () => {
    setError('');
    try {
      stream.current?.getTracks().forEach((track) => track.stop());
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });
      stream.current = media;
      setCameraOn(true);
      setSelfie('');
    } catch {
      setError('No se pudo abrir la cámara. Permite su acceso para completar la prueba de vida.');
    }
  };

  const checkEmail = useCallback(async (address: string) => {
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
  }, [formId, router, sessionEmail]);

  useEffect(() => {
    if (authChecking || autoCheckedEmail.current || !invitedEmail.trim()) return;
    autoCheckedEmail.current = true;
    void checkEmail(invitedEmail);
  }, [authChecking, checkEmail, invitedEmail]);

  const continueWithEmail = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void checkEmail(email);
  };

  const capture = () => {
    const element = video.current;
    if (!element?.videoWidth || !element.videoHeight) return;
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(element.videoWidth, 960);
    canvas.height = Math.round((element.videoHeight * canvas.width) / element.videoWidth);
    canvas.getContext('2d')?.drawImage(element, 0, 0, canvas.width, canvas.height);
    setSelfie(canvas.toDataURL('image/jpeg', 0.82));
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setCameraOn(false);
  };

  const submit = async () => {
    if (!code.trim() || !selfie) {
      setError('Ingresa tu código y captura una selfie.');
      return;
    }
    setBusy(true);
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
          body: JSON.stringify({ code, selfie }),
        }
      );
      const result = await response.json();
      if (!response.ok || !result.url)
        throw new Error(result.error || 'No se pudo abrir el formulario.');
      router.replace(result.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo abrir el formulario.');
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
          Identifícate con tu correo. Si ya tienes cuenta, realiza la prueba de vida y usa el código
          que recibiste por separado para abrir el formulario.
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
            <h2 className="mt-5 text-base font-semibold text-slate-900">Prueba de vida</h2>
            <p className="mt-1 text-sm text-slate-600">
              Como en la firma autógrafa, captura una selfie en tiempo real. El servicio verificará
              la prueba de vida y, si tienes una identificación registrada, comparará tu rostro con
              ella.
            </p>
            <label className="mt-6 block text-sm font-medium text-slate-700">
              Código de acceso
              <input
                autoComplete="off"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="DBX-..."
                className="mt-2 w-full rounded-md border border-slate-200 px-3 py-3 font-mono text-sm uppercase outline-none focus:border-primary"
              />
            </label>
            <div className="mt-5 overflow-hidden rounded-md border border-slate-200 bg-slate-100">
              {cameraOn && (
                <video
                  ref={video}
                  autoPlay
                  muted
                  playsInline
                  className="aspect-video w-full object-cover"
                />
              )}
              {!cameraOn && selfie && (
                <Image
                  src={selfie}
                  alt="Selfie capturada"
                  width={960}
                  height={540}
                  unoptimized
                  className="aspect-video w-full object-cover"
                />
              )}
              {!cameraOn && !selfie && (
                <div className="flex aspect-video items-center justify-center gap-2 text-sm text-slate-500">
                  <Camera size={19} /> Cámara pendiente
                </div>
              )}
            </div>
            {cameraOn ? (
              <button
                type="button"
                onClick={capture}
                className="mt-3 w-full rounded-md border border-primary px-4 py-2.5 text-sm font-medium text-primary"
              >
                Capturar selfie
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void startCamera()}
                className="mt-3 w-full rounded-md border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700"
              >
                {selfie ? 'Repetir captura' : 'Activar cámara'}
              </button>
            )}
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || !selfie || !code.trim()}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}{' '}
              Acreditar identidad y acceder
            </button>
          </>
        ) : null}
        {error && (
          <p role="alert" className="mt-4 text-sm text-red-600">
            {error}
          </p>
        )}
      </section>
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
