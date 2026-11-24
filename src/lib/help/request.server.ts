import 'server-only';

export const helpPrivateHeaders = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
};

export class HelpRequestError extends Error {
  constructor(
    readonly status: 400 | 403 | 413 | 415,
    message: string
  ) {
    super(message);
  }
}

export async function readHelpRequest(request: Request): Promise<Record<string, unknown>> {
  const allowedOrigin = new URL(request.url).origin;
  if (request.headers.get('origin') !== allowedOrigin) {
    throw new HelpRequestError(403, 'Abre el Centro de ayuda para continuar.');
  }
  if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') {
    throw new HelpRequestError(415, 'Formato de solicitud no admitido.');
  }

  const limit = 2048;
  if (Number(request.headers.get('content-length')) > limit) {
    throw new HelpRequestError(413, 'La solicitud es demasiado grande.');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new HelpRequestError(400, 'Falta el contenido de la solicitud.');
  const decoder = new TextDecoder();
  let length = 0;
  let raw = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) {
        await reader.cancel();
        throw new HelpRequestError(413, 'La solicitud es demasiado grande.');
      }
      raw += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const parsed: unknown = JSON.parse(raw + decoder.decode());
    if (typeof parsed === 'object' && parsed && !Array.isArray(parsed))
      return parsed as Record<string, unknown>;
  } catch {
    // The response is the same for malformed JSON and an invalid body shape.
  }
  throw new HelpRequestError(400, 'La solicitud no tiene un formato válido.');
}

export function helpRequestFailure(error: unknown, fallback: string) {
  const status = error instanceof HelpRequestError ? error.status : 503;
  const message = error instanceof HelpRequestError ? error.message : fallback;
  return Response.json({ message }, { status, headers: helpPrivateHeaders });
}
