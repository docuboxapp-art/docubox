import { z } from 'zod';
import {
  authorizeOrganizationRequest,
  OrganizationApiError,
  organizationApiFailure,
} from '@/lib/organization/server';
import { isPhaseEFeatureEnabled, PHASE_E_FEATURES } from '@/lib/phase-e/feature-flags';
import {
  compileWorkflowBuilderDefinition,
  legacyDefinitionToBuilderDraft,
  workflowBuilderDraftSchema,
} from '@/lib/organization/workflow-definition';
import { isSmsConfigured } from '@/lib/smsNotifications';

export const runtime = 'nodejs';

const mutationSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    workspace_id: z.string().uuid(),
    draft: workflowBuilderDraftSchema,
  }),
  z.object({
    action: z.literal('update'),
    workspace_id: z.string().uuid(),
    workflow_id: z.string().uuid(),
    draft: workflowBuilderDraftSchema,
  }),
  z.object({
    action: z.literal('publish'),
    workspace_id: z.string().uuid(),
    workflow_id: z.string().uuid(),
  }),
  z.object({
    action: z.literal('new_version'),
    workspace_id: z.string().uuid(),
    workflow_id: z.string().uuid(),
  }),
  z.object({
    action: z.literal('archive'),
    workspace_id: z.string().uuid(),
    workflow_id: z.string().uuid(),
  }),
  z.object({
    action: z.literal('validate'),
    workspace_id: z.string().uuid(),
    draft: workflowBuilderDraftSchema,
  }),
]);

const workflowColumns =
  'id,workspace_id,name,description,version,definition,status,document_type,applicable_areas,source_version_id,published_at,published_by,created_by,created_at,updated_at';

const supportedActions = [
  'notify',
  'activity',
  'webhook',
  'document_metadata',
  'create_task',
  'request_nom151',
] as const;

async function validateRuntimeReferences(
  service: Awaited<ReturnType<typeof authorizeOrganizationRequest>>['service'],
  workspaceId: string,
  draft: z.infer<typeof workflowBuilderDraftSchema>
) {
  const endpointIds = new Set<string>();
  let requiresSms = false;
  let requiresLucia = false;
  for (const node of draft.nodes) {
    if (node.type === 'notification') {
      requiresSms ||= Array.isArray(node.config.channels) && node.config.channels.includes('sms');
    }
    if (node.type === 'webhook' && typeof node.config.webhook_configuration_id === 'string') {
      endpointIds.add(node.config.webhook_configuration_id);
    }
    if (node.type === 'action' && node.config.action && typeof node.config.action === 'object') {
      const action = node.config.action as Record<string, unknown>;
      requiresSms ||=
        action.type === 'notify' &&
        Array.isArray(action.channels) &&
        action.channels.includes('sms');
      requiresLucia ||= action.type === 'trigger_lucia_contractual';
      if (action.type === 'webhook' && typeof action.endpoint_id === 'string') {
        endpointIds.add(action.endpoint_id);
      }
    }
  }
  if (requiresSms && !isSmsConfigured()) {
    throw new OrganizationApiError(
      400,
      'workflow_sms_not_configured',
      'SMS no está configurado en este entorno.'
    );
  }
  if (
    requiresLucia &&
    !(await isPhaseEFeatureEnabled(service, PHASE_E_FEATURES.contractualIntelligence))
  ) {
    throw new OrganizationApiError(
      400,
      'workflow_lucia_not_available',
      'LucIA Contractual no está habilitada en este entorno.'
    );
  }
  if (!endpointIds.size) return;
  const endpoints = await service
    .from('organization_webhook_endpoints')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .in('id', [...endpointIds]);
  if (endpoints.error) throw endpoints.error;
  if (new Set((endpoints.data || []).map((endpoint) => endpoint.id)).size !== endpointIds.size) {
    throw new OrganizationApiError(
      400,
      'workflow_webhook_reference_invalid',
      'El flujo contiene un webhook inactivo o ajeno a la organización.'
    );
  }
}

