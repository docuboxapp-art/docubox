'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface CertificateInfo {
  subject: string
  serial_number: string
  valid_from: string
  valid_until: string
  key_algorithm: string
  signature_algorithm: string
  extensions: string[]
}

type ComponentState = 'initial' | 'loading' | 'success' | 'already_exists' | 'error'

const LOADING_STEPS = [
  'Generando par de claves RSA-2048...',
  'Creando certificado X.509...',
  'Empaquetando PKCS#12...',
  'Guardando en Supabase Vault...',
]

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export default function CertificateGenerator() {
  const [state, setState] = useState<ComponentState>('initial')
  const [loadingStep, setLoadingStep] = useState(0)
  const [certificate, setCertificate] = useState<CertificateInfo | null>(null)
  const [errorMessage, setErrorMessage] = useState('')

  const supabase = createClient()

  async function handleGenerate() {
    setState('loading')
    setLoadingStep(0)

    // Animar pasos de carga
    const stepInterval = setInterval(() => {
      setLoadingStep(prev => {
        if (prev < LOADING_STEPS.length - 1) return prev + 1
        clearInterval(stepInterval)
        return prev
      })
    }, 1800)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        clearInterval(stepInterval)
        setState('error')
        setErrorMessage('No hay sesión activa. Inicia sesión para continuar.')
        return
      }

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

      // Llamar a la Edge Function con el service role key en el header
      const response = await fetch(
        `${supabaseUrl}/functions/v1/generate-docubox-cert`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceRoleKey || session.access_token}`,
          },
        }
      )

      clearInterval(stepInterval)
      setLoadingStep(LOADING_STEPS.length - 1)

      const data = await response.json()

      if (!response.ok) {
        setState('error')
        setErrorMessage(data.error ?? 'Error al comunicarse con la función de generación.')
        return
      }

      if (data.already_exists) {
        setState('already_exists')
        return
      }

      if (data.success) {
        setCertificate(data.certificate)
        setState('success')
        return
      }

      setState('error')
      setErrorMessage(data.error ?? 'Respuesta inesperada del servidor.')
    } catch (err) {
      clearInterval(stepInterval)
      setState('error')
      setErrorMessage(
        err instanceof Error ? err.message : 'Error de red al contactar la función.'
      )
    }
  }

  // ── Estado inicial ──────────────────────────────────────────────────────────
  if (state === 'initial') {
    return (
      <div
        className="rounded-xl border p-6 max-w-lg w-full"
        style={{ backgroundColor: '#0A1628', borderColor: '#1E3A5F' }}
      >
        {/* Ícono */}
        <div className="flex items-center justify-center w-14 h-14 rounded-full mb-5" style={{ backgroundColor: '#0F2040' }}>
          <svg className="w-7 h-7" style={{ color: '#1E6BFF' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>

        {/* Título */}
        <h2 className="text-lg font-semibold mb-1" style={{ color: '#F1F5F9' }}>
          Certificado de Firma Digital
        </h2>
        <p className="text-sm mb-4" style={{ color: '#64748B' }}>
          Docubox CA — RSA-2048 — X.509 v3
        </p>

        {/* Descripción */}
        <p className="text-sm mb-6 leading-relaxed" style={{ color: '#94A3B8' }}>
          Genera el certificado criptográfico que permite a DOCUBOX aplicar firmas PAdES
          reconocidas por Adobe Acrobat. Este proceso se ejecuta una sola vez.
        </p>

        {/* Botón */}
        <button
          onClick={handleGenerate}
          className="w-full py-2.5 px-4 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90"
          style={{ backgroundColor: '#1E6BFF', color: '#FFFFFF' }}
        >
          Generar Certificado
        </button>

        {/* Nota discreta */}
        <p className="text-xs mt-4 text-center" style={{ color: '#475569' }}>
          El certificado se genera y almacena directamente en Supabase Vault.
          Ningún archivo se descarga ni se guarda en dispositivos locales.
        </p>
      </div>
    )
  }

  // ── Estado cargando ─────────────────────────────────────────────────────────
  if (state === 'loading') {
    return (
      <div
        className="rounded-xl border p-6 max-w-lg w-full"
        style={{ backgroundColor: '#0A1628', borderColor: '#1E3A5F' }}
      >
        <div className="flex items-center gap-3 mb-6">
          <div
            className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin flex-shrink-0"
            style={{ borderColor: '#1E6BFF', borderTopColor: 'transparent' }}
          />
          <h2 className="text-base font-semibold" style={{ color: '#F1F5F9' }}>
            Generando certificado...
          </h2>
        </div>

        <div className="space-y-3">
          {LOADING_STEPS.map((step, index) => (
            <div key={index} className="flex items-center gap-3">
              <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                {index < loadingStep ? (
                  <svg className="w-4 h-4" style={{ color: '#10B981' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                ) : index === loadingStep ? (
                  <div
                    className="w-3 h-3 rounded-full border-2 border-t-transparent animate-spin"
                    style={{ borderColor: '#1E6BFF', borderTopColor: 'transparent' }}
                  />
                ) : (
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#1E3A5F' }} />
                )}
              </div>
              <span
                className="text-sm"
                style={{
                  color: index < loadingStep ? '#10B981' : index === loadingStep ? '#F1F5F9' : '#475569',
                }}
              >
                {step}
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── Estado éxito ────────────────────────────────────────────────────────────
  if (state === 'success' && certificate) {
    return (
      <div
        className="rounded-xl border p-6 max-w-lg w-full"
        style={{ backgroundColor: '#0A1628', borderColor: '#1E3A5F' }}
      >
        {/* Badge éxito */}
        <div
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold mb-5"
          style={{ backgroundColor: '#052E16', color: '#10B981', border: '1px solid #166534' }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          Certificado generado y almacenado
        </div>

        {/* Tabla de datos */}
        <div className="rounded-lg overflow-hidden mb-5" style={{ border: '1px solid #1E3A5F' }}>
          {[
            ['Sujeto', certificate.subject],
            ['Válido desde', formatDate(certificate.valid_from)],
            ['Válido hasta', formatDate(certificate.valid_until)],
            ['Algoritmo', `${certificate.key_algorithm} / ${certificate.signature_algorithm}`],
          ].map(([label, value], i) => (
            <div
              key={i}
              className="flex items-start gap-3 px-4 py-2.5"
              style={{ backgroundColor: i % 2 === 0 ? '#0F2040' : '#0A1628' }}
            >
              <span className="text-xs font-semibold w-28 flex-shrink-0 pt-0.5" style={{ color: '#64748B' }}>
                {label}
              </span>
              <span className="text-xs font-mono" style={{ color: '#F1F5F9' }}>
                {value}
              </span>
            </div>
          ))}
          <div className="px-4 py-2.5" style={{ backgroundColor: '#0A1628' }}>
            <span className="text-xs font-semibold block mb-1.5" style={{ color: '#64748B' }}>
              Extensiones
            </span>
            <div className="space-y-1">
              {certificate.extensions.map((ext, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-xs" style={{ color: '#10B981' }}>✓</span>
                  <span className="text-xs font-mono" style={{ color: '#94A3B8' }}>{ext}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Nota */}
        <p className="text-xs" style={{ color: '#64748B' }}>
          seal-pdf puede usar este certificado inmediatamente para firmar documentos.
        </p>
      </div>
    )
  }

  // ── Estado ya existe ────────────────────────────────────────────────────────
  if (state === 'already_exists') {
    return (
      <div
        className="rounded-xl border p-6 max-w-lg w-full"
        style={{ backgroundColor: '#0A1628', borderColor: '#1E3A5F' }}
      >
        {/* Badge azul */}
        <div
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold mb-5"
          style={{ backgroundColor: '#0F2040', color: '#1E6BFF', border: '1px solid #1E3A5F' }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
          </svg>
          Certificado activo en Vault
        </div>

        <p className="text-sm leading-relaxed" style={{ color: '#94A3B8' }}>
          Para regenerar el certificado, elimina los secrets{' '}
          <span className="font-mono text-xs px-1 py-0.5 rounded" style={{ backgroundColor: '#0F2040', color: '#F1F5F9' }}>
            DOCUBOX_P12_BASE64
          </span>{' '}
          y{' '}
          <span className="font-mono text-xs px-1 py-0.5 rounded" style={{ backgroundColor: '#0F2040', color: '#F1F5F9' }}>
            DOCUBOX_P12_PASSWORD
          </span>{' '}
          en Supabase Dashboard → Settings → Vault.
        </p>

        <button
          onClick={() => setState('initial')}
          className="mt-5 text-sm underline"
          style={{ color: '#475569' }}
        >
          Volver
        </button>
      </div>
    )
  }

  // ── Estado error ────────────────────────────────────────────────────────────
  if (state === 'error') {
    return (
      <div
        className="rounded-xl border p-6 max-w-lg w-full"
        style={{ backgroundColor: '#0A1628', borderColor: '#1E3A5F' }}
      >
        {/* Badge rojo */}
        <div
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold mb-5"
          style={{ backgroundColor: '#2D0A0A', color: '#EF4444', border: '1px solid #7F1D1D' }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          Error al generar el certificado
        </div>

        <p className="text-sm mb-5 leading-relaxed" style={{ color: '#94A3B8' }}>
          {errorMessage || 'Ocurrió un error inesperado. Intenta de nuevo.'}
        </p>

        <button
          onClick={() => setState('initial')}
          className="w-full py-2.5 px-4 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90"
          style={{ backgroundColor: '#1E6BFF', color: '#FFFFFF' }}
        >
          Reintentar
        </button>
      </div>
    )
  }

  return null
}
