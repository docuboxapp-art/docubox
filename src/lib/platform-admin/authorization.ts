import type { PlatformAccess } from '@/lib/platform-admin/access';

export type PlatformResource = {
  type: string;
  id?: string;
  workspaceId?: string;
  ownerId?: string;
  classification?: 'public' | 'internal' | 'confidential' | 'restricted';
};

export type PlatformAuthorizationContext = {
  stepUpVerified?: boolean;
  approvalGranted?: boolean;
  supportSessionPermissions?: string[];
  supportSessionWorkspaceId?: string;
  approvalRequest?: boolean;
};

export type PlatformAuthorizationDecision = {
  allowed: boolean;
  reason:
    | 'ALLOWED'
    | 'MISSING_PERMISSION'
    | 'STEP_UP_REQUIRED'
    | 'APPROVAL_REQUIRED'
    | 'SUPPORT_SCOPE_REQUIRED'
    | 'TENANT_SCOPE_MISMATCH'
    | 'ADMIN_CONTENT_ACCESS_DENIED';
};

const STEP_UP_PERMISSIONS = new Set([
  'staff.manage',
  'role.manage',
  'organization.suspend',
  'provider.configure',
  'certificate.rotate',
  'kms.rotate.request',
  'kms.rotate',
  'billing.refund',
  'billing.refund.approve',
  'user.mfa.reset.request',
  'user.sessions.revoke',
  'data.export',
  'data.delete.request',
  'support.content.read',
  'break_glass.execute',
]);

const APPROVAL_PERMISSIONS = new Set([
  'certificate.rotate',
  'role.manage',
  'kms.rotate.request',
  'kms.rotate',
  'billing.refund',
  'billing.refund.approve',
  'data.export',
  'data.delete.request',
  'support.content.read',
  'break_glass.execute',
]);

const CUSTOMER_CONTENT_PERMISSIONS = new Set(['support.content.read', 'document.content.read']);

function grantsPermission(access: PlatformAccess, permission: string) {
  return access.permissions.includes('*') || access.permissions.includes(permission);
}

/**
 * Central Control Plane authorization decision. RBAC grants the candidate
 * permission; ABAC then narrows it using step-up, approval and tenant-bound
 * support-session context. Administrative roles never imply document access.
 */
export function authorizePlatformAction(
  access: PlatformAccess,
  permission: string,
  resource: PlatformResource,
  context: PlatformAuthorizationContext = {}
): PlatformAuthorizationDecision {
  if (!grantsPermission(access, permission)) {
    return { allowed: false, reason: 'MISSING_PERMISSION' };
  }

  if (STEP_UP_PERMISSIONS.has(permission) && context.stepUpVerified !== true) {
    return { allowed: false, reason: 'STEP_UP_REQUIRED' };
  }

  if (
    APPROVAL_PERMISSIONS.has(permission) &&
    context.approvalRequest !== true &&
    context.approvalGranted !== true
  ) {
    return { allowed: false, reason: 'APPROVAL_REQUIRED' };
  }

  if (CUSTOMER_CONTENT_PERMISSIONS.has(permission)) {
    if (!context.supportSessionPermissions?.includes(permission)) {
      return { allowed: false, reason: 'SUPPORT_SCOPE_REQUIRED' };
    }
    if (!resource.workspaceId || context.supportSessionWorkspaceId !== resource.workspaceId) {
      return { allowed: false, reason: 'TENANT_SCOPE_MISMATCH' };
    }
  }

  if (resource.type === 'document-content' && !CUSTOMER_CONTENT_PERMISSIONS.has(permission)) {
    return { allowed: false, reason: 'ADMIN_CONTENT_ACCESS_DENIED' };
  }

  return { allowed: true, reason: 'ALLOWED' };
}

export function hasPlatformPermissionForNavigation(access: PlatformAccess, permission: string) {
  return grantsPermission(access, permission);
}
