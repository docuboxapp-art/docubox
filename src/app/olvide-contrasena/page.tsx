'use client';

import React, { Suspense, useState, useRef, useCallback, useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Mail, Shield, Lock, Eye, EyeOff, CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import AppLogo from '@/components/ui/AppLogo';
import { NumberedWizardNav } from '@/components/ui/NumberedWizardNav';

type Step = 'email' | 'otp' | 'new-password' | 'success';

const PASSWORD_RECOVERY_STEPS = [
  { key: 'email', id: 1, label: 'Correo' },
  { key: 'otp', id: 2, label: 'Verificación' },
  { key: 'new-password', id: 3, label: 'Nueva contraseña' },
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
    <main className="flex h-screen overflow-hidden bg-[#f7f8fb]">
      <Toaster position="bottom-right" richColors />

      <aside className="relative hidden w-[43%] min-w-[520px] flex-col justify-center overflow-hidden border-r border-blue-700 bg-[#1E6BFF] px-12 py-14 lg:flex xl:px-16">
        <div className="absolute inset-x-0 top-0 h-px bg-white/25" />
        <div className="absolute inset-x-0 bottom-0 h-px bg-blue-800" />

        <div className="relative mx-auto w-full max-w-[590px]">
          <h1 className="mb-5 max-w-[560px] text-[23px] font-700 leading-tight text-white xl:text-[33px]">
            Recupera el acceso a tu cuenta
          </h1>
          <p className="mb-11 max-w-[570px] text-base leading-7 text-blue-100">
            Restablece tu contraseña con un código temporal enviado al correo asociado a tu cuenta.
          </p>

          <div className="border-y border-white/15">
            {[
              {
                icon: <Mail size={18} className="text-white" />,
                title: 'Confirma tu correo',
                desc: 'Usaremos el correo capturado en el inicio de sesión.',
              },
              {
                icon: <Shield size={18} className="text-white" />,
                title: 'Verifica tu identidad',
                desc: 'Ingresa el código temporal que recibirás por correo.',
              },
              {
                icon: <Lock size={18} className="text-white" />,
                title: 'Crea una contraseña nueva',
                desc: 'Elige una contraseña segura para recuperar el acceso.',
              },
            ].map((item) => (
              <div
                key={item.title}
                className="flex items-start gap-4 border-b border-white/15 py-4 last:border-b-0"
              >
                <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-white/20 bg-white/10">
                  {item.icon}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-600 text-white">{item.title}</p>
                  <p className="mt-1 max-w-[520px] text-xs leading-5 text-blue-100">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col bg-white">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 px-5 lg:px-8">
          <AppLogo size={34} />
          <Link
            href={loginHref}
            title="Salir de la recuperación de contraseña"
            className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-600 text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"
          >
            <X size={16} />
            <span>Salir</span>
          </Link>
        </header>

        {step !== 'success' && (
          <div className="shrink-0 overflow-x-auto border-b border-slate-200 bg-white px-4 py-2">
            <NumberedWizardNav
              steps={PASSWORD_RECOVERY_STEPS}
              currentStep={wizardCurrentStep}
              className="mx-auto w-max"
            />
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-8 sm:px-10 lg:px-14">
          <div className="mx-auto flex min-h-full w-full max-w-[460px] flex-col justify-center">
            {/* Error message */}
            {errorMsg && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2">
                <AlertTriangle size={14} className="text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-700">{errorMsg}</p>
              </div>
            )}

            {/* Step 1: Email */}
            {step === 'email' && (
              <div>
                <div className="mb-6">
                  <h2 className="text-2xl font-700 text-foreground">¿Olvidaste tu contraseña?</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Ingresa tu correo electrónico y te enviaremos un código de verificación.
                  </p>
                </div>
                <form onSubmit={emailForm.handleSubmit(onSendOtp)} className="space-y-4">
                  <div>
                    <label className="block text-xs font-600 text-foreground mb-1">
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
                          type="email"
                          placeholder="tu@empresa.com"
                          autoComplete="email"
                          className={`w-full px-3 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all ${
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
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-700 text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
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
                <div className="mb-6">
                  <h2 className="text-2xl font-700 text-foreground">Verifica tu identidad</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Ingresa el código de 6 dígitos enviado a{' '}
                    <span className="font-600 text-foreground">{email}</span>
                  </p>
                </div>
                <form onSubmit={onVerifyOtp} className="space-y-5">
                  <div>
                    <label className="block text-xs font-600 text-foreground mb-3">
                      Código de verificación <span className="text-red-500">*</span>
                    </label>
                    {/* 6 individual digit boxes */}
                    <div className="flex items-center justify-between gap-2">
                      {otpDigits.map((digit, index) => (
                        <input
                          key={index}
                          ref={(el) => {
                            otpRefs.current[index] = el;
                          }}
                          type="text"
                          inputMode="numeric"
                          maxLength={1}
                          value={digit}
                          onChange={(e) => handleOtpChange(index, e.target.value)}
                          onKeyDown={(e) => handleOtpKeyDown(index, e)}
                          onPaste={handleOtpPaste}
                          onFocus={(e) => e.target.select()}
                          className={`w-10 h-11 text-center text-lg font-700 font-mono border-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all ${
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
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-700 text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
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
                <div className="mb-6">
                  <h2 className="text-2xl font-700 text-foreground">Crea nueva contraseña</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Elige una contraseña segura para proteger tu cuenta.
                  </p>
                </div>
                <form onSubmit={passwordForm.handleSubmit(onUpdatePassword)} className="space-y-4">
                  <div>
                    <label className="block text-xs font-600 text-foreground mb-1">
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
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Mínimo 8 caracteres"
                        autoComplete="new-password"
                        className={`w-full px-3 py-2.5 pr-10 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all ${
                          passwordForm.formState.errors.password
                            ? 'border-red-400 bg-red-50'
                            : 'border-border bg-white'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
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
                    <label className="block text-xs font-600 text-foreground mb-1">
                      Confirmar contraseña <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <input
                        {...passwordForm.register('confirmPassword', {
                          required: 'Confirma tu contraseña',
                        })}
                        type={showConfirmPassword ? 'text' : 'password'}
                        placeholder="Repite tu contraseña"
                        autoComplete="new-password"
                        className={`w-full px-3 py-2.5 pr-10 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all ${
                          passwordForm.formState.errors.confirmPassword
                            ? 'border-red-400 bg-red-50'
                            : 'border-border bg-white'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
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
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-700 text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
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
                <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 size={32} className="text-green-600" />
                </div>
                <h2 className="text-2xl font-700 text-foreground mb-2">¡Contraseña actualizada!</h2>
                <p className="text-sm text-muted-foreground mb-8">
                  Tu contraseña ha sido restablecida exitosamente. Ya puedes iniciar sesión con tu
                  nueva contraseña.
                </p>
                <Link
                  href={loginHref}
                  className="inline-flex w-full items-center justify-center rounded-xl bg-primary py-3 text-sm font-700 text-white transition-colors hover:bg-primary/90"
                >
                  Ir al inicio de sesión
                </Link>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

export default function OlvideContrasenaPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-background" />}>
      <OlvideContrasenaContent />
    </Suspense>
  );
}
