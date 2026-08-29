import { NextRequest, NextResponse } from 'next/server';
import {
  buildGeneralSignatureCertificate,
  type GeneralCertificateEvent,
  type GeneralCertificateParticipant,
  type GeneralCertificateSeal,
} from '@/lib/documents/general-signature-certificate';
import { getPublicAppUrl } from '@/lib/publicAppUrl';
import { documentAccessResponse, requireDocumentAccess } from '@/lib/security/document-access';
import { abbreviateDocuboxFolio, createCertificateFolio } from '@/lib/documents/certificate-folio';

export const runtime = 'nodejs';

type Participant = Record<string, unknown>;
type SignedResponse = {
  participante_email: string | null;
  participante_nombre: string | null;
  tipo_participacion: string | null;
  firma_completada: boolean | null;
  firma_completada_at: string | null;
  aprobacion_completada: boolean | null;
  aprobacion_completada_at: string | null;
  signature_method: string | null;
};

function text(value: unknown, fallback = 'No disponible') {
  const result = String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
  return result || fallback;
}

function normalizeEmail(value: unknown) {
  return text(value, '').toLowerCase();
}

function maskEmail(value: unknown) {
  const email = text(value, '');
  const at = email.indexOf('@');
  if (at < 1) return email || 'No disponible';
  const local = email.slice(0, at);
  return `${local.slice(0, Math.min(2, local.length))}${'*'.repeat(Math.max(3, local.length - 2))}${email.slice(at)}`;
}

function signatureMethod(value: unknown) {
  switch (text(value, '').toLowerCase()) {
    case 'efirma': return 'Firma electrónica';
    case 'click_sign': return 'Click & Sign';
    case 'autografa':
    case 'autógrafa':
    case 'autograph':
    case 'autograph_otp': return 'Firma autógrafa digitalizada';
    case 'biometric': return 'Firma biométrica';
    default: return text(value, 'No disponible');
  }
}

function workflowMode(value: unknown) {
  switch (text(value, '').toLowerCase()) {
    case 'secuencial': return 'Secuencial';
    case 'mixto': return 'Mixta';
    case 'paralelo': return 'Paralela';
    default: return 'No disponible';
  }
}

function participantsFromDocument(value: unknown): Participant[] {
  if (Array.isArray(value)) return value as Participant[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed as Participant[] : [];
    } catch {
      return [];
    }
  }
  return [];
}

