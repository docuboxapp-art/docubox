'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Fingerprint,
  Link2,
  Loader2,
  LockKeyhole,
  RefreshCw,
  ScanFace,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';
import { SupportInfo, useWebAuthn } from '@/hooks/useWebAuthn';

function RegisterFromQRContent() {
  const searchParams = useSearchParams();
  const token = searchParams?.get('token') || '';
  const { checkSupport, registerFromQR, loading, error, setError } = useWebAuthn();
  const registrationActiveRef = useRef(false);
  const [support, setSupport] = useState<SupportInfo | null>(null);
  const [tokenStatus, setTokenStatus] = useState<'validating' | 'valid' | 'invalid'>('validating');
  const [deviceName, setDeviceName] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) {
      setTokenStatus('invalid');
      return;
    }

    let mounted = true;
    const validate = async () => {
      try {
        const response = await fetch(
          `/api/webauthn/qr-validate?token=${encodeURIComponent(token)}`
        );
        if (!response.ok) {
          if (mounted) setTokenStatus('invalid');
          return;
        }

        const supportInfo = await checkSupport();
        if (mounted) {
          setSupport(supportInfo);
          setDeviceName(supportInfo.deviceName || 'Mi dispositivo');
          setTokenStatus('valid');
        }
      } catch {
        if (mounted) setTokenStatus('invalid');
      }
    };

    void validate();
    return () => {
      mounted = false;
    };
  }, [checkSupport, token]);

  const handleRegister = async () => {
    if (registrationActiveRef.current || loading || !deviceName.trim()) return;
    registrationActiveRef.current = true;
    setError(null);

    try {
      const result = await registerFromQR(token, deviceName.trim());
      if (result.success) setSuccess(true);
    } finally {
      registrationActiveRef.current = false;
    }
  };

  const isIOS = support?.os === 'iOS';
  const isAndroid = support?.os === 'Android';
  const supportUnavailable = Boolean(support && (!support.browserOk || !support.platformOk));

  const deviceDescription = support
    ? support.os === 'iOS'
      ? support.deviceCategory === 'tablet'
        ? 'este iPad'
        : 'este iPhone'
      : support.os === 'Android'
        ? 'este dispositivo Android'
        : 'este dispositivo'
    : 'este dispositivo';

  const securityLabel = isIOS
    ? 'Face ID, Touch ID o el código del dispositivo'
    : isAndroid
      ? 'la seguridad biométrica del dispositivo'
      : 'el método de seguridad del dispositivo';

  const SecurityIcon = isIOS ? ScanFace : isAndroid ? Fingerprint : ShieldCheck;

  return (
    <main className="min-h-[100svh] bg-[#F8F8FB] px-4 py-6 text-[#18181B] sm:py-10">
      <div className="mx-auto flex min-h-[calc(100svh-3rem)] w-full max-w-md flex-col justify-center sm:min-h-[calc(100svh-5rem)]">
        <div className="mb-6 flex justify-center">
          <AppLogo className="[&_img]:h-auto [&_img]:w-[154px]" />
        </div>

        <section className="overflow-hidden rounded-lg border border-[#EBEBF0] bg-white shadow-[0_12px_36px_rgba(24,24,27,0.07)]">
          <header className="border-b border-[#EBEBF0] px-5 py-5 sm:px-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h1 className="text-xl font-600 tracking-normal">Registrar dispositivo</h1>
                <p className="mt-1 text-sm text-[#52525B]">Acceso biométrico seguro a Docubox</p>
              </div>
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50 text-primary">
                <Smartphone size={20} />
              </div>
            </div>

            <div className="mt-5 flex items-center" aria-label="Progreso del registro">
              <div
                className={`flex items-center gap-2 text-xs font-600 ${
                  tokenStatus === 'invalid'
                    ? 'text-red-700'
                    : tokenStatus === 'valid'
                      ? 'text-emerald-700'
                      : 'text-primary'
                }`}
              >
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full ${
                    tokenStatus === 'invalid'
                      ? 'bg-red-50'
                      : tokenStatus === 'valid'
                        ? 'bg-emerald-50'
                        : 'bg-blue-50'
                  }`}
                >
                  {tokenStatus === 'validating' ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : tokenStatus === 'valid' ? (
                    <Check size={13} />
                  ) : (
                    <AlertCircle size={13} />
                  )}
                </span>
                {tokenStatus === 'validating'
                  ? 'Validando enlace'
                  : tokenStatus === 'valid'
                    ? 'Enlace validado'
                    : 'Enlace inválido'}
              </div>
              <span className="mx-3 h-px flex-1 bg-[#EBEBF0]" />
              <div
                className={`flex items-center gap-2 text-xs font-600 ${
                  tokenStatus === 'valid' ? 'text-primary' : 'text-[#A1A1AA]'
                }`}
              >
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full ${
                    tokenStatus === 'valid' ? 'bg-blue-50' : 'bg-[#F4F4F5]'
                  }`}
                >
                  2
                </span>
                Dispositivo
              </div>
            </div>
          </header>

          <div className="px-5 py-6 sm:px-6">
            {tokenStatus === 'validating' && (
              <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
                <Loader2 size={26} className="animate-spin text-primary" />
                <div>
                  <p className="text-sm font-600">Validando enlace seguro</p>
                  <p className="mt-1 text-xs text-[#71717A]">Esto tomará solo un momento.</p>
                </div>
              </div>
            )}

            {tokenStatus === 'invalid' && (
              <div className="flex min-h-64 flex-col items-center justify-center text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
                  <Link2 size={22} />
                </div>
                <h2 className="mt-4 text-lg font-600">El enlace ya no está disponible</h2>
                <p className="mt-2 max-w-xs text-sm leading-6 text-[#52525B]">
                  El código QR expiró o ya fue utilizado. Genera uno nuevo desde la configuración de
                  seguridad de Docubox.
                </p>
              </div>
            )}

            {tokenStatus === 'valid' && !success && (
              <div className="space-y-5">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50 text-primary">
                    <SecurityIcon size={23} />
                  </div>
                  <div className="min-w-0 pt-0.5">
                    <h2 className="text-lg font-600">Registrar {deviceDescription}</h2>
                    <p className="mt-1 text-sm leading-5 text-[#52525B]">
                      Safari solicitará {securityLabel} para confirmar el registro.
                    </p>
                  </div>
                </div>

                {supportUnavailable && (
                  <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-amber-900">
                    <AlertCircle size={17} className="mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-600">Seguridad del dispositivo no disponible</p>
                      <p className="mt-1 text-xs leading-5">
                        Activa Face ID, Touch ID, huella o un código de desbloqueo y vuelve a abrir
                        este enlace en Safari o Chrome.
                      </p>
                    </div>
                  </div>
                )}

                {error && (
                  <div
                    className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-3"
                    role="alert"
                    aria-live="polite"
                  >
                    <div className="flex items-start gap-3 text-red-800">
                      <AlertCircle size={17} className="mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-600">No se completó el registro</p>
                        <p className="mt-1 text-xs leading-5">{error}</p>
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <label htmlFor="device-name" className="mb-1.5 block text-sm font-500">
                    Nombre del dispositivo
                  </label>
                  <input
                    id="device-name"
                    value={deviceName}
                    onChange={(event) => {
                      setDeviceName(event.target.value);
                      setError(null);
                    }}
                    placeholder="Ej. iPhone de Luis"
                    maxLength={60}
                    autoComplete="off"
                    className="h-11 w-full rounded-lg border border-[#DDE1E8] bg-white px-3.5 text-sm outline-none transition-colors placeholder:text-[#A1A1AA] focus:border-primary focus:ring-2 focus:ring-primary/10"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleRegister}
                  disabled={loading || supportUnavailable || !deviceName.trim()}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-600 text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {loading ? (
                    <>
                      <Loader2 size={17} className="animate-spin" />
                      Esperando confirmación...
                    </>
                  ) : error ? (
                    <>
                      <RefreshCw size={17} />
                      Intentar nuevamente
                    </>
                  ) : (
                    <>
                      <LockKeyhole size={17} />
                      Registrar dispositivo
                    </>
                  )}
                </button>

                <div className="flex items-start gap-2 border-t border-[#EBEBF0] pt-4 text-xs leading-5 text-[#71717A]">
                  <ShieldCheck size={15} className="mt-0.5 flex-shrink-0 text-emerald-600" />
                  <p>
                    Protegido con WebAuthn/FIDO2. Tus datos biométricos permanecen en el dispositivo
                    y nunca se comparten con Docubox.
                  </p>
                </div>
              </div>
            )}

            {success && (
              <div className="flex min-h-72 flex-col items-center justify-center text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                  <CheckCircle2 size={28} />
                </div>
                <h2 className="mt-4 text-xl font-600">Dispositivo registrado</h2>
                <p className="mt-2 max-w-xs text-sm leading-6 text-[#52525B]">
                  {deviceName || 'Tu dispositivo'} ya puede utilizarse para acceder de forma segura
                  a Docubox.
                </p>
                <div className="mt-5 w-full rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                  Puedes cerrar esta ventana. La computadora actualizará el estado automáticamente.
                </div>
              </div>
            )}
          </div>
        </section>

        <footer className="mt-5 text-center text-xs text-[#A1A1AA]">
          © {new Date().getFullYear()} Docubox · Registro seguro de dispositivos
        </footer>
      </div>
    </main>
  );
}

export default function RegisterFromQRPage() {
  return (
    <React.Suspense
      fallback={
        <div className="flex min-h-[100svh] items-center justify-center bg-[#F8F8FB]">
          <Loader2 size={26} className="animate-spin text-primary" />
        </div>
      }
    >
      <RegisterFromQRContent />
    </React.Suspense>
  );
}
