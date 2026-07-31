'use client';

import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface BannerGeolocalizacionProps {
  visible: boolean;
  onCerrar: () => void;
}

const AUTO_CLOSE_MS = 5000; // 5 seconds

export default function BannerGeolocalizacion({
  visible,
  onCerrar,
}: BannerGeolocalizacionProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible) return;

    timerRef.current = setTimeout(() => {
      onCerrar();
    }, AUTO_CLOSE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [visible, onCerrar]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-md px-4"
    >
      <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 shadow-md">
        <p className="text-sm text-amber-800 leading-snug">
          📍 Ubicación no disponible — continuamos con ubicación aproximada por IP
        </p>
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar aviso de ubicación"
          className="flex-shrink-0 rounded p-0.5 text-amber-600 hover:bg-amber-100 hover:text-amber-800 transition-colors"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
