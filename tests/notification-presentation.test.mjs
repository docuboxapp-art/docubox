import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: ['src/lib/notifications/presentation.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { notificationArea, notificationDestination, isRetiredNotification } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);

test('classifies active product notifications by event before legacy type', () => {
  assert.equal(notificationArea({ type: 'info', event_type: 'form.response.submitted' }), 'formularios');
  assert.equal(notificationArea({ type: 'info', event_type: 'case_file.requirement.submitted' }), 'expedientes');
  assert.equal(notificationArea({ type: 'request', category: 'ORGANIZATION' }), 'organizacion');
  assert.equal(notificationArea({ type: 'task', metadata: { documentoId: 'doc' } }), 'solicitudes');
});

test('hides retired task notifications while preserving historical document participation', () => {
  assert.equal(isRetiredNotification({ event_type: 'task.assigned' }), true);
  assert.equal(isRetiredNotification({ type: 'task', action_url: '/mis-tareas?task=1' }), true);
  assert.equal(isRetiredNotification({ type: 'task', metadata: { documentoId: 'doc' } }), false);
});

test('routes notifications to existing destinations', () => {
  assert.equal(notificationDestination({ event_type: 'form.response.submitted' }), '/formularios');
  assert.equal(notificationDestination({ event_type: 'case_file.created' }), '/expedientes');
  assert.equal(notificationDestination({ type: 'request' }), '/mis-participaciones');
  assert.equal(notificationDestination({ entity_type: 'document', entity_id: '11111111-1111-4111-8111-111111111111' }), '/visor-documento/11111111-1111-4111-8111-111111111111');
  assert.equal(notificationDestination({ type: 'document', action_url: '/mis-tareas?task=1' }), '/mi-espacio');
});
