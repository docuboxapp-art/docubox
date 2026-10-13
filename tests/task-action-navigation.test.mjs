import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
await build({
  entryPoints: ['src/lib/tasks/action-navigation.ts'],
  outfile: 'node_modules/.cache/task-action-navigation-test.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
});
const { formInvitationPath, formResponsePath } = require('../node_modules/.cache/task-action-navigation-test.cjs');

test('an invitation opens the participant flow only for the invited account', () => {
  assert.equal(formInvitationPath('form-1', 'Invitado+Uno@ejemplo.mx', 'invitado+uno@ejemplo.mx'),
    '/formulario-publico/form-1?email=Invitado%2BUno%40ejemplo.mx');
  assert.equal(formInvitationPath('form-1', 'invitado@ejemplo.mx', 'otro@ejemplo.mx'), null);
  assert.equal(formInvitationPath('form-1', null, 'otro@ejemplo.mx'), null);
});

test('a response action opens the exact captured response', () => {
  assert.equal(formResponsePath('form-1', 'response-2'),
    '/formularios/respuestas?id=form-1&respuesta=response-2');
});
