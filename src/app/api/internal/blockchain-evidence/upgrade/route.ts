import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { processBlockchainEvidenceQueue } from '@/lib/blockchain-evidence/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (
    !process.env.CRON_SECRET ||
    request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return new NextResponse(null, { status: 404 });
  }
  try {
    const workerId = request.headers.get('x-vercel-id') || `cron-${crypto.randomUUID()}`;
    const result = await processBlockchainEvidenceQueue(createServiceClient(), {
      workerId,
      limit: 20,
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[blockchain-evidence] Upgrade worker failed', {
      code: error instanceof Error ? error.name : 'UNKNOWN',
    });
    return NextResponse.json(
      { error: 'No fue posible ejecutar el upgrade de evidencias.' },
      { status: 500 }
    );
  }
}
