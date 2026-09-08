let pendingParticipations: Promise<any[]> | null = null;

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
