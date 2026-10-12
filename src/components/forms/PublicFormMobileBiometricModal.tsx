'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Loader2,
  QrCode,
  RefreshCw,
  Smartphone,
  X,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { createClient } from '@/lib/supabase/client';

type MobileSession = { token: string; url: string; expiresAt: string; hasStoredId: boolean };

export default function PublicFormMobileBiometricModal({
  formId,
  code,
  busy,
  error,
  onClose,
  onVerified,
}: {
  formId?: string;
  code: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  onVerified: (mobileSessionToken: string) => Promise<void>;
}) {
  const [session, setSession] = useState<MobileSession | null>(null);
  const [status, setStatus] = useState<'creating' | 'waiting' | 'verified' | 'failed'>('creating');
  const [message, setMessage] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const claimingRef = useRef(false);
  const onVerifiedRef = useRef(onVerified);
  useEffect(() => {
    onVerifiedRef.current = onVerified;
  }, [onVerified]);

  const createSession = useCallback(async () => {
    setStatus('creating');
    setSession(null);
    setMessage('');
    claimingRef.current = false;
    try {
      const {
        data: { session: auth },
      } = await createClient().auth.getSession();
      if (!auth?.access_token) throw new Error('Inicia sesión para continuar.');
      const response = await fetch('/api/mobile-upload/create-id-capture-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.access_token}`,
        },
        cache: 'no-store',
        body: JSON.stringify({ formId, code }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.token)
        throw new Error(result.error || 'No se pudo generar el QR.');
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
      setSession({
        token: result.token,
        url: `${siteUrl.replace(/\/$/, '')}/captura-id-movil/${result.token}`,
        expiresAt: result.expiresAt,
        hasStoredId: result.hasStoredId === true,
      });
      setSecondsLeft(
        Math.max(0, Math.ceil((new Date(result.expiresAt).getTime() - Date.now()) / 1000))
      );
      setStatus('waiting');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'No se pudo iniciar la captura móvil.');
      setStatus('failed');
    }
  }, [code, formId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void createSession(), 0);
    return () => window.clearTimeout(timer);
  }, [createSession]);

  const finish = useCallback(async (token: string) => {
    if (claimingRef.current) return;
    claimingRef.current = true;
    setStatus('verified');
    try {
      await onVerifiedRef.current(token);
    } finally {
      claimingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!session || status !== 'waiting') return;
    let active = true;
    const check = async () => {
      try {
        const response = await fetch(
          `/api/mobile-upload/session-status?token=${encodeURIComponent(session.token)}`,
          { cache: 'no-store' }
        );
        const result = await response.json().catch(() => ({}));
        if (!active) return;
        if (!response.ok) throw new Error(result.error || 'La sesión móvil no está disponible.');
        if (result.mode !== 'public_form_liveness')
          throw new Error('La sesión móvil no corresponde al formulario.');
        if (result.status === 'completed') {
          void finish(session.token);
        } else if (result.status === 'identity_failed') {
          setMessage('La identidad o prueba de vida no fue aprobada. Genera un QR nuevo.');
          setStatus('failed');
        } else if (result.status !== 'pending') {
          setMessage('La sesión móvil terminó. Genera un QR nuevo.');
          setStatus('failed');
        }
      } catch (cause) {
        if (active)
          setMessage(
            cause instanceof Error ? cause.message : 'No se pudo consultar la captura móvil.'
          );
      }
    };
    void check();
    const poll = window.setInterval(() => void check(), 3000);
    const countdown = window.setInterval(() => {
      const left = Math.max(
        0,
        Math.ceil((new Date(session.expiresAt).getTime() - Date.now()) / 1000)
      );
      setSecondsLeft(left);
      if (left === 0) {
        setMessage('El QR expiró. Genera uno nuevo.');
        setStatus('failed');
      }
    }, 1000);
    return () => {
      active = false;
      window.clearInterval(poll);
      window.clearInterval(countdown);
    };
  }, [finish, session, status]);

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = String(secondsLeft % 60).padStart(2, '0');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-3 sm:p-5">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-liveness-title"
        className="max-h-full w-full max-w-md overflow-y-auto rounded-xl bg-white p-5 shadow-xl sm:p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2
              id="mobile-liveness-title"
              className="flex items-center gap-2 text-lg font-semibold text-slate-950"
            >
              <Smartphone size={20} />{' '}
              {session?.hasStoredId
                ? 'Prueba de vida — Móvil'
                : 'Captura de identificación y prueba de vida — Móvil'}
            </h2>
            <p className="mt-2 text-sm leading-5 text-slate-600">
              {session?.hasStoredId
                ? 'Tu identificación ya está registrada. Escanea el QR para tomar la selfie de prueba de vida.'
                : 'Escanea el QR para capturar tu identificación y la selfie de prueba de vida.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Cerrar captura móvil"
            className="rounded-md p-1 text-slate-500 disabled:opacity-50"
          >
            <X size={19} />
          </button>
        </div>
        {status === 'creating' && (
          <p
            role="status"
            className="mt-8 flex items-center justify-center gap-2 py-12 text-sm text-slate-600"
          >
            <Loader2 size={18} className="animate-spin" /> Generando código QR…
          </p>
        )}
        {session && (status === 'waiting' || status === 'verified') && (
          <div className="mt-6 space-y-4">
            <div className="flex justify-center rounded-lg border border-slate-200 bg-white p-4">
              <QRCodeSVG value={session.url} size={200} marginSize={1} />
            </div>
            {status === 'waiting' ? (
              <p
                role="status"
                className="flex items-center justify-center gap-2 text-xs text-slate-600"
              >
                <Clock3 size={14} /> Esperando captura móvil · {minutes}:{seconds}
              </p>
            ) : (
              <p
                role="status"
                className="flex items-center justify-center gap-2 text-sm font-medium text-emerald-700"
              >
                <CheckCircle2 size={17} /> Identidad verificada. Abriendo formulario…
              </p>
            )}
            <a
              href={session.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 rounded-md border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700"
            >
              <ExternalLink size={16} /> Abrir captura en este dispositivo
            </a>
          </div>
        )}
        {(message || error) && (
          <p
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-800"
          >
            <AlertTriangle size={17} className="mt-0.5 shrink-0" /> {error || message}
          </p>
        )}
        {status === 'verified' && session && error && (
          <button
            type="button"
            onClick={() => void finish(session.token)}
            disabled={busy}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            <QrCode size={16} /> Reintentar acceso
          </button>
        )}
        {status === 'failed' && (
          <button
            type="button"
            onClick={() => void createSession()}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-white"
          >
            <RefreshCw size={16} /> Generar nuevo QR
          </button>
        )}
      </section>
    </div>
  );
}
