import { createHmac, timingSafeEqual } from 'node:crypto';

type JobTokenPayload = { jobId: string; userId: string; expiresAt: number };

function signingKey() {
  const key = process.env.CLOUDCONVERT_API_KEY;
  if (!key) throw new Error('Conversion job signing is not configured.');
  return key;
}

function signature(encoded: string) {
  return createHmac('sha256', signingKey()).update(encoded).digest('base64url');
}

export function issueConversionJobToken(jobId: string, userId: string) {
  const encoded = Buffer.from(
    JSON.stringify({ jobId, userId, expiresAt: Date.now() + 15 * 60_000 } satisfies JobTokenPayload)
  ).toString('base64url');
  return `${encoded}.${signature(encoded)}`;
}

export function verifyConversionJobToken(token: string | null, jobId: string, userId: string) {
  if (!token) return false;
  const [encoded, received] = token.split('.');
  if (!encoded || !received) return false;
  const expected = signature(encoded);
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  if (
    receivedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(receivedBytes, expectedBytes)
  )
    return false;
  try {
    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as JobTokenPayload;
    return payload.jobId === jobId && payload.userId === userId && payload.expiresAt > Date.now();
  } catch {
    return false;
  }
}
