import { assertCollaborationCreationReferences } from '@/lib/collaboration/references.server';
import { collaborationRequestItemSchema } from '@/lib/collaboration/request-items';
import { prepareCollaborationRequestItems } from '@/lib/collaboration/request-items.server';
import {
  sendCollaborationRequestInvitation,
  sendCollaborationRoomInvitation,
} from '@/lib/collaboration/invitations.server';
import { createHash, randomBytes } from 'crypto';
import { z } from 'zod';
import { automationDefinitionSchema } from '@/lib/collaboration/automation-contracts';
import { OrganizationApiError, organizationApiFailure } from '@/lib/organization/server';
import {
  authorizeCollaborationRequest,
  assertCollaborationCreationScope,
  recordCollaborationAudit,
  requireCollaborationEntitlement,
} from '@/lib/collaboration/server';

export const runtime = 'nodejs';

const resourceDefinitions = {
  spaces: {
    table: 'collaboration_spaces',
    permission: 'collaboration_spaces.view',
    order: 'updated_at',
  },
  reviews: {
    table: 'collaboration_review_rounds',
    permission: 'reviews.view',
    order: 'updated_at',
    entitlement: 'collaboration_advanced_reviews',
  },
  versions: {
    table: 'document_versions',
    permission: 'versions.view',
    order: 'created_at',
    entitlement: 'collaboration_advanced_reviews',
  },
  milestones: {
    table: 'collaboration_milestones',
    permission: 'collaboration_spaces.view',
    order: 'due_at',
  },
  activity: {
    table: 'collaboration_activity_events',
    permission: 'collaboration.view_dashboard',
    order: 'occurred_at',
  },
  requests: {
    table: 'collaboration_document_requests',
    permission: 'requests.view',
    order: 'updated_at',
  },
  rooms: {
    table: 'collaboration_rooms',
    permission: 'rooms.view',
    order: 'updated_at',
    entitlement: 'collaboration_external_rooms',
    proFeature: true,
  },
  automations: {
    table: 'collaboration_automations',
    permission: 'automations.view',
    order: 'updated_at',
    entitlement: 'collaboration_automations',
    proFeature: true,
  },
  negotiations: {
    table: 'collaboration_negotiation_items',
    permission: 'reviews.view',
    order: 'updated_at',
    entitlement: 'collaboration_advanced_workflows',
    proFeature: true,
  },
  committees: {
    table: 'collaboration_committees',
    permission: 'collaboration_spaces.view',
    order: 'updated_at',
    entitlement: 'collaboration_advanced_workflows',
    proFeature: true,
  },
  closings: {
    table: 'collaboration_closing_rooms',
    permission: 'collaboration_spaces.view',
    order: 'updated_at',
    entitlement: 'collaboration_advanced_workflows',
    proFeature: true,
  },
} as const;

type ResourceName = keyof typeof resourceDefinitions;

function getDefinition(resource: string) {
  const definition = resourceDefinitions[resource as ResourceName];
  if (!definition)
    throw new OrganizationApiError(404, 'resource_not_found', 'El recurso solicitado no existe.');
  return definition;
}

const spaceSchema = z.object({
  workspace_id: z.string().uuid(),
  name: z.string().trim().min(3).max(180),
  description: z.string().trim().max(3000).nullable().optional(),
  space_type: z
    .enum([
      'client',
      'project',
      'area',
      'operation',
      'contract',
      'case_file',
      'committee',
      'closing',
    ])
    .default('project'),
  confidentiality: z.enum(['internal', 'confidential', 'restricted']).default('internal'),
  owner_id: z.string().uuid().nullable().optional(),
});

const milestoneSchema = z.object({
  workspace_id: z.string().uuid(),
  title: z.string().trim().min(3).max(180),
  description: z.string().trim().max(2000).nullable().optional(),
  space_id: z.string().uuid().nullable().optional(),
  due_at: z.string().datetime(),
  starts_at: z.string().datetime().nullable().optional(),
  owner_id: z.string().uuid().nullable().optional(),
});

const requestSchema = z.object({
  workspace_id: z.string().uuid(),
  title: z.string().trim().min(3).max(180),
  description: z.string().trim().max(3000).nullable().optional(),
  recipient_name: z.string().trim().min(2).max(180),
  recipient_email: z.string().trim().email().max(320),
  responsible_user_id: z.string().uuid().nullable().optional(),
  due_at: z.string().datetime().nullable().optional(),
  space_id: z.string().uuid().nullable().optional(),
  items: z.array(collaborationRequestItemSchema).min(1).max(50),
  send_invitation: z.boolean().default(true),
});

