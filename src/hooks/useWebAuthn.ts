'use client';

/**
 * useWebAuthn — Hook principal para autenticación biométrica WebAuthn en DOCUBOX
 *
 * Soporta:
 *  - Navegador desktop (Chrome, Firefox, Edge, Safari en Mac)
 *  - Navegador móvil (Safari iOS, Chrome Android)
 *  - App Capacitor iOS y Android (via @capacitor-community/webauthn cuando esté disponible)
 *
 * NO incluye Cross-Device Authentication con Bluetooth (módulo separado).
 */

import { useState, useCallback } from 'react';
import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
} from '@simplewebauthn/browser';
import { createClient } from '@/lib/supabase/client';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type DeviceType =
  | 'face_id'
  | 'touch_id'
  | 'windows_hello_face'
  | 'windows_hello_fingerprint'
  | 'windows_hello_pin'
  | 'android_biometric'
  | 'pin_fallback'
  | 'unsupported';

export type DeviceCategory = 'mobile' | 'desktop' | 'tablet';

export type WebAuthnContext =
  'browser_desktop' | 'browser_mobile' | 'capacitor_ios' | 'capacitor_android';

export interface DeviceInfo {
  deviceCategory: DeviceCategory;
  os: string;
  browser: string;
  isFirefox: boolean;
  deviceName: string;
}

export interface SupportInfo {
  browserOk: boolean;
  platformOk: boolean;
  deviceType: DeviceType;
  deviceCategory: DeviceCategory;
  context: WebAuthnContext;
  os: string;
  browser: string;
  deviceName: string;
  firefoxWarning: boolean;
}

export interface WebAuthnCredential {
  id: string;
  credential_id: string;
  device_name: string;
  device_type: DeviceType;
  device_category: DeviceCategory;
  os: string | null;
  browser: string | null;
  context: WebAuthnContext | null;
  registered_from: 'direct' | 'qr' | null;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
  sign_count: number;
  aaguid: string | null;
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

/**
 * Detecta si estamos en Capacitor (nativo) o en navegador.
 * Usa duck-typing para evitar importar @capacitor/core en SSR.
 */
function getContext(): WebAuthnContext {
  if (typeof window === 'undefined') return 'browser_desktop';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cap = (window as any).Capacitor;
  if (cap?.isNativePlatform?.()) {
    return cap.getPlatform() === 'ios' ? 'capacitor_ios' : 'capacitor_android';
  }
  const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
  return isMobile ? 'browser_mobile' : 'browser_desktop';
}

function getDeviceInfo(): DeviceInfo {
  if (typeof window === 'undefined') {
    return {
      deviceCategory: 'desktop',
      os: 'Unknown',
      browser: 'Unknown',
      isFirefox: false,
      deviceName: 'Mi dispositivo',
    };
  }
  const ua = navigator.userAgent;

  // OS
  let os = 'Unknown';
  if (/iPhone|iPad/.test(ua)) os = 'iOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Linux/.test(ua)) os = 'Linux';

  // Browser
  let browser = 'Unknown';
  if (/Firefox/.test(ua)) browser = 'Firefox';
  else if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/Chrome/.test(ua)) browser = 'Chrome';
  else if (/Safari/.test(ua)) browser = 'Safari';

  const isFirefox = browser === 'Firefox';

  // Device category
  let deviceCategory: DeviceCategory = 'desktop';
  if (/iPad/.test(ua)) deviceCategory = 'tablet';
  else if (/iPhone|Android/.test(ua)) deviceCategory = 'mobile';

  // Suggested device name
  let deviceName = 'Mi dispositivo';
  const nameParts = navigator.platform || '';
  if (os === 'iOS') {
    deviceName = /iPad/.test(ua) ? 'iPad de usuario' : 'iPhone de usuario';
  } else if (os === 'Android') {
    deviceName = 'Android de usuario';
  } else if (os === 'macOS') {
    deviceName = 'MacBook de usuario';
  } else if (os === 'Windows') {
    deviceName = 'PC de usuario';
  } else if (nameParts) {
    deviceName = `Dispositivo (${nameParts})`;
  }

  return { deviceCategory, os, browser, isFirefox, deviceName };
}

// ─── Hook principal ───────────────────────────────────────────────────────────

