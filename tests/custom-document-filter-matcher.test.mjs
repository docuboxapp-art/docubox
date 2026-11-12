import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: ['src/app/mis-documentos/components/custom-filter-matcher.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { matchesCustomDocumentCriteria: matches } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);

const now = new Date('2026-10-14T12:00:00Z');
const identity = { id: 'owner-1', email: 'yo@example.com' };
const document = {
  estado: 'En progreso',
  etiquetas: ['Legal'],
  ultimaModificacion: '13/10/2026 09:00 a.m.',
  fechaCreacion: '12/10/2026',
  fechaCompletado: null,
  fechaVencimiento: '2026-10-15T12:00:00Z',
  tipoDocumentoId: 'type-1',
  ownerId: 'owner-1',
  participantes: [{ email: 'firma@example.com', id: 'participant-1' }],
  miSubEstado: 'en_revision',
  sourceTemplateId: 'template-1',
  sourceFormResponseId: null,
  esUrgente: true,
};

test('combines origin, status, priority, type, tag, owner and participant criteria', () => {
  const filters = {
    origen: 'plantilla',
    estado: 'En progreso',
    prioridad: 'urgente',
    tipoDocumento: ['type-1'],
    etiquetas: ['Legal'],
    propietario: 'mios',
    participantes: ['firma@example.com'],
  };
  assert.equal(matches(document, filters, identity, now), true);
  assert.equal(matches(document, { ...filters, origen: 'formulario' }, identity, now), false);
  assert.equal(matches(document, { ...filters, etiquetas: ['Fiscal'] }, identity, now), false);
  assert.equal(matches(document, { ...filters, participantes: ['otra@example.com'] }, identity, now), false);
});

test('matches displayed dates and the legacy modification key', () => {
  assert.equal(matches(document, { ultimaModificacion: 'week', fechaCreacion: 'week' }, identity, now), true);
  assert.equal(matches(document, { fechaUltimaModificacion: 'today' }, identity, now), false);
  assert.equal(matches(document, { fechaCompletado: 'sin_completado' }, identity, now), true);
  assert.equal(matches(document, { fechaCompletado: 'week' }, identity, now), false);
});

test('handles expiry and participation states', () => {
  assert.equal(matches(document, { fechaVencimiento: 'proximos', estadoParticipacion: 'en_revision' }, identity, now), true);
  assert.equal(matches(document, { estadoParticipacion: 'urgente_atencion' }, identity, now), true);
  assert.equal(matches(document, { estadoParticipacion: 'ninguna' }, identity, now), false);
  assert.equal(matches(document, { estado: 'Vencido' }, identity, now), false);
  const expired = { ...document, fechaVencimiento: '2026-10-13T12:00:00Z' };
  assert.equal(matches(expired, { estado: 'Vencido', estadoParticipacion: 'participacion_vencida' }, identity, now), true);
});

test('filters participation states in owned documents without including the owner or received documents', () => {
  const owned = {
    ...document,
    fechaVencimiento: '2026-10-20T12:00:00Z',
    participantes: [
      { user_id: 'owner-1', email: 'yo@example.com', sub_estado: 'firmo' },
      { user_id: 'participant-1', email: 'firma@example.com', sub_estado: 'firmado' },
    ],
  };
  assert.equal(matches(owned, { estadoParticipantes: 'firmo' }, identity, now), true);
  assert.equal(matches(owned, { estadoParticipantes: 'en_revision' }, identity, now), false);
  assert.equal(matches({ ...owned, ownerId: 'other-owner' }, { estadoParticipantes: 'firmo' }, identity, now), false);
  assert.equal(matches({ ...owned, participantes: [owned.participantes[0]] }, { estadoParticipantes: 'sin_participantes' }, identity, now), true);

  const expiring = { ...owned, fechaVencimiento: '2026-10-15T12:00:00Z' };
  assert.equal(matches(expiring, { estadoParticipantes: 'urgente_atencion' }, identity, now), true);
  assert.equal(matches(expiring, { estadoParticipantes: 'firmo' }, identity, now), false);
  const expired = { ...owned, fechaVencimiento: '2026-10-13T12:00:00Z' };
  assert.equal(matches(expired, { estadoParticipantes: 'participacion_vencida' }, identity, now), true);
});

test('separates folder and document custom views', () => {
  assert.equal(matches(document, { estructura: 'archivo' }, identity, now), true);
  assert.equal(matches(document, { estructura: 'carpeta' }, identity, now), false);
});
