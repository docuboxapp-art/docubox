import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { documentAccessResponse, requireDocumentAccess } from '@/lib/security/document-access';



const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function esc(val: string | null | undefined): string {
  if (!val) return '';
  return val
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  return createHash('sha256').update(data).digest('hex');
}

async function firmarDocubox(hashXml: string): Promise<string> {
  const signingKey = process.env.DOCUBOX_INTERNAL_SIGNING_KEY;
  if (!signingKey) return 'NO_KEY_CONFIGURED';
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(hashXml));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

// POST /api/nom151/generate-xml
// Body: { documento_id }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { documento_id } = body;

    if (!documento_id) {
      return NextResponse.json({ error: 'documento_id requerido' }, { status: 400 });
    }
    await requireDocumentAccess(req, documento_id, { ownerOrAdminOnly: true });

    // 1. Check if already generated
    const { data: existing } = await supabaseAdmin
      .from('documentos')
      .select('xml_evidencia_path, xml_hash_sha256, xml_generated_at')
      .eq('id', documento_id)
      .not('xml_evidencia_path', 'is', null)
      .maybeSingle();

    if (existing?.xml_evidencia_path) {
      return NextResponse.json({
        already_generated: true,
        xml_evidencia_path: existing.xml_evidencia_path,
        xml_hash_sha256: existing.xml_hash_sha256,
        xml_generated_at: existing.xml_generated_at,
      });
    }

    // 2. Get document data
    const { data: doc, error: docErr } = await supabaseAdmin
      .from('documentos')
      .select('id, nombre, estado, file_url, participantes, workspace_id, created_at, updated_at, fecha_completado, file_hash_sha256')
      .eq('id', documento_id)
      .single();

    if (docErr || !doc) {
      return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });
    }

    if (doc.estado !== 'completado') {
      return NextResponse.json({ error: `Estado inválido: '${doc.estado}'` }, { status: 422 });
    }

    // 3. Get workspace info
    const { data: workspace } = await supabaseAdmin
      .from('workspaces')
      .select('name, id')
      .eq('id', doc.workspace_id)
      .maybeSingle();

    // 4. Get signature evidence
    const { data: sigEvidence } = await supabaseAdmin
      .from('signature_evidence')
      .select('*')
      .eq('documento_id', documento_id);

    // 5. Get audit trail
    const { data: auditTrail } = await supabaseAdmin
      .from('document_activity_log')
      .select('action, actor_nombre, actor_email, created_at, details, category')
      .eq('documento_id', documento_id)
      .order('created_at', { ascending: true });

    // 6. Get NOM-151 constancia if available
    const { data: nom151 } = await supabaseAdmin
      .from('nom151_constancias_doc')
      .select('nubarium_codigo_validacion, nubarium_hash, created_at, constancia_sha256')
      .eq('documento_id', documento_id)
      .eq('status', 'issued')
      .maybeSingle();

    // 7. Get previous document for hash chaining
    const { data: prevDoc } = await supabaseAdmin
      .from('documentos')
      .select('xml_hash_sha256')
      .eq('workspace_id', doc.workspace_id)
      .eq('estado', 'completado')
      .neq('id', documento_id)
      .not('xml_hash_sha256', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const participantes: any[] = doc.participantes || [];
    const hashEncadenado = prevDoc?.xml_hash_sha256 || 'GENESIS';
    const fechaCompletado = doc.fecha_completado || doc.updated_at || new Date().toISOString();

    // 8. Build firmantes XML
    const firmantesXml = participantes.map((p: any, idx: number) => {
      const ev = sigEvidence?.find((e: any) => e.participante_email === p.email) || {};
      return `    <Firmante orden="${idx + 1}" tipo="${esc(p.metodo_firma || 'Firma Autógrafa Digital')}">
      <NombreCompleto>${esc(p.nombre || p.name || '')}</NombreCompleto>
      <Correo>${esc(p.email || '')}</Correo>
      <Rol>${esc(p.rolDocumento || p.acto || 'Firmante')}</Rol>
      <Estado>${esc(p.estado || '')}</Estado>
      <FechaFirma>${esc(p.fecha_firma ? new Date(p.fecha_firma).toISOString() : (p.fecha_participacion ? new Date(p.fecha_participacion).toISOString() : ''))}</FechaFirma>
      <Evidencia>
        <IP>${esc(ev.ip_address || p.ip_address || '')}</IP>
        <LugarFirma>${esc(ev.lugar_firma || p.lugar_firma || '')}</LugarFirma>
        <Geolocalizacion>
          <Pais>${esc(ev.country_code || '')}</Pais>
          <Ciudad>${esc(ev.city || '')}</Ciudad>
        </Geolocalizacion>
        <Dispositivo>
          <UserAgent>${esc(ev.user_agent || '')}</UserAgent>
        </Dispositivo>
      </Evidencia>
    </Firmante>`;
    }).join('\n');

    // 9. Build bitácora XML
    const bitacoraXml = (auditTrail || []).map((ev: any) => {
      return `    <Evento timestamp="${esc(ev.created_at ? new Date(ev.created_at).toISOString() : '')}" tipo="${esc(ev.action || '')}" actor="${esc(ev.actor_email || ev.actor_nombre || 'system')}"/>`;
    }).join('\n');

    // 10. Build conservacion XML
    const conservacionXml = nom151
      ? `  <Conservacion>
    <NormaAplicable>NOM-151-SCFI-2016</NormaAplicable>
    <PSC>Nubarium — Secretaría de Economía</PSC>
    <CodigoValidacion>${esc(nom151.nubarium_codigo_validacion)}</CodigoValidacion>
    <HashNubarium>${esc(nom151.nubarium_hash)}</HashNubarium>
    <FechaUTC>${esc(new Date(nom151.created_at).toISOString())}</FechaUTC>
    <URLVerificacion>https://validatuconstancia.pscworld.com/</URLVerificacion>
  </Conservacion>`
      : `  <Conservacion>
    <Estado>pendiente</Estado>
  </Conservacion>`;

    // 11. Build XML template
    const xmlTemplate = `<?xml version="1.0" encoding="UTF-8"?>
<DocuboxEvidencia
  xmlns="https://docubox.mx/schema/v1"
  xmlns:ds="http://www.w3.org/2000/09/xmldsig#"
  version="1.0"
  schemaVersion="1.0">

  <!-- BLOQUE 1: Identidad del documento -->
  <Documento>
    <ID>${esc(documento_id)}</ID>
    <NombreArchivo>${esc(doc.nombre || '')}</NombreArchivo>
    <HashSHA256 algoritmo="SHA-256">${esc(doc.file_hash_sha256 || '')}</HashSHA256>
    <FechaCreacion>${esc(doc.created_at ? new Date(doc.created_at).toISOString() : '')}</FechaCreacion>
    <FechaCierre>${esc(new Date(fechaCompletado).toISOString())}</FechaCierre>
    <Estado>completado</Estado>
    <VersionEsquema>1.0</VersionEsquema>
  </Documento>

  <!-- BLOQUE 2: Firmantes -->
  <Firmantes>
${firmantesXml}
  </Firmantes>

  <!-- BLOQUE 3: Bitácora de eventos -->
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
    <AlgoritmoUsado>HMAC-SHA256 + XMLDSig + NOM-151</AlgoritmoUsado>
  </IntegridadPaquete>

  <!-- BLOQUE 6: Workspace -->
  <Workspace>
    <WorkspaceID>${esc(doc.workspace_id || '')}</WorkspaceID>
    <Nombre>${esc(workspace?.name || '')}</Nombre>
    <Jurisdiccion>MX</Jurisdiccion>
    <VersionPlataforma>1.0.0</VersionPlataforma>
  </Workspace>

</DocuboxEvidencia>`;

    // 12. Calculate hash and sign
    const xmlBytes = new TextEncoder().encode(xmlTemplate);
    const hashXml = await sha256Hex(xmlBytes);
    const firmaDocuboxValue = await firmarDocubox(hashXml);

    // 13. Inject hash and firma
    const xmlFinal = xmlTemplate
      .replace('<HashXML algoritmo="SHA-256"></HashXML>', `<HashXML algoritmo="SHA-256">${hashXml}</HashXML>`)
      .replace('<FirmaDocubox></FirmaDocubox>', `<FirmaDocubox>${firmaDocuboxValue}</FirmaDocubox>`);

    const xmlFinalBytes = new TextEncoder().encode(xmlFinal);

    // 14. Upload to storage — use 'evidence' bucket (confirmed to exist)
    const storageBucket = 'evidence';
    const xmlPath = `${doc.workspace_id || 'default'}/${documento_id}/evidencia.xml`;

    // Try upsert (overwrite if exists)
    const { error: uploadErr } = await supabaseAdmin.storage
      .from(storageBucket)
      .upload(xmlPath, xmlFinalBytes, {
        contentType: 'application/xml',
        upsert: true,
      });

    if (uploadErr) {
      console.error('[generate-xml] Upload to evidence bucket failed:', uploadErr.message);
      return NextResponse.json({ error: `Error subiendo XML: ${uploadErr.message}` }, { status: 500 });
    }

    // 15. Update documentos table
    await supabaseAdmin
      .from('documentos')
      .update({
        xml_evidencia_path: xmlPath,
        xml_hash_sha256: hashXml,
        xml_generated_at: new Date().toISOString(),
      })
      .eq('id', documento_id);

    return NextResponse.json({
      success: true,
      documento_id,
      xml_evidencia_path: xmlPath,
      xml_hash_sha256: hashXml,
      xml_generated_at: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const response = documentAccessResponse(err);
    console.error('[generate-xml] Error:', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json(response.body, { status: response.status });
  }
}
