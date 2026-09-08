'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2, PenLine, RotateCcw, ShieldCheck } from 'lucide-react';
import { useParams } from 'next/navigation';

type StrokeSize = 'thin' | 'medium' | 'thick';

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
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.floor(rect.width * ratio);
      canvas.height = Math.floor(rect.height * ratio);
      canvas.getContext('2d')?.scale(ratio, ratio);
      pad = new SignaturePad(canvas, { minWidth: 0.4, maxWidth: 1.2, penColor, throttle: 16 });
      pad.addEventListener('beginStroke', () => setHasStrokes(true));
      padRef.current = pad;
      setPadReady(true);
    };
    initialise();
    return () => pad?.off();
  }, [screen]);

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
            geo: null,
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
  }, [token]);

  const darkLine = '#475569';
  const thicknesses: Array<{ size: StrokeSize; width: number; label: string }> = [
    { size: 'thin', width: 1, label: 'Delgado' },
    { size: 'medium', width: 2.5, label: 'Medio' },
    { size: 'thick', width: 5, label: 'Grueso' },
  ];

  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-7 text-slate-900">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-6 flex items-center justify-center gap-2 text-xl font-semibold tracking-normal text-slate-900">
          <span className="h-6 w-1 rounded-sm bg-primary" /> Docubox
        </div>
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
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
            </div>
          )}
          {(screen === 'draw' || screen === 'sending') && (
            <>
              <header className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-center gap-2"><PenLine size={17} className="text-primary" /><h1 className="text-sm font-semibold">Firma autógrafa digital</h1></div>
                <p className="mt-1 truncate pl-6 text-xs text-slate-500">{documentName}</p>
              </header>
              <div className="p-4">
                <p className="mb-3 text-sm text-slate-600">Dibuja tu firma en el recuadro.</p>
                <div className="flex gap-2">
                  <div className="relative min-w-0 flex-1 overflow-hidden rounded-lg border-2 border-dashed border-slate-300 bg-white" style={{ touchAction: 'none' }}>
                    <canvas ref={canvasRef} className="block w-full cursor-crosshair" style={{ height: '260px', touchAction: 'none' }} />
                    {!hasStrokes && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-center text-slate-400"><div><PenLine size={28} className="mx-auto mb-1 text-slate-300" /><p className="text-xs">Dibuja tu firma aquí</p></div></div>}
                    <div className="pointer-events-none absolute bottom-10 left-6 right-6 border-b border-slate-200" />
                  </div>
                  <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-1.5">
                    {thicknesses.map(({ size, width, label }) => <button key={size} type="button" title={label} onClick={() => updateStrokeSize(size)} className={`flex h-9 w-9 items-center justify-center rounded-md ${strokeSize === size ? 'border-2 border-primary bg-primary/10' : 'border border-slate-200 bg-white'}`}><svg width="22" height="22" viewBox="0 0 22 22"><line x1="3" y1="11" x2="19" y2="11" stroke={darkLine} strokeWidth={width} strokeLinecap="round" /></svg></button>)}
                    <div className="my-0.5 h-px bg-slate-200" />
                    {['#0a0a0f', '#1d4ed8', '#dc2626'].map((color) => <button key={color} type="button" title={color === '#0a0a0f' ? 'Negro' : color === '#1d4ed8' ? 'Azul' : 'Rojo'} onClick={() => updateColor(color)} className={`h-7 w-7 self-center rounded-full ${penColor === color ? 'ring-2 ring-slate-500 ring-offset-2' : ''}`} style={{ backgroundColor: color }} />)}
                  </div>
                </div>
                {!padReady && <p className="mt-3 flex items-center gap-2 text-xs text-slate-400"><Loader2 className="animate-spin" size={13} /> Cargando pad de firma…</p>}
                {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
                <div className="mt-4 flex gap-2">
                  <button type="button" onClick={clear} disabled={screen === 'sending'} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 disabled:opacity-50"><RotateCcw size={14} /> Limpiar</button>
                  <button type="button" onClick={submit} disabled={!hasStrokes || screen === 'sending'} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{screen === 'sending' ? <Loader2 className="animate-spin" size={15} /> : <Check size={15} />} Confirmar firma</button>
                </div>
                <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-slate-400"><ShieldCheck size={13} /> Enlace temporal y de un solo uso</p>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
