'use client';

/**
 * PanelFirmaEjemplo
 * -----------------
 * Ejemplo de integración de useGeolocalizacion + BannerGeolocalizacion
 * dentro de un componente de firma.
 *
 * evidenciaGeo se incluye como campo JSONB en el insert a Supabase
 * en la tabla `firma_eventos`.
 *
 * NOTA: Este archivo es un ejemplo de referencia. Integra el hook y el
 * banner en el componente de firma real (page.tsx / AutographSignatureFlow.tsx)
 * según sea necesario, sin duplicar la lógica de geolocalización existente.
 */

import React, { useState } from 'react';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useGeolocalizacion } from '@/hooks/useGeolocalizacion';
import BannerGeolocalizacion from '@/components/signing/BannerGeolocalizacion';

interface PanelFirmaEjemploProps {
  documentoId: string;
  participanteId?: string;
}

export default function PanelFirmaEjemplo({
  documentoId,
  participanteId,
}: PanelFirmaEjemploProps) {
  const supabase = createClient();
  const { evidenciaGeo, bannerVisible, cerrarBanner } = useGeolocalizacion();

  const [firmando, setFirmando] = useState(false);
  const [firmado, setFirmado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFirmar = async () => {
    setFirmando(true);
    setError(null);

    try {
      const { error: insertError } = await supabase
        .from('firma_eventos')
        .insert({
          documento_id: documentoId,
          participante_id: participanteId ?? null,
          tipo_evento: 'firma_completada',
          // evidenciaGeo serializa null correctamente (no undefined)
          evidencia_geo: evidenciaGeo,
          metadata: {
            timestamp_firma: new Date().toISOString(),
          },
        });

      if (insertError) throw insertError;

      setFirmado(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al registrar la firma';
      setError(msg);
    } finally {
      setFirmando(false);
    }
  };

  return (
    <>
      {/* Banner no bloqueante — aparece solo cuando fallback_activado === true */}
      <BannerGeolocalizacion visible={bannerVisible} onCerrar={cerrarBanner} />

      <div className="flex flex-col items-center gap-6 p-8 rounded-xl border border-slate-200 bg-white shadow-sm max-w-md mx-auto">
        <h2 className="text-lg font-semibold text-slate-800">Firmar Documento</h2>

        {/* Estado de geolocalización (solo informativo) */}
        <div className="w-full rounded-lg bg-slate-50 border border-slate-100 px-4 py-3 text-xs text-slate-500 space-y-1">
          <p>
            <span className="font-medium">Estado geo:</span>{' '}
            {evidenciaGeo.estado}
          </p>
          {evidenciaGeo.coordenadas.latitud !== null && (
            <p>
              <span className="font-medium">Coordenadas:</span>{' '}
              {evidenciaGeo.coordenadas.latitud.toFixed(6)},{' '}
              {evidenciaGeo.coordenadas.longitud?.toFixed(6)}
            </p>
          )}
          {evidenciaGeo.fallback_activado && (
            <p className="text-amber-600">
              Continuando con ubicación aproximada por IP
            </p>
          )}
        </div>

        {firmado ? (
          <div className="flex items-center gap-2 text-emerald-600">
            <CheckCircle2 size={20} />
            <span className="text-sm font-medium">Firma registrada correctamente</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleFirmar}
            disabled={firmando}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 transition-colors"
          >
            {firmando ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Firmando…
              </>
            ) : (
              'Firmar documento'
            )}
          </button>
        )}

        {error && (
          <p className="text-xs text-red-600 text-center">{error}</p>
        )}
      </div>
    </>
  );
}
