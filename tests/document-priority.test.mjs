import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { transformSync } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function loadPriorityModule() {
  const source = read('src/lib/documents/priority.ts');
  const output = transformSync(source, { loader: 'ts', format: 'cjs', target: 'node20' }).code;
  const module = { exports: {} };
  new Function('module', 'exports', output)(module, module.exports);
  return module.exports;
}

test('priority remains independent from expiration', () => {
  const { normalizeDocumentPriority, operationalPriorityRank } = loadPriorityModule();
  assert.equal(normalizeDocumentPriority('urgent'), 'urgent');
  assert.equal(normalizeDocumentPriority(undefined, true), 'urgent');
  assert.equal(normalizeDocumentPriority('unexpected'), 'normal');
  assert.equal(operationalPriorityRank({ priority: 'urgent', expiresAt: null }), 1);
  assert.equal(operationalPriorityRank({ priority: 'normal', expiresAt: null }), 3);
});

test('schema stores canonical priority without an urgency deadline', () => {
  const migration = read('supabase/migrations/20260903192225_document_priority.sql');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal'/);
  assert.match(migration, /priority IN \('normal', 'high', 'urgent'\)/);
  assert.match(migration, /SET priority = 'urgent'[\s\S]*es_urgente = true/);
  assert.doesNotMatch(migration, /urgent_(due|expiration|deadline)/i);
  assert.doesNotMatch(migration, /expires_at/i);
});

test('priority changes are owner/admin protected and audited', () => {
  const route = read('src/app/api/documentos/[documentId]/priority/route.ts');
  assert.match(route, /requireDocumentAccess\(request, documentId, \{ ownerOrAdminOnly: true \}\)/);
  assert.match(route, /DOCUMENT_PRIORITY_CHANGED/);
  assert.match(route, /document_lifecycle_audit_events/);
  assert.match(route, /document.priority.changed/);
  assert.doesNotMatch(route, /fecha_vencimiento:\s*/);
});

test('final submission persists priority and marks participant notifications', () => {
  const sendRoute = read('src/app/api/documentos/enviar/route.ts');
  const sendStep = read('src/app/crear-documento/components/StepEnviar.tsx');
  assert.match(sendStep, /urgente: effectiveSecurity\?\.urgente \?\? false/);
  assert.match(sendRoute, /priority: urgente === true \? 'urgent' : 'normal'/);
  assert.match(sendRoute, /es_urgente: urgente === true/);
  assert.match(sendRoute, /Documento urgente: se requiere tu participación/);
});
