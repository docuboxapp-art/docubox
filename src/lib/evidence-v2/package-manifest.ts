import { canonicalizeRFC8785, sha256Hex } from '@/lib/certification/canonical';

export type EvidenceManifestFile = {
  path: string;
  mediaType: string;
  size: number;
  sha256: string;
  relation: string;
};

type EvidenceManifestPackage = {
  package_id: string;
  evidence_version: string;
  schema_version: string;
  generated_at: string;
  evidence_root_sha256: string;
  package_digest_sha256: string;
  verification_summary?: Record<string, unknown> | null;
};

export function createEvidenceManifest(input: {
  documentId: string;
  packageRow: EvidenceManifestPackage;
  files: EvidenceManifestFile[];
  supplements: Array<{ supplement_sha256: string }>;
}) {
  const supplementSetHash = sha256Hex(
    canonicalizeRFC8785({
      schema: 'docubox-evidence-supplement-set-v1',
      hashes: input.supplements.map((item) => item.supplement_sha256),
    })
  );
  return {
    DocumentID: input.documentId,
    BasePackageID: input.packageRow.package_id,
    EvidenceVersion: input.packageRow.evidence_version,
    SchemaVersion: input.packageRow.schema_version,
    GeneratedAt: input.packageRow.generated_at,
    EvidenceRoot: input.packageRow.evidence_root_sha256,
    PackageDigest: input.packageRow.package_digest_sha256,
    SupplementSetHash: supplementSetHash,
    files: input.files,
    pendingItems: Object.entries(input.packageRow.verification_summary || {})
      .filter(([, value]) => value === 'pending')
      .map(([key]) => key),
    notApplicableItems: Object.entries(input.packageRow.verification_summary || {})
      .filter(([, value]) => value === 'not_applicable')
      .map(([key]) => key),
  };
}

export function evidenceReadme() {
  return [
    'PAQUETE DE EVIDENCIA DOCUBOX',
    '',
    '01-documento contiene el PDF firmado final.',
    '02-evidencia contiene el XML inmutable que vincula documento, firmas, eventos y certificaciones.',
    '03-constancias contiene constancias de firma o NOM-151 cuando sean aplicables.',
    '04-tiempo contiene tokens RFC 3161 y pruebas OpenTimestamps disponibles.',
    '05-certificados contiene certificados y reportes técnicos disponibles.',
    '06-firmas contiene artefactos técnicos de firmas autógrafas o e.firma.',
    '07-suplementos contiene certificaciones posteriores; no modifica el XML base.',
    '',
    'manifest.json enumera cada archivo y su SHA-256 para comprobar integridad.',
    'La verificación técnica debe considerar los estados y políticas indicados; este contenedor no constituye por sí solo una conclusión jurídica.',
  ].join('\n');
}
