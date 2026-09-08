export interface DocumentFieldClassification {
  label: string;
  placementKind?: 'participant' | 'general' | 'cryptographic';
  cryptographicType?: 'document_chain' | 'document_seal' | 'timestamp' | 'evidence_chain';
}

/**
 * Cryptographic placements belong to the finalized document, not to a participant.
 * Labels are also checked to support documents created before classification existed.
 */
export function isDocumentGeneratedCryptographicField(
  field: DocumentFieldClassification
): boolean {
  if (
    field.placementKind === 'cryptographic' ||
    field.cryptographicType === 'document_chain' ||
    field.cryptographicType === 'document_seal'
  ) {
    return true;
  }

  const normalizedLabel = field.label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

  return normalizedLabel === 'cadena original' || normalizedLabel === 'sello digital';
}
