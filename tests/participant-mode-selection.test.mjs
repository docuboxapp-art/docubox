import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { build } from 'esbuild';

const outputDirectory = 'node_modules/.cache/docubox-participant-mode-tests';
const outputFile = `${outputDirectory}/participant-mode.mjs`;

await mkdir(outputDirectory, { recursive: true });
await build({
  entryPoints: ['src/app/crear-documento/components/participant-mode.ts'],
  outfile: outputFile,
  bundle: true,
  format: 'esm',
  platform: 'node',
});

const { reconcileParticipantsForMode } = await import(`../${outputFile}?t=${Date.now()}`);
const stepSource = await readFile(
  'src/app/crear-documento/components/StepParticipantes.tsx',
  'utf8'
);
const pageSource = await readFile('src/app/crear-documento/page.tsx', 'utf8');

const identity = {
  id: 'owner-1',
  name: 'LUIS HERNANDEZ',
  email: 'luis@example.com',
};

test('Solo yo always restores the authenticated creator', () => {
  assert.deepEqual(reconcileParticipantsForMode([], 'solo_yo', identity), [
    {
      id: 'current-user',
      name: 'LUIS HERNANDEZ (Tú)',
      email: 'luis@example.com',
      role: 'firmante',
    },
  ]);
});

test('Solo yo preserves the creator participation configuration', () => {
  const result = reconcileParticipantsForMode(
    [
      {
        id: 'current-user',
        name: 'Temporal (Tú)',
        email: '',
        role: 'firmante',
        configured: true,
        acto: 'Firmante',
        tipoFirma: ['autografa'],
      },
      { id: 'other-1', name: 'ANA', email: 'ana@example.com', role: 'firmante' },
    ],
    'solo_yo',
    identity
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].configured, true);
  assert.deepEqual(result[0].tipoFirma, ['autografa']);
  assert.equal(result[0].name, 'LUIS HERNANDEZ (Tú)');
  assert.equal(result[0].email, 'luis@example.com');
});

test('a delayed profile response cannot erase a newer participant list', () => {
  const latest = [
    {
      id: 'current-user',
      name: '(Tú)',
      email: '',
      role: 'firmante',
      configured: true,
    },
  ];

  const reconciled = reconcileParticipantsForMode(latest, 'solo_yo', identity);
  assert.equal(reconciled[0].configured, true);
  assert.equal(reconciled[0].email, 'luis@example.com');
});

test('Yo y otros keeps existing invitees and adds the creator only once', () => {
  const invitee = { id: 'other-1', name: 'ANA', email: 'ana@example.com', role: 'firmante' };
  const first = reconcileParticipantsForMode([invitee], 'yo_y_otros', identity);
  const second = reconcileParticipantsForMode(first, 'yo_y_otros', identity);

  assert.equal(second.length, 2);
  assert.equal(second.filter((participant) => participant.id === 'current-user').length, 1);
  assert.equal(second[1].id, invitee.id);
});

test('Solo otros removes only the authenticated creator', () => {
  const result = reconcileParticipantsForMode(
    [
      { id: 'owner-1', name: 'LUIS', email: 'luis@example.com', role: 'firmante' },
      { id: 'other-1', name: 'ANA', email: 'ana@example.com', role: 'firmante' },
    ],
    'solo_otros',
    identity
  );

  assert.deepEqual(
    result.map((participant) => participant.id),
    ['other-1']
  );
});

test('the participant step reconciles against the latest parent state', () => {
  assert.match(stepSource, /onChange\(\(currentParticipants\) =>/);
  assert.match(stepSource, /reconcileParticipantsForMode\(currentParticipants, modeRef\.current/);
});

test('the participant step receives the authenticated identity immediately', () => {
  assert.match(pageSource, /currentUser=\{\{/);
  assert.match(pageSource, /id: user\?\.id/);
  assert.match(pageSource, /email: user\?\.email/);
});
