import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { isAuthorizedOpenTimestampsWorker } from '@/lib/blockchain-evidence/internal-auth';
import { processGeneratedBlockchainEvidence } from '@/lib/blockchain-evidence/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isAuthorizedOpenTimestampsWorker(request)) return new NextResponse(null, { status: 404 });
  try {
    const result = await processGeneratedBlockchainEvidence(createServiceClient(), {
      workerId: request.headers.get('x-vercel-id') || `stamp-${crypto.randomUUID()}`,
      limit: 10,
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[opentimestamps] Stamp worker failed', {
      code: error instanceof Error ? error.name : 'OTS_STAMP_FAILED',
    });
    return NextResponse.json({ error: 'No fue posible ejecutar el worker.' }, { status: 500 });
  }
}
