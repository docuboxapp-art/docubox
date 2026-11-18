import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { initializeColaboraFixture } from '../scripts/qa/colabora-postgres-fixture.mjs';
const require = createRequire(import.meta.url);
const { PGlite } = require('../.tmp/colabora-db-qa/node_modules/@electric-sql/pglite');
const db = new PGlite();
try {
  await initializeColaboraFixture(db);
} catch (error) {
  await db.close();
  throw new Error('Postgres fixture: ' + error.message + ' (position ' + error.position + ')');
}
const ws = randomUUID(),
  foreign = randomUUID(),
  actor = randomUUID(),
  recipient = randomUUID(),
  formId = randomUUID();
const hash = (value) => createHash('sha256').update(value).digest('hex');
await db.query('INSERT INTO auth.users VALUES($1),($2)', [actor, recipient]);
await db.query(
  "INSERT INTO user_profiles VALUES($1,'actor@example.invalid','Actor'),($2,'recipient@example.invalid','Recipient')",
  [actor, recipient]
);
await db.query(
  "INSERT INTO workspaces(id,owner_id,name,workspace_type) VALUES($1,$2,'Synthetic organization','business'),($3,$2,'Foreign organization','business')",
  [ws, actor, foreign]
);
await db.query(
  "INSERT INTO workspace_members(workspace_id,user_id,role,status) VALUES($1,$2,'owner','active'),($1,$3,'member','active')",
  [ws, actor, recipient]
);
await db.query(
  "INSERT INTO form_templates(id,workspace_id,name,status,created_by,settings) VALUES($1,$2,'Synthetic form','published',$3,'{\"requiresSignature\":false}')",
  [formId, ws, actor]
);
test.beforeEach(async () => db.exec('BEGIN'));
test.afterEach(async () => db.exec('ROLLBACK'));
test.after(async () => db.close());
const first = async (sql, args) => (await db.query(sql, args)).rows[0];
async function fails(sql, args, pattern) {
  await db.exec('SAVEPOINT expected_failure');
  try {
    await assert.rejects(db.query(sql, args), (error) => pattern.test(error.message));
  } finally {
    await db.exec('ROLLBACK TO SAVEPOINT expected_failure;RELEASE SAVEPOINT expected_failure');
  }
}
async function request(
  items = [{ item_type: 'document', title: 'Document', required: true }],
  options = {}
) {
  const raw = randomUUID();
  const r = await first('SELECT colabora_create_document_request($1,$2,$3,$4,$5) data', [
    ws,
    actor,
    {
      title: 'Synthetic request',
      recipient_name: 'Synthetic recipient',
      recipient_email: 'recipient@example.invalid',
      send_invitation: false,
      ...options,
    },
    items,
    hash(raw),
  ]);
  const rows = await db.query(
    'SELECT * FROM collaboration_request_items WHERE request_id=$1 ORDER BY position',
    [r.data.id]
  );
  return { row: r.data, items: rows.rows, token: raw, requestHash: hash(raw) };
}
async function session(r) {
  const value = randomUUID();
  await db.query(
    "INSERT INTO collaboration_request_external_sessions(request_id,workspace_id,session_token_hash,otp_hash,otp_expires_at,otp_consumed_at,expires_at) VALUES($1,$3,$2,repeat('0',64),now()+interval '10 minutes',now(),now()+interval '1 hour')",
    [r.row.id, hash(value), ws]
  );
  return hash(value);
}
const formItem = (requiresSignature = false) => ({
  item_type: 'form',
  title: 'Form',
  required: true,
  form_template_id: formId,
  source_snapshot: { revision: 1, requiresSignature },
});
async function issue(r, s) {
  return (
    await first('SELECT colabora_request_form_token($1,$2,$3) data', [
      r.requestHash,
      s,
      r.items[0].id,
    ])
  ).data;
}
async function respond(r, t) {
  const tok = await first('SELECT id FROM form_tokens WHERE token=$1', [t.token]);
  const row = await first(
    'INSERT INTO form_responses(token_id,template_id,workspace_id,response_data,field_hashes) VALUES($1,$2,$3,\'{"name":"Synthetic"}\',\'{}\') RETURNING *',
    [tok.id, formId, ws]
  );
  await db.query('UPDATE form_tokens SET used_at=now() WHERE id=$1', [tok.id]);
  return row;
}
async function file(r, s, itemId = r.items[0].id) {
  return (
    await first('SELECT colabora_receive_request_file($1,$2,$3,$4) data', [
      r.requestHash,
      s,
      itemId,
      {
        original_name: 'synthetic.pdf',
        storage_path: `collaboration-requests/${ws}/${r.row.id}/${itemId}/${randomUUID()}.pdf`,
        mime_type: 'application/pdf',
        byte_size: 100,
        sha256: '0'.repeat(64),
      },
    ])
  ).data;
}
const review = (r, itemId, operation = 'approve_item', reason = null) =>
  first('SELECT colabora_review_request_item($1,$2,$3,$4,$5,$6) data', [
    ws,
    actor,
    r.row.id,
    operation,
    itemId,
    reason,
  ]);

