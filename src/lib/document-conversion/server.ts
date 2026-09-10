import { createServiceClient } from '@/lib/supabase/server';
import { createHash } from 'node:crypto';
import { DocumentConversionError, type ConversionErrorCode } from './types';

function boundedEnvironmentInteger(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

const OFFICE_CONVERSION_USER_LIMIT = boundedEnvironmentInteger(
  'OFFICE_CONVERSION_USER_LIMIT',
  3,
  1,
  20
);
const OFFICE_CONVERSION_WINDOW_SECONDS = boundedEnvironmentInteger(
  'OFFICE_CONVERSION_WINDOW_SECONDS',
  86_400,
  60,
  604_800
);

export async function requireConversionUser(request: Request) {
  const authorization = request.headers.get('authorization');
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
  if (!token) return null;
  const { data, error } = await createServiceClient().auth.getUser(token);
  return error ? null : data.user;
}

/**
 * Atomically reserves a conversion attempt before any provider call creates a job.
 * The database only receives an irreversible hash, never the user identifier or file data.
 */
export async function reserveOfficeConversionAttempt(userId: string) {
  const keyHash = createHash('sha256')
    .update(`document-conversion:office:user:${userId}`)
    .digest('hex');
  const { data, error } = await createServiceClient().rpc('consume_server_rate_limit', {
    p_key_hash: keyHash,
    p_limit: OFFICE_CONVERSION_USER_LIMIT,
    p_window_seconds: OFFICE_CONVERSION_WINDOW_SECONDS,
  });
  if (error || data !== true) {
    if (error) throw new DocumentConversionError('CONVERSION_PROVIDER_UNAVAILABLE', 503);
    throw new DocumentConversionError(
      'CONVERSION_USAGE_LIMITED',
      429,
      OFFICE_CONVERSION_WINDOW_SECONDS * 1000
    );
  }
}

export function conversionErrorResponse(error: unknown) {
  const code: ConversionErrorCode =
    error instanceof DocumentConversionError ? error.code : 'CONVERSION_FAILED';
  const status = error instanceof DocumentConversionError ? error.httpStatus : 500;
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  if (error instanceof DocumentConversionError && error.retryAfterMs !== undefined) {
    headers.set('Retry-After', String(Math.ceil(error.retryAfterMs / 1000)));
  }
  // Only the normalized code is suitable for diagnostics; provider payloads can contain sensitive URLs.
  console.warn('[document-conversion]', code);
  return Response.json({ code }, { status, headers });
}
