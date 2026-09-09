import { randomUUID } from 'node:crypto';
import type { User } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/server';
import { canAccessParticipantDocument } from '@/lib/documents/participant-visibility';
import { hashSecret } from './security';
import { canReadLuciaDocument, isUsablePublicCapability } from './authorizationRules';

export type LuciaAuthorizationContext = {
  user_id: string | null;
  workspace_id: string | null;
  role: string | null;
  membership_status: string | null;
  allowed_document_ids: string[];
  allowed_resource_ids: string[];
  permissions: string[];
  is_public_token_flow: boolean;
  token_grant_id: string | null;
  denied_reason: string | null;
};

type AuthorizationInput = {
  user?: Pick<User, 'id' | 'email'> | null;
  workspaceId?: string | null;
  documentId?: string | null;
  token?: string | null;
  currentRoute?: string | null;
  scope?: string | null;
};

type PublicGrant = {
  workspaceId: string | null;
  documentIds: string[];
  resourceIds: string[];
  permissions: string[];
};

const ACTIVE_MEMBER_STATUSES = new Set(['active']);
const MANAGER_ROLES = new Set(['owner', 'admin', 'workspace_admin']);

function denied(input: AuthorizationInput, reason: string): LuciaAuthorizationContext {
  return {
    user_id: input.user?.id ?? null,
    workspace_id: input.workspaceId ?? null,
    role: null,
    membership_status: null,
    allowed_document_ids: [],
    allowed_resource_ids: [],
    permissions: [],
    is_public_token_flow: Boolean(input.token),
    token_grant_id: null,
    denied_reason: reason,
  };
}

function isExpired(value: unknown) {
  return typeof value === 'string' && new Date(value).getTime() <= Date.now();
}

async function resolvePublicGrant(token: string, currentRoute = ''): Promise<PublicGrant | null> {
  const service = createServiceClient();
  const tokenHash = hashSecret(token);

  if (
    currentRoute.startsWith('/portal-participante/') ||
    currentRoute.startsWith('/registro-participante/')
  ) {
    const { data: documents } = await service
      .from('documentos')
      .select('id,workspace_id,estado,participantes')
      .contains('participantes', JSON.stringify([{ portal_token_hash: tokenHash }]))
      .limit(2);
    for (const document of documents || []) {
      const participant = (
        Array.isArray(document.participantes) ? document.participantes : []
      ).find((item: Record<string, unknown>) => item.portal_token_hash === tokenHash);
      if (
        participant &&
        document.estado !== 'cancelado' &&
        !participant.portal_token_invalidated_at &&
        !isExpired(participant.portal_token_expires_at) &&
        canAccessParticipantDocument(participant)
      ) {
        return {
          workspaceId: document.workspace_id,
          documentIds: [document.id],
          resourceIds: [document.id],
          permissions: [
            'read_document',
            'read_participation',
            ...(currentRoute.startsWith('/registro-participante/')
              ? ['read_participant_registration']
              : []),
          ],
        };
      }
    }
    return null;
  }

  if (currentRoute.startsWith('/form/')) {
    const { data: formToken } = await service
      .from('form_tokens')
      .select('id,template_id,expires_at,used_at')
      .eq('token_hash', tokenHash)
      .maybeSingle();
    if (
      !formToken ||
      !isUsablePublicCapability('active', ['active'], formToken.expires_at, formToken.used_at)
    )
      return null;
    const { data: template } = await service
      .from('form_templates')
      .select('id,workspace_id,document_id,status')
      .eq('id', formToken.template_id)
      .eq('status', 'published')
      .maybeSingle();
    if (!template) return null;
    return {
      workspaceId: template.workspace_id,
      documentIds: template.document_id ? [template.document_id] : [],
      resourceIds: [formToken.id, template.id],
      permissions: ['read_public_form'],
    };
  }

  if (currentRoute.startsWith('/expediente/')) {
    const { data: share } = await service
      .from('case_file_shares')
      .select('id,workspace_id,case_file_id,scope,expires_at,revoked_at')
      .eq('token_hash', tokenHash)
      .maybeSingle();
    if (
      !share ||
      !isUsablePublicCapability('active', ['active'], share.expires_at, share.revoked_at)
    )
      return null;
    return {
      workspaceId: share.workspace_id,
      documentIds: [],
      resourceIds: [share.case_file_id],
      permissions: (share.scope || []).map((value: string) => `case_file:${value}`),
    };
  }

  if (currentRoute.startsWith('/sala/')) {
    const { data: guest } = await service
      .from('collaboration_room_guests')
      .select('id,workspace_id,room_id,status,token_expires_at')
      .eq('token_hash', tokenHash)
      .maybeSingle();
    if (
      !guest ||
      !isUsablePublicCapability(guest.status, ['pending', 'active'], guest.token_expires_at)
    ) {
      return null;
    }
    return {
      workspaceId: guest.workspace_id,
      documentIds: [],
      resourceIds: [guest.room_id],
      permissions: ['read_collaboration_room'],
    };
  }

  if (currentRoute.startsWith('/solicitud/')) {
    const { data: request } = await service
      .from('collaboration_document_requests')
      .select('id,workspace_id,status,access_expires_at')
      .eq('access_token_hash', tokenHash)
      .maybeSingle();
    if (
      !request ||
      !isUsablePublicCapability(
        request.status,
        ['sent', 'in_progress', 'in_review', 'completed'],
        request.access_expires_at
      )
    ) {
      return null;
    }
    return {
      workspaceId: request.workspace_id,
      documentIds: [],
      resourceIds: [request.id],
      permissions: ['read_collaboration_request'],
    };
  }

  if (currentRoute.startsWith('/subir-movil/') || currentRoute.startsWith('/captura-id-movil/')) {
    const { data: upload } = await service
      .from('mobile_upload_sessions')
      .select('id,user_id,status,expires_at')
      .eq('token_hash', tokenHash)
      .maybeSingle();
    if (
      !upload ||
      !isUsablePublicCapability(upload.status, ['pending', 'uploaded'], upload.expires_at)
    )
      return null;
    return {
      workspaceId: null,
      documentIds: [],
      resourceIds: [upload.id],
      permissions: ['read_mobile_upload_session'],
    };
  }

  if (currentRoute.startsWith('/enrolamiento/')) {
    const { data: enrollment } = await service
      .from('enrollment_tokens')
      .select('id,user_id,status,expires_at')
      .eq('token_hash', tokenHash)
      .maybeSingle();
    if (
      !enrollment ||
      !isUsablePublicCapability(enrollment.status, ['pending', 'started'], enrollment.expires_at)
    )
      return null;
    return {
      workspaceId: null,
      documentIds: [],
      resourceIds: [enrollment.id],
      permissions: ['read_enrollment_session'],
    };
  }

  return null;
}

