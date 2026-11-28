import { getPublicAppUrl } from '@/lib/publicAppUrl';

const EVIDENCE_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const EVIDENCE_REFERENCE =
  /^([a-f0-9]{8})([a-f0-9]{4})(4[a-f0-9]{3})([89ab][a-f0-9]{3})([a-f0-9]{12})$/i;

export function getSignatureVerificationUrl(evidenceId: unknown) {
  if (typeof evidenceId !== 'string' || !EVIDENCE_UUID.test(evidenceId)) return null;
  const reference = evidenceId.toLowerCase().replaceAll('-', '');
  return `${getPublicAppUrl()}/v/f/${reference}`;
}

export function parseSignatureVerificationReference(reference: string) {
  const match = reference.match(EVIDENCE_REFERENCE);
  return match ? match.slice(1).join('-').toLowerCase() : null;
}