test('service-only functions and form bindings are inaccessible to browser roles', async () => {
  const row = await first(
    "SELECT has_function_privilege('authenticated','colabora_request_form_token(text,text,uuid)','EXECUTE') exposed,has_table_privilege('authenticated','collaboration_request_form_links','SELECT') readable"
  );
  assert.equal(row.exposed, false);
  assert.equal(row.readable, false);
});
test('creation is atomic when a later requirement references a foreign form', async () => {
  const bad = randomUUID();
  await db.query(
    "INSERT INTO form_templates(id,workspace_id,name,status,created_by) VALUES($1,$2,'Foreign','published',$3)",
    [bad, foreign, actor]
  );
  await fails(
    'SELECT colabora_create_document_request($1,$2,$3,$4,$5)',
    [
      ws,
      actor,
      {
        title: 'Rollback request',
        recipient_name: 'Synthetic',
        recipient_email: 'recipient@example.invalid',
      },
      [
        { item_type: 'document', title: 'First' },
        { item_type: 'form', title: 'Foreign', form_template_id: bad },
      ],
      hash('rollback'),
    ],
    /form_unavailable/
  );
  assert.equal(
    (await first('SELECT count(*)::integer count FROM collaboration_document_requests')).count,
    0
  );
});
test('checklist add, edit and remove persist together with activity', async () => {
  const r = await request();
  const item = { item_type: 'document', title: 'Second document', required: false };
  const added = await first('SELECT colabora_change_request_item($1,$2,$3,$4,NULL,$5) id', [
    ws,
    actor,
    r.row.id,
    'add_item',
    item,
  ]);
  await db.query('SELECT colabora_change_request_item($1,$2,$3,$4,$5,$6)', [
    ws,
    actor,
    r.row.id,
    'edit_item',
    added.id,
    { ...item, title: 'Edited document' },
  ]);
  assert.equal(
    (await first('SELECT title FROM collaboration_request_items WHERE id=$1', [added.id])).title,
    'Edited document'
  );
  await db.query('SELECT colabora_change_request_item($1,$2,$3,$4,$5)', [
    ws,
    actor,
    r.row.id,
    'remove_item',
    added.id,
  ]);
  assert.equal(
    (
      await first(
        'SELECT count(*)::integer count FROM collaboration_request_items WHERE request_id=$1',
        [r.row.id]
      )
    ).count,
    1
  );
});
test('OTP-verified form issuance is private, recipient-bound and idempotent', async () => {
  const r = await request([formItem()]);
  await fails(
    'SELECT colabora_request_form_token($1,$2,$3)',
    [r.requestHash, hash('wrong'), r.items[0].id],
    /request_session_invalid/
  );
  const s = await session(r);
  const issued = await issue(r, s);
  assert.equal((await issue(r, s)).token, issued.token);
  const row = await first('SELECT * FROM form_tokens WHERE token=$1', [issued.token]);
  assert.equal(row.access_mode, 'private');
  assert.equal(row.recipient_email, 'recipient@example.invalid');
  assert.equal(row.recipient_user_id, null);
  assert.equal(row.require_liveness, false);
});
test('canonical form responses update progress and preserve the original receipt', async () => {
  const r = await request([
    formItem(),
    { item_type: 'document', title: 'Pending document', required: true },
  ]);
  const s = await session(r);
  const t = await issue(r, s);
  const response = await respond(r, t);
  const item = await first('SELECT * FROM collaboration_request_items WHERE id=$1', [
    r.items[0].id,
  ]);
  assert.equal(item.form_response_id, response.id);
  assert.equal(item.status, 'uploaded');
  await fails(
    'UPDATE form_responses SET response_data=\'{"name":"Tampered"}\' WHERE id=$1',
    [response.id],
    /request_form_receipt_immutable/
  );
  await review(r, item.id);
  assert.equal(
    (await first('SELECT status FROM collaboration_document_requests WHERE id=$1', [r.row.id]))
      .status,
    'in_progress'
  );
});