export async function buildLuciaAuthorizationContext(
  input: AuthorizationInput
): Promise<LuciaAuthorizationContext> {
  if (input.token) {
    const grant = await resolvePublicGrant(input.token, input.currentRoute || '');
    if (!grant) return denied(input, 'INVALID_OR_EXPIRED_PUBLIC_TOKEN');
    if (input.documentId && !grant.documentIds.includes(input.documentId)) {
      return denied(input, 'DOCUMENT_OUTSIDE_TOKEN_SCOPE');
    }
    return {
      user_id: null,
      workspace_id: grant.workspaceId,
      role: 'public_token',
      membership_status: 'token_valid',
      allowed_document_ids: grant.documentIds,
      allowed_resource_ids: grant.resourceIds,
      permissions: grant.permissions,
      is_public_token_flow: true,
      token_grant_id: randomUUID(),
      denied_reason: null,
    };
  }

  if (!input.user) return denied(input, 'AUTHENTICATION_REQUIRED');
  if (!input.workspaceId) return denied(input, 'WORKSPACE_REQUIRED');

  const service = createServiceClient();
  const { data: membership } = await service
    .from('workspace_members')
    .select('role,status,access_expires_at')
    .eq('workspace_id', input.workspaceId)
    .eq('user_id', input.user.id)
    .maybeSingle();
  const status = membership?.status || null;
  if (
    !membership ||
    !ACTIVE_MEMBER_STATUSES.has(status || '') ||
    isExpired(membership.access_expires_at)
  ) {
    return {
      ...denied(input, 'ACTIVE_MEMBERSHIP_REQUIRED'),
      membership_status: status,
    };
  }

  const role = String(membership.role || 'member').toLowerCase();
  const manager = MANAGER_ROLES.has(role);
  const { data: documents, error: documentsError } = await service
    .from('documentos')
    .select('id,owner_id,participantes')
    .eq('workspace_id', input.workspaceId)
    .is('deleted_at', null)
    .limit(1000);
  if (documentsError) return denied(input, 'DOCUMENT_AUTHORIZATION_UNAVAILABLE');

  const { data: visibility } = await service
    .from('document_user_visibility')
    .select('document_id,trashed_at,hidden_at,restored_at')
    .eq('workspace_id', input.workspaceId)
    .eq('user_id', input.user.id);
  const hidden = new Set(
    (visibility || [])
      .filter((item) => item.hidden_at || (item.trashed_at && !item.restored_at))
      .map((item) => item.document_id)
  );
  const email = String(input.user.email || '')
    .trim()
    .toLowerCase();

  const allowedDocumentIds = (documents || [])
    .filter((document) =>
      canReadLuciaDocument({
        documentWorkspaceId: input.workspaceId!,
        requestedWorkspaceId: input.workspaceId!,
        documentOwnerId: document.owner_id,
        userId: input.user!.id,
        userEmail: email,
        membershipRole: role,
        membershipStatus: status!,
        membershipExpiresAt: membership.access_expires_at,
        hidden: hidden.has(document.id),
        participants: (Array.isArray(document.participantes) ? document.participantes : []).filter(
          canAccessParticipantDocument
        ),
      })
    )
    .map((document) => document.id);

  const ownsRequestedDocument = Boolean(
    input.documentId &&
    (documents || []).some(
      (document) => document.id === input.documentId && document.owner_id === input.user!.id
    )
  );

  if (input.documentId && !allowedDocumentIds.includes(input.documentId)) {
    return {
      ...denied(input, 'DOCUMENT_ACCESS_DENIED'),
      role,
      membership_status: status,
    };
  }

  return {
    user_id: input.user.id,
    workspace_id: input.workspaceId,
    role,
    membership_status: status,
    allowed_document_ids: input.documentId ? [input.documentId] : allowedDocumentIds,
    allowed_resource_ids: input.documentId ? [input.documentId] : allowedDocumentIds,
    permissions: manager
      ? ['read_workspace', 'read_document', 'read_audit', 'manage_ai_index']
      : [
          'read_document',
          'read_own_participation',
          ...(ownsRequestedDocument ? ['manage_ai_index'] : []),
        ],
    is_public_token_flow: false,
    token_grant_id: null,
    denied_reason: null,
  };
}

export function assertAuthorizedDocument(
  authorization: LuciaAuthorizationContext,
  documentId: string
) {
  return !authorization.denied_reason && authorization.allowed_document_ids.includes(documentId);
}
