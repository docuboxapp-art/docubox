import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const migration = await read(
  '../supabase/migrations/20260908044044_enforce_human_session_activity_policy.sql'
);
const twentyMinuteTimeoutMigration = await read(
  '../supabase/migrations/20260909075009_session_inactivity_timeout_twenty_minutes.sql'
);
const timeoutHook = await read('../src/hooks/useSessionTimeout.ts');
const middleware = await read('../src/middleware.ts');
const loginForm = await read('../src/app/sign-up-login-screen/components/LoginForm.tsx');
const totpCheckRoute = await read('../src/app/api/auth/totp/check/route.ts');

test('server session policy distinguishes ordinary and privileged limits', () => {
  assert.match(migration, /CASE WHEN v_is_privileged THEN 600 ELSE 900 END/);
  assert.match(migration, /THEN INTERVAL '4 hours' ELSE INTERVAL '8 hours'/);
  assert.match(migration, /auth\.sessions sessions/);
  assert.match(migration, /sessions\.id = v_session_id/);
  assert.match(migration, /platform_staff staff/);
});

test('standard session inactivity timeout is twenty minutes', () => {
  assert.match(
    twentyMinuteTimeoutMigration,
    /CASE WHEN v_is_privileged THEN 600 ELSE 1200 END/
  );
  assert.match(twentyMinuteTimeoutMigration, /inactividad \(20 minutos\)/);
  assert.match(
    twentyMinuteTimeoutMigration,
    /THEN INTERVAL '4 hours' ELSE INTERVAL '8 hours'/
  );
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

test('authentication routes finish session bootstrap before timeout enforcement starts', () => {
  assert.match(timeoutHook, /SESSION_BOOTSTRAP_PATHS/);
  assert.match(timeoutHook, /'\/login'/);
  assert.match(timeoutHook, /'\/auth\/'/);
  assert.match(timeoutHook, /sessionPolicyEnabled = isAuthenticated && !isSessionBootstrapPath/);
  assert.match(timeoutHook, /if \(!sessionPolicyEnabled \|\| signedOutRef\.current\) return/);
});

test('middleware validates authenticated browser and API traffic server-side', () => {
  assert.doesNotMatch(middleware, /'\/api\/'\s*,/);
  assert.match(middleware, /enforce_docubox_session_policy/);
  assert.match(middleware, /p_record_user_activity: false/);
  assert.doesNotMatch(middleware, /supabase\.auth\.getUser\(\)/);
  assert.match(middleware, /hasSessionMaterial/);
  assert.match(middleware, /isInvalidSessionError/);
  assert.match(middleware, /supabase\.auth\.getClaims\(accessToken\)/);
  assert.match(middleware, /refresh_token_not_found/);
  assert.match(middleware, /SESSION_EXPIRED/);
  assert.match(middleware, /unavailableSessionPolicyResponse/);
  assert.match(middleware, /SESSION_POLICY_UNAVAILABLE/);
  assert.match(middleware, /event\.waitUntil/);
  assert.match(middleware, /supabase\.auth\s*\.signOut\(\{ scope: 'local' \}\)/);
  assert.match(middleware, /Server-Timing/);
  assert.match(middleware, /SESSION_POLICY_BOOTSTRAP_API_ROUTES/);
  assert.match(middleware, /'\/api\/auth\/totp\/check'/);
});

test('timeout modal actions close only explicitly invalid browser sessions', () => {
  assert.match(timeoutHook, /SIGN_OUT_FALLBACK_MS/);
  assert.match(timeoutHook, /await Promise\.race/);
  assert.match(timeoutHook, /isExplicitlyInvalidSession/);
  assert.match(timeoutHook, /Client validation unavailable; preserving local session/);
  assert.match(timeoutHook, /Client policy response was invalid; preserving local session/);
  assert.doesNotMatch(timeoutHook, /Client validation failed; closing the local session/);
  assert.match(timeoutHook, /await executeSignOut\('inactivity'\)/);
  assert.match(timeoutHook, /const continueSession = useCallback\(async/);
  assert.match(timeoutHook, /createClient\(\)\.auth\.signOut\(\{ scope: 'local' \}\)/);
});

test('temporary policy or permission errors do not erase an otherwise valid session', () => {
  assert.doesNotMatch(
    middleware,
    /permission denied for function enforce_docubox_session_policy/
  );
  assert.match(middleware, /Tu sesión continúa activa\. Espera un momento y vuelve a intentar\./);
  assert.match(middleware, /status: 503/);
});

test('a transient PostgREST schema-cache miss receives one bounded retry', () => {
  assert.match(middleware, /TRANSIENT_SESSION_POLICY_ERROR_CODES = new Set\(\['PGRST002'\]\)/);
  assert.match(middleware, /SESSION_POLICY_RETRY_DELAY_MS = 350/);
  assert.match(middleware, /if \(isTransientSessionPolicyError\(result\.error\)\)/);
  assert.match(middleware, /await waitForSessionPolicyRetry\(\);/);
  assert.match(middleware, /persistent failure still blocks protected traffic/);
});

test('session expiry is auditable and protected from direct table access', () => {
  assert.match(migration, /session_timeout_inactivity/);
  assert.match(migration, /session_timeout_absolute/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(
    migration,
    /REVOKE ALL ON TABLE public\.docubox_session_activity FROM PUBLIC, anon, authenticated/
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.enforce_docubox_session_policy\(BOOLEAN\)\s+TO authenticated, service_role/
  );
});

test('post-login checks use the freshly issued session token', () => {
  assert.match(loginForm, /accessToken\?: string/);
  assert.match(loginForm, /authData\.session\?\.access_token/);
  assert.match(loginForm, /verifiedSession\?\.session\?\.access_token/);
});

test('post-login endpoint validates the user token before retrieving security requirements', () => {
  assert.match(totpCheckRoute, /const auth = createAnonClient\(\)/);
  assert.match(totpCheckRoute, /auth\.auth\.getUser\(token\)/);
  assert.doesNotMatch(totpCheckRoute, /service\.auth\.getUser\(token\)/);
  assert.match(totpCheckRoute, /service\.rpc\(\s*'get_login_security_requirements'/);
  assert.match(totpCheckRoute, /p_user_id: data\.user\.id/);
});
