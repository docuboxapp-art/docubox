BEGIN;

SELECT plan(25);

SELECT has_column('public', 'bulk_signature_campaigns', 'source_version_id', 'campaign pins source version');
SELECT has_column('public', 'bulk_signature_campaigns', 'source_snapshot', 'campaign stores source snapshot');
SELECT has_column('public', 'bulk_campaign_items', 'materialization_document_id', 'row reserves stable document id');
SELECT has_column('public', 'bulk_campaign_items', 'source_document_id', 'row pins source document');
SELECT has_column('public', 'bulk_campaign_items', 'source_sha256', 'row pins source hash');
SELECT has_column('public', 'bulk_campaign_items', 'claimed_by', 'row stores worker claim');
SELECT has_column('public', 'bulk_campaign_items', 'claim_expires_at', 'row claim expires');
SELECT has_column('public', 'bulk_campaign_items', 'next_retry_at', 'row has bounded retry schedule');
SELECT has_column('public', 'bulk_campaign_items', 'delivery_attempt_count', 'delivery attempts are independent');
SELECT has_column('public', 'bulk_campaign_events', 'event_key', 'campaign events have idempotency key');

SELECT has_function('public', 'claim_bulk_campaign_item_materialization', ARRAY['text','timestamp with time zone'], 'materialization claim exists');
SELECT has_function('public', 'commit_bulk_campaign_item_materialization', ARRAY['uuid','text','uuid'], 'materialization commit exists');
SELECT has_function('public', 'claim_bulk_campaign_item_delivery', ARRAY['text','timestamp with time zone'], 'delivery claim exists');
SELECT has_function('public', 'complete_bulk_campaign_item_delivery', ARRAY['uuid','text','text'], 'delivery commit exists');
SELECT has_function('public', 'fail_bulk_campaign_item_attempt', ARRAY['uuid','text','text','text','text','boolean'], 'bounded failure transition exists');

SELECT ok(NOT has_function_privilege('authenticated', 'public.claim_bulk_campaign_item_materialization(text,timestamp with time zone)', 'EXECUTE'), 'browser cannot claim materialization');
SELECT ok(has_function_privilege('service_role', 'public.claim_bulk_campaign_item_materialization(text,timestamp with time zone)', 'EXECUTE'), 'worker can claim materialization');
SELECT ok(NOT has_function_privilege('authenticated', 'public.claim_bulk_campaign_item_delivery(text,timestamp with time zone)', 'EXECUTE'), 'browser cannot claim delivery');
SELECT ok(has_function_privilege('service_role', 'public.claim_bulk_campaign_item_delivery(text,timestamp with time zone)', 'EXECUTE'), 'worker can claim delivery');

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.bulk_signature_campaigns'::regclass), 'campaign RLS enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.bulk_campaign_items'::regclass), 'item RLS enabled');
SELECT ok(NOT has_table_privilege('authenticated', 'public.bulk_signature_campaigns', 'INSERT'), 'browser cannot create campaigns directly');
SELECT ok(NOT has_table_privilege('authenticated', 'public.bulk_campaign_items', 'UPDATE'), 'browser cannot mutate rows directly');
SELECT ok(has_table_privilege('authenticated', 'public.bulk_signature_campaigns', 'SELECT'), 'authorized browser reads use RLS');
SELECT is((SELECT global_enabled FROM public.platform_feature_flags WHERE flag_key = 'bulk_signature_runtime'), FALSE, 'production flag remains disabled by default');

SELECT * FROM finish();
ROLLBACK;