function participantStatus(response: SignedResponse | undefined, participant: Participant) {
  if (response?.firma_completada || response?.aprobacion_completada) return 'Firmado';
  const status = text(participant.estado || participant.sub_estado, 'Pendiente');
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function asDate(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeSha256(value: unknown) {
  const candidate = text(value, '').trim();
  if (/^[a-f0-9]{64}$/i.test(candidate)) return candidate.toLowerCase();
  if (!/^[a-z0-9+/]{43}=$/i.test(candidate)) return null;
  try {
    const decoded = Buffer.from(candidate, 'base64');
    return decoded.byteLength === 32 ? decoded.toString('hex') : null;
  } catch {
    return null;
  }
}

function buildCertificateId(documentId: string, completedAt: unknown) {
  return createCertificateFolio({ kind: 'GEN', documentId, occurredAt: completedAt });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> },
) {
  try {
    const { documentId } = await context.params;
    const { document, service } = await requireDocumentAccess(request, documentId);
    if (document.estado !== 'completado') {
      return NextResponse.json(
        { error: 'La constancia general estará disponible cuando el documento esté completado.' },
        { status: 422 },
      );
    }

    const [responsesResult, certificationResult, workspaceResult, nom151Result, auditResult] = await Promise.all([
      service
        .from('participation_responses')
        .select('participante_email,participante_nombre,tipo_participacion,firma_completada,firma_completada_at,aprobacion_completada,aprobacion_completada_at,signature_method')
        .eq('documento_id', documentId),
      service
        .from('document_certifications')
        .select('id,status,certification_uuid,verification_uuid,document_body_sha256,certified_pdf_sha256,evidence_manifest_sha256,certification_package_sha256,certification_root_sha256,document_signing_key_id,completed_at')
        .eq('document_id', documentId)
        .eq('status', 'COMPLETED')
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      document.workspace_id
        ? service.from('workspaces').select('name').eq('id', document.workspace_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      service
        .from('nom151_constancias_doc')
        .select('id,status,pdf_sha256_local,nubarium_hash,constancia_sha256,nubarium_codigo_validacion,nubarium_estatus,created_at')
        .eq('documento_id', documentId)
        .eq('status', 'issued')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      service
        .from('audit_trail')
        .select('action,details,created_at')
        .eq('documento_id', documentId)
        .order('created_at', { ascending: true }),
    ]);

    if (responsesResult.error) throw responsesResult.error;
    const responses = (responsesResult.data || []) as SignedResponse[];
    const responseByEmail = new Map(responses.map((item) => [normalizeEmail(item.participante_email), item]));
    const documentParticipants = participantsFromDocument(document.participantes);
    const participantSource = documentParticipants.length > 0
      ? documentParticipants
      : responses.map((response) => ({
        nombre: response.participante_nombre,
        email: response.participante_email,
        acto: response.tipo_participacion,
      }) as Participant);

    const participants: GeneralCertificateParticipant[] = participantSource.map((participant) => {
      const response = responseByEmail.get(normalizeEmail(participant.email));
      return {
        name: text(participant.nombre || response?.participante_nombre),
        email: maskEmail(participant.email || response?.participante_email),
        role: text(participant.rolDocumento || participant.rol || participant.acto || response?.tipo_participacion, 'Participante'),
        method: signatureMethod(response?.signature_method || participant.metodo_firma || participant.metodoFirma),
        signedAt: asDate(response?.firma_completada_at || response?.aprobacion_completada_at || participant.fecha_firma || participant.fecha_participacion),
        status: participantStatus(response, participant),
      };
    });

    const certification = certificationResult.error ? null : certificationResult.data;
    const timestampResult = certification
      ? await service
        .from('timestamp_records')
        .select('status,gen_time,tsa_name,timestamp_uuid')
        .eq('document_certification_id', certification.id)
        .maybeSingle()
      : { data: null, error: null };
    const timestamp = timestampResult.error ? null : timestampResult.data;
    const nom151 = nom151Result.error ? null : nom151Result.data;
    const workspace = workspaceResult.error ? null : workspaceResult.data;

    const folio = abbreviateDocuboxFolio(text(document.documento_id || document.folio_interno || document.id));
    const latestParticipantCompletion = responses
      .map((response) => asDate(response.firma_completada_at || response.aprobacion_completada_at))
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);
    const completedAt = asDate(document.fecha_completado)
      || asDate(certification?.completed_at)
      || latestParticipantCompletion
      || 'No disponible';
    const createdAt = asDate(document.created_at) || 'No disponible';
    const originalHash = text(document.file_hash_sha256);
    const finalHash = text(document.sealed_pdf_hash || document.signed_file_hash_sha256 || certification?.certified_pdf_sha256);
    const evidenceHash = text(
      certification?.certification_root_sha256
      || certification?.evidence_manifest_sha256
      || certification?.certification_package_sha256
      || document.xml_hash_sha256,
    );
    const certificateId = buildCertificateId(documentId, completedAt);
    const verificationUrl = `${getPublicAppUrl()}/verificar-documento?folio=${encodeURIComponent(folio)}`;

    const events: GeneralCertificateEvent[] = asDate(createdAt)
      ? [{ label: 'Documento creado', occurredAt: createdAt, actor: 'Docubox' }]
      : [];
    const auditRows = auditResult.error ? [] : (auditResult.data || []);
    const invitation = auditRows.find((item) => item.action === 'invitacion_enviada');
    const participantNotificationDates = documentParticipants
      .map((participant) => asDate(participant.fecha_notificacion))
      .filter((value): value is string => Boolean(value));
    const invitationAt = asDate(invitation?.created_at) || participantNotificationDates.sort()[0] || null;
    if (invitationAt) events.push({ label: 'Invitaciones enviadas', occurredAt: invitationAt, actor: 'Docubox' });
    participants.forEach((participant) => {
      if (!participant.signedAt) return;
      events.push({
        label: `${participant.name} firmó (${participant.method})`,
        occurredAt: participant.signedAt,
        actor: 'Docubox',
      });
    });
    if (asDate(completedAt)) {
      events.push({ label: 'Proceso completado', occurredAt: completedAt, actor: 'Docubox' });
    }
    events.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());

    const timestampSeal: GeneralCertificateSeal = timestamp?.status === 'VALID'
      ? {
        status: 'Válido',
        provider: text(timestamp.tsa_name),
        identifier: text(timestamp.timestamp_uuid),
        occurredAt: asDate(timestamp.gen_time),
      }
      : { status: 'No registrado', provider: 'No registrado', identifier: 'No disponible', occurredAt: null };
    const nom151Seal: GeneralCertificateSeal = nom151
      ? {
        status: text(nom151.nubarium_estatus, 'Registrada'),
        provider: 'Nubarium',
        identifier: text(nom151.nubarium_codigo_validacion || nom151.id),
        occurredAt: asDate(nom151.created_at),
      }
      : { status: 'No registrada', provider: 'No registrado', identifier: 'No disponible', occurredAt: null };
    const nom151LocalHash = normalizeSha256(nom151?.pdf_sha256_local);
    const nom151ProviderHash = normalizeSha256(nom151?.nubarium_hash);
    const nom151EvidenceHash = normalizeSha256(nom151?.constancia_sha256);
    const nom151ValidationStatus = nom151LocalHash && nom151ProviderHash
      ? (nom151LocalHash === nom151ProviderHash ? 'Coincide con el PDF enviado al PSC' : 'NO COINCIDE')
      : 'No verificable';
    const certificationSeal: GeneralCertificateSeal = certification
      ? {
        status: 'Completada',
        provider: text(certification.document_signing_key_id, 'Docubox'),
        identifier: text(certification.certification_uuid),
        occurredAt: asDate(certification.completed_at),
      }
      : { status: 'No registrada', provider: 'No registrado', identifier: 'No disponible', occurredAt: null };

    const pdfBytes = await buildGeneralSignatureCertificate({
      folio,
      documentId,
      title: text(document.nombre || document.file_name),
      workspaceName: text(workspace?.name || document.organizacion || document.workspace_id, 'Espacio personal'),
      originalHash,
      finalHash,
      evidenceHash,
      createdAt,
      completedAt,
      workflowMode: workflowMode(document.participation_order),
      participants,
      certificateId,
      verificationUrl,
      timestamp: timestampSeal,
      nom151: nom151Seal,
      nom151Integrity: nom151
        ? {
          certifiedPdfHash: nom151LocalHash || 'No disponible',
          providerPdfHash: nom151ProviderHash || 'No disponible',
          evidenceFileHash: nom151EvidenceHash || 'No disponible',
          validationStatus: nom151ValidationStatus,
        }
        : undefined,
      certification: certificationSeal,
      events,
    });

    const pdfBody = pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength) as ArrayBuffer;
    const filename = String(document.nombre || 'documento').replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
    return new NextResponse(pdfBody, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="constancia-general-${filename || 'documento'}.pdf"`,
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
    console.error('[DOCUBOX][constancia-general] No se pudo generar la constancia:', error);
    return NextResponse.json(
      { error: 'No se pudo generar la constancia general de firma.' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store, max-age=0' } },
    );
  }
}