const roomSchema = z.object({
  workspace_id: z.string().uuid(),
  name: z.string().trim().min(3).max(180),
  purpose: z.string().trim().max(3000).nullable().optional(),
  room_type: z
    .enum(['counterparty', 'data_room', 'negotiation', 'committee', 'closing'])
    .default('counterparty'),
  expires_at: z.string().datetime(),
  space_id: z.string().uuid().nullable().optional(),
  otp_required: z.boolean().default(true),
  downloads_allowed: z.boolean().default(false),
  watermark_enabled: z.boolean().default(true),
  guests: z
    .array(
      z.object({
        name: z.string().trim().min(2).max(180),
        email: z.string().trim().email().max(320),
      })
    )
    .max(100)
    .default([]),
  send_invitation: z.boolean().default(true),
});

const automationSchema = z
  .object({
    workspace_id: z.string().uuid(),
    name: z.string().trim().min(3).max(180),
    description: z.string().trim().max(3000).nullable().optional(),
  })
  .and(automationDefinitionSchema);

const reviewSchema = z.object({
  workspace_id: z.string().uuid(),
  document_id: z.string().uuid(),
  document_version_id: z.string().uuid(),
  title: z.string().trim().min(3).max(180),
  due_at: z.string().datetime().nullable().optional(),
  reviewer_ids: z.array(z.string().uuid()).min(1).max(100),
});

const negotiationSchema = z.object({
  workspace_id: z.string().uuid(),
  space_id: z.string().uuid().nullable().optional(),
  document_id: z.string().uuid(),
  document_version_id: z.string().uuid().nullable().optional(),
  clause_reference: z.string().trim().min(1).max(180),
  original_text: z.string().trim().max(10000).nullable().optional(),
  requested_change: z.string().trim().min(3).max(10000),
  internal_position: z.string().trim().max(10000).nullable().optional(),
});

const committeeSchema = z.object({
  workspace_id: z.string().uuid(),
  space_id: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(3).max(180),
  purpose: z.string().trim().max(3000).nullable().optional(),
  scheduled_at: z.string().datetime().nullable().optional(),
  quorum_minimum: z.number().int().min(1).max(1000).default(1),
  first_agenda_item: z.string().trim().min(3).max(500),
});

const closingSchema = z.object({
  workspace_id: z.string().uuid(),
  space_id: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(3).max(180),
  conditions: z.array(z.string().trim().min(2).max(500)).min(1).max(100),
});

