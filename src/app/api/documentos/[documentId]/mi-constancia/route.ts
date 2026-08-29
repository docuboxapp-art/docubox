import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createIndividualParticipationCertificate } from '@/lib/documents/individual-participation-certificate';
import { getPublicAppUrl } from '@/lib/publicAppUrl';
import { documentAccessResponse, requireDocumentAccess } from '@/lib/security/document-access';
import { createCertificateFolio } from '@/lib/documents/certificate-folio';

export const runtime = 'nodejs';

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function formatUtc(value: string | null | undefined) {
  if (!value) return 'No disponible';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().replace('T', ' ').replace('.000Z', 'Z');
}

function methodLabel(value: string | null | undefined) {
  switch (String(value || '').toLowerCase()) {
    case 'efirma':
      return 'e.firma SAT';
    case 'click_sign':
    case 'clicksign':
      return 'Click & Sign';
    case 'autografa':
    case 'autógrafa':
    case 'autograph':
    case 'autograph_otp':
      return 'Firma autógrafa digital';
    case 'biometric':
      return 'Firma biométrica';
    default:
      return value ? safeText(value) : 'No disponible';
  }
}

function signatureKind(value: string | null | undefined): 'autograph' | 'efirma' | 'click_sign' | 'other' {
  switch (String(value || '').toLowerCase()) {
    case 'efirma':
      return 'efirma';
    case 'click_sign':
    case 'clicksign':
      return 'click_sign';
    case 'autografa':
    case 'autógrafa':
    case 'autograph':
    case 'autograph_otp':
      return 'autograph';
    default:
      return 'other';
  }
}

function individualFolioKind(kind: ReturnType<typeof signatureKind>) {
  if (kind === 'efirma') return 'IND-EF' as const;
  if (kind === 'click_sign') return 'IND-CS' as const;
  if (kind === 'autograph') return 'IND-AUT' as const;
  return 'IND' as const;
}

function safeText(value: string | null | undefined) {
  return String(value || 'No disponible').replace(/[\r\n]+/g, ' ');
}

function metadataValue(metadata: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = metadata[key];
    if (value !== null && value !== undefined && String(value).trim()) return String(value);
  }
  return '';
}

