// DOCUBOX — AcrobatSignatureBadge
// Componente informativo que aparece después de que seal-pdf procesó el documento,
// explicando al usuario cómo verificar la firma en Adobe Acrobat Reader.

import React from 'react';

interface AcrobatSignatureBadgeProps {
  cryptoSignatureApplied: boolean
  signerName: string
  signedAt: string // ISO8601
}

function formatDateMX(isoDate: string): string {
  try {
    const d = new Date(isoDate)
    const day = d.getDate().toString().padStart(2, '0')
    const month = (d.getMonth() + 1).toString().padStart(2, '0')
    const year = d.getFullYear()
    return `${day}/${month}/${year}`
  } catch {
    return isoDate
  }
}

export default function AcrobatSignatureBadge({
  cryptoSignatureApplied,
  signerName,
  signedAt,
}: AcrobatSignatureBadgeProps) {
  if (cryptoSignatureApplied) {
    return (
      <div
        style={{ borderLeft: '3px solid #10B981' }}
        className="bg-green-50 rounded-lg p-4"
      >
        {/* Encabezado */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-green-600 text-lg font-bold">✓</span>
          <h3 className="text-green-800 font-semibold text-sm">
            Firma verificable en Adobe Acrobat
          </h3>
        </div>

        {/* Descripción */}
        <p className="text-green-700 text-sm mb-3">
          Este documento contiene firma criptográfica PAdES. Para verificarla en Adobe Acrobat Reader:
        </p>

        {/* Pasos */}
        <ol className="space-y-2 mb-3">
          {[
            'Abrir el PDF en Adobe Acrobat Reader',
            'Clic en el panel "Firmas" (lado derecho)',
            `Ver la firma de ${signerName} — ${formatDateMX(signedAt)}`,
            'Clic en la firma para ver certificado Docubox CA y confirmación de integridad del documento',
          ].map((step, index) => (
            <li key={index} className="flex items-start gap-2 text-sm text-green-700">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-green-600 text-white text-xs flex items-center justify-center font-semibold mt-0.5">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>

        {/* Nota */}
        <p className="text-xs text-gray-500 border-t border-green-200 pt-2 mt-2">
          Acrobat mostrará advertencia de certificado no reconocido — la firma criptográfica es válida.
          La validación automática se activará con el certificado GlobalSign AATL.
        </p>
      </div>
    )
  }

  // Estado: sin firma criptográfica — solo constancia documental
  return (
    <div
      style={{ borderLeft: '3px solid #F59E0B' }}
      className="bg-amber-50 rounded-lg p-4"
    >
      {/* Encabezado */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-amber-500 text-lg">📄</span>
        <h3 className="text-amber-800 font-semibold text-sm">
          Firma con constancia documental
        </h3>
      </div>

      {/* Descripción */}
      <p className="text-amber-700 text-sm">
        El documento incluye constancia con hash SHA-256 y folio único con plena validez jurídica.
      </p>
    </div>
  )
}
