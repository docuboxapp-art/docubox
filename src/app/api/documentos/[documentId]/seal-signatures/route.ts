import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createServiceClient } from '@/lib/supabase/server';
import { resolveLegacyDocumentStoragePath } from '@/lib/documents/internal-source';
import type { FinalPdfTechnicalMetadata } from '@/lib/documents/final-pdf-metadata';
import {
  createSignedDocumentPdf,
  isSignatureStampField,
  type SignatureStampField,
  type SignatureStampResponse,
} from '@/lib/signatures/pdf-stamp';
import {
  getRequiredPadesLevel,
  integratePadesFinalDocument,
  upgradePadesBbCertificationToBt,
} from '@/lib/certification/product-integration';
import { CertificationError } from '@/lib/certification/types';

function normalize(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function isParticipant(participants: unknown, userId: string, email: string) {
  return (
    Array.isArray(participants) &&
    participants.some((participant) => {
      const row = participant as Record<string, unknown>;
      return row?.id === userId || row?.user_id === userId || normalize(row?.email) === email;
    })
  );
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return null;
}

function metadataValue(record: unknown, ...keys: string[]) {
  if (!record || typeof record !== 'object') return null;
  const source = record as Record<string, unknown>;
  return firstText(...keys.map((key) => source[key]));
}

async function authenticatedUser(request: NextRequest) {
  const service = createServiceClient();
  const authorization = request.headers.get('authorization');
  if (authorization?.startsWith('Bearer ')) {
    const result = await service.auth.getUser(authorization.slice(7).trim());
    if (!result.error && result.data.user) return result.data.user;
  }
  const cookieStore = await cookies();
  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: { getAll: () => cookieStore.getAll(), setAll: () => undefined },
    }
  );
  const result = await client.auth.getUser();
  return result.error ? null : result.data.user;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) {
  try {
    const user = await authenticatedUser(request);
    if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });

    const { documentId } = await context.params;
    const service = createServiceClient();
    const documentResult = await service
      .from('documentos')
      .select(
        'id,documento_id,owner_id,workspace_id,estado,nombre,descripcion,numero_oficio,tipo_documento_id,otro_tipo_documento,participantes,campos_solicitados,storage_path,file_url,file_name,file_type,file_hash_sha256,participation_order,created_at,fecha_completado,sealed_pdf_path,sealed_pdf_hash'
      )
      .eq('id', documentId)
      .is('deleted_at', null)
      .maybeSingle();
    if (documentResult.error) throw documentResult.error;
    const document = documentResult.data;
    if (!document) return NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 });
    if (document.estado !== 'completado')
      return NextResponse.json(
        { error: 'El documento debe estar completado antes de generar su versión firmada.' },
        { status: 409 }
      );

    const email = normalize(user.email);
    const owner = document.owner_id === user.id;
    const participant = isParticipant(document.participantes, user.id, email);
    if (!owner && !participant)
      return NextResponse.json(
        { error: 'No tienes permiso para generar esta versión.' },
        { status: 403 }
      );

    const requiredPadesLevel = getRequiredPadesLevel();
    const verifiedCertification = await service
      .from('document_certifications')
      .select(
        'certification_uuid,certified_pdf_sha256,pades_profile,pdf_signature_status,certificate_status,timestamp_status,verification_status,pades_verified_at'
      )
      .eq('document_id', document.id)
      .eq('status', 'COMPLETED')
      .in('pades_profile', ['PAdES-B-B', 'PAdES-B-T'])
      .eq('pdf_signature_status', 'valid')
      .eq('certificate_status', 'valid')
      .eq('verification_status', 'valid')
      .order('pades_verified_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (verifiedCertification.error) throw verifiedCertification.error;
    const existingVerifiedCertification = verifiedCertification.data;
    const existingProfileAccepted =
      existingVerifiedCertification &&
      (requiredPadesLevel === 'B-B' ||
        (existingVerifiedCertification.pades_profile === 'PAdES-B-T' &&
          existingVerifiedCertification.timestamp_status === 'valid'));
    if (
      document.sealed_pdf_path &&
      document.sealed_pdf_hash &&
      existingVerifiedCertification &&
      existingProfileAccepted &&
      existingVerifiedCertification?.certified_pdf_sha256 === document.sealed_pdf_hash
    ) {
      return NextResponse.json({
        ok: true,
        already_sealed: true,
        storage_path: document.sealed_pdf_path,
        sha256: document.sealed_pdf_hash,
        pades_profile: existingVerifiedCertification.pades_profile,
        pades_verified: true,
        certification_uuid: existingVerifiedCertification.certification_uuid,
      });
    }
    if (
      requiredPadesLevel === 'B-T' &&
      document.sealed_pdf_path &&
      document.sealed_pdf_hash &&
      existingVerifiedCertification?.pades_profile === 'PAdES-B-B' &&
      existingVerifiedCertification.certified_pdf_sha256 === document.sealed_pdf_hash
    ) {
      const upgraded = await upgradePadesBbCertificationToBt(service, {
        documentId: document.id,
        triggeredBy: user.id,
      });
      return NextResponse.json({
        ok: true,
        already_sealed: upgraded.alreadyVerified,
        storage_path: upgraded.storagePath,
        sha256: upgraded.sha256,
        document_version_id: upgraded.documentVersionId,
        pades_profile: upgraded.profile,
        pades_verified: true,
        pades_verified_at: upgraded.verifiedAt,
        certification_uuid: upgraded.certificationUuid,
        timestamp: upgraded.timestamp || null,
      });
    }
    if (document.sealed_pdf_path?.includes('/pades/')) {
      return NextResponse.json(
        {
          error:
            'El PDF marcado como PAdES no cuenta con una certificación técnica válida. Se requiere revisión manual.',
          code: 'UNVERIFIED_PADES_STORAGE_REFERENCE',
        },
        { status: 409 }
      );
    }

    const responsesResult = await service
      .from('participation_responses')
      .select(
        'participante_id,participante_email,participante_nombre,firma_data,firma_completada_at,signature_method,signature_stamp_style,signature_hash,signature_ip,signature_metadata'
      )
      .eq('documento_id', document.id)
      .eq('firma_completada', true)
      .order('firma_completada_at', { ascending: true });
    if (responsesResult.error) throw responsesResult.error;
    const responses = (responsesResult.data || []) as SignatureStampResponse[];
    if (responses.length === 0)
      return NextResponse.json(
        { error: 'No hay firmas completadas para estampar.' },
        { status: 409 }
      );

    const signatureFields = Array.isArray(document.campos_solicitados)
      ? (document.campos_solicitados as SignatureStampField[]).filter(isSignatureStampField)
      : [];
    if (signatureFields.length === 0) {
      return NextResponse.json(
        { error: 'El documento no tiene campos de firma configurados para estampar.' },
        { status: 409 }
      );
    }

    const storagePath = resolveLegacyDocumentStoragePath(document.storage_path, document.file_url);
    if (!storagePath)
      return NextResponse.json(
        { error: 'El documento original no está disponible.' },
        { status: 409 }
      );
    if (document.file_type && document.file_type !== 'application/pdf')
      return NextResponse.json(
        { error: 'La estampa solo está disponible para documentos PDF.' },
        { status: 422 }
      );
    const original = await service.storage.from('documents').download(storagePath);
    if (original.error || !original.data)
      throw original.error || new Error('No se pudo abrir el documento original.');
    const originalBytes = new Uint8Array(await original.data.arrayBuffer());
    const originalHash = createHash('sha256').update(originalBytes).digest('hex');
    if (document.file_hash_sha256 && normalize(document.file_hash_sha256) !== originalHash) {
      return NextResponse.json(
        {
          error:
            'El archivo original no coincide con la huella SHA-256 registrada. No se generó el documento final.',
        },
        { status: 409 }
      );
    }

    const [
      ownerProfileResult,
      versionResult,
      documentTypeResult,
      metadataResult,
      caseFileResult,
      nom151Result,
      certificationResult,
      legalEvidenceResult,
    ] = await Promise.all([
      service.from('profiles').select('full_name,email').eq('id', document.owner_id).maybeSingle(),
      service
        .from('document_versions')
        .select('version_number')
        .eq('document_id', document.id)
        .order('version_number', { ascending: false })
        .limit(1)
        .maybeSingle(),
      document.tipo_documento_id
        ? service
            .from('tipo_documento')
            .select('nombre')
            .eq('id', document.tipo_documento_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      service
        .from('document_additional_metadata')
        .select('name,data_type,value_display,snapshot_hash')
        .eq('document_id', document.id)
        .eq('metadata_scope', 'document')
        .order('created_at', { ascending: true }),
      service
        .from('case_file_documents')
        .select('case_file_id')
        .eq('source_document_id', document.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
      service
        .from('nom151_constancias_doc')
        .select('status')
        .eq('documento_id', document.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      service
        .from('document_certifications')
        .select(
          'id,status,pdf_signature_status,certificate_status,timestamp_status,pades_profile,evidence_chain_sha256'
        )
        .eq('document_id', document.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      service
        .from('legal_evidence_events')
        .select('event_hash')
        .eq('document_id', document.id)
        .order('sequence_number', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const certification = certificationResult.data as Record<string, unknown> | null;
    const timestampResult = certification?.id
      ? await service
          .from('timestamp_records')
          .select('status,tsa_name')
          .eq('document_certification_id', certification.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null, error: null };
    const timestamp = timestampResult.data as Record<string, unknown> | null;
    const ownerProfile = ownerProfileResult.data as Record<string, unknown> | null;
    const participantRows = Array.isArray(document.participantes)
      ? (document.participantes as Array<Record<string, unknown>>)
      : [];
    const responseMetadata = responses.map((response) => response.signature_metadata || {});
    const signatureMethods = Array.from(
      new Set(
        responses.map((response) =>
          firstText(response.signature_method, response.signature_stamp_style, 'autografa')!
        )
      )
    );
    const identityRequired = participantRows.some((participant) =>
      Boolean(
        participant.identity_verification_required ||
        participant.requiere_verificacion_identidad ||
        participant.requires_identity
      )
    );
    const identityVerified =
      participantRows.some((participant) => {
        const status = firstText(
          participant.identity_verification_status,
          participant.verification_status,
          participant.identity_status
        )?.toLowerCase();
        return status === 'verified' || status === 'verificado' || status === 'approved';
      }) ||
      responseMetadata.some((item) => {
        const status = metadataValue(
          item,
          'identity_verification_status',
          'verification_status'
        )?.toLowerCase();
        return status === 'verified' || status === 'verificado' || status === 'approved';
      });
    const closedAt = firstText(document.fecha_completado) || new Date().toISOString();
    const technicalMetadata: FinalPdfTechnicalMetadata = {
      documentId: document.id,
      documentFolio: document.documento_id,
      tenantId: document.workspace_id || document.owner_id,
      workspaceId: document.workspace_id || document.owner_id,
      documentVersion: Number(versionResult.data?.version_number || 1),
      title: document.nombre || document.file_name,
      documentType: firstText(
        documentTypeResult.data?.nombre,
        document.otro_tipo_documento,
        'No especificado'
      )!,
      originalSha256: originalHash,
      createdAt: document.created_at || closedAt,
      completedAt: closedAt,
      creatorId: document.owner_id,
      creatorName: firstText(ownerProfile?.full_name, ownerProfile?.email, 'Cuenta Docubox')!,
      signatureMethods,
      participantCount: participantRows.length || responses.length,
      status: 'completado',
      workflow: document.participation_order || 'paralelo',
      caseFileId: firstText(caseFileResult.data?.case_file_id),
      templateId: null,
      formId: null,
      nom151Status: firstText(nom151Result.data?.status, 'not_issued_at_pdf_closure')!,
      certificationStatus: firstText(certification?.status, 'not_started_at_pdf_closure')!,
      pdfSignatureStatus: firstText(
        certification?.pdf_signature_status,
        'not_configured_at_pdf_closure'
      )!,
      certificateStatus: firstText(
        certification?.certificate_status,
        'not_configured_at_pdf_closure'
      )!,
      padesProfile: firstText(certification?.pades_profile),
      timestampStatus: firstText(
        timestamp?.status,
        certification?.timestamp_status,
        'not_issued_at_pdf_closure'
      )!,
      tsaProvider: firstText(timestamp?.tsa_name),
      evidenceChainSha256: firstText(
        certification?.evidence_chain_sha256,
        legalEvidenceResult.data?.event_hash
      ),
      identityVerificationStatus: identityVerified
        ? 'verified'
        : identityRequired
          ? 'pending'
          : 'not_required',
      assuranceLevel: firstText(
        ...responseMetadata.map((item) =>
          metadataValue(item, 'assurance_level', 'nivel_aseguramiento')
        ),
        ...participantRows.map((item) =>
          metadataValue(item, 'assurance_level', 'nivel_aseguramiento')
        ),
        identityVerified ? 'standard' : 'not_applicable'
      )!,
      additionalDocumentMetadata: (metadataResult.data || []).map((item) => ({
        name: String(item.name || ''),
        dataType: String(item.data_type || 'text'),
        value: String(item.value_display || ''),
        snapshotHash: item.snapshot_hash || null,
      })),
    };

    // Historic documents persisted the creator as the logical participant
    // `current-user`. Resolve only that reserved identifier to the immutable
    // owner UUID; regular participant IDs remain untouched.
    const resolvedSignatureFields = signatureFields.map((field) =>
      normalize(field.participantId) === 'current-user'
        ? { ...field, participantId: document.owner_id }
        : field
    );

    let visualPdfBytes: Uint8Array;
    let visualPdfSha256: string;
    let stampsApplied: number;
    let metadataSnapshotSha256: string | null;

    if (document.sealed_pdf_path && !document.sealed_pdf_path.includes('/pades/')) {
      const existingVisual = await service.storage
        .from('documents')
        .download(document.sealed_pdf_path);
      if (existingVisual.error || !existingVisual.data) {
        throw existingVisual.error || new Error('No se pudo recuperar el PDF visual existente.');
      }
      visualPdfBytes = new Uint8Array(await existingVisual.data.arrayBuffer());
      visualPdfSha256 = createHash('sha256').update(visualPdfBytes).digest('hex');
      if (document.sealed_pdf_hash && normalize(document.sealed_pdf_hash) !== visualPdfSha256) {
        return NextResponse.json(
          {
            error:
              'El PDF visual existente no coincide con su huella registrada. No se inició PAdES.',
            code: 'FINAL_VISUAL_PDF_HASH_MISMATCH',
          },
          { status: 409 }
        );
      }
      stampsApplied = responses.length;
      metadataSnapshotSha256 = null;
    } else {
      const rendered = await createSignedDocumentPdf({
        originalBytes,
        fields: resolvedSignatureFields,
        responses,
        technicalMetadata,
      });
      visualPdfBytes = rendered.bytes;
      visualPdfSha256 = rendered.sha256;
      stampsApplied = rendered.stampsApplied;
      metadataSnapshotSha256 = rendered.metadataSnapshotSha256;
    }

    if (stampsApplied === 0) {
      return NextResponse.json(
        { error: 'Ninguna firma completada corresponde a los campos configurados.' },
        { status: 409 }
      );
    }
    if (!document.workspace_id) {
      return NextResponse.json(
        { error: 'El documento debe pertenecer a un espacio de trabajo para finalizar PAdES.' },
        { status: 422 }
      );
    }

    const pades = await integratePadesFinalDocument(service, {
      documentId: document.id,
      documentOwnerId: document.owner_id,
      workspaceId: document.workspace_id,
      triggeredBy: user.id,
      visualPdfBytes,
      visualPdfSha256,
      completedAt: closedAt,
      signaturesApplied: stampsApplied,
      requiredLevel: requiredPadesLevel,
    });

    await service.from('document_activity_log').insert({
      documento_id: document.id,
      actor_id: user.id,
      actor_nombre: user.user_metadata?.full_name || user.email || 'Usuario',
      actor_email: user.email || '',
      action: 'pdf_firmado_generado',
      category: 'firma',
      details: {
        original_sha256: originalHash,
        visual_pdf_sha256: visualPdfSha256,
        sealed_sha256: pades.sha256,
        signatures: stampsApplied,
        storage_path: pades.storagePath,
        document_version_id: pades.documentVersionId,
        certification_uuid: pades.certificationUuid,
        pades_profile: pades.profile,
        pades_verified_at: pades.verifiedAt,
        certificate_fingerprint_sha256: pades.certificateFingerprintSha256,
        technical_metadata_snapshot: technicalMetadata,
        technical_metadata_snapshot_sha256: metadataSnapshotSha256,
        metadata_format: 'PDF Info + XMP Docubox 1.0',
      },
    });

    return NextResponse.json({
      ok: true,
      sha256: pades.sha256,
      signatures: stampsApplied,
      storage_path: pades.storagePath,
      metadata_snapshot_sha256: metadataSnapshotSha256,
      document_version_id: pades.documentVersionId,
      certification_uuid: pades.certificationUuid,
      pades_profile: pades.profile,
      pades_verified: true,
      pades_verified_at: pades.verifiedAt,
      timestamp: pades.timestamp || null,
    });
  } catch (error) {
    console.error('[DOCUBOX][seal-signatures] No se pudo generar el PDF firmado:', error);
    if (error instanceof CertificationError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.httpStatus }
      );
    }
    return NextResponse.json(
      { error: 'No se pudo generar el PDF firmado.', code: 'FINAL_DOCUMENT_FAILED' },
      { status: 500 }
    );
  }
}
