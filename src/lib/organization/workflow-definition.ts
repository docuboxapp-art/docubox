import { z } from 'zod';
import {
  automationConditionSchema,
  AUTOMATION_CONDITION_OPERATORS,
} from '../collaboration/automation-conditions.ts';
import { configuredAutomationActionSchema } from '../collaboration/automation-contracts.ts';

export const WORKFLOW_BUILDER_NODE_TYPES = [
  'start',
  'approval',
  'signature',
  'delay',
  'notification',
  'action',
  'webhook',
  'condition',
  'end',
] as const;

export const WORKFLOW_NOTIFICATION_CHANNELS = ['in_app', 'email', 'sms'] as const;
export const WORKFLOW_NOTIFICATION_RECIPIENTS = ['owner', 'participant'] as const;
export const WORKFLOW_CONDITION_FIELDS = [
  'event.type',
  'document.status',
  'document.type_id',
  'document.classification',
  'document.template_id',
  'participant.reference_id',
  'organization.id',
  'workspace.id',
  'package.status',
  'package.resource_count',
] as const;

export { AUTOMATION_CONDITION_OPERATORS };

export type WorkflowBuilderNodeType = (typeof WORKFLOW_BUILDER_NODE_TYPES)[number];

const positionSchema = z.object({
  x: z.number().finite().min(0).max(5000),
  y: z.number().finite().min(0).max(5000),
});

const baseNodeSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(WORKFLOW_BUILDER_NODE_TYPES),
  label: z.string().trim().min(1).max(120),
  position: positionSchema,
  config: z.record(z.string(), z.unknown()).default({}),
});

export const workflowBuilderEdgeSchema = z.object({
  id: z.string().uuid(),
  source: z.string().uuid(),
  target: z.string().uuid(),
  branch: z.enum(['true', 'false']).optional(),
});

export const workflowBuilderDraftSchema = z.object({
  name: z.string().trim().min(3).max(160),
  description: z.string().trim().max(1000).nullable().optional(),
  document_type: z.string().trim().max(120).nullable().optional(),
  applicable_areas: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
  nodes: z.array(baseNodeSchema).min(2).max(60),
  edges: z.array(workflowBuilderEdgeSchema).max(100),
});

export type WorkflowBuilderNode = z.infer<typeof baseNodeSchema>;
export type WorkflowBuilderEdge = z.infer<typeof workflowBuilderEdgeSchema>;
export type WorkflowBuilderDraft = z.infer<typeof workflowBuilderDraftSchema>;

export type WorkflowValidationIssue = {
  code: string;
  message: string;
  nodeId?: string;
};

export type CompiledWorkflowDefinition = {
  schema_version: 3;
  mode: 'directed_acyclic';
  builder: {
    layout_version: 2;
    nodes: WorkflowBuilderNode[];
    edges: WorkflowBuilderEdge[];
  };
  steps: Array<{
    id: string;
    order: number;
    type:
      | 'start'
      | 'approval'
      | 'signature'
      | 'wait'
      | 'notification'
      | 'action'
      | 'webhook'
      | 'condition'
      | 'approved'
      | 'rejected'
      | 'cancelled';
    label: string;
    assignee_type?: string;
    assignee_id?: string;
    sla_hours?: number;
    configuration: Record<string, unknown>;
  }>;
};