test('a second response cannot overwrite the evidence already received for a requirement', async () => {
  const r = await request([formItem()]);
  const s = await session(r);
  const t = await issue(r, s);
  const original = await respond(r, t);
  const tok = await first('SELECT id FROM form_tokens WHERE token=$1', [t.token]);
  await fails(
    "INSERT INTO form_responses(token_id,template_id,workspace_id,response_data,field_hashes) VALUES($1,$2,$3,'{}','{}')",
    [tok.id, formId, ws],
    /request_form_receipt_exists/
  );
  assert.equal(
    (
      await first('SELECT form_response_id FROM collaboration_request_items WHERE id=$1', [
        r.items[0].id,
      ])
    ).form_response_id,
    original.id
  );
});
test('a form requiring signature cannot be approved from captured answers alone', async () => {
  const r = await request([formItem(true)]);
  const s = await session(r);
  await respond(r, await issue(r, s));
  await fails(
    'SELECT colabora_review_request_item($1,$2,$3,$4,$5,NULL)',
    [ws, actor, r.row.id, 'approve_item', r.items[0].id],
    /form_signature_pending/
  );
  assert.equal(
    (await first('SELECT status FROM collaboration_request_items WHERE id=$1', [r.items[0].id]))
      .status,
    'uploaded'
  );
});
test('replacement issues a new private token and keeps previous form receipts', async () => {
  const r = await request([formItem()]);
  const s = await session(r);
  const t = await issue(r, s);
  const original = await respond(r, t);
  await review(r, r.items[0].id, 'request_replacement', 'Please correct the answer');
  const next = await issue(r, s);
  assert.notEqual(next.token, t.token);
  const replacement = await respond(r, next);
  assert.notEqual(replacement.id, original.id);
  assert.equal((await first('SELECT count(*)::integer count FROM form_responses')).count, 2);
});
test('files retain versions, require clean analysis and incorporate only on approval', async () => {
  const r = await request();
  const s = await session(r);
  const one = await file(r, s);
  const two = await file(r, s);
  assert.equal(one.version, 1);
  assert.equal(two.version, 2);
  await fails(
    'SELECT colabora_review_request_item($1,$2,$3,$4,$5,NULL)',
    [ws, actor, r.row.id, 'approve_item', r.items[0].id],
    /request_file_security_scan_required/
  );
  await db.query("UPDATE collaboration_request_files SET malware_scan_status='clean' WHERE id=$1", [
    two.id,
  ]);
  const result = await review(r, r.items[0].id);
  assert.equal(result.data.status, 'completed');
  assert.ok(result.data.canonical_document_id);
  assert.equal(
    (
      await first('SELECT canonical_document_id FROM collaboration_request_files WHERE id=$1', [
        two.id,
      ])
    ).canonical_document_id,
    result.data.canonical_document_id
  );
});
test('a form requirement rejects uploaded files in the transaction as well as the API', async () => {
  const r = await request([formItem()]);
  const s = await session(r);
  await assert.rejects(file(r, s), /request_item_locked/);
});
test('optional-only requests have an explicit completion path; required work cannot be skipped', async () => {
  const r = await request([{ item_type: 'document', title: 'Optional', required: false }]);
  assert.equal((await review(r, null, 'complete')).data.status, 'completed');
  const required = await request();
  await fails(
    'SELECT colabora_review_request_item($1,$2,$3,$4,NULL,NULL)',
    [ws, actor, required.row.id, 'complete'],
    /request_required_items_pending/
  );
});
test('cancellation revokes request sessions and outstanding form links', async () => {
  const r = await request([formItem()]);
  const s = await session(r);
  const issued = await issue(r, s);
  await db.query("UPDATE collaboration_document_requests SET status='cancelled' WHERE id=$1", [
    r.row.id,
  ]);
  assert.ok(
    (
      await first(
        'SELECT revoked_at FROM collaboration_request_external_sessions WHERE request_id=$1',
        [r.row.id]
      )
    ).revoked_at
  );
  assert.ok(
    Date.parse(
      (await first('SELECT expires_at FROM form_tokens WHERE token=$1', [issued.token])).expires_at
    ) <= Date.now()
  );
  await fails(
    'SELECT colabora_request_form_token($1,$2,$3)',
    [r.requestHash, s, r.items[0].id],
    /request_session_invalid/
  );
});
test('renewal revokes prior sessions and rejects immediate repeated invitations', async () => {
  const r = await request([formItem()]);
  await session(r);
  const result = await first('SELECT colabora_rotate_request_invitation($1,$2,$3,$4) data', [
    ws,
    actor,
    r.row.id,
    hash('renewed'),
  ]);
  assert.equal(result.data.invitation_status, 'pending');
  assert.ok(
    (
      await first(
        'SELECT revoked_at FROM collaboration_request_external_sessions WHERE request_id=$1',
        [r.row.id]
      )
    ).revoked_at
  );
  await fails(
    'SELECT colabora_rotate_request_invitation($1,$2,$3,$4)',
    [ws, actor, r.row.id, hash('again')],
    /request_invitation_rate_limited/
  );
});
test('review creation and decisions update version, reviewers and audit atomically', async () => {
  const doc = await first(
    "INSERT INTO documentos(documento_id,owner_id,workspace_id,nombre,file_name,file_hash_sha256) VALUES('QA-REVIEW',$1,$2,'Synthetic document','synthetic.pdf',$3) RETURNING id",
    [actor, ws, '0'.repeat(64)]
  );
  const version = await first(
    "INSERT INTO document_versions(document_id,workspace_id,version_number,sha256,status,created_by) VALUES($1,$2,1,$3,'draft',$4) RETURNING id",
    [doc.id, ws, '0'.repeat(64), actor]
  );
  const created = await first('SELECT colabora_create_review($1,$2,$3,$4,$5,$6) data', [
    ws,
    actor,
    doc.id,
    version.id,
    'Synthetic review',
    [recipient],
  ]);
  assert.equal(created.data.status, 'open');
  assert.equal(
    (await first('SELECT status FROM document_versions WHERE id=$1', [version.id])).status,
    'in_review'
  );
  await fails(
    'SELECT colabora_create_review($1,$2,$3,$4,$5,$6)',
    [ws, actor, doc.id, version.id, 'Duplicate', [recipient]],
    /review_already_open/
  );
  const comment = await first(
    "INSERT INTO collaboration_comments(workspace_id,document_id,document_version_id,review_round_id,author_id,body,is_blocking) VALUES($1,$2,$3,$4,$5,'Synthetic blocking comment',true) RETURNING id",
    [ws, doc.id, version.id, created.data.id, actor]
  );
  await fails(
    'SELECT colabora_decide_review($1,$2,$3,$4,$5,$6,NULL)',
    [ws, actor, doc.id, created.data.id, 'approve', created.data.optimistic_version],
    /review_blocking_comments/
  );
  await db.query("UPDATE collaboration_comments SET status='resolved' WHERE id=$1", [comment.id]);
  const approved = await first('SELECT colabora_decide_review($1,$2,$3,$4,$5,$6,NULL) data', [
    ws,
    actor,
    doc.id,
    created.data.id,
    'approve',
    created.data.optimistic_version,
  ]);
  assert.equal(approved.data.status, 'approved');
  assert.equal(
    (await first('SELECT status FROM document_versions WHERE id=$1', [version.id])).status,
    'approved'
  );
  assert.ok(approved.data.optimistic_version > created.data.optimistic_version);
});

