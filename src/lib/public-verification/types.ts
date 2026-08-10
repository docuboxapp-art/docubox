export const VERIFIER_VERSION = 'docubox-verifier/1.0.0';

export type VerificationStatus =
  | 'VERIFIED'
  | 'VERIFIED_WITH_WARNINGS'
  | 'VERIFIED_OFFLINE'
  | 'REGISTERED'
  | 'NOT_APPLICABLE'
  | 'NOT_PRESENT'
  | 'INDETERMINATE'
  | 'NOT_VERIFIED'
  | 'INVALID'
  | 'TAMPERED'
  | 'HASH_MISMATCH'
  | 'INVALID_SIGNATURE'
  | 'UNTRUSTED_CERTIFICATE'
  | 'UNTRUSTED_PROVIDER'
  | 'REVOCATION_UNKNOWN'
  | 'EXPIRED'
  | 'RENEWAL_REQUIRED'
  | 'UNSUPPORTED_FORMAT'
  | 'NOT_FOUND'
  | 'SERVICE_UNAVAILABLE';

export type VerificationEngine =
  'DOCUMENT_INTEGRITY' | 'PDF_PADES' | 'XML_XMLDSIG' | 'NOM151' | 'RFC3161' | 'EVIDENCE_CHAIN';

export type ArtifactType =
  | 'ORIGINAL_DOCUMENT'
  | 'SIGNED_DOCUMENT'
  | 'EVIDENCE_XML'
  | 'NOM151_CONSTANCY'
  | 'NOM151_TOKEN'
  | 'TIMESTAMP_TOKEN'
  | 'CERTIFICATION_PDF'
  | 'EVIDENCE_MANIFEST'
  | 'EVIDENCE_PACKAGE';

export interface VerificationCheck {
  engine: VerificationEngine;
  checkType: string;
  status: VerificationStatus;
  code: string;
  message: string;
  checkedAt: string;
  technicalDetails?: Record<string, unknown>;
}

export interface VerificationArtifactMatch {
  type: ArtifactType;
  algorithm: string;
  hash: string;
  registeredAt?: string | null;
}

export interface PublicVerificationParticipant {
  name: string;
  email?: string | null;
  role: string;
  status: string;
  signatureMethod?: string | null;
  signedAt?: string | null;
}

export interface PublicCertificationDetails {
  certificationUuid: string;
  verificationUuid: string;
  environment: string;
  status: string;
  documentChain: {
    displayText?: string | null;
    hash?: string | null;
    valid: boolean;
  };
  documentSeal: {
    identifier?: string | null;
    status: string;
    algorithm?: string | null;
    keyVersion?: string | null;
    hash?: string | null;
    signaturePreview?: string | null;
    signedAt?: string | null;
    valid: boolean;
  };
  evidenceChain: {
    displayText?: string | null;
    hash?: string | null;
    valid: boolean;
  };
  evidenceSeal: {
    status: string;
    algorithm?: string | null;
    keyVersion?: string | null;
    hash?: string | null;
    signaturePreview?: string | null;
    valid: boolean;
  };
  timestamp: {
    status: string;
    standard?: string | null;
    generatedAt?: string | null;
    tsaName?: string | null;
    policyOid?: string | null;
    algorithm?: string | null;
    tokenHash?: string | null;
    valid: boolean;
  } | null;
  audit: {
    eventCount: number;
    finalHash?: string | null;
    merkleRoot?: string | null;
    valid: boolean;
  };
}

export interface PublicVerificationResult {
  verificationId: string;
  method:
    'TOKEN' | 'FOLIO' | 'CODE' | 'DOCUMENT' | 'HASH' | 'NOM151' | 'TIMESTAMP' | 'XML' | 'PACKAGE';
  overallStatus: VerificationStatus;
  headline: string;
  message: string;
  validatorVersion: string;
  checkedAt: string;
  schemaVersion: 'legacy-v1' | 'legacy-v2' | 'legacy-v3' | 'manifest-v4';
  document: {
    id: string;
    folio: string;
    name: string;
    status: string;
    isPublic: boolean;
    issuer: string;
    workspace: string;
    fileSize?: number | null;
    pageCount?: number | null;
    createdAt?: string | null;
    completedAt?: string | null;
    documentUrl?: string | null;
    participantCount: number;
    participants: PublicVerificationParticipant[];
  } | null;
  artifactMatches: VerificationArtifactMatch[];
  certification?: PublicCertificationDetails | null;
  checks: VerificationCheck[];
  warnings: string[];
}

export interface LocatedVerificationDocument {
  id: string;
  folio: string;
  name: string;
  status: string;
  isPublic: boolean;
  issuer: string;
  workspaceName: string;
  ownerId: string;
  fileSize?: number | null;
  pageCount?: number | null;
  createdAt?: string | null;
  completedAt?: string | null;
  fileUrl?: string | null;
  sealedPdfPath?: string | null;
  participants: PublicVerificationParticipant[];
  hashes: VerificationArtifactMatch[];
  xmlPresent: boolean;
  nom151Present: boolean;
  certificationVerificationUuid?: string | null;
  certificationStatus?: string | null;
  publicLinkId?: string | null;
  visibilityLevel?: string | null;
}

export const STATUS_LABELS: Record<VerificationStatus, string> = {
  VERIFIED: 'Verificado',
  VERIFIED_WITH_WARNINGS: 'Verificado con advertencias',
  VERIFIED_OFFLINE: 'Verificado localmente',
  REGISTERED: 'Registrado',
  NOT_APPLICABLE: 'No aplica',
  NOT_PRESENT: 'No presente',
  INDETERMINATE: 'Indeterminado',
  NOT_VERIFIED: 'No verificado',
  INVALID: 'Inválido',
  TAMPERED: 'Alterado',
  HASH_MISMATCH: 'Huella no coincide',
  INVALID_SIGNATURE: 'Firma inválida',
  UNTRUSTED_CERTIFICATE: 'Certificado no confiable',
  UNTRUSTED_PROVIDER: 'Proveedor no confiable',
  REVOCATION_UNKNOWN: 'Revocación no disponible',
  EXPIRED: 'Expirado',
  RENEWAL_REQUIRED: 'Renovación requerida',
  UNSUPPORTED_FORMAT: 'Formato no compatible',
  NOT_FOUND: 'No localizado',
  SERVICE_UNAVAILABLE: 'Servicio no disponible',
};
