import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const result = await build({
  stdin: {
    contents: "export * from './src/lib/case-files/invitations';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const {
  createInvitationCredential,
  encryptInvitationSecret,
  decryptInvitationSecret,
  hashInvitationToken,
  buildCaseInvitationEmail,
  deliverCaseInvitations,
  summarizeInvitations,
} = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
);
const secret = 'test-only-secret-with-enough-entropy-'.repeat(2);
const base = {
  id: 'invite-1',
  case_file_id: 'case',
  claim_id: 'claim-1',
  recipient: 'qa@example.invalid',
  recipient_name: 'Persona <QA>',
  participant_role: 'subject',
  sender_name: 'Organizador QA',
  case_title: 'Prueba <expediente>',
  folio: 'QA-001',
  app_origin: 'https://example.invalid',
  expires_at: '2026-12-01T12:00:00Z',
  payload_ciphertext: null,
};
function harness() {
  const cred = createInvitationCredential(secret);
  const row = { ...base, token_ciphertext: cred.ciphertext };
  let payload = null,
    claims = [row];
  const statuses = [];
  const store = {
    claim: async () => claims,
    savePayload: async (_id, _claim, value) => (payload ??= value),
    finish: async (...args) => {
      statuses.push(args);
      return true;
    },
  };
  return {
    row,
    store,
    statuses,
    retry() {
      claims = [{ ...row, claim_id: 'claim-2', payload_ciphertext: payload }];
    },
    noClaims() {
      claims = [];
    },
    getPayload: () => payload,
  };
}
const config = {
  secret,
  apiKey: 'test-key',
  from: 'Docubox <qa@example.invalid>',
  wait: async () => {},
};
test('capability tokens have independent randomness and only encrypted material is stored', () => {
  const first = createInvitationCredential(secret),
    second = createInvitationCredential(secret);
  assert.notEqual(first.hash, second.hash);
  const token = decryptInvitationSecret(first.ciphertext, secret);
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(hashInvitationToken(token), first.hash);
  assert.equal(JSON.stringify(first).includes(token), false);
});
test('encrypted capabilities and payloads reject tampering and unrelated keys', () => {
  const cipher = encryptInvitationSecret('private', secret);
  assert.equal(decryptInvitationSecret(cipher, secret), 'private');
  assert.throws(() => decryptInvitationSecret(cipher, secret + 'other'));
  const [a, b, c] = cipher.split('.');
  const bytes = Buffer.from(c, 'base64url');
  bytes[0] ^= 1;
  assert.throws(() =>
    decryptInvitationSecret([a, b, bytes.toString('base64url')].join('.'), secret)
  );
  assert.throws(() => createInvitationCredential(''));
});
test('invitation email is scoped, escaped and does not assert signatures or identity checks', () => {
  const mail = buildCaseInvitationEmail(base, 'a'.repeat(64), config.from);
  assert.deepEqual(mail.to, ['qa@example.invalid']);
  assert.match(mail.html, /Persona &lt;QA&gt;/);
  assert.match(mail.html, /Prueba &lt;expediente&gt;/);
  assert.match(mail.text, /\/expediente\/a{64}/);
  assert.match(mail.text, /no firma documentos ni autoriza/);
  assert.doesNotMatch(mail.html, /<QA>/);
});
test('links reject insecure offsite origins and malformed capability values', () => {
  assert.throws(() =>
    buildCaseInvitationEmail(
      { ...base, app_origin: 'http://evil.invalid' },
      'a'.repeat(64),
      config.from
    )
  );
  assert.throws(() =>
    buildCaseInvitationEmail(
      { ...base, app_origin: 'https://evil.invalid/path' },
      'a'.repeat(64),
      config.from
    )
  );
  assert.throws(() => buildCaseInvitationEmail(base, 'invalid', config.from));
});

test('invitation actions remain in the case portal for every participant role', () => {
  for (const participant_role of ['subject', 'representative', 'contact']) {
    const mail = buildCaseInvitationEmail(
      { ...base, participant_role },
      'a'.repeat(64),
      config.from
    );
    assert.match(mail.subject, /expediente/);
    assert.match(
      mail.html,
      /href="https:\/\/example\.invalid\/expediente\/a{64}"[^>]*>Abrir expediente<\/a>/
    );
    assert.match(mail.text, /Tu rol en el expediente:/);
    assert.match(mail.text, /entregas que te correspondan/);
    assert.doesNotMatch(
      mail.html + mail.text,
      /Responder formulario|Ver respuestas|Lanzar formulario|\/formulario-publico\/|\/portal-formulario\/|\/form\//i
    );
  }
});

test('separate access-code email identifies the case without including its invitation link', () => {
  const mail = buildCaseInvitationEmail(
    { ...base, kind: 'code', folio: 'QA-<001>' },
    'ABCD2345',
    config.from
  );
  assert.match(mail.subject, /Código de acceso al expediente/);
  assert.match(mail.html, /QA-&lt;001&gt;/);
  assert.match(mail.text, /portal del expediente junto con el correo/);
  assert.match(mail.text, /enlace de acceso se envió por separado/);
  assert.doesNotMatch(
    mail.html + mail.text,
    /\/expediente\/|\/formulario-publico\/|responder formulario|ver respuestas/i
  );
});

test('case invitation and code use the common Docubox email frame with case-only context', () => {
  for (const [kind, credential] of [
    [undefined, 'a'.repeat(64)],
    ['code', 'ABCD2345'],
  ]) {
    const mail = buildCaseInvitationEmail({ ...base, kind }, credential, config.from);
    assert.match(mail.html, /width="600"/);
    assert.match(mail.html, /Google Sans/);
    assert.match(mail.html, /Política de privacidad/);
    assert.match(mail.html, /Términos y condiciones/);
    assert.match(mail.html, /Este correo fue enviado de forma segura por Docubox/);
    assert.match(mail.html, /te invitó a participar en un expediente mediante Docubox/);
    assert.doesNotMatch(
      mail.html,
      /Invitación a formulario|Completar formulario|Tu código de acceso al formulario/
    );
  }
});
test('success requires a real provider acknowledgement and freezes the exact email payload', async () => {
  const h = harness();
  let calls = 0;
  const outcome = await deliverCaseInvitations(h.store, {
    ...config,
    fetch: async (_url, init) => {
      calls++;
      assert.equal(init.headers['Idempotency-Key'], 'case-invitation/invite-1');
      const payload = JSON.parse(init.body);
      assert.deepEqual(payload.to, ['qa@example.invalid']);
      return Response.json({ id: 'provider-1' });
    },
  });
  assert.equal(calls, 1);
  assert.equal(outcome.accepted, 1);
  assert.equal(h.statuses[0][2], 'sent');
  assert.ok(h.getPayload());
});
test('provider acceptance followed by failed persistence retries the same payload and provider key', async () => {
  const h = harness();
  const sent = [];
  let fail = true;
  h.store.finish = async () => {
    if (fail) {
      fail = false;
      throw Error('DB unavailable');
    }
    return true;
  };
  const fetch = async (_url, init) => {
    sent.push([init.headers['Idempotency-Key'], init.body]);
    return Response.json({ id: 'same-provider-id' });
  };
  assert.equal((await deliverCaseInvitations(h.store, { ...config, fetch })).accepted, 0);
  h.retry();
  assert.equal(
    (
      await deliverCaseInvitations(h.store, {
        ...config,
        from: 'Changed sender <other@example.invalid>',
        fetch,
      })
    ).accepted,
    1
  );
  assert.deepEqual(sent[0], sent[1]);
});
test('timeout remains uncertain and does not falsely report a sent invitation', async () => {
  const h = harness();
  const outcome = await deliverCaseInvitations(h.store, {
    ...config,
    fetch: async () => {
      throw new Error('timeout body may contain private data');
    },
  });
  assert.equal(outcome.accepted, 0);
  assert.equal(h.statuses[0][2], 'retrying');
  assert.equal(h.statuses[0][4], 'TRANSPORT_UNCERTAIN');
});
test('validation rejections are recorded without raw provider messages', async () => {
  const h = harness();
  await deliverCaseInvitations(h.store, {
    ...config,
    fetch: async () => Response.json({ message: 'private address rejected' }, { status: 422 }),
  });
  assert.equal(h.statuses[0][2], 'failed');
  assert.equal(h.statuses[0][4], 'HTTP_422');
  assert.doesNotMatch(JSON.stringify(h.statuses), /private address/);
});
test('rate limiting, 5xx and idempotency conflicts remain retryable', async () => {
  for (const status of [429, 503, 409]) {
    const h = harness();
    await deliverCaseInvitations(h.store, {
      ...config,
      fetch: async () => new Response('', { status }),
    });
    assert.equal(h.statuses[0][2], 'retrying');
  }
});
test('malformed success acknowledgement is not called sent', async () => {
  const h = harness();
  await deliverCaseInvitations(h.store, {
    ...config,
    fetch: async () => Response.json({ ok: true }),
  });
  assert.equal(h.statuses[0][2], 'retrying');
  assert.equal(h.statuses[0][4], 'PROVIDER_ACK_INVALID');
});
test('repeated dispatch of a sent invitation does not call provider', async () => {
  const h = harness();
  h.noClaims();
  let calls = 0;
  await deliverCaseInvitations(h.store, {
    ...config,
    fetch: async () => {
      calls++;
      return Response.json({ id: 'unexpected' });
    },
  });
  assert.equal(calls, 0);
});
test('summary distinguishes accepted, uncertain and revoked delivery', () => {
  const invitations = [
    'sent',
    'sending',
    'retrying',
    'failed',
    'expired',
    'revoked',
    'attention',
  ].map((status) => ({ status }));
  const summary = summarizeInvitations(invitations);
  assert.equal(summary.sent, 1);
  assert.equal(summary.pending, 2);
  assert.equal(summary.failed, 4);
  assert.equal(summary.total, 7);
});
test('revoking an already sent link preserves the delivery count', () => {
  assert.equal(
    summarizeInvitations([{ status: 'revoked', sentAt: '2026-11-10T00:00:00Z' }]).sent,
    1
  );
});
