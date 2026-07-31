'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';

import { ChevronRight, ChevronLeft, Camera, CheckCircle2, AlertCircle, CreditCard, User, Loader2, Check, RefreshCw, ZoomIn, RotateCcw, Eye, Video } from 'lucide-react';
import AppImage from '@/components/ui/AppImage';
import PublicTokenLayout from '@/components/PublicTokenLayout';

// ─── Types ────────────────────────────────────────────────────────────────────

type IdType = 'INE' | 'Pasaporte' | 'FM3';

type CaptureError =
  | 'blurry' | 'poor_framing' | 'wrong_side' | 'face_not_detected' | 'camera_error'
  | null;

interface EnrollmentData {
  tipoId: IdType | null;
  anversoCapture: string | null;
  reversoCapture: string | null;
  selfieCapture: string | null;
  selfieVideo: string | null; // base64 video
  nombre: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  curp: string;
  rfc: string;
  fechaNacimiento: string;
  sexo: string;
}

interface OcrResult {
  nombres: string;
  primerApellido: string;
  segundoApellido: string;
  curp: string;
  vigencia: string;
  vigente: boolean | null;
  vigenciaYear: number | null;
  tipo: string;
}

// ─── Design tokens ────────────────────────────────────────────────────────────────────

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
  amber: '#f59e0b',
  amberLight: '#fef3c7',
  amberBorder: '#fcd34d',
  text: '#111827',
  textMuted: '#6b7280',
  textLight: '#9ca3af',
};

// ─── Constants ────────────────────────────────────────────────────────────────
const SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const MAX_RETRY_ATTEMPTS = 3;
const CAPTURE_TIMEOUT_MS = 8000; // 8 seconds
const MAX_VIDEO_DURATION_MS = 3000; // 3 seconds (reduced for reliability)

// ─── Transition wrapper ───────────────────────────────────────────────────────

