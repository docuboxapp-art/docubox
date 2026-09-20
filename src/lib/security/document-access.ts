import type { User } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';
import { canAccessParticipantDocument } from '@/lib/documents/participant-visibility';
import { authSessionId } from '@/lib/security/document-view-access';
import {
  assertKioskDocumentScope,
  kioskParticipantMatchesUser,
} from '@/lib/in-person/kiosk-session.server';

export class DocumentAccessError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

type DocumentAccessOptions = {
  ownerOrAdminOnly?: boolean;
  requireEdit?: boolean;
};

export function bearerToken(request: NextRequest) {
  const authorization = request.headers.get('authorization');
  return authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

export async function requireDocumentAccess(
  request: NextRequest,
  documentId: string,
  options: DocumentAccessOptions = {}
) {
  let kioskSession = null;
  try {
    kioskSession = await assertKioskDocumentScope(request, documentId);
  } catch {
    throw new DocumentAccessError(
      'KIOSK_SCOPE_DENIED',
      'La sesión presencial no autoriza este documento.',
      403
    );
  }
  const token = bearerToken(request);
  if (!token) throw new DocumentAccessError('AUTH_REQUIRED', 'Debes iniciar sesion.', 401);

  const {
    data: { user },
    error: authError,
  } = await createAnonClient().auth.getUser(token);
  if (authError || !user?.email) {
    throw new DocumentAccessError('AUTH_INVALID', 'La sesion no es valida.', 401);
  }

  const service = createServiceClient();
  if (kioskSession) {
    const identity = await kioskParticipantMatchesUser(service, kioskSession, user);
    if (!identity.matches) {
      throw new DocumentAccessError(
        'KIOSK_PARTICIPANT_MISMATCH',
        'La identidad no corresponde a la sesión presencial.',
        403
      );
    }
  }
  const { data: document, error: documentError } = await service
    .from('documentos')
    .select('*')
    .eq('id', documentId)
    .maybeSingle();
  if (documentError || !document) {
    throw new DocumentAccessError('DOCUMENT_NOT_FOUND', 'Documento no encontrado.', 404);
  }

  const isOwner = document.owner_id === user.id;
  let isWorkspaceManager = false;
  const currentCustodianWorkspaceId =
    document.current_custodian_workspace_id || document.workspace_id || null;
  const historicalOwnerStillCustodian =
    isOwner && currentCustodianWorkspaceId === document.workspace_id;
  if (currentCustodianWorkspaceId) {
    const { data: membership } = await service
      .from('workspace_members')
      .select('role,status,access_expires_at')
      .eq('workspace_id', currentCustodianWorkspaceId)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .in('role', ['owner', 'admin'])
      .maybeSingle();
    const membershipExpiresAt = membership?.access_expires_at
      ? new Date(membership.access_expires_at).getTime()
      : null;
    isWorkspaceManager =
      Boolean(membership) && (membershipExpiresAt === null || membershipExpiresAt > Date.now());
  }

  if (options.ownerOrAdminOnly) {
    if (!historicalOwnerStillCustodian && !isWorkspaceManager) {
      throw new DocumentAccessError(
        'DOCUMENT_ACCESS_DENIED',
        'No tienes permisos para generar este artefacto.',
        403
      );
    }
    const role: 'OWNER' | 'WORKSPACE_ADMIN' = historicalOwnerStillCustodian
      ? 'OWNER'
      : 'WORKSPACE_ADMIN';
    return {
      user,
      document,
      service,
      role,
      accessToken: token,
      authSessionId: authSessionId(token),
    };
  }

  const normalizedEmail = user.email.trim().toLowerCase();
  const permissionResult = await service
    .from('document_access_permissions')
    .select('id,access_level,can_invite,created_by')
    .eq('document_id', documentId)
    .or(`grantee_user_id.eq.${user.id},grantee_email.eq.${normalizedEmail}`)
    .limit(1)
    .maybeSingle();
  if (permissionResult.error) throw permissionResult.error;
  const explicitPermission = permissionResult.data;
  const canEdit = explicitPermission?.access_level === 'edit';
  const participantEntry = Array.isArray(document.participantes)
    ? (document.participantes.find(
        (participant: Record<string, unknown>) =>
          participant.id === user.id ||
          participant.user_id === user.id ||
          String(participant.email || '')
            .trim()
            .toLowerCase() === normalizedEmail
      ) as Record<string, unknown> | undefined)
    : undefined;
  const listedParticipant = Boolean(
    participantEntry && canAccessParticipantDocument(participantEntry)
  );
  const participantAccessRevoked = Boolean(
    participantEntry && participantEntry.current_access === false
  );
  let delegatedParticipantReferenceId: string | null = null;
  if (!listedParticipant && document.workspace_id) {
    const delegated = await service
      .from('document_participant_delegations')
      .select('original_participant_reference_id')
      .eq('document_id', documentId)
      .eq('workspace_id', document.workspace_id)
      .eq('delegate_user_id', user.id)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    if (
      delegated.error &&
      !['42P01', 'PGRST205'].includes(String((delegated.error as { code?: string }).code || ''))
    ) {
      throw delegated.error;
    }
    delegatedParticipantReferenceId = delegated.data?.original_participant_reference_id || null;
  }
  let hasParticipation = false;
  if (!isOwner && !isWorkspaceManager && !listedParticipant && !participantAccessRevoked) {
    const { data: participationById } = await service
      .from('participation_responses')
      .select('id')
      .eq('documento_id', documentId)
      .eq('participante_id', user.id)
      .limit(1)
      .maybeSingle();
    if (participationById) {
      hasParticipation = true;
    } else {
      const { data: participationByEmail } = await service
        .from('participation_responses')
        .select('id')
        .eq('documento_id', documentId)
        .ilike('participante_email', normalizedEmail)
        .limit(1)
        .maybeSingle();
      hasParticipation = Boolean(participationByEmail);
    }
  }

  if (options.requireEdit && !historicalOwnerStillCustodian && !isWorkspaceManager && !canEdit) {
    throw new DocumentAccessError(
      'DOCUMENT_EDIT_DENIED',
      'No tienes permisos para editar este documento.',
      403
    );
  }

  if (
    !isOwner &&
    !isWorkspaceManager &&
    !listedParticipant &&
    !delegatedParticipantReferenceId &&
    !hasParticipation &&
    !explicitPermission
  ) {
    throw new DocumentAccessError(
      'DOCUMENT_ACCESS_DENIED',
      'No tienes acceso a este documento.',
      403
    );
  }
  const role: 'OWNER' | 'WORKSPACE_ADMIN' | 'AUTHORIZED' = historicalOwnerStillCustodian
    ? 'OWNER'
    : isWorkspaceManager
      ? 'WORKSPACE_ADMIN'
      : 'AUTHORIZED';
  return {
    user: user as User,
    document,
    service,
    role,
    explicitPermission,
    canEdit,
    delegatedParticipantReferenceId,
    accessToken: token,
    authSessionId: authSessionId(token),
  };
}

export function documentAccessResponse(error: unknown) {
  if (error instanceof DocumentAccessError) {
    return { status: error.status, body: { error: error.message, code: error.code } };
  }
  return {
    status: 500,
    body: { error: 'No fue posible validar el acceso.', code: 'ACCESS_CHECK_FAILED' },
  };
}
