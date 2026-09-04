import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const uploadStep = await read('../src/app/crear-documento/components/StepSubir.tsx');
const draftRoute = await read('../src/app/api/documentos/guardar-borrador/route.ts');
const sendRoute = await read('../src/app/api/documentos/enviar/route.ts');

test('Legal Hold is configurable during document creation with a mandatory classified reason', () => {
  assert.match(uploadStep, /Aplicar Legal Hold al documento/);
  assert.match(uploadStep, /Motivo de Legal Hold/);
  assert.match(uploadStep, /legalHoldEnabled,/);
  assert.match(uploadStep, /legalHoldReason,/);
});

test('draft persistence rejects an unclassified Legal Hold request and records its activation', () => {
  assert.match(draftRoute, /LEGAL_HOLD_REASON_REQUIRED/);
  assert.match(draftRoute, /legal_hold_status = 'ACTIVE'/);
  assert.match(draftRoute, /action: 'LEGAL_HOLD_ACTIVATED'/);
  assert.match(draftRoute, /document_lifecycle_audit_events/);
});

test('sending a document keeps Legal Hold server-side and audit-backed', () => {
  assert.match(sendRoute, /LEGAL_HOLD_REASON_REQUIRED/);
  assert.match(sendRoute, /documentRecord\.legal_hold = true/);
  assert.match(sendRoute, /action: 'LEGAL_HOLD_ACTIVATED'/);
  assert.match(sendRoute, /legalHoldAlreadyActive/);
});
