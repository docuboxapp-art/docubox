BEGIN;

SELECT plan(12);

SELECT has_column('public', 'collaboration_room_guests', 'token_hash', 'guest links store hashes');
SELECT has_column('public', 'collaboration_external_sessions', 'session_token_hash', 'external sessions store hashes');
SELECT has_column('public', 'collaboration_request_external_sessions', 'otp_hash', 'request OTP values are hashed');
SELECT has_column('public', 'collaboration_request_files', 'sha256', 'request files have integrity hashes');
SELECT has_column('public', 'collaboration_request_files', 'malware_scan_status', 'request files are fail-closed');
SELECT has_column('public', 'collaboration_rooms', 'watermark_enabled', 'rooms support watermark policy');
SELECT has_column('public', 'collaboration_rooms', 'downloads_allowed', 'rooms support download policy');
SELECT has_column('public', 'collaboration_rooms', 'terms_required', 'rooms support terms acceptance');
SELECT has_function(
  'public',
  'incorporate_collaboration_request_file',
  ARRAY['uuid', 'uuid', 'uuid'],
  'file incorporation is transactional'
);
SELECT has_function('public', 'record_collaboration_usage_insert', ARRAY[]::TEXT[], 'resource usage is metered');
SELECT has_trigger('public', 'collaboration_rooms', 'collaboration_rooms_meter_insert', 'room creation is metered');
SELECT has_trigger('public', 'collaboration_automation_runs', 'collaboration_automation_runs_meter_insert', 'automation executions are metered');

SELECT * FROM finish();
ROLLBACK;