test('submission requires complete deliveries, commits review state and refuses duplicate submission', async () => {
  const r = await request([
    formItem(),
    { item_type: 'document', title: 'Required document', required: true },
  ]);
  const s = await session(r);
  await fails(
    'SELECT colabora_submit_request($1,$2)',
    [r.requestHash, s],
    /request_required_items_pending/
  );
  const t = await issue(r, s);
  await respond(r, t);
  await file(r, s, r.items[1].id);
  const result = await first('SELECT colabora_submit_request($1,$2) data', [r.requestHash, s]);
  assert.equal(result.data.status, 'in_review');
  assert.equal(
    (await first('SELECT status FROM collaboration_document_requests WHERE id=$1', [r.row.id]))
      .status,
    'in_review'
  );
  assert.deepEqual(
    (
      await db.query('SELECT status FROM collaboration_request_items WHERE request_id=$1', [
        r.row.id,
      ])
    ).rows.map((x) => x.status),
    ['in_review', 'in_review']
  );
  await fails('SELECT colabora_submit_request($1,$2)', [r.requestHash, s], /request_locked/);
});

test('a changed published form cannot accept a receipt from the previous version', async () => {
  const r = await request([formItem()]);
  const s = await session(r);
  const t = await issue(r, s);
  await db.query('UPDATE form_templates SET revision_number=revision_number+1 WHERE id=$1', [
    formId,
  ]);
  const tok = await first('SELECT id FROM form_tokens WHERE token=$1', [t.token]);
  await fails(
    "INSERT INTO form_responses(token_id,template_id,workspace_id,response_data,field_hashes) VALUES($1,$2,$3,'{}','{}')",
    [tok.id, formId, ws],
    /request_form_revision_changed/
  );
  assert.equal(
    (
      await first('SELECT form_response_id FROM collaboration_request_items WHERE id=$1', [
        r.items[0].id,
      ])
    ).form_response_id,
    null
  );
});

