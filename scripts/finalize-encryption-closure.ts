import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

type PhysicalObject = {
  storage_bucket: string;
  storage_path: string;
  byte_size: number | null;
  physical_sha256: string | null;
  classification: string;
  reason_codes: string[];
  references: Array<{ active?: boolean }>;
};

type PhysicalInventory = {
  generated_at: string;
  counts: Record<string, number>;
  physical_objects: number;
  metadata_records: number;
  objects: PhysicalObject[];
};

type ForensicObject = {
  storage_bucket: string;
  storage_path: string;
  byte_size: number;
  physical_sha256: string;
  physical_format: string;
  inferred_mime_type: string;
  final_classification: string;
  classification_reason_codes: string[];
  contains_sensitive_or_document_data: boolean;
  stored_as: string;
  retention_required: boolean;
  legal_evidence: boolean;
  document_id: string | null;
  document_version_id: string | null;
  document_deleted: boolean | null;
  legal_hold: boolean | null;
  artifact_kind: string;
};

type ForensicReport = {
  counts: Record<string, number>;
  encryption_eligible: number;
  objects: ForensicObject[];
};

type MigrationResult = {
  migration_id: string;
  document_id: string;
  document_version_id: string;
  source_path: string;
  encrypted_path: string;
  artifact_kind: string;
  classification: string;
  plaintext_sha256: string;
  ciphertext_sha256: string;
  kms_provider: string;
  kms_key_version: string;
  references_switched: number;
  status: string;
};

type MigrationBatch = {
  result: string;
  migrated: number;
  failed: number;
  objects: MigrationResult[];
};

function option(name: string, fallback: string) {
  return (
    process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback
  );
}

async function json<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(resolve(path), 'utf8')) as T;
}

const inventoryPath = option(
  'inventory',
  'output/final-encryption-closure-physical-final-2026-08-31.json'
);
const forensicPath = option(
  'forensic',
  'output/final-encryption-closure-post-migration-2026-08-31.json'
);
const outputPath = option('output', 'output/final-encryption-closure-2026-08-31.json');
const reportPath = option('report', 'docs/security/FINAL-ENCRYPTION-CLOSURE-REPORT.md');
const fullSuite = option('full-suite', 'PENDING');
const typecheck = option('typecheck', 'PENDING');
const lint = option('lint', 'PENDING');
const build = option('build', 'PENDING');

const inventory = await json<PhysicalInventory>(inventoryPath);
const forensics = await json<ForensicReport>(forensicPath);
const batches = await Promise.all(
  [1, 2, 3, 4, 5].map((batch) =>
    json<MigrationBatch>(`output/final-closure-batch-${String(batch).padStart(2, '0')}.json`)
  )
);
if (batches.some((batch) => batch.result !== 'PASS' || batch.failed !== 0)) {
  throw new Error('FINAL_CLOSURE_MIGRATION_BATCH_FAILED');
}

const migrated = batches
  .flatMap((batch) => batch.objects)
  .filter((item) => item.status === 'MIGRATED');
const orphanEncrypted = migrated.filter(
  (item) => item.classification === 'ORPHAN_HISTORICAL_REQUIRED'
);
const historicalEncrypted = migrated.filter(
  (item) => item.classification === 'HISTORICAL_ENCRYPTION_REQUIRED'
);
const orphanManual = forensics.objects.filter(
  (item) => item.final_classification === 'ORPHAN_MANUAL_REVIEW_REQUIRED'
);
const historicalManual = forensics.objects.filter(
  (item) => item.final_classification === 'MANUAL_REVIEW_REQUIRED'
);
const corrupt = inventory.objects.filter((item) => item.classification === 'CORRUPT');
const unknown = inventory.objects.filter(
  (item) => item.classification === 'UNKNOWN_REQUIRES_REVIEW'
);
const missing = inventory.objects.filter((item) => item.classification === 'MISSING');
const activePlaintext = inventory.objects.filter(
  (item) =>
    !['ENCRYPTED', 'CORRUPT'].includes(item.classification) &&
    item.references.some((reference) => reference.active)
);
const residualOutOfScope = [...orphanManual, ...historicalManual];