export async function GET(request: Request, context: { params: Promise<{ resource: string }> }) {
  try {
    const { resource } = await context.params;
    const definition = getDefinition(resource);
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get('workspace_id') || '';
    const status = url.searchParams.get('status');
    const id = url.searchParams.get('id');
    const spaceId = url.searchParams.get('space_id');
    const documentId = url.searchParams.get('document_id');
    const { userClient: service, access } = await authorizeCollaborationRequest(
      request,
      workspaceId,
      definition.permission
    );
    if ('entitlement' in definition)
      requireCollaborationEntitlement(access, definition.entitlement, false, {
        proFeature: 'proFeature' in definition && definition.proFeature,
      });

    const selection = resource === 'versions' ? '*,documentos(id,nombre,documento_id)' : '*';
    let query = service
      .from(definition.table)
      .select(selection)
      .eq('workspace_id', workspaceId)
      .limit(300);
    if (id) query = query.eq('id', id);
    if (status) query = query.eq('status', status);
    if (
      spaceId &&
      [
        'milestones',
        'activity',
        'requests',
        'rooms',
        'negotiations',
        'committees',
        'closings',
      ].includes(resource)
    )
      query = query.eq('space_id', spaceId);
    if (documentId && ['reviews', 'versions', 'negotiations'].includes(resource))
      query = query.eq('document_id', documentId);
    query = query.order(definition.order, {
      ascending: resource === 'milestones',
      nullsFirst: false,
    });
    const result = await query;
    if (result.error) throw result.error;
    return Response.json({ success: true, data: result.data || [] });
  } catch (error) {
    return organizationApiFailure(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ resource: string }> }) {
  try {
    const { resource } = await context.params;
    const body = await request.json();
    const permissionByResource: Record<string, string> = {
      spaces: 'collaboration_spaces.create',
      milestones: 'collaboration_spaces.create',
      requests: 'requests.create',
      rooms: 'rooms.create',
      automations: 'automations.manage',
      reviews: 'reviews.create',
      negotiations: 'reviews.create',
      committees: 'collaboration_spaces.create',
      closings: 'collaboration_spaces.create',
    };
    const permission = permissionByResource[resource];
    if (!permission)
      throw new OrganizationApiError(
        405,
        'resource_read_only',
        'Este recurso no se crea desde este endpoint.'
      );
    const workspaceId = z.string().uuid().parse(body?.workspace_id);
    const { service, user, access, userClient } = await authorizeCollaborationRequest(
      request,
      workspaceId,
      permission,
      true
    );
    if (resource === 'rooms')
      requireCollaborationEntitlement(access, 'collaboration_external_rooms', true, {
        proFeature: true,
      });
    if (resource === 'automations')
      requireCollaborationEntitlement(access, 'collaboration_automations', true, {
        proFeature: true,
      });
    if (resource === 'reviews')
      requireCollaborationEntitlement(access, 'collaboration_advanced_reviews', true);
    if (resource === 'negotiations')
      requireCollaborationEntitlement(access, 'collaboration_advanced_workflows', true, {
        proFeature: true,
      });
    if (['committees', 'closings'].includes(resource))
      requireCollaborationEntitlement(access, 'collaboration_advanced_workflows', true, {
        proFeature: true,
      });

    await assertCollaborationCreationReferences(service, workspaceId, body);
    let created: Record<string, unknown>;
    let oneTimeCredentials: Array<Record<string, string>> = [];
    if (resource === 'spaces') {
      const input = spaceSchema.parse(body);
      await assertCollaborationCreationScope(
        userClient,
        workspaceId,
        permission,
        'space',
        user.id,
        input
      );
      const result = await service
        .from('collaboration_spaces')
        .insert({
          ...input,
          status: 'active',
          created_by: user.id,
          owner_id: input.owner_id || user.id,
        })
        .select('*')
        .single();
      if (result.error) throw result.error;
      created = result.data;
    } else if (resource === 'milestones') {
      const input = milestoneSchema.parse(body);
      await assertCollaborationCreationScope(
        userClient,
        workspaceId,
        permission,
        'milestone',
        user.id,
        input
      );
      const result = await service
        .from('collaboration_milestones')
        .insert({ ...input, created_by: user.id, owner_id: input.owner_id || user.id })
        .select('*')
        .single();
      if (result.error) throw result.error;
      created = result.data;
    } else if (resource === 'requests') {
      const input = requestSchema.parse(body);
      await assertCollaborationCreationScope(
        userClient,
        workspaceId,
        permission,
        'request',
        user.id,
        input
      );
      if (input.due_at && Date.parse(input.due_at) <= Date.now())
        throw new OrganizationApiError(
          422,
          'invalid_due_date',
          'El vencimiento debe ser posterior a la fecha actual.'
        );
      const preparedItems = await prepareCollaborationRequestItems(
        service,
        workspaceId,
        input.recipient_email,
        input.items
      );
      const token = randomBytes(32).toString('base64url');
      const { items: _items, send_invitation: _send, ...values } = input;
      const result = await service.rpc('colabora_create_document_request', {
        ws: workspaceId,
        actor: user.id,
        request_values: { ...values, send_invitation: input.send_invitation },
        items: preparedItems,
        token_hash: createHash('sha256').update(token).digest('hex'),
      });
      if (result.error) throw result.error;
      created = result.data;
      if (input.send_invitation) {
        const invitation = await sendCollaborationRequestInvitation(service, created, token);
        created = { ...created, invitation_status: invitation.status };
      }
      oneTimeCredentials = [{ type: 'request', token, path: `/solicitud/${token}` }];
    } else if (resource === 'rooms') {
      const input = roomSchema.parse(body);
      await assertCollaborationCreationScope(
        userClient,
        workspaceId,
        permission,
        'room',
        user.id,
        input
      );
      if (Date.parse(input.expires_at) <= Date.now())
        throw new OrganizationApiError(422, 'expiry_required', 'Selecciona una vigencia futura.');
      const { guests, send_invitation, ...room } = input;
      const result = await service
        .from('collaboration_rooms')
        .insert({
          ...room,
          status: 'active',
          owner_id: user.id,
          created_by: user.id,
          starts_at: new Date().toISOString(),
        })
        .select('*')
        .single();
      if (result.error) throw result.error;
      created = result.data;
      if (guests.length) {
        const rows = guests.map((guest) => {
          const token = randomBytes(32).toString('base64url');
          oneTimeCredentials.push({
            type: 'room_guest',
            email: guest.email,
            token,
            path: `/sala/${token}`,
          });
          return {
            workspace_id: workspaceId,
            room_id: result.data.id,
            ...guest,
            email: guest.email.toLowerCase(),
            token_hash: createHash('sha256').update(token).digest('hex'),
            token_expires_at: input.expires_at,
            invited_by: user.id,
          };
        });
        const guestResult = await service.from('collaboration_room_guests').insert(rows);
        if (guestResult.error) {
          await service.from('collaboration_rooms').delete().eq('id', result.data.id);
          throw guestResult.error;
        }
        if (send_invitation)
          for (const credential of oneTimeCredentials) {
            const guest = guests.find((item) => item.email === credential.email);
            if (guest)
              credential.delivery_status = (
                await sendCollaborationRoomInvitation(service, created, guest, credential.token)
              ).status;
          }
      }
    } else if (resource === 'automations') {
      const input = automationSchema.parse(body);
      await assertCollaborationCreationScope(
        userClient,
        workspaceId,
        permission,
        'automation',
        user.id,
        input
      );
      const { trigger_definition, conditions, actions, ...automation } = input;
      const result = await service
        .from('collaboration_automations')
        .insert({ ...automation, created_by: user.id })
        .select('*')
        .single();
      if (result.error) throw result.error;
      const version = await service
        .from('collaboration_automation_versions')
        .insert({
          workspace_id: workspaceId,
          automation_id: result.data.id,
          version: 1,
          trigger_definition,
          conditions,
          actions,
          created_by: user.id,
        })
        .select('*')
        .single();
      if (version.error) {
        await service.from('collaboration_automations').delete().eq('id', result.data.id);
        throw version.error;
      }
      created = { ...result.data, definition: version.data };
      await service.from('collaboration_activity_events').insert({
        workspace_id: workspaceId,
        actor_user_id: user.id,
        event_type: 'automation.created',
        resource_type: 'collaboration_automation',
        resource_id: result.data.id,
        summary: `Automatización creada: ${input.name}`,
        visibility: 'internal',
        metadata: { automation_version_id: version.data.id, version: 1 },
        idempotency_key: `automation-created:${result.data.id}`,
      });
    } else if (resource === 'negotiations') {
      const input = negotiationSchema.parse(body);
      await assertCollaborationCreationScope(
        userClient,
        workspaceId,
        permission,
        'negotiation',
        user.id,
        input
      );
      const document = await service
        .from('documentos')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('id', input.document_id)
        .maybeSingle();
      if (document.error) throw document.error;
      if (!document.data)
        throw new OrganizationApiError(404, 'document_not_found', 'El documento no existe.');
      const result = await service
        .from('collaboration_negotiation_items')
        .insert({ ...input, owner_id: user.id, status: 'open' })
        .select('*')
        .single();
      if (result.error) throw result.error;
      created = result.data;
    } else if (resource === 'committees') {
      const input = committeeSchema.parse(body);
      await assertCollaborationCreationScope(
        userClient,
        workspaceId,
        permission,
        'committee',
        user.id,
        input
      );
      const { quorum_minimum, first_agenda_item, ...committee } = input;
      const result = await service
        .from('collaboration_committees')
        .insert({
          ...committee,
          status: 'draft',
          quorum_rule: { type: 'minimum', value: quorum_minimum },
          agenda: [
            { key: randomBytes(6).toString('hex'), title: first_agenda_item, status: 'pending' },
          ],
          created_by: user.id,
        })
        .select('*')
        .single();
      if (result.error) throw result.error;
      created = result.data;
    } else if (resource === 'closings') {
      const input = closingSchema.parse(body);
      await assertCollaborationCreationScope(
        userClient,
        workspaceId,
        permission,
        'closing',
        user.id,
        input
      );
      const result = await service
        .from('collaboration_closing_rooms')
        .insert({
          ...input,
          conditions: input.conditions.map((title, index) => ({
            key: `condition-${index + 1}`,
            title,
            status: 'pending',
          })),
          status: 'preparing',
          created_by: user.id,
        })
        .select('*')
        .single();
      if (result.error) throw result.error;
      created = result.data;
    } else {
      const input = reviewSchema.parse(body);
      await assertCollaborationCreationScope(
        userClient,
        workspaceId,
        permission,
        'review',
        user.id,
        input
      );
      const result = await service.rpc('colabora_create_review', {
        ws: workspaceId,
        actor: user.id,
        document_id: input.document_id,
        version_id: input.document_version_id,
        review_title: input.title,
        reviewer_ids: [...new Set(input.reviewer_ids)],
        due_at: input.due_at || null,
      });
      if (result.error) throw result.error;
      created = result.data;
    }

    if (!['requests', 'reviews'].includes(resource))
      await recordCollaborationAudit(service, {
        workspaceId,
        actorUserId: user.id,
        eventType: `collaboration.${resource}_created`,
        resourceType: resource,
        resourceId: String(created.id || ''),
        summary: `Se creo un recurso de Colabora: ${resource}.`,
      });
    return Response.json(
      { success: true, data: created, one_time_credentials: oneTimeCredentials },
      { status: 201, headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    return organizationApiFailure(error);
  }
}
