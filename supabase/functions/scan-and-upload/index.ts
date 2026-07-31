import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import { analyzePdfMetadata } from "../_shared/analyzePdfMetadata.ts";

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const METADEFENDER_API_KEY = Deno.env.get("METADEFENDER_API_KEY") ?? "";
const MAX_FILE_SIZE_MB = parseInt(Deno.env.get("MAX_FILE_SIZE_MB") ?? "50", 10);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── CAPA 1: Validación MIME por magic bytes ──────────────────────────────────

function validateMimeType(buffer: Uint8Array): string | null {
  const b = buffer;
  // PDF: %PDF
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) {
    return "application/pdf";
  }
  // DOCX / XLSX (ZIP internamente)
  if (b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04) {
    return "application/vnd.openxmlformats";
  }
  // PNG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) {
    return "image/png";
  }
  // JPG
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) {
    return "image/jpeg";
  }
  return null;
}

// ─── CAPA 2: Sanitización PDF con pdf-lib ─────────────────────────────────────

async function sanitizePDF(buffer: Uint8Array, mimeType: string): Promise<Uint8Array> {
  if (mimeType !== "application/pdf") {
    return buffer;
  }
  const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const catalog = pdfDoc.context.lookup(pdfDoc.context.trailerInfo.Root) as any;
  if (catalog) {
    // Eliminar JavaScript
    try { catalog.delete("JavaScript"); } catch { /* ignore */ }
    try { catalog.delete("JS"); } catch { /* ignore */ }
    // Eliminar OpenAction
    try { catalog.delete("OpenAction"); } catch { /* ignore */ }
    // Eliminar AA (Additional Actions)
    try { catalog.delete("AA"); } catch { /* ignore */ }
  }
  // Limpiar metadata
  pdfDoc.setTitle("");
  pdfDoc.setAuthor("");
  pdfDoc.setSubject("");
  pdfDoc.setKeywords([]);
  pdfDoc.setProducer("");
  pdfDoc.setCreator("");
  return await pdfDoc.save();
}

// ─── Retry helper ─────────────────────────────────────────────────────────────

async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
  const delays = [1000, 2000, 4000];
  let lastError: Error = new Error("Unknown error");
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url, options);
      return res;
    } catch (err) {
      lastError = err as Error;
      if (i < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, delays[i]));
      }
    }
  }
  throw lastError;
}

// ─── CAPA 3: MetaDefender Cloud ───────────────────────────────────────────────

async function scanWithMetadefender(
  buffer: Uint8Array,
  filename: string
): Promise<{ clean: boolean; threat?: string; sha256: string }> {
  // Paso 3.1 — Calcular SHA-256
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const sha256 = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Paso 3.2 — Consultar por hash primero
  try {
    const hashRes = await fetchWithRetry(
      `https://api.metadefender.com/v4/hash/${sha256}`,
      { headers: { apikey: METADEFENDER_API_KEY } }
    );
    if (hashRes.status === 200) {
      const hashData = await hashRes.json();
      if (hashData?.scan_results?.scan_details) {
        const details = hashData.scan_results.scan_details;
        for (const engine of Object.values(details) as any[]) {
          if (engine?.threat_found && engine.threat_found !== "") {
            return { clean: false, threat: engine.threat_found, sha256 };
          }
        }
        return { clean: true, sha256 };
      }
    }
    // 404 = hash desconocido, continuar con upload
  } catch {
    // Si falla la consulta por hash, continuar con upload directo
  }

  // Paso 3.3 — Subir archivo para análisis
  const uploadRes = await fetchWithRetry(
    "https://api.metadefender.com/v4/file",
    {
      method: "POST",
      headers: {
        apikey: METADEFENDER_API_KEY,
        filename: filename,
        "Content-Type": "application/octet-stream",
      },
      body: buffer,
    }
  );
  const uploadData = await uploadRes.json();
  const dataId: string = uploadData.data_id;
  if (!dataId) {
    throw new Error("No se obtuvo data_id de MetaDefender");
  }

  // Paso 3.4 — Polling del resultado
  let scanData: any = null;
  for (let attempt = 0; attempt < 15; attempt++) {
    await new Promise((r) => setTimeout(r, 2000));
    const pollRes = await fetchWithRetry(
      `https://api.metadefender.com/v4/file/${dataId}`,
      { headers: { apikey: METADEFENDER_API_KEY } }
    );
    scanData = await pollRes.json();
    if (scanData?.process_info?.progress_percentage === 100) {
      break;
    }
    if (attempt === 14) {
      throw new Error("TIMEOUT");
    }
  }

  // Paso 3.5 — Evaluar resultado
  if (scanData?.scan_results?.scan_details) {
    const details = scanData.scan_results.scan_details;
    for (const engine of Object.values(details) as any[]) {
      if (engine?.threat_found && engine.threat_found !== "") {
        return { clean: false, threat: engine.threat_found, sha256 };
      }
    }
  }
  return { clean: true, sha256 };
}

