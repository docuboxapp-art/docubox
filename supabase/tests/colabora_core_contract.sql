BEGIN;

SELECT plan(20);

SELECT has_table('public', 'organization_addon_subscriptions', 'addon subscriptions exist');
SELECT has_table('public', 'organization_entitlements', 'organization entitlements exist');
SELECT has_table('public', 'collaboration_settings', 'collaboration settings exist');
SELECT has_table('public', 'collaboration_usage_events', 'usage events exist');
SELECT has_table('public', 'collaboration_spaces', 'collaboration spaces exist');
SELECT has_table('public', 'collaboration_document_requests', 'document requests exist');
SELECT has_table('public', 'collaboration_request_files', 'request files exist');
SELECT has_table('public', 'collaboration_rooms', 'external rooms exist');
SELECT has_table('public', 'collaboration_automations', 'automations exist');
SELECT has_table('public', 'collaboration_automation_runs', 'automation runs exist');
SELECT has_function('public', 'get_my_collaboration_access', ARRAY['uuid'], 'access is calculated in database');
SELECT has_function('public', 'activate_collaboration_trial', ARRAY['uuid', 'text', 'uuid'], 'trial activation is backend controlled and idempotent');
SELECT has_trigger('public', 'collaboration_usage_events', 'collaboration_usage_limit_before_insert', 'event limits are enforced');
SELECT has_column('public', 'collaboration_request_files', 'canonical_document_id', 'approved files link to canonical documents');
SELECT has_column('public', 'organization_entitlements', 'access_level', 'entitlements expose their semantic level');
SELECT has_function('public', 'get_collaboration_usage_snapshot', ARRAY['uuid'], 'canonical usage snapshot exists');
SELECT has_function(
  'public',
  'record_collaboration_usage',
  ARRAY['uuid','text','text','numeric','text','text','uuid','jsonb'],
  'billable usage is recorded through an idempotent backend function'
);
SELECT results_eq(
  $$SELECT entitlement_keys @> ARRAY['collaboration_core','collaboration_advanced_reviews','collaboration_analytics']::TEXT[]
    AND NOT entitlement_keys && ARRAY['collaboration_external_rooms','collaboration_advanced_workflows','collaboration_automations']::TEXT[]
    FROM public.addon_products WHERE product_key = 'docubox_colabora'$$,
  ARRAY[TRUE],
  'standard bundle excludes Pro capabilities'
);
SELECT results_eq(
  $$SELECT entitlement_keys @> ARRAY['collaboration_core','collaboration_external_rooms','collaboration_data_rooms','collaboration_advanced_workflows','collaboration_automations','collaboration_ai_assistant']::TEXT[]
    FROM public.addon_products WHERE product_key = 'docubox_colabora_pro'$$,
  ARRAY[TRUE],
  'Pro bundle includes standard and Pro capabilities'
);
SELECT results_eq(
  $$SELECT (metadata ->> 'analytics_level') = 'basic' FROM public.addon_products WHERE product_key = 'docubox_colabora'$$,
  ARRAY[TRUE],
  'standard analytics level is basic'
);

SELECT * FROM finish();
ROLLBACK;
