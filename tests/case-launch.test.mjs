import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const bundle = await build({
  stdin: { contents: "export * from './src/lib/case-files/launch';", resolveDir: process.cwd() },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const {
  normalizeLaunchParticipants: normalize,
  eligibleLaunchMembers: eligible,
  launchResponsibilities: responsibilities,
  validateLaunchStep: validate,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
const ids = Array.from({ length: 4 }, (_, i) => `11111111-1111-4111-8111-11111111111${i}`);
const subject = { id: 'primary', name: 'Titular QA', email: 'primary@example.invalid' };
const person = { name: 'Persona QA', email: 'other@example.invalid', role: 'contact' };
function fixture() {
  return {
    actorId: ids[0],
    members: [
      { id: ids[0], name: 'Creador', role: 'member' },
      { id: ids[1], name: 'Admin', role: 'admin' },
      { id: ids[2], name: 'Propietario espacio', role: 'owner' },
      { id: ids[3], name: 'Miembro', role: 'member' },
    ],
    items: [
      {
        id: 'item',
        title: 'Acta',
        kind: 'requested_document',
        requiresReview: true,
        reviewerRole: 'member',
      },
    ],
    separationOfDuties: false,
    policy: {
      approval: { enabled: true, role: 'admin' },
      completion: { mode: 'manual', role: 'owner' },
    },
  };
}
test('owner policy refers to case owner, not workspace owner', () => {
  const data = fixture();
  assert.deepEqual(
    eligible(data, { key: 'closer', role: 'owner' }, {}).map((m) => m.id),
    [ids[0]]
  );
});
test('admin policy offers only active options with admin/owner roles', () => {
  const data = fixture();
  assert.deepEqual(
    eligible(data, { key: 'approver', role: 'admin' }, {}).map((m) => m.id),
    [ids[1], ids[2]]
  );
});
test('unknown role fails closed', () => {
  assert.equal(eligible(fixture(), { key: 'closer', role: null }, {}).length, 0);
});
test('separation excludes principal and assigned reviewers from approval', () => {
  const data = fixture();
  data.separationOfDuties = true;
  data.policy.approval.role = 'member';
  assert.deepEqual(
    eligible(data, { key: 'approver', role: 'member' }, { item: ids[1] }).map((m) => m.id),
    [ids[2], ids[3]]
  );
});
test('only configured operations create responsibility rows', () => {
  const data = fixture();
  assert.deepEqual(
    responsibilities(data).map((r) => r.key),
    ['item', 'approver', 'closer']
  );
  data.items[0].requiresReview = false;
  data.policy.approval.enabled = false;
  data.policy.completion.mode = 'automatic';
  assert.deepEqual(responsibilities(data), []);
});
test('first step requires title and primary person without prematurely requiring reviewers', () => {
  const data = fixture();
  assert.match(validate(1, data, '', subject, [], {}), /nombre/);
  assert.match(validate(1, data, 'QA', null, [], {}), /titular/);
  assert.equal(validate(1, data, 'QA', subject, [], {}), '');
});
test('confirmation checks all reviewer, approval and closure assignments', () => {
  const data = fixture();
  const selected = { item: ids[3], approver: ids[1], closer: ids[0] };
  assert.equal(validate(3, data, 'QA', subject, [], selected), '');
  assert.match(validate(2, data, 'QA', subject, [], { ...selected, closer: ids[2] }), /Cierre/);
  assert.match(
    validate(3, data, 'QA', subject, [], { ...selected, approver: ids[3] }),
    /Aprobación/
  );
});
test('normalizes whitespace and email case while dropping untrusted identifiers', () => {
  const result = normalize(
    [
      {
        ...person,
        email: ' OTHER@example.invalid ',
        name: ' Persona QA ',
        id: 'spoof',
        workspaceId: 'spoof',
        permissions: ['admin'],
      },
    ],
    subject
  );
  assert.deepEqual(result, [
    {
      id: 'other@example.invalid',
      name: 'Persona QA',
      email: 'other@example.invalid',
      role: 'contact',
    },
  ]);
});
test('duplicate email cannot be reused as another role or primary', () => {
  assert.throws(
    () =>
      normalize(
        [person, { ...person, email: 'OTHER@EXAMPLE.INVALID', role: 'representative' }],
        subject
      ),
    /duplicados/
  );
  assert.throws(
    () => normalize([{ ...person, email: 'PRIMARY@example.invalid' }], subject),
    /duplicados/
  );
});
test('duplicate linked member cannot be disguised with a different email', () => {
  assert.throws(
    () => normalize([{ ...person, userId: ids[0] }], { ...subject, userId: ids[0] }),
    /duplicados/
  );
});
test('external participant cannot be promoted to reviewer via role payload', () => {
  assert.throws(() => normalize([{ ...person, role: 'admin' }], subject), /rol/);
  assert.throws(() => normalize([{ ...person, userId: 'invalid' }], subject), /cuenta/);
});
test('rejects bad emails, excessive lists and non-array payloads', () => {
  assert.throws(() => normalize([{ ...person, email: 'not-an-email' }], subject), /correo/);
  assert.throws(
    () =>
      normalize(
        Array.from({ length: 21 }, () => person),
        subject
      ),
    /20/
  );
  assert.throws(() => normalize({}, subject), /20/);
});
test('member without supplied email can use trusted account email on server', () => {
  assert.equal(normalize([{ ...person, email: '', userId: ids[1] }], subject)[0].userId, ids[1]);
});