test('expired membership cannot create requests or review rounds', async () => {
  await db.query(
    "UPDATE workspace_members SET access_expires_at=now()-interval '1 hour' WHERE workspace_id=$1 AND user_id=$2",
    [ws, actor]
  );
  await fails(
    'SELECT colabora_create_document_request($1,$2,$3,$4,$5)',
    [
      ws,
      actor,
      {
        title: 'Denied',
        recipient_name: 'Synthetic',
        recipient_email: 'recipient@example.invalid',
      },
      [{ item_type: 'document', title: 'Document' }],
      hash('denied'),
    ],
    /organization_permission_denied/
  );
});

test('OTP challenges persist failed attempts and can be consumed only once', async () => {
  const r = await request();
  const challenge = await first(
    "INSERT INTO collaboration_request_external_sessions(request_id,workspace_id,session_token_hash,otp_hash,otp_expires_at,expires_at) VALUES($1,$2,repeat('0',64),$3,now()+interval '10 minutes',now()+interval '30 minutes') RETURNING id",
    [r.row.id, ws, hash('correct')]
  );
  const verify = async (code) =>
    (
      await first('SELECT colabora_verify_request_otp($1,$2,$3,$4) data', [
        r.requestHash,
        challenge.id,
        hash(code),
        hash('session'),
      ])
    ).data;
  assert.equal((await verify('wrong')).status, 400);
  assert.equal(
    (
      await first(
        'SELECT failed_attempts FROM collaboration_request_external_sessions WHERE id=$1',
        [challenge.id]
      )
    ).failed_attempts,
    1
  );
  assert.equal((await verify('correct')).status, 200);
  assert.equal((await verify('correct')).status, 400);
  assert.equal(
    (
      await first(
        'SELECT session_token_hash FROM collaboration_request_external_sessions WHERE id=$1',
        [challenge.id]
      )
    ).session_token_hash,
    hash('session')
  );
});

test('OTP delivery is limited atomically and a renewed challenge revokes previous unused challenges', async () => {
  const r = await request();
  const issue = () =>
    first('SELECT colabora_issue_request_otp($1,$2,$3) id', [
      r.requestHash,
      hash('code'),
      hash(randomUUID()),
    ]);
  const firstChallenge = await issue();
  await fails(
    'SELECT colabora_issue_request_otp($1,$2,$3)',
    [r.requestHash, hash('code'), hash('new')],
    /request_otp_rate_limited/
  );
  await db.query(
    "UPDATE collaboration_request_external_sessions SET created_at=now()-interval '2 minutes' WHERE id=$1",
    [firstChallenge.id]
  );
  const second = await issue();
  assert.notEqual(second.id, firstChallenge.id);
  assert.ok(
    (
      await first('SELECT revoked_at FROM collaboration_request_external_sessions WHERE id=$1', [
        firstChallenge.id,
      ])
    ).revoked_at
  );
});

