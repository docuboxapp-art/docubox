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
            Firma pendiente de verificación independiente
          </h3>
        </div>

        {/* Descripción */}
        <p className="text-green-700 text-sm mb-3">
          El proveedor reportó un archivo procesado. Docubox no lo presenta como
          PAdES válido hasta que exista verificación técnica independiente.
        </p>

        {/* Pasos */}
        <ol className="space-y-2 mb-3">
          {[
            'Conservar el PDF y su constancia asociada',
            `Revisar el registro de ${signerName} — ${formatDateMX(signedAt)}`,
            'Consultar el portal de verificación de Docubox',
            'Esperar la verificación independiente antes de afirmar PAdES o certificado',
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
          La presencia de una apariencia visual o de una respuesta de proveedor
          no confirma PAdES, cadena X.509 ni sellado RFC 3161.
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
        El documento incluye una constancia visual con hash SHA-256 y folio
        único. Su alcance depende de las evidencias técnicas registradas.
      </p>
    </div>
  )
}
