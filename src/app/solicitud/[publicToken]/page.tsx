'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  FileCheck2,
  FileText,
  Loader2,
  LockKeyhole,
  Send,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';

type RequestItem = {
  id: string;
  item_type: string;
  title: string;
  description: string | null;
  required: boolean;
  status: string;
  rejection_reason: string | null;
  validation_status: string;
  files: Array<{
    id: string;
    original_name: string;
    byte_size: number;
    malware_scan_status: string;
    version: number;
    received_at: string;
  }>;
};

type RequestData = {
  authenticated: boolean;
  recipient_name?: string;
  request: {
    folio: string;
    title: string;
    description: string | null;
    due_at: string | null;
    status: string;
  };
  items?: RequestItem[];
};

function bytes(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export default function PublicDocumentRequestPage({
  params,
}: {
  params: Promise<{ publicToken: string }>;
}) {
  const [token, setToken] = useState('');
  const [session, setSession] = useState('');
  const [data, setData] = useState<RequestData | null>(null);
  const [challengeId, setChallengeId] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    params.then(({ publicToken }) => {
      setToken(publicToken);
      setSession(sessionStorage.getItem(`docubox-request:${publicToken}`) || '');
    });
  }, [params]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/public/colabora/requests/${token}`, {
        headers: session ? { 'x-colabora-session': session } : {},
        cache: 'no-store',
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'No se pudo abrir la solicitud.');
      setData(payload);
      if (session && !payload.authenticated) {
        sessionStorage.removeItem(`docubox-request:${token}`);
        setSession('');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo abrir la solicitud.');
    } finally {
      setLoading(false);
    }
  }, [session, token]);

  useEffect(() => {
    load();
  }, [load]);

  const requestOtp = async () => {
    setWorking('otp');
    setError('');
    try {
      const response = await fetch(`/api/public/colabora/requests/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request_otp' }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'No se pudo enviar el codigo.');
      setChallengeId(payload.challenge_id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo enviar el codigo.');
    } finally {
      setWorking('');
    }
  };

  const verifyOtp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setWorking('verify');
    setError('');
    try {
      const code = String(new FormData(event.currentTarget).get('code') || '');
      const response = await fetch(`/api/public/colabora/requests/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify_otp', challenge_id: challengeId, code }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'El codigo no es valido.');
      sessionStorage.setItem(`docubox-request:${token}`, payload.session_token);
      setSession(payload.session_token);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'El codigo no es valido.');
    } finally {
      setWorking('');
    }
  };

  const uploadFile = async (itemId: string, file: File | null) => {
    if (!file) return;
    setWorking(itemId);
    setError('');
    try {
      const formData = new FormData();
      formData.set('item_id', itemId);
      formData.set('file', file);
      const response = await fetch(`/api/public/colabora/requests/${token}/upload`, {
        method: 'POST',
        headers: { 'x-colabora-session': session },
        body: formData,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'No se pudo cargar el archivo.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar el archivo.');
    } finally {
      setWorking('');
    }
  };

  const submitRequest = async () => {
    setWorking('submit');
    setError('');
    try {
      const response = await fetch(`/api/public/colabora/requests/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-colabora-session': session },
        body: JSON.stringify({ action: 'submit' }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'No se pudo enviar la solicitud.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo enviar la solicitud.');
    } finally {
      setWorking('');
    }
  };

  const requiredComplete = useMemo(
    () =>
      (data?.items || []).every(
        (item) =>
          !item.required || ['uploaded', 'in_review', 'approved', 'waived'].includes(item.status)
      ),
    [data?.items]
  );
  const locked = ['in_review', 'completed'].includes(data?.request.status || '');

  return (
    <div className="min-h-screen bg-[#f6f8fb] px-4 py-6 text-[#18181b] sm:py-10">
      <div className="mx-auto max-w-4xl">
        <header className="flex items-center justify-between">
          <AppLogo className="h-9 w-auto" />
          <span className="inline-flex items-center gap-2 text-xs text-[#52525b]">
            <ShieldCheck size={15} className="text-[#1E6BFF]" /> Acceso protegido
          </span>
        </header>
        {loading ? (
          <div className="grid min-h-[560px] place-items-center">
            <Loader2 className="animate-spin text-[#1E6BFF]" />
          </div>
        ) : data ? (
          <main className="mt-7 overflow-hidden rounded-lg border border-[#EBEBF0] bg-white">
            <div className="border-b border-[#EBEBF0] p-6 sm:p-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-medium uppercase text-[#1E6BFF]">{data.request.folio}</p>
                {data.request.due_at && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-[#52525b]">
                    <Clock3 size={14} /> Vence{' '}
                    {new Date(data.request.due_at).toLocaleDateString('es-MX')}
                  </span>
                )}
              </div>
              <h1 className="mt-2 text-2xl font-medium">{data.request.title}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#52525b]">
                {data.request.description ||
                  'Completa los requisitos indicados para enviar tu informacion a revision.'}
              </p>
            </div>

            {!data.authenticated ? (
              <div className="mx-auto max-w-lg p-6 sm:p-8">
                <div className="grid h-11 w-11 place-items-center rounded-md bg-blue-50 text-[#1E6BFF]">
                  <LockKeyhole size={22} />
                </div>
                <h2 className="mt-4 text-lg font-medium">Confirma tu identidad de acceso</h2>
                <p className="mt-1 text-sm leading-6 text-[#52525b]">
                  Enviaremos un codigo de seis digitos al correo registrado en esta solicitud.
                </p>
                {error && <ErrorMessage message={error} />}
                {challengeId ? (
                  <form onSubmit={verifyOtp} className="mt-5">
                    <label className="text-sm font-medium">
                      Codigo de acceso
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
                      disabled={working === 'verify'}
                      className="mt-4 h-11 w-full rounded-md bg-[#1E6BFF] text-sm font-medium text-white disabled:opacity-60"
                    >
                      Validar y continuar
                    </button>
                  </form>
                ) : (
                  <button
                    onClick={requestOtp}
                    disabled={working === 'otp'}
                    className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#1E6BFF] text-sm font-medium text-white disabled:opacity-60"
                  >
                    {working === 'otp' && <Loader2 size={16} className="animate-spin" />} Enviar
                    codigo
                  </button>
                )}
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-3 border-b border-[#EBEBF0] bg-emerald-50 px-6 py-4 text-sm text-emerald-700">
                  <CheckCircle2 size={18} /> Acceso confirmado para {data.recipient_name}
                </div>
                <div className="p-5 sm:p-7">
                  <div className="mb-5 flex items-end justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-medium">Requisitos</h2>
                      <p className="mt-1 text-sm text-[#52525b]">
                        Los archivos se reciben de forma privada y quedan sujetos a revision.
                      </p>
                    </div>
                    <span className="text-xs text-[#52525b]">
                      {
                        (data.items || []).filter((item) =>
                          ['uploaded', 'in_review', 'approved', 'waived'].includes(item.status)
                        ).length
                      }{' '}
                      de {data.items?.length || 0}
                    </span>
                  </div>
                  {error && <ErrorMessage message={error} />}
                  <div className="divide-y divide-[#EBEBF0] rounded-lg border border-[#EBEBF0]">
                    {data.items?.map((item) => {
                      const latest = item.files[0];
                      return (
                        <div key={item.id} className="p-4 sm:p-5">
                          <div className="flex items-start gap-3">
                            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-blue-50 text-[#1E6BFF]">
                              {latest ? <FileCheck2 size={19} /> : <FileText size={19} />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-sm font-medium">{item.title}</h3>
                                {item.required && (
                                  <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] text-red-700">
                                    Obligatorio
                                  </span>
                                )}
                              </div>
                              {item.description && (
                                <p className="mt-1 text-xs leading-5 text-[#52525b]">
                                  {item.description}
                                </p>
                              )}
                              {item.rejection_reason && (
                                <p className="mt-2 text-xs text-red-700">
                                  Correccion solicitada: {item.rejection_reason}
                                </p>
                              )}
                              {latest && (
                                <p className="mt-2 truncate text-xs text-[#52525b]">
                                  {latest.original_name} · {bytes(latest.byte_size)} · v
                                  {latest.version}
                                </p>
                              )}
                              {latest?.malware_scan_status === 'pending' && (
                                <p className="mt-1 text-xs text-amber-700">
                                  Recibido. Analisis de seguridad pendiente.
                                </p>
                              )}
                            </div>
                            {!locked && !['approved', 'waived'].includes(item.status) && (
                              <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-[#dce3ef] px-3 text-xs font-medium text-[#1E6BFF] hover:bg-blue-50">
                                {working === item.id ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : (
                                  <Upload size={14} />
                                )}
                                {latest ? 'Reemplazar' : 'Cargar'}
                                <input
                                  type="file"
                                  accept="application/pdf,image/jpeg,image/png"
                                  className="sr-only"
                                  disabled={working === item.id}
                                  onChange={(event) =>
                                    uploadFile(item.id, event.target.files?.[0] || null)
                                  }
                                />
                              </label>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {locked ? (
                    <div className="mt-5 flex items-center gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                      <CheckCircle2 size={19} /> La solicitud fue enviada y esta en revision.
                    </div>
                  ) : (
                    <button
                      onClick={submitRequest}
                      disabled={!requiredComplete || working === 'submit'}
                      className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#1E6BFF] text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {working === 'submit' ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Send size={16} />
                      )}{' '}
                      Enviar a revision
                    </button>
                  )}
                </div>
              </div>
            )}
          </main>
        ) : (
          <div className="mt-8 rounded-lg border border-red-200 bg-white p-8 text-center text-sm text-red-700">
            {error || 'Acceso no disponible.'}
          </div>
        )}
        <footer className="py-8 text-center text-xs text-[#71717a]">
          Docubox · Tus acciones quedan registradas para proteger el proceso.
        </footer>
      </div>
    </div>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <div className="mt-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      <AlertCircle size={16} className="mt-0.5 shrink-0" /> {message}
    </div>
  );
}