test('form overview counts beyond the REST row limit without disclosing answers', async () => {
  await db.query(
    "WITH issued AS (INSERT INTO form_tokens(template_id,recipient_email,token,expires_at,access_mode) SELECT $1,'recipient@example.invalid','qa-'||gen_random_uuid()::text,now()+interval '1 day','private' FROM generate_series(1,1005) RETURNING id) INSERT INTO form_responses(token_id,template_id,workspace_id,response_data,field_hashes) SELECT id,$1,$2,'{}','{}' FROM issued",
    [formId, ws]
  );
  const row = await first('SELECT * FROM colabora_forms_overview($1)', [ws]);
  assert.equal(Number(row.response_count), 1005);
  assert.equal('response_data' in row, false);
  const definition = await first(
    "SELECT prosecdef FROM pg_proc WHERE oid='public.colabora_forms_overview(uuid)'::regprocedure"
  );
  assert.equal(definition.prosecdef, false);
});

test('a request retains its delegated responsible and rejects a foreign assignee', async () => {
  const r = await request(undefined, { responsible_user_id: recipient });
  assert.equal(r.row.responsible_user_id, recipient);
  await fails(
    'SELECT colabora_create_document_request($1,$2,$3,$4,$5)',
    [
      ws,
      actor,
      {
        title: 'Denied',
        recipient_name: 'Synthetic',
        recipient_email: 'recipient@example.invalid',
        responsible_user_id: randomUUID(),
      },
      [{ item_type: 'document', title: 'Document' }],
      hash('foreign-responsible'),
    ],
    /catalog_relation_scope/
  );
});

test('browser roles cannot invoke privileged request mutations; the backend role can', async () => {
  await db.exec('SET LOCAL ROLE authenticated');
  await fails(
    'SELECT colabora_create_document_request($1,$2,$3,$4,$5)',
    [
      ws,
      actor,
      {
        title: 'Denied',
        recipient_name: 'Synthetic',
        recipient_email: 'recipient@example.invalid',
      },
      [{ item_type: 'document', title: 'Document' }],
      hash('denied-role'),
    ],
    /permission denied/
  );
  await db.exec('RESET ROLE;SET LOCAL ROLE service_role');
  const r = await request();
  assert.equal(r.row.created_by, actor);
  await db.exec('RESET ROLE');
});

test('review changes release the version and an older round cannot override a later review', async () => {
  const doc = await first(
    "INSERT INTO documentos(documento_id,owner_id,workspace_id,nombre,file_name,file_hash_sha256) VALUES('QA-CHANGES',$1,$2,'Synthetic','synthetic.pdf',$3) RETURNING id",
    [actor, ws, '0'.repeat(64)]
  );
  const version = await first(
    "INSERT INTO document_versions(document_id,workspace_id,version_number,sha256,status,created_by) VALUES($1,$2,1,$3,'draft',$4) RETURNING id",
    [doc.id, ws, '0'.repeat(64), actor]
  );
  const create = async () =>
    (
      await first('SELECT colabora_create_review($1,$2,$3,$4,$5,$6) data', [
        ws,
        actor,
        doc.id,
        version.id,
        'Synthetic review',
        [recipient],
      ])
    ).data;
  let previous = await create();
  previous = (
    await first('SELECT colabora_decide_review($1,$2,$3,$4,$5,$6,$7) data', [
      ws,
      actor,
      doc.id,
      previous.id,
      'request_changes',
      previous.optimistic_version,
      'Completar la información.',
    ])
  ).data;
  assert.equal(
    (await first('SELECT status FROM document_versions WHERE id=$1', [version.id])).status,
    'draft'
  );
  const current = await create();
  assert.ok(current.round_number > previous.round_number);
  await fails(
    'SELECT colabora_decide_review($1,$2,$3,$4,$5,$6,NULL)',
    [ws, actor, doc.id, previous.id, 'approve', previous.optimistic_version],
    /review_closed/
  );
  await db.query('SELECT colabora_decide_review($1,$2,$3,$4,$5,$6,NULL)', [
    ws,
    actor,
    doc.id,
    current.id,
    'close_review',
    current.optimistic_version,
  ]);
  assert.equal(
    (await first('SELECT status FROM document_versions WHERE id=$1', [version.id])).status,
    'draft'
  );
});