export function useWebAuthn() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  // ── checkSupport ────────────────────────────────────────────────────────────
  const checkSupport = useCallback(async (): Promise<SupportInfo> => {
    const context = getContext();
    const { deviceCategory, os, browser, isFirefox, deviceName } = getDeviceInfo();

    let browserOk = false;
    let platformOk = false;

    browserOk = browserSupportsWebAuthn();
    platformOk = await platformAuthenticatorIsAvailable();

    // Detectar deviceType
    let deviceType: DeviceType = 'unsupported';
    if (browserOk) {
      if (os === 'iOS') {
        // Face ID: iPhone X and later (iOS 11+). Touch ID: iPhone 8 and earlier.
        // We detect by checking iOS version: iOS 11+ on iPhone → Face ID (default assumption for modern devices)
        // iPad Pro with Face ID also runs iOS 11+. We default to face_id for iOS 11+ iPhones.
        const iosVersionMatch = navigator.userAgent.match(/iPhone OS (\d+)_/);
        const iosVersion = iosVersionMatch ? parseInt(iosVersionMatch[1], 10) : 0;
        // iPhone SE (1st gen) and older use Touch ID; iPhone X+ use Face ID.
        // Since we can't detect exact model, use iOS version as proxy:
        // iOS 11+ → likely Face ID capable device (iPhone X+)
        // iOS 10 and below → Touch ID
        // iPad always uses Touch ID (no Face ID on iPad in WebAuthn context)
        const isIPad = /iPad/.test(navigator.userAgent);
        if (isIPad) {
          deviceType = 'touch_id';
        } else if (iosVersion >= 11) {
          deviceType = 'face_id';
        } else {
          deviceType = 'touch_id';
        }
      } else if (os === 'Android') {
        deviceType = 'android_biometric';
      } else if (os === 'macOS' && platformOk) {
        deviceType = 'touch_id';
      } else if (os === 'Windows' && platformOk) {
        // Windows Hello decide internamente (cara, huella o PIN)
        deviceType = 'windows_hello_face';
      } else if (!platformOk && browserOk) {
        deviceType = 'pin_fallback';
      }
    }

    const firefoxWarning = isFirefox && os !== 'iOS';

    return {
      browserOk,
      platformOk,
      deviceType,
      deviceCategory,
      context,
      os,
      browser,
      deviceName,
      firefoxWarning,
    };
  }, []);

  // ── Traducir errores WebAuthn al español ────────────────────────────────────
  const translateError = useCallback(
    (err: unknown, context: WebAuthnContext, os: string): string => {
      const msg = err instanceof Error ? err.message : String(err);
      const name = err instanceof Error ? err.name : '';
      const webAuthnCode =
        typeof err === 'object' && err && 'code' in err
          ? String((err as { code?: unknown }).code || '')
          : '';

      if (webAuthnCode === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') {
        return 'Este dispositivo ya está registrado. Revócalo desde tu perfil antes de volver a enlazarlo.';
      }
      if (webAuthnCode === 'ERROR_INVALID_RP_ID' || webAuthnCode === 'ERROR_INVALID_DOMAIN') {
        return 'El dominio de seguridad no coincide con este enlace. Genera un código QR nuevo desde Docubox.';
      }
      if (
        webAuthnCode === 'ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT' ||
        webAuthnCode === 'ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG'
      ) {
        return 'El dispositivo no tiene un método de desbloqueo compatible. Configura Face ID, Touch ID, huella o un código de acceso e intenta nuevamente.';
      }
      if (webAuthnCode === 'ERROR_AUTHENTICATOR_GENERAL_ERROR') {
        return 'El dispositivo no pudo crear la credencial. Verifica que el desbloqueo biométrico y el código del dispositivo estén activos.';
      }

      if (name === 'NotAllowedError') {
        if (context === 'capacitor_ios' || context === 'capacitor_android') {
          return 'Permiso biométrico denegado. Verifica la configuración de tu teléfono.';
        }
        if (os === 'iOS') {
          return 'No se completó la autorización. Intenta nuevamente y confirma la hoja de seguridad con Face ID, Touch ID o el código del iPhone; no la cierres con la X.';
        }
        return 'La autorización se canceló o se cerró antes de terminar. Intenta nuevamente y confirma el aviso del dispositivo.';
      }
      if (name === 'NotSupportedError') {
        return 'Este dispositivo no es compatible con autenticación biométrica.';
      }
      if (msg.includes('Firefox')) {
        return 'Firefox tiene soporte limitado. Recomendamos Chrome o Safari.';
      }
      if (msg.includes('Windows Hello') || msg.includes('windows_hello')) {
        return 'Windows Hello no está configurado. Ve a Inicio → Configuración → Cuentas → Opciones de inicio de sesión.';
      }
      if (msg.includes('Touch ID') || (os === 'macOS' && msg.includes('platform'))) {
        return 'Asegúrate de tener Touch ID configurado en Preferencias del Sistema → Touch ID.';
      }
      if (msg.includes('QR') || msg.includes('expired')) {
        return 'El código QR expiró. Genera uno nuevo.';
      }
      if (msg.includes('token') || msg.includes('invalid')) {
        return 'Enlace inválido o ya utilizado.';
      }
      if (msg.includes('challenge') || msg.includes('Challenge')) {
        return 'Sesión expirada, recarga la página.';
      }
      if (msg.includes('limit') || msg.includes('límite')) {
        return 'Alcanzaste el límite de dispositivos de tu plan.';
      }
      if (!navigator.onLine) {
        return 'Sin conexión. Verifica tu internet e intenta de nuevo.';
      }
      return msg || 'Error desconocido. Intenta de nuevo.';
    },
    []
  );

  // ── registerDesktop ─────────────────────────────────────────────────────────
  const registerDesktop = useCallback(
    async (deviceName: string): Promise<{ success: boolean; credentialId?: string }> => {
      setLoading(true);
      setError(null);
      const { context, os, browser, deviceType } = await checkSupport();
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) throw new Error('No hay sesión activa.');

        // 1. Obtener opciones de registro
        const optRes = await fetch('/api/webauthn/register-options', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ deviceName, context, os, browser, deviceCategory: 'desktop' }),
        });
        if (!optRes.ok) {
          const e = await optRes.json();
          throw new Error(e.error || 'Error al obtener opciones de registro.');
        }
        const options = await optRes.json();

        // 2. Ejecutar registro biométrico
        const credential = await startRegistration({ optionsJSON: options });

        // 3. Verificar registro
        const verRes = await fetch('/api/webauthn/register-verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            credential,
            deviceName,
            deviceType,
            context,
            os,
            browser,
            deviceCategory: 'desktop',
            registeredFrom: 'direct',
          }),
        });
        if (!verRes.ok) {
          const e = await verRes.json();
          throw new Error(e.error || 'Error al verificar registro.');
        }
        const result = await verRes.json();
        return { success: true, credentialId: result.credentialId };
      } catch (err) {
        const msg = translateError(err, context, os);
        setError(msg);
        return { success: false };
      } finally {
        setLoading(false);
      }
    },
    [checkSupport, supabase, translateError]
  );

  // ── generateMobileQR ────────────────────────────────────────────────────────
  const generateMobileQR = useCallback(async (): Promise<{
    qrUrl: string;
    token: string;
    expiresIn: number;
  } | null> => {
    setLoading(true);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error('No hay sesión activa.');

      const res = await fetch('/api/webauthn/generate-qr', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.error || 'Error al generar QR.');
      }
      return await res.json();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al generar QR.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  // ── pollQRStatus ────────────────────────────────────────────────────────────
  const pollQRStatus = useCallback(
    async (
      token: string
    ): Promise<{ status: 'pending' | 'completed' | 'expired'; deviceName?: string }> => {
      try {
        const res = await fetch(`/api/webauthn/qr-status?token=${encodeURIComponent(token)}`);
        if (!res.ok) return { status: 'expired' };
        return await res.json();
      } catch {
        return { status: 'expired' };
      }
    },
    []
  );

  // ── registerFromQR ──────────────────────────────────────────────────────────
  const registerFromQR = useCallback(
    async (token: string, deviceName: string): Promise<{ success: boolean }> => {
      setLoading(true);
      setError(null);
      const { context, os, browser, deviceType } = await checkSupport();
      try {
        // 1. Validar token
        const valRes = await fetch(`/api/webauthn/qr-validate?token=${encodeURIComponent(token)}`);
        if (!valRes.ok) {
          const e = await valRes.json();
          throw new Error(e.error || 'Enlace inválido o ya utilizado.');
        }

        // 2. Obtener opciones QR
        const optRes = await fetch('/api/webauthn/register-options-qr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, deviceCategory: 'mobile' }),
        });
        if (!optRes.ok) {
          const e = await optRes.json();
          throw new Error(e.error || 'Error al obtener opciones de registro QR.');
        }
        const options = await optRes.json();

        // 3. Ejecutar registro biométrico
        const credential = await startRegistration({ optionsJSON: options });

        // 4. Verificar registro QR
        const verRes = await fetch('/api/webauthn/register-verify-qr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            credential,
            token,
            deviceName,
            deviceType,
            context,
            os,
            browser,
            deviceCategory: 'mobile',
            registeredFrom: 'qr',
          }),
        });
        if (!verRes.ok) {
          const e = await verRes.json();
          throw new Error(e.error || 'Error al verificar registro QR.');
        }
        return { success: true };
      } catch (err) {
        const msg = translateError(err, context, os);
        setError(msg);
        return { success: false };
      } finally {
        setLoading(false);
      }
    },
    [checkSupport, translateError]
  );

  // ── authenticateWithDevice ──────────────────────────────────────────────────
  const authenticateWithDevice = useCallback(
    async (email: string): Promise<{ success: boolean; session?: unknown }> => {
      setLoading(true);
      setError(null);
      const { context, os } = await checkSupport();
      try {
        // 1. Obtener opciones de autenticación
        const optRes = await fetch('/api/webauthn/auth-options', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        if (!optRes.ok) {
          const e = await optRes.json();
          throw new Error(e.error || 'Sin dispositivos registrados. Usa código por correo.');
        }
        const options = await optRes.json();

        // 2. Ejecutar autenticación biométrica
        const credential = await startAuthentication({ optionsJSON: options });

        // 3. Verificar autenticación
        const verRes = await fetch('/api/webauthn/auth-verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, credential, context }),
        });
        if (!verRes.ok) {
          const e = await verRes.json();
          throw new Error(e.error || 'Error al verificar autenticación.');
        }
        const result = await verRes.json();
        if (!result?.tokenHash) {
          throw new Error('No se pudo crear la sesión. Intenta de nuevo.');
        }

        const { data: authData, error: sessionError } = await supabase.auth.verifyOtp({
          token_hash: result.tokenHash,
          type: 'magiclink',
        });
        if (sessionError || !authData.session) {
          throw new Error('No se pudo iniciar la sesión. Intenta de nuevo.');
        }

        return { success: true, session: authData.session };
      } catch (err) {
        const msg = translateError(err, context, os);
        setError(msg);
        return { success: false };
      } finally {
        setLoading(false);
      }
    },
    [checkSupport, translateError]
  );

  // ── stepUpForSigning ────────────────────────────────────────────────────────
  const stepUpForSigning = useCallback(
    async (documentId: string): Promise<{ success: boolean; evidenceToken?: string }> => {
      setLoading(true);
      setError(null);
      const { context, os } = await checkSupport();
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) throw new Error('No hay sesión activa.');

        // 1. Obtener opciones step-up
        const optRes = await fetch('/api/webauthn/stepup-options', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ documentId }),
        });
        if (!optRes.ok) {
          const e = await optRes.json();
          throw new Error(e.error || 'Error al obtener opciones de verificación.');
        }
        const options = await optRes.json();

        // 2. Ejecutar autenticación biométrica
        const credential = await startAuthentication({ optionsJSON: options });

        // 3. Verificar step-up
        const verRes = await fetch('/api/webauthn/stepup-verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ documentId, credential }),
        });
        if (!verRes.ok) {
          const e = await verRes.json();
          throw new Error(e.error || 'Error al verificar identidad para firma.');
        }
        const result = await verRes.json();
        return { success: true, evidenceToken: result.evidenceToken };
      } catch (err) {
        const msg = translateError(err, context, os);
        setError(msg);
        return { success: false };
      } finally {
        setLoading(false);
      }
    },
    [checkSupport, supabase, translateError]
  );

  // ── loadCredentials ─────────────────────────────────────────────────────────
  const loadCredentials = useCallback(async (): Promise<WebAuthnCredential[]> => {
    try {
      const { data, error: dbError } = await supabase
        .from('webauthn_credentials')
        .select('*')
        .eq('is_active', true)
        .order('last_used_at', { ascending: false, nullsFirst: false });
      if (dbError) throw dbError;
      return (data || []) as WebAuthnCredential[];
    } catch {
      return [];
    }
  }, [supabase]);

  // ── revokeCredential ────────────────────────────────────────────────────────
  const revokeCredential = useCallback(
    async (credentialId: string): Promise<boolean> => {
      try {
        setError(null);
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) throw new Error('La sesión no es válida. Inicia sesión nuevamente.');

        const response = await fetch(
          `/api/webauthn/credentials/${encodeURIComponent(credentialId)}`,
          {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${session.access_token}` },
          }
        );
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'No fue posible revocar el dispositivo.');
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No fue posible revocar el dispositivo.');
        return false;
      }
    },
    [supabase]
  );

  return {
    loading,
    error,
    setError,
    checkSupport,
    registerDesktop,
    generateMobileQR,
    pollQRStatus,
    registerFromQR,
    authenticateWithDevice,
    stepUpForSigning,
    loadCredentials,
    revokeCredential,
    getContext,
    getDeviceInfo,
  };
}
