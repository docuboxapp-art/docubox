type CasePeopleSource = {
  owner_user_id: string | null;
  created_by: string | null;
  runtime_assignments: unknown;
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Use current reviewer assignments: the launch snapshot can become stale after reassignment. */
export function caseResponsibleIds(source: CasePeopleSource, reviewers: (string | null)[]) {
  const assignments =
    source.runtime_assignments && typeof source.runtime_assignments === 'object'
      ? (source.runtime_assignments as Record<string, unknown>)
      : {};
  return [
    ...new Set(
      [source.owner_user_id, assignments.approver, assignments.closer, ...reviewers].filter(
        (id): id is string => typeof id === 'string' && uuid.test(id)
      )
    ),
  ];
}

export function casePeopleNames(
  source: CasePeopleSource,
  reviewers: (string | null)[],
  profiles: { id: string; full_name: string | null }[]
) {
  const name = (id: string) => profiles.find((profile) => profile.id === id)?.full_name?.trim();
  return {
    responsibleNames: caseResponsibleIds(source, reviewers).map(
      (id) => name(id) || 'Nombre no disponible'
    ),
    issuerName: source.created_by
      ? name(source.created_by) || 'Nombre no disponible'
      : 'Sin especificar',
  };
}
