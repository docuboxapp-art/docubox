import { createHash } from 'node:crypto';

export type CanonicalValue = null | boolean | number | string | CanonicalValue[] | { [key: string]: CanonicalValue };

function normalize(value: unknown): CanonicalValue {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.normalize('NFC');
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JCS does not support non-finite numbers');
    return value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object') {
    const result: Record<string, CanonicalValue> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) result[key.normalize('NFC')] = normalize(item);
    }
    return result;
  }
  throw new TypeError(`Unsupported canonical value: ${typeof value}`);
}

function serialize(value: CanonicalValue): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(serialize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${serialize(value[key])}`).join(',')}}`;
}

export function canonicalizeRFC8785(value: unknown): string {
  return serialize(normalize(value));
}

export function sha256Hex(value: string | Uint8Array | ArrayBuffer): string {
  const input = typeof value === 'string'
    ? Buffer.from(value, 'utf8')
    : value instanceof ArrayBuffer
      ? Buffer.from(value)
      : Buffer.from(value);
  return createHash('sha256').update(input).digest('hex');
}

export function canonicalSha256(value: unknown): { canonical: string; sha256: string } {
  const canonical = canonicalizeRFC8785(value);
  return { canonical, sha256: sha256Hex(canonical) };
}

