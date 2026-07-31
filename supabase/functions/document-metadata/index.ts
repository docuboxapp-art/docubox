import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// =============================================================================
// EDGE FUNCTION: document-metadata
// Método: GET /document-metadata/{documentId}
//
// Retorna los metadatos PDF analizados de un documento.
// Valida que el usuario autenticado sea propietario del documento.
// =============================================================================

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Solo se permite GET
  if (req.method !== "GET") {
    return new Response(
      JSON.stringify({ error: "Método no permitido" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ─── Extraer documentId de la URL ─────────────────────────────────────────
  // Patrón esperado: /document-metadata/{documentId}
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  // El último segmento de la ruta es el documentId
  const documentId = pathParts[pathParts.length - 1];

  if (!documentId || documentId === "document-metadata") {
    return new Response(
      JSON.stringify({ error: "Se requiere el parámetro documentId en la URL" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ─── Verificar Authorization header ───────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  const token = authHeader?.replace("Bearer ", "");
  if (!token) {
    return new Response(
      JSON.stringify({ error: "No autorizado" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ─── Verificar usuario autenticado ────────────────────────────────────────
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

  if (authError || !user) {
    return new Response(
      JSON.stringify({ error: "No autorizado" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ─── Verificar que el usuario es propietario del documento ────────────────
  const { data: docData, error: docError } = await supabaseAdmin
    .from("documents")
    .select("id, owner_id")
    .eq("id", documentId)
    .single();

  if (docError || !docData) {
    return new Response(
      JSON.stringify({ error: "Documento no encontrado" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (docData.owner_id !== user.id) {
    return new Response(
      JSON.stringify({ error: "No tienes acceso a este documento" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ─── Obtener metadatos del documento ──────────────────────────────────────
  const { data: metaData, error: metaError } = await supabaseAdmin
    .from("document_metadata")
    .select("*")
    .eq("document_id", documentId)
    .single();

  if (metaError || !metaData) {
    return new Response(
      JSON.stringify({
        error: "No se encontraron metadatos para este documento. Es posible que el análisis aún no se haya completado.",
      }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ─── Determinar tipo de PDF ────────────────────────────────────────────────
  // "nativo" = texto seleccionable, "escaneado" = solo imágenes, "desconocido" = null
  let tipoPdf: "nativo" | "escaneado" | "desconocido";
  if (metaData.pdf_is_native === true) {
    tipoPdf = "nativo";
  } else if (metaData.pdf_is_native === false) {
    tipoPdf = "escaneado";
  } else {
    tipoPdf = "desconocido";
  }

  // ─── Construir respuesta en el formato especificado ───────────────────────
  const response = {
    document_id: metaData.document_id,
    estructura: {
      paginas: metaData.pdf_page_count,
      tipo: tipoPdf,
      tiene_acroform: metaData.pdf_has_acroform ?? false,
      tiene_firmas_previas: metaData.pdf_has_prior_sigs ?? false,
    },
    metadatos_embebidos: {
      autor: metaData.pdf_author ?? null,
      software: metaData.pdf_creator_software ?? null,
      creado_en: metaData.pdf_created_at ?? null,
      modificado_en: metaData.pdf_modified_at ?? null,
    },
    analizado_en: metaData.analyzed_at,
    version_analisis: metaData.analysis_version,
  };

  return new Response(
    JSON.stringify(response),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
