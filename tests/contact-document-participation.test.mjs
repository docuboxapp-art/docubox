import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/lib/contacts/document-participation.ts'],
  write: false,
  bundle: true,
  platform: 'node',
  format: 'esm',
});
const { getContactParticipationStatus, isPendingContactParticipation } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
);
const now = Date.parse('2026-11-24T18:00:00Z');
const expired = '2026-11-24T17:00:00Z';
const near = '2026-11-27T18:00:00Z';

const reminderBuild = await build({
  entryPoints: ['src/lib/contacts/document-reminders.ts'],
  write: false,
  bundle: true,
  platform: 'node',
  format: 'esm',
});
const { canRemindDocumentParticipant, reminderAction, reminderSentToday } = await import(
  `data:text/javascript;base64,${Buffer.from(reminderBuild.outputFiles[0].text).toString('base64')}`
);

test('reminders are offered only when the contact can act on the document now', () => {
  const signer = { email: 'contact@example.test', acto: 'Firmante', sub_estado: 'sin_revisar' };
  const document = { estado: 'en_proceso', fecha_vencimiento: near };
  assert.equal(canRemindDocumentParticipant(signer, document, now), true);
  assert.equal(reminderAction(signer), 'Firma pendiente');
  assert.equal(reminderAction({ role: 'aprobador' }), 'Aprobación pendiente');
  for (const change of [
    { current_access: false },
    { visible: false },
    { sub_estado: 'en_espera' },
    { sub_estado: 'firmo' },
    { status: 'approved' },
    { acto: 'Observador' },
    { delivery_mode: 'in_person' },
    { email: '' },
  ]) {
    assert.equal(canRemindDocumentParticipant({ ...signer, ...change }, document, now), false);
  }
  for (const change of [
    { estado: 'borrador' },
    { estado: 'en_espera' },
    { estado: 'completado' },
    { estado: 'cancelado' },
    { fecha_vencimiento: expired },
    { deleted_at: expired },
  ]) {
    assert.equal(canRemindDocumentParticipant(signer, { ...document, ...change }, now), false);
  }
});

test('the existing UTC reminder limit handles the start of a new day', () => {
  assert.equal(reminderSentToday('2026-11-24T00:01:00Z', now), true);
  assert.equal(reminderSentToday('2026-11-23T23:59:00Z', now), false);
  assert.equal(reminderSentToday(null, now), false);
});

test('an approval and a signature remain distinct after the document is cancelled or expires', () => {
  assert.equal(
    getContactParticipationStatus({ sub_estado: 'aprobo' }, { estado: 'en_proceso' }, now),
    'aprobo'
  );
  assert.equal(
    getContactParticipationStatus(
      { status: 'Aprobó', sub_estado: 'en_revision' },
      { estado: 'vencido' },
      now
    ),
    'aprobo'
  );
  assert.equal(
    getContactParticipationStatus(
      { sub_estado: 'firmado', current_access: false },
      { estado: 'cancelado', fecha_vencimiento: expired },
      now
    ),
    'firmo'
  );
  assert.equal(
    getContactParticipationStatus({ sub_estado: 'Rechazó' }, { estado: 'rechazado' }, now),
    'rechazo'
  );
});

test('a document outcome does not assign somebody else’s action to the contact', () => {
  assert.equal(
    getContactParticipationStatus({ sub_estado: 'en_revision' }, { estado: 'rechazado' }, now),
    'cancelo'
  );
  assert.equal(
    getContactParticipationStatus({ sub_estado: 'sin_revisar' }, { estado: 'completado' }, now),
    'sin_accion'
  );
  assert.equal(
    getContactParticipationStatus(
      { participation_status: 'REVOKED', visible: false },
      { estado: 'en_proceso' },
      now
    ),
    'revocado'
  );
});

test('deadlines affect only active participation and keep the 72-hour window', () => {
  assert.equal(
    getContactParticipationStatus(
      { sub_estado: 'en_revision' },
      { fecha_vencimiento: near, tiene_vencimiento: true },
      now
    ),
    'urgente_atencion'
  );
  assert.equal(
    getContactParticipationStatus(
      { sub_estado: 'sin_revisar' },
      { fecha_vencimiento: expired },
      now
    ),
    'participacion_vencida'
  );
  assert.equal(
    getContactParticipationStatus(
      { sub_estado: 'Sin revisión' },
      { fecha_vencimiento: expired, tiene_vencimiento: false },
      now
    ),
    'sin_revisar'
  );
  assert.equal(
    getContactParticipationStatus(
      { sub_estado: 'en_revision' },
      { fecha_vencimiento: '2026-11-27T18:01:00Z' },
      now
    ),
    'en_revision'
  );
});

test('a deferred turn and an urgent participation belong to the Pendientes filter', () => {
  assert.equal(
    getContactParticipationStatus(
      { sub_estado: 'en_revision', visible: false },
      { estado: 'en_proceso' },
      now
    ),
    'en_espera'
  );
  assert.equal(
    getContactParticipationStatus({ sub_estado: 'sin_revisar' }, { estado: 'en_espera' }, now),
    'en_espera'
  );
  for (const status of ['pendiente', 'sin_revisar', 'en_revision', 'en_espera', 'urgente_atencion'])
    assert.equal(isPendingContactParticipation(status), true);
  for (const status of [
    'firmo',
    'aprobo',
    'completado',
    'rechazo',
    'cancelo',
    'revocado',
    'participacion_vencida',
    'sin_accion',
  ])
    assert.equal(isPendingContactParticipation(status), false);
});
