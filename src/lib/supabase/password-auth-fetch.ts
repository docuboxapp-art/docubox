export const PASSWORD_SIGN_IN_TIMEOUT_MS = 20_000;

export function fetchWithPasswordSignInTimeout(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
  fetchImpl: typeof fetch = fetch,
  timeoutMs = PASSWORD_SIGN_IN_TIMEOUT_MS
): Promise<Response> {
  const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(rawUrl, 'https://supabase.invalid');
  if (
    !url.pathname.endsWith('/auth/v1/token') ||
    url.searchParams.get('grant_type') !== 'password'
  ) {
    return fetchImpl(input, init);
  }

  const controller = new AbortController();
  const originalSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const abortFromOriginal = () => controller.abort(originalSignal?.reason);
  if (originalSignal?.aborted) {
    abortFromOriginal();
  } else {
    originalSignal?.addEventListener('abort', abortFromOriginal, { once: true });
  }

  const timer = setTimeout(() => {
    controller.abort(
      new DOMException('El servicio de acceso agotó el tiempo de espera.', 'TimeoutError')
    );
  }, timeoutMs);

  return fetchImpl(input, { ...init, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
    originalSignal?.removeEventListener('abort', abortFromOriginal);
  });
}
