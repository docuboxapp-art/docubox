import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const signingPage = await readFile('src/app/firmar-documento/[id]/page.tsx', 'utf8');
const sendStep = await readFile('src/app/crear-documento/components/StepEnviar.tsx', 'utf8');
const persistRoute = await readFile('src/app/api/firma/persist-evidence/route.ts', 'utf8');
const finalizeRoute = await readFile('src/app/api/firma/finalize-evidence/route.ts', 'utf8');
const completionRoute = await readFile('src/app/api/firma/completion/route.ts', 'utf8');
const captureFunction = await readFile('supabase/functions/capture-signature/index.ts', 'utf8');
const efirmaFunction = await readFile('supabase/functions/sign-efirma/index.ts', 'utf8');

test('the signing client resolves legacy current-user aliases to a UUID', () => {
  assert.match(signingPage, /function resolveParticipantRecordId\(/);
  assert.match(signingPage, /const participantRecordId = resolveParticipantRecordId\(/);
  assert.match(signingPage, /participantRecordId=\{participantRecordId\}/);
  assert.doesNotMatch(
    signingPage,
    /myParticipantData\?\.id \|\| myParticipantData\?\.user_id \|\| user\.id/
  );
});

test('new documents persist the authenticated UUID for the creator participant', () => {
  assert.match(
    sendStep,
    /user_id: p\.id === 'current-user' \? user\.id : isRegisteredUser \? p\.id : null/
  );
});

test('signature evidence endpoints reject UI aliases before UUID persistence', () => {
  assert.match(persistRoute, /resolveParticipantRecordId\(participantEntry, user\.id\)/);
  assert.match(finalizeRoute, /const participantRecordId =\s*\[participant\?\.user_id/);
  assert.match(captureFunction, /resolveParticipantRecordId\(participant_id, user\.id\)/);
  assert.match(efirmaFunction, /resolveParticipantRecordId\(body\.participant_id, user\.id\)/);
  assert.match(completionRoute, /participantRecordId === user\.id/);
});

test('autograph capture writes the activity actor using the canonical activity schema', () => {
  assert.match(persistRoute, /actor_id: user\.id/);
  assert.match(persistRoute, /actor_nombre: user\.user_metadata\?\.full_name/);
  assert.match(persistRoute, /actor_email: user\.email \|\| null/);
  assert.doesNotMatch(persistRoute, /user_id: user\.id/);
});
