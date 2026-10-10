'use client';

import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Loader2, ShieldCheck, UserPlus } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import AppLogo from '@/components/ui/AppLogo';

function PublicFormRegistration() {
  const params = useSearchParams();
  const formId = params.get('formId') || '';
  const invitedEmail = params.get('email') || '';
  const returnPath = /^[0-9a-f-]{36}$/i.test(formId)
    ? `/formulario-publico/${formId}?email=${encodeURIComponent(invitedEmail)}`
    : `/formulario-publico/codigo?email=${encodeURIComponent(invitedEmail)}`;
  const [name, setName] = useState('');
  const [email, setEmail] = useState(invitedEmail);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [enrollment, setEnrollment] = useState<{
    sessionId: string;
    token: string;
    url: string;
  } | null>(null);
  const [enrollmentResult, setEnrollmentResult] = useState<{
    nombre: string | null;
    apellido_paterno: string | null;
    apellido_materno: string | null;
    curp: string | null;
    rfc: string | null;
    fecha_nacimiento: string | null;
    sexo: string | null;
    tipo_identificacion: string | null;
    face_match_passed: boolean;
  } | null>(null);
  const [enrollmentBusy, setEnrollmentBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (pollRef.current) clearInterval(pollRef.current);
    },
    []
  );

  const beginEnrollment = async () => {
    setEnrollmentBusy(true);
    setError('');
    setEnrollmentResult(null);
    if (pollRef.current) clearInterval(pollRef.current);
    try {
      const sessionId = crypto.randomUUID();
      const response = await fetch('/api/enrollment/create-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      const result = await response.json();
      if (!response.ok || !result.success)
        throw new Error(result.error || 'No se pudo iniciar el enrolamiento.');
      setEnrollment({ sessionId, token: result.token, url: result.enrollmentUrl });
      pollRef.current = setInterval(async () => {
        try {
          const statusResponse = await fetch(
            `/api/enrollment/status?token=${encodeURIComponent(result.token)}&session_id=${encodeURIComponent(sessionId)}`,
            { cache: 'no-store' }
          );
          const status = await statusResponse.json();
          if (statusResponse.status === 410 || status.status === 'expired') {
            if (pollRef.current) clearInterval(pollRef.current);
            setEnrollment(null);
            setError('El enlace de enrolamiento expiró. Genera uno nuevo.');
          } else if (statusResponse.ok && status.result) {
            if (pollRef.current) clearInterval(pollRef.current);
            if (status.result.face_match_passed !== true) {
              setEnrollment(null);
              setError('No se pudo acreditar la identidad. Repite el enrolamiento.');
              return;
            }
            setEnrollmentResult(status.result);
            const verifiedName = [
              status.result.nombre,
              status.result.apellido_paterno,
              status.result.apellido_materno,
            ]
              .filter(Boolean)
              .join(' ');
            if (verifiedName) setName(verifiedName);
          }
        } catch {
          /* El siguiente sondeo volverá a intentarlo. */
        }
      }, 3000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo iniciar el enrolamiento.');
    } finally {
      setEnrollmentBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (
      !name.trim() ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      password.length < 8 ||
      password !== confirmPassword ||
      !accepted
    ) {
      setError(
        'Completa tus datos, confirma la contraseña de al menos 8 caracteres y acepta los términos.'
      );
      return;
    }
    if (invitedEmail && email.trim().toLowerCase() !== invitedEmail.trim().toLowerCase()) {
      setError('Regístrate con el correo al que llegó la invitación.');
      return;
    }
    if (!enrollment || !enrollmentResult?.face_match_passed) {
      setError('Completa el enrolamiento biométrico antes de crear la cuenta.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/registro/register-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          fullName:
            [
              enrollmentResult.nombre,
              enrollmentResult.apellido_paterno,
              enrollmentResult.apellido_materno,
            ]
              .filter(Boolean)
              .join(' ') || name.trim(),
          nombre: enrollmentResult.nombre,
          apellidoPaterno: enrollmentResult.apellido_paterno,
          apellidoMaterno: enrollmentResult.apellido_materno,
          curp: enrollmentResult.curp,
          rfc: enrollmentResult.rfc,
          fechaNacimiento: enrollmentResult.fecha_nacimiento,
          sexo: enrollmentResult.sexo,
          tipoIdentificacion: enrollmentResult.tipo_identificacion,
          documentType1: 'biometrico',
          documentType2: 'curp',
          enrollmentSessionId: enrollment.sessionId,
          accountType: 'personal',
          personalidadJuridica: 'fisica',
          identityMethod: 'biometrico',
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success)
        throw new Error(result.error || 'No se pudo crear la cuenta.');
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo crear la cuenta.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <section className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-7 shadow-sm sm:p-9">
        <AppLogo />
        {done ? (
          <>
            <h1 className="mt-8 text-2xl font-semibold text-slate-950">Revisa tu correo</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Enviamos un mensaje de verificación a <strong>{email}</strong>. Confirma tu correo,
              inicia sesión y regresa al formulario para ingresar el código que recibiste por
              separado.
            </p>
            <a
              href={`/login?redirect=${encodeURIComponent(returnPath)}&email=${encodeURIComponent(email)}`}
              className="mt-6 flex justify-center rounded-md bg-primary px-4 py-3 text-sm font-medium text-white"
            >
              Iniciar sesión después de verificar
            </a>
          </>
        ) : (
          <>
            <a
              href={returnPath}
              className="mt-8 inline-flex items-center gap-2 text-sm text-slate-600"
            >
              <ArrowLeft size={15} /> Volver al formulario
            </a>
            <h1 className="mt-5 flex items-center gap-2 text-2xl font-semibold text-slate-950">
              <UserPlus size={23} /> Enrolamiento para el formulario
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Completa tus datos y acredita tu identidad con el mismo enrolamiento biométrico del
              registro de usuario. Después verifica tu correo para ingresar.
            </p>
            <form onSubmit={(event) => void submit(event)} className="mt-6 space-y-4">
              <label className="block text-sm font-medium text-slate-700">
                Nombre completo
                <input
                  autoComplete="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  maxLength={160}
                  className="mt-1.5 w-full rounded-md border border-slate-200 px-3 py-2.5 text-sm"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Correo electrónico
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  readOnly={Boolean(invitedEmail)}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  className="mt-1.5 w-full rounded-md border border-slate-200 px-3 py-2.5 text-sm read-only:bg-slate-50"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Contraseña
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  minLength={8}
                  className="mt-1.5 w-full rounded-md border border-slate-200 px-3 py-2.5 text-sm"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Confirmar contraseña
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                  minLength={8}
                  className="mt-1.5 w-full rounded-md border border-slate-200 px-3 py-2.5 text-sm"
                />
              </label>
              <label className="flex items-start gap-2 text-xs leading-5 text-slate-600">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(event) => setAccepted(event.target.checked)}
                  className="mt-1 accent-primary"
                />{' '}
                <span>
                  Acepto los{' '}
                  <a
                    href="/terminos-condiciones"
                    target="_blank"
                    className="text-primary underline"
                  >
                    términos y condiciones
                  </a>{' '}
                  y la{' '}
                  <a href="/politica-privacidad" target="_blank" className="text-primary underline">
                    política de privacidad
                  </a>
                  .
                </span>
              </label>
              <div className="rounded-md border border-slate-200 p-4">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <ShieldCheck size={17} /> Acreditación biométrica
                </h2>
                {enrollmentResult?.face_match_passed ? (
                  <div className="mt-2 space-y-2">
                    <p className="text-sm text-emerald-700">
                      Identidad acreditada. Ya puedes crear tu cuenta.
                    </p>
                    <button
                      type="button"
                      onClick={() => void beginEnrollment()}
                      className="text-xs text-primary underline"
                    >
                      Repetir enrolamiento
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="mt-2 text-xs leading-5 text-slate-600">
                      Captura tu identificación y selfie desde tu teléfono, como en el registro de
                      usuario.
                    </p>
                    {enrollment && (
                      <div className="mt-4 flex flex-col items-center gap-3">
                        <QRCodeSVG value={enrollment.url} size={160} level="M" />
                        <a
                          href={enrollment.url}
                          target="_blank"
                          rel="noreferrer"
                          className="break-all text-center text-xs text-primary underline"
                        >
                          Abrir enrolamiento en este dispositivo
                        </a>
                        <p className="text-xs text-slate-500">
                          Esperando el resultado de la verificación…
                        </p>
                      </div>
                    )}
                    <button
                      type="button"
                      disabled={enrollmentBusy}
                      onClick={() => void beginEnrollment()}
                      className="mt-3 flex w-full items-center justify-center gap-2 rounded-md border border-primary px-3 py-2.5 text-sm font-medium text-primary disabled:opacity-50"
                    >
                      {enrollmentBusy && <Loader2 size={16} className="animate-spin" />}
                      {enrollment ? 'Generar nuevo código QR' : 'Iniciar enrolamiento'}
                    </button>
                  </>
                )}
              </div>
              {error && (
                <p role="alert" className="text-sm text-red-600">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={busy || !enrollmentResult?.face_match_passed}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
              >
                {busy && <Loader2 size={16} className="animate-spin" />} Crear cuenta
              </button>
            </form>
            <a
              href={`/login?redirect=${encodeURIComponent(returnPath)}&email=${encodeURIComponent(email)}`}
              className="mt-4 block text-center text-sm text-primary"
            >
              Ya tengo cuenta
            </a>
          </>
        )}
      </section>
    </main>
  );
}

export default function PublicFormRegistrationPage() {
  return (
    <Suspense fallback={null}>
      <PublicFormRegistration />
    </Suspense>
  );
}
