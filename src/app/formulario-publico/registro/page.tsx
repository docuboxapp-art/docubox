'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Loader2, UserPlus } from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';

function PublicFormRegistration() {
  const params = useSearchParams();
  const formId = params.get('formId') || '';
  const invitedEmail = params.get('email') || '';
  const returnPath = /^[0-9a-f-]{36}$/i.test(formId)
    ? `/formulario-publico/${formId}?email=${encodeURIComponent(invitedEmail)}`
    : '/formulario-publico/codigo';
  const [name, setName] = useState('');
  const [email, setEmail] = useState(invitedEmail);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || password.length < 8 || password !== confirmPassword || !accepted) {
      setError('Completa tus datos, confirma la contraseña de al menos 8 caracteres y acepta los términos.');
      return;
    }
    if (invitedEmail && email.trim().toLowerCase() !== invitedEmail.trim().toLowerCase()) {
      setError('Regístrate con el correo al que llegó la invitación.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/registro/register-user', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password, fullName: name.trim(),
          accountType: 'personal', personalidadJuridica: 'fisica', identityMethod: null }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'No se pudo crear la cuenta.');
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo crear la cuenta.');
    } finally {
      setBusy(false);
    }
  };

  return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
    <section className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-7 shadow-sm sm:p-9">
      <AppLogo />
      {done ? <>
        <h1 className="mt-8 text-2xl font-semibold text-slate-950">Revisa tu correo</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">Enviamos un mensaje de verificación a <strong>{email}</strong>. Confirma tu correo, inicia sesión y regresa al formulario para ingresar el código que recibiste por separado.</p>
        <a href={`/login?redirect=${encodeURIComponent(returnPath)}&email=${encodeURIComponent(email)}`} className="mt-6 flex justify-center rounded-md bg-primary px-4 py-3 text-sm font-medium text-white">Iniciar sesión después de verificar</a>
      </> : <>
        <a href={returnPath} className="mt-8 inline-flex items-center gap-2 text-sm text-slate-600"><ArrowLeft size={15} /> Volver al formulario</a>
        <h1 className="mt-5 flex items-center gap-2 text-2xl font-semibold text-slate-950"><UserPlus size={23} /> Crear cuenta para responder</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Solo necesitamos tu nombre, correo y contraseña. Después verificarás tu correo y completarás una prueba de vida para abrir el formulario.</p>
        <form onSubmit={(event) => void submit(event)} className="mt-6 space-y-4">
          <label className="block text-sm font-medium text-slate-700">Nombre completo<input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={160} className="mt-1.5 w-full rounded-md border border-slate-200 px-3 py-2.5 text-sm" /></label>
          <label className="block text-sm font-medium text-slate-700">Correo de la invitación<input type="email" autoComplete="email" value={email} readOnly={Boolean(invitedEmail)} onChange={(event) => setEmail(event.target.value)} required className="mt-1.5 w-full rounded-md border border-slate-200 px-3 py-2.5 text-sm read-only:bg-slate-50" /></label>
          <label className="block text-sm font-medium text-slate-700">Contraseña<input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} className="mt-1.5 w-full rounded-md border border-slate-200 px-3 py-2.5 text-sm" /></label>
          <label className="block text-sm font-medium text-slate-700">Confirmar contraseña<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={8} className="mt-1.5 w-full rounded-md border border-slate-200 px-3 py-2.5 text-sm" /></label>
          <label className="flex items-start gap-2 text-xs leading-5 text-slate-600"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} className="mt-1 accent-primary" /> <span>Acepto los <a href="/terminos-condiciones" target="_blank" className="text-primary underline">términos y condiciones</a> y la <a href="/politica-privacidad" target="_blank" className="text-primary underline">política de privacidad</a>.</span></label>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 text-sm font-medium text-white disabled:opacity-50">{busy && <Loader2 size={16} className="animate-spin" />} Crear cuenta</button>
        </form>
        <a href={`/login?redirect=${encodeURIComponent(returnPath)}&email=${encodeURIComponent(email)}`} className="mt-4 block text-center text-sm text-primary">Ya tengo cuenta</a>
      </>}
    </section>
  </main>;
}

export default function PublicFormRegistrationPage() {
  return <Suspense fallback={null}><PublicFormRegistration /></Suspense>;
}
