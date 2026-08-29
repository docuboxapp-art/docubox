// DOCUBOX — Fase de activación: esta Edge Function
// Legacy route. New integrations must use KeyManagementProvider.
import { LegacyLocalPemSigningProvider } from '../_shared/legacy-local-pem-signing-provider.ts';
import { corsHeaders, isAllowedOrigin } from '../_shared/cors.ts';
// Mientras el VPS no esté disponible retorna 503.
// seal-pdf sigue funcionando independientemente.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: {
    get: (key: string) => string | undefined;
  };
};

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function participantForUser(participants: unknown, user: { id: string; email?: string | null }) {
  if (!Array.isArray(participants)) return null;
  const email = normalizeEmail(user.email);
  return participants.find((candidate) => {
    if (!candidate || typeof candidate !== 'object') return false;
    const participant = candidate as Record<string, unknown>;
    return participant.id === user.id || (email && normalizeEmail(participant.email) === email);
  }) as Record<string, unknown> | null;
}

Deno.serve(async (req: Request) => {
  const requestCorsHeaders = corsHeaders(req);
  if (req.method === "OPTIONS") {
    return isAllowedOrigin(req.headers.get('Origin'))
      ? new Response("ok", { headers: requestCorsHeaders })
      : new Response("Origin not allowed", { status: 403 });
  }

  const VPS_SIGNING_URL = Deno.env.get("VPS_SIGNING_URL") ?? "";
  const VPS_SECRET_TOKEN = Deno.env.get("VPS_SECRET_TOKEN") ?? "";
  const legacyPemProvider = new LegacyLocalPemSigningProvider(VPS_SIGNING_URL, VPS_SECRET_TOKEN);
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SUPABASE_SERVICE_ROLE_KEY =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  // Validar JWT del usuario autenticado
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(
      JSON.stringify({ error: "No autorizado", code: "UNAUTHORIZED" }),
      {
        status: 401,
        headers: { ...requestCorsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const supabaseUser = createClient(
    SUPABASE_URL,
    Deno.env.get("SUPABASE_ANON_KEY") ?? ""
  );

  // Verificar usuario autenticado
  const {
    data: { user },
    error: authError,
  } = await supabaseUser.auth.getUser(authHeader.replace("Bearer ", ""));

  if (authError || !user) {
    return new Response(
      JSON.stringify({ error: "Token inválido", code: "INVALID_TOKEN" }),
      {
        status: 401,
        headers: { ...requestCorsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // Parsear body
  let body: {
    document_id: string;
    signer_name?: string;
    signer_email?: string;
    reason: string;
    location?: string;
    signing_session_id?: string;
    field_x?: number;
    field_y?: number;
    page_number?: number;
  };

  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Body JSON inválido" }),
      {
        status: 400,
        headers: { ...requestCorsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const {
    document_id,
    signer_name: requestedSignerName,
    signer_email: requestedSignerEmail,
    reason,
    location = "México",
    signing_session_id,
    field_x,
    field_y,
    page_number = -2,
  } = body;

  if (!document_id || !reason) {
    return new Response(
      JSON.stringify({
        error: "Campos requeridos: document_id, reason",
      }),
      {
        status: 400,
        headers: { ...requestCorsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // The signer identity is derived from the authenticated participant, never
  // from signer_name or signer_email supplied by the browser.
  const { data: docData, error: docError } = await supabase
    .from("documentos")
    .select("id, workspace_id, participantes")
    .eq("id", document_id)
    .single();

  if (docError || !docData) {
    return new Response(
      JSON.stringify({ error: "Documento no encontrado", code: "NOT_FOUND" }),
      {
        status: 404,
        headers: { ...requestCorsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const authorizedParticipant = participantForUser(docData.participantes, user);
  const signerEmail = normalizeEmail(authorizedParticipant?.email || user.email);
  const signerName = String(
    authorizedParticipant?.nombre
    || authorizedParticipant?.nombre_completo
    || authorizedParticipant?.name
    || user.user_metadata?.full_name
    || user.email
    || '',
  ).trim();
  if (!authorizedParticipant || !signerEmail || !signerName) {
    return new Response(
      JSON.stringify({
        error: "Tu cuenta no es un participante autorizado para firmar este documento",
        code: "SIGNER_NOT_AUTHORIZED",
      }),
      {
        status: 403,
        headers: { ...requestCorsHeaders, "Content-Type": "application/json" },
      }
    );
  }
  if (
    (requestedSignerEmail && normalizeEmail(requestedSignerEmail) !== signerEmail)
    || (requestedSignerName && requestedSignerName.trim() !== signerName)
  ) {
    return new Response(
      JSON.stringify({ error: "La identidad solicitada no coincide con el participante autorizado", code: "SIGNER_IDENTITY_MISMATCH" }),
      { status: 403, headers: { ...requestCorsHeaders, "Content-Type": "application/json" } },
    );
  }

  const workspace_id = docData.workspace_id;
  if (!workspace_id) {
    return new Response(
      JSON.stringify({ error: "El documento no tiene un espacio de trabajo autorizado.", code: "WORKSPACE_REQUIRED" }),
      { status: 409, headers: { ...requestCorsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Obtener el PDF sellado de Supabase Storage
  const sealedPdfPath = `${workspace_id}/${document_id}/sealed.pdf`;
  const { data: pdfData, error: storageError } = await supabase.storage
    .from("documents-signed")
    .download(sealedPdfPath);

  if (storageError || !pdfData) {
    return new Response(
      JSON.stringify({
        error: "No se encontró el PDF sellado. Ejecuta seal-pdf primero.",
        code: "SEALED_PDF_NOT_FOUND",
      }),
      {
        status: 404,
        headers: { ...requestCorsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const pdfArrayBuffer = await pdfData.arrayBuffer();
  const pdfUint8 = new Uint8Array(pdfArrayBuffer);

  // Capturar IP del request
  const ip_address =
    req.headers.get("x-forwarded-for") ||
    req.headers.get("x-real-ip") ||
    "desconocida";

  // Verificar que el VPS está configurado
  if (!legacyPemProvider.isConfigured) {
    return new Response(
      JSON.stringify({
        error:
          "Servidor de firma no configurado. Configure VPS_SIGNING_URL en los secrets de la Edge Function.",
        code: "VPS_NOT_CONFIGURED",
        vps_available: false,
      }),
      {
        status: 503,
        headers: { ...requestCorsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // Construir FormData para enviar al VPS
  const formData = new FormData();
  formData.append(
    "file",
    new Blob([pdfUint8], { type: "application/pdf" }),
    "sealed.pdf"
  );
  formData.append("document_id", document_id);
  formData.append("signer_name", signerName);
  formData.append("signer_email", signerEmail);
  formData.append("reason", reason);
  formData.append("location", location);
  formData.append("ip_address", ip_address);
  formData.append("page_number", String(page_number));

  if (field_x !== undefined) formData.append("field_x", String(field_x));
  if (field_y !== undefined) formData.append("field_y", String(field_y));
  if (signing_session_id) formData.append("signing_session_id", signing_session_id);

  // Enviar al VPS
  let vpsResponse: Response;
  try {
    vpsResponse = await legacyPemProvider.sign(formData);
  } catch (fetchError) {
    console.error("[DOCUBOX] VPS no disponible:", fetchError);
    return new Response(
      JSON.stringify({
        error:
          "El servidor de firma no está disponible en este momento. Intenta nuevamente más tarde.",
        code: "VPS_UNAVAILABLE",
        vps_available: false,
      }),
      {
        status: 503,
        headers: { ...requestCorsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  if (!vpsResponse.ok) {
    const errorText = await vpsResponse.text();
    console.error("[DOCUBOX] Error del VPS:", vpsResponse.status, errorText);
    return new Response(
      JSON.stringify({
        error: "Error al aplicar la firma criptográfica",
        code: "VPS_ERROR",
        vps_status: vpsResponse.status,
      }),
      {
        status: 502,
        headers: { ...requestCorsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // Recibir PDF firmado
  const signedPdfBuffer = await vpsResponse.arrayBuffer();

  // Extraer headers del VPS
  const signedHash = vpsResponse.headers.get("X-Signed-Hash") ?? "";
  const originalHash = vpsResponse.headers.get("X-Original-Hash") ?? "";
  const fieldName = vpsResponse.headers.get("X-Field-Name") ?? "";
  const signedAt = vpsResponse.headers.get("X-Signed-At") ?? new Date().toISOString();
  const signatureLevel = vpsResponse.headers.get("X-Signature-Level") ?? "legacy-provider-unverified";

  // Guardar PDF firmado en Supabase Storage
  const signedPdfPath = `${workspace_id}/${document_id}/signed.pdf`;
  const { data: existingSignedPdf } = await supabase.storage
    .from("documents-signed")
    .download(signedPdfPath);
  if (existingSignedPdf) {
    return new Response(
      JSON.stringify({ error: "El PDF firmado ya existe y es inmutable.", code: "SIGNED_PDF_EXISTS" }),
      { status: 409, headers: { ...requestCorsHeaders, "Content-Type": "application/json" } },
    );
  }
  const { error: uploadError } = await supabase.storage
    .from("documents-signed")
    .upload(signedPdfPath, new Uint8Array(signedPdfBuffer), {
      contentType: "application/pdf",
      upsert: false,
    });

  if (uploadError) {
    console.error("[DOCUBOX] Error al guardar PDF firmado:", uploadError);
    return new Response(
      JSON.stringify({ error: "No se pudo guardar el PDF firmado.", code: "SIGNED_PDF_STORE_FAILED" }),
      { status: 500, headers: { ...requestCorsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Actualizar tabla documents (solo si las columnas existen)
  try {
    await supabase
      .from("documents")
      .update({
        pades_signed: false,
        pades_signed_at: signedAt,
        pades_field_name: fieldName,
        pades_signed_hash: signedHash,
      })
      .eq("id", document_id);
  } catch {
    // Las columnas pades_* pueden no existir aún — no es error crítico
    console.log("[DOCUBOX] Columnas pades_* no disponibles en documents — omitiendo actualización");
  }

  // Insertar en document_audit_trail
  try {
    await supabase.from("document_audit_trail").insert({
      document_id,
      action: "LEGACY_PEM_SIGNATURE_PROCESSED",
      user_id: user.id,
      metadata: {
        signer_email: signerEmail,
        field_name: fieldName,
        signed_hash: signedHash,
        provider: legacyPemProvider.providerId,
        provider_status: legacyPemProvider.status,
        signature_level: signatureLevel,
        verification_status: "manual_review",
      },
    });
  } catch (auditError) {
    console.error("[DOCUBOX] Error al registrar en audit trail:", auditError);
  }

  // Retornar PDF firmado al frontend
  return new Response(signedPdfBuffer, {
    status: 200,
    headers: {
      ...requestCorsHeaders,
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="DOCUBOX_${document_id}.pdf"`,
      "X-Signed-Hash": signedHash,
      "X-Original-Hash": originalHash,
      "X-Field-Name": fieldName,
      "X-Signed-At": signedAt,
      "X-Signature-Level": signatureLevel,
    },
  });
});
