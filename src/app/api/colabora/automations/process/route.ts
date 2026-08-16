import { randomUUID, timingSafeEqual } from 'crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { processCollaborationAutomationQueue } from '@/lib/collaboration/automation';

export const runtime = 'nodejs';
export const maxDuration = 60;

function secureSecretMatch(received: string, expected: string) {
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

async function processQueue(request: Request) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const expectedSecret = process.env.CRON_SECRET || '';
  const receivedSecret = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');

  if (!expectedSecret) {
    return Response.json(
      { error: 'El procesador programado no esta configurado.' },
      { status: 503 }
    );
  }
  if (!receivedSecret || !secureSecretMatch(receivedSecret, expectedSecret)) {
    return Response.json({ error: 'No autorizado.' }, { status: 401 });
  }

  try {
    const result = await processCollaborationAutomationQueue(createServiceClient());
    console.info(
      JSON.stringify({
        scope: 'colabora.automation.scheduler',
        event: 'batch.completed',
        request_id: requestId,
        ...result,
        duration_ms: Date.now() - startedAt,
        at: new Date().toISOString(),
      })
    );
    return Response.json(
      { success: result.deadLettered === 0, ...result, request_id: requestId },
      {
        status: result.deadLettered > 0 ? 207 : 200,
      }
    );
  } catch (cause) {
    console.error(
      JSON.stringify({
        scope: 'colabora.automation.scheduler',
        event: 'batch.failed',
        request_id: requestId,
        duration_ms: Date.now() - startedAt,
        error: cause instanceof Error ? cause.message : 'unknown_error',
        at: new Date().toISOString(),
      })
    );
    return Response.json(
      { success: false, error: 'No se pudo procesar la cola.', request_id: requestId },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  return processQueue(request);
}

export async function POST(request: Request) {
  return processQueue(request);
}
