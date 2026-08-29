import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

interface NubariumResponse {
  codigoValidacion: string;
  nom151: string;
  hash: string;
  estatus: string;
  claveMensaje: number;
}

interface GenerateRequest {
  document_id: string;
  requested_by?: string;
}

const NUBARIUM_ENDPOINT = "https://firma.nubarium.com/nom151/v1/obtener-nom151";
const STORAGE_BUCKET    = "nom151-constancias";
const MAX_RETRIES       = 3;

serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader !== `Bearer ${Deno.env.get("INTERNAL_API_TOKEN")}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: GenerateRequest;
  try { body = await req.json(); }
  catch { return json({ error: "Body inválido" }, 400); }

  const { document_id, requested_by } = body;
  if (!document_id) return json({ error: "document_id requerido" }, 400);

  // 1. Verificar documento
  const { data: doc, error: docErr } = await sb
    .from("documents")
    .select("id, status, storage_path")
    .eq("id", document_id)
    .single();

  if (docErr || !doc) return json({ error: "Documento no encontrado" }, 404);
  if (doc.status !== "completado") {
    return json({ error: `Estado inválido: '${doc.status}'` }, 422);
  }

  if (!doc.storage_path) {
    return json({ error: "El documento no tiene archivo PDF almacenado" }, 422);
  }

  // 2. Idempotencia
  const { data: existing } = await sb
    .from("nom151_constancias")
    .select("id, nubarium_codigo_validacion")
    .eq("document_id", document_id)
    .eq("status", "issued")
    .maybeSingle();

  if (existing) {
    return json({
      already_issued: true,
      record_id: existing.id,
      codigo_validacion: existing.nubarium_codigo_validacion,
    }, 200);
  }

  // 3. Descargar PDF desde bucket documentos-firmados
  const { data: fileData, error: dlErr } = await sb.storage
    .from("documentos-firmados")
    .download(doc.storage_path);

  if (dlErr || !fileData) {
    // Fallback: intentar desde bucket 'documents'
    const { data: fileData2, error: dlErr2 } = await sb.storage
      .from("documents")
      .download(doc.storage_path);

    if (dlErr2 || !fileData2) {
      return json({ error: `Error descargando PDF: ${dlErr?.message ?? dlErr2?.message}` }, 500);
    }

    const pdfBytes2      = new Uint8Array(await fileData2.arrayBuffer());
    const pdfBase64_2    = uint8ToBase64(pdfBytes2);
    const pdfHashLocal2  = await sha256Hex(pdfBytes2);
    return await processNom151(sb, document_id, requested_by, pdfBase64_2, pdfHashLocal2);
  }

  const pdfBytes      = new Uint8Array(await fileData.arrayBuffer());
  const pdfBase64     = uint8ToBase64(pdfBytes);
  const pdfHashLocal  = await sha256Hex(pdfBytes);

  return await processNom151(sb, document_id, requested_by, pdfBase64, pdfHashLocal);
});

async function processNom151(
  sb: ReturnType<typeof createClient>,
  document_id: string,
  requested_by: string | undefined,
  pdfBase64: string,
  pdfHashLocal: string,
): Promise<Response> {
  // 4. Crear registro processing
  const { data: record, error: insertErr } = await sb
    .from("nom151_constancias")
    .insert({
      document_id,
      pdf_sha256_local:           pdfHashLocal,
      status:                     "processing",
      requested_by:               requested_by ?? null,
      nubarium_codigo_validacion: `PENDING-${document_id.slice(0, 8)}`,
      nubarium_hash:              "PENDING",
      nubarium_estatus:           "PROCESSING",
      constancia_path:            "PENDING",
      constancia_sha256:          "PENDING",
    })
    .select("id")
    .single();

  if (insertErr || !record) {
    return json({ error: `Error creando registro: ${insertErr?.message}` }, 500);
  }

  const record_id = record.id;

  // 5. Llamar Nubarium con retry
  let nubariumData: NubariumResponse | null = null;
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      nubariumData = await callNubarium(pdfBase64);
      break;
    } catch (err) {
      lastError = String(err);
      if (attempt < MAX_RETRIES) await sleep(attempt * 5_000);
    }
  }

  if (!nubariumData) {
    await markFailed(sb, record_id, lastError);
    return json({ error: `PSC falló: ${lastError}` }, 502);
  }

  // 6. Decodificar la evidencia ASN.1 devuelta por el PSC.
  let ansBytes: Uint8Array;
  try { ansBytes = base64ToUint8(nubariumData.nom151); }
  catch (err) {
    await markFailed(sb, record_id, `Error decodificando nom151: ${err}`);
    return json({ error: "Respuesta Nubarium inválida" }, 502);
  }

  const constanciaSha256 = await sha256Hex(ansBytes);

  // 7. Subir la evidencia ASN.1 a Storage privado.
  const now         = new Date();
  const storagePath = `${now.getUTCFullYear()}/${String(now.getUTCMonth()+1).padStart(2,"0")}/${document_id}/${record_id}.asn1`;

  const { error: uploadErr } = await sb.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, ansBytes, { contentType: "application/octet-stream", upsert: false });

  if (uploadErr) {
    await markFailed(sb, record_id, `Error subiendo .asn1: ${uploadErr.message}`);
    return json({ error: "Error guardando constancia" }, 500);
  }

  // 8. Actualizar registro a issued
  await sb.from("nom151_constancias").update({
    status:                     "issued",
    nubarium_codigo_validacion: nubariumData.codigoValidacion,
    nubarium_hash:              nubariumData.hash,
    nubarium_estatus:           nubariumData.estatus,
    nubarium_clave_mensaje:     nubariumData.claveMensaje,
    constancia_path:            storagePath,
    constancia_sha256:          constanciaSha256,
    constancia_size_bytes:      ansBytes.byteLength,
    updated_at:                 now.toISOString(),
  }).eq("id", record_id);

  // 9. Audit trail
  await sb.from("document_audit_trail").insert({
    document_id,
    action:   "nom151_constancia_issued",
    actor_id: requested_by ?? null,
    metadata: {
      codigo_validacion: nubariumData.codigoValidacion,
      nubarium_hash:     nubariumData.hash,
      constancia_sha256: constanciaSha256,
      validation_url:    "https://validatuconstancia.pscworld.com/",
    },
  });

  return json({
    record_id,
    codigo_validacion: nubariumData.codigoValidacion,
    nubarium_hash:     nubariumData.hash,
    constancia_sha256: constanciaSha256,
    constancia_path:   storagePath,
    status:            "issued",
    validation_url:    "https://validatuconstancia.pscworld.com/",
  });
}

async function callNubarium(pdfBase64: string): Promise<NubariumResponse> {
  const apiKey    = Deno.env.get("NUBARIUM_USER") ?? Deno.env.get("NUBARIUM_API_KEY") ?? "";
  const apiSecret = Deno.env.get("NUBARIUM_PASS") ?? Deno.env.get("NUBARIUM_API_SECRET") ?? "";
  const basicAuth = btoa(`${apiKey}:${apiSecret}`);
  const res = await fetch(NUBARIUM_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basicAuth}`,
      "Content-Type":  "application/json",
      "User-Agent":    "DOCUBOX/1.0",
    },
    body: JSON.stringify({ pdf: pdfBase64 }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);
  if (data.estatus !== "OK" || data.claveMensaje !== 0)
    throw new Error(`Nubarium error: estatus=${data.estatus} claveMensaje=${data.claveMensaje}`);
  if (!data.nom151 || !data.hash || !data.codigoValidacion)
    throw new Error(`Respuesta incompleta: ${JSON.stringify(data)}`);
  return data as NubariumResponse;
}

async function markFailed(sb: ReturnType<typeof createClient>, record_id: string, msg: string) {
  await sb.from("nom151_constancias").update({
    status:       "failed",
    error_detail: { message: msg, ts: new Date().toISOString() },
    updated_at:   new Date().toISOString(),
  }).eq("id", record_id);
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  let binary = atob(b64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
