import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
await build({
  entryPoints: ['src/lib/tasks/completion-policy.ts'],
  outfile: 'node_modules/.cache/task-completion-policy-test.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
});
const { completionMode, completionAttestationIsValid } = require('../node_modules/.cache/task-completion-policy-test.cjs');

test('objective outcomes need a matching resource, including NOM-151', () => {
  for (const [type, source] of [
    ['firmar_documento', 'document'], ['validar_identidad', 'user'],
    ['cerrar_expediente', 'case_file'], ['obtener_nom151', 'document'],
    ['responder_formulario', 'form_token'], ['subir_anexo', 'participant_requirement'],
    ['retomar_borrador', 'document'],
  ]) assert.equal(completionMode(type, source), 'verified');
});

test('unsupported resource combinations and human reviews require an attestation', () => {
  for (const [type, source] of [
    ['validar_identidad', 'document'], ['subir_anexo', 'document'],
    ['revisar_documento', 'document'], ['aprobar_documento', 'form_response'],
    ['corregir_datos', 'document'], ['resolver_comentario', 'task'],
    ['unknown_future_type', 'document'],
  ]) assert.equal(completionMode(type, source), 'attested');
  assert.equal(completionAttestationIsValid(undefined), false);
  assert.equal(completionAttestationIsValid('Hecho'), false);
  assert.equal(completionAttestationIsValid('Revisé el recurso vinculado y dejé los cambios solicitados.'), true);
});
