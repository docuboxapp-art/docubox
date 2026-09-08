import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const datetime = await readFile(new URL('../src/lib/datetime.ts', import.meta.url), 'utf8');
const viewer = await readFile(
  new URL('../src/app/visor-documento/[id]/page.tsx', import.meta.url),
  'utf8'
);
const expirationMigration = await readFile(
  new URL('../supabase/migrations/20260908215954_document_expiration_timezone.sql', import.meta.url),
  'utf8'
);

test('timestamp formatter treats stored values as UTC and discloses local zone and offset', () => {
  assert.match(datetime, /const hasOffset =/);
  assert.match(datetime, /timeZoneName: 'shortOffset'/);
  assert.match(datetime, /\(\$\{timeZone\}\)/);
  assert.match(datetime, /UTC original: \$\{utcOriginal\}/);
});

test('viewer formats legal, cryptographic, and audit timestamps through the shared formatter', () => {
  assert.match(viewer, /formatEvidenceTimestamp\(dateStr\)/);
  assert.match(viewer, /formatEvidenceTimestamp\(\s*nom151Data\.issued_at/);
  assert.match(viewer, /formatEvidenceTimestamp\(\s*blockchainEvidence\.submitted_at/);
  assert.match(viewer, /formatEvidenceTimestamp\(xmlEvidenceData\.xml_generated_at\)/);
});

test('expiration retains both a UTC instant and the creator-selected IANA timezone', () => {
  assert.match(datetime, /zonedDateTimeToUtcIso/);
  assert.match(datetime, /getTimeZoneOffsetLabel/);
  assert.match(expirationMigration, /fecha_vencimiento_timezone TEXT/);
  assert.match(viewer, /Definido por el creador en/);
});
