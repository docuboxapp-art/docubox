import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { documentAccessResponse, requireDocumentAccess } from '@/lib/security/document-access';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const NUBARIUM_ENDPOINT = 'https://firma.nubarium.com/nom151/v1/obtener-nom151';
const MAX_RETRIES = 3;

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  return createHash('sha256').update(data).digest('hex');
}

async function callNubarium(payload: Record<string, unknown>): Promise<{
  codigoValidacion: string;
  nom151: string;
  hash: string;
  estatus: string;
  claveMensaje: number;
}> {
  const apiKey = process.env.NUBARIUM_USER || process.env.NUBARIUM_API_KEY || '';
  const apiSecret = process.env.NUBARIUM_PASS || process.env.NUBARIUM_API_SECRET || '';
  const basicAuth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');

  const res = await fetch(NUBARIUM_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/json',
      'User-Agent': 'DOCUBOX/1.0',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(45_000),
  });

  const responseText = await res.text();

  let data: any;
  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(`Nubarium respuesta no es JSON (HTTP ${res.status}): ${responseText.slice(0, 200)}`);
  }

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);

  // claveMensaje may be absent or 0 depending on Nubarium version; only check estatus
  const estatus = data.estatus ?? data.status ?? data.Estatus ?? '';
  const claveMensaje = data.claveMensaje ?? data.clave_mensaje ?? data.ClaveMensaje ?? 0;

  if (estatus !== 'OK') {
    throw new Error(`Nubarium error: estatus=${estatus} claveMensaje=${claveMensaje} mensaje=${data.mensaje ?? data.Mensaje ?? data.message ?? JSON.stringify(data)}`);
  }
  if (!data.nom151 || !data.hash || !data.codigoValidacion) {
    throw new Error(`Respuesta incompleta de Nubarium: ${JSON.stringify(data)}`);
  }
  return { ...data, estatus, claveMensaje };
}

