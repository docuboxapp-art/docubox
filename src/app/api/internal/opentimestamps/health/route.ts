import { NextRequest, NextResponse } from 'next/server';
import { createOpenTimestampProvider } from '@/lib/blockchain-evidence/provider';
import { isAuthorizedOpenTimestampsWorker } from '@/lib/blockchain-evidence/internal-auth';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function countByStatus(service: ReturnType<typeof createServiceClient>, status: string) {
  const result = await service
    .from('document_blockchain_evidence')
    .select('id', { count: 'exact', head: true })
    .eq('status', status);
  if (result.error) throw result.error;
  return result.count || 0;
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedOpenTimestampsWorker(request)) return new NextResponse(null, { status: 404 });
  const service = createServiceClient();
  try {
    const [
      provider,
      bucket,
      generated,
      pending,
      verified,
      failed,
      latestStamp,
      latestUpgrade,
      latencies,
    ] = await Promise.all([
      createOpenTimestampProvider().healthCheck(),
      service.storage.getBucket('blockchain-evidence'),
      countByStatus(service, 'GENERATED'),
      countByStatus(service, 'PENDING_BITCOIN'),
      countByStatus(service, 'VERIFIED'),
      Promise.all(
        ['SUBMISSION_FAILED', 'UPGRADE_FAILED', 'VERIFICATION_FAILED'].map((status) =>
          countByStatus(service, status)
        )
      ),
      service
        .from('document_blockchain_evidence')
        .select('submitted_at')
        .not('submitted_at', 'is', null)
        .order('submitted_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      service
        .from('document_blockchain_proof_versions')
        .select('created_at')
        .eq('source', 'UPGRADE')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      service
        .from('document_blockchain_calendar_attempts')
        .select('duration_ms')
        .not('duration_ms', 'is', null)
        .order('occurred_at', { ascending: false })
        .limit(200),
    ]);
    if (bucket.error || bucket.data?.public === true) throw new Error('OTS_STORAGE_FAILED');
    return NextResponse.json(
      {
        openTimestamps: {
          client: provider.available ? 'AVAILABLE' : 'UNAVAILABLE',
          clientVersion: provider.clientVersion,
          calendars: `${provider.calendarsReachable}/${provider.calendarsConfigured}`,
          storage: 'OK',
          database: 'OK',
          worker: provider.available ? 'OK' : 'UNAVAILABLE',
          lastSuccessfulStamp: latestStamp.data?.submitted_at || null,
          lastSuccessfulUpgrade: latestUpgrade.data?.created_at || null,
        },
        metrics: {
          ots_generated_total: generated,
          ots_stamp_success_total: pending + verified,
          ots_stamp_failure_total: failed[0],
          ots_pending_total: pending,
          ots_upgrade_success_total: latestUpgrade.data ? 1 : 0,
          ots_anchor_found_total: await countByStatus(service, 'ANCHORED'),
          ots_verified_total: verified,
          ots_verification_failure_total: failed[2],
          ots_calendar_latency_ms_avg: latencies.data?.length
            ? Math.round(
                latencies.data.reduce((sum, item) => sum + Number(item.duration_ms || 0), 0) /
                  latencies.data.length
              )
            : null,
        },
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Diagnóstico no disponible.',
        code: error instanceof Error ? error.message : 'UNKNOWN',
      },
      { status: 503 }
    );
  }
}
