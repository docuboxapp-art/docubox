import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const checkRoute = read('src/app/api/auth/totp/check/route.ts');
const verifyRoute = read('src/app/api/auth/totp/verify-login/route.ts');
const verifySetupRoute = read('src/app/api/auth/totp/verify-setup/route.ts');
const disableRoute = read('src/app/api/auth/totp/disable/route.ts');
const loginForm = read('src/app/sign-up-login-screen/components/LoginForm.tsx');
const proof = read('src/lib/security/platform-mfa-proof.ts');
const superadminLayout = read('src/app/superadmin/layout.tsx');
const adminPage = read('src/app/panel/[[...section]]/page.tsx');
const enrollmentPage = read('src/app/auth/totp-enrollment/page.tsx');
const enrollmentClient = read('src/app/auth/totp-enrollment/MandatoryTotpEnrollment.tsx');
const passkeyProof = read('src/lib/security/platform-passkey-proof.ts');
const passkeyEnrollment = read('src/app/auth/passkey-enrollment/page.tsx');
const passkeyVerification = read('src/app/auth/passkey-verification/page.tsx');
const webauthnVerify = read('src/app/api/webauthn/auth-verify/route.ts');
const webauthnRegisterVerify = read('src/app/api/webauthn/register-verify/route.ts');

test('TOTP requirement lookup is authenticated and bound to the active session user', () => {
  assert.match(checkRoute, /authorization\?\.startsWith\('Bearer '\)/);
  assert.match(checkRoute, /service\.auth\.getUser\(token\)/);
  assert.doesNotMatch(checkRoute, /req\.json\(\)|body\.userId|\{ userId \}/);
});

test('every primary login method passes through the same post-login security gate', () => {
  assert.match(loginForm, /const enforcePostLoginSecurity = async/);
  assert.equal((loginForm.match(/await enforcePostLoginSecurity\(/g) || []).length, 3);
  assert.match(loginForm, /\/auth\/totp-enrollment\?redirect=/);
  assert.match(loginForm, /\/login\/totp-verification\?redirect=/);
});

test('superadmin TOTP verification cannot target another user id', () => {
  assert.match(verifyRoute, /supabaseAdmin\.auth\.getUser\(token\)/);
  assert.match(verifyRoute, /const userId = authData\.user\.id/);
  assert.doesNotMatch(verifyRoute, /const \{ userId, code \} = body/);
});

test('successful verification issues an HttpOnly session-bound proof', () => {
  assert.match(verifyRoute, /createPlatformMfaProof\(authData\.user, \{ passkeyVerified \}\)/);
  assert.match(verifySetupRoute, /createPlatformMfaProof\(user, \{ passkeyVerified \}\)/);
  assert.match(proof, /createHmac\('sha256'/);
  assert.match(proof, /payload\.lastSignInAt === user\.last_sign_in_at/);
  assert.match(proof, /payload\.passkeyVerified/);
  assert.match(proof, /timingSafeEqual/);
  assert.match(proof, /httpOnly: true/);
  assert.match(proof, /sameSite: 'strict'/);
  assert.match(proof, /PLATFORM_MFA_MAX_AGE_SECONDS = 30 \* 60/);
  assert.match(proof, /path: '\/'/);
  assert.match(verifyRoute, /if \(access\)/);
  assert.match(verifySetupRoute, /if \(access\)/);
});

test('Control Plane redirects missing enrollment and missing session proof', () => {
  assert.match(adminPage, /if \(!access\.totpEnrolled\)/);
  assert.match(adminPage, /\/auth\/totp-enrollment\?redirect=\/panel/);
  assert.match(adminPage, /verifyPlatformMfaProof/);
  assert.match(adminPage, /\/login\/totp-verification\?redirect=\/panel/);
  assert.doesNotMatch(superadminLayout, /SuperadminShell/);
});

test('mandatory enrollment is restricted to platform staff and cannot be dismissed', () => {
  assert.match(enrollmentPage, /if \(!access\) notFound\(\)/);
  assert.match(enrollmentClient, /<TotpSetupModal/);
  assert.match(enrollmentClient, /mandatory/);
  assert.match(enrollmentClient, /requiredAuthenticator="google"/);
  assert.doesNotMatch(enrollmentClient, /onClose=/);
});

test('privileged staff requires an enrolled and freshly verified passkey before TOTP', () => {
  assert.match(adminPage, /access\.passkeyRequired && !access\.passkeyEnrolled/);
  assert.match(adminPage, /verifyPlatformPasskeyProof/);
  assert.match(adminPage, /\/auth\/passkey-verification\?redirect=\/panel/);
  assert.match(passkeyEnrollment, /MandatoryPasskeyEnrollment/);
  assert.match(passkeyVerification, /MandatoryPasskeyVerification/);
  assert.match(webauthnVerify, /createPlatformPasskeyProof\(userId\)/);
  assert.doesNotMatch(webauthnVerify, /get_platform_staff_access/);
  assert.match(webauthnRegisterVerify, /createPlatformPasskeyProof\(user\.id\)/);
  assert.doesNotMatch(webauthnRegisterVerify, /get_platform_staff_access/);
  assert.match(passkeyProof, /createHmac\('sha256'/);
  assert.match(passkeyProof, /httpOnly: true/);
  assert.match(passkeyProof, /sameSite: 'strict'/);
  assert.match(passkeyProof, /PLATFORM_PASSKEY_MAX_AGE_SECONDS = 5 \* 60/);
  assert.match(verifyRoute, /PLATFORM_PASSKEY_REQUIRED/);
  assert.match(verifySetupRoute, /PLATFORM_PASSKEY_REQUIRED/);
  assert.match(verifyRoute, /response\.cookies\.delete\(PLATFORM_PASSKEY_COOKIE\)/);
  assert.match(adminPage, /requirePasskey: access\.passkeyRequired/);
});

test('platform staff cannot disable mandatory TOTP', () => {
  assert.match(disableRoute, /if \(platformAccess\)/);
  assert.match(disableRoute, /PLATFORM_STAFF_TOTP_REQUIRED/);
  assert.match(disableRoute, /TOTP_DISABLE_DENIED/);
});
