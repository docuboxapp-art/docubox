'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { Camera, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';
import { createClient } from '@/lib/supabase/client';

export default function PublicFormCodeEntry({ formId }: { formId?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const invitedEmail = searchParams.get('email') || '';
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
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
      if (!session) {
        setNeedsLogin(true);
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

  const returnPath = formId ? `/formulario-publico/${formId}${invitedEmail ? `?email=${encodeURIComponent(invitedEmail)}` : ''}` : '/formulario-publico/codigo';
  const registrationPath = `/formulario-publico/registro?${new URLSearchParams({
    ...(formId ? { formId } : {}), ...(invitedEmail ? { email: invitedEmail } : {}),
  }).toString()}`;
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <section className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-7 shadow-sm sm:p-9">
        <AppLogo />
        <span className="mt-8 inline-flex items-center gap-2 rounded-md bg-blue-50 px-3 py-1.5 text-xs font-medium text-primary">
          <KeyRound size={15} /> Acceso a formulario público
        </span>
        <h1 className="mt-4 text-2xl font-semibold text-slate-950">Tengo un código de acceso</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Ingresa el código compartido contigo. Para abrir el formulario se verificará tu prueba de
          vida con una selfie.
        </p>
        {authChecking ? (
          <p className="mt-6 flex items-center gap-2 text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin" /> Comprobando tu cuenta…
          </p>
        ) : needsLogin ? (
          <div className="mt-6 space-y-3">
            <a href={`/login?redirect=${encodeURIComponent(returnPath)}${invitedEmail ? `&email=${encodeURIComponent(invitedEmail)}` : ''}`} className="inline-flex w-full justify-center rounded-md bg-primary px-4 py-3 text-sm font-medium text-white">Acceder con mi cuenta</a>
            <a href={registrationPath} className="inline-flex w-full justify-center rounded-md border border-primary px-4 py-3 text-sm font-medium text-primary">Crear cuenta para responder</a>
            <p className="text-xs leading-5 text-slate-500">Si recibiste la invitación y aún no tienes cuenta, regístrate con ese mismo correo. Después de verificarlo podrás ingresar el código.</p>
          </div>
        ) : (
          <>
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
              Verificar y acceder
            </button>
          </>
        )}
        {error && (
          <p role="alert" className="mt-4 text-sm text-red-600">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
