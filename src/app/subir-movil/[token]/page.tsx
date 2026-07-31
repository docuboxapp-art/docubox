'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Upload, CheckCircle2, AlertTriangle, FileText, X } from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';

export default function MobileUploadPage() {
  const params = useParams();
  const token = params?.token as string;

  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const inputRef = useRef<HTMLInputElement>(null);

  // Countdown timer when success screen is shown
  useEffect(() => {
    if (!success) return;
    if (countdown <= 0) {
      window.close();
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [success, countdown]);

  const handleFile = (f: File) => {
    const maxSize = 25 * 1024 * 1024; // 25MB
    if (f.size > maxSize) {
      setError('El archivo supera el límite de 25MB.');
      return;
    }
    setFile(f);
    setError(null);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFile(dropped);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) handleFile(selected);
  };

  const handleSubmit = async () => {
    if (!file || !token) return;
    setUploading(true);
    setError(null);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1];
        const res = await fetch('/api/mobile-upload/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
            fileData: base64,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          setError(data.error || 'Error al subir el archivo.');
          setUploading(false);
          return;
        }
        setSuccess(true);
        setUploading(false);
      };
      reader.onerror = () => {
        setError('Error al leer el archivo.');
        setUploading(false);
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setError(err.message || 'Error inesperado.');
      setUploading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg p-8 text-center relative">
          {/* Close button */}
          <button
            onClick={() => window.close()}
            className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition-colors"
            aria-label="Cerrar"
          >
            <X size={16} className="text-gray-500" />
          </button>

          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={32} className="text-emerald-500" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">¡Archivo enviado!</h1>
          <p className="text-sm text-gray-500 mb-6">
            Tu documento fue cargado exitosamente. Puedes cerrar esta ventana y continuar en tu computadora.
          </p>

          {/* Countdown */}
          <div className="flex flex-col items-center gap-3">
            <div className="relative w-14 h-14">
              <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
                <circle cx="28" cy="28" r="24" fill="none" stroke="#e5e7eb" strokeWidth="4" />
                <circle
                  cx="28" cy="28" r="24"
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="4"
                  strokeDasharray={`${2 * Math.PI * 24}`}
                  strokeDashoffset={`${2 * Math.PI * 24 * (1 - countdown / 3)}`}
                  strokeLinecap="round"
                  style={{ transition: 'stroke-dashoffset 1s linear' }}
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-lg font-bold text-emerald-600">
                {countdown}
              </span>
            </div>
            <p className="text-xs text-gray-400">
              Esta ventana se cerrará en {countdown} segundo{countdown !== 1 ? 's' : ''}
            </p>
            <button
              onClick={() => window.close()}
              className="mt-1 w-full bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <X size={15} />
              Cerrar ahora
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-start px-5 py-8">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex justify-center mb-6">
          <AppLogo className="h-8" />
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-6">
          <h1 className="text-lg font-bold text-gray-900 mb-1">Subir documento</h1>
          <p className="text-sm text-gray-500 mb-5">
            Selecciona un archivo PDF o DOCX desde tu dispositivo.
          </p>

          {/* Drop zone */}
          <div
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onClick={() => inputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl flex flex-col items-center justify-center py-10 px-4 cursor-pointer transition-colors mb-4 ${
              dragging ? 'border-primary bg-primary/5' : 'border-gray-300 hover:border-primary/60'
            }`}
          >
            {file ? (
              <div className="flex flex-col items-center gap-2">
                <div className="w-12 h-14 bg-blue-50 rounded-lg flex items-center justify-center">
                  <FileText size={24} className="text-primary" />
                </div>
                <p className="text-sm font-semibold text-gray-800 text-center break-all max-w-[200px]">{file.name}</p>
                <p className="text-xs text-gray-400">{(file.size / 1024).toFixed(1)} KB</p>
                <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-100 rounded-full px-3 py-1 mt-1">
                  <CheckCircle2 size={12} className="text-emerald-500" />
                  <span className="text-xs text-emerald-600 font-medium">Archivo seleccionado</span>
                </div>
              </div>
            ) : (
              <>
                <Upload size={32} className="text-gray-400 mb-3" />
                <p className="text-sm text-primary font-medium text-center">Toca para seleccionar archivo</p>
                <p className="text-xs text-gray-400 mt-1 text-center">PDF, DOCX hasta 25MB</p>
              </>
            )}
          </div>

          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={handleInputChange}
          />

          {/* Change file button if file selected */}
          {file && (
            <button
              onClick={(e) => { e.stopPropagation(); setFile(null); }}
              className="w-full flex items-center justify-center gap-2 border border-gray-200 rounded-lg py-2.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors mb-3"
            >
              <X size={14} />
              Cambiar archivo
            </button>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 mb-3">
              <AlertTriangle size={15} className="text-red-500 shrink-0 mt-0.5" />
              <p className="text-xs text-red-600">{error}</p>
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={!file || uploading}
            className="w-full bg-primary text-white rounded-xl py-3 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
          >
            {uploading ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Enviando…
              </>
            ) : (
              <>
                <Upload size={15} />
                Confirmar y enviar
              </>
            )}
          </button>
        </div>

        <p className="text-xs text-gray-400 text-center mt-4">
          Este enlace es válido por 10 minutos y solo puede usarse una vez.
        </p>
      </div>
    </div>
  );
}
