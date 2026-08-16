import { randomUUID, timingSafeEqual } from 'crypto';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const maxDuration = 60;

function secureSecretMatch(received: string, expected: string) {
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length
    && timingSafeEqual(receivedBuffer, expectedBuffer);
}

async function processDueOffboardingJobs(request: Request) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const expectedSecret = process.env.CRON_SECRET || '';
  const receivedSecret = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');

  if (!expectedSecret) {
    console.error(JSON.stringify({
      scope: 'organization.continuity.scheduler',
      event: 'configuration.missing',
      request_id: requestId,
      at: new Date().toISOString(),
    }));
    return Response.json({ error: 'El procesador programado no está configurado.' }, { status: 503 });
  }

  if (!receivedSecret || !secureSecretMatch(receivedSecret, expectedSecret)) {
    return Response.json({ error: 'No autorizado.' }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    return Response.json({ error: 'La conexión de servicio no está configurada.' }, { status: 503 });
  }

  const service = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const dueJobs = await service
    .from('organization_member_offboarding_jobs')
    .select('id,workspace_id,status,effective_at')
    .in('status', ['pending', 'scheduled'])
    .lte('effective_at', new Date().toISOString())
    .order('effective_at', { ascending: true })
    .limit(25);

  if (dueJobs.error) {
    console.error(JSON.stringify({
      scope: 'organization.continuity.scheduler',
      event: 'jobs.lookup_failed',
      request_id: requestId,
      duration_ms: Date.now() - startedAt,
      error_code: dueJobs.error.code,
      at: new Date().toISOString(),
    }));
    return Response.json({ error: 'No fue posible consultar las bajas programadas.', request_id: requestId }, { status: 500 });
  }

  const results: Array<{ id: string; workspace_id: string; status: string; failure_code?: string }> = [];
  for (const job of dueJobs.data || []) {
    const execution = await service.rpc('execute_organization_member_offboarding_job', {
      target_job_id: job.id,
    });

    if (execution.error) {
      results.push({
        id: job.id,
        workspace_id: job.workspace_id,
        status: 'failed',
        failure_code: execution.error.code || 'rpc_error',
      });
      continue;
    }

    results.push({
      id: job.id,
      workspace_id: job.workspace_id,
      status: execution.data?.status || 'completed',
      ...(execution.data?.failure_code ? { failure_code: execution.data.failure_code } : {}),
    });
  }

  const completed = results.filter((result) => result.status === 'completed').length;
  const failed = results.filter((result) => result.status === 'failed').length;
  console.info(JSON.stringify({
    scope: 'organization.continuity.scheduler',
    event: 'batch.completed',
    request_id: requestId,
    scanned: dueJobs.data?.length || 0,
    completed,
    failed,
    duration_ms: Date.now() - startedAt,
    at: new Date().toISOString(),
  }));

  return Response.json({
    success: failed === 0,
    scanned: dueJobs.data?.length || 0,
    completed,
    failed,
    results,
    request_id: requestId,
  }, { status: failed > 0 ? 207 : 200 });
}

export async function GET(request: Request) {
  return processDueOffboardingJobs(request);
}

export async function POST(request: Request) {
  return processDueOffboardingJobs(request);
}
