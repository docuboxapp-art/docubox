'use client';

import React, { useEffect, useRef } from 'react';
import { BottomNotice } from '@/components/ui/BottomNotice';

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

  return <BottomNotice message="Ubicación no disponible — continuamos con ubicación aproximada por IP" tone="warning" onClose={onCerrar} />;
}
