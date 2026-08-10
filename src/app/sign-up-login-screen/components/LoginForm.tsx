'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';

import {
  Eye,
  EyeOff,
  AlertTriangle,
  ShieldAlert,
  Mail,
  Fingerprint,
  RefreshCw,
  CheckCircle2,
  ChevronDown,
} from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useSearchParams } from 'next/navigation';

interface Props {
  onSwitchToSignup: () => void;
}

type AuthTab = 'password' | 'otp' | 'biometric';

const formatDisplayName = (name: string) =>
  name
    .trim()
    .toLocaleLowerCase('es-MX')
    .replace(
      /(^|[\s-])([a-záéíóúüñ])/g,
      (_, prefix: string, letter: string) => `${prefix}${letter.toLocaleUpperCase('es-MX')}`
    );

// ── WebAuthn Device type ───────────────────────────────────────────────────
interface WebAuthnDevice {
  id: string;
  device_name: string | null;
  os: string | null;
  browser: string | null;
  registered_at: string | null;
  registration_method: string | null;
}

// ── OTP Input (6 boxes) ────────────────────────────────────────────────────
function OtpInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(6, ' ').slice(0, 6).split('');

  const handleKey = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      const next = digits
        .map((d, idx) => (idx === i ? '' : d))
        .join('')
        .trimEnd()
        .padEnd(6, ' ')
        .slice(0, 6);
      onChange(next.trimEnd());
      if (i > 0) inputs.current[i - 1]?.focus();
    }
  };

  const handleChange = (i: number, v: string) => {
    const char = v.replace(/\D/g, '').slice(-1);
    const next = digits.map((d, idx) => (idx === i ? char || ' ' : d)).join('');
    onChange(next.trimEnd());
    if (char && i < 5) inputs.current[i + 1]?.focus();
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    onChange(pasted);
    const focusIdx = Math.min(pasted.length, 5);
    inputs.current[focusIdx]?.focus();
    e.preventDefault();
  };

  return (
    <div className="flex gap-2 justify-center" onPaste={handlePaste}>
      {Array.from({ length: 6 }).map((_, i) => (
        <input
          key={i}
          ref={(el) => {
            inputs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digits[i]?.trim() || ''}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKey(i, e)}
          className="h-12 w-11 rounded-md border border-border bg-white text-center text-lg font-700 transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      ))}
    </div>
  );
}

// ── Countdown Timer ────────────────────────────────────────────────────────
function CountdownTimer({ seconds, onExpire }: { seconds: number; onExpire: () => void }) {
  const [remaining, setRemaining] = useState(seconds);
  const expiredRef = useRef(false);

  useEffect(() => {
    expiredRef.current = false;
    setRemaining(seconds);
    const interval = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          if (!expiredRef.current) {
            expiredRef.current = true;
            onExpire();
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [seconds, onExpire]);

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const pct = (remaining / seconds) * 100;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative w-14 h-14">
        <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
          <circle cx="28" cy="28" r="24" fill="none" stroke="#e5e7eb" strokeWidth="4" />
          <circle
            cx="28"
            cy="28"
            r="24"
            fill="none"
            stroke={remaining < 30 ? '#ef4444' : '#6366f1'}
            strokeWidth="4"
            strokeDasharray={`${2 * Math.PI * 24}`}
            strokeDashoffset={`${2 * Math.PI * 24 * (1 - pct / 100)}`}
            className="transition-all duration-1000"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-xs font-700 text-foreground">
          {mins}:{secs.toString().padStart(2, '0')}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Código válido por {mins}:{secs.toString().padStart(2, '0')}
      </p>
    </div>
  );
}

// ── Accordion Item ─────────────────────────────────────────────────────────
function AccordionItem({
  id: _id,
  icon,
  label,
  sublabel,
  isOpen,
  onToggle,
  children,
}: {
  id: AuthTab;
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`overflow-hidden rounded-lg border bg-white transition-colors duration-200 ${isOpen ? 'border-primary' : 'border-border hover:border-primary/40'}`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3.5 text-left"
      >
        <div className="flex items-center gap-3">
          <div
            className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md transition-colors ${isOpen ? 'bg-primary text-white' : 'bg-muted text-muted-foreground'}`}
          >
            {icon}
          </div>
          <div>
            <p
              className={`text-sm font-700 leading-tight transition-colors ${isOpen ? 'text-primary' : 'text-foreground'}`}
            >
              {label}
            </p>
            {sublabel && <p className="text-[11px] text-muted-foreground mt-0.5">{sublabel}</p>}
          </div>
        </div>
        <ChevronDown
          size={18}
          className={`text-muted-foreground flex-shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180 text-primary' : ''}`}
        />
      </button>
      {isOpen && <div className="border-t border-border px-4 pb-4 pt-1">{children}</div>}
    </div>
  );
}

export default function LoginForm({ onSwitchToSignup: _onSwitchToSignup }: Props) {
  const searchParams = useSearchParams();

  // ── Step 1: email ──────────────────────────────────────────────────────
  const [emailValue, setEmailValue] = useState('');
  const [emailError, setEmailError] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [userName, setUserName] = useState<string | null>(null);
  const [isRegisteredUser, setIsRegisteredUser] = useState(false);

  // ── Step 2: auth accordion ─────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<AuthTab>('password');
  const [availableTabs, setAvailableTabs] = useState<AuthTab[]>(['password']);

  // Password tab state
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [newDeviceWarning, setNewDeviceWarning] = useState<string | null>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  // OTP tab state
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpExpired, setOtpExpired] = useState(false);
  const [otpTimerKey, setOtpTimerKey] = useState(0);

  // Biometric tab state
  const [biometricLoading, setBiometricLoading] = useState(false);
  const [biometricError, setBiometricError] = useState<string | null>(null);
  const [biometricLabel, setBiometricLabel] = useState('Biométrico');
  const [webAuthnDevices, setWebAuthnDevices] = useState<WebAuthnDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const passwordEnabled = emailValue.trim().length > 0;

  const resetAuthReveal = () => {
    setUserName(null);
    setIsRegisteredUser(false);
    setAvailableTabs(['password']);
    setActiveTab('password');
    setPassword('');
    setPasswordError(null);
    setNewDeviceWarning(null);
    setOtpCode('');
    setOtpSent(false);
    setOtpError(null);
    setOtpExpired(false);
    setBiometricError(null);
    setWebAuthnDevices([]);
    setSelectedDeviceId(null);
  };

  const handleEmailChange = (value: string) => {
    setEmailValue(value);
    setEmailError('');
    resetAuthReveal();
  };

  // ── Step 1: Continue ───────────────────────────────────────────────────
  const handleContinue = async () => {
    const trimmed = emailValue.trim();
    if (!trimmed || !/^\S+@\S+\.\S+$/.test(trimmed)) {
      setEmailError('Ingresa un correo electrónico válido.');
      return;
    }
    setEmailError('');
    setEmailLoading(true);
    setUserName(null);
    setIsRegisteredUser(false);
    setAvailableTabs(['password']);
    setActiveTab('password');
    setPasswordError(null);
    setNewDeviceWarning(null);
    setOtpCode('');
    setOtpSent(false);
    setOtpError(null);
    setOtpExpired(false);
    setBiometricError(null);

    try {
      const tabs: AuthTab[] = ['password'];

      const res = await fetch('/api/auth/check-login-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      });
      const data = await res.json();

      setUserName(data.nombre || null);
      setWebAuthnDevices(data.webAuthnDevices || []);
      setSelectedDeviceId(null);
      setIsRegisteredUser(!!data.found);

      if (data.found) {
        if (data.emailVerified) {
          tabs.push('otp');
        }
        if (data.hasWebAuthn) {
          tabs.push('biometric');
        }
      }

      setAvailableTabs(tabs);
      setActiveTab('password');
    } catch {
      setUserName(null);
      setAvailableTabs(['password']);
    } finally {
      setEmailLoading(false);
    }
  };

  useEffect(() => {
    const trimmed = emailValue.trim();
    if (!trimmed || !/^\S+@\S+\.\S+$/.test(trimmed)) {
      return;
    }

    const timeout = window.setTimeout(() => {
      handleContinue();
    }, 550);

    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailValue]);

  // ── Helper: collect client-side device metadata ────────────────────────
  const getDeviceMeta = () => ({
    userAgent: navigator.userAgent,
    screenResolution:
      typeof window !== 'undefined' ? `${window.screen.width}x${window.screen.height}` : undefined,
    language: navigator.language || undefined,
    platform: navigator.platform || undefined,
    deviceFingerprint:
      typeof window !== 'undefined'
        ? btoa(
            [
              navigator.userAgent,
              navigator.language,
              window.screen.width,
              window.screen.height,
              navigator.hardwareConcurrency || 0,
            ].join('|')
          ).slice(0, 64)
        : undefined,
  });

  // ── Password login ─────────────────────────────────────────────────────
  const handlePasswordLogin = async () => {
    if (!emailValue.trim() || !/^\S+@\S+\.\S+$/.test(emailValue.trim())) {
      setEmailError('Ingresa un correo electrónico válido.');
      return;
    }
    if (!password) {
      setPasswordError('Ingresa tu contraseña.');
      return;
    }
    setPasswordError(null);
    setNewDeviceWarning(null);
    setPasswordLoading(true);

    try {
      const supabase = createClient();
      const { data: authData, error } = await supabase.auth.signInWithPassword({
        email: emailValue.trim(),
        password,
      });

      if (error) {
        try {
          await fetch('/api/security/log-access', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: null,
              email: emailValue.trim(),
              loginSuccess: false,
              authMethod: 'password',
              ...getDeviceMeta(),
            }),
          });
        } catch {
          /* non-blocking */
        }
        setPasswordError('Credenciales incorrectas. Verifica tu correo y contraseña.');
        setPasswordLoading(false);
        return;
      }

      try {
        await fetch('/api/security/log-access', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: authData.user?.id || null,
            email: emailValue.trim(),
            loginSuccess: true,
            authMethod: 'password',
            ...getDeviceMeta(),
          }),
        });
      } catch {
        /* non-blocking */
      }

      // ── Check TOTP (only on password auth) ──────────────────────────────
      if (authData.user?.id) {
        try {
          const totpRes = await fetch('/api/auth/totp/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: authData.user.id }),
          });
          const totpData = await totpRes.json();
          if (totpData.totpEnabled) {
            const redirectParam = searchParams?.get('redirect');
            const finalRedirect =
              redirectParam === '/visor-documento'
                ? '/mis-participaciones'
                : '/documents-dashboard';
            window.location.href = `/auth/totp-verification?userId=${authData.user.id}&redirect=${encodeURIComponent(finalRedirect)}`;
            return;
          }
        } catch {
          /* non-blocking */
        }
      }

      // Device check
      if (authData.user?.id) {
        try {
          const { data: profile } = await supabase
            .from('user_profiles')
            .select('full_name')
            .eq('id', authData.user.id)
            .maybeSingle();
          const res = await fetch('/api/security/check-device', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: authData.user.id,
              userEmail: emailValue.trim(),
              userName: profile?.full_name || undefined,
            }),
          });
          const deviceResult = await res.json();
          if (deviceResult.isNewDevice) {
            const { browser, os, city, country } = deviceResult.device || {};
            const location = [city, country].filter(Boolean).join(', ');
            const deviceLabel = [browser, os].filter(Boolean).join(' en ');
            setNewDeviceWarning(
              `Inicio de sesión desde un nuevo dispositivo: ${deviceLabel}${location ? ` (${location})` : ''}. Se ha enviado una alerta a tu correo.`
            );
          }
        } catch {
          /* non-blocking */
        }
      }

      const redirectParam = searchParams?.get('redirect');
      window.location.href =
        redirectParam === '/visor-documento' ? '/mis-participaciones' : '/documents-dashboard';
    } catch {
      setPasswordError('Error de conexión. Intenta nuevamente.');
      setPasswordLoading(false);
    }
  };

  // ── OTP Email ──────────────────────────────────────────────────────────
  const sendOtp = useCallback(async () => {
    setOtpLoading(true);
    setOtpError(null);
    setOtpExpired(false);
    setOtpCode('');
    try {
      const res = await fetch('/api/auth/send-login-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailValue.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setOtpError(data.error || 'No se pudo enviar el código. Verifica tu correo.');
      } else {
        setOtpSent(true);
        setOtpTimerKey((k) => k + 1);
      }
    } catch {
      setOtpError('Error de conexión. Intenta nuevamente.');
    } finally {
      setOtpLoading(false);
    }
  }, [emailValue]);

  useEffect(() => {
    if (activeTab === 'otp' && !otpSent && !otpLoading) {
      sendOtp();
    }
  }, [activeTab]);

  const handleOtpVerify = async () => {
    if (otpCode.replace(/\s/g, '').length < 6) {
      setOtpError('Ingresa el código de 6 dígitos.');
      return;
    }
    setOtpLoading(true);
    setOtpError(null);
    try {
      const res = await fetch('/api/auth/verify-login-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailValue.trim(), code: otpCode.replace(/\s/g, '') }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        try {
          await fetch('/api/security/log-access', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: null,
              email: emailValue.trim(),
              loginSuccess: false,
              authMethod: 'otp',
              ...getDeviceMeta(),
            }),
          });
        } catch {
          /* non-blocking */
        }
        setOtpError(data.error || 'Código incorrecto o expirado. Intenta de nuevo.');
        setOtpLoading(false);
        return;
      }

      // Exchange the token hash for a real Supabase session
      if (data.tokenHash) {
        const supabase = createClient();
        const { error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: data.tokenHash,
          type: 'magiclink',
        });
        if (verifyError) {
          console.error('[handleOtpVerify] verifyOtp error:', verifyError);
          setOtpError('No se pudo iniciar la sesión. Intenta de nuevo.');
          setOtpLoading(false);
          return;
        }
      }

      try {
        await fetch('/api/security/log-access', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: data.userId || null,
            email: emailValue.trim(),
            loginSuccess: true,
            authMethod: 'otp',
            ...getDeviceMeta(),
          }),
        });
      } catch {
        /* non-blocking */
      }
      const redirectParam = searchParams?.get('redirect');
      window.location.href =
        redirectParam === '/visor-documento' ? '/mis-participaciones' : '/documents-dashboard';
    } catch {
      setOtpError('Error de conexión. Intenta nuevamente.');
      setOtpLoading(false);
    }
  };

  // ── Biometric ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (activeTab !== 'biometric') return;
    (async () => {
      try {
        const { browserSupportsWebAuthn, platformAuthenticatorIsAvailable } =
          await import('@simplewebauthn/browser');
        const ua = navigator.userAgent;
        const os = /iPhone|iPad/.test(ua)
          ? 'iOS'
          : /Android/.test(ua)
            ? 'Android'
            : /Mac OS X/.test(ua)
              ? 'macOS'
              : /Windows/.test(ua)
                ? 'Windows'
                : 'Unknown';
        const platformOk = browserSupportsWebAuthn() && (await platformAuthenticatorIsAvailable());
        if (!platformOk) {
          setBiometricLabel('Biométrico');
          return;
        }
        if (os === 'iOS') setBiometricLabel('Face ID / Touch ID');
        else if (os === 'Android') setBiometricLabel('Huella dactilar');
        else if (os === 'macOS') setBiometricLabel('Touch ID');
        else if (os === 'Windows') setBiometricLabel('Windows Hello');
        else setBiometricLabel('Biométrico');
      } catch {
        setBiometricLabel('Biométrico');
      }
    })();
  }, [activeTab]);

  const handleBiometricLogin = async () => {
    setBiometricLoading(true);
    setBiometricError(null);
    try {
      const { startAuthentication } = await import('@simplewebauthn/browser');
      const optRes = await fetch('/api/webauthn/auth-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailValue.trim() }),
      });
      if (!optRes.ok) {
        const e = await optRes.json();
        setBiometricError(e.error || 'No se encontraron dispositivos registrados.');
        setBiometricLoading(false);
        return;
      }
      const options = await optRes.json();
      const credential = await startAuthentication(options);
      const verifyRes = await fetch('/api/webauthn/auth-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: emailValue.trim(),
          credential,
          context: 'browser_desktop',
          credentialId: selectedDeviceId || undefined,
        }),
      });
      if (!verifyRes.ok) {
        const e = await verifyRes.json();
        try {
          await fetch('/api/security/log-access', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: null,
              email: emailValue.trim(),
              loginSuccess: false,
              authMethod: 'biometric',
              ...getDeviceMeta(),
            }),
          });
        } catch {
          /* non-blocking */
        }
        setBiometricError(e.error || 'Autenticación biométrica fallida.');
        setBiometricLoading(false);
        return;
      }
      const verifyData = await verifyRes.json();

      // Set Supabase session from biometric auth response
      if (verifyData?.session?.access_token && verifyData?.session?.refresh_token) {
        try {
          const supabase = createClient();
          await supabase.auth.setSession({
            access_token: verifyData.session.access_token,
            refresh_token: verifyData.session.refresh_token,
          });
        } catch {
          /* non-blocking */
        }
      }

      try {
        await fetch('/api/security/log-access', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: verifyData?.userId || null,
            email: emailValue.trim(),
            loginSuccess: true,
            authMethod: 'biometric',
            ...getDeviceMeta(),
          }),
        });
      } catch {
        /* non-blocking */
      }
      const redirectParam = searchParams?.get('redirect');
      window.location.href =
        redirectParam === '/visor-documento' ? '/mis-participaciones' : '/documents-dashboard';
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'NotAllowedError') setBiometricError('Autenticación cancelada.');
      else if (name === 'NotSupportedError')
        setBiometricError('Este dispositivo no es compatible con autenticación biométrica.');
      else setBiometricError('Error en autenticación biométrica. Intenta de nuevo.');
      setBiometricLoading(false);
    }
  };

  const handleAccordionToggle = (tab: AuthTab) => {
    if (activeTab === tab) return; // keep at least one open
    setActiveTab(tab);
    setPasswordError(null);
    setOtpError(null);
    setBiometricError(null);
  };

  // ── RENDER ─────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="w-full">
        <div className="mb-7">
          {userName ? (
            <h2 className="text-2xl font-400 text-muted-foreground">
              Hola, <span className="font-700 text-foreground">{formatDisplayName(userName)}</span>
            </h2>
          ) : (
            <h2 className="text-2xl font-600 text-foreground">Bienvenido de vuelta</h2>
          )}
          <p className="text-sm text-muted-foreground mt-1">
            Ingresa tu correo electrónico y contraseña para continuar.
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-600 text-foreground mb-1">
              Correo electrónico <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              value={emailValue}
              onChange={(e) => handleEmailChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Tab' && !e.shiftKey && passwordEnabled) {
                  e.preventDefault();
                  window.requestAnimationFrame(() => passwordInputRef.current?.focus());
                  return;
                }
                if (e.key === 'Enter') {
                  handlePasswordLogin();
                }
              }}
              placeholder="tu@empresa.com"
              autoComplete="email"
              autoFocus
              className={`h-11 w-full rounded-lg border px-3 text-sm transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 ${emailError ? 'border-red-400 bg-red-50' : 'border-border bg-white'}`}
            />
            {emailError && <p className="text-[11px] text-red-600 mt-1">{emailError}</p>}
          </div>

          {passwordEnabled && (
            <>
              <div className="space-y-3">
                {newDeviceWarning && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <ShieldAlert size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-800">{newDeviceWarning}</p>
                  </div>
                )}

                {passwordError && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
                    <AlertTriangle size={13} className="text-red-600 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-red-700">{passwordError}</p>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-600 text-foreground">
                      Contraseña <span className="text-red-500">*</span>
                    </label>
                    <Link
                      href="/olvide-contrasena"
                      tabIndex={-1}
                      className="text-xs text-primary hover:underline font-500"
                    >
                      ¿Olvidaste tu contraseña?
                    </Link>
                  </div>
                  <div className="relative">
                    <input
                      ref={passwordInputRef}
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handlePasswordLogin();
                      }}
                      placeholder="Tu contraseña"
                      autoComplete="current-password"
                      disabled={!passwordEnabled}
                      className={`h-11 w-full rounded-lg border px-3 pr-10 text-sm transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 ${passwordError ? 'border-red-400 bg-red-50' : 'border-border bg-white'} disabled:bg-muted/60 disabled:text-muted-foreground`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      disabled={!passwordEnabled}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                <button
                  onClick={handlePasswordLogin}
                  disabled={passwordLoading || !passwordEnabled}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-700 text-white transition-colors hover:bg-primary/90 disabled:opacity-60"
                  style={{ minHeight: '44px' }}
                >
                  {passwordLoading ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    'Iniciar sesión'
                  )}
                </button>
              </div>

              {emailLoading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  Buscando opciones adicionales...
                </div>
              )}

              {availableTabs.some((tab) => tab !== 'password') && (
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-700 text-foreground">Opciones adicionales</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      También puedes iniciar sesión con otro método disponible.
                    </p>
                  </div>

                  {/* ── OTP ── */}
                  {availableTabs.includes('otp') && (
                    <AccordionItem
                      id="otp"
                      icon={<Mail size={17} />}
                      label="Ingresa con código OTP a tu correo"
                      sublabel="Recibirás un código de 6 dígitos"
                      isOpen={activeTab === 'otp'}
                      onToggle={() => handleAccordionToggle('otp')}
                    >
                      <div className="space-y-4 pt-2">
                        {otpError && (
                          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
                            <AlertTriangle
                              size={13}
                              className="text-red-600 flex-shrink-0 mt-0.5"
                            />
                            <p className="text-xs text-red-700">{otpError}</p>
                          </div>
                        )}
                        {otpLoading && !otpSent ? (
                          <div className="flex flex-col items-center gap-2 py-4">
                            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                            <p className="text-xs text-muted-foreground">Enviando código...</p>
                          </div>
                        ) : otpSent ? (
                          <>
                            <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
                              <CheckCircle2
                                size={13}
                                className="text-blue-600 flex-shrink-0 mt-0.5"
                              />
                              <p className="text-xs text-blue-700">
                                Se envió un código de 6 dígitos a <strong>{emailValue}</strong>.
                                Revisa tu bandeja de entrada.
                              </p>
                            </div>
                            <div className="flex justify-center">
                              {!otpExpired ? (
                                <CountdownTimer
                                  key={otpTimerKey}
                                  seconds={300}
                                  onExpire={() => setOtpExpired(true)}
                                />
                              ) : (
                                <div className="flex flex-col items-center gap-2">
                                  <p className="text-xs text-red-600 font-600">El código expiró.</p>
                                  <button
                                    onClick={sendOtp}
                                    className="flex items-center gap-1.5 text-xs text-primary hover:underline font-600"
                                  >
                                    <RefreshCw size={12} /> Reenviar código
                                  </button>
                                </div>
                              )}
                            </div>
                            {!otpExpired && (
                              <>
                                <OtpInput value={otpCode} onChange={setOtpCode} />
                                <button
                                  onClick={handleOtpVerify}
                                  disabled={otpLoading || otpCode.length < 6}
                                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-700 text-white transition-colors hover:bg-primary/90 disabled:opacity-60"
                                  style={{ minHeight: '44px' }}
                                >
                                  {otpLoading ? (
                                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                  ) : (
                                    'Verificar código'
                                  )}
                                </button>
                                <button
                                  onClick={sendOtp}
                                  disabled={otpLoading}
                                  className="w-full text-xs text-muted-foreground hover:text-primary transition-colors flex items-center justify-center gap-1"
                                >
                                  <RefreshCw size={11} /> Reenviar código
                                </button>
                              </>
                            )}
                          </>
                        ) : null}
                      </div>
                    </AccordionItem>
                  )}

                  {/* ── Biométrico ── */}
                  {availableTabs.includes('biometric') && (
                    <AccordionItem
                      id="biometric"
                      icon={<Fingerprint size={17} />}
                      label="Ingresa con tu biométrico"
                      sublabel={`Autenticación sin contraseña con ${biometricLabel}`}
                      isOpen={activeTab === 'biometric'}
                      onToggle={() => handleAccordionToggle('biometric')}
                    >
                      <div className="space-y-4 pt-2">
                        {biometricError && (
                          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
                            <AlertTriangle
                              size={13}
                              className="text-red-600 flex-shrink-0 mt-0.5"
                            />
                            <p className="text-xs text-red-700">{biometricError}</p>
                          </div>
                        )}

                        {/* Device selector — shown only when 2+ devices registered */}
                        {webAuthnDevices.length > 1 && (
                          <div className="space-y-2">
                            <p className="text-xs font-600 text-foreground">
                              Selecciona el dispositivo con el que deseas autenticarte:
                            </p>
                            <div className="space-y-2">
                              {webAuthnDevices.map((device) => {
                                const isSelected = selectedDeviceId === device.id;
                                const label =
                                  device.device_name ||
                                  [device.browser, device.os].filter(Boolean).join(' en ') ||
                                  'Dispositivo';
                                const regDate = device.registered_at
                                  ? new Date(device.registered_at).toLocaleDateString('es-MX', {
                                      day: '2-digit',
                                      month: 'short',
                                      year: 'numeric',
                                    })
                                  : null;
                                const methodLabel: Record<string, string> = {
                                  direct: 'Registro directo',
                                  qr: 'Registro QR',
                                  stepup: 'Step-up',
                                };
                                return (
                                  <button
                                    key={device.id}
                                    type="button"
                                    onClick={() =>
                                      setSelectedDeviceId(isSelected ? null : device.id)
                                    }
                                    className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-all duration-150 ${
                                      isSelected
                                        ? 'border-primary bg-primary/5 shadow-sm shadow-primary/10'
                                        : 'border-border bg-white hover:border-primary/40'
                                    }`}
                                  >
                                    <div
                                      className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md ${isSelected ? 'bg-primary text-white' : 'bg-muted text-muted-foreground'}`}
                                    >
                                      <Fingerprint size={18} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p
                                        className={`text-sm font-600 truncate ${isSelected ? 'text-primary' : 'text-foreground'}`}
                                      >
                                        {label}
                                      </p>
                                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                        {device.os && (
                                          <span className="text-[10px] text-muted-foreground">
                                            {device.os}
                                          </span>
                                        )}
                                        {device.browser && (
                                          <span className="text-[10px] text-muted-foreground">
                                            · {device.browser}
                                          </span>
                                        )}
                                        {device.registration_method && (
                                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                                            {methodLabel[device.registration_method] ||
                                              device.registration_method}
                                          </span>
                                        )}
                                        {regDate && (
                                          <span className="text-[10px] text-muted-foreground">
                                            · {regDate}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    {isSelected && (
                                      <div className="w-4 h-4 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                                        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                                          <path
                                            d="M1 4l2 2 4-4"
                                            stroke="white"
                                            strokeWidth="1.5"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                          />
                                        </svg>
                                      </div>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                            {selectedDeviceId === null && (
                              <p className="text-[11px] text-muted-foreground text-center">
                                Selecciona un dispositivo o usa cualquiera disponible
                              </p>
                            )}
                          </div>
                        )}

                        {/* Single device or no selection — show fingerprint icon */}
                        {webAuthnDevices.length <= 1 && (
                          <div className="flex flex-col items-center gap-3 py-2">
                            <div
                              className={`w-16 h-16 rounded-full flex items-center justify-center ${biometricLoading ? 'bg-primary/10 animate-pulse' : 'bg-primary/5'}`}
                            >
                              <Fingerprint
                                size={32}
                                className={
                                  biometricLoading
                                    ? 'text-primary animate-pulse'
                                    : 'text-primary/60'
                                }
                              />
                            </div>
                            <p className="text-xs text-center text-muted-foreground">
                              Usa <strong>{biometricLabel}</strong> para autenticarte sin
                              contraseña.
                            </p>
                            <p className="text-[10px] text-center text-muted-foreground/70">
                              FIDO2 Certified · Tu biométrico nunca sale del dispositivo
                            </p>
                          </div>
                        )}

                        <button
                          onClick={handleBiometricLogin}
                          disabled={biometricLoading}
                          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-700 text-white transition-colors hover:bg-primary/90 disabled:opacity-60"
                          style={{ minHeight: '44px' }}
                        >
                          {biometricLoading ? (
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <>
                              <Fingerprint size={15} />
                              {webAuthnDevices.length > 1 && selectedDeviceId
                                ? `Entrar con dispositivo seleccionado`
                                : `Entrar con ${biometricLabel}`}
                            </>
                          )}
                        </button>
                      </div>
                    </AccordionItem>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {!isRegisteredUser && (
          <p className="mt-5 text-center text-sm text-muted-foreground">
            ¿No tienes cuenta?{' '}
            <Link href="/registro" className="text-primary font-600 hover:underline">
              Crear cuenta
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
