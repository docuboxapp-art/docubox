// DOCUBOX - VisualSealRenderer
// Genera una constancia visual con pdf-lib. Esta funcion no aplica una firma
// criptografica PDF, un certificado X.509 ni una estampa RFC 3161.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PDFDocument, rgb, StandardFonts } from 'https://esm.sh/pdf-lib@1.17.1';
import { userCanAccessDocument } from '../_shared/document-access.ts';
import { corsHeaders, isAllowedOrigin } from '../_shared/cors.ts';

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

function resolveAuthorizedStoragePath(
  document: { storage_path?: string | null; file_url?: string | null },
  supabaseUrl: string,
) {
  const directPath = String(document.storage_path || '').trim().replace(/^\/+/, '');
  if (directPath && !directPath.includes('..')) return directPath;

  const rawUrl = String(document.file_url || '').trim();
  if (!rawUrl) return null;
  if (!/^https?:\/\//i.test(rawUrl)) {
    const path = rawUrl.replace(/^\/+/, '');
    return path && !path.includes('..') ? path : null;
  }

  try {
    const source = new URL(rawUrl);
    if (source.origin !== new URL(supabaseUrl).origin) return null;
    const marker = [
      '/storage/v1/object/sign/documents/',
      '/storage/v1/object/authenticated/documents/',
      '/storage/v1/object/public/documents/',
    ].find((candidate) => source.pathname.includes(candidate));
    if (!marker) return null;
    const path = decodeURIComponent(source.pathname.slice(source.pathname.indexOf(marker) + marker.length))
      .replace(/^\/+/, '');
    return path && !path.includes('..') ? path : null;
  } catch {
    return null;
  }
}

// ── Utilidades ────────────────────────────────────────────────────────────────

