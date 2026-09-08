import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const migration = await read(
  '../supabase/migrations/20260908044044_enforce_human_session_activity_policy.sql'
);
const timeoutHook = await read('../src/hooks/useSessionTimeout.ts');
const middleware = await read('../src/middleware.ts');
const loginForm = await read('../src/app/sign-up-login-screen/components/LoginForm.tsx');

test('server session policy distinguishes ordinary and privileged limits', () => {
  assert.match(migration, /CASE WHEN v_is_privileged THEN 600 ELSE 900 END/);
  assert.match(migration, /THEN INTERVAL '4 hours' ELSE INTERVAL '8 hours'/);
  assert.match(migration, /auth\.sessions sessions/);
  assert.match(migration, /sessions\.id = v_session_id/);
  assert.match(migration, /platform_staff staff/);
});

test('only explicit human interactions can extend the inactivity window', () => {
  assert.match(timeoutHook, /'pointerdown'/);
  assert.match(timeoutHook, /'keydown'/);
  assert.match(timeoutHook, /'touchstart'/);
  assert.match(timeoutHook, /'popstate'/);
  assert.doesNotMatch(timeoutHook, /'mousemove'/);
  assert.doesNotMatch(timeoutHook, /'scroll'/);
  assert.match(timeoutHook, /p_record_user_activity: recordUserActivity/);
  assert.match(migration, /IF p_record_user_activity THEN/);
});

test('middleware validates authenticated browser and API traffic server-side', () => {
  assert.doesNotMatch(middleware, /'\/api\/'\s*,/);
  assert.match(middleware, /enforce_docubox_session_policy/);
  assert.match(middleware, /p_record_user_activity: false/);
  assert.match(middleware, /SESSION_EXPIRED/);
  assert.match(middleware, /await supabase\.auth\.signOut\(\)/);
});

test('session expiry is auditable and protected from direct table access', () => {
  assert.match(migration, /session_timeout_inactivity/);
  assert.match(migration, /session_timeout_absolute/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.docubox_session_activity FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.enforce_docubox_session_policy\(BOOLEAN\)\s+TO authenticated, service_role/);
});

test('post-login checks use the freshly issued session token', () => {
  assert.match(loginForm, /accessToken\?: string/);
  assert.match(loginForm, /authData\.session\?\.access_token/);
  assert.match(loginForm, /verifiedSession\?\.session\?\.access_token/);
});