async function assertBuilderEnabled(
  service: Awaited<ReturnType<typeof authorizeOrganizationRequest>>['service']
) {
  if (!(await isPhaseEFeatureEnabled(service, PHASE_E_FEATURES.workflowBuilder))) {
    throw new OrganizationApiError(
      403,
      'workflow_builder_disabled',
      'Workflow Builder no está habilitado en este entorno.'
    );
  }
}

async function audit(
  service: Awaited<ReturnType<typeof authorizeOrganizationRequest>>['service'],
  input: {
    workspaceId: string;
    userId: string;
    eventType: string;
    workflowId: string;
    summary: string;
    payload?: Record<string, unknown>;
  }
) {
  const result = await service.from('organization_audit_events').insert({
    workspace_id: input.workspaceId,
    actor_user_id: input.userId,
    event_type: input.eventType,
    resource_type: 'organization_approval_workflow',
    resource_id: input.workflowId,
    summary: input.summary,
    payload: input.payload || {},
    module: 'workflows',
  });
  if (result.error) throw result.error;
}

export async function GET(request: Request) {
  try {
    const workspaceId = new URL(request.url).searchParams.get('workspace_id') || '';
    const { service } = await authorizeOrganizationRequest(request, workspaceId, 'workflows.read');
    const [enabled, luciaEnabled, rows, webhooks] = await Promise.all([
      isPhaseEFeatureEnabled(service, PHASE_E_FEATURES.workflowBuilder),
      isPhaseEFeatureEnabled(service, PHASE_E_FEATURES.contractualIntelligence),
      service
        .from('organization_approval_workflows')
        .select(workflowColumns)
        .eq('workspace_id', workspaceId)
        .order('updated_at', { ascending: false }),
      service
        .from('organization_webhook_endpoints')
        .select('id,name,status')
        .eq('workspace_id', workspaceId)
        .eq('status', 'active')
        .order('name'),
    ]);
    if (rows.error) throw rows.error;
    if (webhooks.error) throw webhooks.error;
    return Response.json({
      success: true,
      builder_enabled: enabled,
      workflows: rows.data || [],
      builder_capabilities: {
        notification_channels: ['in_app', 'email', ...(isSmsConfigured() ? ['sms'] : [])],
        action_types: [...supportedActions, ...(luciaEnabled ? ['trigger_lucia_contractual'] : [])],
        webhooks: webhooks.data || [],
      },
    });
  } catch (cause) {
    return organizationApiFailure(cause);
  }
}

