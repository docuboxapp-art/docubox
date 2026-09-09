function enabled(value: string | undefined) {
  return ['1', 'true', 'enabled'].includes(
    String(value || '')
      .trim()
      .toLowerCase()
  );
}

/** Backend-only gate. v2 is never enabled by browser-controlled input. */
export function isEvidenceV2Enabled() {
  return enabled(process.env.DOCUBOX_EVIDENCE_V2_ENABLED);
}

/** KMS signing remains independently opt-in after a provider health check. */
export function isEvidenceV2KmsSigningEnabled() {
  return isEvidenceV2Enabled() && enabled(process.env.DOCUBOX_EVIDENCE_V2_KMS_SIGNING_ENABLED);
}
