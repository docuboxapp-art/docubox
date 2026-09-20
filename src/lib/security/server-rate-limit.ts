import 'server-only';

import { createHash } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/server';

export class ServerRateLimitUnavailableError extends Error {
  constructor() {
    super('SERVER_RATE_LIMIT_UNAVAILABLE');
    this.name = 'ServerRateLimitUnavailableError';
  }
}

export async function consumeServerRateLimit(input: {
  scope: string;
  identifiers: string[];
  limit: number;
  windowSeconds: number;
}) {
  const normalized = input.identifiers.map((value) => value.trim().toLowerCase()).join(':');
  const keyHash = createHash('sha256').update(`docubox:${input.scope}:${normalized}`).digest('hex');
  const result = await createServiceClient().rpc('consume_server_rate_limit', {
    p_key_hash: keyHash,
    p_limit: input.limit,
    p_window_seconds: input.windowSeconds,
  });
  if (result.error) {
    console.error('[server-rate-limit] Distributed limiter unavailable', {
      scope: input.scope,
      code: result.error.code || null,
    });
    throw new ServerRateLimitUnavailableError();
  }
  return result.data === true;
}
