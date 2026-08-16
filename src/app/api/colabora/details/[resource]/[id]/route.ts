import { createHash, randomBytes } from 'crypto';
import { z } from 'zod';
import { OrganizationApiError, organizationApiFailure } from '@/lib/organization/server';
import {
  authorizeCollaborationRequest,
  recordCollaborationAudit,
  requireCollaborationEntitlement,
} from '@/lib/collaboration/server';
import { executeConfiguredAutomation } from '@/lib/collaboration/automation';

export const runtime = 'nodejs';

const definitions = {
  spaces: { table: 'collaboration_spaces', permission: 'collaboration_spaces.view' },
  requests: { table: 'collaboration_document_requests', permission: 'requests.view' },
  rooms: {
    table: 'collaboration_rooms',
    permission: 'rooms.view',
    entitlement: 'collaboration_external_rooms',
    proFeature: true,
  },
  automations: {
    table: 'collaboration_automations',
    permission: 'automations.view',
    entitlement: 'collaboration_automations',
    proFeature: true,
  },
  negotiations: {
    table: 'collaboration_negotiation_items',
    permission: 'reviews.view',
    entitlement: 'collaboration_advanced_workflows',
    proFeature: true,
  },
  committees: {
    table: 'collaboration_committees',
    permission: 'collaboration_spaces.view',
    entitlement: 'collaboration_advanced_workflows',
    proFeature: true,
  },
  closings: {
    table: 'collaboration_closing_rooms',
    permission: 'collaboration_spaces.view',
    entitlement: 'collaboration_advanced_workflows',
    proFeature: true,
  },
} as const;

const requestActionSchema = z.object({
  workspace_id: z.string().uuid(),
  action: z.enum(['approve_item', 'reject_item', 'request_replacement', 'waive_item', 'cancel']),
  item_id: z.string().uuid().optional(),
  reason: z.string().trim().max(2000).nullable().optional(),
});

const spaceActionSchema = z.discriminatedUnion('action', [
  z.object({
    workspace_id: z.string().uuid(),
    action: z.literal('add_member'),
    user_id: z.string().uuid(),
    role: z.enum(['coordinator', 'manager', 'collaborator', 'reviewer', 'approver', 'observer']),
  }),
  z.object({
    workspace_id: z.string().uuid(),
    action: z.literal('remove_member'),
    user_id: z.string().uuid(),
  }),
  z.object({
    workspace_id: z.string().uuid(),
    action: z.literal('add_milestone'),
    title: z.string().trim().min(3).max(180),
    description: z.string().trim().max(2000).nullable().optional(),
    due_at: z.string().datetime(),
  }),
  z.object({
    workspace_id: z.string().uuid(),
    action: z.literal('complete_milestone'),
    milestone_id: z.string().uuid(),
  }),
  z.object({
    workspace_id: z.string().uuid(),
    action: z.literal('add_resource'),
    resource_type: z.enum(['document', 'document_version', 'case_file', 'form', 'template']),
    resource_id: z.string().uuid(),
    display_name: z.string().trim().max(220).nullable().optional(),
  }),
  z.object({
    workspace_id: z.string().uuid(),
    action: z.literal('remove_resource'),
    space_resource_id: z.string().uuid(),
  }),
  z.object({
    workspace_id: z.string().uuid(),
    action: z.enum(['close', 'archive']),
    reason: z.string().trim().min(3).max(2000),
  }),
]);

const roomActionSchema = z.discriminatedUnion('action', [
  z.object({
    workspace_id: z.string().uuid(),
    action: z.literal('add_guest'),
    name: z.string().trim().min(2).max(160),
    email: z.string().trim().email().max(320),
    allow_download: z.boolean().default(false),
  }),
  z.object({
    workspace_id: z.string().uuid(),
    action: z.literal('revoke_guest'),
    guest_id: z.string().uuid(),
  }),
  z.object({
    workspace_id: z.string().uuid(),
    action: z.literal('add_resource'),
    resource_type: z.enum(['document', 'document_version']),
    resource_id: z.string().uuid(),
    display_name: z.string().trim().max(220).nullable().optional(),
    allow_download: z.boolean().default(false),
  }),
  z.object({
    workspace_id: z.string().uuid(),
    action: z.literal('remove_resource'),
    room_resource_id: z.string().uuid(),
  }),
  z.object({
    workspace_id: z.string().uuid(),
    action: z.literal('update_security'),
    downloads_allowed: z.boolean(),
    watermark_enabled: z.boolean(),
    terms_required: z.boolean(),
    session_minutes: z.number().int().min(5).max(1440),
  }),
  z.object({
    workspace_id: z.string().uuid(),
    action: z.enum(['close', 'revoke']),
    reason: z.string().trim().min(3).max(2000),
  }),
]);

const automationActionSchema = z.discriminatedUnion('action', [
  z.object({ workspace_id: z.string().uuid(), action: z.literal('publish') }),
  z.object({ workspace_id: z.string().uuid(), action: z.enum(['pause', 'disable']) }),
  z.object({ workspace_id: z.string().uuid(), action: z.literal('test_run') }),
  z.object({ workspace_id: z.string().uuid(), action: z.literal('run_now') }),
  z.object({
    workspace_id: z.string().uuid(),
    action: z.literal('retry_run'),
    run_id: z.string().uuid(),
  }),
]);

const negotiationActionSchema = z.object({
  workspace_id: z.string().uuid(),
  action: z.literal('update'),
  status: z.enum([
    'open',
    'internal_review',
    'counterparty_review',
    'agreed',
    'rejected',
    'withdrawn',
  ]),
  counterparty_proposal: z.string().trim().max(10000).nullable().optional(),
  internal_position: z.string().trim().max(10000).nullable().optional(),
  resolution: z.string().trim().max(10000).nullable().optional(),
});