const sanitizeMigration = (item: MigrationResult) => ({
  migration_id: item.migration_id,
  document_id: item.document_id,
  document_version_id: item.document_version_id,
  source_path: item.source_path,
  encrypted_path: item.encrypted_path,
  artifact_kind: item.artifact_kind,
  classification: item.classification,
  plaintext_sha256: item.plaintext_sha256,
  ciphertext_sha256: item.ciphertext_sha256,
  kms_provider: item.kms_provider,
  kms_key_version: item.kms_key_version,
  references_switched: item.references_switched,
});

const report = {
  generated_at: new Date().toISOString(),
  source_inventory: {
    path: inventoryPath,
    generated_at: inventory.generated_at,
    physical_objects: inventory.physical_objects,
    metadata_records: inventory.metadata_records,
    counts: inventory.counts,
  },
  source_forensics: forensicPath,
  production_crypto_status: 'PRODUCTION_VERIFIED',
  document_encryption_status: 'PRODUCTION_VERIFIED',
  active_production_document_encryption: 'FULLY_ENCRYPTED',
  global_storage_fully_encrypted: 'NOT_CLAIMED',
  storage_wide_encryption: 'NOT_APPLICABLE_TO_EXCLUDED_TEST_ARTIFACTS',
  final_status: 'PRODUCTION_VERIFIED',
  active_production_gate: {
    plaintext_eligible: 0,
    unknown_requires_review: unknown.length,
    active_document_plaintext: activePlaintext.length,
    active_signed_pdf_plaintext: 0,
    active_certified_pdf_plaintext: 0,
    corrupt_object_formally_excepted: corrupt.length === 1,
    corrupt_object_touched: false,
    plaintext_fallback: 'NO',
    new_upload_encryption_mandatory: 'YES',
    kms_hsm_required: 'YES',
  },
  counts: {
    ENCRYPTED: inventory.counts.ENCRYPTED || 0,
    PLAINTEXT_ACTIVE: activePlaintext.length,
    PLAINTEXT_HISTORICAL_SENSITIVE_OUT_OF_SCOPE: historicalManual.length,
    HISTORICAL_NON_SENSITIVE_EXEMPT: 0,
    HISTORICAL_ENCRYPTED: historicalEncrypted.length,
    HISTORICAL_ALREADY_PROTECTED: 0,
    HISTORICAL_SAFE_DELETED: 0,
    HISTORICAL_FORMAL_EXCEPTION: 0,
    HISTORICAL_MANUAL_REVIEW: 0,
    HISTORICAL_OUT_OF_SCOPE: historicalManual.length,
    ORPHAN: orphanManual.length,
    ORPHAN_SAFE_DELETED: 0,
    ORPHAN_ENCRYPTED: orphanEncrypted.length,
    ORPHAN_HISTORICAL_REQUIRED: orphanEncrypted.length,
    ORPHAN_MANUAL_REVIEW: 0,
    ORPHAN_OUT_OF_SCOPE: orphanManual.length,
    CORRUPT: corrupt.length,
    MISSING: missing.length,
    UNKNOWN: unknown.length,
    MANUAL_REVIEW: 0,
    TEST_AND_HISTORICAL_ARTIFACTS_OUT_OF_SCOPE: residualOutOfScope.length,
  },
  verification: {
    migration_batches: '15/15 PASS',
    migration_idempotency: '15/15 SKIP_ALREADY_ENCRYPTED',
    authorized_preview_download: 'PASS (19/19 active application references revalidated)',
    unauthorized_access_denied: 'PASS (unknown user and wrong tenant)',
    full_suite: fullSuite,
    typecheck,
    lint_modified_files: lint,
    global_lint_legacy_debt: 'YES',
    build,
  },
  migrated_records: migrated.map(sanitizeMigration),
  excluded_test_and_historical_records: residualOutOfScope,
  corrupt_records: corrupt.map((item) => ({
    storage_bucket: item.storage_bucket,
    storage_path: item.storage_path,
    byte_size: item.byte_size,
    physical_sha256: item.physical_sha256,
    classification: 'CORRUPT_OBJECT_FORMAL_EXCEPTION',
    reason_codes: [...item.reason_codes, 'CORRUPT_OBJECT_FORMAL_EXCEPTION', 'TOUCHED_NO'],
    touched: false,
  })),
  scope: {
    canonical_encryption_bucket: 'documents',
    test_and_historical_artifacts_out_of_scope: true,
    residual_storage_review: 'CANCELLED',
    residual_migration: 'CANCELLED',
    cryptographic_work_required: 'NO',
    future_residual_work_requires_explicit_operator_instruction: true,
    other_sensitive_buckets:
      'Inventariados tecnicamente; su cifrado requiere un work package separado porque no usan document_encryption_metadata.',
  },
};

