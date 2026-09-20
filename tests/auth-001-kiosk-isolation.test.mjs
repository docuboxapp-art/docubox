import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const middleware = await read('../src/middleware.ts');
const sessionService = await read('../src/lib/in-person/kiosk-session.server.ts');
const documentAccess = await read('../src/lib/security/document-access.ts');
const contextRoute = await read('../src/app/api/firma-presencial/context/route.ts');
const recoveryRoute = await read('../src/app/api/firma-presencial/recover/route.ts');
const handoffRoute = await read('../src/app/api/firma-presencial/[token]/route.ts');
const signingPage = await read('../src/app/firmar-documento/[id]/page.tsx');
const neutralPage = await read('../src/app/firma-presencial/finalizada/[sessionId]/page.tsx');
const recoveryPage = await read('../src/app/firma-presencial/recuperar/[sessionId]/page.tsx');
const obtainDocument = await read('../src/app/api/documentos/obtener/route.ts');
const sendOtp = await read('../src/app/api/firma/send-otp/route.ts');
const persistEvidence = await read('../src/app/api/firma/persist-evidence/route.ts');
const mobileResult = await read('../src/app/api/mobile-upload/session-result/route.ts');
const migration = await read('../supabase/migrations/20260913213000_phase_b_document_packages.sql');

test('kiosk authorization is an HttpOnly scoped server cookie', () => {
  assert.match(sessionService, /httpOnly: true/);
  assert.match(sessionService, /sameSite: 'strict'/);
  assert.match(sessionService, /secure: process\.env\.NODE_ENV === 'production'/);
  assert.match(sessionService, /KIOSK_SESSION_SECONDS = 15 \* 60/);
  assert.match(sessionService, /KIOSK_CONTAINMENT_COOKIE_SECONDS = 24 \* 60 \* 60/);
  assert.match(
    handoffRoute,
    /response\.cookies\.set\(KIOSK_COOKIE_NAME, token, kioskCookieOptions\(\)\)/
  );
  assert.doesNotMatch(signingPage, /localStorage.*kiosk|kiosk.*localStorage/i);
});

test('middleware fails closed and locks navigation to the exact kiosk scope', () => {
  assert.match(middleware, /loadKioskMiddlewareScope/);
  assert.match(middleware, /KIOSK_SCOPE_DENIED/);
  assert.match(middleware, /scope\.documentId/);
  assert.match(middleware, /scope\.participantReferenceId/);
  assert.match(middleware, /scope\.workspaceId/);
  assert.match(middleware, /isAllowedKioskPage/);
  assert.match(middleware, /isAllowedKioskApi/);
  assert.match(middleware, /pathname === `\/firmar-documento\/\$\{scope\.documentId\}`/);
  assert.match(middleware, /return false;\s*}\s*\n\s*async function enforceKioskScope/);
  assert.doesNotMatch(middleware, /path\.startsWith\('\/api\/(?:auth|security|webauthn)\/'\)/);
});

test('document and participant identity are enforced behind shared server access', () => {
  assert.match(documentAccess, /assertKioskDocumentScope\(request, documentId\)/);
  assert.match(documentAccess, /kioskParticipantMatchesUser\(service, kioskSession, user\)/);
  assert.match(documentAccess, /KIOSK_PARTICIPANT_MISMATCH/);
  for (const route of [obtainDocument, sendOtp, persistEvidence]) {
    assert.match(route, /assertKioskDocumentScope/);
    assert.match(route, /kioskParticipantMatchesUser/);
  }
  assert.match(mobileResult, /requireDocumentAccess\(request, documentId\)/);
});

test('session cancellation, completion, expiry and replay are terminal server states', () => {
  assert.match(contextRoute, /body\.action === 'cancel'/);
  assert.match(contextRoute, /status: 'cancelled'/);
  assert.match(contextRoute, /status: 'completed'/);
  assert.match(contextRoute, /participation_responses/);
  assert.match(contextRoute, /in_person_session\.cancelled/);
  assert.match(contextRoute, /in_person_session\.completed/);
  assert.match(sessionService, /status: 'expired'/);
  assert.match(handoffRoute, /SESSION_REPLAY_BLOCKED/);
  assert.match(migration, /in_person_sessions_one_active_participant_idx/);
  assert.match(migration, /complete_in_person_session_from_participant_state/);
});

test('completion and cancellation destroy participant auth before neutral navigation', () => {
  assert.match(signingPage, /closeKioskContext\('complete'\)/);
  assert.match(signingPage, /closeKioskContext\('cancel'\)/);
  assert.match(signingPage, /auth\.signOut\(\{ scope: 'local' \}\)/);
  assert.match(signingPage, /window\.location\.replace\(payload\.data\.neutralPath\)/);
  assert.ok(
    signingPage.indexOf("closeKioskContext('complete')") <
      signingPage.indexOf("setStep('completado')")
  );
});

test('neutral screen exposes no participant, document or owner account data', () => {
  assert.match(neutralPage, /Proceso completado/);
  assert.match(neutralPage, /Devuelve el dispositivo/);
  assert.match(neutralPage, /Recuperar mi sesión/);
  assert.doesNotMatch(neutralPage, /participantName|documentName|workspaceName|organizationName/);
  assert.match(neutralPage, /auth\.signOut\(\{ scope: 'local' \}\)/);
});

test('owner recovery requires fresh auth, original ownership and a terminal kiosk session', () => {
  assert.match(recoveryRoute, /createAnonClient\(\)\.auth\.getUser\(token\)/);
  assert.match(recoveryRoute, /\.eq\('created_by', auth\.data\.user\.id\)/);
  assert.match(recoveryRoute, /\.in\('status', terminalStatuses\)/);
  assert.match(recoveryRoute, /consumeServerRateLimit/);
  assert.match(recoveryRoute, /owner_context_restored/);
  assert.match(recoveryPage, /auth\.getSession\(\)/);
  assert.match(recoveryPage, /Authorization: `Bearer \$\{data\.session\.access_token\}`/);
});

test('remote signing remains the unchanged fallback when no kiosk context exists', () => {
  assert.match(signingPage, /if \(!kioskSessionId\) return false/);
  assert.match(signingPage, /if \(await closeKioskContext\('complete'\)\) return/);
  assert.match(signingPage, /setStep\('completado'\)/);
  assert.match(signingPage, /router\.push\(`\/visor-documento\/\$\{document\?\.id\}`\)/);
});

test('rate limiting is reused for kiosk entry, actions and owner recovery', () => {
  assert.match(handoffRoute, /consumeServerRateLimit/);
  assert.match(contextRoute, /consumeServerRateLimit/);
  assert.match(recoveryRoute, /consumeServerRateLimit/);
  assert.doesNotMatch(contextRoute, /new Map|rateLimitStore|setInterval/);
});

test('AUTH-001 does not alter cryptographic or evidence schemas', () => {
  const authFiles = [
    middleware,
    sessionService,
    contextRoute,
    recoveryRoute,
    neutralPage,
    recoveryPage,
  ];
  for (const source of authFiles) {
    assert.doesNotMatch(source, /CREATE TABLE|ALTER TABLE|PAdES|NOM-151|NOM151|KMS|HSM|TSA/);
  }
});
