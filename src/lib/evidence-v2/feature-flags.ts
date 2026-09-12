function enabled(value: string | undefined) {
  return ['1', 'true', 'enabled'].includes(
    String(value || '')
      .trim()
      .toLowerCase()
  );
}

/** Backend-only gate. v2 is never enabled by browser-controlled input. */
export function isEvidenceV2Enabled() {
  const environment = String(
    process.env.VERCEL_ENV || process.env.NODE_ENV || 'development'
  ).toLowerCase();
  if (environment === 'production') return enabled(process.env.DOCUBOX_EVIDENCE_V2_ENABLED);
  return !['0', 'false', 'disabled'].includes(
    String(process.env.DOCUBOX_EVIDENCE_V2_ENABLED || '')
      .trim()
      .toLowerCase()
  );
}

/** KMS signing remains independently opt-in after a provider health check. */
export function isEvidenceV2KmsSigningEnabled() {
  if (!isEvidenceV2Enabled()) return false;
  const environment = String(
    process.env.VERCEL_ENV || process.env.NODE_ENV || 'development'
  ).toLowerCase();
  if (environment === 'production')
    return enabled(process.env.DOCUBOX_EVIDENCE_V2_KMS_SIGNING_ENABLED);
  return !['0', 'false', 'disabled'].includes(
    String(process.env.DOCUBOX_EVIDENCE_V2_KMS_SIGNING_ENABLED || '')
      .trim()
      .toLowerCase()
  );
}
