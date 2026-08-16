export type CollaborationAccessCode =
  | 'OK'
  | 'READ_ONLY'
  | 'ADDON_REQUIRED'
  | 'ORGANIZATION_REQUIRED'
  | 'MEMBERSHIP_INACTIVE'
  | 'NOT_A_MEMBER'
  | 'WORKSPACE_SUSPENDED'
  | 'PRO_PLAN_REQUIRED'
  | 'UNKNOWN';

export type CollaborationCommercialTier = 'none' | 'standard' | 'pro';
export type CollaborationEntitlementLevel = 'enabled' | 'basic' | 'advanced';

export interface CollaborationEntitlement {
  status?: string;
  limits?: Record<string, number>;
  ends_at?: string | null;
  read_only_at?: string | null;
  access_level?: CollaborationEntitlementLevel | null;
}

export type CollaborationSubscriptionStatus =
  | 'available'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'suspended'
  | 'cancelled'
  | 'expired';

export interface CollaborationAccess {
  eligible: boolean;
  accessible: boolean;
  writeAllowed: boolean;
  code: CollaborationAccessCode;
  workspaceStatus: string;
  membershipStatus: string;
  membershipRole: string;
  subscriptionStatus: CollaborationSubscriptionStatus;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  productKey: string | null;
  commercialTier: CollaborationCommercialTier;
  canManageSubscription: boolean;
  entitlements: Record<string, CollaborationEntitlement>;
  permissions: string[];
}

export const unavailableCollaborationAccess: CollaborationAccess = {
  eligible: false,
  accessible: false,
  writeAllowed: false,
  code: 'UNKNOWN',
  workspaceStatus: 'unknown',
  membershipStatus: 'unknown',
  membershipRole: 'member',
  subscriptionStatus: 'available',
  trialEndsAt: null,
  currentPeriodEnd: null,
  productKey: null,
  commercialTier: 'none',
  canManageSubscription: false,
  entitlements: {},
  permissions: [],
};

export function normalizeCollaborationAccess(value: unknown): CollaborationAccess {
  if (!value || typeof value !== 'object') return unavailableCollaborationAccess;
  const source = value as Record<string, unknown>;
  const code = typeof source.code === 'string' ? source.code : 'UNKNOWN';
  const subscriptionStatus = typeof source.subscription_status === 'string'
    ? source.subscription_status
    : 'available';

  return {
    eligible: source.eligible === true,
    accessible: source.accessible === true,
    writeAllowed: source.write_allowed === true,
    code: code as CollaborationAccessCode,
    workspaceStatus: String(source.workspace_status || 'unknown'),
    membershipStatus: String(source.membership_status || 'unknown'),
    membershipRole: String(source.membership_role || 'member'),
    subscriptionStatus: subscriptionStatus as CollaborationSubscriptionStatus,
    trialEndsAt: typeof source.trial_ends_at === 'string' ? source.trial_ends_at : null,
    currentPeriodEnd: typeof source.current_period_end === 'string' ? source.current_period_end : null,
    productKey: typeof source.product_key === 'string' ? source.product_key : null,
    commercialTier:
      source.commercial_tier === 'standard' || source.commercial_tier === 'pro'
        ? source.commercial_tier
        : 'none',
    canManageSubscription: source.can_manage_subscription === true,
    entitlements: source.entitlements && typeof source.entitlements === 'object'
      ? source.entitlements as CollaborationAccess['entitlements']
      : {},
    permissions: Array.isArray(source.permissions)
      ? source.permissions.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

const activeEntitlementStatuses = ['trialing', 'active', 'past_due'];
const readableEntitlementStatuses = [
  ...activeEntitlementStatuses,
  'suspended',
  'cancelled',
  'expired',
];

export function hasCollaborationEntitlement(
  access: CollaborationAccess,
  entitlementKey: string,
  options: {
    write?: boolean;
    proFeature?: boolean;
    minimumLevel?: CollaborationEntitlementLevel;
  } = {},
) {
  const entitlement = access.entitlements[entitlementKey];
  if (!entitlement) return false;
  const statuses = options.write || options.proFeature
    ? activeEntitlementStatuses
    : readableEntitlementStatuses;
  if (!statuses.includes(entitlement.status || '')) return false;
  if (
    (options.write || options.proFeature)
    && entitlement.ends_at
    && new Date(entitlement.ends_at).getTime() <= Date.now()
  ) return false;
  if (options.minimumLevel) {
    const levels: CollaborationEntitlementLevel[] = ['enabled', 'basic', 'advanced'];
    const actual = entitlement.access_level || 'enabled';
    if (levels.indexOf(actual) < levels.indexOf(options.minimumLevel)) return false;
  }
  return true;
}

export function hasCollaborationPro(access: CollaborationAccess) {
  return access.commercialTier === 'pro'
    || hasCollaborationEntitlement(access, 'collaboration_advanced_workflows', {
      proFeature: true,
    });
}

export function canUseCollaboration(
  access: CollaborationAccess,
  permission?: string,
  write = false,
) {
  if (!access.eligible || !access.accessible) return false;
  if (write && !access.writeAllowed) return false;
  if (!permission || access.membershipRole === 'owner' || access.membershipRole === 'admin') return true;
  return access.permissions.includes(permission);
}

export function collaborationAccessLabel(access: CollaborationAccess) {
  if (access.code === 'ORGANIZATION_REQUIRED') return 'Disponible para organizaciones';
  if (access.code === 'MEMBERSHIP_INACTIVE' || access.code === 'NOT_A_MEMBER') return 'Acceso restringido';
  if (access.code === 'WORKSPACE_SUSPENDED') return 'Organizacion suspendida';
  if (access.code === 'ADDON_REQUIRED') return 'Complemento disponible';
  if (access.code === 'READ_ONLY') return 'Solo lectura';
  if (access.subscriptionStatus === 'trialing') return 'Periodo de prueba';
  if (access.subscriptionStatus === 'past_due') return 'Pago pendiente';
  return access.accessible ? 'Activo' : 'No disponible';
}
