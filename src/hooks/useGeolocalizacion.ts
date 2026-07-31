'use client';

import { useState, useEffect, useRef } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type EstadoGeo =
  | 'capturado'
  | 'denegado_por_usuario' |'error_tecnico' |'timeout' |'no_disponible';

export type MetodoGeo =
  | 'browser_geolocation_api' |'denegado' |'error' |'timeout';

export interface EvidenciaGeo {
  estado: EstadoGeo;
  coordenadas: {
    latitud: number | null;
    longitud: number | null;
    precision_metros: number | null;
    timestamp_iso: string | null;
  };
  metodo: MetodoGeo;
  fallback_activado: boolean;
}

export interface UseGeolocalizacionReturn {
  evidenciaGeo: EvidenciaGeo;
  bannerVisible: boolean;
  cerrarBanner: () => void;
}

// ─── Default state ────────────────────────────────────────────────────────────

const EVIDENCIA_INICIAL: EvidenciaGeo = {
  estado: 'no_disponible',
  coordenadas: {
    latitud: null,
    longitud: null,
    precision_metros: null,
    timestamp_iso: null,
  },
  metodo: 'error',
  fallback_activado: false,
};

const TIMEOUT_MS = 8000; // 8 seconds

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGeolocalizacion(): UseGeolocalizacionReturn {
  const [evidenciaGeo, setEvidenciaGeo] = useState<EvidenciaGeo>(EVIDENCIA_INICIAL);
  const [bannerVisible, setBannerVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolvedRef = useRef(false);

  const cerrarBanner = () => setBannerVisible(false);

  const activarFallback = (estado: EstadoGeo, metodo: MetodoGeo) => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;

    setEvidenciaGeo({
      estado,
      coordenadas: {
        latitud: null,
        longitud: null,
        precision_metros: null,
        timestamp_iso: null,
      },
      metodo,
      fallback_activado: true,
    });
    setBannerVisible(true);
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Browser does not support geolocation
    if (!navigator.geolocation) {
      setEvidenciaGeo({
        estado: 'no_disponible',
        coordenadas: {
          latitud: null,
          longitud: null,
          precision_metros: null,
          timestamp_iso: null,
        },
        metodo: 'error',
        fallback_activado: true,
      });
      setBannerVisible(true);
      return;
    }

    // Set timeout — treat as denegado if no response in 8s
    timeoutRef.current = setTimeout(() => {
      activarFallback('timeout', 'timeout');
    }, TIMEOUT_MS);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (resolvedRef.current) return;
        resolvedRef.current = true;

        if (timeoutRef.current) clearTimeout(timeoutRef.current);

        setEvidenciaGeo({
          estado: 'capturado',
          coordenadas: {
            latitud: position.coords.latitude,
            longitud: position.coords.longitude,
            precision_metros: position.coords.accuracy ?? null,
            timestamp_iso: new Date(position.timestamp).toISOString(),
          },
          metodo: 'browser_geolocation_api',
          fallback_activado: false,
        });
        // No banner when successfully captured
      },
      (error) => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);

        if (error.code === error.PERMISSION_DENIED) {
          activarFallback('denegado_por_usuario', 'denegado');
        } else {
          activarFallback('error_tecnico', 'error');
        }
      },
      {
        enableHighAccuracy: true,
        timeout: TIMEOUT_MS,
        maximumAge: 0,
      }
    );

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return { evidenciaGeo, bannerVisible, cerrarBanner };
}
