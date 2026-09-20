export type OrganizationDelegationPolicyMode =
  'DISABLED' | 'ORGANIZATION_ONLY' | 'AUTHORIZED_MEMBERS';

export type OrganizationDelegationPolicy = {
  mode: OrganizationDelegationPolicyMode;
  allowed_member_ids: string[];
  allowed_roles: string[];
};

const stringList = (value: unknown) =>
  Array.isArray(value)
    ? [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))]
    : [];

export function normalizeOrganizationDelegationPolicy(
  settings: unknown
): OrganizationDelegationPolicy {
  const organizationSettings =
    settings && typeof settings === 'object' ? (settings as Record<string, unknown>) : {};
  const raw =
    organizationSettings.signature_delegation_policy &&
    typeof organizationSettings.signature_delegation_policy === 'object'
      ? (organizationSettings.signature_delegation_policy as Record<string, unknown>)
      : {};
  const mode = ['ORGANIZATION_ONLY', 'AUTHORIZED_MEMBERS'].includes(String(raw.mode || ''))
    ? (String(raw.mode) as OrganizationDelegationPolicyMode)
    : 'DISABLED';
  return {
    mode,
    allowed_member_ids: stringList(raw.allowed_member_ids),
    allowed_roles: stringList(raw.allowed_roles),
  };
}

export function delegationPolicyAllowsMember(
  policy: OrganizationDelegationPolicy,
  member: { id: string; role?: string | null }
) {
  if (policy.mode === 'DISABLED') return false;
  if (policy.mode === 'ORGANIZATION_ONLY') return true;
  return (
    policy.allowed_member_ids.includes(member.id) ||
    policy.allowed_roles.includes(String(member.role || ''))
  );
}
