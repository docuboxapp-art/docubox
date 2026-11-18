export const PASSWORD_SIGN_IN_TIMEOUT_MS = 20_000;
export const AUTH_SESSION_TIMEOUT_MS = 12_000;
export const POLICY_LOOKUP_TIMEOUT_MS = 20_000;

/** Small auth/policy JSON responses only; do not use for PDF or Storage streams. */
export async function fetchWithCompleteResponseTimeout(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  options: {
    timeoutMs: number;
    fetchImpl?: typeof fetch;
    requestSignal?: AbortSignal;
    onResponse?: (response: Response) => void;
  }
): Promise<Response> {
  const signals = new Set(
    [
      init?.signal ?? (input instanceof Request ? input.signal : undefined),
      options.requestSignal,
    ].filter((signal): signal is AbortSignal => !!signal)
  );
  for (const signal of signals) {
    if (signal.aborted) throw signal.reason;
  }
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let rejectInterrupted!: (reason: unknown) => void;
  const interrupted = new Promise<never>((_resolve, reject) => {
    rejectInterrupted = reject;
  });
  const stop = () => {
    void reader?.cancel(controller.signal.reason).catch(() => undefined);
    rejectInterrupted(controller.signal.reason);
  };
  controller.signal.addEventListener('abort', stop, { once: true });
  const forwards = [...signals].map((signal) => {
    const forward = () => controller.abort(signal.reason);
    signal.addEventListener('abort', forward, { once: true });
    return () => signal.removeEventListener('abort', forward);
  });
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException('El servicio de acceso agotó el tiempo de espera.', 'TimeoutError')
      ),
    options.timeoutMs
  );
  try {
    const transfer = async () => {
      const response = await (options.fetchImpl ?? fetch)(input, {
        ...init,
        signal: controller.signal,
      });
      options.onResponse?.(response);
      if (controller.signal.aborted) throw controller.signal.reason;
      const chunks: Uint8Array[] = [];
      let length = 0;
      if (response.body) {
        reader = response.body.getReader();
        try {
          for (;;) {
            const chunk = await reader.read();
            if (controller.signal.aborted) throw controller.signal.reason;
            if (chunk.done) break;
            chunks.push(chunk.value);
            length += chunk.value.byteLength;
          }
        } finally {
          reader.releaseLock();
          reader = undefined;
        }
      }
      const body = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const headers = new Headers(response.headers);
      // fetch already decoded the transfer; these describe the old wire body.
      headers.delete('content-length');
      headers.delete('content-encoding');
      headers.delete('transfer-encoding');
      return new Response(response.body ? body : null, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    };
    return await Promise.race([transfer(), interrupted]);
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener('abort', stop);
    forwards.forEach((remove) => remove());
  }
}

export function fetchWithPasswordSignInTimeout(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
  fetchImpl: typeof fetch = fetch,
  timeoutMs?: number
): Promise<Response> {
  const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(rawUrl, 'https://supabase.invalid');
  const isToken = url.pathname.endsWith('/auth/v1/token');
  const isSessionLookup =
    url.pathname.endsWith('/auth/v1/user') ||
    url.pathname.endsWith('/auth/v1/.well-known/jwks.json');
  const isPolicyLookup = url.pathname.endsWith('/rest/v1/rpc/enforce_docubox_session_policy');
  if (!isToken && !isSessionLookup && !isPolicyLookup) {
    return fetchImpl(input, init);
  }
  const effectiveTimeoutMs =
    timeoutMs ??
    (isToken && url.searchParams.get('grant_type') === 'password'
      ? PASSWORD_SIGN_IN_TIMEOUT_MS
      : isPolicyLookup
        ? POLICY_LOOKUP_TIMEOUT_MS
        : AUTH_SESSION_TIMEOUT_MS);
  return fetchWithCompleteResponseTimeout(input, init, {
    fetchImpl,
    timeoutMs: effectiveTimeoutMs,
  });
}
