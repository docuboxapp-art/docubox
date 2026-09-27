import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  orderDocumentActivity,
  removeDuplicateSynthesizedActivity,
} from '../src/lib/documents/activity-timeline.ts';

test('activity follows recorded UTC time and resolves simultaneous lifecycle events', () => {
  const timestamp = '2026-09-23T21:54:08.056Z';
  const ordered = orderDocumentActivity([
    { id: 'assigned', action: 'participante_asignado', created_at: timestamp },
    { id: 'viewed', action: 'documento_visto', created_at: '2026-09-23T22:00:00Z' },
    { id: 'created', action: 'documento_creado', created_at: timestamp },
  ]);
  assert.deepEqual(ordered.map((event) => event.id), ['created', 'assigned', 'viewed']);

  const finished = orderDocumentActivity([
    { id: 'complete', action: 'documento_completado', created_at: timestamp },
    { id: 'signed', action: 'firma_completada', created_at: timestamp },
  ]);
  assert.deepEqual(finished.map((event) => event.id), ['signed', 'complete']);
});

test('repeated real events stay visible; only matching inferred duplicates are removed', () => {
  const events = removeDuplicateSynthesizedActivity([
    { id: 'view-1', source: 'security_log', action: 'documento_visto', actor_email: 'a@example.com', created_at: '2026-09-23T22:00:01Z' },
    { id: 'view-2', source: 'security_log', action: 'documento_visto', actor_email: 'a@example.com', created_at: '2026-09-23T22:00:20Z' },
    { id: 'signed', source: 'security_log', action: 'firma_completada', actor_email: 'a@example.com', created_at: '2026-09-23T22:01:00Z' },
    { id: 'inferred-signed', source: 'synthesized', action: 'firma_completada', actor_email: 'a@example.com', created_at: '2026-09-23T22:01:01Z' },
  ]);
  assert.deepEqual(events.map((event) => event.id), ['view-1', 'view-2', 'signed']);
});

test('activity API uses the actual audit columns and avoids inferred update timestamps', async () => {
  const route = await readFile('src/app/api/documentos/[documentId]/activity/route.ts', 'utf8');
  assert.match(route, /id,event_type,event_data,metadata,created_at/);
  assert.doesNotMatch(route, /action_code|action_at|document\.updated_at/);
  assert.match(route, /document\.cancelado_at/);
  assert.match(route, /participant\.fecha_rechazo/);
});

test('common technical activity codes have understandable Spanish labels', async () => {
  const viewer = await readFile('src/app/visor-documento/[id]/page.tsx', 'utf8');
  for (const action of [
    'DOCUMENT_INTERNAL_IMPORT',
    'pdf_firmado_generado',
    'pades_bt_verified',
    'evidence_finalization_enqueued',
    'nom151_requested',
    'nom151_verified',
    'certification_completed',
  ]) {
    assert.match(viewer, new RegExp(`${action}: '[^']+'`));
  }
  assert.match(viewer, /const base = map\[action\] \|\| 'Evento registrado'/);
});
