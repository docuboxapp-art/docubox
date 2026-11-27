import { NextRequest } from 'next/server';
import { withDocumentBootstrapAuth } from '@/lib/documents/bootstrap-auth.server';
import { emitObservedEvent } from '@/lib/observability/events';
import { createAnonClient } from '@/lib/supabase/server';
import { GET as listOwnedDocuments } from '../listar/route';
import { GET as listParticipations } from '../mis-participaciones/route';
import { GET as listMetadata } from '../list-metadata/route';

type BootstrapPart = 'owned' | 'participations' | 'metadata';

export async function GET(request: NextRequest) {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return Response.json({ error: 'No autenticado' }, { status: 401 });
  }

  const token = authorization.slice(7);
  const includeMetadata = request.nextUrl.searchParams.get('metadata') === '1';
  // Verification must fit the shortest deadline of the handlers using it.
  const authDeadline = AbortSignal.timeout(includeMetadata ? 18_000 : 20_000);
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
          emitObservedEvent({
            service: 'next',
            outcome: 'error',
            route: '/api/documentos/read-bootstrap',
            status: 500,
            code: error instanceof Error ? error.name : null,
          });
          send(part, 500, { error: 'No fue posible cargar los documentos.' });
        }
      };

      void withDocumentBootstrapAuth(
        token,
        () => createAnonClient(token, authDeadline).auth.getUser(token),
        () =>
          Promise.all([
            run('owned', '/api/documentos/listar?tipo=todos', listOwnedDocuments),
            run(
              'participations',
              '/api/documentos/mis-participaciones?exclude_owned=true&view=list',
              listParticipations
            ),
            ...(includeMetadata
              ? [run('metadata', '/api/documentos/list-metadata', listMetadata)]
              : []),
          ])
      ).finally(() => {
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
