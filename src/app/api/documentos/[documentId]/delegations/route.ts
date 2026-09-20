import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
  authenticateOrganizationRequest,
  authorizeOrganizationRequest,
  OrganizationApiError,
  organizationApiFailure,
} from '@/lib/organization/server';
import { isPhaseDFeatureEnabled, PHASE_D_FLAGS } from '@/lib/organization/phase-d';
import {
  delegationPolicyAllowsMember,
  normalizeOrganizationDelegationPolicy,
} from '@/lib/organization/delegation-policy';
import {
  deliverDocumentInvitations,
  type DeliveryParticipant,
} from '@/lib/orchestration/document-delivery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Row = Record<string, any>;

const mutationSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    workspace_id: z.string().uuid(),
    participant_reference_id: z.string().uuid(),
    delegate_member_id: z.string().uuid(),
    reason: z.string().trim().min(3).max(500),
    idempotency_key: z.string().min(16).max(240).optional(),
  }),
  z.object({
    action: z.literal('revoke'),
    workspace_id: z.string().uuid(),
    delegation_id: z.string().uuid(),
    idempotency_key: z.string().min(16).max(240).optional(),
  }),
]);

async function ensureDocumentScope(
  service: SupabaseClient,
  documentId: string,
  workspaceId: string
) {
  const result = await service
    .from('documentos')
    .select('id,workspace_id,estado,owner_id,nombre,descripcion,participantes')
    .eq('id', documentId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) {
    throw new OrganizationApiError(404, 'document_not_found', 'Documento no encontrado.');
  }
  if (
    ['completado', 'cancelado', 'rechazado', 'vencido', 'expirado'].includes(
      String(result.data.estado || '').toLowerCase()
    )
  ) {
    throw new OrganizationApiError(
      409,
      'delegation_document_terminal',
      'El documento ya no admite delegaciones.'
    );
  }
  return result.data;
}

async function notifyDelegateForActiveInvitation(
  service: SupabaseClient,
  document: Row,
  participantReferenceId: string
) {
  const participants = Array.isArray(document.participantes)
    ? (document.participantes as DeliveryParticipant[])
    : [];
  const participant = participants.find(
    (candidate) => candidate.participant_ref_id === participantReferenceId
  );
  const turnIsActive =
    participant?.current_access === true ||
    String(participant?.current_access || '').toLowerCase() === 'true';
  const alreadyInvited = Boolean(participant?.notificado || participant?.fecha_notificacion);
  if (!participant || (!turnIsActive && !alreadyInvited)) return;

  await deliverDocumentInvitations(service, {
    documentId: String(document.id),
    workspaceId: String(document.workspace_id),
    ownerId: String(document.owner_id),
    documentName: String(document.nombre || 'Documento'),
    documentDescription: typeof document.descripcion === 'string' ? document.descripcion : null,
    participants: [{ ...participant, visible: true, isCurrentUser: false }],
    eventType: 'group_member.delegation_created',
  });
}

async function hasDelegationPermission(userClient: SupabaseClient, workspaceId: string) {
  const result = await userClient.rpc('has_organization_permission', {
    ws_id: workspaceId,
    requested_permission: 'delegation.manage',
  });
  if (result.error) throw result.error;
  return result.data === true;
}

function referenceBelongsToUser(reference: Row, user: { id: string; email?: string | null }) {
  return (
    reference.participant_user_id === user.id ||
    (Boolean(user.email) &&
      String(reference.participant_email_normalized || '') ===
        String(user.email || '')
          .trim()
          .toLowerCase())
  );
}