export async function POST(request: Request) {
  try {
    const input = mutationSchema.parse(await request.json());
    const { user, userClient, service } = await authorizeOrganizationRequest(
      request,
      input.workspace_id,
      'workflows.manage'
    );
    await assertBuilderEnabled(service);

    if (input.action === 'validate') {
      const definition = compileWorkflowBuilderDefinition(input.draft);
      await validateRuntimeReferences(service, input.workspace_id, input.draft);
      return Response.json({ success: true, definition });
    }

    if (input.action === 'create' || input.action === 'update') {
      const definition = compileWorkflowBuilderDefinition(input.draft);
      await validateRuntimeReferences(service, input.workspace_id, input.draft);
      const values = {
        workspace_id: input.workspace_id,
        name: input.draft.name,
        description: input.draft.description || null,
        document_type: input.draft.document_type || null,
        applicable_areas: input.draft.applicable_areas,
        definition,
      };
      const query =
        input.action === 'create'
          ? userClient
              .from('organization_approval_workflows')
              .insert({ ...values, created_by: user.id, status: 'draft', version: 1 })
          : userClient
              .from('organization_approval_workflows')
              .update({ ...values, updated_at: new Date().toISOString() })
              .eq('workspace_id', input.workspace_id)
              .eq('id', input.workflow_id)
              .eq('status', 'draft');
      const saved = await query.select(workflowColumns).maybeSingle();
      if (saved.error) throw saved.error;
      if (!saved.data) {
        throw new OrganizationApiError(
          409,
          'workflow_draft_required',
          'Solo una versión en borrador puede editarse.'
        );
      }
      await audit(service, {
        workspaceId: input.workspace_id,
        userId: user.id,
        eventType:
          input.action === 'create' ? 'workflow.definition.created' : 'workflow.draft.changed',
        workflowId: saved.data.id,
        summary:
          input.action === 'create'
            ? `Flujo creado: ${input.draft.name}`
            : `Borrador actualizado: ${input.draft.name}`,
        payload: { schema_version: 3, version: saved.data.version },
      });
      return Response.json({ success: true, workflow: saved.data });
    }

    const existing = await service
      .from('organization_approval_workflows')
      .select(workflowColumns)
      .eq('workspace_id', input.workspace_id)
      .eq('id', input.workflow_id)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data) {
      throw new OrganizationApiError(404, 'workflow_not_found', 'No se encontró el flujo.');
    }

    if (input.action === 'publish') {
      const draft = legacyDefinitionToBuilderDraft(existing.data);
      if (!draft) {
        throw new OrganizationApiError(
          409,
          'workflow_definition_invalid',
          'El flujo no puede convertirse al contrato del runtime canónico.'
        );
      }
      const definition = compileWorkflowBuilderDefinition(draft);
      await validateRuntimeReferences(service, input.workspace_id, draft);
      const normalized = await userClient
        .from('organization_approval_workflows')
        .update({ definition, updated_at: new Date().toISOString() })
        .eq('workspace_id', input.workspace_id)
        .eq('id', input.workflow_id)
        .eq('status', 'draft')
        .select('id')
        .maybeSingle();
      if (normalized.error) throw normalized.error;
      if (!normalized.data) {
        throw new OrganizationApiError(
          409,
          'workflow_draft_required',
          'Solo un borrador puede publicarse.'
        );
      }
      const published = await userClient.rpc('publish_organization_workflow', {
        ws_id: input.workspace_id,
        target_workflow_id: input.workflow_id,
      });
      if (published.error) throw published.error;
      return Response.json({ success: true, workflow_id: input.workflow_id, status: 'published' });
    }

    if (input.action === 'new_version') {
      const versioned = await userClient.rpc('create_organization_workflow_version', {
        ws_id: input.workspace_id,
        source_workflow_id: input.workflow_id,
      });
      if (versioned.error) throw versioned.error;
      return Response.json({ success: true, workflow_id: versioned.data, status: 'draft' });
    }

    const archived = await userClient
      .from('organization_approval_workflows')
      .update({ status: 'archived', updated_at: new Date().toISOString() })
      .eq('workspace_id', input.workspace_id)
      .eq('id', input.workflow_id)
      .neq('status', 'archived')
      .select('id,version')
      .maybeSingle();
    if (archived.error) throw archived.error;
    if (!archived.data) {
      throw new OrganizationApiError(
        409,
        'workflow_already_archived',
        'El flujo ya está archivado.'
      );
    }
    await audit(service, {
      workspaceId: input.workspace_id,
      userId: user.id,
      eventType: 'workflow.archived',
      workflowId: input.workflow_id,
      summary: `Flujo archivado: ${String(existing.data.name)}`,
      payload: { version: archived.data.version },
    });
    return Response.json({ success: true, workflow_id: input.workflow_id, status: 'archived' });
  } catch (cause) {
    if (cause instanceof z.ZodError) {
      return organizationApiFailure(
        new OrganizationApiError(400, 'invalid_request', 'La definición del flujo no es válida.')
      );
    }
    if (cause instanceof Error && !(cause instanceof OrganizationApiError)) {
      const validationMessage = cause.message;
      if (
        validationMessage.includes('requiere') ||
        validationMessage.includes('permitid') ||
        validationMessage.includes('válid')
      ) {
        return organizationApiFailure(
          new OrganizationApiError(400, 'workflow_validation_failed', validationMessage)
        );
      }
    }
    return organizationApiFailure(cause);
  }
}
