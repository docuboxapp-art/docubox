import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getPublicCertification } from '@/lib/certification/engine';
import type {
  LocatedVerificationDocument,
  PublicVerificationResult,
  VerificationCheck,
  VerificationEngine,
  VerificationStatus,
} from './types';
import { VERIFIER_VERSION } from './types';

export async function verifyLocatedDocument(input: {
  supabase: SupabaseClient;
  document: LocatedVerificationDocument;
  method: PublicVerificationResult['method'];
  submittedHash?: string | null;
  artifactMatches?: PublicVerificationResult['artifactMatches'];
}): Promise<PublicVerificationResult> {
  const checkedAt = new Date().toISOString();
  const checks: VerificationCheck[] = [];
  const warnings: string[] = [];
  const document = input.document;
  const submittedHash = input.submittedHash?.toLowerCase() || null;
  let certificationDetails: PublicVerificationResult['certification'] = null;

  if (submittedHash) {
    const exact = document.hashes.some((artifact) => artifact.hash === submittedHash);
    checks.push(
      check(
        'DOCUMENT_INTEGRITY',
        'HASH_MATCH',
        exact ? 'VERIFIED' : 'HASH_MISMATCH',
        exact ? 'DOCUMENT_HASH_MATCH' : 'DOCUMENT_HASH_MISMATCH',
        exact
          ? 'La huella calculada coincide exactamente con un artefacto registrado.'
          : 'La huella calculada no coincide con los artefactos asociados al documento.'
      )
    );
  } else {
    checks.push(
      check(
        'DOCUMENT_INTEGRITY',
        'REGISTRY_LOOKUP',
        'REGISTERED',
        'DOCUMENT_REGISTERED',
        'El documento fue localizado en el registro de Docubox. Esto no constituye por si solo una verificacion criptografica.'
      )
    );
  }

  let certification: any = null;
  if (
    document.certificationVerificationUuid &&
    ['COMPLETED', 'REVOKED'].includes(document.certificationStatus || '')
  ) {
    try {
      certification = await getPublicCertification(
        input.supabase,
        document.certificationVerificationUuid
      );
      const valid = certification.overall_status === 'VALID';
      certificationDetails = {
        certificationUuid: certification.certification?.certification_uuid || '',
        verificationUuid:
          certification.certification?.verification_uuid || certification.verification_uuid,
        environment: certification.certification?.environment || 'UNKNOWN',
        status: certification.certification?.status || certification.overall_status,
        documentChain: {
          displayText: certification.document_chain?.display_text || null,
          hash: certification.document_chain?.sha256 || null,
          valid: Boolean(
            certification.document_chain?.hash_match &&
            certification.document_chain?.seal_hash_match &&
            certification.document_chain?.seal_valid
          ),
        },
        documentSeal: {
          identifier: certification.document_seal?.seal_uuid || null,
          status: certification.document_seal?.status || 'UNVERIFIED',
          algorithm: certification.document_seal?.signature_algorithm || null,
          keyVersion: certification.document_seal?.signing_key_version || null,
          hash: certification.document_seal?.seal_sha256 || null,
          signaturePreview: certification.document_seal?.seal_base64_preview || null,
          signedAt: certification.document_seal?.signed_at || null,
          valid: certification.document_seal?.status === 'VALID',
        },
        evidenceChain: {
          displayText: certification.evidence_chain?.display_text || null,
          hash: certification.evidence_chain?.sha256 || null,
          valid: Boolean(
            certification.evidence_chain?.manifest_hash_match &&
            certification.evidence_chain?.chain_hash_match &&
            certification.evidence_chain?.audit_chain_valid
          ),
        },
        evidenceSeal: {
          status: certification.evidence_seal?.status || 'UNVERIFIED',
          algorithm: certification.evidence_seal?.signature_algorithm || null,
          keyVersion: certification.evidence_seal?.signing_key_version || null,
          hash: certification.evidence_seal?.seal_sha256 || null,
          signaturePreview: certification.evidence_seal?.seal_base64_preview || null,
          valid: certification.evidence_seal?.status === 'VALID',
        },
        timestamp: certification.timestamp
          ? {
              status: certification.timestamp.status,
              standard: certification.timestamp.standard || null,
              generatedAt: certification.timestamp.gen_time || null,
              tsaName: certification.timestamp.tsa_name || null,
              policyOid: certification.timestamp.tsa_policy_oid || null,
              algorithm: certification.timestamp.message_imprint_algorithm || 'SHA-256',
              tokenHash: certification.timestamp.timestamp_token_sha256 || null,
              valid: Boolean(
                certification.timestamp.status === 'VALID' &&
                certification.timestamp.message_imprint_match &&
                certification.timestamp.token_signature_valid
              ),
            }
          : null,
        audit: {
          eventCount: Number(certification.audit?.event_count || 0),
          finalHash: certification.audit?.final_hash || null,
          merkleRoot: certification.audit?.merkle_root || null,
          valid: Boolean(certification.audit?.valid),
        },
      };
      checks.push(
        check(
          'DOCUMENT_INTEGRITY',
          'CERTIFIED_DOCUMENT_HASH',
          certification.document?.body_hash_match &&
            certification.document?.certified_pdf_hash_match
            ? 'VERIFIED'
            : 'HASH_MISMATCH',
          valid ? 'CERTIFIED_HASHES_VERIFIED' : 'CERTIFIED_HASHES_MISMATCH',
          valid
            ? 'Las huellas del documento y del PDF certificado fueron recalculadas.'
            : 'Una o mas huellas certificadas no coinciden.'
        )
      );
      checks.push(
        check(
          'EVIDENCE_CHAIN',
          'MANIFEST_AND_SEALS',
          valid
            ? 'VERIFIED'
            : certification.overall_status === 'REVOKED'
              ? 'UNTRUSTED_CERTIFICATE'
              : 'INVALID',
          valid ? 'EVIDENCE_CHAIN_VERIFIED' : 'EVIDENCE_CHAIN_INVALID',
          valid
            ? 'Manifest, sellos RSA-PSS y cadena de auditoria verificados.'
            : 'La cadena de evidencia no supero todas las comprobaciones.'
        )
      );
      checks.push(
        check(
          'RFC3161',
          'TIMESTAMP_BINDING',
          certification.timestamp?.status === 'VALID' &&
            certification.timestamp?.message_imprint_match
            ? 'VERIFIED_WITH_WARNINGS'
            : certification.timestamp
              ? 'INVALID'
              : 'NOT_PRESENT',
          certification.timestamp ? 'TIMESTAMP_BINDING_CHECKED' : 'TIMESTAMP_NOT_PRESENT',
          certification.timestamp
            ? 'La huella del token y su vinculo con el paquete coinciden; la revocacion remota de la TSA puede requerir una consulta adicional.'
            : 'No existe una estampa RFC 3161 asociada.'
        )
      );
      if (certification.timestamp?.status === 'VALID')
        warnings.push(
          'La disponibilidad de OCSP/CRL de la TSA no se confirma en esta consulta local.'
        );
    } catch {
      checks.push(
        check(
          'EVIDENCE_CHAIN',
          'CERTIFICATION_ENGINE',
          'INDETERMINATE',
          'CERTIFICATION_ENGINE_UNAVAILABLE',
          'No fue posible completar la comprobacion de la certificacion en este momento.'
        )
      );
    }
  } else {
    checks.push(
      check(
        'EVIDENCE_CHAIN',
        'CERTIFICATION_ENGINE',
        'NOT_PRESENT',
        'CERTIFICATION_NOT_PRESENT',
        'Este documento no tiene una certificacion criptografica consolidada.'
      )
    );
  }

  checks.push(
    check(
      'PDF_PADES',
      'PADES_SIGNATURE',
      document.certificationVerificationUuid ? 'NOT_VERIFIED' : 'NOT_APPLICABLE',
      document.certificationVerificationUuid
        ? 'PADES_REVALIDATION_REQUIRED'
        : 'PADES_NOT_APPLICABLE',
      document.certificationVerificationUuid
        ? 'El PDF certificado esta registrado, pero la firma PAdES debe revalidarse con el validador especializado.'
        : 'No se registro una firma PAdES para este esquema.'
    )
  );
  checks.push(
    check(
      'XML_XMLDSIG',
      'XML_EVIDENCE',
      document.xmlPresent ? 'NOT_VERIFIED' : 'NOT_APPLICABLE',
      document.xmlPresent ? 'XML_REGISTERED_NOT_REVALIDATED' : 'XML_NOT_APPLICABLE',
      document.xmlPresent
        ? 'Existe XML de evidencia, pendiente de validar XSD, XMLDSig y correspondencia con el PDF.'
        : 'El esquema de este documento no requiere XML de evidencia.'
    )
  );
  checks.push(
    check(
      'NOM151',
      'NOM151_CONSTANCY',
      document.nom151Present ? 'NOT_VERIFIED' : 'NOT_APPLICABLE',
      document.nom151Present ? 'NOM151_REGISTERED_NOT_REVALIDATED' : 'NOM151_NOT_APPLICABLE',
      document.nom151Present
        ? 'Existe una constancia NOM-151 registrada; su token y cadena del PSC requieren validacion criptografica.'
        : 'No existe constancia NOM-151 para este documento.'
    )
  );

  const overallStatus = consolidate(checks, Boolean(certification));
  const presentation = present(overallStatus);
  return {
    verificationId: randomUUID(),
    method: input.method,
    overallStatus,
    headline: presentation.headline,
    message: presentation.message,
    validatorVersion: VERIFIER_VERSION,
    checkedAt,
    schemaVersion: document.certificationVerificationUuid
      ? 'manifest-v4'
      : document.xmlPresent
        ? 'legacy-v3'
        : document.nom151Present
          ? 'legacy-v2'
          : 'legacy-v1',
    document: {
      id: document.id,
      folio: document.folio,
      name: document.name,
      status: document.status,
      isPublic: document.isPublic,
      issuer: document.issuer,
      workspace: document.workspaceName,
      fileSize: document.fileSize || null,
      pageCount: document.pageCount || null,
      createdAt: document.createdAt,
      completedAt: document.completedAt,
      documentUrl: null,
      participantCount: document.participants.length,
      participants: document.participants,
    },
    artifactMatches: input.artifactMatches?.length ? input.artifactMatches : document.hashes,
    certification: certificationDetails,
    checks,
    warnings,
  };
}