async function loadGroupDelegationContext(input: {
  service: SupabaseClient;
  documentId: string;
  workspaceId: string;
  participantReferenceId: string;
  user: { id: string; email?: string | null };
  canManage: boolean;
}) {
  const { service, documentId, workspaceId, participantReferenceId, user, canManage } = input;
  const [reference, slot, workspace, activeDelegation] = await Promise.all([
    service
      .from('document_participant_references')
      .select('id,participant_user_id,participant_email_normalized,active')
      .eq('id', participantReferenceId)
      .eq('document_id', documentId)
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
    service
      .from('document_signing_group_members')
      .select('id,group_id,participant_reference_id,status,ordinal')
      .eq('document_id', documentId)
      .eq('workspace_id', workspaceId)
      .eq('participant_reference_id', participantReferenceId)
      .maybeSingle(),
    service.from('workspaces').select('organization_settings').eq('id', workspaceId).maybeSingle(),
    service
      .from('document_participant_delegations')
      .select(
        'id,status,reason,delegate_member_id,delegate_user_id,delegate_participant_reference_id,created_at,group_member_slot_id,workspace_members!document_participant_delegations_delegate_member_id_fkey(id,user_id,role,user_profiles(full_name,email))'
      )
      .eq('document_id', documentId)
      .eq('workspace_id', workspaceId)
      .eq('original_participant_reference_id', participantReferenceId)
      .eq('status', 'active')
      .maybeSingle(),
  ]);
  for (const result of [reference, slot, workspace, activeDelegation]) {
    if (result.error) throw result.error;
  }
  if (!reference.data?.active) {
    throw new OrganizationApiError(
      403,
      'participant_scope_denied',
      'El participante no pertenece al documento.'
    );
  }
  const originalUserId = reference.data.participant_user_id;
  const selfDelegation = referenceBelongsToUser(reference.data, user);
  if (!selfDelegation && !canManage) {
    throw new OrganizationApiError(
      403,
      'delegation_actor_scope_denied',
      'Solo el miembro original o un usuario autorizado puede administrar este slot.'
    );
  }
  if (!slot.data) {
    return {
      eligible: false,
      reason: 'not_group_member',
      self_delegation: selfDelegation,
      active_delegation: null,
      candidates: [],
    };
  }

  const [group, groupMembers] = await Promise.all([
    service
      .from('document_signing_groups')
      .select('id,name,completion_policy,status')
      .eq('id', slot.data.group_id)
      .eq('document_id', documentId)
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
    service
      .from('document_signing_group_members')
      .select('id,participant_reference_id,status,ordinal')
      .eq('group_id', slot.data.group_id)
      .eq('status', 'eligible')
      .order('ordinal'),
  ]);
  if (group.error) throw group.error;
  if (groupMembers.error) throw groupMembers.error;
  if (!group.data) {
    throw new OrganizationApiError(409, 'signing_group_missing', 'El grupo ya no está disponible.');
  }

  const candidateReferenceIds = (groupMembers.data || [])
    .map((member: Row) => member.participant_reference_id)
    .filter((id: string) => id !== participantReferenceId);
  const references = candidateReferenceIds.length
    ? await service
        .from('document_participant_references')
        .select('id,participant_user_id,active')
        .in('id', candidateReferenceIds)
        .eq('active', true)
    : { data: [], error: null };
  if (references.error) throw references.error;
  const userIds = [
    ...new Set(
      (references.data || []).map((candidate: Row) => candidate.participant_user_id).filter(Boolean)
    ),
  ] as string[];
  const members = userIds.length
    ? await service
        .from('workspace_members')
        .select('id,user_id,role,status,access_expires_at,user_profiles(full_name,email)')
        .eq('workspace_id', workspaceId)
        .eq('status', 'active')
        .in('user_id', userIds)
    : { data: [], error: null };
  if (members.error) throw members.error;

  const policy = normalizeOrganizationDelegationPolicy(workspace.data?.organization_settings);
  const referenceByUser = new Map<string, Row>(
    (references.data || []).map(
      (candidate: Row) => [String(candidate.participant_user_id), candidate] as [string, Row]
    )
  );
  const slotByReference = new Map<string, Row>(
    (groupMembers.data || []).map(
      (member: Row) => [String(member.participant_reference_id), member] as [string, Row]
    )
  );
  const now = Date.now();
  const candidates = (members.data || [])
    .filter((member: Row) => {
      const expiresAt = member.access_expires_at
        ? new Date(member.access_expires_at).getTime()
        : null;
      return (
        member.user_id !== originalUserId &&
        (expiresAt === null || expiresAt > now) &&
        delegationPolicyAllowsMember(policy, {
          id: String(member.id),
          role: member.role ? String(member.role) : null,
        })
      );
    })
    .map((member: Row) => {
      const participantReference = referenceByUser.get(String(member.user_id));
      const memberSlot = participantReference
        ? slotByReference.get(String(participantReference.id))
        : undefined;
      const profile = Array.isArray(member.user_profiles)
        ? member.user_profiles[0]
        : member.user_profiles;
      return {
        member_id: member.id,
        user_id: member.user_id,
        participant_reference_id: participantReference?.id,
        group_member_slot_id: memberSlot?.id,
        name: profile?.full_name || profile?.email || 'Miembro',
        email: profile?.email || null,
        role: member.role,
      };
    });

  return {
    eligible:
      slot.data.status === 'eligible' &&
      ['pending', 'active'].includes(group.data.status) &&
      policy.mode !== 'DISABLED',
    self_delegation: selfDelegation,
    policy,
    group: group.data,
    member_slot: slot.data,
    active_delegation: activeDelegation.data || null,
    candidates,
  };
}

