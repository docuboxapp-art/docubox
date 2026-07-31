'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useWebAuthn, SupportInfo } from '@/hooks/useWebAuthn';
import AppImage from '@/components/ui/AppImage';

// ─── Design tokens (matches captura-id-movil / enrolamiento) ─────────────────
const BRAND = {
  bg: '#f5f7fa',
  card: '#ffffff',
  cardBorder: '#e8ecf0',
  blue: '#3b6cf8',
  blueGradient: 'linear-gradient(90deg, #3b6cf8 0%, #4f7bff 100%)',
  green: '#22c55e',
  greenLight: '#dcfce7',
  greenBorder: '#86efac',
  red: '#ef4444',
  redLight: '#fee2e2',
  redBorder: '#fca5a5',
  text: '#111827',
  textMuted: '#6b7280',
  textLight: '#9ca3af',
};

function RegisterFromQRContent() {
  const searchParams = useSearchParams();
  const token = searchParams?.get('token') || '';
  const { checkSupport, registerFromQR, loading, error, setError } = useWebAuthn();
  const [support, setSupport] = useState<SupportInfo | null>(null);
  const [tokenStatus, setTokenStatus] = useState<'validating' | 'valid' | 'invalid'>('validating');
  const [deviceName, setDeviceName] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) { setTokenStatus('invalid'); return; }
    let mounted = true;

    const validate = async () => {
      try {
        const res = await fetch(`/api/webauthn/qr-validate?token=${encodeURIComponent(token)}`);
        if (!res?.ok) { if (mounted) setTokenStatus('invalid'); return; }
        const info = await checkSupport();
        if (mounted) {
          setSupport(info);
          setDeviceName(info?.deviceName || '');
          setTokenStatus('valid');
        }
      } catch {
        if (mounted) setTokenStatus('invalid');
      }
    };
    validate();
    return () => { mounted = false; };
  }, [token, checkSupport]);

  const handleRegister = async () => {
    setError(null);
    const result = await registerFromQR(token, deviceName || support?.deviceName || 'Mi dispositivo');
    if (result?.success) setSuccess(true);
  };

  const getBiometricLabel = () => {
    if (!support) return 'biométrico';
    switch (support?.deviceType) {
      case 'face_id': return 'Face ID';
      case 'touch_id': return 'Touch ID';
      case 'android_biometric': return 'huella dactilar';
      default: return 'biométrico';
    }
  };

  const getBiometricIcon = () => {
    if (!support) return '🔐';
    switch (support?.deviceType) {
      case 'face_id': return '🪪';
      case 'touch_id': return '☝️';
      case 'android_biometric': return '🔏';
      default: return '🔐';
    }
  };

  const getDeviceDescription = () => {
    if (!support) return 'este dispositivo';
    if (support?.os === 'iOS') return support?.deviceCategory === 'tablet' ? 'este iPad' : 'este iPhone';
    if (support?.os === 'Android') return 'este Android';
    return 'este dispositivo';
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-4"
      style={{ background: BRAND?.bg }}
    >
      {/* Card */}
      <div
        className="w-full max-w-sm rounded-2xl overflow-hidden"
        style={{ background: BRAND?.card, border: `1px solid ${BRAND?.cardBorder}`, boxShadow: '0 4px 24px rgba(0,0,0,0.07)' }}
      >
        {/* Header with logo */}
        <div
          className="flex flex-col items-center gap-3 px-6 pt-8 pb-6"
          style={{ borderBottom: `1px solid ${BRAND?.cardBorder}` }}
        >
          <AppImage
            src="/assets/images/Docubox-tipo1-1774212905748.png"
            alt="Docubox logo"
            width={140}
            height={40}
            className="object-contain"
            style={{ maxHeight: 40 }}
          />
          <p className="text-xs font-medium" style={{ color: BRAND?.textLight }}>
            Registro de dispositivo biométrico
          </p>
        </div>

        {/* Body */}
        <div className="px-6 py-6 space-y-5">

          {/* Validating */}
          {tokenStatus === 'validating' && (
            <div className="flex flex-col items-center gap-3 py-8">
              <div
                className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin"
                style={{ borderColor: `${BRAND?.blue} transparent ${BRAND?.blue} ${BRAND?.blue}` }}
              />
              <p className="text-sm font-medium" style={{ color: BRAND?.textMuted }}>
                Validando enlace...
              </p>
            </div>
          )}

          {/* Invalid token */}
          {tokenStatus === 'invalid' && (
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center text-3xl"
                style={{ background: BRAND?.redLight, border: `1px solid ${BRAND?.redBorder}` }}
              >
                ✕
              </div>
              <div>
                <h2 className="text-base font-bold mb-1" style={{ color: BRAND?.text }}>
                  Enlace inválido
                </h2>
                <p className="text-sm leading-relaxed" style={{ color: BRAND?.textMuted }}>
                  Este enlace expiró o ya fue utilizado.<br />
                  Genera un nuevo código QR desde tu computadora.
                </p>
              </div>
            </div>
          )}

          {/* Valid token — registration form */}
          {tokenStatus === 'valid' && !success && (
            <>
              {/* Biometric indicator */}
              <div className="flex flex-col items-center gap-3 py-2">
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl"
                  style={{ background: 'rgba(59,108,248,0.08)', border: `1px solid rgba(59,108,248,0.18)` }}
                >
                  {getBiometricIcon()}
                </div>
                <div className="text-center">
                  <h2 className="text-base font-bold" style={{ color: BRAND?.text }}>
                    Registrar {getDeviceDescription()}
                  </h2>
                  <p className="text-xs mt-1" style={{ color: BRAND?.textMuted }}>
                    Se usará{' '}
                    <span className="font-semibold" style={{ color: BRAND?.blue }}>
                      {getBiometricLabel()}
                    </span>{' '}
                    para autenticar este dispositivo
                  </p>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div
                  className="px-4 py-3 rounded-xl text-sm"
                  style={{ background: BRAND?.redLight, border: `1px solid ${BRAND?.redBorder}`, color: BRAND?.red }}
                >
                  {error}
                </div>
              )}

              {/* Device name input */}
              <div>
                <label
                  className="block text-xs font-semibold mb-1.5"
                  style={{ color: BRAND?.textMuted }}
                >
                  Nombre del dispositivo
                </label>
                <input
                  value={deviceName}
                  onChange={(e) => setDeviceName(e?.target?.value)}
                  placeholder="Ej: iPhone de Juan"
                  className="w-full px-4 py-3 text-sm rounded-xl outline-none transition-all"
                  style={{
                    background: BRAND?.bg,
                    border: `1.5px solid ${BRAND?.cardBorder}`,
                    color: BRAND?.text,
                  }}
                  onFocus={(e) => { e.target.style.borderColor = BRAND?.blue; }}
                  onBlur={(e) => { e.target.style.borderColor = BRAND?.cardBorder; }}
                />
              </div>

              {/* Register button */}
              <button
                onClick={handleRegister}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-4 rounded-xl text-sm font-bold text-white transition-all active:scale-95"
                style={{
                  background: loading ? '#d1d5db' : BRAND?.blueGradient,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  minHeight: 52,
                  border: 'none',
                }}
              >
                {loading ? (
                  <>
                    <div
                      className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin"
                      style={{ borderColor: 'rgba(255,255,255,0.6) transparent rgba(255,255,255,0.6) rgba(255,255,255,0.6)' }}
                    />
                    <span>Registrando dispositivo...</span>
                  </>
                ) : (
                  <>
                    <span className="text-base">{getBiometricIcon()}</span>
                    <span>Registrar con {getBiometricLabel()}</span>
                  </>
                )}
              </button>

              {/* FIDO2 badge */}
              <div className="flex justify-center">
                <span
                  className="text-[10px] px-3 py-1.5 rounded-full font-medium"
                  style={{
                    background: 'rgba(34,197,94,0.08)',
                    color: '#16a34a',
                    border: '1px solid rgba(34,197,94,0.2)',
                  }}
                >
                  🔒 FIDO2 · Tu biométrico nunca sale del dispositivo
                </span>
              </div>
            </>
          )}

          {/* Success */}
          {success && (
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center text-3xl"
                style={{ background: BRAND?.greenLight, border: `1px solid ${BRAND?.greenBorder}` }}
              >
                ✓
              </div>
              <div>
                <h2 className="text-base font-bold mb-1" style={{ color: BRAND?.text }}>
                  {deviceName || 'Dispositivo'} registrado
                </h2>
                <p className="text-sm leading-relaxed" style={{ color: BRAND?.textMuted }}>
                  Puedes cerrar esta ventana y continuar en tu computadora.
                </p>
              </div>
              <div
                className="px-4 py-3 rounded-xl w-full text-sm"
                style={{ background: BRAND?.greenLight, border: `1px solid ${BRAND?.greenBorder}`, color: '#15803d' }}
              >
                Tu computadora detectará automáticamente que el registro se completó.
              </div>
            </div>
          )}
        </div>
      </div>
      {/* Footer */}
      <p className="mt-6 text-xs" style={{ color: BRAND?.textLight }}>
        © {new Date()?.getFullYear()} DOCUBOX · Todos los derechos reservados
      </p>
    </div>
  );
}

export default function RegisterFromQRPage() {
  return (
    <React.Suspense fallback={
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: BRAND?.bg }}
      >
        <div
          className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: `${BRAND?.blue} transparent ${BRAND?.blue} ${BRAND?.blue}` }}
        />
      </div>
    }>
      <RegisterFromQRContent />
    </React.Suspense>
  );
}
