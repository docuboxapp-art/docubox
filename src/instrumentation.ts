import type { Instrumentation } from 'next';
import { emitObservedEvent } from '@/lib/observability/events';

// Next.js calls this only for server errors it captures. Handled 503s are
// recorded by the middleware or route that chose that response instead.
export const onRequestError: Instrumentation.onRequestError = (error, _request, context) => {
  emitObservedEvent({
    service: 'next',
    outcome: 'error',
    route: context.routePath,
    code: error instanceof Error ? error.name : null,
  });
};
