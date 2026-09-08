import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [
  loginSource,
  dashboardSource,
  participationsSource,
  loginOptionsRouteSource,
  estadoSource,
  estadoParticipacionesSource,
  sugeridosSource,
  sinRevisionSource,
] = await Promise.all([
  readFile(new URL('../src/app/sign-up-login-screen/components/LoginForm.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/documents-dashboard/page.tsx', import.meta.url), 'utf8'),
   readFile(new URL('../src/lib/dashboard/participations.ts', import.meta.url), 'utf8'),
   readFile(new URL('../src/app/api/auth/check-login-options/route.ts', import.meta.url), 'utf8'),
   readFile(
     new URL('../src/app/documents-dashboard/components/EstadoDocumentosWidget.tsx', import.meta.url),
     'utf8'
   ),
   readFile(
     new URL('../src/app/documents-dashboard/components/EstadoParticipacionesWidget.tsx', import.meta.url),
     'utf8'
   ),
   readFile(
     new URL('../src/app/documents-dashboard/components/SugeridosParaTiWidget.tsx', import.meta.url),
     'utf8'
   ),
   readFile(
     new URL('../src/app/documents-dashboard/components/DocumentosSinRevisionWidget.tsx', import.meta.url),
     'utf8'
   ),
 ]);

test('login keeps security validation blocking but does not wait for audit telemetry', () => {
  const passwordLogin = loginSource.slice(
    loginSource.indexOf('const handlePasswordLogin'),
    loginSource.indexOf('// ── OTP Email')
  );

  assert.match(passwordLogin, /void fetch\('\/api\/security\/log-access'/);
  assert.match(passwordLogin, /void fetch\('\/api\/security\/check-device'/);
  assert.match(passwordLogin, /keepalive: true/);
  assert.match(
    passwordLogin,
    /await enforcePostLoginSecurity\('other', authData\.session\?\.access_token\)/
  );
  assert.ok(
    passwordLogin.indexOf("await enforcePostLoginSecurity('other'") <
      passwordLogin.indexOf('window.location.href = requestedRedirect()'),
    'security validation must complete before redirecting'
  );
});

test('dashboard reuses the hydrated auth user and loads independent data concurrently', () => {
  assert.match(dashboardSource, /const \{ user, loading: authLoading \} = useAuth\(\);/);
  assert.match(dashboardSource, /const \[\{ data: profile \}, \{ data: sub \}\] = await Promise\.all\(/);
  assert.doesNotMatch(dashboardSource, /supabase\.auth\.getUser\(\)/);
  assert.match(dashboardSource, /void loadDashboardData\(user\.id\);/);
});

test('dashboard widgets share only an in-flight participation request', () => {
  assert.match(participationsSource, /if \(pendingParticipations\) return pendingParticipations;/);
  assert.match(participationsSource, /if \(pendingParticipations === request\) pendingParticipations = null;/);
  for (const source of [estadoSource, estadoParticipacionesSource, sugeridosSource, sinRevisionSource]) {
    assert.match(source, /fetchDashboardParticipations\(\)/);
    assert.doesNotMatch(source, /fetch\(`\/api\/documentos\/mis-participaciones/);
  }
});

test('login cancels stale option lookups and the server queries independent checks together', () => {
  assert.match(loginSource, /const loginOptionsRequestRef = useRef<AbortController \| null>\(null\);/);
  assert.match(loginSource, /loginOptionsRequestRef\.current\?\.abort\(\);/);
  assert.match(loginSource, /signal: controller\.signal,/);
  assert.match(loginSource, /requestId !== loginOptionsRequestIdRef\.current/);
  assert.match(loginOptionsRouteSource, /await Promise\.all\(\[/);
  assert.match(loginOptionsRouteSource, /user_verification_status/);
  assert.match(loginOptionsRouteSource, /webauthn_credentials/);
});
