'use client';

import React, { Suspense, useState, useRef, useCallback, useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Eye,
  EyeOff,
  CheckCircle2,
  AlertTriangle,
  X,
  Mail,
  ShieldCheck,
  KeyRound,
} from 'lucide-react';
import { Toaster, toast } from 'sonner';
import AppLogo from '@/components/ui/AppLogo';

type Step = 'email' | 'otp' | 'new-password' | 'success';

const PASSWORD_RECOVERY_STEPS = [
  { key: 'email', id: 1, label: 'Correo', icon: Mail },
  { key: 'otp', id: 2, label: 'Verificación', icon: ShieldCheck },
  { key: 'new-password', id: 3, label: 'Nueva contraseña', icon: KeyRound },
] as const;

interface EmailFormData {
  email: string;
}

interface NewPasswordFormData {
  password: string;
  confirmPassword: string;
}

function OlvideContrasenaContent() {
  const searchParams = useSearchParams();
  const emailFromQuery = searchParams.get('email')?.trim() || '';
  const validEmailFromQuery = /^\S+@\S+\.\S+$/.test(emailFromQuery) ? emailFromQuery : '';
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // OTP digit state — 6 individual boxes
  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', '']);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  const emailForm = useForm<EmailFormData>({
    defaultValues: { email: validEmailFromQuery },
  });
  const passwordForm = useForm<NewPasswordFormData>();
  const loginEmail = (email || validEmailFromQuery).trim();
  const loginHref = /^\S+@\S+\.\S+$/.test(loginEmail)
    ? `/login?email=${encodeURIComponent(loginEmail)}`
    : '/login';

  useEffect(() => {
    const emailFromSession = window.sessionStorage
      .getItem('docubox:password-recovery-email')
      ?.trim();
    const recoveryEmail = validEmailFromQuery || emailFromSession;
    if (recoveryEmail && /^\S+@\S+\.\S+$/.test(recoveryEmail)) {
      emailForm.reset({ email: recoveryEmail });
      window.sessionStorage.setItem('docubox:password-recovery-email', recoveryEmail);
    }
  }, [emailForm, validEmailFromQuery]);

  useEffect(() => {
    if (step !== 'otp') return;
    const focusTimer = window.setTimeout(() => otpRefs.current[0]?.focus(), 100);
    return () => window.clearTimeout(focusTimer);
  }, [step]);

  // OTP helpers
  const getOtpValue = () => otpDigits.join('');

  const handleOtpChange = useCallback((index: number, value: string) => {
    // Allow only digits
    const digit = value.replace(/\D/g, '').slice(-1);
    setOtpDigits((prev) => {
      const next = [...prev];
      next[index] = digit;
      return next;
    });
    if (digit && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  }, []);

  const handleOtpKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Backspace') {
        if (otpDigits[index]) {
          setOtpDigits((prev) => {
            const next = [...prev];
            next[index] = '';
            return next;
          });
        } else if (index > 0) {
          otpRefs.current[index - 1]?.focus();
          setOtpDigits((prev) => {
            const next = [...prev];
            next[index - 1] = '';
            return next;
          });
        }
      } else if (e.key === 'ArrowLeft' && index > 0) {
        otpRefs.current[index - 1]?.focus();
      } else if (e.key === 'ArrowRight' && index < 5) {
        otpRefs.current[index + 1]?.focus();
      }
    },
    [otpDigits]
  );

  const handleOtpPaste = useCallback((e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    const next = ['', '', '', '', '', ''];
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setOtpDigits(next);
    const focusIdx = Math.min(pasted.length, 5);
    otpRefs.current[focusIdx]?.focus();
  }, []);

  const resetOtpDigits = () => {
    setOtpDigits(['', '', '', '', '', '']);
    setTimeout(() => otpRefs.current[0]?.focus(), 50);
  };

  // Step 1: Send OTP to email
  const onSendOtp = async (data: EmailFormData) => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/auth/password-reset-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.email }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.error || 'Ocurrió un error. Intenta de nuevo.');
        return;
      }
      const normalizedEmail = data.email.trim();
      setEmail(normalizedEmail);
      window.sessionStorage.setItem('docubox:password-recovery-email', normalizedEmail);
      toast.success('Código enviado a tu correo electrónico.');
      setStep('otp');
    } catch {
      setErrorMsg('Ocurrió un error. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  // Resend OTP
  const onResendOtp = async () => {
    if (!email) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/auth/password-reset-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.error || 'Error al reenviar el código.');
        return;
      }
      resetOtpDigits();
      toast.success('Código reenviado a tu correo.');
    } catch {
      setErrorMsg('Error al reenviar el código.');
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Verify OTP
  const onVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const otpCode = getOtpValue();
    if (otpCode.length < 6) {
      setErrorMsg('Ingresa los 6 dígitos del código.');
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/auth/password-reset-otp', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otpCode }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.error || 'Código incorrecto o expirado.');
        resetOtpDigits();
        return;
      }
      setResetToken(json.resetToken);
      toast.success('Código verificado correctamente.');
      setStep('new-password');
    } catch {
      setErrorMsg('Ocurrió un error al verificar el código.');
    } finally {
      setLoading(false);
    }
  };

  // Step 3: Update password
  const onUpdatePassword = async (data: NewPasswordFormData) => {
    if (data.password !== data.confirmPassword) {
      passwordForm.setError('confirmPassword', { message: 'Las contraseñas no coinciden' });
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/auth/password-reset-otp', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, resetToken, newPassword: data.password }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.error || 'Error al actualizar la contraseña.');
        return;
      }
      window.sessionStorage.removeItem('docubox:password-recovery-email');
      setStep('success');
    } catch {
      setErrorMsg('Ocurrió un error al actualizar la contraseña.');
    } finally {
      setLoading(false);
    }
  };

  const currentStepIndex = PASSWORD_RECOVERY_STEPS.findIndex((s) => s.key === step);
  const wizardCurrentStep = Math.max(currentStepIndex + 1, 1);

  return (
    <main className="flex min-h-[100dvh] flex-col bg-[#f7f9fc] text-foreground">
      <Toaster position="bottom-right" richColors />
      <header className="flex h-16 shrink-0 items-center border-b border-slate-200 bg-white px-4 lg:px-6">
        <div className="flex min-w-0 flex-1 items-center">
          <AppLogo size={34} />
        </div>
        <Link
          href={loginHref}
          title="Salir de la recuperación de contraseña"
          className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 text-sm font-600 text-primary transition-colors hover:bg-slate-50"
        >
          <X size={16} />
          <span>Salir</span>
        </Link>
      </header>

      {step !== 'success' && (
        <div className="shrink-0 border-b border-slate-200 bg-[#edf3f8] px-4 py-2 lg:px-6">
          <nav
            aria-label="Pasos de recuperación"
            className="mx-auto flex w-max max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-slate-200 bg-slate-100/80 p-1 sm:gap-1"
          >
            {PASSWORD_RECOVERY_STEPS.map((item, index) => {
              const StepIcon = item.icon;
              const isActive = item.id === wizardCurrentStep;
              const isCompleted = item.id < wizardCurrentStep;
              return (
                <React.Fragment key={item.key}>
                  <span
                    aria-current={isActive ? 'step' : undefined}
                    aria-label={item.label}
                    className={`flex h-8 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-sm font-normal sm:px-2.5 ${isActive ? 'bg-white text-primary shadow-[0_1px_3px_rgba(15,23,42,0.12)]' : isCompleted ? 'text-slate-700' : 'text-slate-600'}`}
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${isActive ? 'bg-primary text-white' : isCompleted ? 'bg-primary/10 text-primary' : 'bg-slate-200 text-slate-700'}`}
                    >
                      {isCompleted ? <CheckCircle2 size={13} /> : <StepIcon size={13} />}
                    </span>
                    <span className="hidden sm:inline">{item.label}</span>
                  </span>
                  {index < PASSWORD_RECOVERY_STEPS.length - 1 && (
                    <span
                      className={`h-px w-1.5 shrink-0 sm:w-3 ${isCompleted ? 'bg-primary/50' : 'bg-slate-300'}`}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </nav>
        </div>
      )}

      <div className="mx-auto flex w-full max-w-[520px] flex-1 items-center px-4 py-10 sm:px-6">
        <section
          aria-label="Recuperar contraseña"
          className="w-full rounded-lg border border-slate-200 bg-white px-6 py-8 shadow-[0_4px_20px_rgba(15,23,42,0.04)] sm:px-10 sm:py-10"
        >
          {/* Error message */}
          {errorMsg && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3">
              <AlertTriangle size={14} className="text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-700">{errorMsg}</p>
            </div>
          )}

          {/* Step 1: Email */}
          {step === 'email' && (
            <div>
              <div className="mb-8">
                <h1 className="text-[28px] font-500 leading-tight text-foreground">
                  ¿Olvidaste tu contraseña?
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  Ingresa tu correo electrónico y te enviaremos un código de verificación.
                </p>
              </div>
              <form onSubmit={emailForm.handleSubmit(onSendOtp)} className="space-y-4">
                <div>
                  <label
                    htmlFor="recovery-email"
                    className="mb-2 block text-sm font-600 text-foreground"
                  >
                    Correo electrónico <span className="text-red-500">*</span>
                  </label>
                  <Controller
                    control={emailForm.control}
                    name="email"
                    rules={{
                      required: 'El correo es requerido',
                      pattern: { value: /^\S+@\S+\.\S+$/, message: 'Formato de email inválido' },
                    }}
                    render={({ field }) => (
                      <input
                        {...field}
                        id="recovery-email"
                        type="email"
                        placeholder="tu@empresa.com"
                        autoComplete="email"
                        autoFocus
                        className={`h-12 w-full rounded-md border px-4 text-sm transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 ${
                          emailForm.formState.errors.email
                            ? 'border-red-400 bg-red-50'
                            : 'border-border bg-white'
                        }`}
                      />
                    )}
                  />
                  {emailForm.formState.errors.email && (
                    <p className="text-[11px] text-red-600 mt-1">
                      {emailForm.formState.errors.email.message}
                    </p>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 text-sm font-600 text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? (
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  ) : (
                    'Enviar código de verificación'
                  )}
                </button>
              </form>
            </div>
          )}

          {/* Step 2: OTP — 6 individual digit boxes */}
          {step === 'otp' && (
            <div>
              <div className="mb-8">
                <h1 className="text-[28px] font-500 leading-tight text-foreground">
                  Verifica tu identidad
                </h1>
                <p className="mt-2 break-words text-sm text-muted-foreground">
                  Ingresa el código de 6 dígitos enviado a{' '}
                  <span className="font-600 text-foreground">{email}</span>
                </p>
              </div>
              <form onSubmit={onVerifyOtp} className="space-y-5">
                <div>
                  <label className="mb-3 block text-sm font-600 text-foreground">
                    Código de verificación <span className="text-red-500">*</span>
                  </label>
                  <div className="grid grid-cols-6 gap-2">
                    {otpDigits.map((digit, index) => (
                      <input
                        key={index}
                        ref={(el) => {
                          otpRefs.current[index] = el;
                        }}
                        type="text"
                        aria-label={`Dígito ${index + 1} del código`}
                        inputMode="numeric"
                        maxLength={1}
                        value={digit}
                        onChange={(e) => handleOtpChange(index, e.target.value)}
                        onKeyDown={(e) => handleOtpKeyDown(index, e)}
                        onPaste={handleOtpPaste}
                        onFocus={(e) => e.target.select()}
                        className={`h-12 min-w-0 w-full rounded-md border text-center font-mono text-lg font-600 transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 ${
                          digit
                            ? 'border-primary bg-primary/5 text-primary'
                            : 'border-border bg-white text-foreground'
                        }`}
                      />
                    ))}
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={loading || getOtpValue().length < 6}
                  className="flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 text-sm font-600 text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {loading ? (
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  ) : (
                    'Verificar código'
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg(null);
                    resetOtpDigits();
                    setStep('email');
                  }}
                  className="w-full text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  Cambiar correo electrónico
                </button>
              </form>
              <div className="mt-4 text-center">
                <button
                  type="button"
                  onClick={onResendOtp}
                  disabled={loading}
                  className="text-xs text-primary hover:underline font-500 disabled:opacity-50"
                >
                  ¿No recibiste el código? Reenviar
                </button>
              </div>
            </div>
          )}

          {/* Step 3: New Password */}
          {step === 'new-password' && (
            <div>
              <div className="mb-8">
                <h1 className="text-[28px] font-500 leading-tight text-foreground">
                  Crea nueva contraseña
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  Elige una contraseña segura para proteger tu cuenta.
                </p>
              </div>
              <form onSubmit={passwordForm.handleSubmit(onUpdatePassword)} className="space-y-4">
                <div>
                  <label
                    htmlFor="recovery-password"
                    className="mb-2 block text-sm font-600 text-foreground"
                  >
                    Nueva contraseña <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      {...passwordForm.register('password', {
                        required: 'La contraseña es requerida',
                        minLength: { value: 8, message: 'Mínimo 8 caracteres' },
                        pattern: {
                          value: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
                          message: 'Debe incluir mayúsculas, minúsculas y números',
                        },
                      })}
                      id="recovery-password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Mínimo 8 caracteres"
                      autoComplete="new-password"
                      className={`h-12 w-full rounded-md border px-4 pr-10 text-sm transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 ${
                        passwordForm.formState.errors.password
                          ? 'border-red-400 bg-red-50'
                          : 'border-border bg-white'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                      title={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  {passwordForm.formState.errors.password && (
                    <p className="text-[11px] text-red-600 mt-1">
                      {passwordForm.formState.errors.password.message}
                    </p>
                  )}
                </div>
                <div>
                  <label
                    htmlFor="recovery-confirm-password"
                    className="mb-2 block text-sm font-600 text-foreground"
                  >
                    Confirmar contraseña <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      {...passwordForm.register('confirmPassword', {
                        required: 'Confirma tu contraseña',
                      })}
                      id="recovery-confirm-password"
                      type={showConfirmPassword ? 'text' : 'password'}
                      placeholder="Repite tu contraseña"
                      autoComplete="new-password"
                      className={`h-12 w-full rounded-md border px-4 pr-10 text-sm transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 ${
                        passwordForm.formState.errors.confirmPassword
                          ? 'border-red-400 bg-red-50'
                          : 'border-border bg-white'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      aria-label={
                        showConfirmPassword ? 'Ocultar confirmación' : 'Mostrar confirmación'
                      }
                      title={showConfirmPassword ? 'Ocultar confirmación' : 'Mostrar confirmación'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showConfirmPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  {passwordForm.formState.errors.confirmPassword && (
                    <p className="text-[11px] text-red-600 mt-1">
                      {passwordForm.formState.errors.confirmPassword.message}
                    </p>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 text-sm font-600 text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? (
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  ) : (
                    'Actualizar contraseña'
                  )}
                </button>
              </form>
            </div>
          )}

          {/* Step 4: Success */}
          {step === 'success' && (
            <div className="text-center">
              <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
                <CheckCircle2 size={25} className="text-emerald-600" />
              </div>
              <h1 className="mb-2 text-[28px] font-500 leading-tight text-foreground">
                ¡Contraseña actualizada!
              </h1>
              <p className="mb-8 text-sm text-muted-foreground">
                Tu contraseña ha sido restablecida exitosamente. Ya puedes iniciar sesión con tu
                nueva contraseña.
              </p>
              <Link
                href={loginHref}
                className="inline-flex min-h-12 w-full items-center justify-center rounded-md bg-primary px-4 py-3 text-sm font-600 text-white transition-colors hover:bg-primary/90"
              >
                Ir al inicio de sesión
              </Link>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default function OlvideContrasenaPage() {
  return (
    <Suspense fallback={<main className="min-h-[100dvh] bg-[#f7f9fc]" />}>
      <OlvideContrasenaContent />
    </Suspense>
  );
}
