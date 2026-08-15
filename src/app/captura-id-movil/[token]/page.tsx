'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { ChevronRight, ChevronLeft, Camera, CheckCircle2, AlertCircle, Loader2, Check, RefreshCw, Video, UserX, ShieldCheck, ShieldAlert, AlertTriangle, X } from 'lucide-react';
import AppImage from '@/components/ui/AppImage';
import PublicTokenLayout from '@/components/PublicTokenLayout';

// ─── Types ────────────────────────────────────────────────────────────────────

type IdType = 'INE' | 'Pasaporte' | 'FM3';

interface CaptureData {
  tipoId: IdType | null;
  anverso: string | null;
  reverso: string | null;
  selfiePhoto: string | null;
  selfieVideo: string | null;
  nombre: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  curp: string;
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

// ─── Design tokens ────────────────────────────────────────────────────────────

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

const MAX_RETRY_ATTEMPTS = 3;
const MAX_VIDEO_DURATION_MS = 3000;

// ─── Screen types ─────────────────────────────────────────────────────────────

type Screen =
  | 'loading' | 'expired' | 'cancelled' | 'error' | 'intro' | 'id_type' |'anverso'| 'reverso' |'ocr_validation' |'selfie_instructions'| 'selfie_capture' |'face_validation' |'identity_mismatch' |'success';

// ─── Transition wrapper ───────────────────────────────────────────────────────

function ScreenTransition({ children, screenKey }: { children: React.ReactNode; screenKey: string }) {
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

// ─── Success Checkmark ────────────────────────────────────────────────────────

function SuccessCheckmark({ size = 48 }: { size?: number }) {
  const [animate, setAnimate] = useState(false);
  useEffect(() => { const t = setTimeout(() => setAnimate(true), 80); return () => clearTimeout(t); }, []);
  return (
    <div style={{ width: size + 24, height: size + 24, borderRadius: '50%', background: BRAND.greenLight, border: `2px solid ${BRAND.greenBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: animate ? 'scale(1)' : 'scale(0.4)', opacity: animate ? 1 : 0, transition: 'transform 0.45s cubic-bezier(0.34,1.56,0.64,1), opacity 0.3s ease' }}>
      <Check size={size} strokeWidth={2.5} style={{ color: BRAND.green }} />
    </div>
  );
}

// ─── Shared Buttons ───────────────────────────────────────────────────────────

function PrimaryBtn({ onClick, disabled, children }: { onClick?: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ width: '100%', padding: '15px 0', borderRadius: 16, background: disabled ? '#d1d5db' : BRAND.blueGradient, color: '#fff', fontWeight: 700, fontSize: 15, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: disabled ? 0.6 : 1 }}>
      {children}
    </button>
  );
}

function SecondaryBtn({ onClick, children }: { onClick?: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{ width: '100%', padding: '13px 0', borderRadius: 16, background: '#fff', color: BRAND.textMuted, fontWeight: 600, fontSize: 14, border: `1.5px solid ${BRAND.cardBorder}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      {children}
    </button>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: BRAND.card, border: `1.5px solid ${BRAND.cardBorder}`, borderRadius: 16, padding: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', ...style }}>
      {children}
    </div>
  );
}

// ─── Camera Hook ──────────────────────────────────────────────────────────────

function useCamera(facingMode: 'environment' | 'user' = 'environment') {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startCamera = useCallback(async () => {
    setError(null);
    setIsReady(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => setIsReady(true);
      }
    } catch (err: any) {
      if (err.name === 'NotAllowedError') setError('Permiso denegado. Activa la cámara en la configuración de tu navegador.');
      else if (err.name === 'NotFoundError') setError('No se detectó cámara en este dispositivo.');
      else setError('No se pudo acceder a la cámara.');
    }
  }, [facingMode]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setIsReady(false);
  }, []);

  const captureWithCrop = useCallback((guideEl?: HTMLElement | null): string | null => {
    const video = videoRef.current;
    if (!video || !isReady) return null;
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

  useEffect(() => {
    return () => { streamRef.current?.getTracks().forEach(t => t.stop()); };
  }, []);

  return { videoRef, stream: streamRef, isReady, error, startCamera, stopCamera, captureWithCrop };
}

// ─── Camera Timeout Hook ──────────────────────────────────────────────────────

function useCameraTimeout(isReady: boolean, cameraStarted: boolean, captured: boolean | null, timeoutMs = 30000) {
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

// ─── ID Scanner Screen ────────────────────────────────────────────────────────

function IdScannerScreen({
  side, tipoId, onCapture, onBack,
}: {
  side: 'anverso' | 'reverso';
  tipoId: IdType;
  onCapture: (img: string) => void;
  onBack: () => void;
}) {
  const { videoRef, stream, error: camError, isReady, startCamera, stopCamera, captureWithCrop } = useCamera('environment');
  const guideRef = useRef<HTMLDivElement>(null);
  const [captured, setCaptured] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [cameraStarted, setCameraStarted] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);

  const showTimeoutMsg = useCameraTimeout(isReady, cameraStarted, !!captured);

  useEffect(() => {
    if (typeof navigator !== 'undefined') setIsAndroid(/android/i.test(navigator.userAgent));
  }, []);

  useEffect(() => {
    setCameraStarted(true);
    startCamera();
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleTorch = async () => {
    const s = stream.current;
    if (!s) return;
    const track = s.getVideoTracks()[0];
    if (!track) return;
    try {
      const newState = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: newState } as MediaTrackConstraintSet] });
      setTorchOn(newState);
    } catch { /* not supported */ }
  };

  const titleLabel = side === 'anverso'
    ? tipoId === 'INE' ? 'Ajusta el frente de tu INE' : `Ajusta el frente de tu ${tipoId}`
    : tipoId === 'INE' ? 'Ajusta el reverso de tu INE' : `Ajusta el reverso de tu ${tipoId}`;

  const handleCapture = () => {
    const img = captureWithCrop(guideRef.current);
    if (img) { setCaptured(img); stopCamera(); }
  };

  const handleRetry = () => { setCaptured(null); setRetryCount(c => c + 1); startCamera(); };
  const handleUsePhoto = () => { if (captured) onCapture(captured); };
  const handleBack = () => { stopCamera(); onBack(); };

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
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
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
        <div style={{ position: 'absolute', top: 'max(16px, env(safe-area-inset-top, 16px))', right: 16, background: 'rgba(245,158,11,0.9)', borderRadius: 20, padding: '4px 10px', zIndex: 30 }}>
          <p style={{ color: '#fff', fontSize: 11, fontWeight: 700, margin: 0 }}>Intento {retryCount}/{MAX_RETRY_ATTEMPTS}</p>
        </div>
      )}
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
              </div>
            )}
          </div>
        ) : (
          <div style={{ width: '100%', maxWidth: 360, aspectRatio: '1.586', background: '#111827', borderRadius: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, border: '1px solid #1f2937' }}>
            <Camera size={44} color="#4b5563" strokeWidth={1.5} />
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
            <button onClick={handleUsePhoto} style={{ flex: 2, padding: '14px 0', borderRadius: 14, background: 'linear-gradient(90deg, #1E6BFF 0%, #3b82f6 100%)', color: '#fff', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer', boxShadow: '0 4px 20px rgba(30, 107, 255,0.45)' }}>
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

// ─── Passport Scanner Screen ──────────────────────────────────────────────────

function PassportScannerScreen({ onCapture, onBack }: { onCapture: (img: string) => void; onBack: () => void }) {
  const { videoRef, isReady, error: camError, startCamera, stopCamera, captureWithCrop } = useCamera('environment');
  const guideRef = useRef<HTMLDivElement>(null);
  const [captured, setCaptured] = useState<string | null>(null);
  const [cameraStarted, setCameraStarted] = useState(false);

  const showTimeoutMsg = useCameraTimeout(isReady, cameraStarted, !!captured);

  useEffect(() => {
    setCameraStarted(true);
    startCamera();
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCapture = () => {
    const img = captureWithCrop(guideRef.current);
    if (img) { setCaptured(img); stopCamera(); }
  };

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
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
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
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: 'max(56px, calc(env(safe-area-inset-top, 0px) + 48px))', paddingBottom: 16, textAlign: 'center', paddingLeft: 24, paddingRight: 24, zIndex: 30 }}>
        <h2 style={{ color: '#fff', fontSize: 'clamp(15px, 4vw, 18px)', fontWeight: 600, margin: 0 }}>Anverso de pasaporte</h2>
        <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, margin: '6px 0 0' }}>Coloca la página de datos dentro del recuadro.</p>
      </div>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 10, padding: '120px 20px 130px' }}>
        {captured ? (
          <div style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div style={{ width: '100%', borderRadius: 12, overflow: 'hidden', position: 'relative', border: '2px solid rgba(255,255,255,0.3)' }}>
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
          <div ref={guideRef} style={{ width: '100%', maxWidth: 380, aspectRatio: '1.42', position: 'relative', borderRadius: 10, background: 'transparent', boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)', zIndex: 3 }}>
            <div style={cornerStyle('tl')} />
            <div style={cornerStyle('tr')} />
            <div style={cornerStyle('bl')} />
            <div style={cornerStyle('br')} />
            <div style={{ position: 'absolute', inset: 0, borderRadius: 10, border: '1px solid rgba(255,255,255,0.25)' }} />
            {!isReady && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Loader2 size={28} color="rgba(255,255,255,0.5)" style={{ animation: 'spin 1s linear infinite' }} />
              </div>
            )}
          </div>
        ) : null}
        {camError && cameraStarted && !captured && (
          <div style={{ marginTop: 16, background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 10, padding: '10px 14px', maxWidth: 360, width: '100%' }}>
            <p style={{ color: '#fca5a5', fontSize: 13, textAlign: 'center', margin: 0 }}>No se pudo acceder a la cámara. Verifica los permisos.</p>
          </div>
        )}
      </div>
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: `16px 24px calc(env(safe-area-inset-bottom, 16px) + 16px)`, zIndex: 30, background: 'linear-gradient(to top, rgba(0,0,0,0.95) 60%, transparent 100%)' }}>
        {captured ? (
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={() => { setCaptured(null); startCamera(); }} style={{ flex: 1, padding: '14px 0', borderRadius: 14, border: '1.5px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <RefreshCw size={15} /> Repetir
            </button>
            <button onClick={() => onCapture(captured)} style={{ flex: 2, padding: '14px 0', borderRadius: 14, background: 'linear-gradient(90deg, #1E6BFF 0%, #3b82f6 100%)', color: '#fff', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer' }}>
              Usar foto — Continuar
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button onClick={handleCapture} disabled={!isReady} style={{ width: '100%', padding: '16px 0', borderRadius: 14, background: !isReady ? 'rgba(255,255,255,0.15)' : '#ffffff', color: !isReady ? 'rgba(255,255,255,0.5)' : '#111827', fontWeight: 700, fontSize: 'clamp(14px, 4vw, 16px)', border: 'none', cursor: !isReady ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              {!isReady ? <><Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> Cargando cámara...</> : <><Camera size={18} /> Capturar Foto</>}
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

// ─── Video Selfie Capture Screen ──────────────────────────────────────────────

const VIDEO_STEPS = [
  { id: 'center', text: 'Posiciónese dentro del óvalo', durationMs: 1500 },
  { id: 'far', text: 'Acérquese o aléjese para posicionarse', durationMs: 1500 },
  { id: 'close', text: 'Mire directamente a la cámara', durationMs: 2000 },
];

function SelfieCaptureScreen({ onCapture, onBack }: { onCapture: (img: string, videoBase64: string) => void; onBack: () => void }) {
  const { videoRef, stream: streamRef, error: camError, isReady, startCamera, stopCamera } = useCamera('user');
  const ovalRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingProgress, setRecordingProgress] = useState(0);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [capturedVideoBlob, setCapturedVideoBlob] = useState<Blob | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [recordingComplete, setRecordingComplete] = useState(false);

  const showTimeoutMsg = useCameraTimeout(isReady, cameraActive, !!capturedPhoto);

  useEffect(() => {
    setCameraActive(true);
    startCamera();
    return () => {
      stopCamera();
      if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current);
      if (stepTimerRef.current) clearTimeout(stepTimerRef.current);
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') mediaRecorderRef.current.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runInstructionSteps = useCallback((stepIndex: number) => {
    if (stepIndex >= VIDEO_STEPS.length) return;
    setCurrentStepIdx(stepIndex);
    stepTimerRef.current = setTimeout(() => runInstructionSteps(stepIndex + 1), VIDEO_STEPS[stepIndex].durationMs);
  }, []);

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
    const s = streamRef.current;
    if (!s || !isReady) return;
    setCaptureError(null);
    setRecordingProgress(0);
    setCurrentStepIdx(0);
    recordedChunksRef.current = [];

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9' : MediaRecorder.isTypeSupported('video/webm')
      ? 'video/webm' : MediaRecorder.isTypeSupported('video/mp4')
      ? 'video/mp4' : '';

    try {
      const recorder = new MediaRecorder(s, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: mimeType || 'video/webm' });
        setCapturedVideoBlob(blob);
        const photo = capturePhotoFromVideo();
        if (photo) setCapturedPhoto(photo);
        setRecordingComplete(true);
        setIsRecording(false);
        stopCamera();
      };
      recorder.start(100);
      setIsRecording(true);
      setRecordingComplete(false);
      runInstructionSteps(0);

      const startTime = Date.now();
      progressIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - startTime;
        setRecordingProgress(Math.min((elapsed / MAX_VIDEO_DURATION_MS) * 100, 100));
      }, 50);

      recordingTimerRef.current = setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') mediaRecorderRef.current.stop();
        if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
        if (stepTimerRef.current) clearTimeout(stepTimerRef.current);
      }, MAX_VIDEO_DURATION_MS);
    } catch {
      setCaptureError('No se pudo iniciar la grabación. Verifica los permisos de cámara.');
    }
  }, [streamRef, isReady, runInstructionSteps, capturePhotoFromVideo, stopCamera]);

  const handleStopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') mediaRecorderRef.current.stop();
    if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current);
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    if (stepTimerRef.current) clearTimeout(stepTimerRef.current);
  }, []);

  const handleRetry = () => {
    setCapturedPhoto(null);
    setCapturedVideoBlob(null);
    setCaptureError(null);
    setRecordingComplete(false);
    setRecordingProgress(0);
    setRetryCount(c => c + 1);
    setCameraActive(true);
    startCamera();
  };

  const handleUseCapture = async () => {
    if (!capturedPhoto || !capturedVideoBlob) return;
    const reader = new FileReader();
    reader.onloadend = () => { onCapture(capturedPhoto, reader.result as string); };
    reader.readAsDataURL(capturedVideoBlob);
  };

  const currentStep = VIDEO_STEPS[Math.min(currentStepIdx, VIDEO_STEPS.length - 1)];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100dvh', background: '#000', position: 'relative', overflow: 'hidden' }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulseGlow { 0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,0.7)} 50%{box-shadow:0 0 0 14px rgba(239,68,68,0)} }
        @keyframes instructionPop { 0%{opacity:0;transform:scale(0.85)} 100%{opacity:1;transform:scale(1)} }
      `}</style>
      {cameraActive && !recordingComplete && (
        <video ref={videoRef} autoPlay playsInline muted style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 1, transform: 'scaleX(-1)' }} />
      )}
      {cameraActive && !recordingComplete && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 2, background: 'rgba(0,0,0,0.45)' }} />
      )}
      {showTimeoutMsg && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.85)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 }}>
          <Loader2 size={40} color="#f59e0b" style={{ animation: 'spin 1s linear infinite' }} />
          <p style={{ color: '#fef3c7', fontSize: 16, fontWeight: 700, textAlign: 'center', margin: 0 }}>La cámara tardó en cargar</p>
          <p style={{ color: '#fcd34d', fontSize: 14, textAlign: 'center', margin: 0, lineHeight: 1.5 }}>Se repetirá el proceso automáticamente en unos segundos...</p>
        </div>
      )}
      {retryCount > 0 && (
        <div style={{ position: 'absolute', top: 'max(16px, env(safe-area-inset-top, 16px))', left: 16, background: 'rgba(245,158,11,0.9)', borderRadius: 20, padding: '4px 10px', zIndex: 30 }}>
          <p style={{ color: '#fff', fontSize: 11, fontWeight: 700, margin: 0 }}>Intento {retryCount + 1}/{MAX_RETRY_ATTEMPTS}</p>
        </div>
      )}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: 'max(56px, calc(env(safe-area-inset-top, 0px) + 48px))', paddingBottom: 16, textAlign: 'center', paddingLeft: 24, paddingRight: 24, zIndex: 30 }}>
        <h2 style={{ color: '#fff', fontSize: 'clamp(15px, 4vw, 18px)', fontWeight: 600, margin: 0 }}>Captura de rostro</h2>
        {cameraActive && !isRecording && !recordingComplete && (
          <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13, margin: '4px 0 0' }}>Posiciónese dentro del óvalo y presione Iniciar grabación</p>
        )}
      </div>
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
            <div ref={ovalRef} style={{ width: 'min(85vw, 310px)', height: 'min(105vw, 390px)', borderRadius: '50%', position: 'relative', boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)', border: isRecording ? '5px solid #ef4444' : '4px solid #ef4444', zIndex: 3, animation: isRecording ? 'pulseGlow 1.5s ease-in-out infinite' : 'none' }}>
              <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.15)' }} />
              {!isReady && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Loader2 size={28} color="rgba(255,255,255,0.5)" style={{ animation: 'spin 1s linear infinite' }} />
                </div>
              )}
            </div>
            {!isRecording && isReady && (
              <div style={{ color: '#fff', fontSize: 'clamp(13px, 3.5vw, 15px)', fontWeight: 600, textAlign: 'center', textShadow: '0 2px 8px rgba(0,0,0,0.8)', padding: '6px 14px', borderRadius: 10, background: 'rgba(0,0,0,0.5)', maxWidth: 300 }}>
                Acérquese o aléjese para posicionarse
              </div>
            )}
            {isRecording && (
              <div key={currentStep.id} style={{ animation: 'instructionPop 0.3s ease', color: '#fff', fontSize: 'clamp(14px, 4vw, 17px)', fontWeight: 700, textAlign: 'center', textShadow: '0 2px 8px rgba(0,0,0,0.8)', padding: '8px 16px', borderRadius: 12, background: 'rgba(59,130,246,0.75)', backdropFilter: 'blur(4px)', maxWidth: 320 }}>
                {currentStep.text}
              </div>
            )}
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
          </div>
        )}
        {(camError || captureError) && cameraActive && !recordingComplete && (
          <div style={{ marginTop: 16, background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 10, padding: '10px 14px', maxWidth: 320, width: '100%' }}>
            <p style={{ color: '#fca5a5', fontSize: 13, textAlign: 'center', margin: 0 }}>{camError || captureError}</p>
          </div>
        )}
      </div>
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: `16px 24px calc(env(safe-area-inset-bottom, 16px) + 16px)`, zIndex: 30, background: 'linear-gradient(to top, rgba(0,0,0,0.95) 60%, transparent 100%)' }}>
        {recordingComplete && capturedPhoto ? (
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={handleRetry} disabled={retryCount >= MAX_RETRY_ATTEMPTS - 1} style={{ flex: 1, padding: '14px 0', borderRadius: 14, border: '1.5px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)', color: '#fff', fontWeight: 600, fontSize: 14, cursor: retryCount >= MAX_RETRY_ATTEMPTS - 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <RefreshCw size={15} /> Repetir
            </button>
            <button onClick={handleUseCapture} style={{ flex: 2, padding: '14px 0', borderRadius: 14, background: 'linear-gradient(90deg, #1E6BFF 0%, #3b82f6 100%)', color: '#fff', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer', boxShadow: '0 4px 20px rgba(30, 107, 255,0.45)' }}>
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
            <button onClick={startRecording} disabled={!isReady} style={{ width: '100%', padding: '16px 0', borderRadius: 14, background: !isReady ? 'rgba(255,255,255,0.15)' : '#ffffff', color: !isReady ? 'rgba(255,255,255,0.5)' : '#111827', fontWeight: 700, fontSize: 'clamp(14px, 4vw, 16px)', border: 'none', cursor: !isReady ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
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

// ─── OCR Validation Screen ────────────────────────────────────────────────────

function OcrValidationScreen({
  anverso, reverso, token, userProfile,
  onConfirm, onBack,
}: {
  anverso: string | null;
  reverso: string | null;
  token: string;
  userProfile: { curp?: string; nombre?: string; email?: string } | null;
  onConfirm: (ocrResult: OcrResult, nombre: string, apellidoPaterno: string, apellidoMaterno: string, curp: string, fechaNacimiento: string, sexo: string) => void;
  onBack: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [curpLoading, setCurpLoading] = useState(false);
  const [curpData, setCurpData] = useState<{ nombre: string; apellidoPaterno: string; apellidoMaterno: string; fechaNacimiento: string; sexo: string } | null>(null);
  const [curpError, setCurpError] = useState<string | null>(null);
  const [identityMismatch, setIdentityMismatch] = useState<string | null>(null);
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

        // ── Identity check: compare OCR CURP/name against user profile ────────
        if (userProfile && result.curp) {
          const profileCurp = userProfile.curp?.trim().toUpperCase() || '';
          const ocrCurp = result.curp.trim().toUpperCase();

          if (profileCurp && ocrCurp && profileCurp !== ocrCurp) {
            setIdentityMismatch(
              `La CURP de la identificación (${ocrCurp}) no coincide con la CURP del usuario registrado (${profileCurp}). Asegúrate de usar tu propia identificación.`
            );
            return;
          }

          // If no CURP in profile, try name comparison
          if (!profileCurp && userProfile.nombre) {
            const profileNombre = userProfile.nombre.trim().toUpperCase();
            const ocrNombre = `${result.nombres} ${result.primerApellido} ${result.segundoApellido}`.trim().toUpperCase();
            // Check if profile name appears in OCR name (partial match)
            const profileParts = profileNombre.split(' ').filter(p => p.length > 2);
            const matchCount = profileParts.filter(part => ocrNombre.includes(part)).length;
            if (profileParts.length > 0 && matchCount < Math.ceil(profileParts.length * 0.6)) {
              setIdentityMismatch(
                `El nombre en la identificación no coincide con el usuario registrado. Asegúrate de usar tu propia identificación.`
              );
              return;
            }
          }
        }

        // ── CURP validation via RENAPO ────────────────────────────────────────
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

  const canContinue = !loading && !curpLoading && ocrResult !== null && ocrResult.vigente !== false && !ocrError && !identityMismatch;

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
          <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }`}</style>
          <p style={{ color: BRAND.textMuted, fontSize: 13, margin: 0 }}>Leyendo identificación</p>
          <div style={{ width: '100%', background: '#e5e7eb', borderRadius: 99, height: 6 }}>
            <div style={{ background: BRAND.blue, height: 6, borderRadius: 99, width: '70%', animation: 'pulse 1.5s ease-in-out infinite' }} />
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

      {!loading && identityMismatch && (
        <div style={{ background: BRAND.redLight, border: `1.5px solid ${BRAND.redBorder}`, borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <UserX size={18} color={BRAND.red} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <p style={{ color: '#991b1b', fontWeight: 700, fontSize: 13, margin: 0 }}>Identidad no coincidente</p>
            <p style={{ color: '#b91c1c', fontSize: 12, marginTop: 4, lineHeight: 1.5 }}>{identityMismatch}</p>
          </div>
        </div>
      )}

      {!loading && ocrResult && !identityMismatch && (
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
            <div style={{ background: BRAND.greenLight, border: `1.5px solid ${BRAND.greenBorder}`, borderRadius: 14, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
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

      {(!loading && (ocrError || identityMismatch)) && (
        <button onClick={onBack} style={{ width: '100%', padding: '15px 0', borderRadius: 16, background: BRAND.blueGradient, color: '#fff', fontWeight: 700, fontSize: 15, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <RefreshCw size={16} /> Volver a capturar
        </button>
      )}

      {!ocrError && !identityMismatch && (
        <PrimaryBtn onClick={handleConfirm} disabled={!canContinue}>
          Continuar <ChevronRight size={18} />
        </PrimaryBtn>
      )}

      <SecondaryBtn onClick={onBack}>
        <ChevronLeft size={16} /> Regresar
      </SecondaryBtn>
    </div>
  );
}

// ─── Face Validation Screen ───────────────────────────────────────────────────

function FaceValidationScreen({
  selfie, idAnverso, token, onConfirm, onBack,
}: {
  selfie: string | null;
  idAnverso: string | null;
  token: string;
  onConfirm: () => void;
  onBack: () => void;
}) {
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
        const res = await fetch('/api/nubarium/reconocimiento-facial', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credencial: idAnverso, captura: selfie, enrollmentToken: token }),
        });
        let data: Record<string, unknown> = {};
        try { data = await res.json(); } catch {
          setFaceApiError('Error de conexión al validar la identidad facial.');
          setValidating(false);
          return;
        }
        if (data.networkError) {
          setFaceApiError(typeof data.error === 'string' ? data.error : 'Error de conexión al validar la identidad facial.');
          setValidating(false);
          return;
        }
        if (typeof data.similitud === 'number') {
          const sim = data.similitud as number;
          setSimilitud(sim);
          setAprobado(sim >= 99.50);
          setValidating(false);
          return;
        }
        if (data.error || (data.estatus && data.estatus !== 'OK')) {
          const nubariumMsg = typeof data.mensaje === 'string' ? data.mensaje : null;
          const apiError = typeof data.error === 'string' ? data.error : null;
          setFaceApiError(nubariumMsg || apiError || 'Error al comparar rostros con Nubarium.');
          setValidating(false);
          return;
        }
        if (!res.ok) {
          setFaceApiError('Error al comunicarse con el servicio biométrico. Intente nuevamente.');
          setValidating(false);
          return;
        }
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

  const canContinue = !validating && aprobado && !faceApiError;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }`}</style>
      <div>
        <h2 style={{ color: BRAND.text, fontSize: 20, fontWeight: 700, margin: 0 }}>Validación facial</h2>
        <p style={{ color: BRAND.textMuted, fontSize: 13, marginTop: 4 }}>Comparando selfie con tu identificación</p>
      </div>

      {validating && (
        <Card style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '20px 16px' }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', border: `3px solid ${BRAND.cardBorder}`, borderTop: `3px solid ${BRAND.blue}`, animation: 'spin 0.8s linear infinite' }} />
          <p style={{ color: BRAND.textMuted, fontSize: 13, margin: 0 }}>Comparando rostros...</p>
          <div style={{ width: '100%', background: '#e5e7eb', borderRadius: 99, height: 6 }}>
            <div style={{ background: BRAND.blue, height: 6, borderRadius: 99, width: '70%', animation: 'pulse 1.5s ease-in-out infinite' }} />
          </div>
        </Card>
      )}

      {!validating && faceApiError && (
        <div style={{ background: BRAND.redLight, border: `1.5px solid ${BRAND.redBorder}`, borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <AlertCircle size={18} color={BRAND.red} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <p style={{ color: '#991b1b', fontWeight: 700, fontSize: 13, margin: 0 }}>Error en validación facial</p>
            <p style={{ color: '#b91c1c', fontSize: 12, marginTop: 4, lineHeight: 1.4 }}>{faceApiError}</p>
          </div>
        </div>
      )}

      {!validating && similitud !== null && (
        <Card style={{ background: aprobado ? BRAND.greenLight : BRAND.redLight, border: `1.5px solid ${aprobado ? BRAND.greenBorder : BRAND.redBorder}` }}>
          {aprobado && selfie && (
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={selfie} alt="Selfie capturada" style={{ width: 100, height: 120, borderRadius: 12, objectFit: 'cover', border: `2px solid ${BRAND.greenBorder}`, boxShadow: '0 4px 12px rgba(0,0,0,0.12)' }} />
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            {aprobado ? <CheckCircle2 size={20} color={BRAND.green} /> : <AlertCircle size={20} color={BRAND.red} />}
            <p style={{ color: aprobado ? '#166534' : '#991b1b', fontWeight: 700, fontSize: 14, margin: 0 }}>
              {aprobado ? 'Identidad verificada' : 'No se pudo verificar la identidad'}
            </p>
          </div>
          <p style={{ color: aprobado ? '#166534' : '#991b1b', fontSize: 13, margin: 0 }}>
            Similitud: {similitud.toFixed(2)}%
          </p>
        </Card>
      )}

      {!validating && faceApiError && (
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

// ─── Prueba de Vida Intro Screen ──────────────────────────────────────────────

function PruebaDeVidaIntroScreen({ onStart, usingStoredId }: { onStart: () => void; usingStoredId: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Icon */}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
        <div style={{ width: 80, height: 80, borderRadius: '50%', background: '#e8f0fe', border: '2px solid #bfdbfe', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#3b6cf8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="5" width="20" height="14" rx="2"/>
            <line x1="2" y1="10" x2="22" y2="10"/>
          </svg>
        </div>
      </div>

      {/* Title & subtitle */}
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ color: BRAND.text, fontSize: 24, fontWeight: 800, margin: 0 }}>Prueba de Vida</h1>
        <p style={{ color: BRAND.textMuted, fontSize: 14, marginTop: 8, lineHeight: 1.6 }}>
          {usingStoredId
            ? 'Necesitamos verificar tu identidad mediante una videoselfie.'
            : 'Necesitamos verificar tu identidad. El proceso toma aproximadamente 3 minutos.'}
        </p>
      </div>

      {/* Stored ID notice — shown when user already has a registered ID */}
      {usingStoredId && (
        <div style={{ background: BRAND.greenLight, border: `1.5px solid ${BRAND.greenBorder}`, borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <CheckCircle2 size={20} color={BRAND.green} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <p style={{ color: '#166534', fontWeight: 700, fontSize: 14, margin: 0 }}>Identificación ya registrada</p>
            <p style={{ color: '#15803d', fontSize: 13, marginTop: 4, lineHeight: 1.5 }}>
              Ya tienes una identificación pregrabada en el sistema. <strong>No será necesario capturar tu identificación nuevamente.</strong> Solo necesitarás grabar una videoselfie para confirmar tu identidad.
            </p>
          </div>
        </div>
      )}

      {/* Requirements card */}
      <Card>
        <p style={{ color: BRAND.textMuted, fontSize: 13, fontWeight: 600, margin: '0 0 12px' }}>Necesitarás:</p>
        {(usingStoredId
          ? [
              'Cámara frontal disponible',
              'Buena iluminación',
              'Conexión a internet estable',
            ]
          : [
              'Tu INE / Pasaporte vigente',
              'Cámara frontal y trasera disponibles',
              'Buena iluminación',
              'Conexión a internet estable',
            ]
        ).map(item => (
          <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <div style={{ width: 24, height: 24, borderRadius: '50%', background: BRAND.greenLight, border: `1.5px solid ${BRAND.greenBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Check size={13} color={BRAND.green} strokeWidth={3} />
            </div>
            <p style={{ color: BRAND.text, fontSize: 14, margin: 0 }}>{item}</p>
          </div>
        ))}
      </Card>

      {/* Security notice */}
      <div style={{ background: '#eff6ff', border: '1.5px solid #bfdbfe', borderRadius: 14, padding: '14px 16px' }}>
        <p style={{ color: '#1d4ed8', fontSize: 13, lineHeight: 1.6, margin: 0 }}>
          Tus datos biométricos serán cifrados y almacenados de forma segura. Solo se usarán para verificar tu identidad.
        </p>
      </div>

      {/* CTA */}
      <PrimaryBtn onClick={onStart}>
        {usingStoredId ? 'Continuar a videoselfie' : 'Comenzar'} <ChevronRight size={18} />
      </PrimaryBtn>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CapturaIdMovilPage() {
  const params = useParams();
  const token = params?.token as string;

  const [screen, setScreen] = useState<Screen>('loading');
  const [captureData, setCaptureData] = useState<CaptureData>({
    tipoId: null,
    anverso: null,
    reverso: null,
    selfiePhoto: null,
    selfieVideo: null,
    nombre: '',
    apellidoPaterno: '',
    apellidoMaterno: '',
    curp: '',
    fechaNacimiento: '',
    sexo: '',
  });
  const [userProfile, setUserProfile] = useState<{ curp?: string; nombre?: string; email?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [nubariumSimilitud, setNubariumSimilitud] = useState<number | null>(null);
  const [nubariumAprobado, setNubariumAprobado] = useState<boolean | null>(null);
  const [mismatchReason, setMismatchReason] = useState<string | null>(null);
  const [curpMatchResult, setCurpMatchResult] = useState<{
    match: boolean | null;
    curpExtracted: string | null;
    curpProfile: string | null;
    mismatchReason: string | null;
  } | null>(null);
  const [showCloseHint, setShowCloseHint] = useState(false);

  // ── Attempt tracking (max 2 each) ─────────────────────────────────────────
  const MAX_ID_ATTEMPTS = 2;
  const MAX_SELFIE_ATTEMPTS = 2;
  const [idAttempts, setIdAttempts] = useState(0);
  const [selfieAttempts, setSelfieAttempts] = useState(0);

  // Robust close handler — works even when window.close() is blocked by mobile browsers
  const handleClose = useCallback(() => {
    // Try postMessage for embedded/iframe contexts
    try {
      if (window.opener) {
        window.opener.postMessage({ type: 'CAPTURA_ID_COMPLETE' }, '*');
      }
      window.parent?.postMessage({ type: 'CAPTURA_ID_COMPLETE' }, '*');
    } catch { /* ignore */ }
    // Try window.close()
    try {
      window.close();
    } catch { /* ignore */ }
    // Always show hint after a short delay
    setTimeout(() => {
      setShowCloseHint(true);
    }, 300);
  }, []);

  // Tracks whether the anverso was loaded from a previous capture (enrollment or id_capture_logs)
  const [usingStoredId, setUsingStoredId] = useState(false);

  // ── Cancel session (too many failed attempts) ─────────────────────────────
  const handleCancelSession = useCallback(async () => {
    try {
      await fetch('/api/mobile-upload/cancel-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
    } catch {
      // non-blocking
    }
    setScreen('cancelled');
  }, [token]);

  // ── Validate token and load user profile ──────────────────────────────────
  useEffect(() => {
    if (!token) { setScreen('expired'); return; }
    const init = async () => {
      try {
        const { createClient } = await import('@/lib/supabase/client');
        const supabase = createClient();

        const sessionResponse = await fetch(`/api/mobile-upload/session-status?token=${encodeURIComponent(token)}`, {
          cache: 'no-store',
        });
        if (!sessionResponse.ok) {
          setScreen('expired');
          return;
        }
        const session = await sessionResponse.json();

        if (session.status === 'cancelled') {
          setScreen('cancelled');
          return;
        }

        if (session.status !== 'pending' || new Date(session.expiresAt) < new Date()) {
          setScreen('expired');
          return;
        }

        const sessionUserId: string | null = session.profile ? 'capability-profile' : null;

        // Load user profile using session user_id (does not require auth session)
        if (sessionUserId) {
          const profile = session.profile;

          if (profile) {
            setUserProfile({
              curp: profile.curp || undefined,
              nombre: profile.full_name || undefined,
              email: profile.email || undefined,
            });
          }

          // ── Check for previously stored identification ──────────────────
          let storedAnverso: string | null = null;
          let storedCurp: string | null = null;
          let storedNombre: string | null = null;

          try {
            const storedIdRes = await fetch('/api/mobile-upload/check-stored-id', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token }),
            });
            if (storedIdRes.ok) {
              const storedIdData = await storedIdRes.json();
              if (storedIdData.hasStoredId && storedIdData.anverso_b64) {
                storedAnverso = storedIdData.anverso_b64;
                storedCurp = storedIdData.curp_extracted || null;
                storedNombre = storedIdData.nombre_extracted || null;
              }
            }
          } catch {
            // Non-blocking — if check fails, proceed with full ID capture flow
          }

          // If we found a stored identification, preload it and show intro (not skip it)
          if (storedAnverso) {
            const anversoDataUrl = storedAnverso.startsWith('data:')
              ? storedAnverso
              : `data:image/jpeg;base64,${storedAnverso}`;

            setCaptureData(d => ({
              ...d,
              tipoId: 'INE',
              anverso: anversoDataUrl,
              reverso: anversoDataUrl,
              curp: storedCurp || d.curp,
              nombre: storedNombre || d.nombre,
            }));
            setUsingStoredId(true);
            // Show intro screen first (with message that ID is not needed)
            setScreen('intro');
            return;
          }
        } else {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            const { data: profile } = await supabase
              .from('user_profiles')
              .select('curp, full_name, email')
              .eq('id', user.id)
              .maybeSingle();

            if (profile) {
              setUserProfile({
                curp: profile.curp || undefined,
                nombre: profile.full_name || user.email || undefined,
                email: profile.email || user.email || undefined,
              });
            } else {
              setUserProfile({ email: user.email || undefined });
            }
          }
        }

        setScreen('intro');
      } catch {
        setScreen('expired');
      }
    };
    init();
  }, [token]);

  // ── Submit final captures ─────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!captureData.selfiePhoto) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/mobile-upload/submit-id-capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          anversoData: captureData.anverso,
          reversoData: captureData.reverso,
          selfieData: captureData.selfiePhoto,
          selfieVideo: captureData.selfieVideo || null,
          curpExtracted: captureData.curp || null,
          nombreExtracted: captureData.nombre
            ? `${captureData.nombre} ${captureData.apellidoPaterno} ${captureData.apellidoMaterno}`.trim()
            : null,
          curpProfileFallback: userProfile?.curp || null,
          usingStoredId: usingStoredId || false,
        }),
      });
      let data = await res.json();

      if (res.status === 422 && data.identity_mismatch) {
        setNubariumSimilitud(typeof data.nubarium_similitud === 'number' ? data.nubarium_similitud : null);
        setMismatchReason(data.mismatch_reason || 'La persona capturada no coincide con el usuario registrado.');
        setSubmitting(false);
        setScreen('identity_mismatch');
        return;
      }

      if (!res.ok) {
        setSubmitError(data.error || 'Error al enviar los datos.');
        setSubmitting(false);
        return;
      }

      setNubariumSimilitud(typeof data.nubarium_similitud === 'number' ? data.nubarium_similitud : null);
      setNubariumAprobado(typeof data.nubarium_aprobado === 'boolean' ? data.nubarium_aprobado : null);
      setCurpMatchResult({
        match: data.curp_match ?? null,
        curpExtracted: data.curp_extracted || null,
        curpProfile: data.curp_profile || null,
        mismatchReason: data.curp_mismatch_reason || null,
      });
      setScreen('success');
    } catch (err: any) {
      setSubmitError(err.message || 'Error inesperado.');
      setSubmitting(false);
    }
  };

  // ── Handle OCR validation failure (ID attempt tracking) ───────────────────
  const handleOcrBack = useCallback(() => {
    const newCount = idAttempts + 1;
    setIdAttempts(newCount);
    if (newCount >= MAX_ID_ATTEMPTS) {
      handleCancelSession();
      return;
    }
    setScreen('id_type');
  }, [idAttempts, handleCancelSession]);

  // ── Handle selfie/face validation failure (selfie attempt tracking) ────────
  const handleSelfieBack = useCallback(() => {
    const newCount = selfieAttempts + 1;
    setSelfieAttempts(newCount);
    if (newCount >= MAX_SELFIE_ATTEMPTS) {
      handleCancelSession();
      return;
    }
    setScreen('selfie_instructions');
  }, [selfieAttempts, handleCancelSession]);

  const handleRetryFromMismatch = () => {
    const newCount = idAttempts + 1;
    setIdAttempts(newCount);
    if (newCount >= MAX_ID_ATTEMPTS) {
      handleCancelSession();
      return;
    }
    setCaptureData(d => ({ ...d, anverso: null, reverso: null, selfiePhoto: null, selfieVideo: null, tipoId: null }));
    setMismatchReason(null);
    setNubariumSimilitud(null);
    setScreen('id_type');
  };

  // ── Fullscreen camera screens ─────────────────────────────────────────────
  if (screen === 'anverso') {
    if (captureData.tipoId === 'Pasaporte') {
      return (
        <PassportScannerScreen
          onCapture={(img) => {
            setCaptureData(d => ({ ...d, anverso: img, reverso: img }));
            setScreen('ocr_validation');
          }}
          onBack={() => setScreen('id_type')}
        />
      );
    }
    return (
      <IdScannerScreen
        key="anverso"
        side="anverso"
        tipoId={captureData.tipoId || 'INE'}
        onCapture={(img) => { setCaptureData(d => ({ ...d, anverso: img })); setScreen('reverso'); }}
        onBack={() => setScreen('id_type')}
      />
    );
  }

  if (screen === 'reverso') {
    return (
      <IdScannerScreen
        key="reverso"
        side="reverso"
        tipoId={captureData.tipoId || 'INE'}
        onCapture={(img) => { setCaptureData(d => ({ ...d, reverso: img })); setScreen('ocr_validation'); }}
        onBack={() => setScreen('anverso')}
      />
    );
  }

  if (screen === 'selfie_capture') {
    return (
      <SelfieCaptureScreen
        onCapture={(img, videoBase64) => {
          setCaptureData(d => ({ ...d, selfiePhoto: img, selfieVideo: videoBase64 }));
          setScreen('face_validation');
        }}
        onBack={() => setScreen('selfie_instructions')}
      />
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (screen === 'loading') {
    return (
      <div style={{ minHeight: '100dvh', background: BRAND.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Loader2 size={32} color={BRAND.blue} style={{ animation: 'spin 1s linear infinite', marginBottom: 16 }} />
        <p style={{ color: BRAND.textMuted, fontSize: 14 }}>Verificando enlace…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ── Expired ───────────────────────────────────────────────────────────────
  if (screen === 'expired') {
    return (
      <div style={{ minHeight: '100dvh', background: BRAND.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ background: BRAND.card, border: `1.5px solid ${BRAND.cardBorder}`, borderRadius: 20, padding: 32, maxWidth: 360, width: '100%', textAlign: 'center' }}>
          <AlertTriangle size={40} color={BRAND.amber} style={{ margin: '0 auto 16px' }} />
          <h2 style={{ color: BRAND.text, fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Enlace inválido o expirado</h2>
          <p style={{ color: BRAND.textMuted, fontSize: 14, lineHeight: 1.6 }}>
            Este enlace ya no es válido. Regresa a tu computadora y genera un nuevo código QR.
          </p>
        </div>
      </div>
    );
  }

  // ── Cancelled (too many failed attempts) ──────────────────────────────────
  if (screen === 'cancelled') {
    return (
      <div style={{ minHeight: '100dvh', background: BRAND.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ background: BRAND.card, border: `1.5px solid ${BRAND.redBorder}`, borderRadius: 20, padding: 32, maxWidth: 380, width: '100%', textAlign: 'center' }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: BRAND.redLight, border: `2px solid ${BRAND.redBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            <AlertTriangle size={34} color={BRAND.red} />
          </div>
          <h2 style={{ color: '#991b1b', fontSize: 20, fontWeight: 800, marginBottom: 10 }}>Enrolamiento cancelado</h2>
          <p style={{ color: '#b91c1c', fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
            Se ha superado el número máximo de intentos permitidos. El proceso de verificación ha sido cancelado por seguridad.
          </p>
          <div style={{ background: BRAND.redLight, border: `1.5px solid ${BRAND.redBorder}`, borderRadius: 12, padding: '12px 16px', marginBottom: 20, textAlign: 'left' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <AlertCircle size={16} color={BRAND.red} style={{ flexShrink: 0, marginTop: 1 }} />
              <p style={{ color: '#991b1b', fontSize: 13, lineHeight: 1.5, margin: 0 }}>
                Este enlace ha sido invalidado y ya no podrá ser utilizado. Para continuar, deberás solicitar un nuevo enlace de verificación al administrador del documento.
              </p>
            </div>
          </div>
          <button onClick={handleClose} style={{ width: '100%', padding: '14px 0', borderRadius: 14, background: BRAND.blueGradient, color: '#fff', border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <X size={16} /> Cerrar ventana
          </button>
          {showCloseHint && (
            <p style={{ marginTop: 14, fontSize: 13, color: BRAND.textMuted, lineHeight: 1.5 }}>
              Puedes cerrar esta pestaña manualmente desde el navegador.
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Identity Mismatch ─────────────────────────────────────────────────────
  if (screen === 'identity_mismatch') {
    const attemptsLeft = MAX_ID_ATTEMPTS - idAttempts - 1;
    return (
      <div style={{ minHeight: '100dvh', background: BRAND.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ background: BRAND.card, border: `1.5px solid ${BRAND.redBorder}`, borderRadius: 20, padding: 32, maxWidth: 380, width: '100%', textAlign: 'center' }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: BRAND.redLight, border: `2px solid ${BRAND.redBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            <UserX size={34} color={BRAND.red} />
          </div>
          <h2 style={{ color: '#991b1b', fontSize: 20, fontWeight: 800, marginBottom: 10 }}>Identidad no coincidente</h2>
          <p style={{ color: '#b91c1c', fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
            La persona capturada no coincide con el usuario registrado en el sistema.
          </p>
          <div style={{ background: BRAND.redLight, border: `1.5px solid ${BRAND.redBorder}`, borderRadius: 12, padding: '12px 16px', marginBottom: 20, textAlign: 'left' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <AlertCircle size={16} color={BRAND.red} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <p style={{ color: '#991b1b', fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Motivo del rechazo</p>
                <p style={{ color: '#b91c1c', fontSize: 13, lineHeight: 1.5 }}>{mismatchReason}</p>
                {nubariumSimilitud !== null && (
                  <p style={{ color: '#b91c1c', fontSize: 12, marginTop: 6, fontWeight: 600 }}>
                    Similitud facial detectada: {nubariumSimilitud.toFixed(2)}%
                  </p>
                )}
              </div>
            </div>
          </div>
          {attemptsLeft > 0 ? (
            <>
              <div style={{ background: BRAND.amberLight, border: `1.5px solid ${BRAND.amberBorder}`, borderRadius: 12, padding: '10px 14px', marginBottom: 20, textAlign: 'left' }}>
                <p style={{ color: '#92400e', fontSize: 12, lineHeight: 1.5, margin: 0 }}>
                  Por seguridad, este intento ha sido registrado. Te queda <strong>{attemptsLeft} intento{attemptsLeft !== 1 ? 's' : ''}</strong> antes de que el enrolamiento sea cancelado.
                </p>
              </div>
              <button onClick={handleRetryFromMismatch} style={{ width: '100%', padding: '14px 0', borderRadius: 14, background: BRAND.blueGradient, color: '#fff', border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12 }}>
                <RefreshCw size={16} /> Intentar nuevamente
              </button>
            </>
          ) : (
            <div style={{ background: BRAND.redLight, border: `1.5px solid ${BRAND.redBorder}`, borderRadius: 12, padding: '10px 14px', marginBottom: 20, textAlign: 'left' }}>
              <p style={{ color: '#991b1b', fontSize: 12, lineHeight: 1.5, margin: 0 }}>
                Se ha alcanzado el límite de intentos. El enrolamiento será cancelado.
              </p>
            </div>
          )}
          <button onClick={handleClose} style={{ width: '100%', padding: '13px 0', borderRadius: 14, background: 'transparent', color: BRAND.textMuted, border: `1.5px solid ${BRAND.cardBorder}`, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
            Cerrar ventana
          </button>
        </div>
      </div>
    );
  }

  // ── Success ───────────────────────────────────────────────────────────────
  if (screen === 'success') {
    const identityMismatch = curpMatchResult?.match === false;
    return (
      <div style={{ minHeight: '100dvh', background: identityMismatch ? '#fef2f2' : BRAND.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ background: BRAND.card, border: `1.5px solid ${identityMismatch ? BRAND.redBorder : BRAND.cardBorder}`, borderRadius: 20, padding: 32, maxWidth: 380, width: '100%', textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
            <AppImage src="/assets/images/docubox-logo-2026.png" alt="Docubox logo" width={126} height={24} className="object-contain" priority />
          </div>
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: identityMismatch ? BRAND.redLight : BRAND.greenLight, border: `2px solid ${identityMismatch ? BRAND.redBorder : BRAND.greenBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            {identityMismatch ? <AlertTriangle size={36} color={BRAND.red} /> : <CheckCircle2 size={36} color={BRAND.green} />}
          </div>
          <h2 style={{ color: identityMismatch ? '#991b1b' : BRAND.text, fontSize: 20, fontWeight: 800, marginBottom: 8 }}>
            {identityMismatch ? 'Identidad no reconocida' : '¡Prueba de vida completada!'}
          </h2>
          <p style={{ color: identityMismatch ? '#b91c1c' : BRAND.textMuted, fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
            {identityMismatch
              ? 'La identidad capturada no coincide con el usuario registrado. Puedes cerrar esta ventana.'
              : 'Tu identificación y selfie fueron verificadas correctamente. Puedes cerrar esta ventana y continuar en tu computadora.'}
          </p>

          {/* Biometric verification result */}
          <div style={{ background: nubariumAprobado ? BRAND.greenLight : nubariumAprobado === false ? BRAND.redLight : BRAND.amberLight, border: `1.5px solid ${nubariumAprobado ? BRAND.greenBorder : nubariumAprobado === false ? BRAND.redBorder : BRAND.amberBorder}`, borderRadius: 14, padding: '14px 16px', marginBottom: 16, textAlign: 'left' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              {nubariumAprobado ? <ShieldCheck size={20} color={BRAND.green} /> : <ShieldAlert size={20} color={nubariumAprobado === false ? BRAND.red : BRAND.amber} />}
              <p style={{ color: nubariumAprobado ? '#166534' : nubariumAprobado === false ? '#991b1b' : '#92400e', fontWeight: 700, fontSize: 14, margin: 0 }}>
                {nubariumAprobado ? 'Prueba de vida — Identidad verificada' : nubariumAprobado === false ? 'Prueba de vida — No verificada' : 'Prueba de vida — Procesada'}
              </p>
            </div>
            {nubariumSimilitud !== null && (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: `1px solid ${nubariumAprobado ? BRAND.greenBorder : nubariumAprobado === false ? BRAND.redBorder : BRAND.amberBorder}` }}>
                <p style={{ color: nubariumAprobado ? '#15803d' : '#b45309', fontSize: 13, margin: 0 }}>Similitud facial</p>
                <p style={{ color: nubariumAprobado ? '#166534' : '#92400e', fontSize: 13, fontWeight: 700, margin: 0 }}>{nubariumSimilitud.toFixed(2)}%</p>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: `1px solid ${nubariumAprobado ? BRAND.greenBorder : nubariumAprobado === false ? BRAND.redBorder : BRAND.amberBorder}` }}>
              <p style={{ color: nubariumAprobado ? '#15803d' : '#b45309', fontSize: 13, margin: 0 }}>Resultado biométrico</p>
              <p style={{ color: nubariumAprobado ? '#166534' : '#92400e', fontSize: 13, fontWeight: 700, margin: 0 }}>
                {nubariumAprobado ? '✅ Aprobado' : nubariumAprobado === false ? '❌ No aprobado' : '⚠️ Sin comparación'}
              </p>
            </div>
          </div>

          {/* CURP identity match result */}
          {curpMatchResult && (curpMatchResult.match !== null || curpMatchResult.curpExtracted) && (
            <div style={{ background: curpMatchResult.match === true ? BRAND.greenLight : curpMatchResult.match === false ? BRAND.redLight : BRAND.amberLight, border: `1.5px solid ${curpMatchResult.match === true ? BRAND.greenBorder : curpMatchResult.match === false ? BRAND.redBorder : BRAND.amberBorder}`, borderRadius: 14, padding: '14px 16px', marginBottom: 16, textAlign: 'left' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                {curpMatchResult.match === true ? <ShieldCheck size={18} color={BRAND.green} /> : curpMatchResult.match === false ? <UserX size={18} color={BRAND.red} /> : <ShieldAlert size={18} color={BRAND.amber} />}
                <p style={{ color: curpMatchResult.match === true ? '#166534' : curpMatchResult.match === false ? '#991b1b' : '#92400e', fontWeight: 700, fontSize: 14, margin: 0 }}>
                  {curpMatchResult.match === true ? 'Identidad confirmada — CURP coincide' : curpMatchResult.match === false ? 'Advertencia — CURP no coincide' : 'CURP extraída — Sin perfil para comparar'}
                </p>
              </div>
              {(captureData.nombre || captureData.apellidoPaterno) && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderTop: `1px solid ${curpMatchResult.match === true ? BRAND.greenBorder : curpMatchResult.match === false ? BRAND.redBorder : BRAND.amberBorder}` }}>
                  <p style={{ color: curpMatchResult.match === true ? '#15803d' : '#b45309', fontSize: 12, margin: 0 }}>Nombre</p>
                  <p style={{ color: curpMatchResult.match === true ? '#166534' : '#92400e', fontSize: 12, fontWeight: 600, margin: 0 }}>{[captureData.nombre, captureData.apellidoPaterno, captureData.apellidoMaterno].filter(Boolean).join(' ')}</p>
                </div>
              )}
              {curpMatchResult.curpExtracted && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderTop: `1px solid ${curpMatchResult.match === true ? BRAND.greenBorder : curpMatchResult.match === false ? BRAND.redBorder : BRAND.amberBorder}` }}>
                  <p style={{ color: curpMatchResult.match === true ? '#15803d' : '#b45309', fontSize: 12, margin: 0 }}>CURP en identificación</p>
                  <p style={{ color: curpMatchResult.match === true ? '#166534' : '#92400e', fontSize: 12, fontWeight: 700, margin: 0, fontFamily: 'monospace' }}>{curpMatchResult.curpExtracted}</p>
                </div>
              )}
              {curpMatchResult.curpProfile && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderTop: `1px solid ${curpMatchResult.match === true ? BRAND.greenBorder : curpMatchResult.match === false ? BRAND.redBorder : BRAND.amberBorder}` }}>
                  <p style={{ color: curpMatchResult.match === true ? '#15803d' : '#b45309', fontSize: 12, margin: 0 }}>CURP en perfil registrado</p>
                  <p style={{ color: curpMatchResult.match === true ? '#166534' : '#92400e', fontSize: 12, fontWeight: 700, margin: 0, fontFamily: 'monospace' }}>{curpMatchResult.curpProfile}</p>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderTop: `1px solid ${curpMatchResult.match === true ? BRAND.greenBorder : curpMatchResult.match === false ? BRAND.redBorder : BRAND.amberBorder}` }}>
                <p style={{ color: curpMatchResult.match === true ? '#15803d' : '#b45309', fontSize: 12, margin: 0 }}>Verificación de identidad</p>
                <p style={{ color: curpMatchResult.match === true ? '#166534' : '#92400e', fontSize: 12, fontWeight: 700, margin: 0 }}>
                  {curpMatchResult.match === true ? '✅ Mismo usuario' : curpMatchResult.match === false ? '❌ Usuario diferente' : '⚠️ Sin comparación'}
                </p>
              </div>
            </div>
          )}

          {/* Datos extraídos de la identificación — solo cuando la identidad NO coincide */}
          {curpMatchResult && curpMatchResult.match === false && (captureData.curp || captureData.nombre || captureData.apellidoPaterno) && (
            <div style={{ background: '#fff7ed', border: `1.5px solid #fdba74`, borderRadius: 14, padding: '14px 16px', marginBottom: 16, textAlign: 'left' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <AlertTriangle size={16} color='#ea580c' />
                <p style={{ color: '#9a3412', fontWeight: 700, fontSize: 13, margin: 0 }}>Datos extraídos de la identificación</p>
              </div>
              {captureData.curp && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderTop: '1px solid #fdba74' }}>
                  <p style={{ color: '#c2410c', fontSize: 12, margin: 0 }}>CURP</p>
                  <p style={{ color: '#9a3412', fontSize: 12, fontWeight: 700, margin: 0, fontFamily: 'monospace' }}>{captureData.curp}</p>
                </div>
              )}
            </div>
          )}

          <button onClick={handleClose} style={{ background: BRAND.blueGradient, color: '#fff', border: 'none', borderRadius: 14, padding: '14px 0', fontWeight: 700, fontSize: 15, cursor: 'pointer', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Check size={16} /> Finalizar y cerrar
          </button>
          <p style={{ marginTop: 14, fontSize: 13, color: BRAND.textMuted, lineHeight: 1.5 }}>
            Puedes cerrar esta pestaña manualmente desde el navegador.
          </p>
        </div>
      </div>
    );
  }

  // ── Wrapped screens (with header + progress dots) ─────────────────────────
  const SCREENS_ORDER: Screen[] = usingStoredId
    ? ['intro', 'selfie_instructions', 'selfie_capture', 'face_validation']
    : ['intro', 'id_type', 'anverso', 'reverso', 'ocr_validation', 'selfie_instructions', 'selfie_capture', 'face_validation'];
  const currentIdx = SCREENS_ORDER.indexOf(screen);

  return (
    <PublicTokenLayout token={token} luciaScope="mobile_id_capture">
    <div style={{ minHeight: '100dvh', background: BRAND.bg, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      {/* Header */}
      <div style={{ width: '100%', maxWidth: 480, padding: '16px 20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <AppImage src="/assets/images/docubox-logo-2026.png" alt="Docubox logo" width={126} height={24} className="object-contain" priority />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {SCREENS_ORDER.map((s, idx) => (
            <div key={s} style={{ width: s === screen ? 18 : 6, height: 6, borderRadius: 99, background: s === screen ? BRAND.blue : idx < currentIdx ? BRAND.green : BRAND.cardBorder, transition: 'all 0.3s ease' }} />
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

      {/* Screen content */}
      <div style={{ width: '100%', maxWidth: 480, padding: '20px 20px 32px' }}>
        <ScreenTransition screenKey={screen}>

          {/* Intro — Prueba de Vida */}
          {screen === 'intro' && (
            <PruebaDeVidaIntroScreen
              usingStoredId={usingStoredId}
              onStart={() => setScreen(usingStoredId ? 'selfie_instructions' : 'id_type')}
            />
          )}

          {/* ID Type Selection */}
          {screen === 'id_type' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <h2 style={{ color: BRAND.text, fontSize: 20, fontWeight: 700, margin: 0 }}>Tipo de identificación</h2>
                <p style={{ color: BRAND.textMuted, fontSize: 13, marginTop: 4 }}>Selecciona el documento que usarás para verificar tu identidad</p>
              </div>
              {idAttempts > 0 && (
                <div style={{ background: BRAND.amberLight, border: `1.5px solid ${BRAND.amberBorder}`, borderRadius: 12, padding: '10px 14px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <AlertCircle size={15} color={BRAND.amber} style={{ flexShrink: 0, marginTop: 1 }} />
                  <p style={{ color: '#92400e', fontSize: 13, margin: 0, lineHeight: 1.5 }}>
                    Intento {idAttempts + 1} de {MAX_ID_ATTEMPTS}. Si falla este intento, el enrolamiento será cancelado.
                  </p>
                </div>
              )}
              {([
                { tipo: 'INE' as IdType, label: 'INE / IFE', desc: 'Credencial para votar vigente', disabled: false },
                { tipo: 'Pasaporte' as IdType, label: 'Pasaporte', desc: 'Pasaporte mexicano vigente', disabled: false },
                { tipo: 'FM3' as IdType, label: 'FM3 / Residencia', desc: 'No disponible por el momento', disabled: true },
              ]).map(opt => (
                <button
                  key={opt.tipo}
                  onClick={() => !opt.disabled && (setCaptureData(d => ({ ...d, tipoId: opt.tipo })), setScreen('anverso'))}
                  disabled={opt.disabled}
                  style={{ background: opt.disabled ? '#f3f4f6' : BRAND.card, border: `1.5px solid ${opt.disabled ? '#e5e7eb' : BRAND.cardBorder}`, borderRadius: 14, padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: opt.disabled ? 'not-allowed' : 'pointer', textAlign: 'left', width: '100%', opacity: opt.disabled ? 0.5 : 1 }}
                >
                  <div>
                    <p style={{ color: opt.disabled ? BRAND.textLight : BRAND.text, fontWeight: 700, fontSize: 15, margin: 0 }}>{opt.label}</p>
                    <p style={{ color: BRAND.textMuted, fontSize: 13, margin: '2px 0 0' }}>{opt.desc}</p>
                  </div>
                  <ChevronRight size={18} color={BRAND.textLight} />
                </button>
              ))}
              <SecondaryBtn onClick={handleClose}>
                <ChevronLeft size={16} /> Regresar
              </SecondaryBtn>
            </div>
          )}

          {/* OCR Validation */}
          {screen === 'ocr_validation' && (
            <OcrValidationScreen
              anverso={captureData.anverso}
              reverso={captureData.reverso}
              token={token}
              userProfile={userProfile}
              onConfirm={(_ocrResult, nombre, apellidoPaterno, apellidoMaterno, curp, fechaNacimiento, sexo) => {
                setCaptureData(d => ({ ...d, nombre, apellidoPaterno, apellidoMaterno, curp, fechaNacimiento, sexo }));
                setScreen('selfie_instructions');
              }}
              onBack={handleOcrBack}
            />
          )}

          {/* Selfie Instructions */}
          {screen === 'selfie_instructions' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <h2 style={{ color: BRAND.text, fontSize: 20, fontWeight: 700, margin: 0 }}>Captura de video facial</h2>
                <p style={{ color: BRAND.textMuted, fontSize: 13, marginTop: 4 }}>Ahora necesitamos grabar un video corto de tu rostro</p>
              </div>
              {usingStoredId && (
                <div style={{ background: '#eff6ff', border: '1.5px solid #bfdbfe', borderRadius: 12, padding: '10px 14px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <ShieldCheck size={16} color={BRAND.blue} style={{ flexShrink: 0, marginTop: 1 }} />
                  <p style={{ color: '#1e40af', fontSize: 13, margin: 0, lineHeight: 1.5 }}>
                    Tu identificación ya está registrada. Solo necesitamos capturar tu selfie para comparar con la identificación almacenada.
                  </p>
                </div>
              )}
              {selfieAttempts > 0 && (
                <div style={{ background: BRAND.amberLight, border: `1.5px solid ${BRAND.amberBorder}`, borderRadius: 12, padding: '10px 14px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <AlertCircle size={15} color={BRAND.amber} style={{ flexShrink: 0, marginTop: 1 }} />
                  <p style={{ color: '#92400e', fontSize: 13, margin: 0, lineHeight: 1.5 }}>
                    Intento {selfieAttempts + 1} de {MAX_SELFIE_ATTEMPTS}. Si falla este intento, el enrolamiento será cancelado.
                  </p>
                </div>
              )}
              <Card>
                <p style={{ color: BRAND.textMuted, fontSize: 13, fontWeight: 600, margin: '0 0 10px' }}>Para una buena captura:</p>
                {[
                  'Asegúrate de tener buena iluminación',
                  'Mira directamente a la cámara al inicio',
                  'Sigue las instrucciones en pantalla (girar cabeza, acercarte/alejarte)',
                  'El video dura máximo 3 segundos',
                  'Retira lentes o accesorios si es posible',
                ].map(item => (
                  <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <div style={{ width: 20, height: 20, borderRadius: '50%', background: BRAND.greenLight, border: `1px solid ${BRAND.greenBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Check size={11} color={BRAND.green} strokeWidth={3} />
                    </div>
                    <p style={{ color: BRAND.text, fontSize: 13, margin: 0 }}>{item}</p>
                  </div>
                ))}
              </Card>
              <PrimaryBtn onClick={() => setScreen('selfie_capture')}>Continuar <ChevronRight size={18} /></PrimaryBtn>
              {!usingStoredId && (
                <SecondaryBtn onClick={() => setScreen('ocr_validation')}><ChevronLeft size={16} /> Regresar</SecondaryBtn>
              )}
              {usingStoredId && (
                <SecondaryBtn onClick={handleClose}><X size={16} /> Cancelar</SecondaryBtn>
              )}
            </div>
          )}

          {/* Face Validation */}
          {screen === 'face_validation' && (
            <FaceValidationScreen
              selfie={captureData.selfiePhoto}
              idAnverso={captureData.anverso}
              token={token}
              onConfirm={handleSubmit}
              onBack={handleSelfieBack}
            />
          )}

          {/* Submitting overlay */}
          {submitting && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(245,247,250,0.92)', zIndex: 100, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', border: `3px solid ${BRAND.cardBorder}`, borderTop: `3px solid ${BRAND.blue}`, animation: 'spin 0.8s linear infinite' }} />
              <p style={{ color: BRAND.textMuted, fontSize: 13, fontWeight: 500 }}>Enviando y validando…</p>
            </div>
          )}

          {submitError && (
            <div style={{ background: BRAND.redLight, border: `1.5px solid ${BRAND.redBorder}`, borderRadius: 12, padding: '12px 16px', marginTop: 12, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <AlertTriangle size={16} color={BRAND.red} style={{ flexShrink: 0, marginTop: 1 }} />
              <p style={{ color: '#991b1b', fontSize: 13, lineHeight: 1.5 }}>{submitError}</p>
            </div>
          )}

        </ScreenTransition>
      </div>
    </div>
    </PublicTokenLayout>
  );
}
