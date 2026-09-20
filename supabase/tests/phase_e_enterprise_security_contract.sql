BEGIN;

SELECT plan(30);

SELECT has_column('public', 'ai_document_processing_jobs', 'run_key', 'LucIA jobs have a stable run key');
SELECT has_column('public', 'ai_document_processing_jobs', 'configuration_hash', 'LucIA jobs pin configuration');
SELECT has_column('public', 'ai_document_extracted_fields', 'analysis_run_id', 'facts reference their analysis run');
SELECT has_column('public', 'ai_document_obligations', 'analysis_run_id', 'obligations reference their analysis run');
SELECT has_table('public', 'ai_document_fact_reviews', 'human fact review history exists');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ai_document_fact_reviews'::regclass), 'fact reviews have RLS');
SELECT ok((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.ai_document_fact_reviews'::regclass), 'fact review RLS is forced');
SELECT ok(NOT has_table_privilege('anon', 'public.ai_document_fact_reviews', 'SELECT'), 'anon cannot read reviews');
SELECT ok(NOT has_table_privilege('authenticated', 'public.ai_document_fact_reviews', 'INSERT'), 'browser cannot forge reviews');

SELECT has_column('public', 'bulk_signature_campaigns', 'source_document_id', 'bulk source document is explicit');
SELECT has_column('public', 'bulk_campaign_items', 'source_row_hash', 'bulk row identity is stable');
SELECT has_column('public', 'bulk_campaign_items', 'participant_email', 'bulk recipient is server persisted');
SELECT has_function('public', 'create_bulk_campaign_with_recipients', ARRAY['uuid','uuid','text','jsonb','jsonb'], 'bulk import RPC exists');
SELECT ok(NOT has_function_privilege('authenticated', 'public.create_bulk_campaign_with_recipients(uuid,uuid,text,jsonb,jsonb)', 'EXECUTE'), 'browser cannot invoke bulk RPC');
SELECT ok(has_function_privilege('service_role', 'public.create_bulk_campaign_with_recipients(uuid,uuid,text,jsonb,jsonb)', 'EXECUTE'), 'server can invoke bulk RPC');

SELECT has_table('public', 'organization_sso_test_sessions', 'single-use SSO test state exists');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.organization_sso_test_sessions'::regclass), 'SSO test state has RLS');
SELECT ok((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.organization_sso_test_sessions'::regclass), 'SSO test RLS is forced');
SELECT ok(NOT has_table_privilege('authenticated', 'public.organization_sso_test_sessions', 'SELECT'), 'browser cannot read SSO test state');
SELECT ok(NOT has_table_privilege('authenticated', 'public.organization_sso_test_sessions', 'INSERT'), 'browser cannot forge SSO test state');

SELECT has_table('public', 'public_api_idempotency_records', 'public API idempotency ledger exists');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.public_api_idempotency_records'::regclass), 'API idempotency ledger has RLS');
SELECT ok((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.public_api_idempotency_records'::regclass), 'API idempotency RLS is forced');
SELECT ok(NOT has_table_privilege('authenticated', 'public.public_api_idempotency_records', 'SELECT'), 'browser cannot inspect API responses');
SELECT ok(NOT has_table_privilege('authenticated', 'public.public_api_idempotency_records', 'INSERT'), 'browser cannot forge idempotency state');

SELECT is((SELECT global_enabled FROM public.platform_feature_flags WHERE flag_key = 'lucia_contractual'), FALSE, 'LucIA contractual is disabled by default');
SELECT is((SELECT global_enabled FROM public.platform_feature_flags WHERE flag_key = 'bulk_signature_runtime'), FALSE, 'bulk execution is disabled by default');
SELECT is((SELECT global_enabled FROM public.platform_feature_flags WHERE flag_key = 'organization_sso'), FALSE, 'organization SSO is disabled by default');
SELECT is((SELECT global_enabled FROM public.platform_feature_flags WHERE flag_key = 'public_api_v1'), FALSE, 'public API v1 is disabled by default');
SELECT is((SELECT global_enabled FROM public.platform_feature_flags WHERE flag_key = 'workflow_builder'), FALSE, 'Workflow Builder is disabled by default');

SELECT * FROM finish();
ROLLBACK;
