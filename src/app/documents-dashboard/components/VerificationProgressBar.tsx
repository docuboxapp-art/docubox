'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mail,
  Phone,
  Fingerprint,
  CheckCircle2,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Send,
  RefreshCw,
  ShieldAlert,
  QrCode,
  Clock,
  Shield,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

import { createClient } from '@/lib/supabase/client';

interface VerificationStatus {
  email_verified: boolean;
  phone_verified: boolean;
  biometric_verified: boolean;
  biometric_source: string | null;
  biometric_verified_at: string | null;
  verification_steps_completed: number;
  all_verified: boolean;
}

type ActiveStep = 'email' | 'phone' | 'biometric' | null;

type EmailSendState = {
  sending: boolean;
  sent: boolean;
  error: string | null;
};

const defaultEmailSend: EmailSendState = {
  sending: false,
  sent: false,
  error: null,
};

const defaultStatus: VerificationStatus = {
  email_verified: false,
  phone_verified: false,
  biometric_verified: false,
  biometric_source: null,
  biometric_verified_at: null,
  verification_steps_completed: 0,
  all_verified: false,
};

function formatDateTime(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('es-MX', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

interface StepDef {
  id: ActiveStep;
  label: string;
  sublabel: string;
  icon: React.ReactNode;
  verified: boolean;
  disabled?: boolean;
}

export default function VerificationProgressBar() {
  const supabase = createClient();
  const [status, setStatus] = useState<VerificationStatus>(defaultStatus);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userPhone, setUserPhone] = useState<string | null>(null);
  const [totpEnabled, setTotpEnabled] = useState(false);

  // Collapsed/expanded state for the whole bar
  const [expanded, setExpanded] = useState(false);

  // Which step card is expanded
  const [activeStep, setActiveStep] = useState<ActiveStep>(null);

  // Email verification link send state
  const [emailSend, setEmailSend] = useState<EmailSendState>({ ...defaultEmailSend });

  // Biometric QR state
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrExpired, setQrExpired] = useState(false);
  const [qrExpiresAt, setQrExpiresAt] = useState<Date | null>(null);
  const [qrTimeLeft, setQrTimeLeft] = useState<number>(600);
  const [biometricCompleted, setBiometricCompleted] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);

  const sessionIdRef = useRef<string>('');
  const realtimeChannelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(
    null
  );
  const realtimeResultsChannelRef = useRef<ReturnType<
    ReturnType<typeof createClient>['channel']
  > | null>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadVerificationStatus();
  }, []);

  // QR countdown timer
  useEffect(() => {
    if (!qrExpiresAt || qrExpired || biometricCompleted) return;
    const interval = setInterval(() => {
      const diffMs = qrExpiresAt.getTime() - Date.now();
      if (isNaN(diffMs)) {
        setQrExpired(true);
        clearInterval(interval);
        return;
      }
      const diff = Math.max(0, Math.floor(diffMs / 1000));
      setQrTimeLeft(diff);
      if (diff === 0) {
        setQrExpired(true);
        clearInterval(interval);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [qrExpiresAt, qrExpired, biometricCompleted]);

  async function loadVerificationStatus() {
    setLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      setUserId(user.id);
      setUserEmail(user.email ?? null);

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('phone')
        .eq('id', user.id)
        .single();
      if (profile?.phone) setUserPhone(profile.phone);

      let { data: vs } = await supabase
        .from('user_verification_status')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (!vs) {
        const { data: newVs } = await supabase
          .from('user_verification_status')
          .insert({ user_id: user.id })
          .select()
          .single();
        vs = newVs;
      }

      if (vs) {
        const emailVerifiedInAuth = !!user.email_confirmed_at;
        if (emailVerifiedInAuth && !vs.email_verified) {
          await supabase
            .from('user_verification_status')
            .update({ email_verified: true, email_verified_at: user.email_confirmed_at })
            .eq('user_id', user.id);
          vs.email_verified = true;
          vs.email_verified_at = user.email_confirmed_at;
        }
        if (!emailVerifiedInAuth && vs.email_verified) {
          await supabase
            .from('user_verification_status')
            .update({ email_verified: false, email_verified_at: null })
            .eq('user_id', user.id);
          vs.email_verified = false;
          vs.email_verified_at = null;
        }

        if (profile?.phone && !vs.phone_number) {
          await supabase
            .from('user_verification_status')
            .update({ phone_number: profile.phone })
            .eq('user_id', user.id);
        }

        // ── Reconciliación biométrica ──────────────────────────────────────
        // Si biometric_verified es false pero existe un enrollment_results
        // completado para este usuario, actualizar automáticamente.
        if (!vs.biometric_verified) {
          const { data: enrollResult } = await supabase
            .from('enrollment_results')
            .select('id, created_at')
            .eq('user_id', user.id)
            .eq('face_match_passed', true)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (enrollResult) {
            const now = new Date().toISOString();
            await supabase
              .from('user_verification_status')
              .update({
                biometric_verified: true,
                biometric_verified_at: enrollResult.created_at ?? now,
                biometric_source: 'enrollment',
                enrollment_result_id: enrollResult.id,
              })
              .eq('user_id', user.id);
            vs.biometric_verified = true;
            vs.biometric_verified_at = enrollResult.created_at ?? now;
            vs.biometric_source = 'enrollment';
          }
        }
        // ──────────────────────────────────────────────────────────────────

        setStatus(vs as VerificationStatus);
      }

      // Check TOTP status
      try {
        const { data: totpData } = await supabase
          .from('user_totp_settings')
          .select('is_enabled')
          .eq('user_id', user.id)
          .eq('is_enabled', true)
          .maybeSingle();
        setTotpEnabled(!!totpData);
      } catch {
        setTotpEnabled(false);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  // ── Send verification email (link-based, no OTP) ───────────────────────────
  async function sendVerificationEmail() {
    setEmailSend({ sending: true, sent: false, error: null });
    try {
      const res = await fetch('/api/registro/send-verification-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail, userId }),
      });
      const result = await res.json();
      if (!res.ok || result.error) {
        throw new Error(result.error || 'Error al enviar el correo.');
      }
      setEmailSend({ sending: false, sent: true, error: null });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al enviar el correo de validación.';
      setEmailSend({ sending: false, sent: false, error: msg });
    }
  }

  // ── Biometric QR ──────────────────────────────────────────────────────────
  const generateQrToken = useCallback(async () => {
    if (realtimeChannelRef.current) {
      supabase.removeChannel(realtimeChannelRef.current);
      realtimeChannelRef.current = null;
    }
    if (realtimeResultsChannelRef.current) {
      supabase.removeChannel(realtimeResultsChannelRef.current);
      realtimeResultsChannelRef.current = null;
    }
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }

    setQrLoading(true);
    setQrExpired(false);
    setQrUrl(null);
    setQrTimeLeft(600);
    setQrError(null);
    setBiometricCompleted(false);

    const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    sessionIdRef.current = sessionId;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/enrollment/create-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ sessionId }),
      });
      const result = await res.json();

      if (!result.success) {
        setQrError(result.error || 'Error al generar el código QR. Intenta nuevamente.');
        return;
      }

      setQrUrl(result.enrollmentUrl);
      let expiresAtDate: Date;
      try {
        const rawExpiry: string = result.expiresAt;
        const normalized = rawExpiry.replace(' ', 'T').replace(/([^Z])$/, '$1Z');
        const parsed = new Date(normalized);
        expiresAtDate = isNaN(parsed.getTime()) ? new Date(Date.now() + 10 * 60 * 1000) : parsed;
      } catch {
        expiresAtDate = new Date(Date.now() + 10 * 60 * 1000);
      }
      setQrExpiresAt(expiresAtDate);
      setQrTimeLeft(600);

      let enrollmentHandled = false;

      const handleEnrollmentComplete = async () => {
        if (enrollmentHandled) return;
        enrollmentHandled = true;

        if (realtimeResultsChannelRef.current) {
          supabase.removeChannel(realtimeResultsChannelRef.current);
          realtimeResultsChannelRef.current = null;
        }
        if (realtimeChannelRef.current) {
          supabase.removeChannel(realtimeChannelRef.current);
          realtimeChannelRef.current = null;
        }
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }

        if (userId) {
          const now = new Date().toISOString();
          await supabase
            .from('user_verification_status')
            .update({
              biometric_verified: true,
              biometric_verified_at: now,
              biometric_source: 'dashboard_enrollment',
            })
            .eq('user_id', userId);
        }

        setBiometricCompleted(true);
        await loadVerificationStatus();
      };

      const resultsChannel = supabase
        .channel(`vbar_enrollment_results_${sessionId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'enrollment_results',
            filter: `session_id=eq.${sessionId}`,
          },
          (payload) => {
            const row = payload.new as { status: string };
            if (row.status === 'completed') handleEnrollmentComplete();
          }
        )
        .subscribe();
      realtimeResultsChannelRef.current = resultsChannel;

      const tokenChannel = supabase
        .channel(`vbar_enrollment_token_${result.token}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'enrollment_tokens',
            filter: `token=eq.${result.token}`,
          },
          (payload) => {
            const row = payload.new as { status: string };
            if (row.status === 'completed') handleEnrollmentComplete();
          }
        )
        .subscribe();
      realtimeChannelRef.current = tokenChannel;

      pollingIntervalRef.current = setInterval(async () => {
        if (enrollmentHandled) {
          if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
          return;
        }
        try {
          const response = await fetch(`/api/enrollment/status?token=${encodeURIComponent(result.token)}&session_id=${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
          const status = await response.json();
          if (response.ok && status.result) {
            if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
            handleEnrollmentComplete();
          }
        } catch {
          // ignore
        }
      }, 3000);
    } catch (err) {
      console.error('[VerificationProgressBar] generateQrToken error:', err);
      setQrError('Error de conexión. Intenta nuevamente.');
    } finally {
      setQrLoading(false);
    }
  }, [userId, supabase]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (realtimeChannelRef.current) supabase.removeChannel(realtimeChannelRef.current);
      if (realtimeResultsChannelRef.current)
        supabase.removeChannel(realtimeResultsChannelRef.current);
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
    };
  }, []);

  // ── Toggle step ────────────────────────────────────────────────────────────
  function toggleStep(id: ActiveStep) {
    setActiveStep((prev) => (prev === id ? null : id));
    if (id !== 'biometric') {
      setQrUrl(null);
      setQrExpired(false);
    }
    // Reset email send state when toggling
    if (id !== 'email') {
      setEmailSend({ ...defaultEmailSend });
    }
  }

  // ── Required: email + biometric (2/2) ─────────────────────────────────────
  const requiredCompleted =
    (status.email_verified ? 1 : 0) +
    (status.phone_verified ? 1 : 0) +
    (status.biometric_verified ? 1 : 0);
  const requiredTotal = 3;
  const requiredAllDone =
    status.all_verified ||
    (status.email_verified && status.phone_verified && status.biometric_verified);

  const requiredSteps: StepDef[] = [
    {
      id: 'email',
      label: 'Correo electrónico',
      sublabel: userEmail ? `${userEmail.substring(0, 3)}***` : 'Verificar email',
      icon: <Mail size={14} />,
      verified: status.email_verified,
    },
    {
      id: 'phone',
      label: 'Número telefónico',
      sublabel: userPhone ? `***${userPhone.slice(-4)}` : 'Sin teléfono registrado',
      icon: <Phone size={14} />,
      verified: status.phone_verified,
      disabled: !status.phone_verified,
    },
    {
      id: 'biometric',
      label: 'Biométrico',
      sublabel: status.biometric_verified
        ? status.biometric_verified_at
          ? `Enrolado: ${formatDateTime(status.biometric_verified_at)}`
          : 'Enrolamiento completado'
        : 'Validación facial',
      icon: <Fingerprint size={14} />,
      verified: status.biometric_verified,
    },
  ];

  const optionalSteps: StepDef[] = [
    {
      id: null,
      label: 'Autenticación M2FA',
      sublabel: totpEnabled ? 'App autenticadora activa' : 'Doble factor de autenticación',
      icon: <Shield size={14} />,
      verified: totpEnabled,
      disabled: false,
    },
  ];

  // Hide bar only when all 3 required steps are done
  if (!loading && requiredAllDone) return null;

  const minutes = Math.floor(qrTimeLeft / 60);
  const seconds = qrTimeLeft % 60;
  const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  const renderStepCard = (step: StepDef) => {
    const isActive = activeStep === step.id;

    return (
      <div
        key={step.id ?? step.label}
        className={`flex-1 rounded-lg border transition-all duration-200 overflow-hidden ${
          loading
            ? 'bg-gray-100 border-gray-200 animate-pulse'
            : step.verified
              ? 'bg-emerald-50 border-emerald-200'
              : step.disabled
                ? 'bg-gray-50 border-gray-200 opacity-60'
                : isActive
                  ? 'bg-primary/5 border-primary/40'
                  : 'bg-white border-gray-200 hover:border-primary/40'
        }`}
      >
        <button
          onClick={() => {
            if (loading || step.verified || step.disabled) return;
            if (!step.id) {
              // MFA item — navigate to security settings
              window.location.href = '/settings/security';
              return;
            }
            toggleStep(step.id);
          }}
          disabled={loading || step.verified || !!step.disabled}
          className="w-full flex items-center gap-1.5 px-2.5 py-2 text-left"
        >
          <div
            className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
              step.verified
                ? 'text-emerald-600'
                : step.disabled
                  ? 'text-gray-400'
                  : 'text-muted-foreground'
            }`}
          >
            {loading ? (
              <div className="w-4 h-4 rounded-full bg-gray-200" />
            ) : step.verified ? (
              <CheckCircle2 size={14} />
            ) : (
              step.icon
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p
              className={`text-[10px] font-600 leading-tight truncate ${
                loading
                  ? 'text-gray-300'
                  : step.verified
                    ? 'text-emerald-700'
                    : step.disabled
                      ? 'text-gray-400'
                      : 'text-foreground'
              }`}
            >
              {loading ? '...' : step.label}
            </p>
            <p className="text-[9px] text-muted-foreground leading-tight truncate">
              {loading ? '' : step.disabled ? 'Próximamente' : step.sublabel}
            </p>
          </div>
          {!loading && !step.verified && !step.disabled && step.id && (
            <span className="text-primary flex-shrink-0">
              {isActive ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            </span>
          )}
        </button>

        {/* ── Email verification link inline form ── */}
        {!loading && isActive && step.id === 'email' && (
          <div className="px-2.5 pb-2.5 space-y-2">
            <p className="text-[10px] text-muted-foreground">
              Te enviaremos un enlace de verificación a{' '}
              <span className="font-600 text-foreground">{userEmail}</span>
            </p>

            {emailSend.error && (
              <div className="flex items-start gap-1.5 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5">
                <AlertCircle size={11} className="text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-[10px] text-red-600 leading-tight">{emailSend.error}</p>
              </div>
            )}

            {emailSend.sent ? (
              <div className="space-y-1.5">
                <div className="flex items-start gap-1.5 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1.5">
                  <CheckCircle2 size={11} className="text-emerald-600 mt-0.5 flex-shrink-0" />
                  <p className="text-[10px] text-emerald-700 leading-tight font-500">
                    Correo enviado. Revisa tu bandeja de entrada y haz clic en el enlace para
                    validar tu cuenta.
                  </p>
                </div>
                <button
                  onClick={sendVerificationEmail}
                  disabled={emailSend.sending}
                  className="w-full flex items-center justify-center gap-1 text-[10px] text-primary hover:underline disabled:opacity-50"
                >
                  <RefreshCw size={9} />
                  Reenviar correo
                </button>
              </div>
            ) : (
              <button
                onClick={sendVerificationEmail}
                disabled={emailSend.sending}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-primary text-white text-[10px] font-600 rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {emailSend.sending ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <Send size={11} />
                )}
                {emailSend.sending ? 'Enviando...' : 'Enviar correo de validación'}
              </button>
            )}
          </div>
        )}

        {/* ── Biometric inline UI ── */}
        {!loading && isActive && step.id === 'biometric' && (
          <div className="px-2.5 pb-2.5 space-y-2">
            {biometricCompleted ? (
              <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1.5">
                <CheckCircle2 size={11} className="text-emerald-600 flex-shrink-0" />
                <p className="text-[10px] text-emerald-700 font-500">
                  Enrolamiento biométrico completado exitosamente.
                </p>
              </div>
            ) : (
              <>
                {/* QR area */}
                <div className="flex flex-col items-center gap-2 py-2 bg-gray-50 rounded-lg border border-gray-200">
                  {qrLoading ? (
                    <div className="w-28 h-28 flex items-center justify-center">
                      <Loader2 size={24} className="text-primary animate-spin" />
                    </div>
                  ) : qrExpired ? (
                    <div className="w-28 h-28 flex flex-col items-center justify-center gap-2">
                      <AlertCircle size={24} className="text-red-400" />
                      <p className="text-[10px] text-red-500 font-semibold text-center">
                        Código expirado
                      </p>
                    </div>
                  ) : qrUrl ? (
                    <div className="p-1.5 bg-white rounded-lg border border-border">
                      <QRCodeSVG value={qrUrl} size={110} level="M" includeMargin={false} />
                    </div>
                  ) : (
                    <div className="w-28 h-28 flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-lg">
                      <QrCode size={28} className="text-gray-300" />
                      <p className="text-[10px] text-muted-foreground text-center leading-tight px-2">
                        Genera el código QR para comenzar
                      </p>
                    </div>
                  )}

                  {/* Timer */}
                  {qrUrl && !qrExpired && (
                    <div className="flex items-center gap-1">
                      <Clock
                        size={11}
                        className={qrTimeLeft < 60 ? 'text-red-500' : 'text-muted-foreground'}
                      />
                      <span
                        className={`text-[10px] font-mono font-semibold ${qrTimeLeft < 60 ? 'text-red-500' : 'text-muted-foreground'}`}
                      >
                        Válido por {timeStr}
                      </span>
                    </div>
                  )}
                </div>

                {/* Error message */}
                {qrError && (
                  <div className="flex items-start gap-1.5 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5">
                    <AlertCircle size={11} className="text-red-500 mt-0.5 flex-shrink-0" />
                    <p className="text-[10px] text-red-600 leading-tight">{qrError}</p>
                  </div>
                )}

                {/* Generate / Regenerate button */}
                {(!qrUrl || qrExpired) && (
                  <button
                    onClick={generateQrToken}
                    disabled={qrLoading}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-primary text-white text-[10px] font-600 rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {qrLoading ? (
                      <>
                        <Loader2 size={11} className="animate-spin" /> Generando...
                      </>
                    ) : qrExpired ? (
                      <>
                        <RefreshCw size={11} /> Generar nuevo código
                      </>
                    ) : (
                      <>
                        <QrCode size={11} /> Generar código QR
                      </>
                    )}
                  </button>
                )}

                {/* Waiting indicator */}
                {qrUrl && !qrExpired && (
                  <div className="flex items-center gap-1.5 bg-blue-50 border border-blue-100 rounded-lg px-2 py-1.5">
                    <Loader2 size={11} className="text-blue-500 animate-spin flex-shrink-0" />
                    <span className="text-[10px] text-blue-600 font-medium leading-tight">
                      Esperando enrolamiento, no cierres esta pantalla
                    </span>
                  </div>
                )}

                {/* How it works */}
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-2 space-y-1">
                  <p className="text-[10px] font-bold text-blue-700">¿Cómo funciona?</p>
                  {[
                    '1. Haz clic en "Generar código QR"',
                    '2. Escanea el QR con la cámara de tu teléfono',
                    '3. Sigue las instrucciones en tu dispositivo móvil',
                    '4. Toma fotos de tu ID y una selfie',
                    '5. Los datos se validarán automáticamente aquí',
                  ].map((s) => (
                    <p key={s} className="text-[10px] text-blue-600 leading-tight">
                      {s}
                    </p>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-full bg-[#f6f8fb] px-4 pt-4 sm:px-6 lg:px-8 xl:px-10">
      {/* ── Collapsed bar (always visible) ── */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="mx-auto flex w-full max-w-[1600px] items-center justify-between rounded-lg border border-amber-200/80 bg-white px-4 py-3 text-left shadow-[0_6px_20px_-18px_rgba(15,23,42,0.5)] transition-colors duration-150 hover:bg-amber-50/30 sm:px-5"
      >
        <div className="flex items-center gap-2.5">
          {loading ? (
            <Loader2 size={16} className="text-gray-400 animate-spin flex-shrink-0" />
          ) : (
            <ShieldAlert size={22} className="text-amber-400 flex-shrink-0" />
          )}
          <div className="flex flex-col items-start">
            <span className="text-sm font-bold text-slate-950">
              {loading
                ? 'Cargando estado de verificación...'
                : 'Verificación de identidad pendiente'}
            </span>
            {!loading && (
              <span className="text-sm font-normal text-slate-600">
                Es necesario verificar tu cuenta
              </span>
            )}
          </div>
          {!loading && (
            <span className="text-xs font-bold bg-amber-50 text-amber-700 px-2.5 py-1 rounded-full border border-amber-200 ml-1">
              {requiredCompleted}/{requiredTotal} completados
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-slate-500 flex-shrink-0">
          <span className="text-sm font-bold text-slate-600">
            {expanded ? 'Ocultar métodos' : 'Iniciar verificación'}
          </span>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      {/* ── Expanded panel ── */}
      {expanded && (
        <div className="mx-auto mt-2 max-w-[1600px] space-y-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-[0_6px_20px_-18px_rgba(15,23,42,0.45)]">
          {/* Required steps */}
          <div>
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-2">
              Métodos requeridos ({requiredCompleted}/{requiredTotal})
            </p>
            <div className="flex items-start gap-2">
              {requiredSteps.map((step, i) => (
                <React.Fragment key={step.id ?? step.label}>
                  {renderStepCard(step)}
                  {i < requiredSteps.length - 1 && (
                    <div className="w-3 h-px bg-gray-300 flex-shrink-0 mt-4" />
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Optional steps */}
          <div className="border-t border-gray-200 pt-3">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">
              Métodos opcionales
            </p>
            <div className="flex items-start gap-2">
              {optionalSteps.map((step, i) => (
                <React.Fragment key={step.id ?? step.label}>
                  {renderStepCard(step)}
                  {i < optionalSteps.length - 1 && (
                    <div className="w-3 h-px bg-gray-200 flex-shrink-0 mt-4" />
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
