import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const outputDirectory = 'node_modules/.cache/docubox-participant-visibility-tests';
const outputFile = `${outputDirectory}/participant-visibility.mjs`;

await mkdir(outputDirectory, { recursive: true });
await build({
  entryPoints: ['src/lib/documents/participant-visibility.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: outputFile,
  logLevel: 'silent',
});

const visibility = await import(`${pathToFileURL(outputFile).href}?v=${Date.now()}`);
const updateStateRoute = await read('../src/app/api/documentos/update-estado/route.ts');
const participationRoute = await read('../src/app/api/documentos/mis-participaciones/route.ts');
const sentRequestsRoute = await read('../src/app/api/documentos/participation-requests/route.ts');
const sentRequestsPage = await read('../src/app/participation-requests/page.tsx');
const reminderRoute = await read('../src/app/api/documentos/send-reminder/route.ts');
const access = await read('../src/lib/security/document-access.ts');
const fetchRoute = await read('../src/app/api/documentos/obtener/route.ts');
const portalInfo = await read('../src/app/api/portal-participante/info/route.ts');
const portalParticipantData = await read(
  '../src/app/api/portal-participante/participant-data/route.ts'
);
const trashRoute = await read('../src/app/api/documentos/papelera/route.ts');
const lifecycle = await read('../src/lib/documents/lifecycle-policy.ts');

test('only a legally relevant action creates effective participation', () => {
  const participant = { id: 'participant-1', user_id: 'user-1', email: 'ana@example.com' };
  assert.equal(visibility.hasEffectiveParticipation(participant), false);
  assert.equal(
    visibility.hasEffectiveParticipation(participant, [
      { participante_id: 'user-1', firma_completada: true },
    ]),
    true
  );
  assert.equal(
    visibility.hasEffectiveParticipation(participant, [], [{ captured_by: 'user-1' }]),
    true
  );
  assert.equal(
    visibility.hasEffectiveParticipation({ ...participant, sub_estado: 'rechazo' }),
    true
  );
});

test('historical participation remains readable while revoked untouched invitations do not', () => {
  assert.equal(
    visibility.canAccessParticipantRecord({
      current_access: false,
      historical_participation: true,
    }),
    true
  );
  assert.equal(
    visibility.canAccessParticipantRecord({
      current_access: false,
      historical_participation: false,
    }),
    false
  );
});

test('historical visibility does not preserve document access after revocation', () => {
  assert.equal(
    visibility.canAccessParticipantDocument({
      current_access: false,
      historical_participation: true,
    }),
    false
  );
  assert.equal(visibility.canAccessParticipantDocument({}), true);
});

test('cancellation records participant-level access outcomes and audit events', () => {
  assert.match(updateStateRoute, /hasEffectiveParticipation\(participant, responses, evidence\)/);
  assert.match(updateStateRoute, /PARTICIPANT_HISTORY_RETAINED_AFTER_CANCEL/);
  assert.match(updateStateRoute, /PARTICIPANT_ACCESS_REVOKED_BY_DOCUMENT_CANCEL/);
  assert.match(updateStateRoute, /portal_token_invalidated_at/);
  assert.match(updateStateRoute, /historical_participation: true/);
  assert.match(updateStateRoute, /historical_participation: false/);
  assert.match(updateStateRoute, /document_lifecycle_audit_events/);
});

test('participant listings and document reads respect revoked visibility', () => {
  assert.match(
    participationRoute,
    /myEntry\.current_access === false && myEntry\.historical_participation !== true/
  );
  assert.match(participationRoute, /const supabase = userClient/);
  assert.doesNotMatch(participationRoute, /Fetch all non-deleted documents using service role/);
  assert.doesNotMatch(participationRoute, /hiddenFromParticipant\.has\(doc\.id\)/);
  assert.match(access, /participantAccessRevoked/);
  assert.match(access, /canAccessParticipantDocument/);
  assert.match(fetchRoute, /participantEntry\.current_access !== false/);
  assert.doesNotMatch(fetchRoute, /participantEntry\.historical_participation === true/);
});

test('cancelled or invalidated portal links stop before serving participant data', () => {
  assert.match(portalInfo, /portal_token_invalidated_at/);
  assert.match(portalInfo, /status: 410/);
  assert.match(portalParticipantData, /portal_token_invalidated_at/);
  assert.match(portalParticipantData, /status: 410/);
});

test('participant portal resolves a real document name without caching the capability response', async () => {
  const portalPage = await read('../src/app/portal-participante/[token]/page.tsx');
  assert.match(portalInfo, /file_name/);
  assert.match(portalInfo, /resolveDocumentName/);
  assert.match(portalInfo, /upgradeLegacyDocumentLink/);
  assert.match(portalInfo, /document\.participantes\.length !== 1/);
  assert.match(portalInfo, /resolveParticipantIdentity/);
  assert.match(portalInfo, /resolveInvitationInfo/);
  assert.match(portalInfo, /inviterName:/);
  assert.match(portalInfo, /expiresAt:/);
  assert.match(portalInfo, /JSON\.stringify\(\[\{ portal_token_hash: tokenHash \}\]\)/);
  assert.match(portalParticipantData, /JSON\.stringify\(\[\{ portal_token_hash: tokenHash \}\]\)/);
  assert.match(portalInfo, /canonicalToken \? \{ canonicalToken \} : \{\}/);
  assert.match(portalInfo, /Cache-Control': 'private, no-store, max-age=0'/);
  assert.match(portalPage, /cache: 'no-store'/);
  assert.match(portalPage, /router\.replace\(`\/portal-participante\/\$\{encodeURIComponent\(data\.canonicalToken\)\}`\)/);
  assert.match(portalPage, /Tu participación te espera/);
  assert.match(portalPage, /const options = isRegistered/);
  assert.match(portalPage, /id: 'login'/);
  assert.match(portalPage, /id: 'register'/);
  assert.match(portalPage, /Tienes una invitación a participar en un documento/);
  assert.match(portalPage, /Selecciona una opción para continuar/);
  assert.match(portalPage, /¡Hola\{greetingName/);
  assert.match(portalPage, /formatExpiration/);
  assert.match(portalPage, /Invitado por/);
  assert.match(portalPage, /Vence/);
  assert.doesNotMatch(portalPage, /Elige una opción<\/h3>/);
  assert.match(portalPage, /Acceder a mi cuenta/);
  assert.match(portalPage, /Restablecer contraseña/);
  assert.match(portalPage, /Crear mi acceso/);
  assert.match(portalPage, /flex flex-1 items-center justify-center py-10/);
  assert.doesNotMatch(portalPage, /ShieldCheck/);
  assert.doesNotMatch(portalPage, /Es la primera vez que voy a/);
  assert.match(portalPage, /¡Hola\{greetingName/);
  assert.doesNotMatch(portalPage, /Conexión segura/);
  assert.doesNotMatch(portalPage, /Participación documental segura/);
});

test('uninviting evaluates evidence and independently revokes future access', () => {
  assert.match(updateStateRoute, /action === 'desinvitar'/);
  assert.match(updateStateRoute, /PARTICIPANT_UNINVITED/);
  assert.match(updateStateRoute, /PARTICIPANT_HISTORY_RETAINED_AFTER_REVOKE/);
  assert.match(updateStateRoute, /participant_relationship_status: 'REVOKED'/);
  assert.match(updateStateRoute, /recordatorios_cancelados_at/);
  assert.match(updateStateRoute, /portal_token_invalidated_at/);
});

test('owner lists remove untouched revoked participants but retain historical participants', () => {
  assert.match(
    sentRequestsRoute,
    /participant\.current_access !== false \|\| participant\.historical_participation === true/
  );
  assert.match(sentRequestsPage, /Desinvitar participante/);
  assert.match(sentRequestsPage, /Acceso revocado/);
  assert.match(sentRequestsPage, /action: 'desinvitar'/);
});

test('revoked participants cannot receive reminders and cancellation uses the policy endpoint', () => {
  assert.match(reminderRoute, /participantForReminder\.current_access === false/);
  assert.match(reminderRoute, /Sin permisos para enviar recordatorios/);
  assert.match(sentRequestsPage, /action: 'cancelar'/);
  assert.doesNotMatch(sentRequestsPage, /from\('documentos'\)\.update\(\{\s*estado: 'cancelado'/s);
});

test('Legal Hold still precedes every participant or owner trash operation', () => {
  const holdCheck = trashRoute.indexOf('if (disposition.legalHoldActive)');
  const personalTrash = trashRoute.indexOf("from('document_user_visibility').upsert");
  assert.ok(holdCheck >= 0 && holdCheck < personalTrash);
  assert.match(trashRoute, /LEGAL_HOLD_ACTIVE/);
  assert.match(lifecycle, /canCancel: workflowActive/);
});
