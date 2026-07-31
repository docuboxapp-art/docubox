import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Workspace } from '@/contexts/WorkspaceContext';




// ─── Types ────────────────────────────────────────────────────────────────────

interface GenerateRequest {
  document_id: string;
  queue_id?: string;
}

// ─── XML escape helper ────────────────────────────────────────────────────────

function esc(val: string | null | undefined): string {
  if (!val) return "";
  return val
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ─── Crypto helpers ───────────────────────────────────────────────────────────

async function calcularHashXML(xmlString: string): Promise<string> {
  const data = new TextEncoder().encode(xmlString);
  const buffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function firmarDocubox(hashXml: string): Promise<string> {
  const signingKey = (globalThis as any).Deno?.env.get("DOCUBOX_INTERNAL_SIGNING_KEY");
  if (!signingKey) return "NO_KEY_CONFIGURED";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(hashXml)
  );
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

// ─── XML Builder ─────────────────────────────────────────────────────────────

function buildXmlTemplate(params: {
  doc: Record<string, unknown>;
  signers: Record<string, unknown>[];
  auditTrail: Record<string, unknown>[];
  conservacion: Record<string, unknown> | null;
  prevDoc: Record<string, unknown> | null;
  workspace: Record<string, unknown>;
  blockchain: Record<string, unknown> | null;
}): string {
  const { doc, signers, auditTrail, conservacion, prevDoc, workspace, blockchain } = params;

  // ── Firmantes ──────────────────────────────────────────────────────────────
  const firmantesXml = signers
    .map((signer) => {
      const sigArr = signer.document_signatures as Record<string, unknown>[] | null;
      const sig = Array.isArray(sigArr) ? sigArr[0] ?? {} : {};
      const tieneSello = !!sig.sello_tiempo_nom151_base64;
      const tieneCurp = !!signer.curp;
      const tieneHashAutografa = !!signer.hash_firma_autografa;

      return `    <Firmante orden="${esc(String(signer.orden ?? ""))}" tipo="${esc(String(signer.tipo_firma ?? ""))}">
      <RFC>${esc(String(signer.rfc ?? ""))}</RFC>
      ${tieneCurp ? `<CURP>${esc(String(signer.curp))}</CURP>` : ""}
      <NombreCompleto>${esc(String(signer.nombre_completo ?? ""))}</NombreCompleto>
      <Rol>${esc(String(signer.rol ?? ""))}</Rol>
      <NumCertificado>${esc(String(signer.num_certificado_sat ?? ""))}</NumCertificado>
      <FechaFirma>${esc(signer.fecha_firma ? new Date(signer.fecha_firma as string).toISOString() : "")}</FechaFirma>

      <Evidencia>
        <IP>${esc(String(signer.ip_address ?? ""))}</IP>
        <Geolocalizacion>
          <Pais>${esc(String(signer.pais ?? ""))}</Pais>
          <Ciudad>${esc(String(signer.ciudad ?? ""))}</Ciudad>
          <Coordenadas lat="${esc(String(signer.lat ?? ""))}" lon="${esc(String(signer.lon ?? ""))}"/>
        </Geolocalizacion>
        <Dispositivo>
          <UserAgent>${esc(String(signer.user_agent ?? ""))}</UserAgent>
          <OS>${esc(String(signer.os_detectado ?? ""))}</OS>
          <TipoDispositivo>${esc(String(signer.tipo_dispositivo ?? ""))}</TipoDispositivo>
        </Dispositivo>
        <HuellaNavegador>${esc(String(signer.huella_navegador ?? ""))}</HuellaNavegador>
        ${tieneHashAutografa ? `<HashFirmaAutografa algoritmo="SHA-256">${esc(String(signer.hash_firma_autografa))}</HashFirmaAutografa>` : ""}
      </Evidencia>

      <ds:Signature>
        <ds:SignedInfo>
          <ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>
          <ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>
          <ds:Reference URI="#${esc(String(doc.folio ?? doc.id ?? ""))}">
            <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
            <ds:DigestValue>${esc(String(doc.hash_sha256_final ?? doc.sha256_signed ?? ""))}</ds:DigestValue>
          </ds:Reference>
        </ds:SignedInfo>
        <ds:SignatureValue>${esc(String(sig.firma_xmldsig_base64 ?? ""))}</ds:SignatureValue>
        <ds:KeyInfo>
          <ds:X509Data>
            <ds:X509Certificate>${esc(String(signer.certificado_cer_base64 ?? ""))}</ds:X509Certificate>
          </ds:X509Data>
        </ds:KeyInfo>
      </ds:Signature>

      <SelloTiempo>
        ${tieneSello
          ? `<PSC>${esc(String(sig.psc_nombre ?? ""))}</PSC>
          <FolioConstancia>${esc(String(sig.psc_folio ?? ""))}</FolioConstancia>
          <Token>${esc(String(sig.sello_tiempo_nom151_base64 ?? ""))}</Token>
          <FechaUTC>${esc(sig.psc_fecha_utc ? new Date(sig.psc_fecha_utc as string).toISOString() : "")}</FechaUTC>
          <NormaAplicable>NOM-151-SCFI-2016</NormaAplicable>
          <RFC3161>true</RFC3161>`
          : `<Estado>pendiente</Estado>`}
      </SelloTiempo>
    </Firmante>`;
    })
    .join("\n");

  // ── Bitácora ───────────────────────────────────────────────────────────────
  const bitacoraXml = auditTrail
    .map((ev) => {
      const metadataAttr = ev.metadata
        ? ` metadata="${esc(JSON.stringify(ev.metadata))}"`
        : "";
      return `    <Evento timestamp="${esc(ev.created_at ? new Date(ev.created_at as string).toISOString() : "")}" tipo="${esc(String(ev.tipo_evento ?? ""))}" actor="${esc(String(ev.actor ?? "system"))}"${metadataAttr}/>`;
    })
    .join("\n");

  // ── Conservación ──────────────────────────────────────────────────────────
  const conservacionXml = conservacion
    ? `  <Conservacion>
    <NormaAplicable>NOM-151-SCFI-2016</NormaAplicable>
    <PSC>${esc(String(conservacion.psc_nombre ?? ""))}</PSC>
    <FolioConstancia>${esc(String(conservacion.psc_folio ?? ""))}</FolioConstancia>
    <SelloConservacion>${esc(String(conservacion.sello_base64 ?? ""))}</SelloConservacion>
    <FechaUTC>${esc(conservacion.fecha_utc ? new Date(conservacion.fecha_utc as string).toISOString() : "")}</FechaUTC>
    <URLVerificacion>${esc(String(conservacion.url_verificacion ?? ""))}</URLVerificacion>
  </Conservacion>`
    : `  <Conservacion>
    <Estado>pendiente</Estado>
  </Conservacion>`;

  // ── Hash encadenado ────────────────────────────────────────────────────────
  const hashEncadenado = (prevDoc?.xml_hash_sha256 as string) ?? "GENESIS";

  // ── Blockchain (opcional, solo Enterprise) ─────────────────────────────────
  const blockchainXml = blockchain
    ? `    <Blockchain>
      <IDTransaccion>${esc(String(blockchain.tx_id ?? ""))}</IDTransaccion>
      <Red>${esc(String(blockchain.red ?? ""))}</Red>
      <FechaTX>${esc(blockchain.fecha_tx ? new Date(blockchain.fecha_tx as string).toISOString() : "")}</FechaTX>
    </Blockchain>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<DocuboxEvidencia
  xmlns="https://docubox.mx/schema/v1"
  xmlns:ds="http://www.w3.org/2000/09/xmldsig#"
  version="1.0"
  schemaVersion="1.0">

  <!-- BLOQUE 1: Identidad del documento -->
  <Documento>
    <Folio>${esc(String(doc.folio ?? doc.id ?? ""))}</Folio>
    <NombreArchivo>${esc(String(doc.nombre_archivo ?? doc.title ?? ""))}</NombreArchivo>
    <HashSHA256Original algoritmo="SHA-256">${esc(String(doc.hash_sha256_original ?? doc.sha256_original ?? ""))}</HashSHA256Original>
    <HashSHA256Final algoritmo="SHA-256">${esc(String(doc.hash_sha256_final ?? doc.sha256_signed ?? ""))}</HashSHA256Final>
    <FechaCreacion>${esc(doc.created_at ? new Date(doc.created_at as string).toISOString() : "")}</FechaCreacion>
    <FechaCierre>${esc(doc.completed_at ? new Date(doc.completed_at as string).toISOString() : "")}</FechaCierre>
    <VersionEsquema>1.0</VersionEsquema>
  </Documento>

  <!-- BLOQUE 2: Firmantes -->
  <Firmantes>
${firmantesXml}
  </Firmantes>

  <!-- BLOQUE 3: Bitácora de eventos inmutables -->
  <BitacoraEventos>
${bitacoraXml}
  </BitacoraEventos>

  <!-- BLOQUE 4: Conservación NOM-151 -->
${conservacionXml}

  <!-- BLOQUE 5: Integridad del paquete -->
  <IntegridadPaquete>
    <HashXML algoritmo="SHA-256"></HashXML>
    <HashEncadenado algoritmo="SHA-256">${esc(hashEncadenado)}</HashEncadenado>
    <FirmaDocubox></FirmaDocubox>
    <AlgoritmoUsado>RSA-SHA256 + XMLDSig + NOM-151</AlgoritmoUsado>
    ${blockchainXml}
  </IntegridadPaquete>

  <!-- BLOQUE 6: Workspace -->
  <Workspace>
    <WorkspaceID>${esc(String(doc.workspace_id ?? ""))}</WorkspaceID>
    <Plan>${esc(String(workspace.plan ?? ""))}</Plan>
    <Jurisdiccion>${esc(String(workspace.pais ?? ""))}</Jurisdiccion>
    <VersionPlataforma>1.0.0</VersionPlataforma>
  </Workspace>

</DocuboxEvidencia>`;
}

// ─── Response helper ──────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const internalToken = (globalThis as any).Deno?.env.get("INTERNAL_API_TOKEN");
  if (!internalToken || authHeader !== `Bearer ${internalToken}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  const sb = createClient(
    (globalThis as any).Deno?.env.get("SUPABASE_URL")!,
    (globalThis as any).Deno?.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let body: GenerateRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body inválido" }, 400);
  }

  const { document_id, queue_id } = body;
  if (!document_id) return json({ error: "document_id requerido" }, 400);

  // ── Find queue record ──────────────────────────────────────────────────────
  let queueRecordId = queue_id;
  let queueAttempts = 0;

  if (!queueRecordId) {
    const { data: queueRow } = await sb
      .from("xml_generation_queue")
      .select("id, attempts")
      .eq("document_id", document_id)
      .eq("status", "pending")
      .lt("attempts", 3)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (queueRow) {
      queueRecordId = queueRow.id;
      queueAttempts = queueRow.attempts ?? 0;
    }
  } else {
    const { data: queueRow } = await sb
      .from("xml_generation_queue")
      .select("attempts")
      .eq("id", queueRecordId)
      .single();
    queueAttempts = queueRow?.attempts ?? 0;
  }

  // ── Mark as processing ─────────────────────────────────────────────────────
  if (queueRecordId) {
    await sb
      .from("xml_generation_queue")
      .update({ status: "processing", attempts: queueAttempts + 1 })
      .eq("id", queueRecordId);
    queueAttempts = queueAttempts + 1;
  }

  // ── Audit: started ─────────────────────────────────────────────────────────
  await sb.from("document_audit_trail").insert({
    document_id,
    tipo_evento: "XML_GENERATION_STARTED",
    actor: "system",
    created_at: new Date().toISOString(),
  });

  try {
    // ── 1. Documento principal ───────────────────────────────────────────────
    const { data: doc, error: docErr } = await sb
      .from("documents")
      .select(
        `id, folio, nombre_archivo,
         hash_sha256_original, hash_sha256_final,
         sha256_original, sha256_signed, title,
         created_at, completed_at, workspace_id, status`
      )
      .eq("id", document_id)
      .single();

    if (docErr || !doc) {
      throw new Error(`Documento no encontrado: ${docErr?.message}`);
    }
    if (doc.status !== "completado") {
      throw new Error(`Estado inválido: '${doc.status}' — se requiere 'completado'`);
    }

    // ── 2. Firmantes con evidencia y firmas ──────────────────────────────────
    const { data: signers } = await sb
      .from("document_signers")
      .select(
        `id, orden, tipo_firma, rfc, curp, nombre_completo, rol,
         num_certificado_sat, certificado_cer_base64,
         fecha_firma, ip_address, pais, ciudad, lat, lon,
         user_agent, os_detectado, tipo_dispositivo,
         huella_navegador, hash_firma_autografa,
         document_signatures (
           firma_xmldsig_base64,
           sello_tiempo_nom151_base64,
           psc_nombre, psc_folio, psc_fecha_utc
         )`
      )
      .eq("document_id", document_id)
      .order("orden", { ascending: true });

    const signersArr = signers ?? [];

    // ── Validate: all signers must have firma_xmldsig_base64 ─────────────────
    for (const signer of signersArr) {
      const sigArr = signer.document_signatures as Record<string, unknown>[] | null;
      const sig = Array.isArray(sigArr) ? sigArr[0] : null;
      if (!sig?.firma_xmldsig_base64) {
        throw new Error(
          `FIRMA_XMLDSIG_REQUERIDA: firmante ${esc(String(signer.rfc ?? signer.id))} sin firma`
        );
      }
    }

    // ── 3. Bitácora completa ─────────────────────────────────────────────────
    const { data: auditTrail } = await sb
      .from("document_audit_trail")
      .select("tipo_evento, actor, created_at, metadata")
      .eq("document_id", document_id)
      .order("created_at", { ascending: true });

    // ── 4. Conservación NOM-151 global ───────────────────────────────────────
    const { data: conservacion } = await sb
      .from("document_conservation")
      .select("psc_nombre, psc_folio, sello_base64, fecha_utc, url_verificacion")
      .eq("document_id", document_id)
      .maybeSingle();

    // ── 5. Hash encadenado: último documento completado del mismo workspace ──
    const { data: prevDoc } = await sb
      .from("documents")
      .select("xml_hash_sha256")
      .eq("workspace_id", doc.workspace_id)
      .eq("status", "completado")
      .neq("id", document_id)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // ── 6. Workspace ─────────────────────────────────────────────────────────
    const { data: workspace } = await sb
      .from("workspaces")
      .select("plan, pais")
      .eq("id", doc.workspace_id)
      .single();

    // ── 7. Transacción blockchain (Enterprise) ────────────────────────────────
    const { data: blockchain } = await sb
      .from("document_blockchain")
      .select("tx_id, red, fecha_tx")
      .eq("document_id", document_id)
      .maybeSingle();

    // ── 8. Build XML template with empty HashXML and FirmaDocubox ─────────────
    const xmlTemplate = buildXmlTemplate({
      doc,
      signers: signersArr,
      auditTrail: auditTrail ?? [],
      conservacion: conservacion ?? null,
      prevDoc: prevDoc ?? null,
      workspace: workspace ?? {},
      blockchain: blockchain ?? null,
    });

    // ── 9. Calculate HashXML over template (with empty placeholders) ──────────
    const hashXml = await calcularHashXML(xmlTemplate);
    const firmaDocuboxValue = await firmarDocubox(hashXml);

    // ── 10. Inject hash and firma into XML via string replace ─────────────────
    const xmlFinal = xmlTemplate
      .replace(
        '<HashXML algoritmo="SHA-256"></HashXML>',
        `<HashXML algoritmo="SHA-256">${hashXml}</HashXML>`
      )
      .replace(
        "<FirmaDocubox></FirmaDocubox>",
        `<FirmaDocubox>${firmaDocuboxValue}</FirmaDocubox>`
      );

    const xmlBytes = new TextEncoder().encode(xmlFinal);

    // ── 11. Upload to Storage ─────────────────────────────────────────────────
    const storageBucket =
      (globalThis as any).Deno?.env.get("STORAGE_BUCKET_EVIDENCIA") ?? "documentos-evidencia";
    const xmlPath = `${doc.workspace_id}/${document_id}/evidencia.xml`;

    const { error: uploadErr } = await sb.storage
      .from(storageBucket)
      .upload(xmlPath, xmlBytes, {
        contentType: "application/xml",
        upsert: false,
      });

    if (uploadErr) {
      throw new Error(`Error subiendo XML: ${uploadErr.message}`);
    }

    // ── 12. Update documents table ────────────────────────────────────────────
    await sb
      .from("documents")
      .update({
        xml_evidencia_path: xmlPath,
        xml_hash_sha256: hashXml,
        xml_generated_at: new Date().toISOString(),
      })
      .eq("id", document_id);

    // ── 13. Mark queue as completed ───────────────────────────────────────────
    if (queueRecordId) {
      await sb
        .from("xml_generation_queue")
        .update({ status: "completed", processed_at: new Date().toISOString() })
        .eq("id", queueRecordId);
    }

    // ── 14. Audit: completed ──────────────────────────────────────────────────
    await sb.from("document_audit_trail").insert({
      document_id,
      tipo_evento: "XML_GENERATION_COMPLETED",
      actor: "system",
      metadata: { xml_path: xmlPath, xml_hash: hashXml },
      created_at: new Date().toISOString(),
    });

    return json({
      success: true,
      document_id,
      xml_path: xmlPath,
      xml_hash_sha256: hashXml,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    // ── Mark queue as failed or retry ─────────────────────────────────────────
    if (queueRecordId) {
      if (queueAttempts >= 3) {
        await sb
          .from("xml_generation_queue")
          .update({ status: "failed", error_detail: errorMsg })
          .eq("id", queueRecordId);
      } else {
        await sb
          .from("xml_generation_queue")
          .update({ status: "pending", error_detail: errorMsg })
          .eq("id", queueRecordId);
      }
    }

    // ── Audit: failed ─────────────────────────────────────────────────────────
    await sb.from("document_audit_trail").insert({
      document_id,
      tipo_evento: "XML_GENERATION_FAILED",
      actor: "system",
      metadata: { error: errorMsg, attempts: queueAttempts },
      created_at: new Date().toISOString(),
    });

    return json({ error: errorMsg }, 500);
  }
});
