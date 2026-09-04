'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Image from 'next/image';
import { QRCodeSVG } from 'qrcode.react';
import {
  X,
  Shield,
  Copy,
  Check,
  Loader2,
  AlertCircle,
  CheckCircle,
  Smartphone,
  Eye,
  EyeOff,
  Lock,
  Download,
  ScanLine,
  ArrowRight,
  ExternalLink,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

interface TotpSetupModalProps {
  onClose?: () => void;
  onSuccess: () => void;
  mandatory?: boolean;
  requiredAuthenticator?: AuthenticatorId;
}

type Step = 'instructions' | 'qr' | 'password' | 'verify' | 'success';

type AuthenticatorId = 'google' | 'microsoft';

const AUTHENTICATOR_APPS: Array<{
  id: AuthenticatorId;
  name: string;
  logoSrc: string;
  setupAction: string;
  downloads: Array<{
    platform: 'Android' | 'iOS';
    store: 'Google Play' | 'App Store';
    url: string;
  }>;
}> = [
  {
    id: 'google',
    name: 'Google Authenticator',
    logoSrc: '/assets/authenticators/google-authenticator.png',
    setupAction: 'Toca el botón + y elige “Escanear un código QR”.',
    downloads: [
      {
        platform: 'Android',
        store: 'Google Play',
        url: 'https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2&hl=es_MX',
      },
      {
        platform: 'iOS',
        store: 'App Store',
        url: 'https://apps.apple.com/es/app/google-authenticator/id388497605',
      },
    ],
  },
  {
    id: 'microsoft',
    name: 'Microsoft Authenticator',
    logoSrc: '/assets/authenticators/microsoft-authenticator.png',
    setupAction: 'Toca el botón +, elige “Otra cuenta” y después “Escanear código QR”.',
    downloads: [
      {
        platform: 'Android',
        store: 'Google Play',
        url: 'https://play.google.com/store/apps/details?id=com.azure.authenticator&hl=es_MX',
      },
      {
        platform: 'iOS',
        store: 'App Store',
        url: 'https://apps.apple.com/es/app/microsoft-authenticator/id983156458',
      },
    ],
  },
];

export default function TotpSetupModal({
  onClose,
  onSuccess,
  mandatory = false,
  requiredAuthenticator,
}: TotpSetupModalProps) {
  const [step, setStep] = useState<Step>('instructions');
  const [loading, setLoading] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [manualSecret, setManualSecret] = useState('');
  const [accountName, setAccountName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [selectedAuthenticator, setSelectedAuthenticator] = useState<AuthenticatorId>('google');
  const [appReady, setAppReady] = useState(false);
  const [accountLinked, setAccountLinked] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const setupRequestActiveRef = useRef(false);

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
    if (setupRequestActiveRef.current) return;
    setupRequestActiveRef.current = true;
    setLoading(true);
    setError(null);
    setErrorCode(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
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
      setAccountLinked(false);
      setStep('qr');
    } catch {
      setError('Error de conexión. Intenta nuevamente.');
    } finally {
      setupRequestActiveRef.current = false;
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
      const {
        data: { user },
      } = await supabase.auth.getUser();
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
    setErrorCode(null);
    setAttemptsLeft(null);
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
    setError(null);
    setErrorCode(null);
    setAttemptsLeft(null);
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
    setErrorCode(null);
    setAttemptsLeft(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
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
        setErrorCode(data.errorCode || null);
        setAttemptsLeft(typeof data.attemptsLeft === 'number' ? data.attemptsLeft : null);
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
  const availableAuthenticatorApps = requiredAuthenticator
    ? AUTHENTICATOR_APPS.filter((app) => app.id === requiredAuthenticator)
    : AUTHENTICATOR_APPS;
  const selectedApp =
    availableAuthenticatorApps.find((app) => app.id === selectedAuthenticator) ||
    availableAuthenticatorApps[0];

  const returnToQr = () => {
    setDigits(['', '', '', '', '', '']);
    setError(null);
    setErrorCode(null);
    setAttemptsLeft(null);
    setAccountLinked(false);
    setStep('qr');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/45 p-4 backdrop-blur-[2px]">
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-border bg-white shadow-xl">
        {/* Header */}
        <div className="flex min-h-16 items-center justify-between border-b border-border px-6 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Shield size={19} className="text-primary" />
            </div>
            <div>
              <h2 className="text-base font-600 text-foreground">
                {requiredAuthenticator
                  ? `Configurar ${selectedApp.name}`
                  : 'Configurar app autenticadora'}
              </h2>
              <p className="text-sm text-muted-foreground">Verificación en dos pasos (TOTP)</p>
            </div>
          </div>
          {mandatory ? (
            <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-600 text-amber-800">
              Obligatorio
            </span>
          ) : (
            <button
              onClick={onClose}
              aria-label="Cerrar"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {/* Step: Instructions */}
          {step === 'instructions' && (
            <div className="flex flex-col gap-5">
              <div>
                <p className="mb-1 text-xs font-600 uppercase text-primary">Paso 1 de 2</p>
                <h3 className="text-xl font-600 text-foreground">Prepara tu app autenticadora</h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {requiredAuthenticator
                    ? `Instala ${selectedApp.name} en tu teléfono y sigue las instrucciones para enlazar tu cuenta Docubox.`
                    : 'Instala una de estas aplicaciones en tu teléfono y sigue las instrucciones para enlazar tu cuenta Docubox.'}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {availableAuthenticatorApps.map((app) => (
                  <button
                    key={app.id}
                    type="button"
                    onClick={() => {
                      setSelectedAuthenticator(app.id);
                      setAppReady(false);
                    }}
                    className={`flex min-h-20 items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                      selectedAuthenticator === app.id
                        ? 'border-primary bg-primary/[0.04]'
                        : 'border-border bg-white hover:bg-muted/40'
                    }`}
                  >
                    <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-white p-1.5">
                      <Image
                        src={app.logoSrc}
                        alt={`Logo de ${app.name}`}
                        width={36}
                        height={36}
                        className="h-full w-full object-contain"
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-600 text-foreground">{app.name}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        iOS y Android
                      </span>
                    </span>
                    <span
                      className={`h-4 w-4 flex-shrink-0 rounded-full border-2 ${
                        selectedAuthenticator === app.id
                          ? 'border-[5px] border-primary'
                          : 'border-muted-foreground/40'
                      }`}
                    />
                  </button>
                ))}
              </div>

              <div className="overflow-hidden rounded-lg border border-border bg-muted/20">
                <div className="border-b border-border bg-white px-4 py-3">
                  <p className="text-sm font-600 text-foreground">
                    Cómo descargar y enlazar {selectedApp.name}
                  </p>
                </div>
                <ol className="divide-y divide-border">
                  <li className="flex gap-3 px-4 py-3">
                    <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-700 text-primary">
                      1
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-600 text-foreground">Descarga la aplicación</p>
                      <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                        Escanea el código de tu plataforma o abre directamente la tienda desde este
                        dispositivo.
                      </p>
                      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {selectedApp.downloads.map((download) => (
                          <div
                            key={download.platform}
                            className="rounded-lg border border-border bg-white p-3"
                          >
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <div>
                                <p className="text-sm font-600 text-foreground">
                                  {download.platform}
                                </p>
                                <p className="text-[11px] text-muted-foreground">
                                  {download.store}
                                </p>
                              </div>
                              <Download size={15} className="text-muted-foreground" />
                            </div>
                            <a
                              href={download.url}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`Descargar ${selectedApp.name} para ${download.platform}`}
                              className="mx-auto flex w-fit rounded-lg border border-border bg-white p-2 transition-colors hover:border-primary/40"
                            >
                              <QRCodeSVG
                                value={download.url}
                                size={104}
                                level="M"
                                includeMargin={false}
                              />
                            </a>
                            <p className="mt-2 text-center text-[10px] text-muted-foreground">
                              Escanea para descargar
                            </p>
                            <a
                              href={download.url}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-border text-xs font-600 text-foreground transition-colors hover:bg-muted"
                            >
                              Abrir {download.store}
                              <ExternalLink size={12} />
                            </a>
                          </div>
                        ))}
                      </div>
                      <p className="mt-3 text-[11px] leading-4 text-muted-foreground">
                        Estos QR solo abren la tienda. El código para enlazar tu cuenta Docubox se
                        mostrará después de continuar.
                      </p>
                    </div>
                  </li>
                  <li className="flex gap-3 px-4 py-3">
                    <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-700 text-primary">
                      2
                    </span>
                    <div>
                      <p className="text-sm font-600 text-foreground">Prepara el escáner</p>
                      <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                        {selectedApp.setupAction}
                      </p>
                    </div>
                    <ScanLine
                      size={16}
                      className="ml-auto mt-1 flex-shrink-0 text-muted-foreground"
                    />
                  </li>
                  <li className="flex gap-3 px-4 py-3">
                    <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-700 text-primary">
                      3
                    </span>
                    <div>
                      <p className="text-sm font-600 text-foreground">Regresa a Docubox</p>
                      <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                        Continúa para mostrar el código QR. No cierres esta ventana mientras enlazas
                        la cuenta.
                      </p>
                    </div>
                    <ArrowRight
                      size={16}
                      className="ml-auto mt-1 flex-shrink-0 text-muted-foreground"
                    />
                  </li>
                </ol>
              </div>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-white px-4 py-3">
                <input
                  type="checkbox"
                  checked={appReady}
                  onChange={(event) => setAppReady(event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-border accent-primary"
                />
                <span>
                  <span className="block text-sm font-600 text-foreground">
                    Ya instalé {selectedApp.name}
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                    La aplicación está abierta y lista para escanear el código QR.
                  </span>
                </span>
              </label>

              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
                  <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-700">{error}</p>
                </div>
              )}

              <button
                onClick={startSetup}
                disabled={loading || !appReady}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-600 text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {loading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <ArrowRight size={16} />
                )}
                {loading ? 'Generando...' : 'Continuar al código QR'}
              </button>
            </div>
          )}

          {/* Step: QR Code */}
          {step === 'qr' && (
            <div className="flex flex-col gap-5">
              <div>
                <p className="mb-1 text-xs font-600 uppercase text-primary">Paso 2 de 2</p>
                <h3 className="text-xl font-600 text-foreground">Ahora enlaza Docubox</h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Abre {selectedApp.name} y escanea este código para agregar tu cuenta Docubox.
                </p>
              </div>

              <div className="flex items-start gap-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-3">
                <Image
                  src={selectedApp.logoSrc}
                  alt=""
                  width={32}
                  height={32}
                  className="h-8 w-8 rounded-lg object-contain"
                />
                <div>
                  <p className="text-sm font-600 text-blue-950">QR para enlazar tu cuenta</p>
                  <p className="mt-0.5 text-xs leading-5 text-blue-700">
                    Este QR no descarga la aplicación. Al escanearlo debe aparecer una entrada nueva
                    llamada Docubox en {selectedApp.name}.
                  </p>
                </div>
              </div>

              {/* QR Code */}
              <div className="flex flex-col items-center gap-3">
                <div className="rounded-lg border border-border bg-white p-3 shadow-sm">
                  {qrCodeUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={qrCodeUrl}
                      alt="Código QR para app autenticadora"
                      width={200}
                      height={200}
                      className="rounded-lg"
                    />
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
                  Si no puedes escanear el QR, introduce esta clave manualmente en tu app
                  autenticadora.
                </p>
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
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

              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-white px-3 py-3">
                <input
                  type="checkbox"
                  checked={accountLinked}
                  onChange={(event) => setAccountLinked(event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                />
                <span>
                  <span className="block text-sm font-600 text-foreground">
                    Ya escaneé este QR y veo Docubox
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                    Si ya tenías otra entrada Docubox, usa la que acabas de agregar.
                  </span>
                </span>
              </label>

              <button
                onClick={() => {
                  setPassword('');
                  setPasswordError(null);
                  setStep('password');
                }}
                disabled={!accountLinked}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-600 text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Smartphone size={16} />
                Continuar a la verificación
              </button>
            </div>
          )}

          {/* Step: Password confirmation */}
          {step === 'password' && (
            <div className="flex flex-col gap-5">
              <div className="text-center">
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-lg bg-primary/10">
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
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setPasswordError(null);
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && handlePasswordConfirm()}
                    placeholder="Ingresa tu contraseña"
                    autoFocus
                    className="w-full rounded-lg border border-border bg-white px-4 py-3 pr-11 text-sm text-foreground transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
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
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
                  <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-700">{passwordError}</p>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setStep('qr')}
                  disabled={passwordLoading}
                  className="h-10 flex-1 rounded-lg border border-border text-sm font-600 text-foreground transition-colors hover:bg-muted disabled:opacity-60"
                >
                  Atrás
                </button>
                <button
                  onClick={handlePasswordConfirm}
                  disabled={passwordLoading || !password.trim()}
                  className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-600 text-white transition-colors hover:bg-primary/90 disabled:opacity-60"
                >
                  {passwordLoading ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Lock size={15} />
                  )}
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
                  Ingresa el código de 6 dígitos generado por tu app autenticadora para confirmar la
                  configuración.
                </p>
              </div>

              {/* Inline 6-digit input */}
              <div className="flex justify-center gap-2">
                {digits.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      inputRefs.current[i] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleDigitChange(i, e.target.value)}
                    onKeyDown={(e) => handleDigitKeyDown(i, e)}
                    onPaste={i === 0 ? handleDigitPaste : undefined}
                    disabled={loading}
                    className={[
                      'w-11 h-14 rounded-lg border bg-white text-center text-xl font-700',
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
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
                  <div className="flex items-start gap-2">
                    <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs leading-5 text-red-700">{error}</p>
                      {attemptsLeft !== null && (
                        <p className="mt-1 text-xs font-600 text-red-700">
                          {attemptsLeft}{' '}
                          {attemptsLeft === 1 ? 'intento disponible' : 'intentos disponibles'}
                        </p>
                      )}
                    </div>
                  </div>
                  {errorCode === 'CODE_MISMATCH' && (
                    <button
                      type="button"
                      onClick={returnToQr}
                      className="mt-2 text-xs font-600 text-red-700 underline underline-offset-2"
                    >
                      Volver al QR para enlazar de nuevo
                    </button>
                  )}
                </div>
              )}

              <div className="flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
                <Shield size={13} className="text-blue-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-blue-700">
                  Los códigos cambian cada 30 segundos. Si el código no funciona, espera a que tu
                  app genere uno nuevo.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={returnToQr}
                  disabled={loading}
                  className="h-10 flex-1 rounded-lg border border-border text-sm font-600 text-foreground transition-colors hover:bg-muted disabled:opacity-60"
                >
                  Volver al QR
                </button>
                <button
                  onClick={handleVerify}
                  disabled={loading || code.length !== 6}
                  className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-600 text-white transition-colors hover:bg-primary/90 disabled:opacity-60"
                >
                  {loading ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <CheckCircle size={15} />
                  )}
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
                <h3 className="text-base font-700 text-foreground mb-1">
                  ¡App autenticadora activada!
                </h3>
                <p className="text-sm text-muted-foreground">
                  Tu cuenta ahora está protegida con autenticación de dos factores. A partir de
                  ahora necesitarás tu app autenticadora para iniciar sesión.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer cancel */}
        {step !== 'success' && (
          <div className="border-t border-border px-6 py-3">
            <button
              onClick={onClose}
              className="h-9 w-full rounded-lg text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Cancelar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