function ScreenTransition({ children, screenKey }: { children: React.ReactNode; screenKey: number }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 20);
    return () => clearTimeout(t);
  }, [screenKey]);
  return (
    <div style={{ opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(18px)', transition: 'opacity 0.32s ease, transform 0.32s ease' }}>
      {children}
    </div>
  );
}

// ─── Success Checkmark Animation ─────────────────────────────────────────────

function SuccessCheckmark({ size = 48 }: { size?: number }) {
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setAnimate(true), 80);
    return () => clearTimeout(t);
  }, []);
  return (
    <div style={{ width: size + 24, height: size + 24, borderRadius: '50%', background: BRAND.greenLight, border: `2px solid ${BRAND.greenBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: animate ? 'scale(1)' : 'scale(0.4)', opacity: animate ? 1 : 0, transition: 'transform 0.45s cubic-bezier(0.34,1.56,0.64,1), opacity 0.3s ease' }}>
      <Check size={size} strokeWidth={2.5} style={{ color: BRAND.green, strokeDasharray: 100, strokeDashoffset: animate ? 0 : 100, transition: 'stroke-dashoffset 0.5s ease 0.2s' }} />
    </div>
  );
}

// ─── Processing Spinner Overlay ───────────────────────────────────────────────

function ProcessingOverlay({ message }: { message: string }) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(245,247,250,0.92)', borderRadius: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, zIndex: 10 }}>
      <div style={{ width: 56, height: 56, borderRadius: '50%', border: `3px solid ${BRAND.cardBorder}`, borderTop: `3px solid ${BRAND.blue}`, animation: 'spin 0.8s linear infinite' }} />
      <p style={{ color: BRAND.textMuted, fontSize: 13, fontWeight: 500 }}>{message}</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── Error Banner ─────────────────────────────────────────────────────────────

const ERROR_CONFIG: Record<NonNullable<CaptureError>, { title: string; hint: string; icon: React.ElementType }> = {
  blurry: { title: 'Imagen borrosa', hint: 'Mantén el dispositivo firme y asegúrate de que haya buena iluminación antes de capturar.', icon: ZoomIn },
  poor_framing: { title: 'Encuadre incorrecto', hint: 'Coloca tu identificación completamente dentro del recuadro y aléjate un poco si es necesario.', icon: RotateCcw },
  wrong_side: { title: 'Lado incorrecto de la identificación', hint: 'Asegúrate de mostrar el lado correcto: anverso (frente con foto) o reverso (parte trasera).', icon: Eye },
  face_not_detected: { title: 'Rostro no detectado', hint: 'Centra tu cara en el óvalo, mira directamente a la cámara y asegúrate de tener buena iluminación.', icon: User },
  camera_error: { title: 'Error de cámara', hint: 'No se pudo acceder a la cámara. Verifica que hayas otorgado los permisos necesarios.', icon: Camera },
};

function ErrorBanner({ error, onRetry, retryCount = 0, maxRetries = MAX_RETRY_ATTEMPTS }: { error: NonNullable<CaptureError>; onRetry: () => void; retryCount?: number; maxRetries?: number }) {
  const cfg = ERROR_CONFIG[error];
  const IconComp = cfg.icon;
  const retriesLeft = maxRetries - retryCount;
  return (
    <div style={{ background: BRAND.redLight, border: `1.5px solid ${BRAND.redBorder}`, borderRadius: 14, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#fecaca', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <IconComp size={16} color={BRAND.red} />
        </div>
        <div>
          <p style={{ color: '#991b1b', fontWeight: 700, fontSize: 13 }}>{cfg.title}</p>
          <p style={{ color: '#b91c1c', fontSize: 12, marginTop: 2, lineHeight: 1.4 }}>{cfg.hint}</p>
          {retryCount > 0 && (
            <p style={{ color: '#b91c1c', fontSize: 11, marginTop: 4, fontWeight: 600 }}>
              Intento {retryCount}/{maxRetries} — {retriesLeft > 0 ? `${retriesLeft} restante${retriesLeft !== 1 ? 's' : ''}` : 'Sin intentos restantes'}
            </p>
          )}
        </div>
      </div>
      {retriesLeft > 0 ? (
        <button onClick={onRetry} style={{ background: BRAND.red, color: '#fff', border: 'none', borderRadius: 10, padding: '9px 0', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer', width: '100%' }}>
          <RefreshCw size={14} /> Reintentar
        </button>
      ) : (
        <p style={{ color: '#991b1b', fontSize: 12, textAlign: 'center', fontWeight: 600 }}>Máximo de intentos alcanzado. Regresa al inicio para reiniciar.</p>
      )}
    </div>
  );
}

// ─── Session Expiration Banner ────────────────────────────────────────────────

function SessionExpiredBanner({ onRestart }: { onRestart: () => void }) {
  return (
    <div style={{ background: BRAND.amberLight, border: `1.5px solid ${BRAND.amberBorder}`, borderRadius: 14, padding: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
      <AlertCircle size={28} color={BRAND.amber} />
      <div>
        <p style={{ color: '#92400e', fontWeight: 700, fontSize: 14, margin: 0 }}>Sesión expirada</p>
        <p style={{ color: '#b45309', fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>Tu sesión de enrolamiento ha expirado por inactividad. Por seguridad, debes reiniciar el proceso.</p>
      </div>
      <button onClick={onRestart} style={{ background: BRAND.amber, color: '#fff', border: 'none', borderRadius: 10, padding: '10px 24px', fontWeight: 700, fontSize: 13, cursor: 'pointer', width: '100%' }}>
        Reiniciar desde el inicio
      </button>
    </div>
  );
}

// ─── Timeout Warning Banner ───────────────────────────────────────────────────

function TimeoutWarningBanner({ secondsLeft }: { secondsLeft: number }) {
  if (secondsLeft > 60) return null;
  return (
    <div style={{ background: BRAND.amberLight, border: `1.5px solid ${BRAND.amberBorder}`, borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <AlertCircle size={16} color={BRAND.amber} style={{ flexShrink: 0 }} />
      <p style={{ color: '#92400e', fontSize: 12, fontWeight: 600, margin: 0 }}>Sesión expira en {secondsLeft}s — completa el proceso pronto</p>
    </div>
  );
}

// ─── Camera Hook ──────────────────────────────────────────────────────────────

function useCamera(facingMode: 'environment' | 'user' = 'environment') {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  const startCamera = useCallback(async () => {
    setError(null);
    setIsReady(false);
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } } });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        videoRef.current.onloadedmetadata = () => setIsReady(true);
      }
    } catch {
      setError('camera_error');
    }
  }, [facingMode]);

  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      setStream(null);
      setIsReady(false);
    }
  }, [stream]);

  const captureWithCrop = useCallback((guideEl?: HTMLElement | null): string | null => {
    if (!videoRef.current || !isReady) return null;
    const video = videoRef.current;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (guideEl) {
      const videoRect = video.getBoundingClientRect();
      const guideRect = guideEl.getBoundingClientRect();
      const scaleX = vw / videoRect.width;
      const scaleY = vh / videoRect.height;
      const cropX = (guideRect.left - videoRect.left) * scaleX;
      const cropY = (guideRect.top - videoRect.top) * scaleY;
      const cropW = guideRect.width * scaleX;
      const cropH = guideRect.height * scaleY;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(cropW);
      canvas.height = Math.round(cropH);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.92);
    }
    const canvas = document.createElement('canvas');
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.85);
  }, [isReady]);

  const capture = useCallback((): string | null => captureWithCrop(), [captureWithCrop]);

  useEffect(() => {
    return () => { if (stream) stream.getTracks().forEach((t) => t.stop()); };
  }, [stream]);

  return { videoRef, stream, error, isReady, startCamera, stopCamera, capture, captureWithCrop };
}

// ─── Camera Timeout Hook ──────────────────────────────────────────────────────

function useCameraTimeout(isReady: boolean, cameraStarted: boolean, captured: boolean, timeoutMs = 30000) {
  const [showTimeoutMsg, setShowTimeoutMsg] = useState(false);

  useEffect(() => {
    if (!cameraStarted || isReady || captured) return;
    setShowTimeoutMsg(false);
    const timer = setTimeout(() => {
      if (!isReady) {
        setShowTimeoutMsg(true);
        setTimeout(() => {
          if (typeof window !== 'undefined') window.location.reload();
        }, 3000);
      }
    }, timeoutMs);
    return () => clearTimeout(timer);
  }, [cameraStarted, isReady, captured, timeoutMs]);

  return showTimeoutMsg;
}


// ─── Back Button ──────────────────────────────────────────────────────────────

function BackBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 4, color: BRAND.textMuted, fontSize: 13, fontWeight: 500, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', marginBottom: 12 }}>
      <ChevronLeft size={16} /> Regresar
    </button>
  );
}

// ─── Secondary Button ─────────────────────────────────────────────────────────

function SecondaryBtn({ onClick, disabled, children }: { onClick?: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ width: '100%', padding: '13px 0', borderRadius: 16, background: disabled ? '#f3f4f6' : '#fff', color: disabled ? BRAND.textLight : BRAND.textMuted, fontWeight: 600, fontSize: 14, border: `1.5px solid ${disabled ? '#e5e7eb' : BRAND.cardBorder}`, cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'all 0.15s', opacity: disabled ? 0.6 : 1 }}>
      {children}
    </button>
  );
}

// ─── Primary Button ───────────────────────────────────────────────────────────

function PrimaryBtn({ onClick, disabled, children, variant = 'blue' }: { onClick?: () => void; disabled?: boolean; children: React.ReactNode; variant?: 'blue' | 'green' }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ width: '100%', padding: '15px 0', borderRadius: 16, background: disabled ? '#d1d5db' : variant === 'green' ? BRAND.green : BRAND.blueGradient, color: '#fff', fontWeight: 700, fontSize: 15, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'transform 0.15s, opacity 0.15s', opacity: disabled ? 0.6 : 1 }}>
      {children}
    </button>
  );
}

// ─── Section Card ─────────────────────────────────────────────────────────────

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: BRAND.card, border: `1.5px solid ${BRAND.cardBorder}`, borderRadius: 16, padding: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', ...style }}>
      {children}
    </div>
  );
}

// ─── Reiniciar Confirmation Modal ─────────────────────────────────────────────

function ReiniciarModal({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: BRAND.card, borderRadius: 20, padding: 24, maxWidth: 360, width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: BRAND.amberLight, border: `2px solid ${BRAND.amberBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <AlertCircle size={26} color={BRAND.amber} />
          </div>
          <h3 style={{ color: BRAND.text, fontSize: 18, fontWeight: 700, margin: 0 }}>¿Reiniciar enrolamiento?</h3>
          <p style={{ color: BRAND.textMuted, fontSize: 14, lineHeight: 1.6, margin: 0 }}>
            Se perderán todos los datos capturados hasta ahora. ¿Deseas reiniciar el proceso desde el principio?
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button onClick={onConfirm} style={{ width: '100%', padding: '13px 0', borderRadius: 14, background: BRAND.amber, color: '#fff', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer' }}>
            Sí, reiniciar enrolamiento
          </button>
          <button onClick={onCancel} style={{ width: '100%', padding: '13px 0', borderRadius: 14, background: '#fff', color: BRAND.textMuted, fontWeight: 600, fontSize: 14, border: `1.5px solid ${BRAND.cardBorder}`, cursor: 'pointer' }}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Screen 3 & 4: ID Scanner ─────────────────────────────────────────

function IdScannerScreen({ side, tipoId, onCapture, onBack, onSessionExpired }: { side: 'anverso' | 'reverso'; tipoId: IdType; onCapture: (img: string) => void; onBack: () => void; onSessionExpired: () => void }) {
  const { videoRef, stream, error: camError, isReady, startCamera, stopCamera, captureWithCrop } = useCamera('environment');
  const guideRef = useRef<HTMLDivElement>(null);
  const [captured, setCaptured] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [cameraStarted, setCameraStarted] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);

  const showTimeoutMsg = useCameraTimeout(isReady, cameraStarted, !!captured);

  useEffect(() => {
    if (typeof navigator !== 'undefined') {
      setIsAndroid(/android/i.test(navigator.userAgent));
    }
  }, []);

  const toggleTorch = async () => {
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;
    try {
      const newState = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: newState } as MediaTrackConstraintSet] });
      setTorchOn(newState);
    } catch {
      // torch not supported on this device
    }
  };

  const titleLabel = side === 'anverso'
    ? tipoId === 'INE' ? 'Ajusta el frente de tu INE' : `Ajusta el frente de tu ${tipoId}`
    : tipoId === 'INE' ? 'Ajusta el reverso de tu INE' : `Ajusta el reverso de tu ${tipoId}`;

  // Auto-start camera on mount
  useEffect(() => {
    const init = async () => {
      setCameraStarted(true);
      await startCamera();
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCapture = () => {
    const img = captureWithCrop(guideRef.current);
    if (img) { setCaptured(img); stopCamera(); }
  };

  const handleRetry = () => { setCaptured(null); setRetryCount((c) => c + 1); startCamera(); };
  const handleUsePhoto = () => { if (captured) onCapture(captured); };

  const handleBack = () => {
    stopCamera();
    onBack();
  };

  useEffect(() => { return () => { stopCamera(); }; /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const CORNER = 22;
  const CORNER_THICKNESS = 3;
  const CORNER_COLOR = '#3b82f6';

  const cornerStyle = (pos: 'tl' | 'tr' | 'bl' | 'br'): React.CSSProperties => ({
    position: 'absolute', width: CORNER, height: CORNER,
    ...(pos === 'tl' ? { top: -1, left: -1, borderTop: `${CORNER_THICKNESS}px solid ${CORNER_COLOR}`, borderLeft: `${CORNER_THICKNESS}px solid ${CORNER_COLOR}`, borderTopLeftRadius: 6 } : {}),
    ...(pos === 'tr' ? { top: -1, right: -1, borderTop: `${CORNER_THICKNESS}px solid ${CORNER_COLOR}`, borderRight: `${CORNER_THICKNESS}px solid ${CORNER_COLOR}`, borderTopRightRadius: 6 } : {}),
    ...(pos === 'bl' ? { bottom: -1, left: -1, borderBottom: `${CORNER_THICKNESS}px solid ${CORNER_COLOR}`, borderLeft: `${CORNER_THICKNESS}px solid ${CORNER_COLOR}`, borderBottomLeftRadius: 6 } : {}),
    ...(pos === 'br' ? { bottom: -1, right: -1, borderBottom: `${CORNER_THICKNESS}px solid ${CORNER_COLOR}`, borderRight: `${CORNER_THICKNESS}px solid ${CORNER_COLOR}`, borderBottomRightRadius: 6 } : {}),
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100dvh', background: '#000', position: 'relative', overflow: 'hidden' }}>
      {cameraStarted && !captured && (
        <video ref={videoRef} autoPlay playsInline muted style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 1 }} />
      )}
      {cameraStarted && !captured && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 2, background: 'rgba(0,0,0,0.55)' }} />
      )}
      {showTimeoutMsg && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.85)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 }}>
          <Loader2 size={40} color="#f59e0b" style={{ animation: 'spin 1s linear infinite' }} />
          <p style={{ color: '#fef3c7', fontSize: 16, fontWeight: 700, textAlign: 'center', margin: 0 }}>La cámara tardó en cargar</p>
          <p style={{ color: '#fcd34d', fontSize: 14, textAlign: 'center', margin: 0, lineHeight: 1.5 }}>Se repetirá el proceso automáticamente en unos segundos...</p>
        </div>
      )}
      {retryCount > 0 && retryCount < MAX_RETRY_ATTEMPTS && (
        <div style={{ position: 'absolute', top: 'max(16px, env(safe-area-inset-top, 16px))', left: 16, background: 'rgba(245,158,11,0.9)', borderRadius: 20, padding: '4px 10px', zIndex: 30 }}>
          <p style={{ color: '#fff', fontSize: 11, fontWeight: 700, margin: 0 }}>Intento {retryCount}/{MAX_RETRY_ATTEMPTS}</p>
        </div>
      )}
      {/* Torch button — Android only, top-left */}
      {isAndroid && cameraStarted && !captured && (
        <button onClick={toggleTorch} style={{ position: 'absolute', top: 'max(16px, env(safe-area-inset-top, 16px))', left: 16, width: 44, height: 44, borderRadius: '50%', background: torchOn ? 'rgba(250,204,21,0.85)' : 'rgba(255,255,255,0.18)', border: `2px solid ${torchOn ? 'rgba(250,204,21,0.9)' : 'rgba(255,255,255,0.3)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 30 }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill={torchOn ? '#111827' : 'none'} stroke={torchOn ? '#111827' : '#fff'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6c0-2.21-2.69-4-6-4S6 3.79 6 6l2 14h8L18 6z"/>
            <line x1="6" y1="6" x2="18" y2="6"/>
          </svg>
        </button>
      )}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: 'max(56px, calc(env(safe-area-inset-top, 0px) + 48px))', paddingBottom: 16, textAlign: 'center', paddingLeft: 24, paddingRight: 24, zIndex: 30 }}>
        <h2 style={{ color: '#fff', fontSize: 'clamp(15px, 4vw, 18px)', fontWeight: 600, margin: 0, lineHeight: 1.4 }}>{titleLabel}</h2>
      </div>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 10, padding: '100px 20px 130px' }}>
        {captured ? (
          <div style={{ width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div style={{ width: '100%', borderRadius: 12, overflow: 'hidden', position: 'relative', border: '2px solid rgba(255,255,255,0.3)', boxShadow: '0 4px 24px rgba(0,0,0,0.6)' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={captured} alt="Captura recortada de identificación" style={{ width: '100%', height: 'auto', display: 'block' }} />
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <SuccessCheckmark size={40} />
              </div>
            </div>
            <p style={{ color: '#22c55e', fontSize: 13, fontWeight: 600, textAlign: 'center', display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
              <CheckCircle2 size={16} /> Captura exitosa
            </p>
          </div>
        ) : cameraStarted ? (
          <div ref={guideRef} style={{ width: '100%', maxWidth: 360, aspectRatio: '1.586', position: 'relative', borderRadius: 10, background: 'transparent', boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)', zIndex: 3 }}>
            <div style={cornerStyle('tl')} />
            <div style={cornerStyle('tr')} />
            <div style={cornerStyle('bl')} />
            <div style={cornerStyle('br')} />
            <div style={{ position: 'absolute', inset: 0, borderRadius: 10, border: '1px solid rgba(255,255,255,0.2)' }} />
            {!isReady && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Loader2 size={28} color="rgba(255,255,255,0.5)" style={{ animation: 'spin 1s linear infinite' }} />
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </div>
            )}
          </div>
        ) : (
          <div style={{ width: '100%', maxWidth: 360, aspectRatio: '1.586', background: '#111827', borderRadius: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, border: '1px solid #1f2937' }}>
            <Camera size={44} color="#4b5563" strokeWidth={1.5} />
            <p style={{ color: '#6b7280', fontSize: 14, margin: 0, fontWeight: 400 }}>{side === 'anverso' ? 'Frente de la identificación' : 'Reverso de la identificación'}</p>
          </div>
        )}
        {camError && cameraStarted && !captured && (
          <div style={{ marginTop: 16, background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 10, padding: '10px 14px', maxWidth: 360, width: '100%' }}>
            <p style={{ color: '#fca5a5', fontSize: 13, textAlign: 'center', margin: 0 }}>No se pudo acceder a la cámara. Verifica los permisos.</p>
          </div>
        )}
      </div>
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: `16px 24px calc(env(safe-area-inset-bottom, 16px) + 16px)`, zIndex: 30, background: 'linear-gradient(to top, rgba(0,0,0,0.95) 60%, transparent 100%)' }}>
        {captured ? (
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={handleRetry} style={{ flex: 1, padding: '14px 0', borderRadius: 14, border: '1.5px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <RefreshCw size={15} /> Repetir
            </button>
            <button onClick={handleUsePhoto} style={{ flex: 2, padding: '14px 0', borderRadius: 14, background: 'linear-gradient(90deg, #2563eb 0%, #3b82f6 100%)', color: '#fff', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer', boxShadow: '0 4px 20px rgba(37,99,235,0.45)' }}>
              {side === 'anverso' ? 'Usar foto — Continuar al reverso' : 'Usar foto — Continuar'}
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button onClick={handleCapture} disabled={!isReady} style={{ width: '100%', padding: '16px 0', borderRadius: 14, background: !isReady ? 'rgba(255,255,255,0.15)' : '#ffffff', color: !isReady ? 'rgba(255,255,255,0.5)' : '#111827', fontWeight: 700, fontSize: 'clamp(14px, 4vw, 16px)', border: 'none', cursor: !isReady ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, boxShadow: !isReady ? 'none' : '0 2px 12px rgba(0,0,0,0.3)' }}>
              {!isReady ? <><Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> Cargando cámara...</> : <><span style={{ width: 14, height: 14, borderRadius: '50%', background: '#ef4444', display: 'inline-block', flexShrink: 0 }} /> Capturar Foto</>}
            </button>
            <button onClick={handleBack} style={{ width: '100%', padding: '13px 0', borderRadius: 14, border: '1.5px solid rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.08)', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <ChevronLeft size={16} /> Regresar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Passport Scanner Screen (anverso only, no reverso) ──────────────────────

function PassportScannerScreen({ onCapture, onBack, onSessionExpired }: { onCapture: (img: string) => void; onBack: () => void; onSessionExpired: () => void }) {
  const { videoRef, stream, error: camError, isReady, startCamera, stopCamera, captureWithCrop } = useCamera('environment');
  const guideRef = useRef<HTMLDivElement>(null);
  const [captured, setCaptured] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [cameraStarted, setCameraStarted] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);

  const showTimeoutMsg = useCameraTimeout(isReady, cameraStarted, !!captured);

  useEffect(() => {
    if (typeof navigator !== 'undefined') {
      setIsAndroid(/android/i.test(navigator.userAgent));
    }
  }, []);

  const toggleTorch = async () => {
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;
    try {
      const newState = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: newState } as MediaTrackConstraintSet] });
      setTorchOn(newState);
    } catch {
      // torch not supported on this device
    }
  };

  // Auto-start camera on mount
  useEffect(() => {
    const init = async () => {
      setCameraStarted(true);
      await startCamera();
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCapture = () => {
    const img = captureWithCrop(guideRef.current);
    if (img) { setCaptured(img); stopCamera(); }
  };

  const handleRetry = () => { setCaptured(null); setRetryCount((c) => c + 1); startCamera(); };
  const handleUsePhoto = () => { if (captured) onCapture(captured); };

  const handleBack = () => {
    stopCamera();
    onBack();
  };

  useEffect(() => { return () => { stopCamera(); }; /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const CORNER = 22;
  const CORNER_THICKNESS = 3;
  const CORNER_COLOR = '#3b82f6';

  const cornerStyle = (pos: 'tl' | 'tr' | 'bl' | 'br'): React.CSSProperties => ({
    position: 'absolute', width: CORNER, height: CORNER,
    ...(pos === 'tl' ? { top: -1, left: -1, borderTop: `${CORNER_THICKNESS}px solid ${CORNER_COLOR}`, borderLeft: `${CORNER_THICKNESS}px solid ${CORNER_COLOR}`, borderTopLeftRadius: 6 } : {}),
    ...(pos === 'tr' ? { top: -1, right: -1, borderTop: `${CORNER_THICKNESS}px solid ${CORNER_COLOR}`, borderRight: `${CORNER_THICKNESS}px solid ${CORNER_COLOR}`, borderTopRightRadius: 6 } : {}),
    ...(pos === 'bl' ? { bottom: -1, left: -1, borderBottom: `${CORNER_THICKNESS}px solid ${CORNER_COLOR}`, borderLeft: `${CORNER_THICKNESS}px solid ${CORNER_COLOR}`, borderBottomLeftRadius: 6 } : {}),
    ...(pos === 'br' ? { bottom: -1, right: -1, borderBottom: `${CORNER_THICKNESS}px solid ${CORNER_COLOR}`, borderRight: `${CORNER_THICKNESS}px solid ${CORNER_COLOR}`, borderBottomRightRadius: 6 } : {}),
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100dvh', background: '#000', position: 'relative', overflow: 'hidden' }}>
      {cameraStarted && !captured && (
        <video ref={videoRef} autoPlay playsInline muted style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 1 }} />
      )}
      {cameraStarted && !captured && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 2, background: 'rgba(0,0,0,0.55)' }} />
      )}
      {showTimeoutMsg && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.85)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 }}>
          <Loader2 size={40} color="#f59e0b" style={{ animation: 'spin 1s linear infinite' }} />
          <p style={{ color: '#fef3c7', fontSize: 16, fontWeight: 700, textAlign: 'center', margin: 0 }}>La cámara tardó en cargar</p>
          <p style={{ color: '#fcd34d', fontSize: 14, textAlign: 'center', margin: 0, lineHeight: 1.5 }}>Se repetirá el proceso automáticamente en unos segundos...</p>
        </div>
      )}
      {retryCount > 0 && retryCount < MAX_RETRY_ATTEMPTS && (
        <div style={{ position: 'absolute', top: 'max(16px, env(safe-area-inset-top, 16px))', left: 16, background: 'rgba(245,158,11,0.9)', borderRadius: 20, padding: '4px 10px', zIndex: 30 }}>
          <p style={{ color: '#fff', fontSize: 11, fontWeight: 700, margin: 0 }}>Intento {retryCount}/{MAX_RETRY_ATTEMPTS}</p>
        </div>
      )}
      {/* Torch button — Android only */}
      {isAndroid && cameraStarted && !captured && (
        <button onClick={toggleTorch} style={{ position: 'absolute', top: 'max(16px, env(safe-area-inset-top, 16px))', left: 16, width: 44, height: 44, borderRadius: '50%', background: torchOn ? 'rgba(250,204,21,0.85)' : 'rgba(255,255,255,0.18)', border: `2px solid ${torchOn ? 'rgba(250,204,21,0.9)' : 'rgba(255,255,255,0.3)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 30 }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill={torchOn ? '#111827' : 'none'} stroke={torchOn ? '#111827' : '#fff'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6c0-2.21-2.69-4-6-4S6 3.79 6 6l2 14h8L18 6z"/>
            <line x1="6" y1="6" x2="18" y2="6"/>
          </svg>
        </button>
      )}
      {/* Title — no orientation text */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: 'max(56px, calc(env(safe-area-inset-top, 0px) + 48px))', paddingBottom: 16, textAlign: 'center', paddingLeft: 24, paddingRight: 24, zIndex: 30 }}>
        <h2 style={{ color: '#fff', fontSize: 'clamp(15px, 4vw, 18px)', fontWeight: 600, margin: 0 }}>Anverso de pasaporte</h2>
        <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, margin: '6px 0 0', textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>Coloca la página de datos dentro del recuadro.</p>
      </div>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 10, padding: '120px 20px 130px' }}>
        {captured ? (
          <div style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div style={{ width: '100%', borderRadius: 12, overflow: 'hidden', position: 'relative', border: '2px solid rgba(255,255,255,0.3)', boxShadow: '0 4px 24px rgba(0,0,0,0.6)' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={captured} alt="Captura del anverso del pasaporte" style={{ width: '100%', height: 'auto', display: 'block' }} />
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <SuccessCheckmark size={40} />
              </div>
            </div>
            <p style={{ color: '#22c55e', fontSize: 13, fontWeight: 600, textAlign: 'center', display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
              <CheckCircle2 size={16} /> Captura exitosa
            </p>
          </div>
        ) : cameraStarted ? (
          /* Passport guide: landscape rectangle for passport page */
          <div ref={guideRef} style={{ width: '100%', maxWidth: 380, aspectRatio: '1.42', position: 'relative', borderRadius: 10, background: 'transparent', boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)', zIndex: 3 }}>
            <div style={cornerStyle('tl')} />
            <div style={cornerStyle('tr')} />
            <div style={cornerStyle('bl')} />
            <div style={cornerStyle('br')} />
            <div style={{ position: 'absolute', inset: 0, borderRadius: 10, border: '1px solid rgba(255,255,255,0.25)' }} />
            {!isReady && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Loader2 size={28} color="rgba(255,255,255,0.5)" style={{ animation: 'spin 1s linear infinite' }} />
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </div>
            )}
          </div>
        ) : (
          <div style={{ width: '100%', maxWidth: 380, aspectRatio: '1.42', background: '#111827', borderRadius: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, border: '1px solid #1f2937' }}>
            <Camera size={44} color="#4b5563" strokeWidth={1.5} />
            <p style={{ color: '#6b7280', fontSize: 14, margin: 0, fontWeight: 400 }}>Anverso de pasaporte</p>
          </div>
        )}
        {camError && cameraStarted && !captured && (
          <div style={{ marginTop: 16, background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 10, padding: '10px 14px', maxWidth: 360, width: '100%' }}>
            <p style={{ color: '#fca5a5', fontSize: 13, textAlign: 'center', margin: 0 }}>No se pudo acceder a la cámara. Verifica los permisos.</p>
          </div>
        )}
      </div>
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: `16px 24px calc(env(safe-area-inset-bottom, 16px) + 16px)`, zIndex: 30, background: 'linear-gradient(to top, rgba(0,0,0,0.95) 60%, transparent 100%)' }}>
        {captured ? (
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={handleRetry} style={{ flex: 1, padding: '14px 0', borderRadius: 14, border: '1.5px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <RefreshCw size={15} /> Repetir
            </button>
            <button onClick={handleUsePhoto} style={{ flex: 2, padding: '14px 0', borderRadius: 14, background: 'linear-gradient(90deg, #2563eb 0%, #3b82f6 100%)', color: '#fff', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer', boxShadow: '0 4px 20px rgba(37,99,235,0.45)' }}>
              Usar foto — Continuar
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button onClick={handleCapture} disabled={!isReady} style={{ width: '100%', padding: '16px 0', borderRadius: 14, background: !isReady ? 'rgba(255,255,255,0.15)' : '#ffffff', color: !isReady ? 'rgba(255,255,255,0.5)' : '#111827', fontWeight: 700, fontSize: 'clamp(14px, 4vw, 16px)', border: 'none', cursor: !isReady ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, boxShadow: !isReady ? 'none' : '0 2px 12px rgba(0,0,0,0.3)' }}>
              {!isReady ? <><Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> Cargando cámara...</> : <><Camera size={18} /> Capturar Foto</>}
            </button>
            <button onClick={handleBack} style={{ width: '100%', padding: '13px 0', borderRadius: 14, border: '1.5px solid rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.08)', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <ChevronLeft size={16} /> Regresar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Video Instruction Step type ─────────────────────────────────────────────

interface VideoInstructionStep {
  id: string;
  text: string;
  durationMs: number;
  animationClass: string;
}

const VIDEO_STEPS: VideoInstructionStep[] = [
  { id: 'center', text: 'Posiciónese dentro del óvalo', durationMs: 1500, animationClass: 'pulse' },
  { id: 'far', text: 'Acérquese o aléjese para posicionarse', durationMs: 1500, animationClass: 'zoomOut' },
  { id: 'close', text: 'Acérquese o aléjese para posicionarse', durationMs: 2000, animationClass: 'zoomIn' },
];

// ─── Screen 7: Video Selfie Capture (Fullscreen) ──────────────────────────────

function SelfieCaptureScreen({ onCapture, onBack, onSessionExpired }: { onCapture: (img: string, videoBase64: string) => void; onBack: () => void; onSessionExpired: () => void }) {
  const { videoRef, stream, error: camError, isReady, startCamera, stopCamera } = useCamera('user');
  const ovalRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingProgress, setRecordingProgress] = useState(0); // 0-100
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [capturedVideoBlob, setCapturedVideoBlob] = useState<Blob | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [recordingComplete, setRecordingComplete] = useState(false);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const showTimeoutMsg = useCameraTimeout(isReady, cameraActive, !!capturedPhoto);

  // Camera auto-starts on mount
  useEffect(() => {
    const init = async () => {
      setCameraActive(true);
      await startCamera();
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Animate through instruction steps during recording
  const runInstructionSteps = useCallback((stepIndex: number) => {
    if (stepIndex >= VIDEO_STEPS.length) return;
    setCurrentStepIdx(stepIndex);
    stepTimerRef.current = setTimeout(() => {
      runInstructionSteps(stepIndex + 1);
    }, VIDEO_STEPS[stepIndex].durationMs);
  }, [VIDEO_STEPS]);

  const capturePhotoFromVideo = useCallback((): string | null => {
    const video = videoRef.current;
    const ovalEl = ovalRef.current;
    if (!video || !ovalEl) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const videoRect = video.getBoundingClientRect();
    const ovalRect = ovalEl.getBoundingClientRect();
    const scaleX = vw / videoRect.width;
    const scaleY = vh / videoRect.height;
    const cropX = (ovalRect.left - videoRect.left) * scaleX;
    const cropY = (ovalRect.top - videoRect.top) * scaleY;
    const cropW = ovalRect.width * scaleX;
    const cropH = ovalRect.height * scaleY;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(cropW);
    canvas.height = Math.round(cropH);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.92);
  }, [videoRef]);

  const startRecording = useCallback(() => {
    if (!stream || !isReady) return;
    setCaptureError(null);
    setRecordingProgress(0);
    setCurrentStepIdx(0);
    recordedChunksRef.current = [];

    // Determine supported MIME type
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9' : MediaRecorder.isTypeSupported('video/webm')
      ? 'video/webm' : MediaRecorder.isTypeSupported('video/mp4')
      ? 'video/mp4' :'';

    try {
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: mimeType || 'video/webm' });
        setCapturedVideoBlob(blob);
        // Capture high-quality photo frame at end of recording
        const photo = capturePhotoFromVideo();
        if (photo) {
          setCapturedPhoto(photo);
        }
        setRecordingComplete(true);
        setIsRecording(false);
        stopCamera();
      };

      recorder.start(100); // collect data every 100ms
      setIsRecording(true);
      setRecordingComplete(false);

      // Start instruction animation
      runInstructionSteps(0);

      // Progress bar update
      const startTime = Date.now();
      progressIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min((elapsed / MAX_VIDEO_DURATION_MS) * 100, 100);
        setRecordingProgress(progress);
      }, 50);

      // Auto-stop after MAX_VIDEO_DURATION_MS (3 seconds)
      recordingTimerRef.current = setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
        if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
        if (stepTimerRef.current) clearTimeout(stepTimerRef.current);
      }, MAX_VIDEO_DURATION_MS);
    } catch (err) {
      console.error('[SelfieCaptureScreen] MediaRecorder error:', err);
      setCaptureError('No se pudo iniciar la grabación. Verifica los permisos de cámara.');
    }
  }, [stream, isReady, runInstructionSteps, capturePhotoFromVideo, stopCamera]);

  const handleStopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current);
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    if (stepTimerRef.current) clearTimeout(stepTimerRef.current);
  }, []);

  const handleRetry = () => {
    if (retryCount >= MAX_RETRY_ATTEMPTS - 1) {
      onSessionExpired();
      return;
    }
    setCapturedPhoto(null);
    setCapturedVideoBlob(null);
    setCaptureError(null);
    setRecordingComplete(false);
    setRecordingProgress(0);
    setCurrentStepIdx(0);
    setRetryCount((c) => c + 1);
    setCameraActive(true);
    startCamera();
  };

  const handleUseCapture = async () => {
    if (!capturedPhoto || !capturedVideoBlob) return;
    // Convert video blob to base64 to send to Nubarium as tipo=video
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      onCapture(capturedPhoto, base64);
    };
    reader.readAsDataURL(capturedVideoBlob);
  };

  useEffect(() => {
    return () => {
      stopCamera();
      if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current);
      if (stepTimerRef.current) clearTimeout(stepTimerRef.current);
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentStep = VIDEO_STEPS[Math.min(currentStepIdx, VIDEO_STEPS.length - 1)];

  // Animation styles for instruction text
  const getInstructionStyle = (animClass: string): React.CSSProperties => {
    const base: React.CSSProperties = {
      color: '#fff',
      fontSize: 'clamp(14px, 4vw, 17px)',
      fontWeight: 700,
      textAlign: 'center',
      textShadow: '0 2px 8px rgba(0,0,0,0.8)',
      padding: '8px 16px',
      borderRadius: 12,
      background: 'rgba(59,130,246,0.75)',
      backdropFilter: 'blur(4px)',
      transition: 'all 0.3s ease',
      maxWidth: 320,
    };
    return base;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100dvh', background: '#000', position: 'relative', overflow: 'hidden' }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulseGlow { 0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,0.7)} 50%{box-shadow:0 0 0 14px rgba(239,68,68,0)} }
        @keyframes instructionPop { 0%{opacity:0;transform:scale(0.85)} 100%{opacity:1;transform:scale(1)} }
      `}</style>

      {/* Live video — mirrored for front camera */}
      {cameraActive && !recordingComplete && (
        <video ref={videoRef} autoPlay playsInline muted style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 1, transform: 'scaleX(-1)' }} />
      )}
      {/* Dark overlay */}
      {cameraActive && !recordingComplete && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 2, background: 'rgba(0,0,0,0.45)' }} />
      )}

      {/* Camera timeout overlay */}
      {showTimeoutMsg && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.85)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 }}>
          <Loader2 size={40} color="#f59e0b" style={{ animation: 'spin 1s linear infinite' }} />
          <p style={{ color: '#fef3c7', fontSize: 16, fontWeight: 700, textAlign: 'center', margin: 0 }}>La cámara tardó en cargar</p>
          <p style={{ color: '#fcd34d', fontSize: 14, textAlign: 'center', margin: 0, lineHeight: 1.5 }}>Se repetirá el proceso automáticamente en unos segundos...</p>
        </div>
      )}

      {/* Retry badge */}
      {retryCount > 0 && (
        <div style={{ position: 'absolute', top: 'max(16px, env(safe-area-inset-top, 16px))', left: 16, background: 'rgba(245,158,11,0.9)', borderRadius: 20, padding: '4px 10px', zIndex: 30 }}>
          <p style={{ color: '#fff', fontSize: 11, fontWeight: 700, margin: 0 }}>Intento {retryCount + 1}/{MAX_RETRY_ATTEMPTS}</p>
        </div>
      )}

      {/* Title */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: 'max(56px, calc(env(safe-area-inset-top, 0px) + 48px))', paddingBottom: 16, textAlign: 'center', paddingLeft: 24, paddingRight: 24, zIndex: 30 }}>
        <h2 style={{ color: '#fff', fontSize: 'clamp(15px, 4vw, 18px)', fontWeight: 600, margin: 0 }}>Captura de rostro</h2>
        {cameraActive && !isRecording && !recordingComplete && (
          <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13, margin: '4px 0 0' }}>Posiciónese dentro del óvalo y presione Iniciar grabación</p>
        )}
      </div>

      {/* Center area */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 10, padding: '110px 20px 160px' }}>
        {recordingComplete && capturedPhoto ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 220, height: 260, borderRadius: '50%', overflow: 'hidden', border: '3px solid #3b82f6', boxShadow: '0 0 0 4px rgba(59,130,246,0.25), 0 8px 32px rgba(0,0,0,0.6)', position: 'relative' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={capturedPhoto} alt="Selfie capturada" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <SuccessCheckmark size={36} />
              </div>
            </div>
            <p style={{ color: '#22c55e', fontSize: 13, fontWeight: 600, textAlign: 'center', display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
              <CheckCircle2 size={16} /> Video y foto capturados
            </p>
          </div>
        ) : cameraActive ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, width: '100%' }}>
            {/* Oval guide — larger with thicker red border */}
            <div ref={ovalRef} style={{ width: 'min(85vw, 310px)', height: 'min(105vw, 390px)', borderRadius: '50%', position: 'relative', boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)', border: isRecording ? '5px solid #ef4444' : '4px solid #ef4444', zIndex: 3, animation: isRecording ? 'pulseGlow 1.5s ease-in-out infinite' : 'none' }}>
              <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.15)' }} />
              {!isReady && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Loader2 size={28} color="rgba(255,255,255,0.5)" style={{ animation: 'spin 1s linear infinite' }} />
                </div>
              )}
            </div>

            {/* Positioning hint — always visible when camera active and not recording */}
            {!isRecording && isReady && (
              <div style={{ color: '#fff', fontSize: 'clamp(13px, 3.5vw, 15px)', fontWeight: 600, textAlign: 'center', textShadow: '0 2px 8px rgba(0,0,0,0.8)', padding: '6px 14px', borderRadius: 10, background: 'rgba(0,0,0,0.5)', maxWidth: 300 }}>
                Acérquese o aléjese para posicionarse
              </div>
            )}

            {/* Animated instruction during recording */}
            {isRecording && (
              <div key={currentStep.id} style={{ animation: 'instructionPop 0.3s ease', ...getInstructionStyle(currentStep.animationClass) }}>
                {currentStep.text}
              </div>
            )}

            {/* Progress bar during recording */}
            {isRecording && (
              <div style={{ width: 'min(85vw, 310px)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ width: '100%', background: 'rgba(255,255,255,0.2)', borderRadius: 99, height: 6 }}>
                  <div style={{ background: '#ef4444', height: 6, borderRadius: 99, width: `${recordingProgress}%`, transition: 'width 0.1s linear' }} />
                </div>
                <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: 11, textAlign: 'center', margin: 0 }}>
                  {Math.ceil(((100 - recordingProgress) / 100) * (MAX_VIDEO_DURATION_MS / 1000))}s restantes
                </p>
              </div>
            )}
          </div>
        ) : (
          <div style={{ width: 'min(85vw, 310px)', height: 'min(105vw, 390px)', borderRadius: '50%', background: '#111827', border: '4px solid #1f2937', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <Video size={44} color="#4b5563" strokeWidth={1.5} />
            <p style={{ color: '#6b7280', fontSize: 13, margin: 0, textAlign: 'center', padding: '0 20px' }}>Iniciando cámara...</p>
          </div>
        )}

        {camError && cameraActive && !recordingComplete && (
          <div style={{ marginTop: 16, background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 10, padding: '10px 14px', maxWidth: 320, width: '100%' }}>
            <p style={{ color: '#fca5a5', fontSize: 13, textAlign: 'center', margin: 0 }}>No se pudo acceder a la cámara. Verifica los permisos.</p>
          </div>
        )}
        {captureError && (
          <div style={{ marginTop: 16, background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 10, padding: '10px 14px', maxWidth: 320, width: '100%' }}>
            <p style={{ color: '#fca5a5', fontSize: 13, textAlign: 'center', margin: 0 }}>{captureError}</p>
          </div>
        )}
      </div>

      {/* Fixed bottom buttons */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: `16px 24px calc(env(safe-area-inset-bottom, 16px) + 16px)`, zIndex: 30, background: 'linear-gradient(to top, rgba(0,0,0,0.95) 60%, transparent 100%)' }}>
        {recordingComplete && capturedPhoto ? (
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={handleRetry} disabled={retryCount >= MAX_RETRY_ATTEMPTS - 1} style={{ flex: 1, padding: '14px 0', borderRadius: 14, border: '1.5px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)', color: '#fff', fontWeight: 600, fontSize: 14, cursor: retryCount >= MAX_RETRY_ATTEMPTS - 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <RefreshCw size={15} /> Repetir
            </button>
            <button onClick={handleUseCapture} style={{ flex: 2, padding: '14px 0', borderRadius: 14, background: 'linear-gradient(90deg, #2563eb 0%, #3b82f6 100%)', color: '#fff', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer', boxShadow: '0 4px 20px rgba(37,99,235,0.45)' }}>
              Usar video y foto
            </button>
          </div>
        ) : isRecording ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '8px 0' }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444', display: 'inline-block', animation: 'pulseGlow 1s ease-in-out infinite' }} />
              <span style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>Grabando...</span>
            </div>
            <button onClick={handleStopRecording} style={{ width: '100%', padding: '13px 0', borderRadius: 14, border: '1.5px solid rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.08)', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              Detener grabación
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button onClick={startRecording} disabled={!isReady} style={{ width: '100%', padding: '16px 0', borderRadius: 14, background: !isReady ? 'rgba(255,255,255,0.15)' : '#ffffff', color: !isReady ? 'rgba(255,255,255,0.5)' : '#111827', fontWeight: 700, fontSize: 'clamp(14px, 4vw, 16px)', border: 'none', cursor: !isReady ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, boxShadow: !isReady ? 'none' : '0 2px 12px rgba(0,0,0,0.3)' }}>
              {!isReady ? <><Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> Cargando cámara...</> : <><Video size={18} /> Iniciar grabación (3s)</>}
            </button>
            <button onClick={() => { stopCamera(); onBack(); }} style={{ width: '100%', padding: '13px 0', borderRadius: 14, border: '1.5px solid rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.08)', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <ChevronLeft size={16} /> Regresar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Screen 8: Selfie vs ID validation ───────────────────────────────────────

function Screen8({ selfie, selfieVideo, idAnverso, token, onConfirm, onBack, processingCaptures }: { selfie: string | null; selfieVideo: string | null; idAnverso: string | null; token: string; onConfirm: () => void; onBack: () => void; processingCaptures?: boolean }) {
  const [validating, setValidating] = useState(true);
  const [similitud, setSimilitud] = useState<number | null>(null);
  const [aprobado, setAprobado] = useState(false);
  const [faceApiError, setFaceApiError] = useState<string | null>(null);
  const calledRef = useRef(false);

  useEffect(() => {
    if (calledRef.current) return;
    calledRef.current = true;

    const runFaceComparison = async () => {
      if (!selfie || !idAnverso) {
        setFaceApiError('No se encontraron las imágenes necesarias para la comparación.');
        setValidating(false);
        return;
      }
      try {
        // Always use the JPEG selfie photo (tipo=imagen) — video base64 is too large and unsupported by Nubarium reconocimiento_facial
        const res = await fetch('/api/nubarium/reconocimiento-facial', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            credencial: idAnverso,
            captura: selfie,
            enrollmentToken: token,
          }),
        });

        let data: Record<string, unknown> = {};
        try {
          data = await res.json();
        } catch {
          // Could not parse JSON at all — real connection/parse error
          setFaceApiError('Error de conexión al validar la identidad facial.');
          setValidating(false);
          return;
        }

        // If it's a real network/server error (flagged by API route)
        if (data.networkError) {
          setFaceApiError(
            typeof data.error === 'string'
              ? data.error
              : 'Error de conexión al validar la identidad facial.'
          );
          setValidating(false);
          return;
        }

        // If Nubarium returned similarity data (even on non-OK HTTP status)
        if (typeof data.similitud === 'number') {
          const sim = data.similitud as number;
          setSimilitud(sim);
          setAprobado(sim >= 99.50);
          setValidating(false);
          return;
        }

        // If Nubarium returned an error without similarity (e.g. bad image format)
        if (data.error || (data.estatus && data.estatus !== 'OK')) {
          const nubariumMsg = typeof data.mensaje === 'string' ? data.mensaje : null;
          const apiError = typeof data.error === 'string' ? data.error : null;
          setFaceApiError(
            nubariumMsg || apiError || 'Error al comparar rostros con Nubarium.'
          );
          setValidating(false);
          return;
        }

        // Fallback: non-OK with no useful data
        if (!res.ok) {
          setFaceApiError('Error al comunicarse con el servicio biométrico. Intente nuevamente.');
          setValidating(false);
          return;
        }

        // OK response but no similitud field
        setFaceApiError('Respuesta inesperada del servicio biométrico.');
      } catch {
        setFaceApiError('Error de conexión al validar la identidad facial.');
      } finally {
        setValidating(false);
      }
    };

    runFaceComparison();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isLoading = validating || !!processingCaptures;
  const canContinue = !isLoading && aprobado && !faceApiError;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 style={{ color: BRAND.text, fontSize: 20, fontWeight: 700, margin: 0 }}>Validación facial</h2>
        <p style={{ color: BRAND.textMuted, fontSize: 13, marginTop: 4 }}>Comparando selfie con tu identificación</p>
      </div>

      {isLoading && (
        <Card style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '20px 16px' }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', border: `3px solid ${BRAND.cardBorder}`, borderTop: `3px solid ${BRAND.blue}`, animation: 'spin 0.8s linear infinite' }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <p style={{ color: BRAND.textMuted, fontSize: 13, margin: 0 }}>
            {processingCaptures ? 'Procesando capturas...' : 'Comparando rostros...'}
          </p>
          <div style={{ width: '100%', background: '#e5e7eb', borderRadius: 99, height: 6 }}>
            <div style={{ background: BRAND.blue, height: 6, borderRadius: 99, width: '70%', animation: 'pulse 1.5s ease-in-out infinite' }} />
            <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }`}</style>
          </div>
        </Card>
      )}

      {!isLoading && faceApiError && (
        <div style={{ background: BRAND.redLight, border: `1.5px solid ${BRAND.redBorder}`, borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <AlertCircle size={18} color={BRAND.red} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <p style={{ color: '#991b1b', fontWeight: 700, fontSize: 13, margin: 0 }}>Error en validación facial</p>
            <p style={{ color: '#b91c1c', fontSize: 12, marginTop: 4, lineHeight: 1.4 }}>{faceApiError}</p>
          </div>
        </div>
      )}

      {!isLoading && similitud !== null && (
        <Card style={{ background: aprobado ? BRAND.greenLight : BRAND.redLight, border: `1.5px solid ${aprobado ? BRAND.greenBorder : BRAND.redBorder}` }}>
          {aprobado && selfie && (
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={selfie}
                alt="Selfie capturada"
                style={{ width: 100, height: 120, borderRadius: 12, objectFit: 'cover', border: `2px solid ${BRAND.greenBorder}`, boxShadow: '0 4px 12px rgba(0,0,0,0.12)' }}
              />
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            {aprobado
              ? <CheckCircle2 size={20} color={BRAND.green} />
              : <AlertCircle size={20} color={BRAND.red} />}
            <p style={{ color: aprobado ? '#166534' : '#991b1b', fontWeight: 700, fontSize: 14, margin: 0 }}>
              {aprobado ? 'Identidad verificada' : 'No se pudo verificar la identidad'}
            </p>
          </div>
          <p style={{ color: aprobado ? '#166534' : '#991b1b', fontSize: 13, margin: 0 }}>
            Similitud: {similitud.toFixed(2)}%
          </p>
        </Card>
      )}

      {!isLoading && faceApiError && (
        <button onClick={onBack} style={{ width: '100%', padding: '15px 0', borderRadius: 16, background: BRAND.blueGradient, color: '#fff', fontWeight: 700, fontSize: 15, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <RefreshCw size={16} /> Volver a capturar
        </button>
      )}

      {!faceApiError && (
        <PrimaryBtn onClick={onConfirm} disabled={!canContinue}>
          Continuar <ChevronRight size={18} />
        </PrimaryBtn>
      )}

      <SecondaryBtn onClick={onBack}>
        <ChevronLeft size={16} /> Regresar
      </SecondaryBtn>
    </div>
  );
}

// ─── Screen 9: Confirmed data + submit ───────────────────────────────────────

function Screen9({ data, onConfirm, onBack, submitting, submitError, onReiniciar }: { data: EnrollmentData; onConfirm: () => void; onBack: () => void; submitting: boolean; submitError: string | null; onReiniciar: () => void }) {
  const [showReiniciarModal, setShowReiniciarModal] = useState(false);

  const fields = [
    { label: 'Nombre', value: data.nombre },
    { label: 'Apellido Paterno', value: data.apellidoPaterno },
    { label: 'Apellido Materno', value: data.apellidoMaterno },
    { label: 'CURP', value: data.curp },
    { label: 'Fecha de Nacimiento', value: data.fechaNacimiento },
    { label: 'Sexo', value: data.sexo === 'M' ? 'Masculino' : data.sexo === 'F' ? 'Femenino' : data.sexo || '—' },
    { label: 'Tipo de ID', value: data.tipoId || '—' },
  ];

  return (
    <>
      {showReiniciarModal && (
        <ReiniciarModal
          onConfirm={() => { setShowReiniciarModal(false); onReiniciar(); }}
          onCancel={() => setShowReiniciarModal(false)}
        />
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <h2 style={{ color: BRAND.text, fontSize: 20, fontWeight: 700, margin: 0 }}>Información validada</h2>
          <p style={{ color: BRAND.textMuted, fontSize: 13, marginTop: 4 }}>Revisa y confirma tus datos</p>
        </div>
        <Card style={{ background: '#eff4ff', border: '1.5px solid #bfdbfe' }}>
          {fields.map((field, idx) => (
            <div key={field.label} style={{ padding: '6px 0', display: 'flex', justifyContent: 'space-between', gap: 12, borderBottom: idx < fields.length - 1 ? `1px solid #bfdbfe` : 'none' }}>
              <p style={{ color: '#3b82f6', fontSize: 12, margin: 0 }}>{field.label}</p>
              <p style={{ color: '#1e40af', fontSize: 13, fontWeight: 600, textAlign: 'right', margin: 0 }}>{field.value || '—'}</p>
            </div>
          ))}
        </Card>
        {submitError && (
          <div style={{ background: BRAND.redLight, border: `1.5px solid ${BRAND.redBorder}`, borderRadius: 12, padding: '12px 14px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <AlertCircle size={16} color={BRAND.red} style={{ flexShrink: 0, marginTop: 1 }} />
            <p style={{ color: '#991b1b', fontSize: 13, margin: 0 }}>{submitError}</p>
          </div>
        )}
        <Card style={{ background: '#eff4ff', border: `1.5px solid #bfdbfe` }}>
          <p style={{ color: '#1e40af', fontSize: 12, lineHeight: 1.6, margin: 0 }}>Al confirmar, tus datos biométricos serán enviados de forma segura y cifrada para completar tu registro.</p>
        </Card>
        <PrimaryBtn onClick={onConfirm} disabled={submitting} variant="green">
          {submitting ? (
            <><Loader2 size={18} style={{ animation: 'spin 0.8s linear infinite' }} /> Enviando...<style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style></>
          ) : (
            <><CheckCircle2 size={18} /> Confirmar enrolamiento</>
          )}
        </PrimaryBtn>

        {/* Reiniciar enrolamiento button */}
        <button
          onClick={() => setShowReiniciarModal(true)}
          disabled={submitting}
          style={{ width: '100%', padding: '13px 0', borderRadius: 16, background: '#fff', color: BRAND.amber, fontWeight: 600, fontSize: 14, border: `1.5px solid ${BRAND.amberBorder}`, cursor: submitting ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: submitting ? 0.5 : 1 }}
        >
          <RefreshCw size={15} /> Reiniciar enrolamiento
        </button>
      </div>
    </>
  );
}

// ─── Enrollment Complete Screen (with auto-close timer) ──────────────────────

function EnrollmentCompleteScreen() {
  const [countdown, setCountdown] = useState(5);
  const [closed, setClosed] = useState(false);

  const handleClose = () => {
    try {
      window.close();
    } catch { /* ignore */ }
    setTimeout(() => setClosed(true), 300);
  };

  useEffect(() => {
    if (countdown <= 0) {
      handleClose();
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  if (closed) {
    return (
      <div style={{ minHeight: '100dvh', background: BRAND.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 20px' }}>
        <div style={{ maxWidth: 400, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: BRAND.greenLight, border: `2px solid ${BRAND.greenBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CheckCircle2 size={28} color={BRAND.green} />
          </div>
          <h2 style={{ color: BRAND.text, fontSize: 22, fontWeight: 800, margin: 0 }}>¡Proceso completado!</h2>
          <p style={{ color: BRAND.textMuted, fontSize: 14, lineHeight: 1.6 }}>
            Tu identidad ha sido verificada exitosamente. Puedes cerrar esta pestaña de forma segura.
          </p>
          <Card style={{ background: BRAND.greenLight, border: `1.5px solid ${BRAND.greenBorder}`, width: '100%' }}>
            <p style={{ color: '#166534', fontSize: 13, lineHeight: 1.6, margin: 0 }}>
              Los datos han sido enviados de forma segura. El proceso de firma puede continuar en la ventana principal.
            </p>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100dvh', background: BRAND.bg, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {/* Header */}
      <div style={{ width: '100%', maxWidth: 480, padding: '16px 20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <AppImage
            src="/assets/images/Docubox-tipo1-1774245058336.png"
            alt="Docubox logo"
            width={110}
            height={30}
            className="object-contain"
            priority={true}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {[1, 2, 5, 6, 8, 9].map((s) => (
            <div key={s} style={{ width: 18, height: 6, borderRadius: 99, background: BRAND.green, transition: 'all 0.3s ease' }} />
          ))}
        </div>
      </div>

      {/* Completion content */}
      <div style={{ width: '100%', maxWidth: 480, padding: '20px 20px 32px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, textAlign: 'center' }}>
        <div style={{ width: 72, height: 72, borderRadius: '50%', background: BRAND.greenLight, border: `2px solid ${BRAND.greenBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CheckCircle2 size={32} color={BRAND.green} />
        </div>
        <h2 style={{ color: BRAND.text, fontSize: 22, fontWeight: 800, margin: 0 }}>¡Enrolamiento completado!</h2>
        <p style={{ color: BRAND.textMuted, fontSize: 14, lineHeight: 1.6 }}>
          Tu identidad ha sido verificada exitosamente. Esta ventana se cerrará en {countdown} segundo{countdown !== 1 ? 's' : ''}.
        </p>
        <Card style={{ background: BRAND.greenLight, border: `1.5px solid ${BRAND.greenBorder}`, width: '100%' }}>
          <p style={{ color: '#166534', fontSize: 13, lineHeight: 1.6, margin: 0 }}>
            Los datos han sido enviados de forma segura. El proceso puede continuar en la ventana principal.
          </p>
        </Card>
        <button onClick={handleClose} style={{ width: '100%', padding: '14px 0', borderRadius: 14, background: BRAND.blueGradient, color: '#fff', border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          Cerrar ahora
        </button>
      </div>
    </div>
  );
}

// ─── Screen 1: Welcome ────────────────────────────────────────────────────────

function Screen1({ onStart }: { onStart: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ textAlign: 'center', paddingTop: 8 }}>
        <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#eff4ff', border: '2px solid #bfdbfe', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
          <CreditCard size={32} color={BRAND.blue} />
        </div>
        <h1 style={{ color: BRAND.text, fontSize: 22, fontWeight: 800, margin: 0 }}>Enrolamiento biométrico</h1>
        <p style={{ color: BRAND.textMuted, fontSize: 14, marginTop: 8, lineHeight: 1.6 }}>Necesitamos verificar tu identidad. El proceso toma aproximadamente 3 minutos.</p>
      </div>
      <Card>
        <p style={{ color: BRAND.textMuted, fontSize: 13, fontWeight: 600, marginBottom: 10, margin: '0 0 10px' }}>Necesitarás:</p>
        {['Tu INE / Pasaporte vigente', 'Cámara frontal y trasera disponibles', 'Buena iluminación', 'Conexión a internet estable'].map((item) => (
          <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{ width: 20, height: 20, borderRadius: '50%', background: BRAND.greenLight, border: `1px solid ${BRAND.greenBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Check size={11} color={BRAND.green} strokeWidth={3} />
            </div>
            <p style={{ color: BRAND.text, fontSize: 13, margin: 0 }}>{item}</p>
          </div>
        ))}
      </Card>
      <Card style={{ background: '#eff4ff', border: '1.5px solid #bfdbfe' }}>
        <p style={{ color: '#1e40af', fontSize: 12, lineHeight: 1.6, margin: 0 }}>Tus datos biométricos serán cifrados y almacenados de forma segura. Solo se usarán para verificar tu identidad.</p>
      </Card>
      <PrimaryBtn onClick={onStart}>Comenzar <ChevronRight size={18} /></PrimaryBtn>
    </div>
  );
}

// ─── Screen 2: ID Type Selection ─────────────────────────────────────────────

function Screen2({ onSelect, onBack }: { onSelect: (tipo: IdType) => void; onBack: () => void }) {
  const options: { tipo: IdType; label: string; desc: string; disabled?: boolean }[] = [
    { tipo: 'INE', label: 'INE / IFE', desc: 'Credencial para votar vigente' },
    { tipo: 'Pasaporte', label: 'Pasaporte', desc: 'Pasaporte mexicano vigente' },
    { tipo: 'FM3', label: 'FM3 / Residencia', desc: 'Documento migratorio vigente', disabled: true },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 style={{ color: BRAND.text, fontSize: 20, fontWeight: 700, margin: 0 }}>Tipo de identificación</h2>
        <p style={{ color: BRAND.textMuted, fontSize: 13, marginTop: 4 }}>Selecciona el documento que usarás para verificar tu identidad</p>
      </div>
      {options.map((opt) => (
        <button
          key={opt.tipo}
          onClick={() => !opt.disabled && onSelect(opt.tipo)}
          disabled={opt.disabled}
          style={{ background: opt.disabled ? '#f3f4f6' : BRAND.card, border: `1.5px solid ${opt.disabled ? '#e5e7eb' : BRAND.cardBorder}`, borderRadius: 14, padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: opt.disabled ? 'not-allowed' : 'pointer', textAlign: 'left', width: '100%', opacity: opt.disabled ? 0.5 : 1 }}
        >
          <div>
            <p style={{ color: opt.disabled ? BRAND.textLight : BRAND.text, fontWeight: 700, fontSize: 15, margin: 0 }}>{opt.label}</p>
            <p style={{ color: BRAND.textMuted, fontSize: 13, marginTop: 2, margin: '2px 0 0' }}>{opt.disabled ? 'No disponible por el momento' : opt.desc}</p>
          </div>
          <ChevronRight size={18} color={opt.disabled ? BRAND.textLight : BRAND.textLight} />
        </button>
      ))}
      {/* Regresar button */}
      <SecondaryBtn onClick={onBack}>
        <ChevronLeft size={16} /> Regresar
      </SecondaryBtn>
    </div>
  );
}

// ─── Screen 5: OCR + CURP Validation ─────────────────────────────────────────

function Screen5({ anverso, reverso, token, onConfirm, onBack }: { anverso: string | null; reverso: string | null; token: string; onConfirm: (ocrData: OcrResult, nombre: string, apellidoPaterno: string, apellidoMaterno: string, curp: string, fechaNacimiento: string, sexo: string) => void; onBack: () => void }) {
  const [loading, setLoading] = useState(true);
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [curpLoading, setCurpLoading] = useState(false);
  const [curpData, setCurpData] = useState<{ nombre: string; apellidoPaterno: string; apellidoMaterno: string; fechaNacimiento: string; sexo: string } | null>(null);
  const [curpError, setCurpError] = useState<string | null>(null);
  const calledRef = useRef(false);

  useEffect(() => {
    if (calledRef.current) return;
    calledRef.current = true;

    const runOcr = async () => {
      if (!anverso) { setOcrError('No se encontró la imagen del anverso.'); setLoading(false); return; }
      try {
        const res = await fetch('/api/nubarium/ocr-id', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: anverso, idReverso: reverso || undefined, enrollmentToken: token }),
        });
        let data = await res.json();
        if (!res.ok || data.error) { setOcrError(data.error || 'Error al leer la identificación.'); setLoading(false); return; }
        const result: OcrResult = {
          nombres: data.nombres || '',
          primerApellido: data.primerApellido || '',
          segundoApellido: data.segundoApellido || '',
          curp: data.curp || '',
          vigencia: data.vigencia || '',
          vigente: data.vigente ?? null,
          vigenciaYear: data.vigenciaYear ?? null,
          tipo: data.tipo || '',
        };
        setOcrResult(result);
        setLoading(false);
        if (result.curp) {
          setCurpLoading(true);
          try {
            const curpRes = await fetch('/api/nubarium/validar-curp', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ curp: result.curp, enrollmentToken: token }),
            });
            const curpJson = await curpRes.json();
            if (curpRes.ok && !curpJson.error && curpJson.nombre) {
              setCurpData({
                nombre: curpJson.nombre || result.nombres,
                apellidoPaterno: curpJson.apellidoPaterno || result.primerApellido,
                apellidoMaterno: curpJson.apellidoMaterno || result.segundoApellido,
                fechaNacimiento: curpJson.fechaNacimiento || '',
                sexo: curpJson.sexo === 'HOMBRE' ? 'M' : curpJson.sexo === 'MUJER' ? 'F' : curpJson.sexo || '',
              });
            } else {
              setCurpError(curpJson.error || 'No se pudo validar la CURP con RENAPO.');
            }
          } catch {
            setCurpError('Error de conexión al validar CURP.');
          } finally {
            setCurpLoading(false);
          }
        }
      } catch {
        setOcrError('Error de conexión al leer la identificación.');
        setLoading(false);
      }
    };

    runOcr();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canContinue = !loading && !curpLoading && ocrResult !== null && ocrResult.vigente !== false && !ocrError;

  const handleConfirm = () => {
    if (!ocrResult) return;
    const nombre = curpData?.nombre || ocrResult.nombres;
    const apellidoPaterno = curpData?.apellidoPaterno || ocrResult.primerApellido;
    const apellidoMaterno = curpData?.apellidoMaterno || ocrResult.segundoApellido;
    const curp = ocrResult.curp;
    const fechaNacimiento = curpData?.fechaNacimiento || '';
    const sexo = curpData?.sexo || '';
    onConfirm(ocrResult, nombre, apellidoPaterno, apellidoMaterno, curp, fechaNacimiento, sexo);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 style={{ color: BRAND.text, fontSize: 20, fontWeight: 700, margin: 0 }}>Validación de identificación</h2>
        <p style={{ color: BRAND.textMuted, fontSize: 13, marginTop: 4 }}>Extrayendo y verificando datos de tu ID</p>
      </div>

      {(loading || curpLoading) && (
        <Card style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '20px 16px' }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', border: `3px solid ${BRAND.cardBorder}`, borderTop: `3px solid ${BRAND.blue}`, animation: 'spin 0.8s linear infinite' }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <p style={{ color: BRAND.textMuted, fontSize: 13, margin: 0 }}>Leyendo identificación</p>
          <div style={{ width: '100%', background: '#e5e7eb', borderRadius: 99, height: 6 }}>
            <div style={{ background: BRAND.blue, height: 6, borderRadius: 99, width: '70%', animation: 'pulse 1.5s ease-in-out infinite' }} />
            <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }`}</style>
          </div>
        </Card>
      )}

      {!loading && ocrError && (
        <div style={{ background: BRAND.redLight, border: `1.5px solid ${BRAND.redBorder}`, borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <AlertCircle size={18} color={BRAND.red} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <p style={{ color: '#991b1b', fontWeight: 700, fontSize: 13, margin: 0 }}>Error al leer la identificación</p>
            <p style={{ color: '#b91c1c', fontSize: 12, marginTop: 4, lineHeight: 1.4 }}>{ocrError}</p>
          </div>
        </div>
      )}

      {!loading && ocrResult && (
        <>
          {ocrResult.vigente === false && (
            <div style={{ background: BRAND.amberLight, border: `1.5px solid ${BRAND.amberBorder}`, borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <AlertCircle size={18} color={BRAND.amber} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <p style={{ color: '#92400e', fontWeight: 700, fontSize: 13, margin: 0 }}>Credencial vencida</p>
                <p style={{ color: '#b45309', fontSize: 12, marginTop: 4, lineHeight: 1.4 }}>Tu credencial venció en {ocrResult.vigencia}. Por favor usa una identificación vigente.</p>
              </div>
            </div>
          )}
          {ocrResult.vigente === true && (
            <div style={{ background: BRAND.greenLight, border: `1.5px solid ${BRAND.greenBorder}`, borderRadius: 14, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <CheckCircle2 size={16} color={BRAND.green} />
              <p style={{ color: '#166534', fontSize: 13, fontWeight: 600, margin: 0 }}>Credencial vigente hasta {ocrResult.vigencia}</p>
            </div>
          )}

          {!curpLoading && curpData && (
            <Card style={{ background: '#eff4ff', border: '1.5px solid #bfdbfe' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <CheckCircle2 size={16} color={BRAND.blue} />
                <p style={{ color: '#1e40af', fontSize: 12, fontWeight: 700, margin: 0 }}>Datos confirmados por RENAPO</p>
              </div>
              {[
                { label: 'Nombre', value: curpData.nombre },
                { label: 'Apellido Paterno', value: curpData.apellidoPaterno },
                { label: 'Apellido Materno', value: curpData.apellidoMaterno },
                { label: 'Fecha de Nacimiento', value: curpData.fechaNacimiento },
                { label: 'CURP', value: ocrResult?.curp },
              ].map((f, i, arr) => (
                <div key={f.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: i < arr.length - 1 ? `1px solid #bfdbfe` : 'none' }}>
                  <p style={{ color: '#3b82f6', fontSize: 12, margin: 0 }}>{f.label}</p>
                  <p style={{ color: '#1e40af', fontSize: 13, fontWeight: 600, textAlign: 'right', margin: 0 }}>{f.value || '—'}</p>
                </div>
              ))}
            </Card>
          )}

          {!curpLoading && curpError && (
            <div style={{ background: BRAND.amberLight, border: `1.5px solid ${BRAND.amberBorder}`, borderRadius: 12, padding: '10px 14px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <AlertCircle size={15} color={BRAND.amber} style={{ flexShrink: 0, marginTop: 1 }} />
              <p style={{ color: '#92400e', fontSize: 12, margin: 0 }}>{curpError} Se usarán los datos del OCR.</p>
            </div>
          )}
        </>
      )}

      {!loading && ocrError && (
        <button onClick={onBack} style={{ width: '100%', padding: '15px 0', borderRadius: 16, background: BRAND.blueGradient, color: '#fff', fontWeight: 700, fontSize: 15, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <RefreshCw size={16} /> Volver a capturar
        </button>
      )}

      {!ocrError && (
        <PrimaryBtn onClick={handleConfirm} disabled={!canContinue}>
          Continuar <ChevronRight size={18} />
        </PrimaryBtn>
      )}

      {/* Atrás button below Continuar — goes back to ID type selection (screen 2) */}
      <SecondaryBtn onClick={onBack}>
        <ChevronLeft size={16} /> Regresar
      </SecondaryBtn>
    </div>
  );
}

// ─── Screen 6: Instructions before selfie ────────────────────────────────────

function Screen6({ onContinue, onBack }: { onContinue: () => void; onBack: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 style={{ color: BRAND.text, fontSize: 20, fontWeight: 700, margin: 0 }}>Captura de video facial</h2>
        <p style={{ color: BRAND.textMuted, fontSize: 13, marginTop: 4 }}>Ahora necesitamos grabar un video corto de tu rostro</p>
      </div>
      <Card>
        <p style={{ color: BRAND.textMuted, fontSize: 13, fontWeight: 600, marginBottom: 10, margin: '0 0 10px' }}>Para una buena captura:</p>
        {[
          'Asegúrate de tener buena iluminación',
          'Mira directamente a la cámara al inicio',
          'Sigue las instrucciones en pantalla (girar cabeza, acercarte/alejarte)',
          'El video dura máximo 5 segundos',
          'Retira lentes o accesorios si es posible',
        ].map((item) => (
          <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{ width: 20, height: 20, borderRadius: '50%', background: BRAND.greenLight, border: `1px solid ${BRAND.greenBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Check size={11} color={BRAND.green} strokeWidth={3} />
            </div>
            <p style={{ color: BRAND.text, fontSize: 13, margin: 0 }}>{item}</p>
          </div>
        ))}
      </Card>
      <PrimaryBtn onClick={onContinue}>Continuar <ChevronRight size={18} /></PrimaryBtn>
      <SecondaryBtn onClick={onBack}>
        <ChevronLeft size={16} /> Regresar
      </SecondaryBtn>
    </div>
  );
}

// ─── Main Page Component ──────────────────────────────────────────────────────

export default function EnrollamientoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = React.use(params);

  // Screen index: 1=Welcome, 2=ID type, 3=Anverso, 4=Reverso(INE only), 5=OCR/CURP, 6=Selfie instructions, 7=Video capture, 8=Face validation, 9=Confirm
  const [screen, setScreen] = useState(1);
  const [tokenValid, setTokenValid] = useState<boolean | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [sessionSecondsLeft, setSessionSecondsLeft] = useState(SESSION_TIMEOUT_MS / 1000);
  const sessionTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionStartRef = useRef<number>(Date.now());

  // User identity verification (when started from dashboard)
  const [userMismatchError, setUserMismatchError] = useState<string | null>(null);
  const [tokenUserData, setTokenUserData] = useState<{ curp?: string; nombre?: string; userId?: string } | null>(null);

  const [enrollmentData, setEnrollmentData] = useState<EnrollmentData>({
    tipoId: null,
    anversoCapture: null,
    reversoCapture: null,
    selfieCapture: null,
    selfieVideo: null,
    nombre: '',
    apellidoPaterno: '',
    apellidoMaterno: '',
    curp: '',
    rfc: '',
    fechaNacimiento: '',
    sexo: '',
  });

  const [processingCaptures, setProcessingCaptures] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [enrollmentComplete, setEnrollmentComplete] = useState(false);
  const [enrollmentCancelled, setEnrollmentCancelled] = useState(false);

  // ── Attempt tracking (max 2 each) ─────────────────────────────────────────
  const MAX_ID_ATTEMPTS = 2;
  const MAX_SELFIE_ATTEMPTS = 2;
  const [idAttempts, setIdAttempts] = useState(0);
  const [selfieAttempts, setSelfieAttempts] = useState(0);

  // ── Cancel token (too many failed attempts) ───────────────────────────────
  const handleCancelEnrollment = useCallback(async () => {
    try {
      await fetch('/api/enrollment/cancel-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
    } catch {
      // non-blocking
    }
    setEnrollmentCancelled(true);
  }, [token]);

  // ── Handle OCR validation failure (ID attempt tracking) ───────────────────
  const handleOcrBack = useCallback(() => {
    const newCount = idAttempts + 1;
    setIdAttempts(newCount);
    if (newCount >= MAX_ID_ATTEMPTS) {
      handleCancelEnrollment();
      return;
    }
    setScreen(2);
  }, [idAttempts, handleCancelEnrollment]);

  // ── Handle selfie/face validation failure (selfie attempt tracking) ────────
  const handleSelfieBack = useCallback(() => {
    const newCount = selfieAttempts + 1;
    setSelfieAttempts(newCount);
    if (newCount >= MAX_SELFIE_ATTEMPTS) {
      handleCancelEnrollment();
      return;
    }
    setScreen(6);
  }, [selfieAttempts, handleCancelEnrollment]);

  // ── Token validation ──────────────────────────────────────────────────────
  useEffect(() => {
    const validate = async () => {
      try {
        const res = await fetch(`/api/enrollment/validate-token?token=${encodeURIComponent(token)}`);
        let data = await res.json();
        if (data.valid) {
          setTokenValid(true);
          // Store token user data for identity verification
          if (data.userData) {
            setTokenUserData(data.userData);
          }
        } else if (data.expired) {
          setTokenError('Este enlace de enrolamiento ha expirado. Solicita uno nuevo.');
          setTokenValid(false);
        } else if (data.used) {
          setTokenError('Este enlace ya fue utilizado. El enrolamiento ya fue completado.');
          setTokenValid(false);
        } else if (data.cancelled) {
          setEnrollmentCancelled(true);
          setTokenValid(true); // allow rendering the cancelled screen
        } else {
          setTokenError('Enlace de enrolamiento inválido o no encontrado.');
          setTokenValid(false);
        }
      } catch {
        setTokenError('Error al verificar el enlace. Verifica tu conexión.');
        setTokenValid(false);
      }
    };
    validate();
  }, [token]);

  // ── Session timer ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (tokenValid !== true) return;
    sessionStartRef.current = Date.now();
    sessionTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - sessionStartRef.current;
      const remaining = Math.max(0, Math.round((SESSION_TIMEOUT_MS - elapsed) / 1000));
      setSessionSecondsLeft(remaining);
      if (remaining <= 0) {
        setSessionExpired(true);
        if (sessionTimerRef.current) clearInterval(sessionTimerRef.current);
      }
    }, 1000);
    return () => { if (sessionTimerRef.current) clearInterval(sessionTimerRef.current); };
  }, [tokenValid]);

  const handleSessionExpired = () => setSessionExpired(true);
  const handleRestart = () => { setSessionExpired(false); sessionStartRef.current = Date.now(); setScreen(1); };

  // ── Reiniciar enrollment (reset all data) ─────────────────────────────────
  const handleReiniciar = () => {
    setEnrollmentData({
      tipoId: null,
      anversoCapture: null,
      reversoCapture: null,
      selfieCapture: null,
      selfieVideo: null,
      nombre: '',
      apellidoPaterno: '',
      apellidoMaterno: '',
      curp: '',
      rfc: '',
      fechaNacimiento: '',
      sexo: '',
    });
    setSubmitError(null);
    setUserMismatchError(null);
    setScreen(1);
  };

  // ── Record enrollment start (when user clicks "Comenzar") ─────────────────
  const handleEnrollmentStart = async () => {
    try {
      await fetch('/api/enrollment/record-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
    } catch {
      // non-blocking — don't prevent flow
    }
    // Log device/IP/browser for enrollment
    try {
      await fetch('/api/enrollment/log-enrollment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enrollmentToken: token,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        }),
      });
    } catch {
      // non-blocking
    }
    setScreen(2);
  };

  // ── Verify enrollment data matches registered user ────────────────────────
  const verifyUserMatch = (curpFromOcr: string, nombreFromOcr: string): boolean => {
    if (!tokenUserData) return true; // No user data to compare against, allow
    const { curp: tokenCurp } = tokenUserData;
    if (tokenCurp && curpFromOcr) {
      const match = tokenCurp.trim().toUpperCase() === curpFromOcr.trim().toUpperCase();
      if (!match) return false;
    }
    return true;
  };

  // ── Submit enrollment ─────────────────────────────────────────────────────
  const handleSubmitEnrollment = async () => {
    setSubmitting(true);
    setSubmitError(null);

    // Verify user identity match before submitting
    if (tokenUserData && enrollmentData.curp) {
      const matches = verifyUserMatch(enrollmentData.curp, enrollmentData.nombre);
      if (!matches) {
        setSubmitError('Los datos del enrolamiento no coinciden con el usuario registrado. Por favor intente nuevamente con la identificación correcta.');
        setSubmitting(false);
        return;
      }
    }

    try {
      // Process captures first
      if (enrollmentData.anversoCapture && enrollmentData.selfieCapture) {
        setProcessingCaptures(true);
        await fetch('/api/enrollment/process-captures', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            tipoId: enrollmentData.tipoId,
            anversoCapture: enrollmentData.anversoCapture,
            reversoCapture: enrollmentData.reversoCapture || enrollmentData.anversoCapture,
            selfieCapture: enrollmentData.selfieCapture,
            selfieVideo: enrollmentData.selfieVideo,
          }),
        });
        setProcessingCaptures(false);
      }

      const res = await fetch('/api/enrollment/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          nombre: enrollmentData.nombre,
          apellidoPaterno: enrollmentData.apellidoPaterno,
          apellidoMaterno: enrollmentData.apellidoMaterno,
          curp: enrollmentData.curp,
          rfc: enrollmentData.rfc,
          fechaNacimiento: enrollmentData.fechaNacimiento,
          sexo: enrollmentData.sexo,
          tipoIdentificacion: enrollmentData.tipoId,
          selfieVideo: enrollmentData.selfieVideo || null,
          anversoCapture: enrollmentData.anversoCapture || null,
        }),
      });
      let data = await res.json();
      if (!res.ok || data.error) {
        setSubmitError(data.error || 'Error al completar el enrolamiento.');
        setSubmitting(false);
        return;
      }
      setEnrollmentComplete(true);
    } catch {
      setSubmitError('Error de conexión. Intenta nuevamente.');
    } finally {
      setSubmitting(false);
      setProcessingCaptures(false);
    }
  };

  // ── Loading state ─────────────────────────────────────────────────────────
  if (tokenValid === null) {
    return (
      <div style={{ minHeight: '100dvh', background: BRAND.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', border: `3px solid ${BRAND.cardBorder}`, borderTop: `3px solid ${BRAND.blue}`, animation: 'spin 0.8s linear infinite' }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <p style={{ color: BRAND.textMuted, fontSize: 14 }}>Verificando enlace...</p>
        </div>
      </div>
    );
  }

  // ── Invalid token ─────────────────────────────────────────────────────────
  if (tokenValid === false) {
    return (
      <div style={{ minHeight: '100dvh', background: BRAND.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 20px' }}>
        <div style={{ maxWidth: 400, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: BRAND.redLight, border: `2px solid ${BRAND.redBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <AlertCircle size={28} color={BRAND.red} />
          </div>
          <h2 style={{ color: BRAND.text, fontSize: 20, fontWeight: 700, margin: 0 }}>Enlace no válido</h2>
          <p style={{ color: BRAND.textMuted, fontSize: 14, lineHeight: 1.6, margin: 0 }}>{tokenError}</p>
        </div>
      </div>
    );
  }

  // ── Enrollment cancelled (too many failed attempts) ───────────────────────
  if (enrollmentCancelled) {
    return (
      <div style={{ minHeight: '100dvh', background: BRAND.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 20px' }}>
        <div style={{ maxWidth: 400, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center' }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: BRAND.redLight, border: `2px solid ${BRAND.redBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <AlertCircle size={32} color={BRAND.red} />
          </div>
          <h2 style={{ color: '#991b1b', fontSize: 20, fontWeight: 800, margin: 0 }}>Enrolamiento cancelado</h2>
          <p style={{ color: '#b91c1c', fontSize: 14, lineHeight: 1.6, margin: 0 }}>
            Se ha superado el número máximo de intentos permitidos. El proceso de enrolamiento ha sido cancelado por seguridad.
          </p>
          <div style={{ background: BRAND.redLight, border: `1.5px solid ${BRAND.redBorder}`, borderRadius: 14, padding: '14px 16px', width: '100%', textAlign: 'left' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <AlertCircle size={16} color={BRAND.red} style={{ flexShrink: 0, marginTop: 1 }} />
              <p style={{ color: '#991b1b', fontSize: 13, lineHeight: 1.5, margin: 0 }}>
                Este enlace de enrolamiento ha sido invalidado y ya no podrá ser utilizado. Para continuar, deberás solicitar un nuevo enlace al administrador.
              </p>
            </div>
          </div>
          <button
            onClick={() => { try { window.close(); } catch { /* ignore */ } }}
            style={{ width: '100%', padding: '14px 0', borderRadius: 14, background: BRAND.blueGradient, color: '#fff', border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            Cerrar ventana
          </button>
        </div>
      </div>
    );
  }

  // ── Enrollment complete ───────────────────────────────────────────────────
  if (enrollmentComplete) {
    return <EnrollmentCompleteScreen />;
  }

  // ── Fullscreen screens (3, 4, 7) ─────────────────────────────────────────
  if (screen === 3) {
    // Passport uses its own dedicated scanner screen (no reverso)
    if (enrollmentData.tipoId === 'Pasaporte') {
      return (
        <PassportScannerScreen
          onCapture={(img) => {
            // For passport: skip reverso, go directly to screen 5
            setEnrollmentData((d) => ({ ...d, anversoCapture: img, reversoCapture: img }));
            setScreen(5);
          }}
          onBack={() => setScreen(2)}
          onSessionExpired={handleSessionExpired}
        />
      );
    }
    return (
      <IdScannerScreen
        side="anverso"
        tipoId={enrollmentData.tipoId || 'INE'}
        onCapture={(img) => { setEnrollmentData((d) => ({ ...d, anversoCapture: img })); setScreen(4); }}
        onBack={() => setScreen(2)}
        onSessionExpired={handleSessionExpired}
      />
    );
  }

  if (screen === 4) {
    // Screen 4 is only for INE reverso — passport skips this
    return (
      <IdScannerScreen
        key="reverso"
        side="reverso"
        tipoId={enrollmentData.tipoId || 'INE'}
        onCapture={(img) => { setEnrollmentData((d) => ({ ...d, reversoCapture: img })); setScreen(5); }}
        onBack={() => setScreen(2)}
        onSessionExpired={handleSessionExpired}
      />
    );
  }

  if (screen === 7) {
    return (
      <SelfieCaptureScreen
        onCapture={(img, videoBase64) => {
          setEnrollmentData((d) => ({ ...d, selfieCapture: img, selfieVideo: videoBase64 }));
          setScreen(8);
        }}
        onBack={() => setScreen(6)}
        onSessionExpired={handleSessionExpired}
      />
    );
  }

  // ─── Wrapped screens ───────────────────────────────────────────────────────
  return (
    <PublicTokenLayout token={token} luciaScope="mobile_enrollment">
    <div style={{ minHeight: '100dvh', background: BRAND.bg, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {/* Header with real logo */}
      <div style={{ width: '100%', maxWidth: 480, padding: '16px 20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <AppImage
            src="/assets/images/Docubox-tipo1-1774245058336.png"
            alt="Docubox logo"
            width={110}
            height={30}
            className="object-contain"
            priority={true}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {[1, 2, 5, 6, 8, 9].map((s) => (
            <div key={s} style={{ width: s === screen ? 18 : 6, height: 6, borderRadius: 99, background: s === screen ? BRAND.blue : s < screen ? BRAND.green : BRAND.cardBorder, transition: 'all 0.3s ease' }} />
          ))}
        </div>
      </div>

      {/* Attempt counters warning */}
      {(idAttempts > 0 || selfieAttempts > 0) && (
        <div style={{ width: '100%', maxWidth: 480, padding: '8px 20px 0' }}>
          <div style={{ background: BRAND.amberLight, border: `1.5px solid ${BRAND.amberBorder}`, borderRadius: 10, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={14} color={BRAND.amber} style={{ flexShrink: 0 }} />
            <p style={{ color: '#92400e', fontSize: 12, fontWeight: 600, margin: 0 }}>
              {idAttempts > 0 && `Intentos de ID: ${idAttempts}/${MAX_ID_ATTEMPTS}`}
              {idAttempts > 0 && selfieAttempts > 0 && ' · '}
              {selfieAttempts > 0 && `Intentos de selfie: ${selfieAttempts}/${MAX_SELFIE_ATTEMPTS}`}
            </p>
          </div>
        </div>
      )}

      {/* Session warning */}
      <div style={{ width: '100%', maxWidth: 480, padding: '8px 20px 0' }}>
        <TimeoutWarningBanner secondsLeft={sessionSecondsLeft} />
      </div>

      {/* Session expired overlay */}
      {sessionExpired && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ background: BRAND.card, borderRadius: 20, padding: 24, maxWidth: 380, width: '100%' }}>
            <SessionExpiredBanner onRestart={handleRestart} />
          </div>
        </div>
      )}

      {/* Screen content */}
      <div style={{ width: '100%', maxWidth: 480, padding: '20px 20px 32px' }}>
        <ScreenTransition screenKey={screen}>
          {screen === 1 && <Screen1 onStart={handleEnrollmentStart} />}
          {screen === 2 && (
            <>
              {idAttempts > 0 && (
                <div style={{ background: BRAND.amberLight, border: `1.5px solid ${BRAND.amberBorder}`, borderRadius: 12, padding: '10px 14px', marginBottom: 16, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <AlertCircle size={15} color={BRAND.amber} style={{ flexShrink: 0, marginTop: 1 }} />
                  <p style={{ color: '#92400e', fontSize: 13, margin: 0, lineHeight: 1.5 }}>
                    Intento {idAttempts + 1} de {MAX_ID_ATTEMPTS}. Si falla este intento, el enrolamiento será cancelado.
                  </p>
                </div>
              )}
              <Screen2 onSelect={(tipo) => { setEnrollmentData((d) => ({ ...d, tipoId: tipo })); setScreen(3); }} onBack={() => setScreen(1)} />
            </>
          )}
          {screen === 5 && (
            <Screen5
              anverso={enrollmentData.anversoCapture}
              reverso={enrollmentData.reversoCapture}
              token={token}
              onConfirm={(_ocrResult, nombre, apellidoPaterno, apellidoMaterno, curp, fechaNacimiento, sexo) => {
                setEnrollmentData((d) => ({ ...d, nombre, apellidoPaterno, apellidoMaterno, curp, fechaNacimiento, sexo }));
                setScreen(6);
              }}
              onBack={handleOcrBack}
            />
          )}
          {screen === 6 && (
            <>
              {selfieAttempts > 0 && (
                <div style={{ background: BRAND.amberLight, border: `1.5px solid ${BRAND.amberBorder}`, borderRadius: 12, padding: '10px 14px', marginBottom: 16, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <AlertCircle size={15} color={BRAND.amber} style={{ flexShrink: 0, marginTop: 1 }} />
                  <p style={{ color: '#92400e', fontSize: 13, margin: 0, lineHeight: 1.5 }}>
                    Intento {selfieAttempts + 1} de {MAX_SELFIE_ATTEMPTS}. Si falla este intento, el enrolamiento será cancelado.
                  </p>
                </div>
              )}
              <Screen6 onContinue={() => setScreen(7)} onBack={() => setScreen(5)} />
            </>
          )}
          {screen === 7 && (
            <SelfieCaptureScreen
              onCapture={(img, videoBase64) => {
                setEnrollmentData((d) => ({ ...d, selfieCapture: img, selfieVideo: videoBase64 }));
                setScreen(8);
              }}
              onBack={() => setScreen(6)}
              onSessionExpired={handleSessionExpired}
            />
          )}
          {screen === 8 && (
            <Screen8
              selfie={enrollmentData.selfieCapture}
              selfieVideo={enrollmentData.selfieVideo}
              idAnverso={enrollmentData.anversoCapture}
              token={token}
              onConfirm={() => setScreen(9)}
              onBack={handleSelfieBack}
              processingCaptures={processingCaptures}
            />
          )}
          {screen === 9 && (
            <Screen9
              data={enrollmentData}
              onConfirm={handleSubmitEnrollment}
              onBack={() => setScreen(8)}
              submitting={submitting}
              submitError={submitError}
              onReiniciar={handleReiniciar}
            />
          )}
        </ScreenTransition>
      </div>
    </div>
    </PublicTokenLayout>
  );
}