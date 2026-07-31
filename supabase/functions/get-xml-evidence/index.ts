import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── 1. Extract JWT from Authorization header ──────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const jwt = authHeader.replace("Bearer ", "").trim();

    // ── 2. Extract document_id from query params ──────────────────────────────
    const url = new URL(req.url);
    const document_id = url.searchParams.get("document_id");
    if (!document_id) {
      return new Response(
        JSON.stringify({ error: "Missing required parameter: document_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 3. Create user-scoped client to validate JWT ──────────────────────────
    const supabaseUrl = (globalThis as any).Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = (globalThis as any).Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = (globalThis as any).Deno.env.get("SUPABASE_ANON_KEY")!;

    // Validate JWT and get user identity
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired JWT" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = user.id;

    // ── 4. Service-role client for privileged operations ──────────────────────
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // ── 5. Fetch document and verify ownership / participation ────────────────
    const { data: doc, error: docError } = await adminClient
      .from("documents")
      .select("id, workspace_id, xml_evidencia_path, status, created_by")
      .eq("id", document_id)
      .single();

    if (docError || !doc) {
      return new Response(
        JSON.stringify({ error: "Document not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if XML has been generated
    if (!doc.xml_evidencia_path) {
      return new Response(
        JSON.stringify({ error: "XML evidence not yet generated for this document" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 6. Authorization check: owner OR participant ──────────────────────────
    let isAuthorized = false;

    // Check if user is the document owner
    if (doc.created_by === userId) {
      isAuthorized = true;
    }

    // Check if user is a workspace member (owner/admin)
    if (!isAuthorized) {
      const { data: workspaceMember } = await adminClient
        .from("workspace_members")
        .select("id")
        .eq("workspace_id", doc.workspace_id)
        .eq("user_id", userId)
        .maybeSingle();

      if (workspaceMember) {
        isAuthorized = true;
      }
    }

    // Check if user is a document signer/participant
    if (!isAuthorized) {
      const { data: signer } = await adminClient
        .from("document_signers")
        .select("id")
        .eq("document_id", document_id)
        .eq("user_id", userId)
        .maybeSingle();

      if (signer) {
        isAuthorized = true;
      }
    }

    // Also check unregistered participants linked by email
    if (!isAuthorized) {
      const userEmail = user.email;
      if (userEmail) {
        const { data: unregisteredParticipant } = await adminClient
          .from("document_signers")
          .select("id")
          .eq("document_id", document_id)
          .eq("email", userEmail)
          .maybeSingle();

        if (unregisteredParticipant) {
          isAuthorized = true;
        }
      }
    }

    if (!isAuthorized) {
      return new Response(
        JSON.stringify({ error: "Access denied: you are not the owner or a participant of this document" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 7. Retrieve XML from Storage using service role ───────────────────────
    const bucket = (globalThis as any).Deno.env.get("STORAGE_BUCKET_EVIDENCIA") ?? "documentos-evidencia";

    const { data: fileData, error: storageError } = await adminClient.storage
      .from(bucket)
      .download(doc.xml_evidencia_path);

    if (storageError || !fileData) {
      console.error("Storage error:", storageError);
      return new Response(
        JSON.stringify({ error: "Failed to retrieve XML evidence file from storage" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 8. Log access in audit trail ──────────────────────────────────────────
    await adminClient.from("document_audit_trail").insert({
      document_id,
      tipo_evento: "XML_EVIDENCE_DOWNLOADED",
      actor: userId,
      metadata: {
        user_email: user.email,
        xml_path: doc.xml_evidencia_path,
        ip: req.headers.get("x-forwarded-for") ?? "unknown",
      },
    });

    // ── 9. Derive filename for Content-Disposition ────────────────────────────
    const filename = `evidencia_${document_id}.xml`;

    // ── 10. Stream XML back to caller ─────────────────────────────────────────
    const xmlBytes = await fileData.arrayBuffer();

    return new Response(xmlBytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("get-xml-evidence error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
