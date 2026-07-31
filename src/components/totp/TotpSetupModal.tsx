'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, Shield, Copy, Check, Loader2, AlertCircle, CheckCircle, Smartphone, Eye, EyeOff, Lock } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

interface TotpSetupModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

type Step = 'instructions' | 'qr' | 'password' | 'verify' | 'success';

const AUTHENTICATOR_APPS = [
  { name: 'Google Authenticator', icon: '🔐', desc: 'iOS & Android' },
  { name: 'Microsoft Authenticator', icon: '🛡️', desc: 'iOS & Android' },
  { name: 'Authy', icon: '🔑', desc: 'iOS, Android & Desktop' },
  { name: '1Password', icon: '🗝️', desc: 'Multiplataforma' },
  { name: 'Bitwarden', icon: '🔒', desc: 'Multiplataforma' },
];

export default function TotpSetupModal({ onClose, onSuccess }: TotpSetupModalProps) {
  const [step, setStep] = useState<Step>('instructions');
  const [loading, setLoading] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [manualSecret, setManualSecret] = useState('');
  const [accountName, setAccountName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Password step
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordLoading, setPasswordLoading] = useState(false);

  // Verify step — simple inline 6-digit input
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const supabase = createClient();

  const startSetup = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setError('Sesión no válida. Por favor inicia sesión nuevamente.');
        return;
      }

      const res = await fetch('/api/auth/totp/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Error al iniciar configuración');
        return;
      }

      setQrCodeUrl(data.qrCodeUrl);
      setManualSecret(data.manualSecret);
      setAccountName(data.accountName);
      setStep('qr');
    } catch {
      setError('Error de conexión. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  // Confirm password before showing TOTP input
  const handlePasswordConfirm = async () => {
    if (!password.trim()) {
      setPasswordError('Ingresa tu contraseña para continuar.');
      return;
    }
    setPasswordLoading(true);
    setPasswordError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) {
        setPasswordError('No se pudo obtener el usuario actual.');
        return;
      }
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password,
      });
      if (signInError) {
        setPasswordError('Contraseña incorrecta. Intenta nuevamente.');
        return;
      }
      // Password correct — advance to TOTP verify step
      setDigits(['', '', '', '', '', '']);
      setError(null);
      setStep('verify');
    } catch {
      setPasswordError('Error de conexión. Intenta nuevamente.');
    } finally {
      setPasswordLoading(false);
    }
  };

  // Handle digit input
  const handleDigitChange = (index: number, value: string) => {
    const cleaned = value.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[index] = cleaned;
    setDigits(next);
    setError(null);
    if (cleaned && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleDigitKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (digits[index]) {
        const next = [...digits];
        next[index] = '';
        setDigits(next);
      } else if (index > 0) {
        inputRefs.current[index - 1]?.focus();
        const next = [...digits];
        next[index - 1] = '';
        setDigits(next);
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleDigitPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    const next = ['', '', '', '', '', ''];
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setDigits(next);
    const focusIdx = Math.min(pasted.length, 5);
    inputRefs.current[focusIdx]?.focus();
  };

  // Auto-focus first digit when entering verify step
  useEffect(() => {
    if (step === 'verify') {
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    }
  }, [step]);

  const code = digits.join('');

  const handleVerify = async () => {
    if (code.length !== 6) {
      setError('Ingresa los 6 dígitos del código');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setError('Sesión no válida');
        return;
      }

      const res = await fetch('/api/auth/totp/verify-setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ code }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Código incorrecto');
        setDigits(['', '', '', '', '', '']);
        setTimeout(() => inputRefs.current[0]?.focus(), 50);
        return;
      }

      setStep('success');
      setTimeout(() => {
        onSuccess();
      }, 2000);
    } catch {
      setError('Error de conexión. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  const copySecret = async () => {
    try {
      await navigator.clipboard.writeText(manualSecret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  const formatSecret = (s: string) => s.match(/.{1,4}/g)?.join(' ') || s;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Shield size={18} className="text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-700 text-foreground">Configurar app autenticadora</h2>
              <p className="text-xs text-muted-foreground">Autenticación de dos factores TOTP</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors text-muted-foreground"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-5 overflow-y-auto max-h-[70vh]">

          {/* Step: Instructions */}
          {step === 'instructions' && (
            <div className="flex flex-col gap-5">
              <div className="text-center">
                <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <Shield size={32} className="text-primary" />
                </div>
                <h3 className="text-base font-700 text-foreground mb-1">Protege tu cuenta</h3>
                <p className="text-sm text-muted-foreground">
                  Para proteger tu cuenta, escanea el código QR con una app autenticadora como las siguientes:
                </p>
              </div>

              <div className="grid grid-cols-1 gap-2">
                {AUTHENTICATOR_APPS.map((app) => (
                  <div key={app.name} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border bg-gray-50">
                    <span className="text-xl">{app.icon}</span>
                    <div>
                      <p className="text-sm font-600 text-foreground">{app.name}</p>
                      <p className="text-xs text-muted-foreground">{app.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              {error && (
                <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl">
                  <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-700">{error}</p>
                </div>
              )}

              <button
                onClick={startSetup}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-3 bg-primary text-white rounded-xl text-sm font-700 hover:bg-primary/90 disabled:opacity-60 transition-all"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Shield size={16} />}
                {loading ? 'Generando...' : 'Continuar'}
              </button>
            </div>
          )}

          {/* Step: QR Code */}
          {step === 'qr' && (
            <div className="flex flex-col gap-5">
              <div className="text-center">
                <h3 className="text-base font-700 text-foreground mb-1">Escanea el código QR</h3>
                <p className="text-xs text-muted-foreground">
                  Abre tu app autenticadora y escanea este código QR para agregar tu cuenta.
                </p>
              </div>

              {/* QR Code */}
              <div className="flex flex-col items-center gap-3">
                <div className="p-3 bg-white border-2 border-border rounded-2xl shadow-sm">
                  {qrCodeUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={qrCodeUrl} alt="Código QR para app autenticadora" width={200} height={200} className="rounded-lg" />
                  )}
                </div>
                <div className="text-center">
                  <p className="text-xs font-600 text-foreground">{accountName}</p>
                  <p className="text-xs text-muted-foreground">Emisor: Docubox</p>
                </div>
              </div>

              {/* Manual secret */}
              <div className="flex flex-col gap-2">
                <p className="text-xs text-muted-foreground text-center">
                  Si no puedes escanear el QR, introduce esta clave manualmente en tu app autenticadora.
                </p>
                <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 border border-border rounded-xl">
                  <code className="flex-1 text-xs font-mono text-foreground tracking-widest text-center">
                    {formatSecret(manualSecret)}
                  </code>
                  <button
                    onClick={copySecret}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-border text-xs text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                  >
                    {copied ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
                    {copied ? 'Copiado' : 'Copiar'}
                  </button>
                </div>
              </div>

              <button
                onClick={() => { setPassword(''); setPasswordError(null); setStep('password'); }}
                className="w-full flex items-center justify-center gap-2 py-3 bg-primary text-white rounded-xl text-sm font-700 hover:bg-primary/90 transition-all"
              >
                <Smartphone size={16} />
                Ya escaneé el código
              </button>
            </div>
          )}

          {/* Step: Password confirmation */}
          {step === 'password' && (
            <div className="flex flex-col gap-5">
              <div className="text-center">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <Lock size={28} className="text-primary" />
                </div>
                <h3 className="text-base font-700 text-foreground mb-1">Confirma tu contraseña</h3>
                <p className="text-sm text-muted-foreground">
                  Ingresa la contraseña de tu cuenta Docubox para continuar con la verificación.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-600 text-foreground">Contraseña de Docubox</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setPasswordError(null); }}
                    onKeyDown={(e) => e.key === 'Enter' && handlePasswordConfirm()}
                    placeholder="Ingresa tu contraseña"
                    autoFocus
                    className="w-full px-4 py-3 pr-11 border border-border rounded-xl text-sm text-foreground bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {passwordError && (
                <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl">
                  <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-700">{passwordError}</p>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setStep('qr')}
                  disabled={passwordLoading}
                  className="flex-1 py-2.5 border border-border rounded-xl text-sm font-600 text-foreground hover:bg-gray-50 transition-all disabled:opacity-60"
                >
                  Atrás
                </button>
                <button
                  onClick={handlePasswordConfirm}
                  disabled={passwordLoading || !password.trim()}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-primary text-white rounded-xl text-sm font-700 hover:bg-primary/90 disabled:opacity-60 transition-all"
                >
                  {passwordLoading ? <Loader2 size={15} className="animate-spin" /> : <Lock size={15} />}
                  {passwordLoading ? 'Verificando...' : 'Continuar'}
                </button>
              </div>
            </div>
          )}

          {/* Step: Verify — simple inline 6-digit input */}
          {step === 'verify' && (
            <div className="flex flex-col gap-5">
              <div className="text-center">
                <h3 className="text-base font-700 text-foreground mb-1">Verificar configuración</h3>
                <p className="text-sm text-muted-foreground">
                  Ingresa el código de 6 dígitos generado por tu app autenticadora para confirmar la configuración.
                </p>
              </div>

              {/* Inline 6-digit input */}
              <div className="flex justify-center gap-2">
                {digits.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => { inputRefs.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleDigitChange(i, e.target.value)}
                    onKeyDown={(e) => handleDigitKeyDown(i, e)}
                    onPaste={i === 0 ? handleDigitPaste : undefined}
                    disabled={loading}
                    className={[
                      'w-11 h-14 text-center text-xl font-700 rounded-xl border-2 bg-white',
                      'focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all',
                      'disabled:opacity-50 disabled:cursor-not-allowed',
                      error
                        ? 'border-red-400 text-red-600 focus:border-red-400'
                        : digit
                        ? 'border-primary text-foreground focus:border-primary'
                        : 'border-border text-foreground focus:border-primary',
                    ].join(' ')}
                  />
                ))}
              </div>

              {error && (
                <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl">
                  <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-700">{error}</p>
                </div>
              )}

              <div className="flex items-start gap-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-xl">
                <Shield size={13} className="text-blue-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-blue-700">Los códigos cambian cada 30 segundos. Si el código no funciona, espera a que tu app genere uno nuevo.</p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep('password')}
                  disabled={loading}
                  className="flex-1 py-2.5 border border-border rounded-xl text-sm font-600 text-foreground hover:bg-gray-50 transition-all disabled:opacity-60"
                >
                  Atrás
                </button>
                <button
                  onClick={handleVerify}
                  disabled={loading || code.length !== 6}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-primary text-white rounded-xl text-sm font-700 hover:bg-primary/90 disabled:opacity-60 transition-all"
                >
                  {loading ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle size={15} />}
                  {loading ? 'Verificando...' : 'Verificar y activar'}
                </button>
              </div>
            </div>
          )}

          {/* Step: Success */}
          {step === 'success' && (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle size={32} className="text-green-600" />
              </div>
              <div>
                <h3 className="text-base font-700 text-foreground mb-1">¡App autenticadora activada!</h3>
                <p className="text-sm text-muted-foreground">
                  Tu cuenta ahora está protegida con autenticación de dos factores. A partir de ahora necesitarás tu app autenticadora para iniciar sesión.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer cancel */}
        {step !== 'success' && (
          <div className="px-6 pb-5">
            <button
              onClick={onClose}
              className="w-full py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancelar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