function deterministicUuid(namespace: number, index: number) {
  return `${namespace.toString(16).padStart(8, '0')}-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

function configString(node: WorkflowBuilderNode, key: string) {
  const value = node.config[key];
  return typeof value === 'string' ? value.trim() : '';
}

function validateNodeConfiguration(node: WorkflowBuilderNode): WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = [];
  if (node.type === 'delay') {
    const amount = Number(node.config.duration_value);
    const unit = configString(node, 'duration_unit');
    if (!Number.isInteger(amount) || amount < 1 || amount > 365) {
      issues.push({
        code: 'delay_duration_invalid',
        message: 'La espera requiere una duración entre 1 y 365.',
        nodeId: node.id,
      });
    }
    if (!['hours', 'days'].includes(unit)) {
      issues.push({
        code: 'delay_unit_invalid',
        message: 'Selecciona horas o días para la espera.',
        nodeId: node.id,
      });
    }
  }
  if (node.type === 'signature') {
    const event = configString(node, 'completion_event') || 'document.completed';
    if (!['participant.completion_committed', 'document.completed'].includes(event)) {
      issues.push({
        code: 'signature_event_invalid',
        message: 'La etapa de firma usa un evento de finalización no permitido.',
        nodeId: node.id,
      });
    }
  }
  if (node.type === 'end') {
    const outcome = configString(node, 'outcome') || 'approved';
    if (!['approved', 'rejected', 'cancelled'].includes(outcome)) {
      issues.push({
        code: 'end_outcome_invalid',
        message: 'El resultado final no es válido.',
        nodeId: node.id,
      });
    }
  }
  if (node.type === 'notification') {
    const channels = z
      .array(z.enum(WORKFLOW_NOTIFICATION_CHANNELS))
      .min(1)
      .max(3)
      .safeParse(node.config.channels);
    const recipient = z.enum(WORKFLOW_NOTIFICATION_RECIPIENTS).safeParse(node.config.recipient);
    const title = z.string().trim().min(1).max(180).safeParse(node.config.title);
    const message = z.string().trim().min(1).max(1000).safeParse(node.config.message);
    const deliveryPolicy = z
      .enum(['single', 'fallback', 'multidelivery'])
      .safeParse(node.config.delivery_policy);
    if (!channels.success)
      issues.push({
        code: 'notification_channel_invalid',
        message: 'Selecciona al menos un canal de notificación disponible.',
        nodeId: node.id,
      });
    if (!recipient.success)
      issues.push({
        code: 'notification_recipient_invalid',
        message: 'Selecciona un destinatario permitido para la notificación.',
        nodeId: node.id,
      });
    if (!title.success || !message.success)
      issues.push({
        code: 'notification_content_invalid',
        message: 'La notificación requiere título y mensaje.',
        nodeId: node.id,
      });
    if (!deliveryPolicy.success)
      issues.push({
        code: 'notification_policy_invalid',
        message: 'La política de entrega no es válida.',
        nodeId: node.id,
      });
  }
  if (node.type === 'action') {
    const parsed = configuredAutomationActionSchema.safeParse(node.config.action);
    if (!parsed.success) {
      issues.push({
        code: 'action_configuration_invalid',
        message: 'Completa la configuración de la acción seleccionada.',
        nodeId: node.id,
      });
    }
  }
  if (node.type === 'webhook') {
    if (!z.string().uuid().safeParse(node.config.webhook_configuration_id).success) {
      issues.push({
        code: 'webhook_reference_invalid',
        message: 'Selecciona un webhook activo de la organización.',
        nodeId: node.id,
      });
    }
  }
  if (node.type === 'condition') {
    const parsed = automationConditionSchema.safeParse(node.config.condition);
    if (
      !parsed.success ||
      !WORKFLOW_CONDITION_FIELDS.some((field) => field === parsed.data?.field)
    ) {
      issues.push({
        code: 'condition_configuration_invalid',
        message: 'Completa la condición con un campo y operador permitidos.',
        nodeId: node.id,
      });
    }
  }
  return issues;
}

export function validateWorkflowBuilderDraft(input: WorkflowBuilderDraft): {
  valid: boolean;
  issues: WorkflowValidationIssue[];
  orderedNodeIds: string[];
} {
  const issues: WorkflowValidationIssue[] = [];
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  const nodeIds = input.nodes.map((node) => node.id);
  if (new Set(nodeIds).size !== nodeIds.length) {
    issues.push({ code: 'duplicate_node', message: 'El flujo contiene nodos duplicados.' });
  }
  const edgeIds = input.edges.map((edge) => edge.id);
  if (new Set(edgeIds).size !== edgeIds.length) {
    issues.push({ code: 'duplicate_edge', message: 'El flujo contiene conexiones duplicadas.' });
  }

  const starts = input.nodes.filter((node) => node.type === 'start');
  const ends = input.nodes.filter((node) => node.type === 'end');
  if (starts.length !== 1) {
    issues.push({
      code: 'start_count_invalid',
      message: 'El flujo requiere exactamente un Inicio.',
    });
  }
  if (ends.length < 1) {
    issues.push({ code: 'end_missing', message: 'El flujo requiere al menos un Fin.' });
  }

  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const node of input.nodes) {
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
    issues.push(...validateNodeConfiguration(node));
  }
  const connectionKeys = new Set<string>();
  for (const edge of input.edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) {
      issues.push({
        code: 'edge_reference_invalid',
        message: 'Una conexión apunta a un nodo inexistente.',
      });
      continue;
    }
    if (edge.source === edge.target) {
      issues.push({
        code: 'self_cycle',
        message: 'Un nodo no puede conectarse consigo mismo.',
        nodeId: edge.source,
      });
      continue;
    }
    const key = `${edge.source}:${edge.target}`;
    if (connectionKeys.has(key)) {
      issues.push({
        code: 'duplicate_connection',
        message: 'La misma conexión aparece más de una vez.',
      });
      continue;
    }
    connectionKeys.add(key);
    incoming.get(edge.target)?.push(edge.source);
    outgoing.get(edge.source)?.push(edge.target);
  }

  for (const node of input.nodes) {
    const inCount = incoming.get(node.id)?.length || 0;
    const outCount = outgoing.get(node.id)?.length || 0;
    if (node.type === 'start' && inCount !== 0) {
      issues.push({
        code: 'start_has_input',
        message: 'Inicio no puede tener una entrada.',
        nodeId: node.id,
      });
    } else if (node.type !== 'start' && inCount !== 1) {
      issues.push({
        code: 'node_input_invalid',
        message: `“${node.label}” requiere una entrada.`,
        nodeId: node.id,
      });
    }
    if (node.type === 'end' && outCount !== 0) {
      issues.push({
        code: 'end_has_output',
        message: 'Fin no puede tener una salida.',
        nodeId: node.id,
      });
    } else if (node.type === 'condition' && outCount !== 2) {
      issues.push({
        code: 'condition_output_invalid',
        message: `“${node.label}” requiere salidas Verdadero y Falso.`,
        nodeId: node.id,
      });
    } else if (node.type !== 'end' && node.type !== 'condition' && outCount !== 1) {
      issues.push({
        code: 'node_output_invalid',
        message: `“${node.label}” requiere una salida.`,
        nodeId: node.id,
      });
    }
  }

  for (const node of input.nodes.filter((candidate) => candidate.type === 'condition')) {
    const branches = input.edges
      .filter((edge) => edge.source === node.id)
      .map((edge) => edge.branch);
    if (
      branches.length !== 2 ||
      branches.filter((branch) => branch === 'true').length !== 1 ||
      branches.filter((branch) => branch === 'false').length !== 1
    ) {
      issues.push({
        code: 'condition_branches_invalid',
        message: `“${node.label}” debe tener una salida Verdadero y una Falso.`,
        nodeId: node.id,
      });
    }
  }

  // Runtime order is deterministic storage order; transitions come from immutable step configuration.
  const orderedNodeIds: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  let cycleDetected = false;
  const visit = (nodeId: string) => {
    if (visiting.has(nodeId)) {
      cycleDetected = true;
      return;
    }
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    visited.add(nodeId);
    orderedNodeIds.push(nodeId);
    const edges = input.edges
      .filter((edge) => edge.source === nodeId)
      .sort((left, right) => (left.branch === 'true' ? -1 : right.branch === 'true' ? 1 : 0));
    edges.forEach((edge) => visit(edge.target));
    visiting.delete(nodeId);
  };
  if (starts[0]) visit(starts[0].id);
  if (cycleDetected)
    issues.push({ code: 'cycle_detected', message: 'Los ciclos no están permitidos.' });
  if (visited.size !== input.nodes.length) {
    issues.push({
      code: 'disconnected_node',
      message: 'Todos los nodos deben pertenecer a una sola ruta conectada.',
    });
  }

  return { valid: issues.length === 0, issues, orderedNodeIds };
}

function runtimeStep(
  node: WorkflowBuilderNode,
  order: number,
  edges: WorkflowBuilderEdge[]
): CompiledWorkflowDefinition['steps'][number] {
  const assigneeType = configString(node, 'assignee_type');
  const assigneeId = configString(node, 'assignee_id');
  const outgoing = edges.filter((edge) => edge.source === node.id);
  const nextStepId = outgoing[0]?.target;
  const configuration = {
    ...node.config,
    builder_node_type: node.type,
    ...(node.type === 'condition'
      ? {
          true_step_id: outgoing.find((edge) => edge.branch === 'true')?.target,
          false_step_id: outgoing.find((edge) => edge.branch === 'false')?.target,
        }
      : nextStepId
        ? { next_step_id: nextStepId }
        : {}),
  };
  if (node.type === 'delay') {
    const amount = Number(node.config.duration_value);
    const hours = configString(node, 'duration_unit') === 'days' ? amount * 24 : amount;
    return { id: node.id, order, type: 'wait', label: node.label, sla_hours: hours, configuration };
  }
  if (node.type === 'end') {
    const outcome = (configString(node, 'outcome') || 'approved') as
      'approved' | 'rejected' | 'cancelled';
    return { id: node.id, order, type: outcome, label: node.label, configuration };
  }
  return {
    id: node.id,
    order,
    type: node.type,
    label: node.label,
    ...(assigneeType ? { assignee_type: assigneeType } : {}),
    ...(assigneeId ? { assignee_id: assigneeId } : {}),
    configuration,
  };
}

export function compileWorkflowBuilderDefinition(
  input: WorkflowBuilderDraft
): CompiledWorkflowDefinition {
  const parsed = workflowBuilderDraftSchema.parse(input);
  const validation = validateWorkflowBuilderDraft(parsed);
  if (!validation.valid) {
    throw new Error(validation.issues.map((issue) => issue.message).join(' '));
  }
  const nodeById = new Map(parsed.nodes.map((node) => [node.id, node]));
  return {
    schema_version: 3,
    mode: 'directed_acyclic',
    builder: { layout_version: 2, nodes: parsed.nodes, edges: parsed.edges },
    steps: validation.orderedNodeIds.map((id, index) =>
      runtimeStep(nodeById.get(id)!, index + 1, parsed.edges)
    ),
  };
}

export function legacyDefinitionToBuilderDraft(
  row: Record<string, unknown>
): WorkflowBuilderDraft | null {
  const definition = row.definition as Record<string, unknown> | null;
  const builder = definition?.builder as Record<string, unknown> | undefined;
  const fromBuilder = workflowBuilderDraftSchema.safeParse({
    name: row.name,
    description: row.description ?? null,
    document_type: row.document_type ?? null,
    applicable_areas: row.applicable_areas ?? [],
    nodes: builder?.nodes,
    edges: builder?.edges,
  });
  if (fromBuilder.success) return fromBuilder.data;

  const rawSteps = Array.isArray(definition?.steps) ? definition.steps : [];
  if (rawSteps.length < 2) return null;
  const nodes: WorkflowBuilderNode[] = rawSteps.map((raw, index) => {
    const step = raw as Record<string, unknown>;
    const rawType = String(step.type || 'approval');
    const type: WorkflowBuilderNodeType =
      rawType === 'start'
        ? 'start'
        : ['approved', 'rejected', 'cancelled'].includes(rawType)
          ? 'end'
          : rawType === 'signature'
            ? 'signature'
            : rawType === 'wait'
              ? 'delay'
              : ['notification', 'action', 'webhook', 'condition'].includes(rawType)
                ? (rawType as WorkflowBuilderNodeType)
                : 'approval';
    return {
      id:
        typeof step.id === 'string' && z.string().uuid().safeParse(step.id).success
          ? step.id
          : deterministicUuid(4, index),
      type,
      label: String(step.label || `Etapa ${index + 1}`),
      position: { x: 80, y: 48 + index * 112 },
      config:
        type === 'end'
          ? {
              outcome: ['approved', 'rejected', 'cancelled'].includes(rawType)
                ? rawType
                : 'approved',
            }
          : type === 'delay'
            ? { duration_value: Math.max(1, Number(step.sla_hours || 24)), duration_unit: 'hours' }
            : ['notification', 'action', 'webhook', 'condition'].includes(type)
              ? (step.configuration as Record<string, unknown>) || {}
              : {
                  ...(step.assignee_type ? { assignee_type: step.assignee_type } : {}),
                  ...(step.assignee_id ? { assignee_id: step.assignee_id } : {}),
                  ...(type === 'signature' ? { completion_event: 'document.completed' } : {}),
                },
    };
  });
  const rawBuilderEdges = Array.isArray(builder?.edges) ? builder.edges : null;
  const parsedEdges = z.array(workflowBuilderEdgeSchema).safeParse(rawBuilderEdges);
  const edges = parsedEdges.success
    ? parsedEdges.data
    : nodes.slice(0, -1).map((node, index) => ({
        id: deterministicUuid(5, index),
        source: node.id,
        target: nodes[index + 1].id,
      }));
  const result = workflowBuilderDraftSchema.safeParse({
    name: row.name,
    description: row.description ?? null,
    document_type: row.document_type ?? null,
    applicable_areas: row.applicable_areas ?? [],
    nodes,
    edges,
  });
  return result.success ? result.data : null;
}
