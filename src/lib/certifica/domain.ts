export const CERTIFICATION_SERVICES = {
  integrity: {
    name: 'Integridad Docubox',
    shortName: 'Integridad',
    requiresPsc: false,
    price: 0,
    description: 'Hash SHA-256, folio, manifiesto, constancia visual y verificacion publica.',
  },
  certified_time: {
    name: 'Tiempo certificado',
    shortName: 'Tiempo',
    requiresPsc: true,
    price: 89,
    description: 'Integridad Docubox y estampa de tiempo emitida por un PSC.',
  },
  nom151: {
    name: 'Constancia NOM-151',
    shortName: 'NOM-151',
    requiresPsc: true,
    price: 149,
    description: 'Constancia de conservacion, expediente probatorio y custodia.',
  },
  evidence_pro: {
    name: 'Evidencia Pro',
    shortName: 'Evidencia Pro',
    requiresPsc: true,
    price: 249,
    description: 'NOM-151, analisis de firmas, cadena de evidencia y custodia extendida.',
  },
} as const;

export type CertificationServiceKey = keyof typeof CERTIFICATION_SERVICES;

export const CERTIFICATION_STATUS = {
  draft: { label: 'Borrador', tone: 'gray', progress: 10 },
  analyzing: { label: 'Analizando', tone: 'blue', progress: 30 },
  ready: { label: 'Lista para confirmar', tone: 'amber', progress: 55 },
  awaiting_approval: { label: 'Pendiente de aprobacion', tone: 'amber', progress: 60 },
  reserved: { label: 'Credito reservado', tone: 'blue', progress: 65 },
  submitted_to_psc: { label: 'Enviada al PSC', tone: 'blue', progress: 72 },
  processing: { label: 'Procesando', tone: 'blue', progress: 80 },
  issued: { label: 'Emitida', tone: 'green', progress: 92 },
  validated: { label: 'Validada', tone: 'green', progress: 100 },
  issued_with_warnings: { label: 'Emitida con advertencias', tone: 'amber', progress: 100 },
  provider_error: { label: 'Error del proveedor', tone: 'red', progress: 70 },
  requires_review: { label: 'Requiere revision', tone: 'amber', progress: 45 },
  rejected: { label: 'Rechazada', tone: 'red', progress: 100 },
  cancelled: { label: 'Cancelada', tone: 'gray', progress: 100 },
  stored: { label: 'Bajo custodia', tone: 'green', progress: 100 },
  retention_due: { label: 'Custodia por vencer', tone: 'amber', progress: 100 },
  retention_closed: { label: 'Custodia cerrada', tone: 'gray', progress: 100 },
} as const;

export type CertificationStatus = keyof typeof CERTIFICATION_STATUS;

export const PURPOSE_RECOMMENDATION: Record<string, CertificationServiceKey> = {
  prove_integrity: 'integrity',
  prove_existence: 'certified_time',
  nom151_conservation: 'nom151',
  validate_signatures: 'evidence_pro',
  complete_evidence: 'evidence_pro',
};

export const CERTIFICATION_DECLARATION = {
  version: '2026-08-1',
  text: 'Declaro que cuento con facultades para solicitar el servicio sobre este archivo, que el documento cargado corresponde a la version que deseo certificar y que comprendo el alcance del producto seleccionado.',
};

export function isCertificationService(value: unknown): value is CertificationServiceKey {
  return typeof value === 'string' && value in CERTIFICATION_SERVICES;
}

export function buildCanonicalManifest(input: {
  certificationId: string;
  publicId: string;
  folio: string;
  workspaceId: string;
  title: string;
  serviceKey: CertificationServiceKey;
  originalSha256: string;
  originalFilename: string;
  originalSizeBytes: number;
  createdAt: string;
  issuedAt: string;
  providerMode: 'sandbox' | 'production';
}) {
  return {
    schema: 'DOCUBOX_CERTIFICA_MANIFEST',
    schema_version: '1.0',
    canonicalization: 'JCS-RFC8785',
    digest_algorithm: 'SHA-256',
    certification_id: input.certificationId,
    public_id: input.publicId,
    folio: input.folio,
    workspace_id: input.workspaceId,
    title: input.title,
    service_key: input.serviceKey,
    original: {
      filename: input.originalFilename,
      sha256: input.originalSha256,
      size_bytes: input.originalSizeBytes,
    },
    created_at: input.createdAt,
    issued_at: input.issuedAt,
    provider_mode: input.providerMode,
    legal_validity: input.providerMode === 'production',
    warning:
      input.providerMode === 'sandbox' && input.serviceKey !== 'integrity'
        ? 'NO VALIDO / DEMOSTRACION'
        : null,
  };
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
