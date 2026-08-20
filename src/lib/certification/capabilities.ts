export type CryptoCapabilityStatus =
  | 'not_configured'
  | 'pending'
  | 'development'
  | 'valid'
  | 'invalid'
  | 'unavailable'
  | 'not_applicable';

export type CertificationExecutionStatus = 'created' | 'processing' | 'completed' | 'failed';

export type CertificationCapabilityState = {
  integrityStatus: CryptoCapabilityStatus;
  pdfSignatureStatus: CryptoCapabilityStatus;
  certificateStatus: CryptoCapabilityStatus;
  timestampStatus: CryptoCapabilityStatus;
  verificationStatus: CryptoCapabilityStatus;
};

export const EVIDENCE_SCHEMA_VERSION = 'docubox-evidence-v1';
export const SOURCE_HASH_ALGORITHM = 'SHA-256';

export const FOUNDATION_CAPABILITIES: CertificationCapabilityState = Object.freeze({
  integrityStatus: 'valid',
  pdfSignatureStatus: 'not_configured',
  certificateStatus: 'not_configured',
  timestampStatus: 'not_configured',
  verificationStatus: 'pending',
});

export const VERIFIED_PROVIDER_CAPABILITIES: CertificationCapabilityState = Object.freeze({
  integrityStatus: 'valid',
  pdfSignatureStatus: 'valid',
  certificateStatus: 'valid',
  timestampStatus: 'valid',
  verificationStatus: 'valid',
});

export function isPositiveCryptoStatus(status: CryptoCapabilityStatus) {
  return status === 'valid';
}
