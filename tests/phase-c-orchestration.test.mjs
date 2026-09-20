import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const migration = await read(
  '../supabase/migrations/20260914003615_phase_c_orchestration_agreement_actions.sql'
);
const processor = await read('../src/lib/orchestration/processor.ts');
const automation = await read('../src/lib/collaboration/automation.ts');
const conditions = await read('../src/lib/collaboration/automation-conditions.ts');
const contracts = await read('../src/lib/collaboration/automation-contracts.ts');
const webhook = await read('../src/lib/organization/webhook-dispatcher.ts');
const notifications = await read('../src/lib/notifications/delivery-worker.ts');
const sendRoute = await read('../src/app/api/documentos/enviar/route.ts');
const advanceRoute = await read('../src/app/api/documentos/advance-participation/route.ts');
const stepSend = await read('../src/app/crear-documento/components/StepEnviar.tsx');
const cronRoute = await read('../src/app/api/colabora/automations/process/route.ts');
const vercel = await read('../vercel.json');

test('Phase C adds only additive orchestration tables and optional columns', () => {
  for (const table of [
    'document_send_schedules',
    'document_routing_schedules',
    'collaboration_automation_action_runs',
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
  }
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE/i);
  assert.doesNotMatch(migration, /UPDATE public\.documentos\s+SET participantes/i);
});

test('scheduled workers use atomic claims and skip locked', () => {
  for (const fn of ['claim_due_document_send_schedule', 'claim_due_document_routing_schedule']) {
    assert.match(migration, new RegExp(`FUNCTION public\\.${fn}`));
  }
  assert.match(migration, /FOR UPDATE SKIP LOCKED/g);
  assert.match(migration, /phase_c_worker_not_authorized/);
  assert.match(processor, /\.eq\('status', 'processing'\)/);
});

test('scheduled sending validates timezone and preserves send now', () => {
  assert.match(sendRoute, /zonedDateTimeToUtcIso/);
  assert.match(sendRoute, /scheduledDelivery \?/);
  assert.match(sendRoute, /eventType: 'document\.sent'/);
  assert.match(stepSend, /Enviar ahora/);
  assert.match(stepSend, /Programar envío/);
  assert.match(stepSend, /scheduleTimezone/);
});

test('schedule mutation is restricted to scheduled state', async () => {
  const route = await read('../src/app/api/documentos/[documentId]/schedule/route.ts');
  assert.match(route, /ownerOrAdminOnly: true/);
  assert.match(route, /\.eq\('status', 'scheduled'\)/g);
  assert.match(route, /envio_reprogramado/);
  assert.match(route, /envio_programado_cancelado/);
  assert.match(route, /document\.schedule\.manage/);
  assert.match(route, /ServerRateLimitUnavailableError/);
  assert.match(sendRoute, /document\.schedule\.create/);
});

test('delayed routing remains after atomic participant completion', () => {
  assert.match(advanceRoute, /document_routing_schedules/);
  assert.match(advanceRoute, /participant_ref_id/);
  assert.match(advanceRoute, /buildRoutingSchedule/);
  assert.match(migration, /Temporal gates layered after[\s\S]*AUTH-003 commit/);
  assert.match(migration, /waiting_event/);
});

test('condition engine is controlled and cannot execute arbitrary code or SQL', () => {
  for (const operator of [
    'equals',
    'not_equals',
    'exists',
    'not_exists',
    'contains',
    'in',
    'greater_than',
    'less_than',
  ])
    assert.match(conditions, new RegExp(`'${operator}'`));
  assert.match(conditions, /fieldPattern/);
  assert.doesNotMatch(conditions, /eval\(|new Function|\.rpc\(/);
  assert.match(automation, /evaluateAutomationConditions/);
  assert.match(automation, /conditions_not_met/);
});

test('agreement actions map only to existing services', () => {
  for (const type of [
    'notify',
    'activity',
    'webhook',
    'document_metadata',
    'create_task',
    'request_nom151',
  ])
    assert.match(contracts, new RegExp(`literal\\('${type}'\\)`));
  assert.match(automation, /emitDomainEvent/);
  assert.match(automation, /queueWebhookDeliveriesForEvent/);
  assert.match(automation, /issueNom151ForVerifiedPadesBt/);
  assert.match(automation, /\.from\('tareas'\)/);
});

test('each automation action has a stable execution identity', () => {
  assert.match(migration, /UNIQUE \(automation_run_id, action_index\)/);
  assert.match(automation, /event:\$\{event\?\.id/);
  assert.match(automation, /collaboration_automation_action_runs/);
  assert.match(automation, /status === 'succeeded'/);
  assert.match(migration, /tareas_automation_main_action_unique/);
});

test('webhooks are signed, bounded and replay-addressable', () => {
  assert.match(webhook, /createHmac\('sha256'/);
  assert.match(webhook, /x-docubox-delivery-id/);
  assert.match(webhook, /x-docubox-timestamp/);
  assert.match(webhook, /x-docubox-signature/);
  assert.match(webhook, /WEBHOOK_TIMEOUT_MS/);
  assert.match(webhook, /isPrivateNetworkAddress/);
});

test('notification delivery supports controlled fallback without parallel fallback sends', () => {
  assert.match(notifications, /queueFallback/);
  assert.match(notifications, /ambiguousSms/);
  assert.match(notifications, /SmsConfigurationError/);
  assert.match(migration, /delivery_policy IN \('single','fallback','multidelivery'\)/);
});

test('one existing cron drives all Phase C processors', () => {
  assert.match(cronRoute, /processPhaseCOrchestration/);
  assert.equal((vercel.match(/\/api\/colabora\/automations\/process/g) || []).length, 1);
  assert.match(vercel, /\*\/5 \* \* \* \*/);
});

test('terminal document transitions cancel pending schedules', () => {
  assert.match(migration, /document\.cancelled/);
  assert.match(migration, /document\.expired/);
  assert.match(migration, /UPDATE public\.document_send_schedules[\s\S]*status = 'cancelled'/);
  assert.match(migration, /UPDATE public\.document_routing_schedules[\s\S]*status = 'cancelled'/);
});

test('unsupported channels are not presented as operational participant choices', async () => {
  const participants = await read('../src/app/crear-documento/components/StepParticipantes.tsx');
  assert.match(participants, /filter\(\(opt\) => opt\.id !== 'whatsapp'\)/);
  assert.doesNotMatch(contracts, /z\.enum\(\['in_app', 'email', 'sms', 'whatsapp'/);
});

test('Phase C remains disabled by default in database feature flags', () => {
  for (const flag of ['delayed_routing', 'multichannel_orchestration', 'webhook_dispatcher']) {
    assert.match(migration, new RegExp(`\\('${flag}'[\\s\\S]{0,220}false, 0`));
  }
});

test('Phase C does not modify signing or cryptographic pipelines', () => {
  for (const source of [migration, processor, automation]) {
    assert.doesNotMatch(
      source,
      /UPDATE public\.(?:signature|evidence|nom151|pades)|sealed_pdf\s*=|ByteRange|KMS/i
    );
  }
});
