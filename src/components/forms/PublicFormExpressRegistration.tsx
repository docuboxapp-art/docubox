'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, Loader2, ShieldCheck, UserPlus } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

type EnrollmentResult = {
  nombre?: string | null;
  apellido_paterno?: string | null;
  apellido_materno?: string | null;
  face_match_passed?: boolean;
};

export default function PublicFormExpressRegistration({
  email,
  formId,
  code,
  onRegistered,
}: {
  email: string;
  formId?: string;
  code: string;
  onRegistered: (enrollmentToken?: string) => void;
}) {
  const [personality, setPersonality] = useState<'fisica' | 'moral'>('fisica');
  const [enrollment, setEnrollment] = useState<{
    sessionId: string;
    token: string;
    url: string;
  } | null>(null);
  const [verified, setVerified] = useState<EnrollmentResult | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [cer, setCer] = useState<File | null>(null);
  const [key, setKey] = useState<File | null>(null);
  const [efirmaPassword, setEfirmaPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(
    () => () => {
      if (pollRef.current) clearInterval(pollRef.current);
    },
    []
  );

  async function startEnrollment() {
    setError('');
    setEnrolling(true);
    setVerified(null);
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
            setError('El enlace expiró. Genera uno nuevo.');
          } else if (statusResponse.ok && status.result) {
            if (pollRef.current) clearInterval(pollRef.current);
            if (status.result.face_match_passed !== true) {
              setEnrollment(null);
              setError('La identidad no fue aprobada. Repite la captura.');
            } else setVerified(status.result);
          }
        } catch {
          /* The next poll retries transient network failures. */
        }
      }, 3000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo iniciar el enrolamiento.');
    } finally {
      setEnrolling(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (password.length < 8 || password !== confirmation) {
      setError('La contraseña debe tener al menos 8 caracteres y coincidir.');
      return;
    }
    if (!accepted) {
      setError('Acepta los términos para crear tu cuenta personal.');
      return;
    }
    if (personality === 'fisica' && (!enrollment || !verified?.face_match_passed)) {
      setError('Completa el enrolamiento biométrico.');
      return;
    }
    if (personality === 'moral' && (!cer || !key || !efirmaPassword)) {
      setError('Carga la e.firma SAT completa.');
      return;
    }
    setSaving(true);
    try {
      const body = new FormData();
      body.set('email', email);
      body.set('code', code);
      body.set('formId', formId || '');
      body.set('password', password);
      body.set('personality', personality);
      body.set('accepted', String(accepted));
      if (personality === 'fisica') {
        body.set('enrollmentSessionId', enrollment!.sessionId);
        body.set('enrollmentToken', enrollment!.token);
      } else {
        body.set('cer', cer!);
        body.set('key', key!);
        body.set('efirmaPassword', efirmaPassword);
      }
      const response = await fetch('/api/formularios/publico/registro-express', {
        method: 'POST',
        cache: 'no-store',
        body,
      });
      const result = await response.json();
      if (!response.ok || !result.success)
        throw new Error(result.error || 'No se pudo crear la cuenta.');
      setPassword('');
      setConfirmation('');
      setEfirmaPassword('');
      onRegistered(personality === 'fisica' ? enrollment?.token : undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo crear la cuenta.');
    } finally {
      setSaving(false);
    }
  }

  const verifiedName = verified
    ? [verified.nombre, verified.apellido_paterno, verified.apellido_materno]
        .filter(Boolean)
        .join(' ')
    : '';
  return (
    <section className="mt-5 border-t border-slate-200 pt-5">
      <h2 className="flex items-center gap-2 text-base font-semibold text-slate-950">
        <UserPlus size={18} /> Alta express
      </h2>
      <p className="mt-1 text-sm leading-6 text-slate-600">
        Crea una cuenta personal sin salir del formulario. El correo de la invitación ya está
        precapturado.
      </p>
      <form onSubmit={(event) => void submit(event)} className="mt-4 space-y-4">
        <fieldset>
          <legend className="text-sm font-medium text-slate-700">Tipo de persona</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(['fisica', 'moral'] as const).map((value) => (
              <label
                key={value}
                className={`cursor-pointer rounded-md border px-3 py-3 text-sm ${personality === value ? 'border-primary bg-blue-50 text-primary' : 'border-slate-200 text-slate-700'}`}
              >
                <input
                  type="radio"
                  name="personality"
                  value={value}
                  checked={personality === value}
                  onChange={() => setPersonality(value)}
                  className="mr-2 accent-primary"
                />
                Persona {value === 'fisica' ? 'física' : 'moral'}
              </label>
            ))}
          </div>
        </fieldset>
        {personality === 'fisica' ? (
          <div className="rounded-md border border-slate-200 p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-slate-800">
              <ShieldCheck size={16} /> Identificación y selfie
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              Captura tu identificación y prueba de vida. Tus datos se completarán con el resultado
              aprobado.
            </p>
            {verified?.face_match_passed ? (
              <p role="status" className="mt-3 flex items-center gap-2 text-sm text-emerald-700">
                <CheckCircle2 size={16} /> Identidad acreditada
                {verifiedName ? `: ${verifiedName}` : ''}.
              </p>
            ) : (
              enrollment && (
                <div className="mt-3 flex flex-col items-center gap-2">
                  <QRCodeSVG value={enrollment.url} size={154} />
                  <a
                    href={enrollment.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary underline"
                  >
                    Abrir captura en este dispositivo
                  </a>
                  <span role="status" className="text-xs text-slate-500">
                    Esperando verificación…
                  </span>
                </div>
              )
            )}
            <button
              type="button"
              onClick={() => void startEnrollment()}
              disabled={enrolling}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-md border border-primary px-3 py-2.5 text-sm font-medium text-primary disabled:opacity-50"
            >
              {enrolling && <Loader2 size={16} className="animate-spin" />}
              {enrollment ? 'Generar nuevo QR' : 'Iniciar enrolamiento'}
            </button>
          </div>
        ) : (
          <div className="space-y-3 rounded-md border border-slate-200 p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-slate-800">
              <ShieldCheck size={16} /> e.firma SAT de la persona moral
            </p>
            <p className="text-xs leading-5 text-slate-600">
              Validaremos la vigencia del certificado y que la llave privada le corresponda. El RFC
              y la razón social se precapturarán del certificado.
            </p>
            <label className="block text-sm text-slate-700">
              Certificado .cer
              <input
                type="file"
                accept=".cer"
                required
                onChange={(event) => setCer(event.target.files?.[0] || null)}
                className="mt-1 block w-full text-xs"
              />
            </label>
            <label className="block text-sm text-slate-700">
              Llave privada .key
              <input
                type="file"
                accept=".key"
                required
                onChange={(event) => setKey(event.target.files?.[0] || null)}
                className="mt-1 block w-full text-xs"
              />
            </label>
            <label className="block text-sm text-slate-700">
              Contraseña de la e.firma
              <input
                type="password"
                value={efirmaPassword}
                required
                onChange={(event) => setEfirmaPassword(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2.5 text-sm"
              />
            </label>
          </div>
        )}
        <label className="block text-sm text-slate-700">
          Crea una contraseña
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={8}
            className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2.5 text-sm"
          />
        </label>
        <label className="block text-sm text-slate-700">
          Confirma la contraseña
          <input
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            required
            minLength={8}
            className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2.5 text-sm"
          />
        </label>
        <label className="flex items-start gap-2 text-xs leading-5 text-slate-600">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(event) => setAccepted(event.target.checked)}
            className="mt-1 accent-primary"
          />
          <span>
            Acepto los{' '}
            <a href="/terminos-condiciones" target="_blank" className="text-primary underline">
              términos
            </a>{' '}
            y la{' '}
            <a href="/politica-privacidad" target="_blank" className="text-primary underline">
              política de privacidad
            </a>
            .
          </span>
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={saving || (personality === 'fisica' && !verified?.face_match_passed)}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving && <Loader2 size={16} className="animate-spin" />} Crear cuenta personal y
          continuar
        </button>
      </form>
    </section>
  );
}
