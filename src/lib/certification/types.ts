export type CertificationStatus =
  | 'PENDING'
  | 'FREEZING_DOCUMENT'
  | 'HASHING_DOCUMENT'
  | 'BUILDING_DOCUMENT_CHAIN'
  | 'SIGNING_DOCUMENT_CHAIN'
  | 'BUILDING_EVIDENCE_MANIFEST'
  | 'BUILDING_EVIDENCE_CHAIN'
  | 'SIGNING_EVIDENCE_CHAIN'
  | 'REQUESTING_TIMESTAMP'
  | 'VALIDATING_TIMESTAMP'
  | 'RENDERING_CERTIFICATE'
  | 'APPENDING_CERTIFICATE'
  | 'SIGNING_FINAL_PDF'
  | 'COMPLETED'
  | 'FAILED'
  | 'REVOKED';

export type KmsPurpose = 'DOCUMENT_SEAL' | 'EVIDENCE_SEAL';

export interface VerifiedKmsSignature {
  status: 'VALID';
  signatureBase64: string;
  signatureSha256: string;
  algorithm: 'RSA-PSS-SHA256';
  keySizeBits: number;
  keyId: string;
  keyVersion: string;
  publicKeyPem: string;
  publicKeyFingerprintSha256: string;
  certificatePem: string | null;
  certificateFingerprintSha256: string | null;
  signedAt: string;
}

export interface VerifiedTimestamp {
  standard: 'RFC3161';
  status: 'VALID';
  messageImprintSha256: string;
  requestBytes: Uint8Array | null;
  responseBytes: Uint8Array;
  tokenBytes: Uint8Array;
  genTime: string;
  tsaName: string;
  tsaPolicyOid: string;
  tsaSerialNumber: string;
  tsaNonce: string | null;
  certificateSerialNumber: string;
  certificateFingerprintSha256: string;
  issuer: string;
  certificatePem: string;
  chainPem: string;
  verifiedAt: string;
}

export interface EvidenceItem {
  evidence_uuid: string;
  evidence_type: string;
  file_sha256: string;
  metadata_sha256: string;
  mime_type: string;
  size_bytes: number;
  storage_object_version: string | null;
  generated_at: string;
}

export interface CertificationSummary {
  certificationUuid: string;
  verificationUuid: string;
  documentId: string;
  documentFolio: string;
  status: CertificationStatus;
  createdAt: string;
  completedAt: string | null;
  documentBodySha256: string | null;
  certifiedPdfSha256: string | null;
  certificationRootSha256: string | null;
  timestampStatus: string | null;
  timestampGenTime: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export class CertificationError extends Error {
  constructor(public readonly code: string, message: string, public readonly httpStatus = 422) {
    super(message);
    this.name = 'CertificationError';
  }
}
