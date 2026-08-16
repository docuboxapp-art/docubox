import { createHash, randomBytes } from 'crypto';
import { z } from 'zod';
import { OrganizationApiError, organizationApiFailure } from '@/lib/organization/server';
import {
  authorizeCollaborationRequest,
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
  due_at: z.string().datetime().nullable().optional(),
  space_id: z.string().uuid().nullable().optional(),
  items: z
    .array(
      z.object({
        item_type: z.enum(['document', 'form', 'identity', 'signature']).default('document'),
        title: z.string().trim().min(2).max(180),
        description: z.string().trim().max(2000).nullable().optional(),
        required: z.boolean().default(true),
      })
    )
    .min(1)
    .max(50),
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
});

const automationSchema = z.object({
  workspace_id: z.string().uuid(),
  name: z.string().trim().min(3).max(180),
  description: z.string().trim().max(3000).nullable().optional(),
  trigger_definition: z.record(z.string(), z.unknown()),
  conditions: z.array(z.unknown()).default([]),
  actions: z.array(z.unknown()).min(1).max(20),
});

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
    const { service, access } = await authorizeCollaborationRequest(
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
    const workspaceId = String(body?.workspace_id || '');
    const { service, user, access } = await authorizeCollaborationRequest(
      request,
      workspaceId,
      permission,
      true
    );
    if (resource === 'rooms')
      requireCollaborationEntitlement(access, 'collaboration_external_rooms', true, { proFeature: true });
    if (resource === 'automations')
      requireCollaborationEntitlement(access, 'collaboration_automations', true, { proFeature: true });
    if (resource === 'reviews')
      requireCollaborationEntitlement(access, 'collaboration_advanced_reviews', true);
    if (resource === 'negotiations')
      requireCollaborationEntitlement(access, 'collaboration_advanced_workflows', true, { proFeature: true });
    if (['committees', 'closings'].includes(resource))
      requireCollaborationEntitlement(access, 'collaboration_advanced_workflows', true, { proFeature: true });

    let created: Record<string, unknown>;
    let oneTimeCredentials: Array<Record<string, string>> = [];
    if (resource === 'spaces') {
      const input = spaceSchema.parse(body);
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
      const result = await service
        .from('collaboration_milestones')
        .insert({ ...input, created_by: user.id, owner_id: input.owner_id || user.id })
        .select('*')
        .single();
      if (result.error) throw result.error;
      created = result.data;
    } else if (resource === 'requests') {
      const input = requestSchema.parse(body);
      const { items, ...requestValues } = input;
      const token = randomBytes(32).toString('base64url');
      const folio = `SOL-${new Date().getFullYear()}-${randomBytes(3).toString('hex').toUpperCase()}`;
      const result = await service
        .from('collaboration_document_requests')
        .insert({
          ...requestValues,
          folio,
          status: 'sent',
          sent_at: new Date().toISOString(),
          created_by: user.id,
          access_token_hash: createHash('sha256').update(token).digest('hex'),
          access_expires_at: input.due_at || new Date(Date.now() + 14 * 86400000).toISOString(),
        })
        .select('*')
        .single();
      if (result.error) throw result.error;
      const itemResult = await service.from('collaboration_request_items').insert(
        items.map((item, position) => ({
          ...item,
          workspace_id: workspaceId,
          request_id: result.data.id,
          position,
        }))
      );
      if (itemResult.error) {
        await service.from('collaboration_document_requests').delete().eq('id', result.data.id);
        throw itemResult.error;
      }
      created = result.data;
      oneTimeCredentials = [{ type: 'request', token, path: `/solicitud/${token}` }];
    } else if (resource === 'rooms') {
      const input = roomSchema.parse(body);
      const { guests, ...room } = input;
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
      }
    } else if (resource === 'automations') {
      const input = automationSchema.parse(body);
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
    } else if (resource === 'negotiations') {
      const input = negotiationSchema.parse(body);
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
      const { reviewer_ids, ...review } = input;
      const version = await service
        .from('document_versions')
        .select('id,document_id,status')
        .eq('workspace_id', workspaceId)
        .eq('id', input.document_version_id)
        .maybeSingle();
      if (version.error) throw version.error;
      if (!version.data || version.data.document_id !== input.document_id)
        throw new OrganizationApiError(
          409,
          'review_version_mismatch',
          'La version seleccionada no pertenece al documento.'
        );
      if (['sent', 'signed', 'obsolete'].includes(version.data.status))
        throw new OrganizationApiError(
          409,
          'immutable_version',
          'Esta version es inmutable y no puede abrir una nueva ronda de revision.'
        );
      const rounds = await service
        .from('collaboration_review_rounds')
        .select('round_number')
        .eq('document_id', input.document_id)
        .order('round_number', { ascending: false })
        .limit(1);
      if (rounds.error) throw rounds.error;
      const result = await service
        .from('collaboration_review_rounds')
        .insert({
          ...review,
          requested_by: user.id,
          round_number: (rounds.data?.[0]?.round_number || 0) + 1,
          status: 'open',
        })
        .select('*')
        .single();
      if (result.error) throw result.error;
      const reviewers = await service.from('collaboration_reviewers').insert(
        reviewer_ids.map((reviewerId) => ({
          workspace_id: workspaceId,
          review_round_id: result.data.id,
          user_id: reviewerId,
        }))
      );
      if (reviewers.error) {
        await service.from('collaboration_review_rounds').delete().eq('id', result.data.id);
        throw reviewers.error;
      }
      const versionUpdate = await service
        .from('document_versions')
        .update({ status: 'in_review' })
        .eq('workspace_id', workspaceId)
        .eq('id', input.document_version_id)
        .eq('status', version.data.status);
      if (versionUpdate.error) throw versionUpdate.error;
      created = result.data;
    }

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
      { status: 201 }
    );
  } catch (error) {
    return organizationApiFailure(error);
  }
}
