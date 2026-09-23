import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const signer = await readFile(
  new URL('../src/app/firmar-documento/[id]/page.tsx', import.meta.url),
  'utf8'
);
const sendStep = await readFile(
  new URL('../src/app/crear-documento/components/StepEnviar.tsx', import.meta.url),
  'utf8'
);
const fieldStep = await readFile(
  new URL('../src/app/crear-documento/components/StepAjustes.tsx', import.meta.url),
  'utf8'
);

test('legacy participant labels are normalized before autofill', () => {
  assert.match(signer, /normalizeParticipantFieldToken/);
  assert.match(signer, /'nombre completo': 'nombre_completo'/);
  assert.match(sendStep, /resolveSerializedFieldType\(\(f as any\)\.tipo, f\.label\)/);
});

test('the signer resolves values from the assigned participant identity', () => {
  assert.match(signer, /participantIdentityKeys/);
  assert.match(signer, /myPart\?\.participant_ref_id/);
  assert.match(signer, /mergeAssignedParticipantProfile/);
  assert.match(signer, /data\.rfc \|\| data\.efirma_rfc/);
});

test('the creation preview binds the creator profile to the creator participant', () => {
  assert.match(fieldStep, /participant\.id === 'current-user'/);
  assert.match(fieldStep, /participant\.id === user\.id/);
  assert.doesNotMatch(fieldStep, /const firstParticipant = targetParticipants\[0\]/);
});
