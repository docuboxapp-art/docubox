import type { User } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';
import { canAccessParticipantDocument } from '@/lib/documents/participant-visibility';

export class DocumentAccessError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

type DocumentAccessOptions = {
  ownerOrAdminOnly?: boolean;
  requireEdit?: boolean;
};

function bearerToken(request: NextRequest) {
  const authorization = request.headers.get('authorization');
  return authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

export async function requireDocumentAccess(
  request: NextRequest,
  documentId: string,
  options: DocumentAccessOptions = {},
) {
  const token = bearerToken(request);
  if (!token) throw new DocumentAccessError('AUTH_REQUIRED', 'Debes iniciar sesion.', 401);

  const { data: { user }, error: authError } = await createAnonClient().auth.getUser(token);
  if (authError || !user?.email) {
    throw new DocumentAccessError('AUTH_INVALID', 'La sesion no es valida.', 401);
  }

  const service = createServiceClient();
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
  if (document.workspace_id) {
    const { data: membership } = await service
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', document.workspace_id)
      .eq('user_id', user.id)
      .in('role', ['owner', 'admin'])
      .maybeSingle();
    isWorkspaceManager = Boolean(membership);
  }

  if (options.ownerOrAdminOnly) {
    if (!isOwner && !isWorkspaceManager) {
      throw new DocumentAccessError('DOCUMENT_ACCESS_DENIED', 'No tienes permisos para generar este artefacto.', 403);
    }
    const role: 'OWNER' | 'WORKSPACE_ADMIN' = isOwner ? 'OWNER' : 'WORKSPACE_ADMIN';
    return { user, document, service, role };
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
    ? document.participantes.find((participant: Record<string, unknown>) =>
        participant.id === user.id
        || participant.user_id === user.id
        || String(participant.email || '').trim().toLowerCase() === normalizedEmail
      ) as Record<string, unknown> | undefined
    : undefined;
  const listedParticipant = Boolean(participantEntry && canAccessParticipantDocument(participantEntry));
  const participantAccessRevoked = Boolean(
    participantEntry
    && participantEntry.current_access === false
  );
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

  if (options.requireEdit && !isOwner && !isWorkspaceManager && !canEdit) {
    throw new DocumentAccessError('DOCUMENT_EDIT_DENIED', 'No tienes permisos para editar este documento.', 403);
  }

  if (!isOwner && !isWorkspaceManager && !listedParticipant && !hasParticipation && !explicitPermission) {
    throw new DocumentAccessError('DOCUMENT_ACCESS_DENIED', 'No tienes acceso a este documento.', 403);
  }
  const role: 'OWNER' | 'WORKSPACE_ADMIN' | 'AUTHORIZED' = isOwner
    ? 'OWNER'
    : isWorkspaceManager
      ? 'WORKSPACE_ADMIN'
      : 'AUTHORIZED';
  return { user: user as User, document, service, role, explicitPermission, canEdit };
}

export function documentAccessResponse(error: unknown) {
  if (error instanceof DocumentAccessError) {
    return { status: error.status, body: { error: error.message, code: error.code } };
  }
  return { status: 500, body: { error: 'No fue posible validar el acceso.', code: 'ACCESS_CHECK_FAILED' } };
}
