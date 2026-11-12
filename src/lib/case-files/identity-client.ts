/** Client transport for identity verification of a case invitation only. */
export type CaseIdentitySession = {
  token: string;
  url: string;
  expiresAt: string;
  hasStoredId: boolean;
};

type Fetcher = typeof fetch;

export async function createCaseIdentitySession(
  invitation: string,
  origin: string,
  fetcher: Fetcher = fetch
): Promise<CaseIdentitySession> {
  const response = await fetcher('/api/public/case-entry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-case-invitation': invitation },
    cache: 'no-store',
    body: JSON.stringify({ action: 'mobile' }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(result.error || 'No se pudo iniciar la verificación del expediente.');
  if (!/^[a-f0-9]{64}$/i.test(result.token || '') || !Number.isFinite(Date.parse(result.expiresAt)))
    throw new Error('La sesión de verificación del expediente no es válida.');
  return {
    token: result.token,
    url: new URL(`/captura-id-movil/${result.token}`, origin).href,
    expiresAt: result.expiresAt,
    hasStoredId: result.hasStoredId === true,
  };
}

export async function getCaseIdentityStatus(token: string, fetcher: Fetcher = fetch) {
  const response = await fetcher(
    `/api/mobile-upload/session-status?token=${encodeURIComponent(token)}`,
    { cache: 'no-store' }
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(result.error || 'No se pudo consultar la verificación del expediente.');
  if (result.mode !== 'case_portal_liveness')
    throw new Error('La sesión de verificación no corresponde a este expediente.');
  return {
    status: String(result.status || ''),
    ...(result.status === 'identity_failed' ? { failureReason: result.failureReason } : {}),
  };
}
