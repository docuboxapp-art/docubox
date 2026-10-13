import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
await Promise.all([
  ['src/lib/tasks/schedule.ts', 'task-schedule-policy-test.cjs'],
  ['src/lib/tasks/resource-eligibility.ts', 'task-resource-policy-test.cjs'],
].map(([entry, output]) => build({
  entryPoints: [entry], outfile: `node_modules/.cache/${output}`,
  bundle: true, platform: 'node', format: 'cjs',
})));

const { dueCalendarLabel, isScheduledForLater, scheduleValidationError, toLocalDateTimeInput } =
  require('../node_modules/.cache/task-schedule-policy-test.cjs');
const { taskResourceIsEligible } = require('../node_modules/.cache/task-resource-policy-test.cjs');

test('a deadline does not imply a planned start', () => {
  const now = Date.now();
  assert.equal(isScheduledForLater(null, now), false);
  assert.equal(isScheduledForLater(new Date(now + 86400000).toISOString(), now), true);
  assert.equal(isScheduledForLater(new Date(now - 1000).toISOString(), now), false);
});

test('planned start must be future and precede its deadline', () => {
  const now = Date.now();
  const tomorrow = new Date(now + 86400000).toISOString();
  const later = new Date(now + 2 * 86400000).toISOString();
  assert.match(scheduleValidationError(new Date(now - 1000).toISOString(), later, now), /futura/);
  assert.match(scheduleValidationError(later, tomorrow, now), /posterior/);
  assert.equal(scheduleValidationError(tomorrow, later, now), null);
});

test('due labels compare calendar dates, including later today', () => {
  const today = new Date(2026, 9, 13, 9);
  assert.equal(dueCalendarLabel(new Date(2026, 9, 13, 23).toISOString(), today), 'Hoy');
  assert.equal(dueCalendarLabel(new Date(2026, 9, 14, 1).toISOString(), today), 'Mañana');
  assert.equal(toLocalDateTimeInput(new Date(2026, 9, 13, 9, 30).toISOString()), '2026-10-13T09:30');
});

test('resource choices respect document, case and response lifecycle', () => {
  assert.equal(taskResourceIsEligible('document', 'firmar_documento', 'completado'), false);
  assert.equal(taskResourceIsEligible('document', 'firmar_documento', 'en_proceso'), true);
  assert.equal(taskResourceIsEligible('document', 'retomar_borrador', 'borrador'), true);
  assert.equal(taskResourceIsEligible('document', 'retomar_borrador', 'en_proceso'), false);
  assert.equal(taskResourceIsEligible('form_template', 'seguimiento_formulario', 'closed'), false);
  assert.equal(taskResourceIsEligible('case_file', 'cerrar_expediente', 'sealed'), false);
  assert.equal(taskResourceIsEligible('case_file', 'cerrar_expediente', 'draft'), false);
  assert.equal(taskResourceIsEligible('case_file', 'cerrar_expediente', 'ready_to_close'), true);
  assert.equal(taskResourceIsEligible('form_response', 'corregir_datos', 'signed'), false);
  assert.equal(taskResourceIsEligible('participant_requirement', 'subir_anexo', 'pending'), true);
});
