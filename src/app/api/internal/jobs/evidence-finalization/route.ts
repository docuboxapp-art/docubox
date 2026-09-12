import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { isAuthorizedOpenTimestampsWorker } from '@/lib/blockchain-evidence/internal-auth';
import { processEvidenceFinalization } from '@/lib/evidence-v2/orchestrator';
import { processPendingEvidenceSupplements } from '@/lib/evidence-v2/supplements';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function run(request: NextRequest) {
  if (!isAuthorizedOpenTimestampsWorker(request)) return new NextResponse(null, { status: 404 });
  const service = createServiceClient();
  const workerId = request.headers.get('x-vercel-id') || `evidence-cron:${crypto.randomUUID()}`;
  const processed: unknown[] = [];
  for (let index = 0; index < 10; index += 1) {
    const result = await processEvidenceFinalization(service, { workerId: `${workerId}:${index}` });
    if (!result) break;
    processed.push(result);
  }
  await processPendingEvidenceSupplements(service, 20);
  return NextResponse.json({ processed }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function GET(request: NextRequest) {
  try {
    return await run(request);
  } catch (error) {
    console.error('[evidence-finalization] Worker failed', {
      code: error instanceof Error ? error.name : 'UNKNOWN',
    });
    return NextResponse.json(
      { error: 'No fue posible ejecutar la finalización de evidencia.' },
      { status: 500 }
    );
  }
}

export const POST = GET;