const committeeActionSchema = z.discriminatedUnion('action', [
  z.object({
    workspace_id: z.string().uuid(),
    action: z.enum(['convene', 'start', 'close', 'cancel']),
  }),
  z.object({
    workspace_id: z.string().uuid(),
    action: z.literal('vote'),
    agenda_item_key: z.string().min(1).max(100),
    decision: z.enum(['for', 'against', 'abstain']),
    comment: z.string().trim().max(2000).nullable().optional(),
  }),
]);

const closingActionSchema = z.discriminatedUnion('action', [
  z.object({
    workspace_id: z.string().uuid(),
    action: z.literal('toggle_condition'),
    condition_key: z.string().min(1).max(100),
    completed: z.boolean(),
  }),
  z.object({
    workspace_id: z.string().uuid(),
    action: z.enum(['mark_ready', 'start_signing', 'release', 'seal', 'cancel']),
  }),
]);

const sha = (value: string) => createHash('sha256').update(value).digest('hex');

export async function GET(
  request: Request,
  context: { params: Promise<{ resource: string; id: string }> }
) {
  try {
    const { resource, id } = await context.params;
    const definition = definitions[resource as keyof typeof definitions];
    if (!definition)
      throw new OrganizationApiError(404, 'resource_not_found', 'El recurso no existe.');
    const workspaceId = new URL(request.url).searchParams.get('workspace_id') || '';
    const { service, access } = await authorizeCollaborationRequest(
      request,
      workspaceId,
      definition.permission
    );
    if ('entitlement' in definition)
      requireCollaborationEntitlement(access, definition.entitlement, false, {
        proFeature: 'proFeature' in definition && definition.proFeature,
      });
    const primary = await service
      .from(definition.table)
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle();
    if (primary.error) throw primary.error;
    if (!primary.data)
      throw new OrganizationApiError(
        404,
        'resource_not_found',
        'El recurso no existe o no esta en tu alcance.'
      );

    let related: Record<string, unknown[]> = {};
    if (resource === 'spaces') {
      const [members, resources, milestones, tasks, activity, documents, forms, templates, cases] =
        await Promise.all([
          service
            .from('collaboration_space_members')
            .select('*,user_profiles(full_name,email)')
            .eq('workspace_id', workspaceId)
            .eq('space_id', id),
          service
            .from('collaboration_space_resources')
            .select('*')
            .eq('workspace_id', workspaceId)
            .eq('space_id', id)
            .order('created_at', { ascending: false }),
          service
            .from('collaboration_milestones')
            .select('*')
            .eq('workspace_id', workspaceId)
            .eq('space_id', id)
            .order('due_at'),
          service
            .from('tareas')
            .select('id,title,estado,prioridad,due_date')
            .eq('workspace_id', workspaceId)
            .eq('collaboration_space_id', id)
            .order('due_date'),
          service
            .from('collaboration_activity_events')
            .select('*')
            .eq('workspace_id', workspaceId)
            .eq('space_id', id)
            .order('occurred_at', { ascending: false })
            .limit(30),
          service
            .from('documentos')
            .select('id,nombre,estado')
            .eq('workspace_id', workspaceId)
            .order('updated_at', { ascending: false })
            .limit(100),
          service
            .from('form_templates')
            .select('id,name,status')
            .eq('workspace_id', workspaceId)
            .order('updated_at', { ascending: false })
            .limit(100),
          service
            .from('plantillas')
            .select('id,nombre,estado')
            .eq('workspace_id', workspaceId)
            .order('updated_at', { ascending: false })
            .limit(100),
          service
            .from('case_files')
            .select('id,title,status')
            .eq('workspace_id', workspaceId)
            .order('updated_at', { ascending: false })
            .limit(100),
        ]);
      for (const result of [
        members,
        resources,
        milestones,
        tasks,
        activity,
        documents,
        forms,
        templates,
        cases,
      ])
        if (result.error) throw result.error;
      related = {
        members: members.data || [],
        resources: resources.data || [],
        milestones: milestones.data || [],
        tasks: tasks.data || [],
        activity: activity.data || [],
        resource_catalog: [
          ...(documents.data || []).map((item) => ({
            id: item.id,
            resource_type: 'document',
            display_name: item.nombre,
            status: item.estado,
          })),
          ...(forms.data || []).map((item) => ({
            id: item.id,
            resource_type: 'form',
            display_name: item.name,
            status: item.status,
          })),
          ...(templates.data || []).map((item) => ({
            id: item.id,
            resource_type: 'template',
            display_name: item.nombre,
            status: item.estado,
          })),
          ...(cases.data || []).map((item) => ({
            id: item.id,
            resource_type: 'case_file',
            display_name: item.title,
            status: item.status,
          })),
        ],
      };
    } else if (resource === 'requests') {
      const items = await service
        .from('collaboration_request_items')
        .select('*,collaboration_request_files(*)')
        .eq('workspace_id', workspaceId)
        .eq('request_id', id)
        .order('position');
      if (items.error) throw items.error;
      related = { items: items.data || [] };
    } else if (resource === 'rooms') {
      const [guests, resources, events] = await Promise.all([
        service
          .from('collaboration_room_guests')
          .select('id,name,email,status,token_expires_at,last_access_at,created_at')
          .eq('workspace_id', workspaceId)
          .eq('room_id', id),
        service
          .from('collaboration_room_resources')
          .select('*')
          .eq('workspace_id', workspaceId)
          .eq('room_id', id)
          .order('position'),
        service
          .from('collaboration_external_events')
          .select('id,event_type,summary,occurred_at,guest_id')
          .eq('workspace_id', workspaceId)
          .eq('room_id', id)
          .order('occurred_at', { ascending: false })
          .limit(50),
      ]);
      for (const result of [guests, resources, events]) if (result.error) throw result.error;
      related = {
        guests: guests.data || [],
        resources: resources.data || [],
        events: events.data || [],
      };
    } else if (resource === 'automations') {
      const [versions, runs] = await Promise.all([
        service
          .from('collaboration_automation_versions')
          .select('*')
          .eq('workspace_id', workspaceId)
          .eq('automation_id', id)
          .order('version', { ascending: false }),
        service
          .from('collaboration_automation_runs')
          .select('id,status,attempt_count,error_code,scheduled_at,completed_at,result_summary')
          .eq('workspace_id', workspaceId)
          .eq('automation_id', id)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);
      if (versions.error) throw versions.error;
      if (runs.error) throw runs.error;
      related = { versions: versions.data || [], runs: runs.data || [] };
    } else if (resource === 'committees') {
      const votes = await service
        .from('collaboration_committee_votes')
        .select('*,user_profiles(full_name,email)')
        .eq('workspace_id', workspaceId)
        .eq('committee_id', id)
        .order('cast_at', { ascending: false });
      if (votes.error) throw votes.error;
      related = { votes: votes.data || [] };
    }
    return Response.json({ success: true, data: { resource: primary.data, ...related } });
  } catch (error) {
    return organizationApiFailure(error);
  }
}

async function updateSpace(request: Request, id: string, body: unknown) {
  const input = spaceActionSchema.parse(body);
  const permission = ['add_member', 'remove_member'].includes(input.action)
    ? 'collaboration_spaces.manage_members'
    : ['close', 'archive'].includes(input.action)
      ? 'collaboration_spaces.archive'
      : 'collaboration_spaces.create';
  const { service, user } = await authorizeCollaborationRequest(
    request,
    input.workspace_id,
    permission,
    true
  );
  const space = await service
    .from('collaboration_spaces')
    .select('id,status,owner_id,settings,closed_at')
    .eq('workspace_id', input.workspace_id)
    .eq('id', id)
    .maybeSingle();
  if (space.error) throw space.error;
  if (!space.data) throw new OrganizationApiError(404, 'space_not_found', 'El espacio no existe.');
  if (['closed', 'archived'].includes(space.data.status) && input.action !== 'archive')
    throw new OrganizationApiError(409, 'space_is_closed', 'El espacio esta cerrado.');

  if (input.action === 'add_member') {
    const membership = await service
      .from('workspace_members')
      .select('user_id,status')
      .eq('workspace_id', input.workspace_id)
      .eq('user_id', input.user_id)
      .eq('status', 'active')
      .maybeSingle();
    if (membership.error) throw membership.error;
    if (!membership.data)
      throw new OrganizationApiError(
        409,
        'organization_membership_required',
        'Solo puedes agregar miembros activos de la organizacion.'
      );
    const inserted = await service.from('collaboration_space_members').upsert(
      {
        workspace_id: input.workspace_id,
        space_id: id,
        user_id: input.user_id,
        role: input.role,
        status: 'active',
        added_by: user.id,
      },
      { onConflict: 'space_id,user_id' }
    );
    if (inserted.error) throw inserted.error;
  } else if (input.action === 'remove_member') {
    if (space.data.owner_id === input.user_id)
      throw new OrganizationApiError(
        409,
        'space_owner_required',
        'Asigna otro responsable antes de retirar al propietario.'
      );
    const removed = await service
      .from('collaboration_space_members')
      .delete()
      .eq('workspace_id', input.workspace_id)
      .eq('space_id', id)
      .eq('user_id', input.user_id);
    if (removed.error) throw removed.error;
  } else if (input.action === 'add_milestone') {
    const inserted = await service.from('collaboration_milestones').insert({
      workspace_id: input.workspace_id,
      space_id: id,
      title: input.title,
      description: input.description || null,
      due_at: input.due_at,
      owner_id: user.id,
      created_by: user.id,
    });
    if (inserted.error) throw inserted.error;
  } else if (input.action === 'complete_milestone') {
    const updated = await service
      .from('collaboration_milestones')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('workspace_id', input.workspace_id)
      .eq('space_id', id)
      .eq('id', input.milestone_id)
      .not('status', 'in', '(completed,cancelled)');
    if (updated.error) throw updated.error;
  } else if (input.action === 'add_resource') {
    const resourceDefinitions = {
      document: { table: 'documentos', label: 'nombre' },
      case_file: { table: 'case_files', label: 'title' },
      form: { table: 'form_templates', label: 'name' },
      template: { table: 'plantillas', label: 'nombre' },
    } as const;

    let canonicalName = input.display_name || null;
    if (input.resource_type === 'document_version') {
      const version = await service
        .from('document_versions')
        .select('id,version_number')
        .eq('workspace_id', input.workspace_id)
        .eq('id', input.resource_id)
        .maybeSingle();
      if (version.error) throw version.error;
      if (!version.data)
        throw new OrganizationApiError(404, 'version_not_found', 'La version no existe.');
      canonicalName ||= `Version ${version.data.version_number}`;
    } else {
      const definition = resourceDefinitions[input.resource_type];
      const canonical = await service
        .from(definition.table)
        .select(`id,${definition.label}`)
        .eq('workspace_id', input.workspace_id)
        .eq('id', input.resource_id)
        .maybeSingle();
      if (canonical.error) throw canonical.error;
      if (!canonical.data)
        throw new OrganizationApiError(
          404,
          'linked_resource_not_found',
          'El recurso no existe en esta organizacion.'
        );
      const canonicalRecord = canonical.data as Record<string, unknown>;
      canonicalName ||= String(canonicalRecord[definition.label] || 'Recurso');
    }

    const added = await service.from('collaboration_space_resources').upsert(
      {
        workspace_id: input.workspace_id,
        space_id: id,
        resource_type: input.resource_type,
        resource_id: input.resource_id,
        display_name: canonicalName,
        added_by: user.id,
      },
      { onConflict: 'space_id,resource_type,resource_id' }
    );
    if (added.error) throw added.error;
  } else if (input.action === 'remove_resource') {
    const removed = await service
      .from('collaboration_space_resources')
      .delete()
      .eq('workspace_id', input.workspace_id)
      .eq('space_id', id)
      .eq('id', input.space_resource_id);
    if (removed.error) throw removed.error;
  } else {
    if (input.action === 'close') {
      const [openTasks, openMilestones] = await Promise.all([
        service
          .from('tareas')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', input.workspace_id)
          .eq('collaboration_space_id', id)
          .not('estado', 'in', '(completada,cancelada,rechazada)'),
        service
          .from('collaboration_milestones')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', input.workspace_id)
          .eq('space_id', id)
          .not('status', 'in', '(completed,cancelled)'),
      ]);
      if (openTasks.error) throw openTasks.error;
      if (openMilestones.error) throw openMilestones.error;
      if ((openTasks.count || 0) + (openMilestones.count || 0) > 0)
        throw new OrganizationApiError(
          409,
          'space_has_open_work',
          'Completa o cancela las tareas e hitos abiertos antes de cerrar.'
        );
    }
    const updated = await service
      .from('collaboration_spaces')
      .update({
        status: input.action === 'close' ? 'closed' : 'archived',
        closed_at: input.action === 'close' ? new Date().toISOString() : space.data.closed_at,
        archived_at: input.action === 'archive' ? new Date().toISOString() : null,
        settings: { ...(space.data.settings || {}), closure_reason: input.reason },
      })
      .eq('id', id);
    if (updated.error) throw updated.error;
  }

  await recordCollaborationAudit(service, {
    workspaceId: input.workspace_id,
    actorUserId: user.id,
    eventType: `collaboration.space_${input.action}`,
    resourceType: 'collaboration_space',
    resourceId: id,
    summary: `Se ejecuto la accion ${input.action} sobre un espacio.`,
    payload: input,
  });
  return Response.json({ success: true });
}

async function updateRoom(request: Request, id: string, body: unknown) {
  const input = roomActionSchema.parse(body);
  const permission = ['add_guest', 'revoke_guest'].includes(input.action)
    ? 'rooms.manage_guests'
    : input.action === 'update_security'
      ? 'rooms.manage_security'
      : 'rooms.create';
  const { service, user, access } = await authorizeCollaborationRequest(
    request,
    input.workspace_id,
    permission,
    true
  );
  requireCollaborationEntitlement(access, 'collaboration_external_rooms', true, { proFeature: true });
  const room = await service
    .from('collaboration_rooms')
    .select('*')
    .eq('workspace_id', input.workspace_id)
    .eq('id', id)
    .maybeSingle();
  if (room.error) throw room.error;
  if (!room.data) throw new OrganizationApiError(404, 'room_not_found', 'La sala no existe.');
  if (['closed', 'revoked', 'archived'].includes(room.data.status))
    throw new OrganizationApiError(409, 'room_is_closed', 'La sala ya no admite cambios.');

  let credentials: { path: string; expires_at: string } | null = null;
  if (input.action === 'add_guest') {
    const token = randomBytes(32).toString('base64url');
    const expiresAt =
      room.data.expires_at || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const existing = await service
      .from('collaboration_room_guests')
      .select('id')
      .eq('room_id', id)
      .ilike('email', input.email)
      .maybeSingle();
    if (existing.error) throw existing.error;
    const values = {
      workspace_id: input.workspace_id,
      room_id: id,
      name: input.name,
      email: input.email.toLowerCase(),
      status: 'pending',
      token_hash: sha(token),
      token_expires_at: expiresAt,
      permissions: { view: true, download: input.allow_download, upload: false, comment: false },
      nda_accepted_at: null,
      revoked_at: null,
      invited_by: user.id,
    };
    const mutation = existing.data
      ? service.from('collaboration_room_guests').update(values).eq('id', existing.data.id)
      : service.from('collaboration_room_guests').insert(values);
    const saved = await mutation;
    if (saved.error) throw saved.error;
    credentials = { path: `/sala/${token}`, expires_at: expiresAt };
  } else if (input.action === 'revoke_guest') {
    const revokedAt = new Date().toISOString();
    const guest = await service
      .from('collaboration_room_guests')
      .update({ status: 'revoked', revoked_at: revokedAt })
      .eq('workspace_id', input.workspace_id)
      .eq('room_id', id)
      .eq('id', input.guest_id)
      .select('id')
      .maybeSingle();
    if (guest.error) throw guest.error;
    if (!guest.data)
      throw new OrganizationApiError(404, 'guest_not_found', 'El invitado no existe.');
    const sessions = await service
      .from('collaboration_external_sessions')
      .update({ revoked_at: revokedAt })
      .eq('guest_id', input.guest_id)
      .is('revoked_at', null);
    if (sessions.error) throw sessions.error;
  } else if (input.action === 'add_resource') {
    let canonicalName = input.display_name || null;
    if (input.resource_type === 'document') {
      const document = await service
        .from('documentos')
        .select('id,nombre')
        .eq('workspace_id', input.workspace_id)
        .eq('id', input.resource_id)
        .maybeSingle();
      if (document.error) throw document.error;
      if (!document.data)
        throw new OrganizationApiError(404, 'document_not_found', 'El documento no existe.');
      canonicalName ||= document.data.nombre;
    } else {
      const version = await service
        .from('document_versions')
        .select('id,version_number')
        .eq('workspace_id', input.workspace_id)
        .eq('id', input.resource_id)
        .maybeSingle();
      if (version.error) throw version.error;
      if (!version.data)
        throw new OrganizationApiError(404, 'version_not_found', 'La version no existe.');
      canonicalName ||= `Version ${version.data.version_number}`;
    }
    const added = await service.from('collaboration_room_resources').upsert(
      {
        workspace_id: input.workspace_id,
        room_id: id,
        resource_type: input.resource_type,
        resource_id: input.resource_id,
        display_name: canonicalName,
        permissions: { view: true, download: input.allow_download },
        created_by: user.id,
      },
      { onConflict: 'room_id,resource_type,resource_id' }
    );
    if (added.error) throw added.error;
  } else if (input.action === 'remove_resource') {
    const removed = await service
      .from('collaboration_room_resources')
      .delete()
      .eq('workspace_id', input.workspace_id)
      .eq('room_id', id)
      .eq('id', input.room_resource_id);
    if (removed.error) throw removed.error;
  } else if (input.action === 'update_security') {
    const updated = await service
      .from('collaboration_rooms')
      .update({
        downloads_allowed: input.downloads_allowed,
        watermark_enabled: input.watermark_enabled,
        terms_required: input.terms_required,
        session_minutes: input.session_minutes,
      })
      .eq('id', id);
    if (updated.error) throw updated.error;
  } else {
    const now = new Date().toISOString();
    const updated = await service
      .from('collaboration_rooms')
      .update({
        status: input.action === 'close' ? 'closed' : 'revoked',
        closed_at: input.action === 'close' ? now : null,
        settings: { ...(room.data.settings || {}), closure_reason: input.reason },
      })
      .eq('id', id);
    if (updated.error) throw updated.error;
    const revoked = await service
      .from('collaboration_external_sessions')
      .update({ revoked_at: now })
      .eq('room_id', id)
      .is('revoked_at', null);
    if (revoked.error) throw revoked.error;
  }

  await recordCollaborationAudit(service, {
    workspaceId: input.workspace_id,
    actorUserId: user.id,
    eventType: `collaboration.room_${input.action}`,
    resourceType: 'collaboration_room',
    resourceId: id,
    summary: `Se ejecuto la accion ${input.action} sobre una sala externa.`,
    payload: { ...input, one_time_token: undefined },
  });
  return Response.json({ success: true, one_time_credentials: credentials });
}

async function updateAutomation(request: Request, id: string, body: unknown) {
  const input = automationActionSchema.parse(body);
  const { service, user, access } = await authorizeCollaborationRequest(
    request,
    input.workspace_id,
    'automations.manage',
    true
  );
  requireCollaborationEntitlement(access, 'collaboration_automations', true, { proFeature: true });
  const automation = await service
    .from('collaboration_automations')
    .select('*')
    .eq('workspace_id', input.workspace_id)
    .eq('id', id)
    .maybeSingle();
  if (automation.error) throw automation.error;
  if (!automation.data)
    throw new OrganizationApiError(404, 'automation_not_found', 'La automatizacion no existe.');

  let run: Record<string, unknown> | null = null;
  if (input.action === 'publish') {
    const version = await service
      .from('collaboration_automation_versions')
      .select('id,trigger_definition,conditions,actions')
      .eq('automation_id', id)
      .eq('version', automation.data.current_version)
      .maybeSingle();
    if (version.error) throw version.error;
    if (!version.data || !Array.isArray(version.data.actions) || !version.data.actions.length)
      throw new OrganizationApiError(
        409,
        'automation_definition_invalid',
        'La automatizacion necesita un disparador y al menos una accion.'
      );
    const now = new Date().toISOString();
    const published = await service
      .from('collaboration_automations')
      .update({ status: 'active', published_by: user.id, published_at: now })
      .eq('id', id);
    if (published.error) throw published.error;
    const versionPublished = await service
      .from('collaboration_automation_versions')
      .update({ published_at: now })
      .eq('id', version.data.id);
    if (versionPublished.error) throw versionPublished.error;
  } else if (input.action === 'pause' || input.action === 'disable') {
    const updated = await service
      .from('collaboration_automations')
      .update({ status: input.action === 'pause' ? 'paused' : 'disabled' })
      .eq('id', id);
    if (updated.error) throw updated.error;
  } else if (input.action === 'test_run') {
    const version = await service
      .from('collaboration_automation_versions')
      .select('*')
      .eq('automation_id', id)
      .eq('version', automation.data.current_version)
      .maybeSingle();
    if (version.error) throw version.error;
    if (!version.data)
      throw new OrganizationApiError(409, 'automation_version_missing', 'No existe una version.');
    const eventId = `manual-test:${randomBytes(12).toString('hex')}`;
    const now = new Date().toISOString();
    const created = await service
      .from('collaboration_automation_runs')
      .insert({
        workspace_id: input.workspace_id,
        automation_id: id,
        automation_version_id: version.data.id,
        event_id: eventId,
        idempotency_key: `${id}:${version.data.id}:${eventId}`,
        status: 'succeeded',
        attempt_count: 1,
        input_snapshot: { source: 'manual_test', actor_user_id: user.id },
        result_summary: {
          dry_run: true,
          trigger_validated: Boolean(version.data.trigger_definition),
          actions_validated: Array.isArray(version.data.actions) ? version.data.actions.length : 0,
          external_actions_executed: false,
        },
        started_at: now,
        completed_at: now,
      })
      .select('*')
      .single();
    if (created.error) throw created.error;
    run = created.data;
  } else if (input.action === 'run_now') {
    if (automation.data.status !== 'active')
      throw new OrganizationApiError(
        409,
        'automation_not_active',
        'Publica la automatizacion antes de ejecutarla.'
      );
    const version = await service
      .from('collaboration_automation_versions')
      .select('*')
      .eq('automation_id', id)
      .eq('version', automation.data.current_version)
      .not('published_at', 'is', null)
      .maybeSingle();
    if (version.error) throw version.error;
    if (!version.data)
      throw new OrganizationApiError(
        409,
        'automation_version_not_published',
        'La version activa no esta publicada.'
      );
    const eventId = `manual:${randomBytes(12).toString('hex')}`;
    const now = new Date().toISOString();
    const created = await service
      .from('collaboration_automation_runs')
      .insert({
        workspace_id: input.workspace_id,
        automation_id: id,
        automation_version_id: version.data.id,
        event_id: eventId,
        idempotency_key: `${id}:${version.data.id}:${eventId}`,
        status: 'running',
        attempt_count: 1,
        input_snapshot: { source: 'manual', actor_user_id: user.id },
        started_at: now,
      })
      .select('*')
      .single();
    if (created.error) throw created.error;
    try {
      const actions = await executeConfiguredAutomation(
        service,
        automation.data,
        version.data,
        user.id,
        null,
        0,
        created.data.id
      );
      const completed = await service
        .from('collaboration_automation_runs')
        .update({
          status: 'succeeded',
          result_summary: { actions },
          completed_at: new Date().toISOString(),
        })
        .eq('id', created.data.id)
        .select('*')
        .single();
      if (completed.error) throw completed.error;
      await service
        .from('collaboration_automations')
        .update({ consecutive_failures: 0 })
        .eq('id', id);
      run = completed.data;
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message.slice(0, 1000) : 'execution_failed';
      await service
        .from('collaboration_automation_runs')
        .update({
          status: 'failed',
          error_code: 'action_failed',
          error_detail: detail,
          completed_at: new Date().toISOString(),
        })
        .eq('id', created.data.id);
      await service
        .from('collaboration_automations')
        .update({ consecutive_failures: Number(automation.data.consecutive_failures || 0) + 1 })
        .eq('id', id);
      throw new OrganizationApiError(
        502,
        'automation_execution_failed',
        'La automatizacion fallo y quedo disponible para reintento.'
      );
    }
  } else if (input.action === 'retry_run') {
    const existing = await service
      .from('collaboration_automation_runs')
      .select('id,status,attempt_count,automation_version_id')
      .eq('workspace_id', input.workspace_id)
      .eq('automation_id', id)
      .eq('id', input.run_id)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data)
      throw new OrganizationApiError(404, 'run_not_found', 'La ejecucion no existe.');
    if (!['failed', 'dead_lettered', 'retrying'].includes(existing.data.status))
      throw new OrganizationApiError(
        409,
        'run_not_retryable',
        'Solo se pueden reintentar ejecuciones fallidas.'
      );
    const version = await service
      .from('collaboration_automation_versions')
      .select('*')
      .eq('id', existing.data.automation_version_id)
      .maybeSingle();
    if (version.error) throw version.error;
    if (!version.data)
      throw new OrganizationApiError(409, 'automation_version_missing', 'No existe la version.');
    const startedAt = new Date().toISOString();
    const running = await service
      .from('collaboration_automation_runs')
      .update({
        status: 'running',
        scheduled_at: startedAt,
        started_at: startedAt,
        completed_at: null,
        attempt_count: Number(existing.data.attempt_count || 0) + 1,
        error_code: null,
        error_detail: null,
      })
      .eq('id', existing.data.id)
      .select('*')
      .single();
    if (running.error) throw running.error;
    try {
      const actions = await executeConfiguredAutomation(
        service,
        automation.data,
        version.data,
        user.id,
        running.data.correlation_id || null,
        Number(running.data.depth || 0),
        existing.data.id
      );
      const completed = await service
        .from('collaboration_automation_runs')
        .update({
          status: 'succeeded',
          result_summary: { actions, retried: true },
          completed_at: new Date().toISOString(),
        })
        .eq('id', existing.data.id)
        .select('*')
        .single();
      if (completed.error) throw completed.error;
      run = completed.data;
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message.slice(0, 1000) : 'execution_failed';
      await service
        .from('collaboration_automation_runs')
        .update({
          status: 'failed',
          error_code: 'action_failed',
          error_detail: detail,
          completed_at: new Date().toISOString(),
        })
        .eq('id', existing.data.id);
      throw new OrganizationApiError(
        502,
        'automation_execution_failed',
        'El reintento fallo y se conservo la evidencia de la ejecucion.'
      );
    }
  }

  await recordCollaborationAudit(service, {
    workspaceId: input.workspace_id,
    actorUserId: user.id,
    eventType: `collaboration.automation_${input.action}`,
    resourceType: 'collaboration_automation',
    resourceId: id,
    summary: `Se ejecuto ${input.action} sobre una automatizacion.`,
    payload: input,
  });
  return Response.json({ success: true, data: run });
}