function participantRole(document: Record<string, any>, userId: string, email: string) {
  const participants = Array.isArray(document.participantes) ? document.participantes : [];
  const participant = participants.find((item: Record<string, unknown>) => (
    String(item.id || item.participante_id || item.user_id || '') === userId
    || normalizeEmail(item.email || item.correo) === email
  ));
  return safeText(participant?.rolDocumento || participant?.rol_documento || participant?.rol || 'Firmante');
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> },
) {
  try {
    const { documentId } = await context.params;
    const { user, document, service } = await requireDocumentAccess(request, documentId);
    const email = normalizeEmail(user.email);

    let responseResult = await service
      .from('participation_responses')
      .select('participante_id,participante_email,participante_nombre,firma_data,firma_completada,firma_completada_at,signature_method,signature_hash,signature_ip,signature_metadata,terminos_aceptados,terminos_aceptados_at')
      .eq('documento_id', documentId)
      .eq('participante_id', user.id)
      .eq('firma_completada', true)
      .maybeSingle();

    if (!responseResult.data && email) {
      responseResult = await service
        .from('participation_responses')
        .select('participante_id,participante_email,participante_nombre,firma_data,firma_completada,firma_completada_at,signature_method,signature_hash,signature_ip,signature_metadata,terminos_aceptados,terminos_aceptados_at')
        .eq('documento_id', documentId)
        .ilike('participante_email', email)
        .eq('firma_completada', true)
        .maybeSingle();
    }

    if (responseResult.error) throw responseResult.error;
    const response = responseResult.data;
    if (!response) {
      return NextResponse.json(
        { error: 'La constancia solo esta disponible despues de que firmes el documento.' },
        { status: 403 },
      );
    }
    const kind = signatureKind(response.signature_method);

    const [evidenceResult, profileResult, certificationResult] = await Promise.all([
      service
        .from('signature_evidence')
        .select('evidence_type,captured_at,ip_address,signature_hash,participant_name,participant_email,participant_role,timezone,geo_latitude,geo_longitude,device_type,user_agent,workspace_name,document_pages,document_size_kb,cert_rfc,cert_curp,cert_serial_number,cert_not_before,cert_not_after,sign_algorithm,cert_issuer,ocsp_status')
        .eq('document_id', documentId)
        .eq('captured_by', user.id)
        .order('captured_at', { ascending: false })
        .limit(10),
      service
        .from('user_profiles')
        .select('full_name,email,rfc,curp')
        .eq('id', user.id)
        .maybeSingle(),
      service
        .from('document_certifications')
        .select('certified_pdf_sha256,completed_at')
        .eq('document_id', documentId)
        .eq('status', 'COMPLETED')
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (evidenceResult.error) throw evidenceResult.error;
    if (profileResult.error) throw profileResult.error;
    if (certificationResult.error) throw certificationResult.error;

    const evidenceRows = evidenceResult.data || [];
    const expectedEvidenceType = kind === 'efirma'
      ? 'efirma_sat'
      : kind === 'autograph'
        ? 'autograph_signature'
        : '';
    const evidence = evidenceRows.find((item) => item.evidence_type === expectedEvidenceType)
      || (kind === 'click_sign' ? null : evidenceRows[0])
      || null;
    const profile = profileResult.data;
    const certification = certificationResult.data;
    const metadata = (response.signature_metadata || {}) as Record<string, unknown>;
    const participantName = safeText(
      response.participante_nombre
      || evidence?.participant_name
      || profile?.full_name
      || user.user_metadata?.full_name
      || user.email,
    );
    const participantEmail = safeText(response.participante_email || evidence?.participant_email || user.email);
    const signedAt = response.firma_completada_at || evidence?.captured_at;
    const signatureHash = response.signature_hash || evidence?.signature_hash;
    const signatureIp = response.signature_ip || evidence?.ip_address || metadata.ip;
    const generatedAt = new Date().toISOString();
    const folio = createCertificateFolio({
      kind: individualFolioKind(kind),
      documentId: document.id,
      occurredAt: signedAt || generatedAt,
      participantKey: String(response.participante_id || response.participante_email || user.id),
    });
    const verificationFolio = safeText(document.documento_id || document.folio_interno || document.id);
    const verificationUrl = `${getPublicAppUrl()}/verificar-documento?folio=${encodeURIComponent(verificationFolio)}`;
    const method = methodLabel(response.signature_method);
    const isEfirma = kind === 'efirma';
    const coordinates = evidence?.geo_latitude != null && evidence?.geo_longitude != null
      ? `${evidence.geo_latitude}, ${evidence.geo_longitude}`
      : 'No disponibles';
    const originalHash = safeText(document.file_hash_sha256);
    const signedHash = safeText(document.sealed_pdf_hash || document.signed_file_hash_sha256 || certification?.certified_pdf_sha256);
    const sealedAt = document.completed_at || document.fecha_completado || certification?.completed_at;
    let logoBytes: Uint8Array | undefined;
    try {
      logoBytes = new Uint8Array(await readFile(path.join(process.cwd(), 'public', 'assets', 'images', 'docubox-logo-2026.png')));
    } catch {
      logoBytes = undefined;
    }

    const pdfBytes = await createIndividualParticipationCertificate({
      logoBytes,
      folio,
      generatedAt,
      participantName,
      participantEmail,
      participantRole: safeText(evidence?.participant_role || participantRole(document, user.id, email)),
      participantCurp: safeText(evidence?.cert_curp || profile?.curp || metadataValue(metadata, 'curp')),
      participantRfc: safeText(evidence?.cert_rfc || profile?.rfc || metadataValue(metadata, 'rfc')),
      signatureKind: kind,
      signatureMethod: method,
      signatureImage: kind === 'autograph' ? response.firma_data : null,
      signatureHash: safeText(signatureHash),
      signedAt: safeText(signedAt),
      documentId: safeText(document.id),
      documentTitle: safeText(document.nombre),
      documentCreatedAt: safeText(document.created_at || document.fecha_creacion || document.uploaded_at),
      documentCompletedAt: safeText(document.completed_at || document.fecha_completado || certification?.completed_at),
      issuer: safeText(evidence?.cert_issuer || metadataValue(metadata, 'certificate_issuer') || (isEfirma ? 'SAT' : '')),
      certificateSerialNumber: safeText(evidence?.cert_serial_number || metadataValue(metadata, 'certificate_serial')),
      certificateNotBefore: safeText(evidence?.cert_not_before || metadataValue(metadata, 'certificate_not_before')),
      certificateNotAfter: safeText(evidence?.cert_not_after || metadataValue(metadata, 'certificate_valid_until', 'certificate_not_after')),
      ocspStatus: safeText(evidence?.ocsp_status || metadataValue(metadata, 'ocsp_status')),
      organization: safeText(evidence?.workspace_name || document.organizacion || metadataValue(metadata, 'certificate_organization')),
      country: safeText(metadataValue(metadata, 'certificate_country')),
      certificateValidity: safeText(
        evidence?.cert_not_after
          ? `${formatUtc(evidence.cert_not_before)} a ${formatUtc(evidence.cert_not_after)}`
          : metadataValue(metadata, 'certificate_valid_until'),
      ),
      certificateAlgorithm: safeText(evidence?.sign_algorithm || metadataValue(metadata, 'certificate_algorithm') || (signatureHash ? 'SHA-256' : '')),
      timestampAuthority: safeText(metadataValue(metadata, 'timestamp_authority')),
      timestampUrl: safeText(metadataValue(metadata, 'timestamp_url', 'tsa_url')),
      signatureLevel: safeText(metadataValue(metadata, 'pades_profile')),
      legalStandard: safeText(metadataValue(metadata, 'legal_standard') || 'Código de Comercio, artículos 89 a 97'),
      consentAccepted: Boolean(response.terminos_aceptados),
      consentAcceptedAt: safeText(response.terminos_aceptados_at || signedAt),
      consentVersion: safeText(metadataValue(metadata, 'consent_version', 'terms_version')),
      consentText: safeText(metadataValue(metadata, 'consent_text', 'terms_text')),
      ipAddress: safeText(signatureIp),
      coordinates,
      timezone: safeText(evidence?.timezone || metadataValue(metadata, 'timezone') || 'UTC'),
      device: safeText(evidence?.device_type || metadataValue(metadata, 'device') || 'No disponible'),
      userAgent: safeText(evidence?.user_agent || metadataValue(metadata, 'user_agent')),
      originalDocumentHash: originalHash,
      signedDocumentHash: signedHash,
      sealedAt: safeText(sealedAt),
      verificationUrl,
    });
    const pdfBody = pdfBytes.buffer.slice(
      pdfBytes.byteOffset,
      pdfBytes.byteOffset + pdfBytes.byteLength,
    ) as ArrayBuffer;
    const safeName = String(document.nombre || 'documento')
      .replace(/[^a-z0-9-_]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();

    return new NextResponse(pdfBody, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="constancia-participacion-${safeName || 'documento'}.pdf"`,
        'Cache-Control': 'private, no-store, max-age=0',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
      },
    });
  } catch (error) {
    const accessError = documentAccessResponse(error);
    if (accessError.status !== 500) {
      return NextResponse.json(accessError.body, { status: accessError.status });
    }

    console.error('[DOCUBOX][mi-constancia] No se pudo generar la constancia:', error);
    return NextResponse.json(
      { error: 'No se pudo generar la constancia de participacion.' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store, max-age=0' } },
    );
  }
}
