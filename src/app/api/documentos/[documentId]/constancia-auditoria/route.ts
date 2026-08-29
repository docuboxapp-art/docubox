import { NextRequest, NextResponse } from 'next/server';
import { buildAuditClosureCertificate, type AuditClosureEvent } from '@/lib/documents/audit-closure-certificate';
import { getPublicAppUrl } from '@/lib/publicAppUrl';
import { abbreviateDocuboxFolio } from '@/lib/documents/certificate-folio';
import { documentAccessResponse, requireDocumentAccess } from '@/lib/security/document-access';

export const runtime = 'nodejs';

function value(input: unknown, fallback = 'No disponible') {
  const normalized = String(input ?? '').replace(/[\r\n]+/g, ' ').trim();
  return normalized || fallback;
}

function iso(input: unknown) {
  const date = new Date(String(input ?? ''));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function eventKey(action: unknown, occurredAt: unknown) {
  const date = iso(occurredAt);
  return `${String(action || '')}:${date || String(occurredAt || '')}`;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> },
) {
  try {
    const { documentId } = await context.params;
    const { document, service } = await requireDocumentAccess(request, documentId, { ownerOrAdminOnly: true });
    if (document.estado !== 'completado') {
      return NextResponse.json({ error: 'La constancia de auditoría estará disponible al completar el documento.' }, { status: 422 });
    }

    const [legalAudit, operationalAudit, securityAudit] = await Promise.all([
      service.from('document_audit_trail')
        .select('id,action_code,action_description_es,action_result,actor_name,actor_email,actor_role,ip_address,action_at,audit_chain_hash')
        .eq('document_id', documentId)
        .order('action_at', { ascending: true }),
      service.from('audit_trail')
        .select('id,action,details,created_at')
        .eq('documento_id', documentId)
        .order('created_at', { ascending: true }),
      service.from('security_audit_log')
        .select('id,action,details,created_at')
        .eq('documento_id', documentId)
        .order('created_at', { ascending: true }),
    ]);

    const events: AuditClosureEvent[] = [];
    const seen = new Set<string>();
    const add = (event: AuditClosureEvent) => {
      const key = eventKey(event.action, event.occurredAt);
      if (!seen.has(key)) {
        seen.add(key);
        events.push(event);
      }
    };

    for (const row of legalAudit.data || []) {
      const occurredAt = iso(row.action_at);
      if (!occurredAt) continue;
      add({
        occurredAt,
        action: value(row.action_code),
        description: value(row.action_description_es || row.action_code),
        actor: value(row.actor_name, 'Sistema'),
        actorEmail: value(row.actor_email, ''),
        actorRole: value(row.actor_role, ''),
        result: value(row.action_result, 'exitoso'),
        ipAddress: value(row.ip_address, ''),
        source: 'document_audit_trail',
      });
    }

    for (const row of operationalAudit.data || []) {
      const occurredAt = iso(row.created_at);
      if (!occurredAt) continue;
      const details = row.details && typeof row.details === 'object' ? row.details as Record<string, unknown> : {};
      add({
        occurredAt,
        action: value(row.action),
        description: value(details.description || row.action),
        actor: value(details.actor_name, 'Docubox'),
        result: value(details.result, 'exitoso'),
        ipAddress: value(details.ip_address, ''),
        source: 'audit_trail',
      });
    }

    for (const row of securityAudit.data || []) {
      const occurredAt = iso(row.created_at);
      if (!occurredAt) continue;
      const details = row.details && typeof row.details === 'object' ? row.details as Record<string, unknown> : {};
      add({
        occurredAt,
        action: value(row.action),
        description: value(details.description || row.action),
        actor: value(details.actor_name, 'Sistema'),
        result: value(details.result, 'exitoso'),
        ipAddress: value(details.ip_address, ''),
        source: 'security_audit_log',
      });
    }

    const createdAt = iso(document.created_at) || new Date().toISOString();
    const completedAt = iso(document.fecha_completado || document.updated_at) || createdAt;
    if (!events.some((event) => event.action === 'documento_creado')) {
      add({ occurredAt: createdAt, action: 'documento_creado', description: 'Documento creado', actor: value(document.owner_nombre, 'Propietario'), result: 'exitoso', source: 'documento' });
    }
    if (!events.some((event) => event.action === 'documento_completado')) {
      add({ occurredAt: completedAt, action: 'documento_completado', description: 'Documento completado y cerrado', actor: 'Docubox', result: 'exitoso', source: 'documento' });
    }
    // La constancia representa el expediente al momento del cierre. Las
    // visualizaciones, descargas y demás eventos posteriores pertenecen al
    // historial vivo del visor, pero no deben modificar esta evidencia.
    const closureTime = new Date(completedAt).getTime();
    const eventsUntilClosure = events.filter((event) => {
      const eventTime = new Date(event.occurredAt).getTime();
      return Number.isFinite(eventTime) && eventTime <= closureTime;
    });
    eventsUntilClosure.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());

    const latestLegal = [...(legalAudit.data || [])].reverse().find((row) => row.audit_chain_hash);
    const folio = abbreviateDocuboxFolio(value(document.documento_id || document.folio_interno || document.id));
    const verificationUrl = `${getPublicAppUrl()}/verificar-documento?folio=${encodeURIComponent(folio)}&doc=${encodeURIComponent(documentId)}`;
    const pdfBytes = await buildAuditClosureCertificate({
      documentId,
      documentFolio: folio,
      title: value(document.nombre || document.file_name),
      workspaceName: value(document.organizacion || document.workspace_id, 'Espacio personal'),
      status: 'COMPLETADO',
      createdAt,
      completedAt,
      originalHash: value(document.file_hash_sha256 || document.hash_sha256),
      finalHash: value(document.sealed_pdf_hash || document.signed_file_hash_sha256 || document.hash_sha256),
      auditChainHash: value(latestLegal?.audit_chain_hash),
      verificationUrl,
      events: eventsUntilClosure,
    });
    const body = pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength) as ArrayBuffer;
    const safeName = value(document.nombre, 'documento').replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
    return new NextResponse(body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="constancia-auditoria-${safeName || 'documento'}.pdf"`,
        'Cache-Control': 'private, no-store, max-age=0',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
      },
    });
  } catch (error) {
    const accessError = documentAccessResponse(error);
    if (accessError.status !== 500) return NextResponse.json(accessError.body, { status: accessError.status });
    console.error('[DOCUBOX][constancia-auditoria] No se pudo generar la constancia:', error);
    return NextResponse.json({ error: 'No se pudo generar la constancia de auditoría.' }, { status: 500 });
  }
}
