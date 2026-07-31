'use client';

import React, { useState, useEffect } from 'react';
import { useWebAuthn, SupportInfo } from '@/hooks/useWebAuthn';

interface Props {
  documentId: string;
  documentName: string;
  onSuccess: (evidenceToken: string) => void;
  onCancel: () => void;
}

export default function WebAuthnStepUpModal({ documentId, documentName, onSuccess, onCancel }: Props) {
  const { checkSupport, stepUpForSigning, loading, error, setError } = useWebAuthn();
  const [support, setSupport] = useState<SupportInfo | null>(null);
  const [checking, setChecking] = useState(true);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let mounted = true;
    checkSupport().then((info) => {
      if (mounted) { setSupport(info); setChecking(false); }
    });
    return () => { mounted = false; };
  }, [checkSupport]);

  const getInstruction = (): string => {
    if (!support) return 'Verifica tu identidad';
    const { context, os } = support;
    if (context === 'capacitor_ios' || (context === 'browser_mobile' && os === 'iOS')) {
      return 'Usa Face ID o Touch ID para confirmar';
    }
    if (context === 'capacitor_android' || (context === 'browser_mobile' && os === 'Android')) {
      return 'Usa tu huella dactilar para confirmar';
    }
    if (context === 'browser_desktop' && os === 'macOS') {
      return 'Usa Touch ID para confirmar';
    }
    if (context === 'browser_desktop' && os === 'Windows') {
      return 'Usa Windows Hello para confirmar';
    }
    return 'Verifica tu identidad biométrica';
  };

  const getButtonLabel = (): string => {
    if (!support) return 'Confirmar identidad';
    switch (support.deviceType) {
      case 'face_id': return 'Confirmar con Face ID';
      case 'touch_id': return 'Confirmar con Touch ID';
      case 'windows_hello_face': case'windows_hello_fingerprint': case'windows_hello_pin': return 'Confirmar con Windows Hello';
      case 'android_biometric': return 'Confirmar con huella dactilar';
      default: return 'Confirmar identidad';
    }
  };

  const getBiometricIcon = (): string => {
    if (!support) return '🔐';
    switch (support.deviceType) {
      case 'face_id': return '👁️';
      case 'touch_id': return '☝️';
      case 'windows_hello_face': case'windows_hello_fingerprint': case'windows_hello_pin': return '🪟';
      case 'android_biometric': return '🔏';
      default: return '🔐';
    }
  };

  const handleConfirm = async () => {
    setError(null);
    const result = await stepUpForSigning(documentId);
    if (result.success && result.evidenceToken) {
      setSuccess(true);
      setTimeout(() => onSuccess(result.evidenceToken!), 800);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(2,6,23,0.9)' }}>
      <div
        className="w-full max-w-sm rounded-2xl p-6 space-y-4"
        style={{ background: '#080d17', border: '1px solid #1e293b', boxShadow: '0 25px 60px rgba(0,0,0,0.5)' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between">
          <h2 className="text-base font-bold text-white leading-tight">
            Confirma tu identidad para firmar
          </h2>
          <button onClick={onCancel} className="text-slate-400 hover:text-white transition-colors ml-2 flex-shrink-0">
            ✕
          </button>
        </div>

        {/* Document name */}
        <div className="px-3 py-2.5 rounded-xl" style={{ background: '#0f172a', border: '1px solid #1e293b' }}>
          <p className="text-xs text-slate-400 mb-0.5">Documento a firmar</p>
          <p className="text-sm font-semibold text-white truncate">{documentName}</p>
        </div>

        {/* Warning */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
          style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)' }}>
          <span className="text-amber-400 flex-shrink-0">⚠️</span>
          <p className="text-xs text-amber-300">Esta acción es irreversible</p>
        </div>

        {/* Instruction */}
        {!checking && (
          <p className="text-sm text-center" style={{ color: '#94a3b8' }}>{getInstruction()}</p>
        )}

        {/* Biometric pulse animation */}
        {!checking && !success && !error && (
          <div className="flex justify-center py-2">
            <div className="relative">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center text-3xl"
                style={{ background: 'rgba(99,102,241,0.15)', border: '2px solid rgba(99,102,241,0.4)' }}
              >
                {loading ? (
                  <div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <span>{getBiometricIcon()}</span>
                )}
              </div>
              {loading && (
                <div
                  className="absolute inset-0 rounded-full animate-ping"
                  style={{ background: 'rgba(99,102,241,0.2)' }}
                />
              )}
            </div>
          </div>
        )}

        {/* Success state */}
        {success && (
          <div className="flex flex-col items-center gap-2 py-2">
            <div className="text-4xl">✅</div>
            <p className="text-sm text-emerald-400 font-semibold">Identidad verificada</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="px-3 py-2 rounded-xl" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        {/* Buttons */}
        {!success && (
          <div className="space-y-2">
            <button
              onClick={handleConfirm}
              disabled={loading || checking}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-all active:scale-95 disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, #6366f1, #4f46e5)', minHeight: '48px' }}
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Verificando...</span>
                </>
              ) : (
                <>
                  <span className="text-lg">{getBiometricIcon()}</span>
                  <span>{getButtonLabel()}</span>
                </>
              )}
            </button>

            {error && (
              <div className="text-center">
                <a
                  href="/sign-up-login-screen"
                  className="text-xs hover:underline transition-colors"
                  style={{ color: '#6366f1' }}
                >
                  Recibir código por correo como alternativa
                </a>
              </div>
            )}
          </div>
        )}

        {/* Legal note */}
        <p className="text-[9px] text-center leading-relaxed" style={{ color: '#334155' }}>
          Esta verificación biométrica quedará registrada como evidencia en el expediente digital conforme a NOM-151.
        </p>
      </div>
    </div>
  );
}