async function updateNegotiation(request: Request, id: string, body: unknown) {
  const input = negotiationActionSchema.parse(body);
  const { service, user, access } = await authorizeCollaborationRequest(
    request,
    input.workspace_id,
    'reviews.create',
    true
  );
  requireCollaborationEntitlement(access, 'collaboration_advanced_workflows', true, { proFeature: true });
  if (input.status === 'agreed' && !input.resolution)
    throw new OrganizationApiError(
      400,
      'resolution_required',
      'Documenta la resolucion antes de marcar el acuerdo.'
    );
  const updated = await service
    .from('collaboration_negotiation_items')
    .update({
      status: input.status,
      counterparty_proposal: input.counterparty_proposal,
      internal_position: input.internal_position,
      resolution: input.resolution,
    })
    .eq('workspace_id', input.workspace_id)
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (updated.error) throw updated.error;
  if (!updated.data)
    throw new OrganizationApiError(404, 'negotiation_not_found', 'El asunto no existe.');
  await recordCollaborationAudit(service, {
    workspaceId: input.workspace_id,
    actorUserId: user.id,
    eventType: 'collaboration.negotiation_updated',
    resourceType: 'collaboration_negotiation',
    resourceId: id,
    summary: `El asunto de negociacion cambio a ${input.status}.`,
    payload: input,
  });
  return Response.json({ success: true });
}

