import { createClient } from '@/lib/supabase/client';

let pendingParticipations: Promise<any[]> | null = null;
const pendingOwnedDocuments = new Map<string, Promise<any[]>>();

/**
 * Shares the same in-flight request between dashboard widgets. The result is not
 * retained after completion, so real-time updates and manual refreshes stay fresh.
 */
export function fetchDashboardParticipations(): Promise<any[]> {
  if (pendingParticipations) return pendingParticipations;

  const request = fetch(`/api/documentos/mis-participaciones?t=${Date.now()}`)
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => data?.participaciones ?? [])
    .catch(() => []);

  pendingParticipations = request;
  void request.finally(() => {
    if (pendingParticipations === request) pendingParticipations = null;
  });

  return request;
}

/**
 * Shares the RLS-protected owned-document lookup used by the dashboard widgets.
 * Only concurrent requests are deduplicated so realtime refreshes still read fresh data.
 */
export function fetchDashboardOwnedDocuments(userId: string): Promise<any[]> {
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
      return data ?? [];
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