function check(
  engine: VerificationEngine,
  checkType: string,
  status: VerificationStatus,
  code: string,
  message: string
): VerificationCheck {
  return { engine, checkType, status, code, message, checkedAt: new Date().toISOString() };
}

function consolidate(checks: VerificationCheck[], hasCertification: boolean): VerificationStatus {
  const statuses = checks.map((item) => item.status);
  if (
    statuses.some((status) =>
      ['TAMPERED', 'HASH_MISMATCH', 'INVALID_SIGNATURE', 'INVALID'].includes(status)
    )
  )
    return statuses.includes('HASH_MISMATCH') ? 'HASH_MISMATCH' : 'INVALID';
  if (statuses.some((status) => ['UNTRUSTED_CERTIFICATE', 'UNTRUSTED_PROVIDER'].includes(status)))
    return 'VERIFIED_WITH_WARNINGS';
  if (hasCertification && statuses.includes('VERIFIED')) {
    return statuses.some((status) =>
      ['NOT_VERIFIED', 'INDETERMINATE', 'REVOCATION_UNKNOWN', 'VERIFIED_WITH_WARNINGS'].includes(
        status
      )
    )
      ? 'VERIFIED_WITH_WARNINGS'
      : 'VERIFIED';
  }
  if (statuses.includes('VERIFIED')) return 'VERIFIED_WITH_WARNINGS';
  if (statuses.includes('REGISTERED')) return 'REGISTERED';
  return 'INDETERMINATE';
}

function present(status: VerificationStatus) {
  if (status === 'VERIFIED')
    return {
      headline: 'Documento integro y evidencias criptograficas verificadas',
      message: 'Las comprobaciones disponibles finalizaron satisfactoriamente.',
    };
  if (status === 'VERIFIED_WITH_WARNINGS')
    return {
      headline: 'Integridad verificada con advertencias',
      message:
        'Las comprobaciones principales fueron satisfactorias, pero uno o mas componentes requieren confirmacion adicional.',
    };
  if (status === 'HASH_MISMATCH')
    return {
      headline: 'El documento no coincide con el registro',
      message: 'La huella digital calculada es diferente a la registrada por Docubox.',
    };
  if (status === 'REGISTERED')
    return {
      headline: 'Documento localizado en Docubox',
      message:
        'El registro existe, pero no hay evidencia suficiente para afirmar una verificacion criptografica integral.',
    };
  return {
    headline: 'No fue posible determinar la verificacion',
    message:
      'Revisa el detalle tecnico o intenta nuevamente cuando los servicios requeridos esten disponibles.',
  };
}
