'use client';

import React, { useState } from 'react';
import { Shield, AlertCircle, Loader2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import TotpCodeInput from '@/components/totp/TotpCodeInput';
import { createClient } from '@/lib/supabase/client';

interface TotpVerificationPageProps {
  onSuccess: () => void;
  onBack?: () => void;
  onPasskeyRequired?: () => void;
}

export default function TotpVerificationPage({
  onSuccess,
  onBack,
  onPasskeyRequired,
}: TotpVerificationPageProps) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleVerify = async () => {
    if (code.length !== 6) {
      setError('Ingresa los 6 dígitos del código');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setError('La sesión expiró. Inicia sesión nuevamente.');
        return;
      }
      const res = await fetch('/api/auth/totp/verify-login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ code }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (data.errorCode === 'PLATFORM_PASSKEY_REQUIRED' && onPasskeyRequired) {
          onPasskeyRequired();
          return;
        }
        if (data.locked) {
          setError(data.error);
        } else {
          setError(data.error || 'Código incorrecto. Verifica tu app autenticadora.');
        }
        return;
      }

      // Log successful TOTP authentication
      try {
        await fetch('/api/security/log-access', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: session.user.id,
            loginSuccess: true,
            authMethod: 'totp',
            userAgent: navigator.userAgent,
            screenResolution: `${window.screen.width}x${window.screen.height}`,
            language: navigator.language || undefined,
            platform: navigator.platform || undefined,
            deviceFingerprint: btoa(
              [
                navigator.userAgent,
                navigator.language,
                window.screen.width,
                window.screen.height,
                navigator.hardwareConcurrency || 0,
              ].join('|')
            ).slice(0, 64),
          }),
        });
      } catch {
        /* non-blocking */
      }

      onSuccess();
    } catch {
      setError('Error de conexión. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <Link href="/login">
            <Image
              src="/assets/images/docubox-logo-2026.png"
              alt="Docubox"
              width={126}
              height={24}
              className="object-contain"
            />
          </Link>
        </div>

        <div className="bg-white rounded-2xl shadow-lg border border-border p-8">
          {/* Icon */}
          <div className="flex justify-center mb-5">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Shield size={28} className="text-primary" />
            </div>
          </div>

          {/* Title */}
          <div className="text-center mb-6">
            <h1 className="text-xl font-700 text-foreground mb-2">Verificación en dos pasos</h1>
            <p className="text-sm text-muted-foreground">
              Ingresa el código de 6 dígitos generado por tu app autenticadora.
            </p>
          </div>

          {/* Code Input */}
          <div className="mb-5">
            <TotpCodeInput
              value={code}
              onChange={setCode}
              error={!!error}
              loading={loading}
              autoFocus
            />
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl mb-4">
              <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}

          {/* Help text */}
          <div className="flex items-start gap-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-xl mb-5">
            <Shield size={13} className="text-blue-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-blue-700">
              Los códigos cambian cada 30 segundos. Si el código no funciona, espera a que tu app
              genere uno nuevo.
            </p>
          </div>

          {/* Verify button */}
          <button
            onClick={handleVerify}
            disabled={loading || code.length !== 6}
            className="w-full flex items-center justify-center gap-2 py-3 bg-primary text-white rounded-xl text-sm font-700 hover:bg-primary/90 disabled:opacity-60 transition-all mb-4"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Shield size={16} />}
            {loading ? 'Verificando...' : 'Verificar'}
          </button>

          {/* Back link */}
          {onBack && (
            <button
              onClick={onBack}
              className="w-full flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft size={14} />
              Volver al inicio de sesión
            </button>
          )}

          {/* Future: recovery codes */}
          <div className="mt-4 pt-4 border-t border-border">
            <p className="text-xs text-center text-muted-foreground">
              <span className="opacity-50 cursor-not-allowed">No tengo acceso a mi app</span>
              <span className="text-xs text-muted-foreground ml-1">
                (Próximamente: códigos de recuperación)
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
