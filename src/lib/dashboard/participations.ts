import { createClient } from '@/lib/supabase/client';

const pendingParticipations = new Map<string, Promise<any[]>>();
const pendingOwnedDocuments = new Map<string, Promise<any[]>>();
const DASHBOARD_CACHE_TTL_MS = 15_000;
const cachedParticipations = new Map<string, { value: any[]; expiresAt: number }>();
const cachedOwnedDocuments = new Map<string, { value: any[]; expiresAt: number }>();

type DashboardFetchOptions = {
  force?: boolean;
};

export function invalidateDashboardDocumentData(userId?: string) {
  if (userId) {
    cachedParticipations.delete(userId);
    cachedOwnedDocuments.delete(userId);
    return;
  }
  cachedParticipations.clear();
  cachedOwnedDocuments.clear();
}

/**
 * Shares the dashboard participation read and retains it briefly for fast return visits.
 * Real-time updates and manual refreshes invalidate the cache before reloading.
 */
export function fetchDashboardParticipations(
  userId: string,
  options: DashboardFetchOptions = {}
): Promise<any[]> {
  const now = Date.now();
  const cached = cachedParticipations.get(userId);
  if (!options.force && cached && cached.expiresAt > now) {
    return Promise.resolve(cached.value);
  }
  const pending = pendingParticipations.get(userId);
  if (pending) return pending;

  const request = fetch('/api/documentos/mis-participaciones?view=dashboard&exclude_owned=true', {
    cache: 'no-store',
  })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      const value = data?.participaciones ?? [];
      cachedParticipations.set(userId, { value, expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS });
      return value;
    })
    .catch(() => []);

  pendingParticipations.set(userId, request);
  void request.finally(() => {
    if (pendingParticipations.get(userId) === request) pendingParticipations.delete(userId);
  });

  return request;
}

/**
 * Shares the RLS-protected owned-document lookup used by the dashboard widgets.
 * Results are short-lived; realtime refreshes force a fresh read.
 */
export function fetchDashboardOwnedDocuments(
  userId: string,
  options: DashboardFetchOptions = {}
): Promise<any[]> {
  const now = Date.now();
  const cached = cachedOwnedDocuments.get(userId);
  if (!options.force && cached && cached.expiresAt > now) return Promise.resolve(cached.value);
  const pending = pendingOwnedDocuments.get(userId);
  if (pending) return pending;

  const supabase = createClient();
  const request = (async () => {
    try {
      const { data } = await supabase
        .from('documentos')
        .select(
          'id, nombre, estado, fecha_vencimiento, created_at, participantes, owner_id, es_urgente'
        )
        .eq('owner_id', userId)
        .is('deleted_at', null);
      const value = data ?? [];
      cachedOwnedDocuments.set(userId, { value, expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS });
      return value;
    } catch {
      return [];
    }
  })();

  pendingOwnedDocuments.set(userId, request);
  void request.finally(() => {
    if (pendingOwnedDocuments.get(userId) === request) pendingOwnedDocuments.delete(userId);
  });

  return request;
}
