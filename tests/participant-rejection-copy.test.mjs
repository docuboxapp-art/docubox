import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [viewerSource, statusConfigSource] = await Promise.all([
  readFile(new URL('../src/app/visor-documento/[id]/page.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/documentStatusConfig.ts', import.meta.url), 'utf8'),
]);

test('participant rejection uses an action label while document rejection remains a state', () => {
  assert.match(
    viewerSource,
    /rechazo:\s*\{\s*label: 'Rechazó',[\s\S]*?rechazado:\s*\{\s*label: 'Rechazó',/
  );
  assert.match(
    statusConfigSource,
    /DOCUMENT_STATUSES[\s\S]*?key: 'rechazado',\s*label: 'Rechazado'/
  );
  assert.match(
    statusConfigSource,
    /PARTICIPATION_STATUSES[\s\S]*?key: 'rechazo',\s*label: 'Rechazó'/
  );
});
