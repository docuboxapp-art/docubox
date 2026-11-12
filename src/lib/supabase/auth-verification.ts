/** Only a definitive rejection may discard an existing browser session. */
export function isDefinitivelyInvalidAuthToken(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { status?: unknown; code?: unknown };
  if (typeof candidate.status === 'number' && candidate.status >= 500) return false;
  if (candidate.status === 401) return true;
  return (
    candidate.code === 'bad_jwt' ||
    candidate.code === 'invalid_token' ||
    candidate.code === 'refresh_token_not_found'
  );
}
