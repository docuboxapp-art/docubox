import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';

export function isAuthorizedOpenTimestampsWorker(request: NextRequest) {
  const expected = process.env.OTS_WORKER_SECRET || process.env.CRON_SECRET;
  const presented = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (!expected || expected.length !== presented.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(presented));
}
