import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function loadTypeScript(path, requireModule = () => { throw new Error('Unexpected import'); }) {
  const source = readFileSync(path, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', compiled)(requireModule, exports);
  return exports;
}

const { participantProfileValues, initialParticipantFormValues } = loadTypeScript('src/lib/forms/participant-profile-prefill.ts');

test('documentary fields use the assigned participant profile, independent of edited labels', () => {
  const fields = [
    { id: 'r', type: 'rfc', label: 'RFC del participante' },
    { id: 'c', type: 'curp', label: 'Clave única' },
    { id: 'n', type: 'person_first_name', label: 'Nombre legal' },
    { id: 'p', type: 'person_last_name', label: 'Primer apellido' },
    { id: 'm', type: 'person_second_last_name', label: 'Segundo apellido' },
    { id: 'b', type: 'business_name', label: 'Nombre o denominación social' },
    { id: 'a', type: 'fiscal_address', label: 'Domicilio' },
    { id: 'image', type: 'imagen', label: 'Carga de imagen' },
  ];
  const values = participantProfileValues(fields, {
    nombre: 'Ana', apellido_paterno: 'García', apellido_materno: 'López',
    rfc: ' GAL900101ABC ', curp: ' GAL900101MCHRRN09 ',
    calle: 'Juárez', num_exterior: '12', colonia: 'Centro', municipio: 'Chihuahua', estado: 'Chihuahua',
  });
  assert.equal(values.r, 'GAL900101ABC');
  assert.equal(values.c, 'GAL900101MCHRRN09');
  assert.equal(values.n, 'Ana');
  assert.equal(values.p, 'García');
  assert.equal(values.m, 'López');
  assert.equal(values.b, 'Ana García López');
  assert.deepEqual(values.a, {
    street: 'Juárez', exteriorNumber: '12', interiorNumber: '', neighborhood: 'Centro', city: 'Chihuahua', state: 'Chihuahua',
  });
  assert.equal('image' in values, false);
});

test('missing profile data does not retain template defaults for personal fields', () => {
  const fields = [
    { id: 'r', type: 'rfc', defaultValue: 'RFC-DEL-CREADOR' },
    { id: 'b', type: 'business_name', defaultValue: 'Nombre del creador' },
    { id: 'plain', type: 'text', defaultValue: 'Texto fijo' },
  ];
  const initial = initialParticipantFormValues(fields, null);
  assert.equal(initial.r, '');
  assert.equal(initial.b, '');
  assert.equal(initial.plain, 'Texto fijo');
  assert.equal(initialParticipantFormValues(fields, { rfc: 'RFC-PERFIL' }, { r: 'RFC-CORREGIDO' }).r, 'RFC-CORREGIDO');
  assert.equal(participantProfileValues(fields, { personalidad_juridica: 'moral', full_name: 'Representante' }).b, '');
});

test('launcher suggestions fill empty profile fields but never replace participant profile or saved answers', () => {
  const fields = [
    { id: 'r', type: 'rfc', defaultValue: 'RFC-DEL-CREADOR' },
    { id: 'n', type: 'person_first_name' },
    { id: 'p', type: 'person_last_name' },
  ];
  const prefill = { rfc: 'RFC-INVITACION', nombre: 'Nombre invitado', apellido_paterno: 'Apellido invitado' };
  const initial = initialParticipantFormValues(fields, { nombre: 'Nombre perfil', rfc: '' }, {}, prefill);
  assert.equal(initial.r, 'RFC-INVITACION');
  assert.equal(initial.n, 'Nombre perfil');
  assert.equal(initial.p, 'Apellido invitado');
  assert.equal(initialParticipantFormValues(fields, { rfc: 'RFC-PERFIL' }, { r: 'RFC-RESPUESTA' }, prefill).r, 'RFC-RESPUESTA');
});

test('schema endpoint fetches only the authenticated recipient profile after token authorization', async () => {
  let handler;
  const queried = [];
  const profile = { nombre: 'Ana', rfc: 'GAL900101ABC' };
  const tokenRow = {
    recipient_email: 'ana@example.com', recipient_user_id: 'recipient-id',
    access_mode: 'private', used_at: null, expires_at: null,
    form_templates: { id: 'template-id', name: 'Formulario', status: 'published', schema: [{ id: 'r', type: 'rfc' }], settings: {}, workspaces: { name: 'Espacio' } },
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'recipient-id', email: 'ana@example.com', email_confirmed_at: '2026-10-09' } }, error: null }) },
    from(table) {
      const query = { table, id: null };
      queried.push(query);
      const builder = {
        select: () => builder,
        eq: (_key, id) => { query.id = id; return builder; },
        single: async () => ({ data: tokenRow, error: null }),
        maybeSingle: async () => ({ data: profile, error: null }),
      };
      return builder;
    },
  };
  loadTypeScript('supabase/functions/get-form-schema/index.ts', (name) => {
    if (name.includes('deno.land/std')) return { serve: (callback) => { handler = callback; } };
    if (name.includes('@supabase/supabase-js')) return { createClient: () => client };
    throw new Error(`Unexpected import: ${name}`);
  });
  const request = new Request('https://example.test/get-form-schema?token=private-token', { headers: { Authorization: 'Bearer account-token' } });
  const response = await handler(request);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).participantProfile, profile);
  assert.deepEqual(queried.map(({ table }) => table), ['form_tokens', 'user_profiles']);
  assert.equal(queried[1].id, 'recipient-id');

  tokenRow.recipient_email = 'other@example.com';
  queried.length = 0;
  const forbidden = await handler(request);
  assert.equal(forbidden.status, 403);
  assert.deepEqual(queried.map(({ table }) => table), ['form_tokens']);
});
