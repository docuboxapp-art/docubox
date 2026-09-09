'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2, MapPin, PenLine, RotateCcw, RotateCw, ShieldCheck, X } from 'lucide-react';
import { useParams } from 'next/navigation';
import AppLogo from '@/components/ui/AppLogo';

type StrokeSize = 'thin' | 'medium' | 'thick';
type GeolocationStatus = 'loading' | 'ready' | 'denied' | 'unavailable';

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export default function MobileSignaturePage() {
  const params = useParams<{ token: string }>();
  const token = typeof params?.token === 'string' ? params.token : '';
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<any>(null);
  const [screen, setScreen] = useState<'loading' | 'draw' | 'sending' | 'success' | 'error'>('loading');
  const [documentName, setDocumentName] = useState('Documento');
  const [error, setError] = useState('');
  const [hasStrokes, setHasStrokes] = useState(false);
  const [padReady, setPadReady] = useState(false);
  const [penColor, setPenColor] = useState('#0a0a0f');
  const [strokeSize, setStrokeSize] = useState<StrokeSize>('thin');
  const [orientationMessage, setOrientationMessage] = useState('');
  const [secondsUntilClose, setSecondsUntilClose] = useState(5);
  const [geolocationStatus, setGeolocationStatus] = useState<GeolocationStatus>('loading');
  const geolocationRef = useRef<{
    latitude: number;
    longitude: number;
    accuracy_meters: number;
    source: 'browser_api';
  } | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) {
      setGeolocationStatus('unavailable');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          setGeolocationStatus('unavailable');
          return;
        }
        geolocationRef.current = {
          latitude,
          longitude,
          accuracy_meters: Number.isFinite(accuracy) ? accuracy : 0,
          source: 'browser_api',
        };
        setGeolocationStatus('ready');
      },
      (positionError) => {
        setGeolocationStatus(positionError.code === 1 ? 'denied' : 'unavailable');
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 }
    );
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch(`/api/firma/mobile-signature/session?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok || data.status !== 'pending') throw new Error(data.error || 'Este enlace ya no está disponible.');
        setDocumentName(data.documentName || 'Documento');
        setScreen('draw');
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'No fue posible abrir el enlace.');
        setScreen('error');
      }
    };
    if (token) load();
  }, [token]);

  useEffect(() => {
    if (screen !== 'draw') return;
    let pad: any;
    const initialise = async () => {
      const SignaturePad = (await import('signature_pad')).default;
      const canvas = canvasRef.current;
      if (!canvas) return;
      pad = new SignaturePad(canvas, { minWidth: 0.4, maxWidth: 1.2, penColor, throttle: 16 });
      pad.addEventListener('beginStroke', () => setHasStrokes(true));
      padRef.current = pad;
      const resizePad = () => {
        const priorWidth = canvas.width / (window.devicePixelRatio || 1) || 1;
        const priorHeight = canvas.height / (window.devicePixelRatio || 1) || 1;
        const strokes = pad.toData();
        const ratio = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const nextWidth = Math.max(Math.floor(rect.width), 1);
        const nextHeight = Math.max(Math.floor(rect.height), 1);
        canvas.width = Math.floor(nextWidth * ratio);
        canvas.height = Math.floor(nextHeight * ratio);
        canvas.getContext('2d')?.scale(ratio, ratio);
        if (!strokes.length) return;
        pad.clear();
        pad.fromData(
          strokes.map((stroke: any) => ({
            ...stroke,
            points: stroke.points.map((point: any) => ({
              ...point,
              x: (point.x * nextWidth) / priorWidth,
              y: (point.y * nextHeight) / priorHeight,
            })),
          }))
        );
      };
      let resizeFrame: number | null = null;
      const scheduleResize = () => {
        if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
        resizeFrame = window.requestAnimationFrame(() => {
          resizeFrame = null;
          resizePad();
        });
      };
      const observer = new ResizeObserver(scheduleResize);
      observer.observe(canvas);
      scheduleResize();
      const onViewportResize = scheduleResize;
      window.addEventListener('resize', onViewportResize);
      window.visualViewport?.addEventListener('resize', onViewportResize);
      setPadReady(true);
      return () => {
        observer.disconnect();
        if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
        window.removeEventListener('resize', onViewportResize);
        window.visualViewport?.removeEventListener('resize', onViewportResize);
      };
    };
    let cleanup: (() => void) | undefined;
    initialise().then((dispose) => {
      cleanup = dispose;
    });
    return () => {
      cleanup?.();
      pad?.off();
    };
  }, [screen]);

  const closePage = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }

    window.close();

    // Browsers only allow window.close() for tabs opened by script. Replace this
    // temporary, single-use page when the browser keeps the QR tab open.
    window.setTimeout(() => {
      if (!window.closed) window.location.replace('about:blank');
    }, 150);
  }, []);

  useEffect(() => {
    if (screen !== 'success') return;

    setSecondsUntilClose(5);
    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      const secondsRemaining = Math.max(0, 5 - Math.floor((Date.now() - startedAt) / 1000));
      setSecondsUntilClose(secondsRemaining);
    }, 200);
    const closeTimer = window.setTimeout(closePage, 5_000);

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(closeTimer);
    };
  }, [closePage, screen]);

  const requestLandscape = async () => {
    const orientation = window.screen.orientation as ScreenOrientation & {
      lock?: (mode: 'landscape') => Promise<void>;
    };

    if (!orientation?.lock) {
      setOrientationMessage('Gira el teléfono para firmar en horizontal.');
      return;
    }

    try {
      if (!document.fullscreenElement) {
        try {
          await document.documentElement.requestFullscreen?.();
        } catch {
          // Some browsers can lock orientation without entering fullscreen.
        }
      }
      await orientation.lock('landscape');
      setOrientationMessage('La pantalla está en horizontal para firmar.');
    } catch {
      setOrientationMessage('Gira el teléfono para firmar en horizontal.');
    }
  };

  const updateStrokeSize = (size: StrokeSize) => {
    setStrokeSize(size);
    const widths = { thin: [0.4, 1.2], medium: [0.8, 2.8], thick: [2, 5] } as const;
    if (padRef.current) {
      padRef.current.minWidth = widths[size][0];
      padRef.current.maxWidth = widths[size][1];
    }
  };

  const updateColor = (color: string) => {
    setPenColor(color);
    if (padRef.current) padRef.current.penColor = color;
  };

  const clear = () => {
    padRef.current?.clear();
    setHasStrokes(false);
  };

  const submit = useCallback(async () => {
    const pad = padRef.current;
    if (!pad || pad.isEmpty()) return;
    if (geolocationStatus !== 'ready' || !geolocationRef.current) {
      setError(
        geolocationStatus === 'denied'
          ? 'Debes permitir el acceso a tu ubicación para enviar la firma.'
          : 'No fue posible obtener una ubicación válida. Activa la ubicación e inténtalo de nuevo.'
      );
      return;
    }
    setScreen('sending');
    try {
      const fingerprintSeed = JSON.stringify({
        userAgent: navigator.userAgent,
        language: navigator.language,
        platform: navigator.platform,
        screen: `${globalThis.screen.width}x${globalThis.screen.height}x${globalThis.screen.colorDepth}`,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      const fingerprintId = await sha256(fingerprintSeed);
      const response = await fetch('/api/firma/mobile-signature/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          signatureDataUrl: pad.toDataURL('image/png'),
          strokes: pad.toData(),
          sessionEvidence: {
            user_agent: navigator.userAgent,
            language: navigator.language,
            platform: navigator.platform,
            screen: `${globalThis.screen.width}x${globalThis.screen.height}x${globalThis.screen.colorDepth}`,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            touch_points: navigator.maxTouchPoints,
            geo: geolocationRef.current,
          },
          deviceFingerprint: {
            visitor_id: fingerprintId,
            fingerprint_id: fingerprintId,
            screen_resolution: `${globalThis.screen.width}x${globalThis.screen.height}x${globalThis.screen.colorDepth}`,
            language: navigator.language,
            cpu_cores: navigator.hardwareConcurrency || 0,
            touch_points: navigator.maxTouchPoints,
            platform: navigator.platform,
            plugins_count: navigator.plugins?.length || 0,
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No fue posible enviar la firma.');
      setScreen('success');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'No fue posible enviar la firma.');
      setScreen('draw');
    }
  }, [geolocationStatus, token]);

  const darkLine = '#475569';
  const thicknesses: Array<{ size: StrokeSize; width: number; label: string }> = [
    { size: 'thin', width: 1, label: 'Delgado' },
    { size: 'medium', width: 2.5, label: 'Medio' },
    { size: 'thick', width: 5, label: 'Grueso' },
  ];

  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-7 text-slate-900 landscape:h-dvh landscape:min-h-0 landscape:overflow-hidden landscape:px-3 landscape:py-3">
      <div className="mx-auto w-full max-w-lg landscape:flex landscape:h-full landscape:max-w-3xl landscape:flex-col">
        <AppLogo className="mb-6 justify-center landscape:mb-1.5" imageClassName="h-auto" />
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm landscape:flex landscape:min-h-0 landscape:flex-1 landscape:flex-col">
          {screen === 'loading' && (
            <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-500"><Loader2 className="animate-spin" size={18} /> Abriendo firma segura…</div>
          )}
          {screen === 'error' && (
            <div className="p-6 text-center"><p className="text-base font-semibold">Enlace no disponible</p><p className="mt-2 text-sm text-slate-500">{error}</p></div>
          )}
          {screen === 'success' && (
            <div className="p-8 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><Check size={28} /></div>
              <h1 className="mt-4 text-lg font-semibold">Firma enviada</h1>
              <p className="mt-2 text-sm leading-6 text-slate-500">Regresa a tu equipo para continuar con la validación de la firma.</p>
              <p className="mt-3 text-sm font-medium text-slate-700">Esta página se cerrará en {secondsUntilClose} segundos.</p>
              <button type="button" onClick={closePage} className="mx-auto mt-5 inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"><X size={15} /> Cerrar ahora</button>
            </div>
          )}
          {(screen === 'draw' || screen === 'sending') && (
            <div className="landscape:flex landscape:min-h-0 landscape:flex-1 landscape:flex-col">
              <header className="border-b border-slate-200 bg-slate-50 px-4 py-3 landscape:px-3 landscape:py-2">
                <div className="flex items-center justify-between gap-2"><div className="flex min-w-0 items-center gap-2"><PenLine size={17} className="shrink-0 text-primary" /><h1 className="truncate text-sm font-semibold">Firma autógrafa digital</h1></div><button type="button" onClick={requestLandscape} title="Gira el teléfono para firmar en horizontal" aria-label="Gira el teléfono para firmar en horizontal" className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-600 landscape:hidden"><RotateCw size={15} /> Girar teléfono</button></div>
                <p className="mt-1 truncate pl-6 text-xs text-slate-500">{documentName}</p>
              </header>
              <div className="p-4 landscape:flex landscape:min-h-0 landscape:flex-1 landscape:flex-col landscape:p-3">
                <p className="mb-3 text-sm text-slate-600 landscape:mb-2">Dibuja tu firma en el recuadro.</p>
                {geolocationStatus !== 'ready' && (
                  <div className={`mb-3 flex items-start gap-2 rounded-md border px-3 py-2 text-xs landscape:mb-2 ${geolocationStatus === 'loading' ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
                    {geolocationStatus === 'loading' ? <Loader2 className="mt-0.5 shrink-0 animate-spin" size={14} /> : <MapPin className="mt-0.5 shrink-0" size={14} />}
                    <span>{geolocationStatus === 'loading' ? 'Verificando la ubicación requerida para firmar…' : geolocationStatus === 'denied' ? 'Debes permitir el acceso a ubicación en este teléfono y recargar la página antes de firmar.' : 'No fue posible obtener tu ubicación. Activa los servicios de ubicación, verifica tu conexión y recarga la página.'}</span>
                  </div>
                )}
                {orientationMessage && <p className="mb-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800 landscape:mb-2">{orientationMessage}</p>}
                <div className="flex flex-col gap-2 landscape:min-h-0 landscape:flex-1 landscape:flex-row">
                  <div className="relative min-w-0 w-full aspect-[2/1] overflow-hidden rounded-lg border-2 border-dashed border-slate-300 bg-white landscape:h-auto landscape:min-h-0 landscape:flex-1 landscape:aspect-auto" style={{ touchAction: 'none' }}>
                    <canvas ref={canvasRef} className="block h-full w-full cursor-crosshair" style={{ touchAction: 'none' }} />
                    {!hasStrokes && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-center text-slate-400"><div><PenLine size={28} className="mx-auto mb-1 text-slate-300" /><p className="text-xs">Dibuja tu firma aquí</p></div></div>}
                    <div className="pointer-events-none absolute bottom-10 left-6 right-6 border-b border-slate-200" />
                  </div>
                  <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-1.5 landscape:flex-col landscape:gap-1.5">
                    {thicknesses.map(({ size, width, label }) => <button key={size} type="button" title={label} onClick={() => updateStrokeSize(size)} className={`flex h-9 w-9 items-center justify-center rounded-md ${strokeSize === size ? 'border-2 border-primary bg-primary/10' : 'border border-slate-200 bg-white'}`}><svg width="22" height="22" viewBox="0 0 22 22"><line x1="3" y1="11" x2="19" y2="11" stroke={darkLine} strokeWidth={width} strokeLinecap="round" /></svg></button>)}
                    <div className="h-6 w-px bg-slate-200 landscape:h-px landscape:w-6" />
                    {['#0a0a0f', '#1d4ed8', '#dc2626'].map((color) => <button key={color} type="button" title={color === '#0a0a0f' ? 'Negro' : color === '#1d4ed8' ? 'Azul' : 'Rojo'} onClick={() => updateColor(color)} className={`h-7 w-7 self-center rounded-full ${penColor === color ? 'ring-2 ring-slate-500 ring-offset-2' : ''}`} style={{ backgroundColor: color }} />)}
                  </div>
                </div>
                {!padReady && <p className="mt-3 flex items-center gap-2 text-xs text-slate-400"><Loader2 className="animate-spin" size={13} /> Cargando pad de firma…</p>}
                {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
                <div className="mt-4 flex shrink-0 gap-2 landscape:mt-2">
                  <button type="button" onClick={clear} disabled={screen === 'sending'} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 disabled:opacity-50"><RotateCcw size={14} /> Limpiar</button>
                  <button type="button" onClick={submit} disabled={!hasStrokes || screen === 'sending' || geolocationStatus !== 'ready'} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{screen === 'sending' ? <Loader2 className="animate-spin" size={15} /> : geolocationStatus === 'loading' ? <Loader2 className="animate-spin" size={15} /> : <Check size={15} />} Confirmar firma</button>
                </div>
                <p className="mt-4 flex shrink-0 items-center justify-center gap-1.5 text-center text-xs text-slate-400 landscape:mt-2"><ShieldCheck size={13} /> Enlace temporal y de un solo uso</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
