import { createHash } from 'node:crypto';

type CertificateFolioKind = 'GEN' | 'IND-AUT' | 'IND-EF' | 'IND-CS' | 'IND';

function compactIdentifier(value: string, length: number) {
  const compact = String(value || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  return compact.slice(0, length) || 'SINID';
}

function certificateYear(value: unknown) {
  const date = value ? new Date(String(value)) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().getUTCFullYear() : date.getUTCFullYear();
}

export function abbreviateDocuboxFolio(value: unknown) {
  return String(value || '').replace(/^DOCUBOX-/i, 'DBX-');
}

export function createCertificateFolio(params: {
  kind: CertificateFolioKind;
  documentId: string;
  occurredAt?: unknown;
  participantKey?: string;
}) {
  const base = `DBX-${params.kind}-${certificateYear(params.occurredAt)}-${compactIdentifier(params.documentId, 8)}`;
  if (!params.participantKey) return base;
  const participantSuffix = createHash('sha256')
    .update(params.participantKey.trim().toLowerCase())
    .digest('hex')
    .slice(0, 6)
    .toUpperCase();
  return `${base}-${participantSuffix}`;
}
