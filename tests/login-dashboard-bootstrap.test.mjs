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
  verificationSource,
  workspaceSource,
  modulesSource,
  topNavSource,
  activitySource,
] = await Promise.all([
  readFile(
    new URL('../src/app/sign-up-login-screen/components/LoginForm.tsx', import.meta.url),
    'utf8'
  ),
  readFile(new URL('../src/app/documents-dashboard/page.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/dashboard/participations.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/api/auth/check-login-options/route.ts', import.meta.url), 'utf8'),
  readFile(
    new URL(
      '../src/app/documents-dashboard/components/EstadoDocumentosWidget.tsx',
      import.meta.url
    ),
    'utf8'
  ),
  readFile(
    new URL(
      '../src/app/documents-dashboard/components/EstadoParticipacionesWidget.tsx',
      import.meta.url
    ),
    'utf8'
  ),
  readFile(
    new URL('../src/app/documents-dashboard/components/SugeridosParaTiWidget.tsx', import.meta.url),
    'utf8'
  ),
  readFile(
    new URL(
      '../src/app/documents-dashboard/components/DocumentosSinRevisionWidget.tsx',
      import.meta.url
    ),
    'utf8'
  ),
  readFile(
    new URL(
      '../src/app/documents-dashboard/components/VerificationProgressBar.tsx',
      import.meta.url
    ),
    'utf8'
  ),
  readFile(new URL('../src/contexts/WorkspaceContext.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/contexts/AppModulesContext.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/TopNav.tsx', import.meta.url), 'utf8'),
  readFile(
    new URL('../src/app/mis-documentos/components/ActivityAuditLog.tsx', import.meta.url),
    'utf8'
  ),
]);

test('login keeps security validation blocking but does not wait for audit telemetry', () => {
  const passwordLogin = loginSource.slice(
    loginSource.indexOf('const handlePasswordLogin'),
    loginSource.indexOf('// ── OTP Email')
  );

  assert.match(loginSource, /const recordLoginAttempt = \(/);
  assert.match(passwordLogin, /recordLoginAttempt\(false, 'password'\)/);
  assert.match(
    passwordLogin,
    /recordLoginAttempt\(true, 'password', authData\.user\?\.id \|\| null\)/
  );
  assert.doesNotMatch(passwordLogin, /await fetch\('\/api\/security\/log-access'/);
  assert.match(passwordLogin, /void fetch\('\/api\/security\/check-device'/);
  assert.match(passwordLogin, /keepalive: true/);
  assert.match(
    passwordLogin,
    /await enforcePostLoginSecurity\('other', authData\.session\?\.access_token\)/
  );
  assert.ok(
    passwordLogin.indexOf("await enforcePostLoginSecurity('other'") <
      passwordLogin.indexOf('router.replace(requestedRedirect())'),
    'security validation must complete before redirecting'
  );
  assert.doesNotMatch(loginSource, /window\.location\.href = requestedRedirect\(\)/);
});

test('dashboard reuses the hydrated auth user and loads independent data concurrently', () => {
  assert.match(dashboardSource, /const \{ user, loading: authLoading \} = useAuth\(\);/);
  assert.match(
    dashboardSource,
    /const \[\{ data: profile \}, \{ data: sub \}\] = await Promise\.all\(/
  );
  assert.doesNotMatch(dashboardSource, /supabase\.auth\.getUser\(\)/);
  assert.match(dashboardSource, /void loadDashboardData\(user\.id\)/);
});

test('dashboard loads shared document data once and widgets only render that shared state', () => {
  assert.match(participationsSource, /if \(pending\) return pending;/);
  assert.match(
    participationsSource,
    /if \(pendingParticipations\.get\(userId\) === request\) pendingParticipations\.delete\(userId\);/
  );
  assert.match(participationsSource, /if \(pendingOwnedDocuments\.get\(userId\) === request\)/);
  assert.match(participationsSource, /view=dashboard&exclude_owned=true/);
  assert.match(dashboardSource, /const \[ownedDocuments, participations\] = await Promise\.all\(/);
  assert.match(dashboardSource, /useDocumentRealtime\(user\?\.id, refreshDashboardDocuments, 'documents-dashboard'\)/);
  for (const source of [
    estadoSource,
    estadoParticipacionesSource,
    sugeridosSource,
    sinRevisionSource,
  ]) {
    assert.doesNotMatch(source, /fetchDashboardParticipations/);
    assert.doesNotMatch(source, /fetchDashboardOwnedDocuments/);
    assert.doesNotMatch(source, /useDocumentRealtime/);
    assert.doesNotMatch(source, /fetch\(`\/api\/documentos\/mis-participaciones/);
    assert.doesNotMatch(source, /\.from\('documentos'\)/);
  }
});

test('dashboard avoids visible auth placeholders and repeated token-refresh loads', () => {
  assert.doesNotMatch(dashboardSource, /loadingData/);
  assert.match(dashboardSource, /const \[greeting\] = useState\(getGreeting\);/);
  assert.match(verificationSource, /const \{ user, loading: authLoading \} = useAuth\(\);/);
  assert.doesNotMatch(verificationSource, /supabase\.auth\.getUser\(\)/);
  assert.match(verificationSource, /if \(loading \|\| requiredAllDone\) return null;/);
  assert.match(verificationSource, /await Promise\.all\(\[/);
  assert.match(workspaceSource, /\[accountType, supabase, userId\]/);
  assert.match(modulesSource, /\[supabase, userId\]/);
  assert.doesNotMatch(topNavSource, /wsLoading\s*\?\s*'Cargando\.\.\.'/);
  assert.match(topNavSource, /\}, \[userId\]\);/);
  assert.match(
    activitySource,
    /const \[docsResult, participationResult, alertResult\] = await Promise\.all\(/
  );
});

test('login loads alternative methods on demand and the server checks requirements in one RPC', () => {
  assert.match(
    loginSource,
    /const loginOptionsRequestRef = useRef<AbortController \| null>\(null\);/
  );
  assert.match(loginSource, /loginOptionsRequestRef\.current\?\.abort\(\);/);
  assert.match(loginSource, /signal: controller\.signal,/);
  assert.match(loginSource, /requestId !== loginOptionsRequestIdRef\.current/);
  assert.match(loginSource, /onClick=\{loadAlternativeLoginOptions\}/);
  assert.doesNotMatch(loginSource, /setTimeout\(\(\) =>\s*handleContinue\(\)/);
  assert.match(loginOptionsRouteSource, /await Promise\.all\(\[/);
  assert.match(loginOptionsRouteSource, /user_verification_status/);
  assert.match(loginOptionsRouteSource, /webauthn_credentials/);
});
