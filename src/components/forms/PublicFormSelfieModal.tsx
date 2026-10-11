'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Camera, Check, Loader2, RefreshCw, X } from 'lucide-react';

export default function PublicFormSelfieModal({
  busy,
  error,
  onClose,
  onCapture,
}: {
  busy: boolean;
  error: string;
  onClose: () => void;
  onCapture: (selfie: string) => Promise<void>;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [photo, setPhoto] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraReady(false);
  }, []);

  const startCamera = useCallback(async () => {
    stopCamera();
    setCameraError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraReady(true);
      }
    } catch {
      setCameraError('No se pudo abrir la cámara. Revisa los permisos e inténtalo de nuevo.');
    }
  }, [stopCamera]);

  useEffect(() => {
    void startCamera();
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [startCamera]);

  const capture = () => {
    const video = videoRef.current;
    if (!video?.videoWidth || !video.videoHeight) return;
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(video.videoWidth, 960);
    canvas.height = Math.round(video.videoHeight * canvas.width / video.videoWidth);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.translate(canvas.width, 0);
    context.scale(-1, 1);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    setPhoto(canvas.toDataURL('image/jpeg', 0.82));
    stopCamera();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-3 sm:p-5">
      <section role="dialog" aria-modal="true" aria-labelledby="selfie-title" className="max-h-full w-full max-w-md overflow-y-auto rounded-xl bg-white p-5 shadow-xl sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="selfie-title" className="text-lg font-semibold text-slate-950">Prueba de vida</h2>
            <p className="mt-1 text-sm leading-5 text-slate-600">Centra tu rostro dentro del óvalo y toma una foto en tiempo real.</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Cerrar captura" className="rounded-md p-1 text-slate-500 disabled:opacity-50"><X size={19} /></button>
        </div>
        <div className="relative mt-5 aspect-[3/4] max-h-[52vh] overflow-hidden rounded-lg bg-slate-950">
          <video ref={videoRef} autoPlay playsInline muted className={`h-full w-full scale-x-[-1] object-cover ${photo ? 'invisible' : ''}`} />
          {photo && <Image src={photo} alt="Selfie capturada" fill unoptimized className="object-cover" />}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="aspect-[3/4] w-[72%] rounded-[50%] border-[3px] border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
          </div>
          {!cameraReady && !photo && !cameraError && <div className="absolute inset-0 flex items-center justify-center bg-black/50"><Loader2 size={25} className="animate-spin text-white" /></div>}
        </div>
        {cameraError && <p role="alert" className="mt-3 text-sm text-red-600">{cameraError}</p>}
        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
        {photo ? (
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" disabled={busy} onClick={() => { setPhoto(''); void startCamera(); }} className="flex items-center justify-center gap-2 rounded-md border border-slate-200 px-3 py-2.5 text-sm disabled:opacity-50"><RefreshCw size={15} /> Repetir</button>
            <button type="button" disabled={busy} onClick={() => void onCapture(photo)} className="flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2.5 text-sm font-medium text-white disabled:opacity-50">{busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Usar foto</button>
          </div>
        ) : (
          <button type="button" disabled={!cameraReady || busy} onClick={capture} className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"><Camera size={16} /> Capturar selfie</button>
        )}
        {cameraError && <button type="button" onClick={() => void startCamera()} className="mt-3 w-full text-sm text-primary">Reintentar cámara</button>}
      </section>
    </div>
  );
}
