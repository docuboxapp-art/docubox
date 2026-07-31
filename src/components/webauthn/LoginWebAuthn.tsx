'use client';

import React, { useState, useEffect } from 'react';
import { useWebAuthn, SupportInfo } from '@/hooks/useWebAuthn';
import Link from 'next/link';

interface Props {
  email: string;
  onSuccess?: () => void;
}

export default function LoginWebAuthn({ email, onSuccess }: Props) {
  const { checkSupport, authenticateWithDevice, loading, error, setError } = useWebAuthn();
  const [support, setSupport] = useState<SupportInfo | null>(null);
  const [checking, setChecking] = useState(true);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let mounted = true;
    checkSupport().then((info) => {
      if (mounted) {
        setSupport(info);
        setChecking(false);
      }
    });
    return () => { mounted = false; };
  }, [checkSupport]);

  const handleBiometric = async () => {
    if (!email) {
      setError('Ingresa tu correo electrónico primero.');
      return;
    }
    setError(null);
    const result = await authenticateWithDevice(email);
    if (result.success) {
      setSuccess(true);
      // Set Supabase session from result if provided
      if (result.session) {
        // Session is already set server-side via cookie by the edge function
      }
      setTimeout(() => {
        if (onSuccess) onSuccess();
        else window.location.href = '/documents-dashboard';
      }, 800);
    }
  };

  const getButtonLabel = () => {
    if (!support) return null;
    switch (support.deviceType) {
      case 'face_id': return { icon: '👁️', label: 'Entrar con Face ID' };
      case 'touch_id': return { icon: '☝️', label: 'Entrar con Touch ID' };
      case 'windows_hello_face': case'windows_hello_fingerprint': case'windows_hello_pin': return { icon: '🪟', label: 'Entrar con Windows Hello' };
      case 'android_biometric': return { icon: '🔏', label: 'Entrar con huella dactilar' };
      default: return null;
    }
  };

  const getContextBadge = () => {
    if (!support) return null;
    const labels: Record<string, string> = {
      browser_mobile: 'Navegador móvil',
      browser_desktop: 'Navegador escritorio',
      capacitor_ios: 'App iOS',
      capacitor_android: 'App Android',
    };
    return labels[support.context] || null;
  };

  const btnInfo = getButtonLabel();
  const contextBadge = getContextBadge();

  return (
    <div className="w-full">
      {/* Firefox warning banner */}
      {support?.firefoxWarning && (
        <div className="mb-3 px-3 py-2 rounded-xl border border-amber-500/40 bg-amber-500/10 flex items-start gap-2">
          <span className="text-amber-400 text-sm mt-0.5">⚠️</span>
          <p className="text-xs text-amber-300">
            Para mejor experiencia biométrica usa Chrome o Safari.
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-3 px-3 py-2 rounded-xl border border-red-500/40 bg-red-500/10">
          <p className="text-xs text-red-400">{error}</p>
          {error.includes('Windows Hello') && (
            <div className="mt-2 text-xs text-red-300 space-y-0.5">
              <p className="font-semibold">Cómo configurar Windows Hello:</p>
              <p>1. Inicio → Configuración → Cuentas</p>
              <p>2. Opciones de inicio de sesión</p>
              <p>3. Windows Hello → Configurar</p>
            </div>
          )}
          {error.includes('Touch ID') && (
            <div className="mt-2 text-xs text-red-300 space-y-0.5">
              <p className="font-semibold">Cómo configurar Touch ID en Mac:</p>
              <p>1. Preferencias del Sistema → Touch ID</p>
              <p>2. Agregar huella dactilar</p>
            </div>
          )}
        </div>
      )}

      {/* Success */}
      {success && (
        <div className="mb-3 px-3 py-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 flex items-center gap-2">
          <span className="text-emerald-400">✅</span>
          <p className="text-xs text-emerald-300">Identidad verificada. Redirigiendo...</p>
        </div>
      )}

      {/* Biometric button */}
      {!checking && btnInfo && (
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={handleBiometric}
            disabled={loading || success}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all duration-150 active:scale-95 disabled:opacity-60"
            style={{
              minHeight: '48px',
              background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
              color: '#fff',
              border: '1px solid rgba(99,102,241,0.4)',
            }}
          >
            {loading ? (
              <>
                <span className="text-lg animate-pulse">{btnInfo.icon}</span>
                <span>Verificando...</span>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin ml-1" />
              </>
            ) : (
              <>
                <span className="text-lg">{btnInfo.icon}</span>
                <span>{btnInfo.label}</span>
              </>
            )}
          </button>

          {/* Context badge */}
          {contextBadge && (
            <span
              className="text-[10px] px-2 py-0.5 rounded-full font-medium"
              style={{ background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.25)' }}
            >
              {contextBadge}
            </span>
          )}
        </div>
      )}

      {/* Divider */}
      {!checking && btnInfo && (
        <div className="flex items-center gap-2 my-3">
          <div className="flex-1 h-px" style={{ background: '#1e293b' }} />
          <span className="text-[10px]" style={{ color: '#475569' }}>o</span>
          <div className="flex-1 h-px" style={{ background: '#1e293b' }} />
        </div>
      )}

      {/* Email fallback */}
      <div className="text-center">
        <Link
          href={`/sign-up-login-screen`}
          className="text-xs hover:underline transition-colors"
          style={{ color: '#6366f1' }}
        >
          Recibir código por correo electrónico
        </Link>
      </div>

      {/* FIDO2 badge */}
      <div className="mt-4 flex justify-center">
        <span
          className="text-[9px] px-2 py-1 rounded-full text-center leading-relaxed"
          style={{ background: 'rgba(16,185,129,0.1)', color: '#6ee7b7', border: '1px solid rgba(16,185,129,0.2)' }}
        >
          🔒 FIDO2 Certified · Sin contraseña · Tu biométrico nunca sale del dispositivo
        </span>
      </div>
    </div>
  );
}