async function updateCommittee(request: Request, id: string, body: unknown) {
  const input = committeeActionSchema.parse(body);
  const { service, user, access } = await authorizeCollaborationRequest(
    request,
    input.workspace_id,
    'collaboration_spaces.create',
    true
  );
  requireCollaborationEntitlement(access, 'collaboration_advanced_workflows', true, { proFeature: true });
  const committee = await service
    .from('collaboration_committees')
    .select('*')
    .eq('workspace_id', input.workspace_id)
    .eq('id', id)
    .maybeSingle();
  if (committee.error) throw committee.error;
  if (!committee.data)
    throw new OrganizationApiError(404, 'committee_not_found', 'El comite no existe.');
  if (input.action === 'vote') {
    if (committee.data.status !== 'in_session')
      throw new OrganizationApiError(
        409,
        'committee_not_in_session',
        'El comite no esta en sesion.'
      );
    const agenda: Array<Record<string, unknown>> = Array.isArray(committee.data.agenda)
      ? (committee.data.agenda as Array<Record<string, unknown>>)
      : [];
    if (
      !agenda.some((item) => item && typeof item === 'object' && item.key === input.agenda_item_key)
    )
      throw new OrganizationApiError(404, 'agenda_item_not_found', 'El punto de agenda no existe.');
    const vote = await service.from('collaboration_committee_votes').upsert(
      {
        workspace_id: input.workspace_id,
        committee_id: id,
        agenda_item_key: input.agenda_item_key,
        voter_id: user.id,
        decision: input.decision,
        comment: input.comment || null,
        cast_at: new Date().toISOString(),
      },
      { onConflict: 'committee_id,agenda_item_key,voter_id' }
    );
    if (vote.error) throw vote.error;
  } else {
    const nextByAction = {
      convene: { from: ['draft'], to: 'convened' },
      start: { from: ['convened'], to: 'in_session' },
      close: { from: ['in_session'], to: 'closed' },
      cancel: { from: ['draft', 'convened', 'in_session'], to: 'cancelled' },
    } as const;
    const transition = nextByAction[input.action];
    if (!transition.from.includes(committee.data.status as never))
      throw new OrganizationApiError(
        409,
        'invalid_committee_transition',
        'Cambio de estado no permitido.'
      );
    if (input.action === 'close') {
      const minimum = Number(committee.data.quorum_rule?.value || 1);
      const votes = await service
        .from('collaboration_committee_votes')
        .select('voter_id')
        .eq('workspace_id', input.workspace_id)
        .eq('committee_id', id);
      if (votes.error) throw votes.error;
      if (new Set((votes.data || []).map((vote) => vote.voter_id)).size < minimum)
        throw new OrganizationApiError(
          409,
          'committee_quorum_missing',
          'No se cumple el quorum configurado.'
        );
    }
    const updated = await service
      .from('collaboration_committees')
      .update({
        status: transition.to,
        closed_at: input.action === 'close' ? new Date().toISOString() : null,
      })
      .eq('id', id);
    if (updated.error) throw updated.error;
  }
  await recordCollaborationAudit(service, {
    workspaceId: input.workspace_id,
    actorUserId: user.id,
    eventType: `collaboration.committee_${input.action}`,
    resourceType: 'collaboration_committee',
    resourceId: id,
    summary: `Se ejecuto ${input.action} en el comite.`,
    payload: input,
  });
  return Response.json({ success: true });
}

