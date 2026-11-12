const TEMPORARY_DATABASE_CODES = new Set(['PGRST002', '57014', '08006', '08P01']);
const TEMPORARY_HTTP_STATUSES = new Set([502, 503, 504, 520, 522]);

export function isTemporaryDatabaseFailure(
  error: { code?: string | null } | null | undefined,
  status?: number
): boolean {
  return Boolean(
    (error?.code && TEMPORARY_DATABASE_CODES.has(error.code)) ||
    (typeof status === 'number' && TEMPORARY_HTTP_STATUSES.has(status))
  );
}
