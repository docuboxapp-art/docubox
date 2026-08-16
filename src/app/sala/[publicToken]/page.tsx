'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  LockKeyhole,
  ShieldCheck,
} from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';

type RoomData = {
  room: {
    name: string;
    purpose: string | null;
    expires_at: string;
    terms_required: boolean;
    downloads_allowed: boolean;
    watermark_enabled: boolean;
  };
  guest: { name: string; email: string; terms_accepted: boolean };
  authenticated: boolean;
  resources?: Array<{
    id: string;
    display_name: string | null;
    resource_type: string;
    permissions: Record<string, boolean>;
  }>;
};

export default function PublicCollaborationRoomPage({
  params,
}: {
  params: Promise<{ publicToken: string }>;
}) {
  const [token, setToken] = useState('');
  const [data, setData] = useState<RoomData | null>(null);
  const [session, setSession] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    params.then((value) => {
      setToken(value.publicToken);
      setSession(sessionStorage.getItem(`docubox-room:${value.publicToken}`) || '');
    });
  }, [params]);
  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const response = await fetch(`/api/public/colabora/rooms/${token}`, {
      headers: session ? { 'x-colabora-session': session } : {},
      cache: 'no-store',
    });
    const payload = await response.json();
    if (response.ok) {
      setData(payload);
      if (session && !payload.authenticated) {
        sessionStorage.removeItem(`docubox-room:${token}`);
        setSession('');
      }
    } else setError(payload.error);
    setLoading(false);
  }, [session, token]);
  useEffect(() => {
    load();
  }, [load]);
  const requestOtp = async () => {
    setSending(true);
    setError('');
    const response = await fetch(`/api/public/colabora/rooms/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'request_otp' }),
    });
    const payload = await response.json();
    if (response.ok) setChallengeId(payload.challenge_id);
    else setError(payload.error);
    setSending(false);
  };
  const verify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSending(true);
    setError('');
    const code = String(new FormData(event.currentTarget).get('code') || '');
    const response = await fetch(`/api/public/colabora/rooms/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify_otp', challenge_id: challengeId, code }),
    });
    const payload = await response.json();
    if (response.ok) {
      sessionStorage.setItem(`docubox-room:${token}`, payload.session_token);
      setSession(payload.session_token);
    } else setError(payload.error);
    setSending(false);
  };
  const openResource = async (resourceId: string, download = false) => {
    setSending(true);
    setError('');
    const popup = download ? null : window.open('', '_blank', 'noopener,noreferrer');
    try {
      const response = await fetch(
        `/api/public/colabora/rooms/${token}/resources/${resourceId}${download ? '?download=1' : ''}`,
        { headers: { 'x-colabora-session': session }, cache: 'no-store' }
      );
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || 'No se pudo abrir el recurso.');
      }
      const url = URL.createObjectURL(await response.blob());
      if (download) {
        const link = document.createElement('a');
        link.href = url;
        link.download = 'documento.pdf';
        link.click();
      } else if (popup) popup.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) {
      popup?.close();
      setError(cause instanceof Error ? cause.message : 'No se pudo abrir el recurso.');
    } finally {
      setSending(false);
    }
  };
  const acceptTerms = async () => {
    setSending(true);
    setError('');
    const response = await fetch(`/api/public/colabora/rooms/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'accept_terms', session_token: session }),
    });
    const payload = await response.json();
    if (response.ok) await load();
    else setError(payload.error || 'No se pudieron aceptar los terminos.');
    setSending(false);
  };
  return (
    <div className="min-h-screen bg-[#f6f8fb] px-4 py-8 text-[#18181b]">
      <div className="mx-auto max-w-4xl">
        <header className="flex items-center justify-between">
          <AppLogo className="h-9 w-auto" />
          <span className="inline-flex items-center gap-2 text-xs text-[#52525b]">
            <ShieldCheck size={15} className="text-[#1E6BFF]" /> Acceso seguro
          </span>
        </header>
        {loading ? (
          <div className="min-h-[560px] grid place-items-center">
            <Loader2 className="animate-spin text-[#1E6BFF]" />
          </div>
        ) : data ? (
          <main className="mt-8 overflow-hidden rounded-lg border border-[#EBEBF0] bg-white">
            <div className="border-b border-[#EBEBF0] p-6 sm:p-8">
              <p className="text-xs font-medium uppercase text-[#1E6BFF]">Docubox Colabora</p>
              <h1 className="mt-2 text-2xl font-medium">{data.room.name}</h1>
              <p className="mt-2 text-sm leading-6 text-[#52525b]">
                {data.room.purpose ||
                  `Hola, ${data.guest.name}. Revisa los recursos compartidos contigo.`}
              </p>
            </div>
            {!data.authenticated ? (
              <div className="mx-auto max-w-lg p-6 sm:p-8">
                <div className="flex h-11 w-11 items-center justify-center rounded-md bg-blue-50 text-[#1E6BFF]">
                  <LockKeyhole size={22} />
                </div>
                <h2 className="mt-4 text-lg font-medium">Confirma tu correo</h2>
                <p className="mt-1 text-sm leading-6 text-[#52525b]">
                  Enviaremos un código de 6 dígitos a{' '}
                  {data.guest.email.replace(/(^.).*(@.*$)/, '$1••••$2')}.
                </p>
                {error && (
                  <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    {error}
                  </div>
                )}
                {challengeId ? (
                  <form onSubmit={verify} className="mt-5">
                    <label className="text-sm font-medium">
                      Código de acceso
                      <input
                        autoFocus
                        required
                        name="code"
                        inputMode="numeric"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        className="mt-2 h-12 w-full rounded-md border border-[#EBEBF0] px-4 text-center text-xl tracking-[0.35em] outline-none focus:border-[#1E6BFF]"
                      />
                    </label>
                    <button
                      disabled={sending}
                      className="mt-4 h-11 w-full rounded-md bg-[#1E6BFF] text-sm font-medium text-white"
                    >
                      Validar y entrar
                    </button>
                  </form>
                ) : (
                  <button
                    disabled={sending}
                    onClick={requestOtp}
                    className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#1E6BFF] text-sm font-medium text-white"
                  >
                    {sending && <Loader2 size={16} className="animate-spin" />} Enviar código
                  </button>
                )}
              </div>
            ) : data.room.terms_required && !data.guest.terms_accepted ? (
              <div className="mx-auto max-w-xl p-6 sm:p-8">
                <div className="flex h-11 w-11 items-center justify-center rounded-md bg-blue-50 text-[#1E6BFF]">
                  <ShieldCheck size={22} />
                </div>
                <h2 className="mt-4 text-lg font-medium">Condiciones de acceso</h2>
                <p className="mt-2 text-sm leading-6 text-[#52525b]">
                  Los recursos de esta sala son confidenciales. Tu acceso, consultas y descargas
                  quedan registrados como evidencia de colaboracion.
                </p>
                {error && (
                  <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    {error}
                  </div>
                )}
                <button
                  disabled={sending}
                  onClick={acceptTerms}
                  className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#1E6BFF] text-sm font-medium text-white disabled:opacity-60"
                >
                  {sending && <Loader2 size={16} className="animate-spin" />} Aceptar y continuar
                </button>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-3 border-b border-[#EBEBF0] bg-emerald-50 px-6 py-4 text-sm text-emerald-700">
                  <CheckCircle2 size={18} /> Identidad de acceso confirmada
                </div>
                <div className="divide-y divide-[#EBEBF0]">
                  {data.resources?.map((resource) => (
                    <div key={resource.id} className="flex items-center gap-4 px-6 py-4">
                      <div className="grid h-10 w-10 place-items-center rounded-md bg-blue-50 text-[#1E6BFF]">
                        <FileText size={19} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {resource.display_name || 'Recurso compartido'}
                        </p>
                        <p className="mt-0.5 text-xs capitalize text-[#52525b]">
                          {resource.resource_type.replaceAll('_', ' ')}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          disabled={sending}
                          onClick={() => openResource(resource.id)}
                          className="inline-flex h-9 items-center gap-2 rounded-md border border-[#EBEBF0] px-3 text-xs font-medium text-[#18181b] hover:bg-[#f8f8fb]"
                        >
                          <ExternalLink size={14} /> Abrir
                        </button>
                        {data.room.downloads_allowed && resource.permissions.download && (
                          <button
                            disabled={sending}
                            onClick={() => openResource(resource.id, true)}
                            title="Descargar recurso"
                            className="grid h-9 w-9 place-items-center rounded-md border border-[#EBEBF0] text-[#52525b] hover:bg-[#f8f8fb]"
                          >
                            <Download size={15} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {!data.resources?.length && (
                    <div className="p-12 text-center text-sm text-[#52525b]">
                      Aún no hay recursos publicados en esta sala.
                    </div>
                  )}
                </div>
              </div>
            )}
          </main>
        ) : (
          <div className="mt-10 rounded-lg border border-red-200 bg-white p-8 text-center text-sm text-red-700">
            {error || 'Acceso no disponible.'}
          </div>
        )}
        <footer className="py-8 text-center text-xs text-[#71717a]">
          Docubox · El acceso y las acciones quedan registrados.
        </footer>
      </div>
    </div>
  );
}