// ─── Función principal ────────────────────────────────────────────────────────

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // 1. Verificar método POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Método no permitido" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 2. Verificar Authorization header
  const authHeader = req.headers.get("Authorization");
  const token = authHeader?.replace("Bearer ", "");
  if (!token) {
    return new Response(JSON.stringify({ error: "No autorizado" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 3. Verificar usuario válido
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "No autorizado" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 4. Leer FormData
  let file: File;
  let workspaceId: string;
  let documentId: string;
  try {
    const formData = await req.formData();
    file = formData.get("file") as File;
    workspaceId = formData.get("workspace_id") as string;
    documentId = formData.get("document_id") as string;
    if (!file || !workspaceId || !documentId) {
      return new Response(JSON.stringify({ error: "Faltan campos requeridos" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch {
    return new Response(JSON.stringify({ error: "Error al leer el formulario" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 5. Leer buffer del archivo
  const buffer = new Uint8Array(await file.arrayBuffer());

  // Helper para registrar bloqueos en audit_trail
  const registerBlock = async (code: string, mimeDetected: string | null) => {
    try {
      await supabaseAdmin.from("document_audit_trail").insert({
        document_id: documentId,
        event_type: "upload_blocked",
        event_data: {
          reason: code,
          filename: file.name,
          mime_detected: mimeDetected,
        },
        created_at: new Date().toISOString(),
      });
    } catch { /* ignorar errores de auditoría */ }
  };

  // 6. CAPA 1 — Validación MIME
  const maxBytes = MAX_FILE_SIZE_MB * 1024 * 1024;
  if (buffer.length > maxBytes) {
    await registerBlock("archivo_muy_grande", null);
    return new Response(
      JSON.stringify({ error: "El archivo supera el límite permitido", code: "archivo_muy_grande" }),
      { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const mimeType = validateMimeType(buffer);
  if (!mimeType) {
    await registerBlock("tipo_no_permitido", null);
    return new Response(
      JSON.stringify({ error: "Tipo de archivo no permitido", code: "tipo_no_permitido" }),
      { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // 7. CAPA 2 — Sanitización PDF
  let sanitizedBuffer: Uint8Array;
  try {
    sanitizedBuffer = await sanitizePDF(buffer, mimeType);
  } catch {
    await registerBlock("pdf_invalido", mimeType);
    return new Response(
      JSON.stringify({ error: "El PDF es inválido o está dañado", code: "pdf_invalido" }),
      { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // 8. CAPA 3 — MetaDefender
  let resultado: { clean: boolean; threat?: string; sha256: string };
  try {
    resultado = await scanWithMetadefender(sanitizedBuffer, file.name);
  } catch (err: any) {
    if (err?.message === "TIMEOUT") {
      await registerBlock("timeout_escaneo", mimeType);
      return new Response(
        JSON.stringify({ error: "Tiempo de escaneo agotado", code: "timeout_escaneo" }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    await registerBlock("servicio_no_disponible", mimeType);
    return new Response(
      JSON.stringify({ error: "Servicio de escaneo no disponible", code: "servicio_no_disponible" }),
      { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!resultado.clean) {
    await registerBlock("infected", mimeType);
    return new Response(
      JSON.stringify({
        error: "Documento bloqueado por seguridad",
        code: "infected",
        threat: resultado.threat,
      }),
      { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // 9. Pasó las 3 capas — subir a Storage
  const path = `${workspaceId}/${documentId}/${file.name}`;

  const { error: storageError } = await supabaseAdmin.storage
    .from("documents")
    .upload(path, sanitizedBuffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (storageError) {
    return new Response(
      JSON.stringify({ error: "Error al guardar el archivo", code: "storage_error", detail: storageError.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Actualizar tabla documents con resultado del escaneo
  await supabaseAdmin
    .from("documents")
    .update({
      scan_status: "clean",
      scan_sha256: resultado.sha256,
      scan_mime: mimeType,
      scanned_at: new Date().toISOString(),
      storage_path: path,
    })
    .eq("id", documentId);

  // Registrar en document_audit_trail
  await supabaseAdmin.from("document_audit_trail").insert({
    document_id: documentId,
    event_type: "upload_completed",
    event_data: {
      sha256: resultado.sha256,
      mime: mimeType,
      filename: file.name,
    },
    created_at: new Date().toISOString(),
  });

  // ─── PASO 4: Análisis de metadatos PDF (no bloqueante para el usuario) ────
  // Se ejecuta DESPUÉS del INSERT en documents y del upload a Storage.
  // Si falla, el upload ya está guardado y es válido — no se bloquea el flujo.
  if (mimeType === "application/pdf") {
    try {
      const metadata = await analyzePdfMetadata(sanitizedBuffer, documentId);

      const { error: metaError } = await supabaseAdmin
        .from("document_metadata")
        .insert(metadata);

      if (metaError) {
        console.warn(
          `[DOCUBOX][metadata] Error al guardar metadatos en BD:`,
          metaError.message
        );
      } else {
        console.log(
          `[DOCUBOX][metadata] análisis completado: ${metadata.pdf_page_count} páginas, ` +
          `nativo: ${metadata.pdf_is_native}, acroform: ${metadata.pdf_has_acroform}`
        );
      }
    } catch (metaErr) {
      // El análisis de metadatos nunca bloquea el upload
      console.warn(
        `[DOCUBOX][metadata] Error inesperado en análisis de metadatos (upload no afectado):`,
        metaErr
      );
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      document_id: documentId,
      sha256: resultado.sha256,
      storage_path: path,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
