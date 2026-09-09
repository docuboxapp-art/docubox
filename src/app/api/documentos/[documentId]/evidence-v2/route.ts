import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createCertificationProviderSet } from '@/lib/certification/providers';
import { sha256Hex } from '@/lib/certification/canonical';
import { createEvidenceV2Package } from '@/lib/evidence-v2/generator';
import {
  isEvidenceV2Enabled,
  isEvidenceV2KmsSigningEnabled,
} from '@/lib/evidence-v2/feature-flags';
import type { VerificationStatus } from '@/lib/evidence-v2/types';
import { documentAccessResponse, requireDocumentAccess } from '@/lib/security/document-access';

export const runtime = 'nodejs';

function normalized(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function verificationStatus(value: unknown): VerificationStatus {
  const status = normalized(value);
  if (['valid', 'verified', 'good', 'success'].includes(status)) return 'valid';
  if (['invalid', 'revoked', 'failed', 'error'].includes(status)) return 'invalid';
  if (['not_applicable', 'not-applicable'].includes(status)) return 'not_applicable';
  if (['unavailable', 'unknown'].includes(status)) return 'unavailable';
  return 'pending';
}

function isOptionalMetadataSchemaError(
  error: { message?: string | null; code?: string | null } | null
) {
  const detail = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  return (
    /document_additional_metadata/.test(detail) &&
    /(does not exist|schema cache|relation|pgrst204)/.test(detail)
  );
}

function participantRef(participant: Record<string, unknown>) {
  const id = String(participant.id || participant.user_id || '').trim();
  if (id) return `participant:${id}`;
  const email = normalized(participant.email);
  return email ? `participant-email-sha256:${sha256Hex(email)}` : `participant:unresolved`;
}

function participantKind(role: unknown) {
  const value = normalized(role);
  if (['signer', 'firmante'].includes(value)) return 'signer' as const;
  if (['approver', 'aprobador'].includes(value)) return 'approver' as const;
  if (['reviewer', 'revisor'].includes(value)) return 'reviewer' as const;
  if (['witness', 'testigo'].includes(value)) return 'witness' as const;
  if (['recipient', 'destinatario'].includes(value)) return 'recipient' as const;
  return 'other' as const;
}

function evidenceMethod(row: Record<string, unknown>) {
  if (row.cert_serial_number || row.cert_rfc) return 'efirma_sat' as const;
  if (normalized(row.evidence_type).includes('biometric')) return 'firma_biometrica' as const;
  if (normalized(row.evidence_type).includes('autograph')) return 'autografa_digital' as const;
  return 'firma_simple' as const;
}

function enabledError() {
  return NextResponse.json(
    { error: 'Evidence Package v2 no está habilitado.', code: 'EVIDENCE_V2_DISABLED' },
    { status: 404 }
  );
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) {
  if (!isEvidenceV2Enabled()) return enabledError();
  try {
    const { documentId } = await context.params;
    const { user, document, service } = await requireDocumentAccess(request, documentId, {
      ownerOrAdminOnly: true,
    });
    if (document.estado !== 'completado') {
      return NextResponse.json(
        {
          error: 'El documento debe estar completado para cerrar Evidence Package v2.',
          code: 'EVIDENCE_V2_DOCUMENT_NOT_CLOSED',
        },
        { status: 409 }
      );
    }
    const [certificationResult, eventsResult, signaturesResult, nom151Result, otsResult] =
      await Promise.all([
        service
          .from('document_certifications')
          .select(
            'document_version_id,document_version,certified_pdf_sha256,completed_at,status,execution_status'
          )
          .eq('document_id', documentId)
          .eq('status', 'COMPLETED')
          .eq('execution_status', 'completed')
          .order('completed_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        service
          .from('legal_evidence_events')
          .select(
            'event_uuid,sequence_number,event_type,event_result,event_hash,occurred_at,actor_id'
          )
          .eq('document_id', documentId)
          .order('sequence_number', { ascending: true }),
        service
          .from('signature_evidence')
          .select(
            'id,captured_by,evidence_type,image_sha256,strokes_sha256,combined_sha256,captured_at,document_sha256,cert_serial_number,cert_rfc,cert_curp,cert_subject,cert_issuer,cert_not_before,cert_not_after,ocsp_status'
          )
          .eq('document_id', documentId)
          .eq('is_voided', false)
          .order('captured_at', { ascending: true }),
        service
          .from('nom151_constancias_doc')
          .select('id,status,nubarium_codigo_validacion,created_at,constancia_sha256')
          .eq('documento_id', documentId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        service
          .from('document_blockchain_evidence')
          .select('id,status,evidence_hash,proof_storage_path,anchored_at,verified_at')
          .eq('document_id', documentId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
    for (const result of [
      certificationResult,
      eventsResult,
      signaturesResult,
      nom151Result,
      otsResult,
    ]) {
      if (result.error) throw result.error;
    }
    const metadataResult = await service
      .from('document_additional_metadata')
      .select('id,name,data_type,snapshot_value,snapshot_hash,created_at,created_by,metadata_scope')
      .eq('document_id', documentId)
      .eq('metadata_scope', 'document')
      .order('created_at', { ascending: true });
    if (metadataResult.error && !isOptionalMetadataSchemaError(metadataResult.error))
      throw metadataResult.error;
    const certification = certificationResult.data as Record<string, unknown> | null;
    const finalHash = normalized(certification?.certified_pdf_sha256 || document.sealed_pdf_hash);
    if (!/^[a-f0-9]{64}$/.test(finalHash)) {
      return NextResponse.json(
        {
          error: 'No existe una huella SHA-256 del PDF final verificable.',
          code: 'EVIDENCE_V2_FINAL_HASH_REQUIRED',
        },
        { status: 409 }
      );
    }
    const existing = await service
      .from('evidence_packages')
      .select('evidence_id,package_id,xml_sha256,xml_storage_path,status,generated_at,closed_at')
      .eq('document_id', documentId)
      .eq('evidence_version', '2.0')
      .not('closed_at', 'is', null)
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data)
      return NextResponse.json({ ok: true, alreadyGenerated: true, package: existing.data });

    const closedAt = String(
      certification?.completed_at ||
        document.fecha_completado ||
        document.updated_at ||
        new Date().toISOString()
    );
    const participants = Array.isArray(document.participantes)
      ? (document.participantes as Array<Record<string, unknown>>)
      : [];
    const signatures = (signaturesResult.data || []).map((row: Record<string, unknown>) => {
      const ref = `participant:${String(row.captured_by || 'unresolved')}`;
      const certificatePresent = Boolean(row.cert_serial_number || row.cert_rfc);
      return {
        signatureRef: `signature:${String(row.id)}`,
        participantRef: ref,
        method: evidenceMethod(row),
        signedObjectHash:
          typeof row.document_sha256 === 'string' && /^[a-f0-9]{64}$/i.test(row.document_sha256)
            ? row.document_sha256.toLowerCase()
            : finalHash,
        capturedAt: row.captured_at ? String(row.captured_at) : null,
        autograph:
          evidenceMethod(row) === 'autografa_digital'
            ? {
                strokesHash: typeof row.strokes_sha256 === 'string' ? row.strokes_sha256 : null,
                imageHash: typeof row.image_sha256 === 'string' ? row.image_sha256 : null,
                evidenceObjectId: `signature:${String(row.id)}`,
              }
            : undefined,
        certificate: certificatePresent
          ? {
              serialNumber: row.cert_serial_number ? String(row.cert_serial_number) : null,
              rfc: row.cert_rfc ? String(row.cert_rfc) : null,
              curp: row.cert_curp ? String(row.cert_curp) : null,
              subject: row.cert_subject ? String(row.cert_subject) : null,
              issuer: row.cert_issuer ? String(row.cert_issuer) : null,
              validFrom: row.cert_not_before ? String(row.cert_not_before) : null,
              validTo: row.cert_not_after ? String(row.cert_not_after) : null,
              validationStatus: verificationStatus(row.ocsp_status),
            }
          : undefined,
      };
    });
    const nom151 = nom151Result.data as Record<string, unknown> | null;
    const ots = otsResult.data as Record<string, unknown> | null;
    const otsStatus = normalized(ots?.status);
    const timestamps = ots
      ? [
          {
            type: 'opentimestamps' as const,
            status:
              otsStatus === 'verified'
                ? ('verified_bitcoin' as const)
                : otsStatus === 'pending_bitcoin'
                  ? ('pending_bitcoin' as const)
                  : otsStatus === 'submission_failed'
                    ? ('failed' as const)
                    : ('pending' as const),
            objectType: 'evidence_root' as const,
            objectHash: String(ots.evidence_hash || finalHash),
            provider: 'OpenTimestamps',
            issuedAt: ots.anchored_at ? String(ots.anchored_at) : null,
            artifactRef: ots.proof_storage_path
              ? `storage:${String(ots.proof_storage_path)}`
              : null,
            validationStatus:
              otsStatus === 'verified'
                ? ('valid' as const)
                : otsStatus.includes('failed')
                  ? ('invalid' as const)
                  : ('pending' as const),
            validatedAt: ots.verified_at ? String(ots.verified_at) : null,
          },
        ]
      : [];
    const packageInput = {
      evidenceId: randomUUID(),
      packageId: randomUUID(),
      version: '2.0' as const,
      schemaVersion: '2.0' as const,
      generatedAt: new Date().toISOString(),
      closedAt,
      environment: String(
        process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown'
      ).toUpperCase(),
      platform: 'Docubox',
      platformVersion: String(process.env.npm_package_version || 'unknown'),
      jurisdiction: 'MX',
      workspaceId: document.workspace_id || null,
      organizationId: null,
      status: isEvidenceV2KmsSigningEnabled()
        ? ('partially_certified' as const)
        : ('closed' as const),
      document: {
        documentId,
        externalId: document.documento_id || null,
        name: document.nombre || null,
        fileName: document.file_name || document.nombre || null,
        mimeType: document.file_type || 'application/pdf',
        sizeBytes: document.file_size || null,
        createdByRef: document.owner_id ? `user:${document.owner_id}` : null,
        createdAt: document.created_at || null,
        versionId: certification?.document_version_id
          ? String(certification.document_version_id)
          : null,
        version: certification?.document_version ? Number(certification.document_version) : null,
        originalHash:
          typeof document.file_hash_sha256 === 'string' &&
          /^[a-f0-9]{64}$/i.test(document.file_hash_sha256)
            ? document.file_hash_sha256.toLowerCase()
            : null,
        finalHash,
        metadata: (metadataResult.error ? [] : metadataResult.data || []).map(
          (item: Record<string, unknown>) => ({
            id: String(item.id),
            key: String(item.name),
            name: String(item.name),
            type: String(item.data_type || 'text'),
            value: ['string', 'number', 'boolean'].includes(typeof item.snapshot_value)
              ? (item.snapshot_value as string | number | boolean)
              : null,
            source: 'user' as const,
            createdByRef: item.created_by ? `user:${String(item.created_by)}` : null,
            recordedAt: item.created_at ? String(item.created_at) : null,
            snapshotHash: item.snapshot_hash ? String(item.snapshot_hash) : null,
          })
        ),
      },
      participants: participants.map((participant, index) => ({
        participantRef: participantRef(participant),
        role: String(participant.rol || participant.role || 'participant'),
        participantType: participantKind(participant.rol || participant.role),
        order: index + 1,
        required: participant.required === undefined ? null : Boolean(participant.required),
        invitationAt: participant.fecha_invitacion ? String(participant.fecha_invitacion) : null,
        firstAccessAt: participant.fecha_primer_acceso
          ? String(participant.fecha_primer_acceso)
          : null,
        signedAt:
          participant.fecha_firma || participant.fecha_participacion
            ? String(participant.fecha_firma || participant.fecha_participacion)
            : null,
      })),
      signatures,
      events: (eventsResult.data || []).map((event: Record<string, unknown>) => ({
        eventId: String(event.event_uuid),
        sequence: Number(event.sequence_number),
        type: String(event.event_type),
        result: String(event.event_result),
        occurredAt: String(event.occurred_at),
        actorRef: event.actor_id ? `user:${String(event.actor_id)}` : null,
        objectRef: `document:${documentId}`,
        sourceEventHash: String(event.event_hash),
      })),
      timestamps,
      nom151: {
        status:
          normalized(nom151?.status) === 'issued'
            ? ('issued' as const)
            : normalized(nom151?.status) === 'verified'
              ? ('verified' as const)
              : normalized(nom151?.status) === 'failed'
                ? ('failed' as const)
                : nom151
                  ? ('pending' as const)
                  : ('not_requested' as const),
        requestId: nom151?.id ? String(nom151.id) : null,
        requestedAt: nom151?.created_at ? String(nom151.created_at) : null,
        providerName: nom151 ? 'NOM-151 provider' : null,
        constanciaId: nom151?.nubarium_codigo_validacion
          ? String(nom151.nubarium_codigo_validacion)
          : null,
        issuedAt: nom151?.created_at ? String(nom151.created_at) : null,
        constanciaHash: nom151?.constancia_sha256 ? String(nom151.constancia_sha256) : null,
      },
    };
    const signer = isEvidenceV2KmsSigningEnabled()
      ? createCertificationProviderSet().keyManagement
      : null;
    const built = await createEvidenceV2Package(packageInput, signer);
    const storagePath = `${document.workspace_id || document.owner_id}/${documentId}/${packageInput.document.versionId || 'legacy'}/evidence-v2/${built.package.packageId}/evidence.xml`;
    const upload = await service.storage
      .from('evidence-v2-artifacts')
      .upload(storagePath, Buffer.from(built.xml, 'utf8'), {
        contentType: 'application/xml',
        upsert: false,
      });
    if (upload.error) throw upload.error;
    const insert = await service
      .from('evidence_packages')
      .insert({
        evidence_id: built.package.evidenceId,
        package_id: built.package.packageId,
        tenant_id: document.workspace_id || document.owner_id,
        workspace_id: document.workspace_id || null,
        document_id: documentId,
        document_version_id: packageInput.document.versionId,
        evidence_version: '2.0',
        schema_version: '2.0',
        canonicalization_version: 'docubox-evidence-root-v1',
        status: built.package.status,
        document_final_sha256: finalHash,
        evidence_root_sha256: built.package.chain.rootHash,
        package_digest_sha256: built.package.packageDigest,
        xml_sha256: built.xmlSha256,
        xml_storage_bucket: 'evidence-v2-artifacts',
        xml_storage_path: storagePath,
        docubox_signature: built.package.docuboxSignature,
        verification_summary: built.package.verification,
        generated_at: built.package.generatedAt,
        closed_at: built.package.closedAt,
        created_by: user.id,
      })
      .select('evidence_id,package_id,xml_sha256,xml_storage_path,status,generated_at,closed_at')
      .single();
    if (insert.error) throw insert.error;
    return NextResponse.json({ ok: true, package: insert.data });
  } catch (error) {
    const access = documentAccessResponse(error);
    if (access.status !== 500) return NextResponse.json(access.body, { status: access.status });
    console.error(
      '[evidence-v2] Generation failed',
      error instanceof Error ? error.message : 'unknown'
    );
    return NextResponse.json(
      {
        error: 'No fue posible generar Evidence Package v2.',
        code: 'EVIDENCE_V2_GENERATION_FAILED',
      },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) {
  if (!isEvidenceV2Enabled()) return enabledError();
  try {
    const { documentId } = await context.params;
    const { service } = await requireDocumentAccess(request, documentId);
    const packageResult = await service
      .from('evidence_packages')
      .select(
        'evidence_id,package_id,xml_sha256,xml_storage_bucket,xml_storage_path,status,generated_at,closed_at,verification_summary'
      )
      .eq('document_id', documentId)
      .eq('evidence_version', '2.0')
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (packageResult.error) throw packageResult.error;
    if (!packageResult.data) return NextResponse.json({ package: null });
    if (new URL(request.url).searchParams.get('download') !== '1')
      return NextResponse.json({ package: packageResult.data });
    const stored = packageResult.data as Record<string, string>;
    const download = await service.storage
      .from(stored.xml_storage_bucket)
      .download(stored.xml_storage_path);
    if (download.error || !download.data)
      throw download.error || new Error('EVIDENCE_V2_STORAGE_READ_FAILED');
    return new NextResponse(await download.data.arrayBuffer(), {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="docubox-evidence-${stored.package_id}.xml"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    const access = documentAccessResponse(error);
    if (access.status !== 500) return NextResponse.json(access.body, { status: access.status });
    return NextResponse.json(
      { error: 'No fue posible recuperar Evidence Package v2.', code: 'EVIDENCE_V2_READ_FAILED' },
      { status: 500 }
    );
  }
}
