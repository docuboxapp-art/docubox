BEGIN;

SELECT plan(25);

SELECT has_table('public', 'document_send_schedules', 'scheduled sends exist');
SELECT has_table('public', 'document_routing_schedules', 'delayed routing exists');
SELECT has_table('public', 'collaboration_automation_action_runs', 'per-action ledger exists');
SELECT has_column('public', 'collaboration_automation_runs', 'canonical_event_id', 'automation run binds canonical event');
SELECT has_column('public', 'collaboration_automation_runs', 'condition_result', 'condition evaluation is recorded');
SELECT has_column('public', 'organization_webhook_deliveries', 'idempotency_key', 'webhook delivery has idempotency');
SELECT has_column('public', 'organization_webhook_deliveries', 'canonical_event_id', 'webhook binds canonical event');
SELECT has_column('public', 'notification_deliveries', 'fallback_channel', 'notification fallback is modeled');
SELECT has_column('public', 'notification_deliveries', 'delivery_policy', 'delivery policy is explicit');
SELECT has_function('public', 'claim_due_document_send_schedule', ARRAY['text','timestamp with time zone'], 'send claim exists');
SELECT has_function('public', 'claim_due_document_routing_schedule', ARRAY['text','timestamp with time zone'], 'routing claim exists');
SELECT has_function('public', 'claim_due_organization_webhook_delivery', ARRAY['timestamp with time zone'], 'webhook claim exists');
SELECT has_function('public', 'claim_due_notification_delivery', ARRAY['timestamp with time zone'], 'notification claim exists');
SELECT has_trigger('public', 'document_operational_events', 'enqueue_phase_c_document_event', 'canonical events feed orchestration');
SELECT has_trigger('public', 'documentos', 'emit_document_terminal_event', 'terminal status emits canonical events');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.document_send_schedules'::regclass), 'send schedules have RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.document_routing_schedules'::regclass), 'routing schedules have RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.collaboration_automation_action_runs'::regclass), 'action runs have RLS');
SELECT ok(NOT has_table_privilege('anon', 'public.document_send_schedules', 'SELECT'), 'anon cannot read send schedules');
SELECT ok(NOT has_table_privilege('authenticated', 'public.document_send_schedules', 'INSERT'), 'browser cannot insert send schedules');
SELECT ok(NOT has_table_privilege('authenticated', 'public.document_routing_schedules', 'UPDATE'), 'browser cannot update routing schedules');
SELECT ok(NOT has_table_privilege('authenticated', 'public.collaboration_automation_action_runs', 'INSERT'), 'browser cannot forge action runs');
SELECT ok(has_table_privilege('service_role', 'public.document_send_schedules', 'UPDATE'), 'service role processes sends');
SELECT ok(NOT has_function_privilege('authenticated', 'public.claim_due_document_send_schedule(text,timestamp with time zone)', 'EXECUTE'), 'browser cannot claim sends');
SELECT ok(NOT has_function_privilege('authenticated', 'public.claim_due_document_routing_schedule(text,timestamp with time zone)', 'EXECUTE'), 'browser cannot claim routing');

SELECT * FROM finish();
ROLLBACK;
