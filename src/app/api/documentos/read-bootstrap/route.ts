import { NextRequest } from 'next/server';
import { GET as listOwnedDocuments } from '../listar/route';
import { GET as listParticipations } from '../mis-participaciones/route';

type BootstrapPart = 'owned' | 'participations';

export async function GET(request: NextRequest) {
  if (!request.headers.get('authorization')?.startsWith('Bearer ')) {
    return Response.json({ error: 'No autenticado' }, { status: 401 });
  }

  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (part: BootstrapPart, status: number, body: unknown) => {
        if (!cancelled)
          controller.enqueue(encoder.encode(`${JSON.stringify({ part, status, body })}\n`));
      };
      const run = async (
        part: BootstrapPart,
        path: string,
        handler: (request: NextRequest) => Promise<Response>
      ) => {
        try {
          const partRequest = new NextRequest(new URL(path, request.url), {
            headers: request.headers,
          });
          const response = await handler(partRequest);
          send(part, response.status, await response.json());
        } catch (error) {
          console.error(`[read-bootstrap] ${part} failed:`, error);
          send(part, 500, { error: 'No fue posible cargar los documentos.' });
        }
      };

      void Promise.all([
        run('owned', '/api/documentos/listar?tipo=todos', listOwnedDocuments),
        run(
          'participations',
          '/api/documentos/mis-participaciones?exclude_owned=true&view=list',
          listParticipations
        ),
      ]).finally(() => {
        if (!cancelled) controller.close();
      });
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