async function updateClosing(request: Request, id: string, body: unknown) {
  const input = closingActionSchema.parse(body);
  const { service, user, access } = await authorizeCollaborationRequest(
    request,
    input.workspace_id,
    'collaboration_spaces.create',
    true
  );
  requireCollaborationEntitlement(access, 'collaboration_advanced_workflows', true, { proFeature: true });
  const closing = await service
    .from('collaboration_closing_rooms')
    .select('*')
    .eq('workspace_id', input.workspace_id)
    .eq('id', id)
    .maybeSingle();
  if (closing.error) throw closing.error;
  if (!closing.data)
    throw new OrganizationApiError(404, 'closing_not_found', 'El cierre no existe.');
  const conditions: Array<Record<string, unknown>> = Array.isArray(closing.data.conditions)
    ? (closing.data.conditions as Array<Record<string, unknown>>)
    : [];
  const now = new Date().toISOString();
  if (input.action === 'toggle_condition') {
    if (closing.data.status !== 'preparing')
      throw new OrganizationApiError(409, 'closing_locked', 'Las condiciones ya estan bloqueadas.');
    const next = conditions.map((condition) =>
      condition && typeof condition === 'object' && condition.key === input.condition_key
        ? {
            ...condition,
            status: input.completed ? 'completed' : 'pending',
            completed_at: input.completed ? now : null,
          }
        : condition
    );
    if (JSON.stringify(next) === JSON.stringify(conditions))
      throw new OrganizationApiError(404, 'condition_not_found', 'La condicion no existe.');
    const updated = await service
      .from('collaboration_closing_rooms')
      .update({ conditions: next })
      .eq('id', id);
    if (updated.error) throw updated.error;
  } else {
    const allCompleted =
      conditions.length > 0 &&
      conditions.every(
        (condition) =>
          condition && typeof condition === 'object' && condition.status === 'completed'
      );
    const transitions = {
      mark_ready: { from: 'preparing', to: 'ready' },
      start_signing: { from: 'ready', to: 'signing' },
      release: { from: 'signing', to: 'released' },
      seal: { from: 'released', to: 'sealed' },
      cancel: { from: closing.data.status, to: 'cancelled' },
    } as const;
    const transition = transitions[input.action];
    if (input.action !== 'cancel' && closing.data.status !== transition.from)
      throw new OrganizationApiError(
        409,
        'invalid_closing_transition',
        'Cambio de estado no permitido.'
      );
    if (input.action === 'mark_ready' && !allCompleted)
      throw new OrganizationApiError(409, 'conditions_pending', 'Completa todas las condiciones.');
    const manifestHash =
      input.action === 'seal'
        ? sha(JSON.stringify({ id, workspace_id: input.workspace_id, conditions, sealed_at: now }))
        : closing.data.manifest_hash;
    const updated = await service
      .from('collaboration_closing_rooms')
      .update({
        status: transition.to,
        release_authorized_by:
          input.action === 'release' ? user.id : closing.data.release_authorized_by,
        released_at: input.action === 'release' ? now : closing.data.released_at,
        sealed_at: input.action === 'seal' ? now : closing.data.sealed_at,
        manifest_hash: manifestHash,
      })
      .eq('id', id);
    if (updated.error) throw updated.error;
  }
  await recordCollaborationAudit(service, {
    workspaceId: input.workspace_id,
    actorUserId: user.id,
    eventType: `collaboration.closing_${input.action}`,
    resourceType: 'collaboration_closing',
    resourceId: id,
    summary: `Se ejecuto ${input.action} en la sala de cierre.`,
    payload: input,
  });
  return Response.json({ success: true });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ resource: string; id: string }> }
) {
  try {
    const { resource, id } = await context.params;
    const body = await request.json();
    if (resource === 'spaces') return await updateSpace(request, id, body);
    if (resource === 'rooms') return await updateRoom(request, id, body);
    if (resource === 'automations') return await updateAutomation(request, id, body);
    if (resource === 'negotiations') return await updateNegotiation(request, id, body);
    if (resource === 'committees') return await updateCommittee(request, id, body);
    if (resource === 'closings') return await updateClosing(request, id, body);
    if (resource !== 'requests')
      throw new OrganizationApiError(
        405,
        'resource_read_only',
        'Este recurso no admite cambios aqui.'
      );
    const input = requestActionSchema.parse(body);
    const permission = input.action === 'cancel' ? 'requests.create' : 'requests.review_items';
    const { service, user } = await authorizeCollaborationRequest(
      request,
      input.workspace_id,
      permission,
      true
    );
    const requestResult = await service
      .from('collaboration_document_requests')
      .select('id,status')
      .eq('workspace_id', input.workspace_id)
      .eq('id', id)
      .maybeSingle();
    if (requestResult.error) throw requestResult.error;
    if (!requestResult.data)
      throw new OrganizationApiError(404, 'request_not_found', 'La solicitud no existe.');

    let canonicalDocumentId: string | null = null;
    if (input.action === 'cancel') {
      if (!input.reason)
        throw new OrganizationApiError(400, 'reason_required', 'Indica el motivo de cancelacion.');
      const update = await service
        .from('collaboration_document_requests')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancellation_reason: input.reason,
        })
        .eq('id', id)
        .not('status', 'in', '(completed,cancelled)');
      if (update.error) throw update.error;
    } else {
      if (!input.item_id)
        throw new OrganizationApiError(400, 'item_required', 'Selecciona un requisito.');
      if (
        ['reject_item', 'request_replacement', 'waive_item'].includes(input.action) &&
        !input.reason
      )
        throw new OrganizationApiError(400, 'reason_required', 'Indica un motivo accionable.');
      const item = await service
        .from('collaboration_request_items')
        .select('id,status,required')
        .eq('workspace_id', input.workspace_id)
        .eq('request_id', id)
        .eq('id', input.item_id)
        .maybeSingle();
      if (item.error) throw item.error;
      if (!item.data)
        throw new OrganizationApiError(404, 'item_not_found', 'El requisito no existe.');

      if (input.action === 'approve_item') {
        const latestFile = await service
          .from('collaboration_request_files')
          .select('id,malware_scan_status,canonical_document_id')
          .eq('request_item_id', input.item_id)
          .order('version', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (latestFile.error) throw latestFile.error;
        if (!latestFile.data)
          throw new OrganizationApiError(
            409,
            'file_required',
            'El requisito no tiene un archivo recibido.'
          );
        if (latestFile.data.malware_scan_status !== 'clean')
          throw new OrganizationApiError(
            409,
            'file_security_scan_pending',
            'El archivo aun no supera el analisis de seguridad y no puede aprobarse.'
          );
        if (latestFile.data.canonical_document_id) {
          canonicalDocumentId = latestFile.data.canonical_document_id;
        } else {
          const incorporation = await service.rpc('incorporate_collaboration_request_file', {
            p_file_id: latestFile.data.id,
            p_workspace_id: input.workspace_id,
            p_actor_id: user.id,
          });
          if (incorporation.error) throw incorporation.error;
          canonicalDocumentId = incorporation.data;
        }
      }

      const now = new Date().toISOString();
      const valuesByAction: Record<string, Record<string, unknown>> = {
        approve_item: {
          status: 'approved',
          validation_status: 'valid',
          rejection_reason: null,
          reviewed_by: user.id,
          reviewed_at: now,
        },
        reject_item: {
          status: 'rejected',
          validation_status: 'invalid',
          rejection_reason: input.reason,
          reviewed_by: user.id,
          reviewed_at: now,
        },
        request_replacement: {
          status: 'replacement_requested',
          validation_status: 'invalid',
          rejection_reason: input.reason,
          reviewed_by: user.id,
          reviewed_at: now,
        },
        waive_item: {
          status: 'waived',
          waiver_reason: input.reason,
          waived_by: user.id,
          reviewed_by: user.id,
          reviewed_at: now,
        },
      };
      const update = await service
        .from('collaboration_request_items')
        .update(valuesByAction[input.action])
        .eq('id', input.item_id);
      if (update.error) throw update.error;

      const requiredItems = await service
        .from('collaboration_request_items')
        .select('required,status')
        .eq('request_id', id);
      if (requiredItems.error) throw requiredItems.error;
      const complete = (requiredItems.data || []).every(
        (candidate) => !candidate.required || ['approved', 'waived'].includes(candidate.status)
      );
      const needsCorrection = ['reject_item', 'request_replacement'].includes(input.action);
      const requestUpdate = await service
        .from('collaboration_document_requests')
        .update({
          status: complete ? 'completed' : needsCorrection ? 'in_progress' : 'in_review',
          completed_at: complete ? now : null,
        })
        .eq('id', id);
      if (requestUpdate.error) throw requestUpdate.error;
    }

    await recordCollaborationAudit(service, {
      workspaceId: input.workspace_id,
      actorUserId: user.id,
      eventType: `collaboration.request_${input.action}`,
      resourceType: 'document_request',
      resourceId: id,
      summary: `Se ejecuto la accion ${input.action} sobre una solicitud documental.`,
      payload: {
        item_id: input.item_id || null,
        reason: input.reason || null,
        canonical_document_id: canonicalDocumentId,
      },
    });
    return Response.json({ success: true, canonical_document_id: canonicalDocumentId });
  } catch (error) {
    return organizationApiFailure(error);
  }
}
