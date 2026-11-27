import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

async function importModule(path) {
  const { outputFiles } = await build({
    entryPoints: [path],
    write: false,
    bundle: true,
    platform: 'node',
    format: 'esm',
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
  );
}

const [
  { summarizeContactDocuments },
  { normalizeContactColumnWidths, normalizeContactView, saveContactColumnWidths },
] = await Promise.all([
  importModule('src/lib/contacts/agenda.ts'),
  importModule('src/lib/contacts/view-preferences.ts'),
]);

test('resizing saves only contact widths and filters out invalid or fixed columns', async () => {
  const widths = normalizeContactColumnWidths({
    contacto: 100,
    datos: 226.4,
    actividad: 1000,
    documentos: '120',
    seguimiento: Infinity,
    acciones: 150,
  });
  assert.deepEqual(widths, { contacto: 144, datos: 226, actividad: 720 });

  const client = {
    from(table) {
      assert.equal(table, 'user_view_preferences');
      return {
        upsert(row, options) {
          assert.deepEqual(row, {
            user_id: 'contact-owner',
            view_key: 'mis_contactos',
            column_widths_config: widths,
          });
          assert.equal(options.onConflict, 'user_id,view_key');
          return { error: null };
        },
      };
    },
  };
  await saveContactColumnWidths(client, 'contact-owner', widths);
});
const now = Date.parse('2026-11-24T18:00:00Z');
const near = '2026-11-27T18:00:00Z';
const later = '2026-11-27T18:00:00.001Z';
const recent = '2026-11-23T18:00:00Z';
const email = 'contact@example.test';
const signer = { email, acto: 'Firmante', sub_estado: 'pendiente' };
const document = {
  id: 'document',
  nombre: 'Documento de prueba',
  estado: 'en_proceso',
  created_at: recent,
  participantes: [signer],
};

test('the follow-up thresholds use the contact’s actionable participation', () => {
  const cases = [
    [{ fecha_vencimiento: near }, 'urgent', 1, 1],
    [{ fecha_vencimiento: later }, 'active', 1, 0],
    [{ fecha_vencimiento: near, tiene_vencimiento: false }, 'active', 1, 0],
    [{ fecha_vencimiento: recent }, null, 0, 0],
    [{ priority: 'urgent' }, 'urgent', 1, 0],
    [{ es_urgente: true }, 'urgent', 1, 0],
    [{ estado: 'en_espera', fecha_vencimiento: near, priority: 'urgent' }, 'active', 1, 0],
    [{ estado: 'completado', priority: 'urgent' }, null, 0, 0],
    [{ participantes: [{ ...signer, acto: 'Observador' }], fecha_vencimiento: near }, null, 0, 0],
    [
      { participantes: [{ ...signer, current_access: false }], fecha_vencimiento: near },
      null,
      0,
      0,
    ],
  ];
  for (const [change, followUp, pending, dueSoon] of cases) {
    const result = summarizeContactDocuments([{ ...document, ...change }], now).get(email);
    assert.deepEqual(
      [result.followUp, result.pending, result.dueSoon],
      [followUp, pending, dueSoon]
    );
  }
});

test('recent rejections stay with the right recipient and documents count once per contact', () => {
  const other = { email: 'other@example.test', sub_estado: 'rechazo', fecha_rechazo: recent };
  const result = summarizeContactDocuments(
    [
      { ...document, estado: 'rechazado', participantes: [signer, other] },
      {
        ...document,
        id: 'duplicate-role',
        estado: 'en_espera',
        participantes: [signer, { ...signer, email: ` ${email.toUpperCase()} ` }],
      },
      {
        ...document,
        id: 'past-rejection',
        estado: 'rechazado',
        participantes: [{ ...other, email, fecha_rechazo: '2026-11-10T18:00:00Z' }],
      },
      { ...document, id: 'draft', estado: 'borrador' },
      { ...document, id: 'deleted', deleted_at: recent },
      { ...document, id: 'invalid', participantes: {} },
    ],
    now
  );
  assert.equal(result.get(email).documents.length, 3);
  assert.equal(result.get(email).pending, 1);
  assert.equal(
    result.get(email).documents.some((item) => item.recentRejection),
    false
  );
  assert.equal(result.get(other.email).lastInteraction.label, 'Documento rechazado');
  assert.equal(result.get(other.email).followUp, 'active');
});

test('contact personalization restores order and whitelisted display settings', () => {
  const preferences = normalizeContactView({
    columns: [
      { id: 'rfc', visible: true, label: 'Untrusted label' },
      { id: 'datos', visible: false },
      { id: 'rfc', visible: false },
      { id: 'acciones', visible: false },
    ],
    filters: [
      { id: 'seguimiento', visible: true },
      { id: 'grupo', visible: false },
    ],
    gridColumns: ['rfc', 'alta', 'tipo', 'pendientes', 'vencimiento', 'correo'].map((id) => ({
      id,
      selected: true,
    })),
  });
  assert.deepEqual(preferences.columns[0], { id: 'rfc', label: 'RFC', visible: true });
  assert.deepEqual(preferences.columns[1], {
    id: 'datos',
    label: 'Datos de contacto',
    visible: false,
  });
  assert.equal(
    preferences.columns.some(({ id }) => id === 'acciones'),
    false
  );
  assert.deepEqual(
    preferences.filters.slice(0, 2).map(({ id, visible }) => [id, visible]),
    [
      ['seguimiento', true],
      ['grupo', false],
    ]
  );
  assert.deepEqual(
    preferences.gridColumns.filter(({ selected }) => selected).map(({ id }) => id),
    ['rfc', 'alta', 'tipo', 'pendientes', 'vencimiento']
  );
});