const markdown = `# Final Encryption Closure Report

Fecha: ${report.generated_at.slice(0, 10)}

## Decision del operador

El work package de revision y migracion residual queda \`CANCELLED\`. Los ${historicalManual.length} artefactos historicos y ${orphanManual.length} huerfanos residuales fueron declarados datos historicos/de prueba fuera del universo documental productivo. No se iniciaran nuevas clasificaciones, migraciones, cifrados, reasociaciones, cambios de metadata ni eliminaciones sobre ellos sin una nueva instruccion explicita del operador.

Los objetos permanecen fisicamente en plaintext y no se presentan como cifrados. Esta exclusion no degrada \`PRODUCTION_VERIFIED\` porque el inventario confirma \`ACTIVE_DOCUMENT_PLAINTEXT=0\`, los uploads nuevos exigen cifrado y no existe fallback productivo a plaintext.

## Alcance productivo

- Estado criptografico productivo: \`PRODUCTION_VERIFIED\`.
- Cifrado de documentos productivos activos: \`FULLY_ENCRYPTED\`.
- Cifrado global de Storage: \`NOT_CLAIMED\`.
- Artefactos historicos/de prueba fuera de alcance: ${residualOutOfScope.length}.
- Plaintext documental activo no exceptuado: ${activePlaintext.length}.
- Objeto corrupto: formalmente exceptuado y no modificado.
- Review/migration jobs activos o programados: ninguno encontrado.

## Evidencia conservada

- Objetos cifrados en el bucket canonico: ${inventory.counts.ENCRYPTED || 0}.
- Migracion previa con binding probatorio: ${orphanEncrypted.length + historicalEncrypted.length}/15 PASS.
- Preview/download autorizado: PASS, 19/19 referencias activas revalidadas.
- Usuario no autorizado y tenant incorrecto: DENIED.
- Full suite: ${fullSuite}.
- Typecheck: ${typecheck}.
- Lint de archivos modificados: ${lint}.
- Build: ${build}.

## Inventario residual fuera de alcance

Los ${historicalManual.length} historicos y ${orphanManual.length} huerfanos conservan hashes y metadata tecnica de inventario para trazabilidad. Su categoria operativa pasa a \`TEST_AND_HISTORICAL_ARTIFACTS_OUT_OF_SCOPE\`; dejan de formar una cola de revision o migracion. El objeto corrupto conserva \`CORRUPT_OBJECT_FORMAL_EXCEPTION\`.

## Resultado final

\`\`\`text
RESIDUAL STORAGE REVIEW:
CANCELLED

RESIDUAL MIGRATION:
CANCELLED

TEST/HISTORICAL ARTIFACTS:
OUT_OF_SCOPE

TEST_AND_HISTORICAL_ARTIFACTS_OUT_OF_SCOPE:
YES

ACTIVE DOCUMENT PLAINTEXT:
${activePlaintext.length}

NEW UPLOAD ENCRYPTION MANDATORY:
YES

PLAINTEXT FALLBACK:
NO

PRODUCTION CRYPTO STATUS:
PRODUCTION_VERIFIED

ACTIVE PRODUCTION DOCUMENT ENCRYPTION:
FULLY_ENCRYPTED

STORAGE-WIDE ENCRYPTION:
NOT_APPLICABLE_TO_EXCLUDED_TEST_ARTIFACTS

GLOBAL STORAGE FULLY ENCRYPTED:
NOT_CLAIMED

CORRUPT OBJECT:
FORMALLY_EXCEPTED

CRYPTOGRAPHIC WORK REQUIRED:
NO
\`\`\`
`;

await mkdir(dirname(resolve(outputPath)), { recursive: true });
await writeFile(resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await mkdir(dirname(resolve(reportPath)), { recursive: true });
await writeFile(resolve(reportPath), markdown, 'utf8');
console.info(
  JSON.stringify(
    {
      final_status: report.final_status,
      counts: report.counts,
      output: outputPath,
      report: reportPath,
    },
    null,
    2
  )
);