async function sha256Hex(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

function generateFolio(): string {
  const ts = Date.now().toString(36).toUpperCase()
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase()
  return `DCB-${ts}-${rand}`
}

function formatDateMX(date: Date): string {
  const d = date.getDate().toString().padStart(2, '0')
  const m = (date.getMonth() + 1).toString().padStart(2, '0')
  let y = date.getFullYear()
  const h = date.getHours().toString().padStart(2, '0')
  const min = date.getMinutes().toString().padStart(2, '0')
  const s = date.getSeconds().toString().padStart(2, '0')
  return `${d}/${m}/${y} ${h}:${min}:${s} UTC-6`
}

// ── Generación de constancia visual ──────────────────────────────────────────

async function addSealPage(params: {
  pdfDoc: PDFDocument
  folio: string
  originalHash: string
  sealedHash: string
  signerName: string
  signerEmail: string
  reason: string
  location: string
  ipAddress: string
  geolocation: string
  signedAt: Date
  participants?: Array<{ nombre: string; email: string; metodo_firma?: string; estado?: string; fecha_firma?: string; rolDocumento?: string }>
  camposCount?: number
}): Promise<void> {
  const {
    pdfDoc, folio, originalHash, sealedHash,
    signerName, signerEmail, reason, location,
    ipAddress, geolocation, signedAt,
    participants = [],
    camposCount = 0,
  } = params

  const page = pdfDoc.addPage([612, 792])
  const { width, height } = page.getSize()

  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const courier = await pdfDoc.embedFont(StandardFonts.Courier)

  // Colores
  const colorPrimary = rgb(0.118, 0.420, 1.0)       // #1E6BFF
  const colorDark = rgb(0.039, 0.086, 0.157)         // #0A1628
  const colorSuccess = rgb(0.063, 0.725, 0.506)      // #10B981
  const colorGray = rgb(0.420, 0.447, 0.502)         // #6B7280
  const colorText = rgb(0.216, 0.255, 0.318)         // #374151
  const colorLight = rgb(0.973, 0.980, 0.988)        // #F8FAFC
  const colorWhite = rgb(1, 1, 1)

  let y = height - 30

  // ── Encabezado ──────────────────────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: height - 60, width, height: 60, color: colorDark })
  page.drawText('DOCUBOX', {
    x: 30, y: height - 38,
    size: 18, font: helveticaBold, color: colorWhite,
  })
  page.drawText('Constancia de Firma Electrónica', {
    x: 30, y: height - 54,
    size: 9, font: helvetica, color: rgb(0.757, 0.816, 0.882),
  })
  page.drawText(`Folio: ${folio}`, {
    x: width - 200, y: height - 38,
    size: 9, font: courier, color: colorWhite,
  })
  page.drawText(formatDateMX(signedAt), {
    x: width - 200, y: height - 54,
    size: 8, font: courier, color: rgb(0.757, 0.816, 0.882),
  })

  y = height - 80

  // ── Datos del firmante principal ─────────────────────────────────────────────
  page.drawText('DATOS DEL FIRMANTE PRINCIPAL', {
    x: 30, y, size: 9, font: helveticaBold, color: colorPrimary,
  })
  y -= 16

  const firmante = [
    ['Nombre', signerName],
    ['Correo electrónico', signerEmail],
    ['Razón de firma', reason],
    ['Ubicación', location],
    ['IP del firmante', ipAddress],
    ['Geolocalización', geolocation || 'No disponible'],
    ['Fecha y hora', formatDateMX(signedAt)],
    ['Campos insertados', camposCount > 0 ? `${camposCount} campo(s) en el documento` : 'Sin campos adicionales'],
  ]

  for (const [label, value] of firmante) {
    page.drawText(`${label}:`, { x: 30, y, size: 8, font: helveticaBold, color: colorText })
    page.drawText(value, { x: 200, y, size: 8, font: helvetica, color: colorText })
    y -= 14
  }

  y -= 10

  // ── Participantes del proceso ────────────────────────────────────────────────
  if (participants.length > 0) {
    page.drawText('PARTICIPANTES DEL PROCESO DE FIRMA', {
      x: 30, y, size: 9, font: helveticaBold, color: colorPrimary,
    })
    y -= 16

    for (const p of participants.slice(0, 8)) { // max 8 participants on page
      const estadoLabel = (p.estado === 'firmado' || p.estado === 'completado') ? '✓ Firmado' : (p.estado || 'Pendiente')
      const metodo = p.metodo_firma || 'Firma Autógrafa Digital'
      page.drawText(`${p.nombre || 'Participante'}:`, { x: 30, y, size: 8, font: helveticaBold, color: colorText })
      page.drawText(`${p.email || ''} — ${metodo} — ${estadoLabel}`, { x: 180, y, size: 7.5, font: helvetica, color: colorText, maxWidth: width - 210 })
      y -= 13
    }

    y -= 8
  }

  // ── Integridad criptográfica ─────────────────────────────────────────────────
  page.drawText('INTEGRIDAD Y VERIFICACIÓN', {
    x: 30, y, size: 9, font: helveticaBold, color: colorPrimary,
  })
  y -= 16

  const integridad = [
    ['Hash SHA-256 documento original', originalHash],
    ['Hash SHA-256 documento firmado', sealedHash],
    ['Folio único DOCUBOX', folio],
    ['Fecha y hora del sello', formatDateMX(signedAt)],
    ['IP del firmante', ipAddress],
    ['Geolocalización', geolocation || 'No disponible'],
  ]

  for (const [label, value] of integridad) {
    page.drawText(`${label}:`, { x: 30, y, size: 8, font: helveticaBold, color: colorText })
    const isHash = value.length === 64
    page.drawText(value, {
      x: 220, y,
      size: isHash ? 7 : 8,
      font: isHash ? courier : helvetica,
      color: colorText,
      maxWidth: width - 250,
    })
    y -= 14
  }

  y -= 10

  // Registro visual e integridad
  page.drawRectangle({ x: 27, y: y - 130, width: width - 54, height: 140, color: colorLight })
  page.drawRectangle({ x: 27, y: y - 130, width: 3, height: 140, color: colorPrimary })

  page.drawText('CONSTANCIA VISUAL DE FIRMA E INTEGRIDAD', {
    x: 38, y: y - 4, size: 9, font: helveticaBold, color: colorPrimary,
  })
  y -= 18

  const certData = [
    ['Generado por', 'Docubox VisualSealRenderer'],
    ['Tipo de evidencia', 'Constancia visual'],
    ['Algoritmo de integridad', 'SHA-256'],
    ['Firma PDF criptográfica', 'No aplicada'],
    ['Certificado institucional', 'No configurado'],
    ['Estampa RFC 3161', 'No aplicada'],
    ['Nivel técnico', 'Sello visual'],
    ['Referencia legal', 'Código de Comercio Arts. 89-97'],
  ]

  for (const [label, value] of certData) {
    page.drawText(`${label}:`, { x: 38, y, size: 8, font: helveticaBold, color: colorText })
    page.drawText(value, { x: 200, y, size: 8, font: courier, color: colorText })
    y -= 13
  }

  y -= 20

  // ── Fundamento legal ─────────────────────────────────────────────────────────
  const legalText =
    'Esta página documenta datos visibles del proceso de firma y la huella SHA-256 calculada por Docubox. ' +
    'La huella permite detectar cambios posteriores al archivo registrado. Esta constancia visual no contiene ' +
    'por sí sola una firma PDF PAdES, un certificado X.509 ni una estampa de tiempo RFC 3161.'

  // Dividir en líneas de ~100 chars
  const words = legalText.split(' ')
  const lines: string[] = []
  let currentLine = ''
  for (const word of words) {
    if ((currentLine + ' ' + word).length > 100) {
      lines.push(currentLine.trim())
      currentLine = word
    } else {
      currentLine += ' ' + word
    }
  }
  if (currentLine) lines.push(currentLine.trim())

  for (const line of lines) {
    if (y > 40) {
      page.drawText(line, { x: 30, y, size: 7.5, font: helvetica, color: colorGray, maxWidth: width - 60 })
      y -= 12
    }
  }

  // ── Pie de página ────────────────────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: 0, width, height: 30, color: colorDark })
  page.drawText('DOCUBOX — Plataforma de Firma Electrónica Avanzada — México', {
    x: 30, y: 10, size: 7, font: helvetica, color: rgb(0.757, 0.816, 0.882),
  })
  page.drawText(`Folio: ${folio}`, {
    x: width - 150, y: 10, size: 7, font: courier, color: rgb(0.757, 0.816, 0.882),
  })
}

// ── Handler principal ─────────────────────────────────────────────────────────

serve(async (req) => {
  const requestCorsHeaders = corsHeaders(req)
  if (req.method === 'OPTIONS') {
    return isAllowedOrigin(req.headers.get('Origin'))
      ? new Response('ok', { headers: requestCorsHeaders })
      : new Response('Origin not allowed', { status: 403 })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const authHeader = req.headers.get('Authorization')
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader?.replace('Bearer ', '') || ''
    )
    if (authError || !user) {
      return new Response('Unauthorized', { status: 401, headers: requestCorsHeaders })
    }

    const body = await req.json()
    const {
      document_id,
      signer_name,
      signer_email,
      reason = 'Firma electrónica',
      location = 'México',
      ip_address = 'No disponible',
      geolocation = '',
      workspace_id,
      file_url: ignoredClientFileUrl,
      participants = [],
      campos_solicitados = [],
    } = body

    if (!await userCanAccessDocument(supabase, user, document_id, { ownerOrAdminOnly: true })) {
      return new Response('Forbidden', { status: 403, headers: requestCorsHeaders })
    }

    console.log('[seal-pdf] ▶ Inicio del proceso', {
      document_id,
      signer_email,
      signer_name,
      reason,
      location,
      ip_address,
      geolocation: geolocation || '(vacío)',
      workspace_id: workspace_id || '(sin workspace)',
      participants_count: participants.length,
      campos_count: campos_solicitados.length,
      timestamp: new Date().toISOString(),
    })

    if (!document_id || !signer_name || !signer_email) {
      console.warn('[seal-pdf] ✗ Campos requeridos faltantes', { document_id, signer_name, signer_email })
      return new Response(
        JSON.stringify({ error: 'Faltan campos requeridos: document_id, signer_name, signer_email' }),
        { status: 400, headers: { ...requestCorsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: sourceDocument, error: sourceDocumentError } = await supabase
      .from('documentos')
      .select('id,workspace_id,storage_path,file_url,sealed_pdf_path')
      .eq('id', document_id)
      .maybeSingle()
    if (sourceDocumentError || !sourceDocument) {
      return new Response('Documento no encontrado', { status: 404, headers: requestCorsHeaders })
    }
    if (workspace_id && sourceDocument.workspace_id && workspace_id !== sourceDocument.workspace_id) {
      return new Response('Workspace no coincide con el documento', { status: 403, headers: requestCorsHeaders })
    }

    // Only document-scoped additional metadata travels with the sealed PDF.
    // Management metadata remains intentionally outside of the signed artifact.
    const { data: documentScopedMetadata, error: documentScopedMetadataError } = await supabase
      .from('document_additional_metadata')
      .select('name,value_display')
      .eq('document_id', document_id)
      .eq('metadata_scope', 'document')
      .order('created_at', { ascending: true })
    if (documentScopedMetadataError) {
      console.warn('[seal-pdf] No fue posible leer metadatos documentales adicionales', { error: documentScopedMetadataError.message })
    }
    const additionalMetadataKeywords = (documentScopedMetadata || [])
      .map((metadata: { name?: string; value_display?: string }) => {
        const name = String(metadata.name || '').trim()
        const value = String(metadata.value_display || '').trim()
        return name && value ? `Docubox:${name}=${value}`.slice(0, 160) : null
      })
      .filter((value): value is string => Boolean(value))
      .slice(0, 20)

    // Never use a URL supplied by the caller in this privileged function.
    void ignoredClientFileUrl

    // ── 1. Obtener el PDF original desde Storage ──────────────────────────────
    let originalPdfBytes: Uint8Array | null = null

    const authorizedPath = resolveAuthorizedStoragePath(sourceDocument, supabaseUrl)
    if (authorizedPath) {
      const { data: sourcePdf } = await supabase.storage.from('documents').download(authorizedPath)
      if (sourcePdf) originalPdfBytes = new Uint8Array(await sourcePdf.arrayBuffer())
    }

    // Strategy 1: Use file_url passed from client (most reliable)
    /*
     * Disabled legacy fallback. `file_url` is always null because only the
     * path persisted on the authorized documento row may be downloaded.
    if (file_url) {
      console.log('[seal-pdf] [1/9] Intentando descargar PDF desde file_url', { file_url: file_url.slice(0, 80) })
      try {
        // Try direct fetch first
        const directRes = new Response(null, { status: 403 })
        throw new Error('Client supplied file URLs are not allowed')
        if (directRes.ok) {
          originalPdfBytes = new Uint8Array(await directRes.arrayBuffer())
          console.log('[seal-pdf] [1/9] ✓ PDF descargado directamente desde file_url', { sizeBytes: originalPdfBytes.length })
        }
      } catch (fetchErr) {
        console.warn('[seal-pdf] [1/9] Fetch directo falló, intentando via Storage API', { error: (fetchErr as Error).message })
      }

      // Strategy 2: Extract bucket/path from Supabase storage URL and use admin client
      if (!originalPdfBytes) {
        try {
          const urlParts = file_url.split('/storage/v1/object/')
          if (urlParts.length > 1) {
            const pathPart = urlParts[1].replace(/^public\//, '').replace(/^sign\//, '')
            const segments = pathPart.split('/')
            const bucket = segments[0]
            const filePath = segments.slice(1).join('/')
            console.log('[seal-pdf] [1/9] Intentando Storage API', { bucket, filePath })
            const { data: storageData, error: storageErr } = await supabase.storage.from(bucket).download(filePath)
            if (!storageErr && storageData) {
              originalPdfBytes = new Uint8Array(await storageData.arrayBuffer())
              console.log('[seal-pdf] [1/9] ✓ PDF descargado via Storage API', { bucket, filePath, sizeBytes: originalPdfBytes.length })
            } else {
              // Try signed URL
              const { data: signedData } = await supabase.storage.from(bucket).createSignedUrl(filePath, 120)
              if (signedData?.signedUrl) {
                const signedRes = await fetch(signedData.signedUrl, { signal: AbortSignal.timeout(30000) })
                if (signedRes.ok) {
                  originalPdfBytes = new Uint8Array(await signedRes.arrayBuffer())
                  console.log('[seal-pdf] [1/9] ✓ PDF descargado via signed URL', { sizeBytes: originalPdfBytes.length })
                }
              }
            }
          }
        } catch (storageErr) {
          console.warn('[seal-pdf] [1/9] Storage API falló', { error: (storageErr as Error).message })
        }
      }
    }

    */
    // Compatibility fallback for records created before storage_path existed.
    if (!originalPdfBytes) {
      const pathsToTry = sourceDocument.workspace_id
        ? [`${sourceDocument.workspace_id}/${document_id}/original.pdf`, `${document_id}/original.pdf`]
        : [`${document_id}/original.pdf`]

      for (const pdfPath of pathsToTry) {
        console.log('[seal-pdf] [1/9] Intentando ruta estándar', { bucket: 'documents', path: pdfPath })
        const { data: pdfData, error: storageError } = await supabase.storage.from('documents').download(pdfPath)
        if (!storageError && pdfData) {
          originalPdfBytes = new Uint8Array(await pdfData.arrayBuffer())
          console.log('[seal-pdf] [1/9] ✓ PDF descargado desde ruta estándar', { path: pdfPath, sizeBytes: originalPdfBytes.length })
          break
        }
      }
    }

    if (!originalPdfBytes || originalPdfBytes.length === 0) {
      console.error('[seal-pdf] ✗ No se pudo obtener el PDF original por ningún método')
      return new Response(
        JSON.stringify({ error: 'No se encontró el PDF original en Storage' }),
        { status: 404, headers: { ...requestCorsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const originalHash = await sha256Hex(originalPdfBytes)
    console.log('[seal-pdf] [2/9] ✓ Hash SHA-256 del documento original calculado', { originalHash })

    // ── 3. Cargar PDF con pdf-lib y agregar constancia visual ─────────────────
    const pdfDoc = await PDFDocument.load(originalPdfBytes)
    const pageCountBefore = pdfDoc.getPageCount()
    const signedAt = new Date()
    const folio = generateFolio()

    console.log('[seal-pdf] [3/9] PDF cargado con pdf-lib', {
      pageCountBefore,
      folio,
      signedAt: signedAt.toISOString(),
      formattedTimestamp: formatDateMX(signedAt),
    })

    // Metadata del PDF
    pdfDoc.setTitle(`Documento firmado — DOCUBOX — ${folio}`)
    pdfDoc.setAuthor('Docubox')
    pdfDoc.setSubject(`Firma electrónica — ${signer_name} — ${reason}`)
    pdfDoc.setCreator('DOCUBOX — Plataforma de firma electrónica')
    pdfDoc.setProducer('DOCUBOX VisualSealRenderer v1.0')
    pdfDoc.setKeywords([
      'firma electrónica',
      'DOCUBOX',
      'constancia visual',
      'SHA-256',
      'México',
      ...additionalMetadataKeywords,
    ])

    console.log('[seal-pdf] [3/9] ✓ Metadata del PDF establecida', {
      title: `Documento firmado — DOCUBOX — ${folio}`,
      author: 'Docubox',
      subject: `Firma electrónica — ${signer_name} — ${reason}`,
      creator: 'DOCUBOX — Plataforma de firma electrónica',
      producer: 'DOCUBOX VisualSealRenderer v1.0',
    })

    // Agregar página de constancia visual
    console.log('[seal-pdf] [3/9] Agregando página de constancia visual (sello visual)...', {
      signerName: signer_name,
      signerEmail: signer_email,
      reason,
      location,
      ipAddress: ip_address,
      geolocation: geolocation || '(no disponible)',
      timestampPlacement: formatDateMX(signedAt),
    })

    await addSealPage({
      pdfDoc,
      folio,
      originalHash,
      sealedHash: originalHash,
      signerName: signer_name,
      signerEmail: signer_email,
      reason,
      location,
      ipAddress: ip_address,
      geolocation,
      signedAt,
      participants,
      camposCount: campos_solicitados.length,
    })

    const pageCountAfter = pdfDoc.getPageCount()
    console.log('[seal-pdf] [3/9] ✓ Página de constancia visual agregada', {
      pageCountBefore,
      pageCountAfter,
      sealPageAdded: pageCountAfter === pageCountBefore + 1,
      sealPageIndex: pageCountAfter - 1,
      timestampOnSealPage: formatDateMX(signedAt),
      folioOnSealPage: folio,
    })

    let pdfBytes = await pdfDoc.save()
    console.log('[seal-pdf] [3/9] ✓ PDF con constancia visual serializado', { sizeBytes: pdfBytes.length })

    // Hash del PDF con constancia visual
    let sealed_hash = await sha256Hex(pdfBytes)
    console.log('[seal-pdf] [4/9] ✓ Hash SHA-256 del PDF con constancia visual', { sealedHashPreCrypto: sealed_hash })

    // Responsabilidad delimitada: el firmador criptografico PDF es un proveedor
    // separado y no forma parte de VisualSealRenderer.
    const cryptoSignatureApplied = false
    console.log('[seal-pdf] [CRYPTO] Firma criptográfica PKCS#7 omitida (incompatibilidad Deno/esm.sh)', {
      fallback: 'PDF con constancia visual + hash SHA-256 entregado',
      note: 'CryptographicPdfSigner no fue invocado por esta funcion',
    })

    // ── 5. Hash final sobre el PDF ya firmado ─────────────────────────────────
    const finalHashBuffer = await crypto.subtle.digest('SHA-256', pdfBytes)
    sealed_hash = Array.from(new Uint8Array(finalHashBuffer))
      .map(b => b.toString(16).padStart(2, '0')).join('')

    console.log('[seal-pdf] [5/9] ✓ Hash SHA-256 final del PDF sellado calculado', {
      sealed_hash,
      cryptoSignatureApplied,
      finalPdfSizeBytes: pdfBytes.length,
    })

    // ── 6. Guardar PDF sellado en Storage ─────────────────────────────────────
    const sealedPath = sourceDocument.workspace_id
      ? `${sourceDocument.workspace_id}/${document_id}/sealed.pdf`
      : `${document_id}/sealed.pdf`

    const { data: existingSealedPdf } = await supabase.storage
      .from('documents-signed')
      .download(sealedPath)
    if (existingSealedPdf) {
      return new Response(
        JSON.stringify({ error: 'El PDF sellado ya existe y es inmutable.', code: 'SEALED_PDF_EXISTS' }),
        { status: 409, headers: { ...requestCorsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    console.log('[seal-pdf] [6/9] Guardando PDF sellado en Storage', {
      bucket: 'documents-signed',
      path: sealedPath,
      sizeBytes: pdfBytes.length,
    })

    const { error: uploadError } = await supabase.storage
      .from('documents-signed')
      .upload(sealedPath, pdfBytes, {
        contentType: 'application/pdf',
        upsert: false,
      })

    if (uploadError) {
      console.error('[seal-pdf] [6/9] ✗ Error al guardar PDF sellado en Storage', {
        bucket: 'documents-signed',
        path: sealedPath,
        error: uploadError,
      })
    } else {
      console.log('[seal-pdf] [6/9] ✓ PDF sellado guardado en Storage', {
        bucket: 'documents-signed',
        path: sealedPath,
      })
      // Update documentos.sealed_pdf_path so future downloads skip re-generation
      const { error: docUpdateError } = await supabase
        .from('documentos')
        .update({ sealed_pdf_path: sealedPath })
        .eq('id', document_id)
        .is('sealed_pdf_path', null)
      if (docUpdateError) {
        console.warn('[seal-pdf] [6/9] ⚠ No se pudo actualizar sealed_pdf_path en documentos', { error: docUpdateError })
      } else {
        console.log('[seal-pdf] [6/9] ✓ documentos.sealed_pdf_path actualizado', { sealedPath })
      }
    }

    // ── 7. Registrar en document_signature_seals ──────────────────────────────
    console.log('[seal-pdf] [7/9] Registrando sello en document_signature_seals...', {
      document_id,
      signer_email,
      folio,
      original_hash: originalHash,
      sealed_hash,
      crypto_signature_applied: cryptoSignatureApplied,
    })

    const { error: sealError } = await supabase
      .from('document_signature_seals')
      .upsert({
        document_id,
        signer_email,
        signer_name,
        folio,
        original_hash: originalHash,
        sealed_hash,
        reason,
        location,
        ip_address,
        geolocation,
        sealed_at: signedAt.toISOString(),
        crypto_signature_applied: cryptoSignatureApplied,
        signature_subfilter: null,
        certificate_cn: null,
        certificate_org: null,
        certificate_country: null,
      }, { onConflict: 'document_id,signer_email' })

    if (sealError) {
      console.error('[seal-pdf] [7/9] ✗ Error al registrar en document_signature_seals', { error: sealError })
    } else {
      console.log('[seal-pdf] [7/9] ✓ Sello registrado en document_signature_seals', { folio, document_id })
    }

    // ── 8. Registrar en document_audit_trail ──────────────────────────────────
    console.log('[seal-pdf] [8/9] Registrando en document_audit_trail...', {
      action: 'SEAL_PDF_APPLIED',
      actor_email: signer_email,
      folio,
    })

    const { error: auditError } = await supabase.from('document_audit_trail').insert({
      document_id,
      action: 'SEAL_PDF_APPLIED',
      actor_email: signer_email,
      metadata: {
        folio,
        original_hash: originalHash,
        sealed_hash,
        reason,
        location,
        ip_address,
        crypto_signature_applied: cryptoSignatureApplied,
        signature_subfilter: null,
        certificate: null,
      },
    })

    if (auditError) {
      console.error('[seal-pdf] [8/9] ✗ Error al registrar en document_audit_trail', { error: auditError })
    } else {
      console.log('[seal-pdf] [8/9] ✓ Evento registrado en document_audit_trail')
    }

    // ── 9. Retornar PDF firmado ────────────────────────────────────────────────
    console.log('[seal-pdf] [9/9] ✓ Proceso completado — enviando PDF al cliente', {
      document_id,
      folio,
      originalHash,
      sealedHash: sealed_hash,
      cryptoSignatureApplied,
      sealPageAdded: true,
      timestampApplied: formatDateMX(signedAt),
      finalPdfSizeBytes: pdfBytes.length,
    })

    // Return raw PDF bytes — Content-Type must be application/pdf (never JSON)
    // so the client can validate the response is a real PDF
    return new Response(pdfBytes, {
      status: 200,
      headers: {
        ...requestCorsHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="DOCUBOX_${document_id}_constancia_visual.pdf"`,
        'X-Folio': folio,
        'X-Original-Hash': originalHash,
        'X-Sealed-Hash': sealed_hash,
        'X-Crypto-Signature': 'visual-only',
        'X-Signature-Level': 'Visual-Seal',
        'X-Certificate': 'not-configured',
        'X-Sealed-Path': sealedPath,
      },
    })

  } catch (error) {
    console.error('[seal-pdf] ✗ Error interno no controlado', {
      error: (error as Error).message,
      stack: (error as Error).stack,
    })
    // Always return non-200 status for errors so client can detect them via !sealRes.ok
    return new Response(
      JSON.stringify({ error: 'Error interno al procesar el documento', details: (error as Error).message }),
      { status: 500, headers: { ...requestCorsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
