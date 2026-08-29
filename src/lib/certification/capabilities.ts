export type CryptoCapabilityStatus =
  | 'not_configured'
  | 'pending'
  | 'processing'
  | 'development'
  | 'valid'
  | 'invalid'
  | 'unavailable'
  | 'manual_review'
  | 'not_applicable';

export type CertificationExecutionStatus =
  | 'created'
  | 'queued'
  | 'processing'
  | 'retrying'
  | 'manual_review'
  | 'completed'
  | 'failed';

export type CertificationCapabilityState = {
  integrityStatus: CryptoCapabilityStatus;
  pdfSignatureStatus: CryptoCapabilityStatus;
  certificateStatus: CryptoCapabilityStatus;
  timestampStatus: CryptoCapabilityStatus;
  verificationStatus: CryptoCapabilityStatus;
  nom151Status: CryptoCapabilityStatus;
};

export const EVIDENCE_SCHEMA_VERSION = 'docubox-evidence-v1';
export const SOURCE_HASH_ALGORITHM = 'SHA-256';

export const FOUNDATION_CAPABILITIES: CertificationCapabilityState = Object.freeze({
  integrityStatus: 'valid',
  pdfSignatureStatus: 'not_configured',
  certificateStatus: 'not_configured',
  timestampStatus: 'not_configured',
  verificationStatus: 'pending',
  nom151Status: 'not_configured',
});

export const VERIFIED_PROVIDER_CAPABILITIES: CertificationCapabilityState = Object.freeze({
  integrityStatus: 'valid',
  pdfSignatureStatus: 'valid',
  certificateStatus: 'valid',
  timestampStatus: 'valid',
  verificationStatus: 'valid',
  nom151Status: 'not_configured',
});

/**
 * A provider response is not evidence of independent cryptographic verification.
 * Keep these states explicit until the PAdES, X.509 and RFC 3161 work packages
 * persist and verify their respective artifacts.
 */
export const DEVELOPMENT_PROVIDER_CAPABILITIES: CertificationCapabilityState = Object.freeze({
  integrityStatus: 'valid',
  pdfSignatureStatus: 'manual_review',
  certificateStatus: 'manual_review',
  timestampStatus: 'not_configured',
  verificationStatus: 'manual_review',
  nom151Status: 'not_configured',
});

/** A cryptographically verified PAdES-B-B signature, without RFC 3161 yet. */
export const PADES_BB_CAPABILITIES: CertificationCapabilityState = Object.freeze({
  integrityStatus: 'valid',
  pdfSignatureStatus: 'valid',
  certificateStatus: 'valid',
  timestampStatus: 'not_configured',
  verificationStatus: 'valid',
  nom151Status: 'not_configured',
});

/** A verified CMS signature plus a verified RFC 3161 signature timestamp. */
export const PADES_BT_CAPABILITIES: CertificationCapabilityState = Object.freeze({
  integrityStatus: 'valid',
  pdfSignatureStatus: 'valid',
  certificateStatus: 'valid',
  timestampStatus: 'valid',
  verificationStatus: 'valid',
  nom151Status: 'not_configured',
});

export function isPositiveCryptoStatus(status: CryptoCapabilityStatus) {
  return status === 'valid';
}
