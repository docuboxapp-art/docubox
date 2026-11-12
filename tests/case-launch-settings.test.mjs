import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const built = await build({
  stdin: {
    contents:
      "export * from './src/lib/case-files/launch-settings';export * from './src/lib/case-files/delivery';export * from './src/lib/case-files/invitations';export * from './src/lib/case-files/entry-cookie';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const {
  normalizeCaseLaunchSettings: normalize,
  defaultCaseLaunchSettings: defaults,
  dispatchCaseMail,
  encryptInvitationSecret,
  summarizeInvitations,
  signEntryGrant,
  verifyEntryGrant,
} = await import(
  `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`
);
test('browser grants reject tampering, cross-invitation reuse, wrong purpose and expiry', () => {
  const secret = 'test-only-secret-with-enough-entropy',
    scope = 'invitation-a',
    hash = 'a'.repeat(64),
    expires = Date.now() + 30000;
  const cookie = signEntryGrant(secret, scope, hash, expires);
  assert.equal(verifyEntryGrant(secret, scope, cookie), hash);
  for (const [key, where, value, now] of [
    [secret, 'invitation-b', cookie],
    [secret, `authorized:${scope}`, cookie],
    [secret + 'other', scope, cookie],
    [secret, scope, cookie + 'extra'],
    [secret, scope, cookie + '.extra'],
    [secret, scope, cookie, expires],
  ])
    assert.equal(verifyEntryGrant(key, where, value, now), null);
});
test('public launches require liveness and prefill strips unsupported properties', () => {
  const v = normalize({
    ...defaults,
    accessMode: 'public',
    requireLiveness: false,
    subjectPrefill: { nombre: ' Ana ', access_token: 'forbidden', rfc: 42 },
  });
  assert.equal(v.requireLiveness, true);
  assert.equal(v.subjectPrefill.nombre, 'Ana');
  assert.equal(v.subjectPrefill.rfc, '');
  assert.equal('access_token' in v.subjectPrefill, false);
  assert.equal(normalize({ ...defaults, requireLiveness: false }).requireLiveness, false);
});
test('scheduled launches reject invalid, past and overly distant instants', () => {
  const now = Date.parse('2026-11-10T12:00:00Z');
  for (const scheduledAt of ['bad', '2026-11-10T12:00:30Z', '2027-11-11T12:00:00Z'])
    assert.throws(() => normalize({ ...defaults, scheduledAt }, now));
  assert.equal(
    normalize({ ...defaults, scheduledAt: '2026-11-10T06:05:00-07:00' }, now).scheduledAt,
    '2026-11-10T13:05:00.000Z'
  );
});
test('signature, timezone and expiry choices validate without permissive fallbacks', () => {
  for (const patch of [
    { signatureType: 'unknown' },
    { timezone: 'unknown' },
    { expirationHours: NaN },
    { expirationHours: 0 },
    { expirationHours: 721 },
    { requireLiveness: 'true' },
  ])
    assert.throws(() => normalize({ ...defaults, ...patch }));
  assert.equal(normalize({ ...defaults, expirationHours: 1 / 60 }).expirationHours, 1 / 60);
});
test('a sent link does not count as delivered until its separate code is accepted', () => {
  const row = {
    id: '1',
    name: 'QA',
    email: 'qa@example.invalid',
    role: 'subject',
    status: 'retrying',
    sentAt: '2026-11-10T00:00:00Z',
    expiresAt: '2026-11-11T00:00:00Z',
    codeRequired: true,
    codeSentAt: null,
  };
  assert.equal(summarizeInvitations([row]).sent, 0);
  assert.equal(summarizeInvitations([{ ...row, status: 'sent', codeSentAt: row.sentAt }]).sent, 1);
  assert.equal(summarizeInvitations([{ ...row, status: 'scheduled', sentAt: null }]).pending, 1);
});
test('shared dispatcher uses distinct frozen deliveries and idempotency keys for link and code', async () => {
  const secret = 'test-only-private-encryption-secret-'.repeat(2),
    calls = [],
    saved = new Map(),
    done = new Set();
  const row = {
    id: 'test-id',
    claim_id: 'test-claim',
    case_file_id: 'test-case',
    recipient: 'qa@example.invalid',
    recipient_name: 'QA',
    participant_role: 'subject',
    sender_name: 'QA',
    case_title: 'QA',
    folio: 'QA',
    app_origin: 'https://example.invalid',
    expires_at: '2026-12-01T12:00:00Z',
  };
  const store = {
    async rpc(name, args) {
      const prefix = name.includes('_code_') ? 'code' : 'link',
        suffix = name.split('_').at(-1);
      if (suffix === 'claim')
        return {
          data: done.has(prefix)
            ? []
            : [
                {
                  ...row,
                  ...(prefix === 'code' ? { kind: 'code' } : {}),
                  token_ciphertext: encryptInvitationSecret(
                    prefix === 'code' ? 'ABCDEFGH' : 'a'.repeat(64),
                    secret
                  ),
                  payload_ciphertext: saved.get(prefix) || null,
                },
              ],
          error: null,
        };
      if (suffix === 'payload') {
        if (!saved.has(prefix)) saved.set(prefix, args.p_ciphertext);
        return { data: saved.get(prefix), error: null };
      }
      done.add(prefix);
      return { data: true, error: null };
    },
  };
  const config = {
    secret,
    apiKey: 'test-key',
    from: 'QA <qa@example.invalid>',
    wait: async () => {},
    fetch: async (_url, init) => {
      calls.push({ key: init.headers['Idempotency-Key'], body: JSON.parse(init.body) });
      return Response.json({ id: 'provider-id' });
    },
  };
  await dispatchCaseMail(store, 'test-case', 'test-actor', config);
  await dispatchCaseMail(store, 'test-case', 'test-actor', config);
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((c) => c.key),
    ['case-invitation/test-id', 'case-invitation-code/test-id']
  );
  assert.match(calls[0].body.text, /\/expediente\//);
  assert.doesNotMatch(calls[1].body.text, /https?:\/\//);
  assert.match(calls[1].body.text, /ABCDEFGH/);
});
