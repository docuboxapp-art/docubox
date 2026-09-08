import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { isAuthorizedOpenTimestampsWorker } from '@/lib/blockchain-evidence/internal-auth';
import { processPendingBlockchainEvidence } from '@/lib/blockchain-evidence/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isAuthorizedOpenTimestampsWorker(request)) return new NextResponse(null, { status: 404 });
  try {
    const result = await processPendingBlockchainEvidence(createServiceClient(), {
      workerId: request.headers.get('x-vercel-id') || `upgrade-${crypto.randomUUID()}`,
      limit: 20,
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[opentimestamps] Upgrade worker failed', {
      code: error instanceof Error ? error.name : 'OTS_UPGRADE_FAILED',
    });
    return NextResponse.json({ error: 'No fue posible ejecutar el worker.' }, { status: 500 });
  }
}