function normalizeDelegationError(cause: unknown) {
  if (cause instanceof OrganizationApiError) return cause;
  const message = cause instanceof Error ? cause.message : String((cause as Row)?.message || '');
  const denied = [
    'GROUP_MEMBER_DELEGATION_DOCUMENT_SCOPE_DENIED',
    'GROUP_MEMBER_DELEGATION_PARTICIPANT_SCOPE_DENIED',
    'GROUP_MEMBER_DELEGATION_ACTOR_SCOPE_DENIED',
    'GROUP_MEMBER_DELEGATION_DELEGATE_SCOPE_DENIED',
    'GROUP_MEMBER_DELEGATION_DELEGATE_POLICY_DENIED',
    'GROUP_MEMBER_DELEGATION_SAME_GROUP_REQUIRED',
    'GROUP_MEMBER_DELEGATION_NOT_FOUND',
  ].find((code) => message.includes(code));
  if (denied)
    return new OrganizationApiError(403, denied.toLowerCase(), 'Delegación no autorizada.');
  const conflict = [
    'GROUP_MEMBER_DELEGATION_DOCUMENT_TERMINAL',
    'GROUP_MEMBER_DELEGATION_POLICY_DISABLED',
    'GROUP_MEMBER_DELEGATION_SLOT_NOT_ELIGIBLE',
    'GROUP_MEMBER_DELEGATION_IDEMPOTENCY_CONFLICT',
    'GROUP_MEMBER_DELEGATION_CHAIN_DENIED',
    'GROUP_MEMBER_DELEGATION_ALREADY_ACTIVE',
    'GROUP_MEMBER_DELEGATION_NOT_ACTIVE',
  ].find((code) => message.includes(code));
  if (conflict) {
    return new OrganizationApiError(
      409,
      conflict.toLowerCase(),
      conflict.includes('CHAIN')
        ? 'No se permiten cadenas ni ciclos de delegación.'
        : 'El slot ya no admite este cambio de delegación.'
    );
  }
  if (message.includes('GROUP_MEMBER_DELEGATION_SELF_DENIED')) {
    return new OrganizationApiError(422, 'self_delegation_denied', 'Selecciona otro miembro.');
  }
  if (message.includes('GROUP_MEMBER_DELEGATION_INPUT_INVALID')) {
    return new OrganizationApiError(422, 'delegation_input_invalid', 'Revisa los datos enviados.');
  }
  return cause;
}

export async function GET(request: Request, context: { params: Promise<{ documentId: string }> }) {
  try {
    const { documentId } = await context.params;
    const query = new URL(request.url).searchParams;
    const workspaceId = z
      .string()
      .uuid()
      .parse(query.get('workspace_id') || '');
    const participantReferenceId = query.get('participant_reference_id');

    if (participantReferenceId) {
      z.string().uuid().parse(participantReferenceId);
      const { user, userClient, service } = await authenticateOrganizationRequest(request);
      if (!(await isPhaseDFeatureEnabled(service, PHASE_D_FLAGS.delegation))) {
        return Response.json({ success: false, code: 'feature_disabled' }, { status: 404 });
      }
      await ensureDocumentScope(service, documentId, workspaceId);
      const data = await loadGroupDelegationContext({
        service,
        documentId,
        workspaceId,
        participantReferenceId,
        user,
        canManage: await hasDelegationPermission(userClient, workspaceId),
      });
      return Response.json({ success: true, data });
    }

    const { service } = await authorizeOrganizationRequest(request, workspaceId, 'resources.read');
    await ensureDocumentScope(service, documentId, workspaceId);
    const result = await service
      .from('document_participant_delegations')
      .select(
        '*,workspace_members!document_participant_delegations_delegate_member_id_fkey(id,user_id,role,user_profiles(full_name,email))'
      )
      .eq('document_id', documentId)
      .order('created_at', { ascending: false });
    if (result.error) throw result.error;
    return Response.json({ success: true, data: result.data || [] });
  } catch (cause) {
    return organizationApiFailure(normalizeDelegationError(cause));
  }
}

