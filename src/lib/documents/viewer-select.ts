export const DOCUMENT_VIEWER_SELECT =
  'id, documento_id, nombre, estado, owner_id, file_url, file_size, file_type, file_hash_sha256, es_publico, legal_hold, legal_hold_status, created_at, updated_at, tiene_vencimiento, tiene_codigo_acceso, metadatos_adicionales, fecha_vencimiento, fecha_vencimiento_timezone, carpeta_id, campos_solicitados, workspace_id, source_template_id, current_custodian_workspace_id, custody_updated_at, cancelacion_motivo, cancelacion_descripcion, cancelado_at, fecha_completado, participantes, sealed_pdf_path, xml_evidencia_path, xml_hash_sha256, xml_generated_at, blockchain_evidence_enabled';

export const LEGACY_DOCUMENT_VIEWER_SELECT =
  'id, documento_id, nombre, estado, owner_id, file_url, file_size, file_type, file_hash_sha256, es_publico, legal_hold, legal_hold_status, created_at, updated_at, tiene_vencimiento, tiene_codigo_acceso, metadatos_adicionales, fecha_vencimiento, fecha_vencimiento_timezone, carpeta_id, campos_solicitados, workspace_id, cancelacion_motivo, cancelacion_descripcion, cancelado_at, fecha_completado, participantes, sealed_pdf_path, xml_evidencia_path, xml_hash_sha256, xml_generated_at, blockchain_evidence_enabled';

type PostgrestErrorLike = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

const OPTIONAL_CUSTODY_COLUMNS = [
  'current_custodian_workspace_id',
  'custody_updated_at',
  'source_template_id',
] as const;

export function isMissingDocumentCustodyColumns(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const candidate = error as PostgrestErrorLike;
  const message = [candidate.message, candidate.details, candidate.hint]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const mentionsOptionalColumn = OPTIONAL_CUSTODY_COLUMNS.some((column) =>
    message.includes(column)
  );

  if (!mentionsOptionalColumn) return false;

  return (
    candidate.code === 'PGRST204' ||
    candidate.code === '42703' ||
    message.includes('schema cache') ||
    message.includes('does not exist') ||
    message.includes('no existe')
  );
}
