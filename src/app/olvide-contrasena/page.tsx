'use client';

import React, { useState, useRef, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import Link from 'next/link';
import { Mail, Shield, Lock, Eye, EyeOff, CheckCircle2, AlertTriangle, ArrowLeft } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import AppLogo from '@/components/ui/AppLogo';

type Step = 'email' | 'otp' | 'new-password' | 'success';

interface EmailFormData {
  email: string;
}

interface NewPasswordFormData {
  password: string;
  confirmPassword: string;
}

export default function OlvideContrasenaPage() {
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

  const emailForm = useForm<EmailFormData>();
  const passwordForm = useForm<NewPasswordFormData>();

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

  const handleOtpKeyDown = useCallback((index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
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
  }, [otpDigits]);

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
      setEmail(data.email);
      toast.success('Código enviado a tu correo electrónico.');
      setStep('otp');
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
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
      setStep('success');
    } catch {
      setErrorMsg('Ocurrió un error al actualizar la contraseña.');
    } finally {
      setLoading(false);
    }
  };

  const stepConfig = [
    { key: 'email', label: 'Correo', number: 1 },
    { key: 'otp', label: 'Verificación', number: 2 },
    { key: 'new-password', label: 'Nueva contraseña', number: 3 },
  ];

  const currentStepIndex = stepConfig.findIndex((s) => s.key === step);

  return (
    <div className="min-h-screen flex bg-background">
      <Toaster position="bottom-right" richColors />

      {/* Left brand panel */}
      <div className="hidden lg:flex lg:w-[40%] bg-primary flex-col justify-center p-10 xl:p-14 relative overflow-hidden">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-white/5" />
          <div className="absolute -bottom-32 -left-16 w-80 h-80 rounded-full bg-white/5" />
          <div className="absolute top-1/2 right-12 w-48 h-48 rounded-full bg-accent/20" />
        </div>
        <div className="relative z-10">
          <h1 className="text-[calc(2.25rem-11px)] xl:text-[calc(3rem-11px)] font-800 text-white leading-tight mb-4">
            Recupera el acceso a tu cuenta
          </h1>
          <p className="text-lg text-white/75 mb-10 leading-relaxed max-w-lg">
            Sigue los pasos para restablecer tu contraseña de forma segura. Te enviaremos un código de verificación a tu correo electrónico.
          </p>
          <div className="space-y-4">
            {[
              { icon: <Mail size={18} className="text-accent" />, title: 'Ingresa tu correo', desc: 'Escribe el correo asociado a tu cuenta de Docubox' },
              { icon: <Shield size={18} className="text-accent" />, title: 'Verifica tu identidad', desc: 'Ingresa el código OTP que recibirás en tu correo' },
              { icon: <Lock size={18} className="text-accent" />, title: 'Crea nueva contraseña', desc: 'Establece una contraseña segura para tu cuenta' },
            ]?.map((item) => (
              <div key={item.title} className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  {item.icon}
                </div>
                <div>
                  <p className="text-sm font-600 text-white">{item.title}</p>
                  <p className="text-xs text-white/65 mt-0.5 leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 sm:px-10">
        {/* Mobile logo */}
        <div className="flex items-center gap-2 mb-8 lg:hidden">
          <AppLogo size={32} />
        </div>

        <div className="w-full max-w-md">
          {/* Logo above form */}
          {step !== 'success' && (
            <div className="flex justify-center mb-6">
              <AppLogo size={40} />
            </div>
          )}

          {/* Step indicator */}
          {step !== 'success' && (
            <div className="flex items-center gap-2 mb-8">
              {stepConfig.map((s, idx) => (
                <React.Fragment key={s.key}>
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-700 transition-all ${
                        idx < currentStepIndex
                          ? 'bg-primary text-white'
                          : idx === currentStepIndex
                          ? 'bg-primary text-white ring-4 ring-primary/20' :'bg-muted text-muted-foreground'
                      }`}
                    >
                      {idx < currentStepIndex ? <CheckCircle2 size={14} /> : s.number}
                    </div>
                    <span
                      className={`text-xs font-500 hidden sm:block ${
                        idx === currentStepIndex ? 'text-foreground' : 'text-muted-foreground'
                      }`}
                    >
                      {s.label}
                    </span>
                  </div>
                  {idx < stepConfig.length - 1 && (
                    <div className={`flex-1 h-px ${idx < currentStepIndex ? 'bg-primary' : 'bg-border'}`} />
                  )}
                </React.Fragment>
              ))}
            </div>
          )}

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
                  <input
                    {...emailForm.register('email', {
                      required: 'El correo es requerido',
                      pattern: { value: /^\S+@\S+\.\S+$/, message: 'Formato de email inválido' },
                    })}
                    type="email"
                    placeholder="tu@empresa.com"
                    autoComplete="email"
                    className={`w-full px-3 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all ${
                      emailForm.formState.errors.email ? 'border-red-400 bg-red-50' : 'border-border bg-white'
                    }`}
                  />
                  {emailForm.formState.errors.email && (
                    <p className="text-[11px] text-red-600 mt-1">{emailForm.formState.errors.email.message}</p>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-primary text-white rounded-xl text-sm font-700 hover:bg-primary-700 disabled:opacity-60 transition-all duration-150 active:scale-95"
                >
                  {loading ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    'Enviar código de verificación'
                  )}
                </button>
                <Link
                  href="/login"
                  className="w-full flex items-center justify-center gap-1.5 py-2.5 text-sm text-muted-foreground hover:text-foreground border border-border rounded-xl transition-colors"
                >
                  <ArrowLeft size={15} />
                  Volver al inicio de sesión
                </Link>
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
                        ref={(el) => { otpRefs.current[index] = el; }}
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
                            ? 'border-primary bg-primary/5 text-primary' :'border-border bg-white text-foreground'
                        }`}
                      />
                    ))}
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={loading || getOtpValue().length < 6}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-primary text-white rounded-xl text-sm font-700 hover:bg-primary-700 disabled:opacity-60 transition-all duration-150 active:scale-95"
                >
                  {loading ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    'Verificar código'
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => { setErrorMsg(null); resetOtpDigits(); setStep('email'); }}
                  className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  ← Cambiar correo electrónico
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
                        passwordForm.formState.errors.password ? 'border-red-400 bg-red-50' : 'border-border bg-white'
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
                    <p className="text-[11px] text-red-600 mt-1">{passwordForm.formState.errors.password.message}</p>
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
                        passwordForm.formState.errors.confirmPassword ? 'border-red-400 bg-red-50' : 'border-border bg-white'
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
                    <p className="text-[11px] text-red-600 mt-1">{passwordForm.formState.errors.confirmPassword.message}</p>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-primary text-white rounded-xl text-sm font-700 hover:bg-primary-700 disabled:opacity-60 transition-all duration-150 active:scale-95"
                >
                  {loading ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
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
                Tu contraseña ha sido restablecida exitosamente. Ya puedes iniciar sesión con tu nueva contraseña.
              </p>
              <Link
                href="/login"
                className="inline-flex items-center justify-center w-full py-3 bg-primary text-white rounded-xl text-sm font-700 hover:bg-primary-700 transition-all duration-150 active:scale-95"
              >
                Ir al inicio de sesión
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
