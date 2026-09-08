import { createHash } from 'node:crypto';

export function hashCapabilityToken(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
