import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';

function digest(value: string) {
  return createHash('sha256').update(value).digest();
}

export function isInternalAdminRequest(request: NextRequest | Request) {
  const configured = process.env.DOCUBOX_ADMIN_API_SECRET || '';
  const supplied = request.headers.get('x-docubox-admin-secret') || '';
  if (configured.length < 32 || !supplied) return false;
  return timingSafeEqual(digest(configured), digest(supplied));
}