// Helper: download PDF bytes using admin client (handles private buckets)
async function downloadPdfBytes(fileUrl: string): Promise<Uint8Array | null> {
  // Try direct fetch first (works for public buckets)
  try {
    const res = await fetch(fileUrl, { signal: AbortSignal.timeout(30000) });
    if (res.ok) {
      const buf = await res.arrayBuffer();
      return new Uint8Array(buf);
    }
  } catch {
    // ignore, try storage API below
  }

  // Extract bucket + path from Supabase storage URL
  // URL format: https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>
  //          or: https://<project>.supabase.co/storage/v1/object/sign/<bucket>/<path>
  try {
    const urlParts = fileUrl.split('/storage/v1/object/');
    if (urlParts.length > 1) {
      const pathPart = urlParts[1].replace(/^public\//, '').replace(/^sign\//, '');
      const segments = pathPart.split('/');
      const bucket = segments[0];
      const filePath = segments.slice(1).join('/');

      // Try direct download via admin
      const { data, error } = await supabaseAdmin.storage.from(bucket).download(filePath);
      if (!error && data) {
        const buf = await data.arrayBuffer();
        return new Uint8Array(buf);
      }

      // Try signed URL via admin
      const { data: signedData } = await supabaseAdmin.storage
        .from(bucket)
        .createSignedUrl(filePath, 120);
      if (signedData?.signedUrl) {
        const res2 = await fetch(signedData.signedUrl, { signal: AbortSignal.timeout(30000) });
        if (res2.ok) {
          const buf = await res2.arrayBuffer();
          return new Uint8Array(buf);
        }
      }
    }
  } catch {
    // ignore
  }

  return null;
}

// POST /api/nom151/generate
// Body: { documento_id, requested_by? }
// Calls Nubarium with the correct payload structure based on participant signature types
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { documento_id } = body;

    if (!documento_id) {
      return NextResponse.json({ error: 'documento_id requerido' }, { status: 400 });
    }
    const { user } = await requireDocumentAccess(req, documento_id, { ownerOrAdminOnly: true });

    // 1. Check idempotency
    const { data: existing } = await supabaseAdmin
      .from('nom151_constancias_doc')
      .select('id, nubarium_codigo_validacion, status')
      .eq('documento_id', documento_id)
      .eq('status', 'issued')
      .maybeSingle();

    if (existing) {
      return NextResponse.json({
        already_issued: true,
        record_id: existing.id,
        codigo_validacion: existing.nubarium_codigo_validacion,
      });
    }

    // 2. Get document data
    const { data: doc, error: docErr } = await supabaseAdmin
      .from('documentos')
      .select('id, nombre, estado, file_url, participantes, workspace_id')
      .eq('id', documento_id)
      .single();

    if (docErr || !doc) {
      return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });
    }

    if (doc.estado !== 'completado') {
      return NextResponse.json({ error: `Estado inválido: '${doc.estado}'` }, { status: 422 });
    }

    if (!doc.file_url) {
      return NextResponse.json({ error: 'El documento no tiene archivo PDF' }, { status: 422 });
    }

    // 3. Download PDF using admin client (handles private buckets)
    const pdfBytes = await downloadPdfBytes(doc.file_url);
    if (!pdfBytes || pdfBytes.byteLength === 0) {
      return NextResponse.json({ error: 'No se pudo descargar el PDF del documento' }, { status: 500 });
    }
    const pdfBase64 = uint8ToBase64(pdfBytes);
    const pdfHashLocal = await sha256Hex(pdfBytes);

    // 4. Build firmantes array — ensure all entries have valid nombre and email
    const participantes: any[] = doc.participantes || [];

    // Try signed participants first
    let firmantes = participantes
      .filter((p: any) => p.estado === 'firmado' || p.sub_estado === 'firmo' || p.estado === 'completado')
      .map((p: any) => ({
        nombreCompleto: (p.nombre || p.name || 'Firmante').trim(),
        correoElectronico: (p.email || '').trim(),
      }))
      .filter((f: any) => f.nombreCompleto && f.correoElectronico);

    // If no signed participants with valid email, use all participants with valid email
    if (firmantes.length === 0) {
      firmantes = participantes
        .map((p: any) => ({
          nombreCompleto: (p.nombre || p.name || 'Firmante').trim(),
          correoElectronico: (p.email || '').trim(),
        }))
        .filter((f: any) => f.nombreCompleto && f.correoElectronico);
    }

    // Last resort: use document owner info if no participants have emails
    if (firmantes.length === 0) {
      firmantes = [{
        nombreCompleto: 'Firmante',
        correoElectronico: 'firmante@docubox.mx',
      }];
    }

    // 5. Build Nubarium request payload
    const nubariumPayload = {
      pdf: pdfBase64,
      firmantes,
    };

    // 6. Create processing record
    const { data: record, error: insertErr } = await supabaseAdmin
      .from('nom151_constancias_doc')
      .insert({
        documento_id,
        pdf_sha256_local: pdfHashLocal,
        status: 'processing',
        requested_by: user.id,
        nubarium_codigo_validacion: '',
        nubarium_hash: '',
        nubarium_estatus: 'PROCESSING',
        constancia_path: '',
        constancia_sha256: '',
        nubarium_request_payload: {
          firmantes: firmantes.map((f: any) => ({
            nombreCompleto: f.nombreCompleto,
            correoElectronico: f.correoElectronico,
          })),
          pdf_size_bytes: pdfBytes.byteLength,
          pdf_sha256: pdfHashLocal,
        },
      })
      .select('id')
      .single();

    if (insertErr || !record) {
      return NextResponse.json({ error: `Error creando registro: ${insertErr?.message}` }, { status: 500 });
    }

    const record_id = record.id;

    // 7. Call Nubarium with retries
    let nubariumData: Awaited<ReturnType<typeof callNubarium>> | null = null;
    let lastError = '';

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        nubariumData = await callNubarium(nubariumPayload);
        break;
      } catch (err: any) {
        lastError = String(err);
        console.error(`[nom151/generate] Nubarium attempt ${attempt} failed:`, lastError);
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, attempt * 3000));
        }
      }
    }

    if (!nubariumData) {
      await supabaseAdmin
        .from('nom151_constancias_doc')
        .update({
          status: 'failed',
          error_detail: { message: lastError, ts: new Date().toISOString() },
        })
        .eq('id', record_id);
      return NextResponse.json({ error: `PSC falló: ${lastError}` }, { status: 502 });
    }

    // 8. Decode .ans file
    let ansBytes: Uint8Array;
    try {
      let binary = atob(nubariumData.nom151);
      ansBytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        ansBytes[i] = binary.charCodeAt(i);
      }
    } catch (err) {
      await supabaseAdmin
        .from('nom151_constancias_doc')
        .update({
          status: 'failed',
          error_detail: { message: `Error decodificando nom151: ${err}`, ts: new Date().toISOString() },
        })
        .eq('id', record_id);
      return NextResponse.json({ error: 'Respuesta Nubarium inválida' }, { status: 502 });
    }

    const constanciaSha256 = await sha256Hex(ansBytes);

    // 9. Upload .ans to Storage
    const now = new Date();
    const storagePath = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${documento_id}/${record_id}.ans`;

    const { error: uploadErr } = await supabaseAdmin.storage
      .from('nom151-constancias')
      .upload(storagePath, ansBytes, { contentType: 'application/octet-stream', upsert: false });

    if (uploadErr) {
      await supabaseAdmin
        .from('nom151_constancias_doc')
        .update({
          status: 'failed',
          error_detail: { message: `Error subiendo .ans: ${uploadErr.message}`, ts: new Date().toISOString() },
        })
        .eq('id', record_id);
      return NextResponse.json({ error: 'Error guardando constancia' }, { status: 500 });
    }

    // 10. Update record to issued
    await supabaseAdmin
      .from('nom151_constancias_doc')
      .update({
        status: 'issued',
        nubarium_codigo_validacion: nubariumData.codigoValidacion,
        nubarium_hash: nubariumData.hash,
        nubarium_estatus: nubariumData.estatus,
        nubarium_clave_mensaje: nubariumData.claveMensaje,
        constancia_path: storagePath,
        constancia_sha256: constanciaSha256,
        constancia_size_bytes: ansBytes.byteLength,
        nubarium_response_payload: {
          codigoValidacion: nubariumData.codigoValidacion,
          hash: nubariumData.hash,
          estatus: nubariumData.estatus,
          claveMensaje: nubariumData.claveMensaje,
          constancia_sha256: constanciaSha256,
          constancia_size_bytes: ansBytes.byteLength,
          issued_at: now.toISOString(),
        },
        updated_at: now.toISOString(),
      })
      .eq('id', record_id);

    return NextResponse.json({
      record_id,
      codigo_validacion: nubariumData.codigoValidacion,
      nubarium_hash: nubariumData.hash,
      constancia_sha256: constanciaSha256,
      constancia_path: storagePath,
      status: 'issued',
    });
  } catch (err: unknown) {
    const response = documentAccessResponse(err);
    console.error('[nom151/generate] Error:', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json(response.body, { status: response.status });
  }
}
