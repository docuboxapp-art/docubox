import { z } from 'zod';
import { automationConditionSchema } from './automation-conditions.ts';

export const CANONICAL_AUTOMATION_EVENTS = [
  'document.created',
  'document.sent',
  'document.completed',
  'document.cancelled',
  'document.expired',
  'participant.completion_committed',
  'workflow.participation_advanced',
  'signing_group.completed',
  'participant.delegation.completed',
  'group_member.delegation_created',
  'group_member.delegation_revoked',
  'group_member.delegation_completed',
  'witness.completed',
  'document.custody_transferred',
  'custody.transfer_requested',
  'custody.transfer_accepted',
  'custody.transfer_rejected',
  'custody.transfer_cancelled',
  'custody.transfer_expired',
  'custody.transferred',
  'document.retention_applied',
] as const;

export const automationTriggerSchema = z.object({
  event_type: z.enum(CANONICAL_AUTOMATION_EVENTS),
});

const channelSchema = z.enum(['in_app', 'email', 'sms']);

export const configuredAutomationActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('notify'),
    target: z.enum(['owner', 'participant']).default('owner'),
    title: z.string().trim().min(1).max(180).optional(),
    message: z.string().trim().min(1).max(1000).optional(),
    channels: z.array(channelSchema).min(1).max(3).default(['in_app']),
    delivery_policy: z.enum(['single', 'fallback', 'multidelivery']).default('single'),
  }),
  z.object({
    type: z.literal('activity'),
    summary: z.string().trim().min(1).max(500),
  }),
  z.object({
    type: z.literal('webhook'),
    endpoint_id: z.string().uuid().optional(),
  }),
  z.object({
    type: z.literal('document_metadata'),
    name: z.string().trim().min(1).max(120),
    value: z.union([z.string().max(2000), z.number().finite(), z.boolean()]),
  }),
  z.object({
    type: z.literal('create_task'),
    title: z.string().trim().min(3).max(180),
    description: z.string().trim().max(1000).optional(),
    assigned_to: z.enum(['owner', 'actor']).default('owner'),
    due_in_days: z.number().int().min(0).max(365).optional(),
  }),
  z.object({
    type: z.literal('request_nom151'),
  }),
  z.object({
    type: z.literal('trigger_lucia_contractual'),
  }),
]);

export const automationDefinitionSchema = z.object({
  trigger_definition: automationTriggerSchema,
  conditions: z.array(automationConditionSchema).max(50).default([]),
  actions: z.array(configuredAutomationActionSchema).min(1).max(20),
});

export type ConfiguredAutomationAction = z.infer<typeof configuredAutomationActionSchema>;
