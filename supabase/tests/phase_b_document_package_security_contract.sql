BEGIN;

SELECT plan(30);

SELECT has_table('public', 'document_packages', 'optional document package exists');
SELECT has_table('public', 'document_package_resources', 'package resources exist');
SELECT has_table('public', 'participant_document_requirements', 'participant requirements exist');
SELECT has_table('public', 'document_resource_visibility', 'resource visibility exists');
SELECT has_table('public', 'document_resource_interactions', 'resource interactions exist');
SELECT has_table('public', 'in_person_signing_sessions', 'in-person sessions exist');
SELECT has_column('public', 'participant_document_requirements', 'participant_reference_id', 'requirements use stable participant identity');
SELECT has_column('public', 'document_package_resources', 'document_version_id', 'resources can bind to a document version');
SELECT has_column('public', 'in_person_signing_sessions', 'token_hash', 'kiosk tokens are stored as hashes');
SELECT has_column('public', 'in_person_signing_sessions', 'expires_at', 'kiosk sessions expire');
SELECT has_column('public', 'in_person_signing_sessions', 'revoked_at', 'kiosk sessions are revocable');
SELECT has_column('public', 'in_person_signing_sessions', 'correlation_id', 'kiosk events are correlated');
SELECT has_function('public', 'is_current_document_participant_reference', ARRAY['uuid'], 'participant identity helper exists');
SELECT has_function('public', 'can_manage_document_package', ARRAY['uuid'], 'package management helper exists');
SELECT has_function('public', 'can_view_document_package_resource', ARRAY['uuid'], 'resource visibility helper exists');
SELECT has_trigger('public', 'document_package_resources', 'enforce_document_package_resource_scope', 'resource tenant scope is enforced');
SELECT has_trigger('public', 'participant_document_requirements', 'enforce_participant_requirement_scope', 'requirement scope is enforced');
SELECT has_trigger('public', 'document_resource_visibility', 'enforce_document_resource_visibility_scope', 'visibility scope is enforced');
SELECT has_trigger('public', 'in_person_signing_sessions', 'enforce_in_person_session_scope', 'kiosk scope is enforced');
SELECT has_trigger('public', 'documentos', 'complete_in_person_session_from_participant_state', 'participant completion revokes kiosk session');
SELECT has_trigger('public', 'document_package_resources', 'protect_package_resource_legal_hold', 'Legal Hold preserves resources');
SELECT has_trigger('public', 'participant_document_requirements', 'protect_requirement_legal_hold', 'Legal Hold preserves requirements');
SELECT ok((SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.document_packages'::regclass), 'packages have RLS');
SELECT ok((SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.document_package_resources'::regclass), 'resources have RLS');
SELECT ok((SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.participant_document_requirements'::regclass), 'requirements have RLS');
SELECT ok((SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.document_resource_visibility'::regclass), 'visibility has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.document_resource_interactions'::regclass), 'interactions have RLS');
SELECT ok((SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.in_person_signing_sessions'::regclass), 'kiosk sessions have RLS');
SELECT ok(NOT has_table_privilege('authenticated', 'public.in_person_signing_sessions', 'SELECT,INSERT,UPDATE,DELETE'), 'browser sessions cannot read or mutate kiosk rows');
SELECT ok(NOT has_table_privilege('authenticated', 'public.document_package_resources', 'INSERT,UPDATE,DELETE'), 'resource mutations remain server-side');

SELECT * FROM finish();
ROLLBACK;
