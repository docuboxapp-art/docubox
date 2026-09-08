import { createHmac, timingSafeEqual } from 'crypto';

const COOKIE_PREFIX = 'docubox_document_view_';
const ACCESS_TTL_SECONDS = 60 * 30;

function signingKey() {
  const key = process.env.DOCUMENT_VIEW_ACCESS_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Document view access signing key is not configured.');
  return key;
}

function signature(payload: string) {
  return createHmac('sha256', signingKey()).update(payload).digest('base64url');
}

export function documentViewCookieName(documentId: string) {
  return `${COOKIE_PREFIX}${documentId}`;
}

export function createDocumentViewAccessToken(documentId: string, userId: string) {
  const expiresAt = Math.floor(Date.now() / 1000) + ACCESS_TTL_SECONDS;
  const payload = `${documentId}.${userId}.${expiresAt}`;
  return { token: `${payload}.${signature(payload)}`, expiresAt };
}

export function hasDocumentViewAccess(token: string | undefined, documentId: string, userId: string) {
  if (!token) return false;
  const [tokenDocumentId, tokenUserId, rawExpiresAt, providedSignature] = token.split('.');
  if (!tokenDocumentId || !tokenUserId || !rawExpiresAt || !providedSignature) return false;
  const payload = `${tokenDocumentId}.${tokenUserId}.${rawExpiresAt}`;
  const expectedSignature = signature(payload);
  if (providedSignature.length !== expectedSignature.length) return false;
  if (!timingSafeEqual(Buffer.from(providedSignature), Buffer.from(expectedSignature))) return false;
  return (
    tokenDocumentId === documentId &&
    tokenUserId === userId &&
    Number(rawExpiresAt) > Math.floor(Date.now() / 1000)
  );
}

export const DOCUMENT_VIEW_ACCESS_TTL_SECONDS = ACCESS_TTL_SECONDS;