async function recordAudit(service: SupabaseClient, values: Row) {
  const result = await service.from('organization_audit_events').insert({
    ...values,
    resource_type: 'document_participant_delegation',
    outcome: 'success',
    severity: 'high',
    module: 'delegation',
    origin: 'api',
    correlation_id: randomUUID(),
  });
  if (result.error && result.error.code !== '23505') throw result.error;
}

export async function POST(request: Request, context: { params: Promise<{ documentId: string }> }) {
  try {
    const { documentId } = await context.params;
    const input = mutationSchema.parse(await request.json());
    const { user, userClient, service } = await authenticateOrganizationRequest(request);
    if (!(await isPhaseDFeatureEnabled(service, PHASE_D_FLAGS.delegation))) {
      return Response.json({ success: false, code: 'feature_disabled' }, { status: 404 });
    }
    const document = await ensureDocumentScope(service, documentId, input.workspace_id);
    const canManage = await hasDelegationPermission(userClient, input.workspace_id);

    if (input.action === 'revoke') {
      const current = await service
        .from('document_participant_delegations')
        .select('id,group_member_slot_id,original_participant_reference_id,status')
        .eq('id', input.delegation_id)
        .eq('document_id', documentId)
        .eq('workspace_id', input.workspace_id)
        .maybeSingle();
      if (current.error) throw current.error;
      if (!current.data) {
        throw new OrganizationApiError(404, 'delegation_not_found', 'Delegación no encontrada.');
      }

      let revoked;
      if (current.data.group_member_slot_id) {
        revoked = await service.rpc('revoke_group_member_delegation', {
          p_document_id: documentId,
          p_workspace_id: input.workspace_id,
          p_delegation_id: input.delegation_id,
          p_actor_user_id: user.id,
          p_idempotency_key: input.idempotency_key || randomUUID(),
        });
        if (revoked.error) throw revoked.error;
      } else {
        if (!canManage) {
          throw new OrganizationApiError(
            403,
            'permission_denied',
            'No tienes permiso para revocar esta delegación.'
          );
        }
        revoked = await service
          .from('document_participant_delegations')
          .update({ status: 'revoked', revoked_at: new Date().toISOString(), revoked_by: user.id })
          .eq('id', input.delegation_id)
          .eq('status', 'active')
          .select('*')
          .maybeSingle();
        if (revoked.error) throw revoked.error;
        if (!revoked.data) {
          throw new OrganizationApiError(
            409,
            'delegation_not_active',
            'La delegación ya no está activa.'
          );
        }
      }
      await recordAudit(service, {
        workspace_id: input.workspace_id,
        actor_user_id: user.id,
        event_type: current.data.group_member_slot_id
          ? 'group_member.delegation_revoked'
          : 'participant.delegation.revoked',
        resource_id: input.delegation_id,
        summary: 'Delegación documental revocada',
        payload: {
          document_id: documentId,
          group_member_slot_id: current.data.group_member_slot_id,
          original_participant_reference_id: current.data.original_participant_reference_id,
        },
      });
      return Response.json({ success: true, data: revoked.data });
    }

    const groupMembership = await service
      .from('document_signing_group_members')
      .select('id')
      .eq('document_id', documentId)
      .eq('workspace_id', input.workspace_id)
      .eq('participant_reference_id', input.participant_reference_id)
      .maybeSingle();
    if (groupMembership.error) throw groupMembership.error;
    if (groupMembership.data) {
      const result = await service.rpc('create_group_member_delegation', {
        p_document_id: documentId,
        p_workspace_id: input.workspace_id,
        p_original_participant_reference_id: input.participant_reference_id,
        p_delegate_member_id: input.delegate_member_id,
        p_actor_user_id: user.id,
        p_reason: input.reason,
        p_idempotency_key: input.idempotency_key || randomUUID(),
      });
      if (result.error) throw result.error;
      await recordAudit(service, {
        workspace_id: input.workspace_id,
        actor_user_id: user.id,
        event_type: 'group_member.delegation_created',
        resource_id: result.data.id,
        summary: 'Delegación de miembro de grupo creada',
        payload: {
          document_id: documentId,
          participant_reference_id: input.participant_reference_id,
          delegate_member_id: input.delegate_member_id,
          group_member_slot_id: groupMembership.data.id,
        },
      });
      await notifyDelegateForActiveInvitation(service, document, input.participant_reference_id);
      return Response.json({ success: true, data: result.data }, { status: 201 });
    }

    if (!canManage) {
      throw new OrganizationApiError(
        403,
        'permission_denied',
        'No tienes permiso para delegar en nombre de otra persona.'
      );
    }
    const [reference, delegate, workspace] = await Promise.all([
      service
        .from('document_participant_references')
        .select('id,workspace_id,active,snapshot')
        .eq('id', input.participant_reference_id)
        .eq('document_id', documentId)
        .maybeSingle(),
      service
        .from('workspace_members')
        .select('id,user_id,workspace_id,status,role,access_expires_at')
        .eq('id', input.delegate_member_id)
        .eq('workspace_id', input.workspace_id)
        .eq('status', 'active')
        .maybeSingle(),
      service
        .from('workspaces')
        .select('organization_settings')
        .eq('id', input.workspace_id)
        .single(),
    ]);
    for (const result of [reference, delegate, workspace]) if (result.error) throw result.error;
    if (!reference.data?.active || reference.data.workspace_id !== input.workspace_id) {
      throw new OrganizationApiError(
        403,
        'participant_scope_denied',
        'El participante no pertenece al documento.'
      );
    }
    const participant = (reference.data.snapshot || {}) as Row;
    const participantState = String(
      participant.sub_estado || participant.estado || ''
    ).toLowerCase();
    if (
      ['firmo', 'firmado', 'aprobo', 'aprobado', 'atestiguo', 'testigo_completado'].includes(
        participantState
      )
    ) {
      throw new OrganizationApiError(
        409,
        'participant_already_completed',
        'El acto del participante ya no admite delegación.'
      );
    }
    if (
      !delegate.data?.user_id ||
      delegate.data.workspace_id !== input.workspace_id ||
      (delegate.data.access_expires_at &&
        new Date(delegate.data.access_expires_at).getTime() <= Date.now())
    ) {
      throw new OrganizationApiError(
        403,
        'delegate_scope_denied',
        'El delegado debe ser un miembro interno activo.'
      );
    }
    const policy = normalizeOrganizationDelegationPolicy(workspace.data?.organization_settings);
    if (policy.mode === 'DISABLED') {
      throw new OrganizationApiError(
        409,
        'delegation_policy_disabled',
        'La política de la organización no permite delegaciones.'
      );
    }
    if (!delegationPolicyAllowsMember(policy, delegate.data)) {
      throw new OrganizationApiError(
        403,
        'delegate_policy_denied',
        'El miembro seleccionado no está autorizado por la política de delegación.'
      );
    }
    const inserted = await service
      .from('document_participant_delegations')
      .insert({
        workspace_id: input.workspace_id,
        document_id: documentId,
        original_participant_reference_id: input.participant_reference_id,
        delegate_member_id: input.delegate_member_id,
        delegate_user_id: delegate.data.user_id,
        created_by: user.id,
        reason: input.reason,
        policy_mode: policy.mode,
        policy_snapshot: policy,
      })
      .select('*')
      .single();
    if (inserted.error) throw inserted.error;
    await recordAudit(service, {
      workspace_id: input.workspace_id,
      actor_user_id: user.id,
      event_type: 'participant.delegation.created',
      resource_id: inserted.data.id,
      summary: 'Delegación documental creada',
      payload: {
        document_id: documentId,
        participant_reference_id: input.participant_reference_id,
        delegate_member_id: input.delegate_member_id,
      },
    });
    return Response.json({ success: true, data: inserted.data }, { status: 201 });
  } catch (cause) {
    return organizationApiFailure(normalizeDelegationError(cause));
  }
}
