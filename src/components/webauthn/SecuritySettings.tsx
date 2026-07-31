'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useWebAuthn, WebAuthnCredential, SupportInfo } from '@/hooks/useWebAuthn';
import { createClient } from '@/lib/supabase/client';

// ─── Plan limits (comment-based config) ──────────────────────────────────────
// Plan Básico: máximo 3 dispositivos
// Plan Profesional: máximo 10 dispositivos
// Plan Enterprise: ilimitado
// Mostrar contador: "2 de 3 dispositivos usados"
// Deshabilitar botones de registro al alcanzar límite
// Mostrar: "Actualiza tu plan para agregar más dispositivos"

const PLAN_LIMITS: Record<string, number> = {
  basico: 3,
  profesional: 10,
  enterprise: Infinity,
};

function formatRelative(dateStr: string | null): string {
  if (!dateStr) return 'Nunca';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Hace un momento';
  if (mins < 60) return `Hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Hace ${hrs} h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `Hace ${days} día${days > 1 ? 's' : ''}`;
  const months = Math.floor(days / 30);
  return `Hace ${months} mes${months > 1 ? 'es' : ''}`;
}

function DeviceIcon({ category, deviceType }: { category: string; deviceType: string }) {
  const catIcon = category === 'mobile' ? '📱' : category === 'tablet' ? '📟' : '💻';
  const typeIcon =
    deviceType === 'face_id' ? '👁️' :
    deviceType === 'android_biometric' ? '🔏' :
    deviceType === 'touch_id'? '☝️' : deviceType?.startsWith('windows_hello') ? '🪟' : '🔑';
  return <span className="text-xl">{catIcon}<span className="text-sm">{typeIcon}</span></span>;
}

interface QRModalProps {
  onClose: () => void;
  onRegistered: (deviceName: string) => void;
}

function QRModal({ onClose, onRegistered }: QRModalProps) {
  const { generateMobileQR, pollQRStatus } = useWebAuthn();
  const [qrData, setQrData] = useState<{ qrUrl: string; token: string; expiresIn: number } | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(300);
  const [status, setStatus] = useState<'loading' | 'active' | 'completed' | 'expired'>('loading');
  const [registeredDevice, setRegisteredDevice] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startQR = useCallback(async () => {
    setStatus('loading');
    const data = await generateMobileQR();
    if (!data) { setStatus('expired'); return; }
    setQrData(data);
    setSecondsLeft(data.expiresIn);
    setStatus('active');

    // Countdown timer
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(timerRef.current!);
          setStatus('expired');
          return 0;
        }
        return s - 1;
      });
    }, 1000);

    // Polling
    pollRef.current = setInterval(async () => {
      const result = await pollQRStatus(data.token);
      if (result.status === 'completed') {
        clearInterval(pollRef.current!);
        clearInterval(timerRef.current!);
        setRegisteredDevice(result.deviceName || 'Dispositivo móvil');
        setStatus('completed');
        setTimeout(() => onRegistered(result.deviceName || 'Dispositivo móvil'), 2000);
      } else if (result.status === 'expired') {
        clearInterval(pollRef.current!);
        clearInterval(timerRef.current!);
        setStatus('expired');
      }
    }, 2000);
  }, [generateMobileQR, pollQRStatus, onRegistered]);

  useEffect(() => {
    startQR();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [startQR]);

  const progressPct = qrData ? (secondsLeft / qrData.expiresIn) * 100 : 100;
  const borderColor = progressPct > 50 ? '#6366f1' : progressPct > 20 ? '#f59e0b' : '#ef4444';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(2,6,23,0.85)' }}>
      <div className="w-full max-w-sm rounded-2xl p-6 flex flex-col items-center gap-4"
        style={{ background: '#080d17', border: '1px solid #1e293b' }}>
        <div className="flex items-center justify-between w-full">
          <h3 className="text-base font-bold text-white">Agregar dispositivo móvil</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors text-lg">✕</button>
        </div>

        {status === 'loading' && (
          <div className="flex flex-col items-center gap-3 py-8">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-slate-400">Generando código QR...</p>
          </div>
        )}

        {status === 'active' && qrData && (
          <>
            <div className="relative p-3 rounded-xl bg-white" style={{ border: `3px solid ${borderColor}`, transition: 'border-color 0.5s ease', boxShadow: `0 0 20px ${borderColor}40` }}>
              <QRCodeSVG value={qrData.qrUrl} size={200} level="M" />
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold tabular-nums" style={{ color: borderColor }}>{secondsLeft}s</p>
              <p className="text-xs text-slate-400 mt-1">restantes</p>
            </div>
            <p className="text-xs text-slate-400 text-center leading-relaxed">
              Escanea con la cámara de tu iPhone o Android.<br />
              Solo necesitas internet en ambos dispositivos.<br />
              <span className="text-slate-500">No requiere Bluetooth.</span>
            </p>
          </>
        )}

        {status === 'completed' && (
          <div className="flex flex-col items-center gap-3 py-6">
            <div className="text-4xl">✅</div>
            <p className="text-sm font-semibold text-emerald-400 text-center">
              {registeredDevice} registrado correctamente
            </p>
            <p className="text-xs text-slate-400">Cerrando automáticamente...</p>
          </div>
        )}

        {status === 'expired' && (
          <div className="flex flex-col items-center gap-3 py-6">
            <div className="text-4xl">⏱️</div>
            <p className="text-sm text-amber-400 text-center">El código QR expiró.</p>
            <button
              onClick={startQR}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all"
              style={{ background: '#6366f1' }}
            >
              Generar nuevo QR
            </button>
          </div>
        )}

        <button onClick={onClose} className="text-xs text-slate-500 hover:text-slate-300 transition-colors mt-1">
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ─── Main SecuritySettings component ─────────────────────────────────────────

export default function SecuritySettings() {
  const { checkSupport, registerDesktop, loadCredentials, revokeCredential, loading, error, setError } = useWebAuthn();
  const [support, setSupport] = useState<SupportInfo | null>(null);
  const [credentials, setCredentials] = useState<WebAuthnCredential[]>([]);
  const [loadingCreds, setLoadingCreds] = useState(true);
  const [deviceName, setDeviceName] = useState('');
  const [registering, setRegistering] = useState(false);
  const [registerSuccess, setRegisterSuccess] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<WebAuthnCredential | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [planLimit] = useState(3); // Default: Básico
  const [currentCredentialId, setCurrentCredentialId] = useState<string | null>(null);
  const supabase = createClient();

  const refresh = useCallback(async () => {
    setLoadingCreds(true);
    const creds = await loadCredentials();
    setCredentials(creds);
    setLoadingCreds(false);
  }, [loadCredentials]);

  useEffect(() => {
    let mounted = true;
    checkSupport().then((info) => {
      if (mounted) {
        setSupport(info);
        setDeviceName(info.deviceName);
      }
    });
    refresh();
    // Try to get current credential from localStorage (set after registration)
    const stored = localStorage.getItem('docubox_webauthn_credential_id');
    if (stored) setCurrentCredentialId(stored);
  }, [checkSupport, refresh]);

  const handleRegisterDesktop = async () => {
    if (credentials.length >= planLimit) return;
    setRegistering(true);
    setError(null);
    const result = await registerDesktop(deviceName || support?.deviceName || 'Mi dispositivo');
    if (result.success) {
      setRegisterSuccess(true);
      if (result.credentialId) {
        localStorage.setItem('docubox_webauthn_credential_id', result.credentialId);
        setCurrentCredentialId(result.credentialId);
      }
      await refresh();
      setTimeout(() => setRegisterSuccess(false), 3000);
    }
    setRegistering(false);
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    const ok = await revokeCredential(revokeTarget.id);
    if (ok) {
      setRevokeTarget(null);
      await refresh();
    }
    setRevoking(false);
  };

  const isDesktopRegistered = credentials.some(
    (c) => c.device_category === 'desktop' && c.is_active
  );
  const atLimit = credentials.length >= planLimit;

  return (
    <div className="space-y-6" style={{ color: '#e2e8f0' }}>

      {/* ── Esta computadora ── */}
      {support?.deviceCategory === 'desktop' && (
        <div className="rounded-2xl p-5" style={{ background: '#080d17', border: '1px solid #1e293b' }}>
          <h3 className="text-sm font-bold mb-3" style={{ color: '#c7d2fe' }}>Esta computadora</h3>

          {!isDesktopRegistered && (
            <div className="mb-4 px-3 py-2 rounded-xl flex items-start gap-2"
              style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)' }}>
              <span className="text-indigo-400 text-sm mt-0.5">ℹ️</span>
              <p className="text-xs text-indigo-300">Esta computadora no está registrada para autenticación biométrica.</p>
            </div>
          )}

          {error && (
            <div className="mb-3 px-3 py-2 rounded-xl" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
              <p className="text-xs text-red-400">{error}</p>
              {error.includes('Windows Hello') && (
                <div className="mt-2 text-xs text-red-300 space-y-0.5">
                  <p className="font-semibold">Configurar Windows Hello:</p>
                  <p>Windows 11: Inicio → Configuración → Cuentas → Opciones de inicio de sesión → Windows Hello</p>
                  <p>Windows 10: Inicio → Configuración → Cuentas → Opciones de inicio de sesión → Windows Hello</p>
                </div>
              )}
              {error.includes('Touch ID') && (
                <div className="mt-2 text-xs text-red-300 space-y-0.5">
                  <p className="font-semibold">Configurar Touch ID en Mac:</p>
                  <p>Preferencias del Sistema → Touch ID → Agregar huella dactilar</p>
                </div>
              )}
            </div>
          )}

          {registerSuccess && (
            <div className="mb-3 px-3 py-2 rounded-xl flex items-center gap-2"
              style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)' }}>
              <span className="text-emerald-400">✅</span>
              <p className="text-xs text-emerald-300">Dispositivo registrado correctamente.</p>
            </div>
          )}

          <div className="flex gap-2 items-center">
            <input
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="Nombre del dispositivo"
              className="flex-1 px-3 py-2 text-sm rounded-xl outline-none"
              style={{ background: '#0f172a', border: '1px solid #1e293b', color: '#e2e8f0' }}
            />
            <button
              onClick={handleRegisterDesktop}
              disabled={registering || loading || atLimit}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all active:scale-95 disabled:opacity-50 whitespace-nowrap"
              style={{ background: '#6366f1', minHeight: '40px' }}
            >
              {registering ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : isDesktopRegistered ? 'Volver a registrar' : 'Registrar ahora'}
            </button>
          </div>

          {atLimit && (
            <p className="text-xs mt-2" style={{ color: '#f59e0b' }}>
              Actualiza tu plan para agregar más dispositivos.
            </p>
          )}
        </div>
      )}

      {/* ── Agregar dispositivo móvil ── */}
      <div className="rounded-2xl p-5" style={{ background: '#080d17', border: '1px solid #1e293b' }}>
        <h3 className="text-sm font-bold mb-3" style={{ color: '#c7d2fe' }}>Agregar dispositivo móvil</h3>
        <p className="text-xs mb-3" style={{ color: '#64748b' }}>
          Registra tu teléfono para iniciar sesión con Face ID o huella dactilar.
        </p>
        <button
          onClick={() => setShowQR(true)}
          disabled={atLimit}
          className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all active:scale-95 disabled:opacity-50"
          style={{ background: atLimit ? '#1e293b' : '#6366f1', minHeight: '40px' }}
        >
          📱 Mostrar código QR
        </button>
        {atLimit && (
          <p className="text-xs mt-2" style={{ color: '#f59e0b' }}>
            Actualiza tu plan para agregar más dispositivos.
          </p>
        )}
      </div>

      {/* ── Dispositivos registrados ── */}
      <div className="rounded-2xl p-5" style={{ background: '#080d17', border: '1px solid #1e293b' }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold" style={{ color: '#c7d2fe' }}>Dispositivos registrados</h3>
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(99,102,241,0.15)', color: '#a5b4fc' }}>
            {credentials.length} de {planLimit === Infinity ? '∞' : planLimit}
          </span>
        </div>

        {loadingCreds ? (
          <div className="flex items-center gap-2 py-4">
            <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-slate-400">Cargando dispositivos...</span>
          </div>
        ) : credentials.length === 0 ? (
          <p className="text-xs py-4 text-center" style={{ color: '#475569' }}>
            Ningún dispositivo registrado. Registra este equipo o agrega un móvil con el código QR.
          </p>
        ) : (
          <div className="space-y-3">
            {credentials.map((cred) => {
              const isCurrent = cred.credential_id === currentCredentialId;
              const isCloneAlert = false; // Would be detected server-side
              return (
                <div key={cred.id} className="flex items-start gap-3 p-3 rounded-xl"
                  style={{ background: '#0f172a', border: `1px solid ${isCloneAlert ? '#ef4444' : '#1e293b'}` }}>
                  <div className="mt-0.5">
                    <DeviceIcon category={cred.device_category || 'desktop'} deviceType={cred.device_type || 'pin_fallback'} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-bold text-white truncate">{cred.device_name}</span>
                      {isCurrent && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
                          style={{ background: 'rgba(16,185,129,0.15)', color: '#6ee7b7', border: '1px solid rgba(16,185,129,0.3)' }}>
                          Este dispositivo ✓
                        </span>
                      )}
                    </div>
                    <p className="text-xs mt-0.5" style={{ color: '#64748b' }}>
                      {[cred.os, cred.browser].filter(Boolean).join(' · ')}
                    </p>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {cred.device_category && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium capitalize"
                          style={{ background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.25)' }}>
                          {cred.device_category === 'mobile' ? '📱 Móvil' : cred.device_category === 'tablet' ? '📟 Tablet' : '💻 Escritorio'}
                        </span>
                      )}
                      {cred.registered_from && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
                          style={{ background: 'rgba(30,41,59,0.8)', color: '#94a3b8', border: '1px solid #1e293b' }}>
                          {cred.registered_from === 'qr' ? 'Registrado vía QR' : 'Registrado directamente'}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] mt-1.5" style={{ color: '#475569' }}>
                      Registrado {formatRelative(cred.created_at)} · Último uso {formatRelative(cred.last_used_at)}
                    </p>
                    {isCloneAlert && (
                      <p className="text-xs mt-1 text-red-400">⚠️ Posible clonación detectada. Revoca y vuelve a registrar.</p>
                    )}
                  </div>
                  <button
                    onClick={() => setRevokeTarget(cred)}
                    className="text-xs px-2 py-1 rounded-lg transition-colors hover:bg-red-500/20 text-red-400 flex-shrink-0"
                  >
                    Revocar
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* FIDO2 badge */}
      <div className="flex justify-center">
        <span className="text-[9px] px-3 py-1.5 rounded-full text-center"
          style={{ background: 'rgba(16,185,129,0.08)', color: '#6ee7b7', border: '1px solid rgba(16,185,129,0.2)' }}>
          🔒 FIDO2 Certified · Sin contraseña · Tu biométrico nunca sale del dispositivo
        </span>
      </div>

      {/* QR Modal */}
      {showQR && (
        <QRModal
          onClose={() => setShowQR(false)}
          onRegistered={async (name) => {
            setShowQR(false);
            await refresh();
          }}
        />
      )}

      {/* Revoke confirmation modal */}
      {revokeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(2,6,23,0.85)' }}>
          <div className="w-full max-w-xs rounded-2xl p-6 space-y-4"
            style={{ background: '#080d17', border: '1px solid #1e293b' }}>
            <h3 className="text-sm font-bold text-white">¿Revocar acceso?</h3>
            <p className="text-xs text-slate-400">
              ¿Revocar acceso de <strong className="text-white">{revokeTarget.device_name}</strong>? Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setRevokeTarget(null)}
                className="flex-1 py-2 rounded-xl text-sm font-medium text-slate-300 transition-colors"
                style={{ background: '#1e293b' }}
              >
                Cancelar
              </button>
              <button
                onClick={handleRevoke}
                disabled={revoking}
                className="flex-1 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-60"
                style={{ background: '#ef4444' }}
              >
                {revoking ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto" />
                ) : 'Revocar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
