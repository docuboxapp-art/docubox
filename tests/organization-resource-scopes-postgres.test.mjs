import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { initializeOrganizationScopesFixture } from '../scripts/qa/organization-scopes-postgres-fixture.mjs';
const require = createRequire(import.meta.url),
  { PGlite } = require('../.tmp/colabora-db-qa/node_modules/@electric-sql/pglite');
const db = new PGlite();
try {
  await initializeOrganizationScopesFixture(db);
} catch (error) {
  await db.close();
  throw new Error('Scope fixture: ' + error.message + ' at ' + error.position);
}
const ws = randomUUID(),
  otherWs = randomUUID(),
  owner = randomUUID(),
  actor = randomUUID(),
  peer = randomUUID(),
  outside = randomUUID(),
  team = randomUUID(),
  otherTeam = randomUUID();
const users = [owner, actor, peer, outside],
  memberIds = new Map(users.map((user) => [user, randomUUID()]));
for (const user of users) {
  await db.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [
    user,
    `${user}@example.invalid`,
  ]);
  await db.query('INSERT INTO user_profiles VALUES($1,$2,$3)', [
    user,
    `${user}@example.invalid`,
    'Synthetic',
  ]);
}
await db.query(
  "INSERT INTO workspaces(id,owner_id,name,workspace_type) VALUES($1,$2,'Synthetic','business'),($3,$2,'Other','business')",
  [ws, owner, otherWs]
);
for (const user of users)
  await db.query(
    "INSERT INTO workspace_members(id,workspace_id,user_id,role,status) VALUES($1,$2,$3,$4,'active')",
    [memberIds.get(user), ws, user, user === owner ? 'owner' : 'member']
  );
await db.query(
  "INSERT INTO organization_units VALUES($1,$2,'active','team'),($3,$2,'active','team')",
  [team, ws, otherTeam]
);
for (const user of [actor, peer])
  await db.query('INSERT INTO organization_unit_members VALUES($1,$2)', [
    team,
    memberIds.get(user),
  ]);
await db.query('INSERT INTO organization_unit_members VALUES($1,$2)', [
  otherTeam,
  memberIds.get(outside),
]);
const permission = randomUUID(),
  editPermission = randomUUID();
await db.query("INSERT INTO organization_permissions VALUES($1,'tasks.view'),($2,'tasks.edit')", [
  permission,
  editPermission,
]);
test.beforeEach(async () => db.exec('BEGIN'));
test.afterEach(async () => db.exec('RESET ROLE;ROLLBACK'));
test.after(async () => db.close());
const first = async (sql, args) => (await db.query(sql, args)).rows[0];
async function role(scope, config = {}, permissionId = permission) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO organization_roles(id,workspace_id,status,scope_type,scope_config) VALUES($1,$2,'active',$3,$4)",
    [id, ws, scope, config]
  );
  await db.query('INSERT INTO organization_member_roles VALUES($1,$2,$3)', [
    ws,
    memberIds.get(actor),
    id,
  ]);
  await db.query('INSERT INTO organization_role_permissions VALUES($1,$2)', [id, permissionId]);
  return id;
}
async function task(createdBy, assignedTo = null, workspace = ws) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO tareas(id,workspace_id,estado,created_by,assigned_to) VALUES($1,$2,'nueva',$3,$4)",
    [id, workspace, createdBy, assignedTo]
  );
  return id;
}
async function asUser(user, fn) {
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [user]);
  await db.exec('SET LOCAL ROLE authenticated');
  try {
    return await fn();
  } finally {
    await db.exec('RESET ROLE');
  }
}
const visible = () => db.query('SELECT id FROM tareas ORDER BY id');
const allowed = (id, action = 'tasks.view') =>
  first('SELECT organization_can_access_resource($1,$2,$3,$4) allowed', [ws, action, 'task', id]);
test('own scope filters reads even when an existing permissive policy allows all rows', async () => {
  await role('own');
  const own = await task(actor);
  await task(peer);
  await task(actor, null, otherWs);
  await asUser(actor, async () =>
    assert.deepEqual(
      (await visible()).rows.map((x) => x.id),
      [own]
    )
  );
});
test('assigned scope includes explicit assignees but does not imply ownership', async () => {
  await role('assigned');
  const assigned = await task(peer, actor);
  await task(actor, peer);
  await asUser(actor, async () =>
    assert.deepEqual(
      (await visible()).rows.map((x) => x.id),
      [assigned]
    )
  );
});
test('team scope follows active membership and excludes other teams', async () => {
  await role('team');
  const inside = await task(peer);
  const outsideTask = await task(outside);
  await asUser(actor, async () => {
    assert.equal((await allowed(inside)).allowed, true);
    assert.equal((await allowed(outsideTask)).allowed, false);
  });
  await db.query('DELETE FROM organization_unit_members WHERE member_id=$1', [
    memberIds.get(actor),
  ]);
  await asUser(actor, async () => assert.equal((await allowed(inside)).allowed, false));
});
test('permission scopes cannot be borrowed from a different permission', async () => {
  await role('organization', {}, permission);
  await role('own', {}, editPermission);
  const id = await task(peer);
  await asUser(actor, async () => {
    assert.equal((await allowed(id)).allowed, true);
    assert.equal((await allowed(id, 'tasks.edit')).allowed, false);
  });
});

async function fails(sql, args, pattern) {
  await db.exec('SAVEPOINT denied');
  try {
    await assert.rejects(db.query(sql, args), (error) => pattern.test(error.message));
  } finally {
    await db.exec('ROLLBACK TO SAVEPOINT denied;RELEASE SAVEPOINT denied');
  }
}
async function permissionFor(key) {
  const id = randomUUID();
  await db.query('INSERT INTO organization_permissions VALUES($1,$2)', [id, key]);
  return id;
}
async function document(ownerId, participants = []) {
  return (
    await first(
      "INSERT INTO documentos(documento_id,owner_id,workspace_id,nombre,file_name,file_hash_sha256,participantes) VALUES($1,$2,$3,'Synthetic','synthetic.pdf',$4,$5) RETURNING id",
      ['QA-' + randomUUID(), ownerId, ws, '0'.repeat(64), participants]
    )
  ).id;
}
async function newTaskAllowed(assignees = [], teams = [], space = null, action = 'tasks.create') {
  return first('SELECT organization_can_create_resource($1,$2,$3,$4,$5,$6) allowed', [
    ws,
    action,
    'task',
    assignees,
    teams,
    space,
  ]);
}

test('selected units and custom combinations do not collapse to organization-wide access', async () => {
  await role('units', { unit_ids: [otherTeam] });
  const outsideTask = await task(outside),
    myTask = await task(actor);
  await asUser(actor, async () => {
    assert.equal((await allowed(outsideTask)).allowed, true);
    assert.equal((await allowed(myTask)).allowed, false);
  });
  await role('custom', { unit_ids: [], include_own: true, include_assigned: true });
  const assigned = await task(peer, actor);
  await asUser(actor, async () => {
    assert.equal((await allowed(myTask)).allowed, true);
    assert.equal((await allowed(assigned)).allowed, true);
  });
});
test('invalid, foreign and empty custom unit configurations are rejected in PostgreSQL too', async () => {
  await fails(
    "INSERT INTO organization_roles VALUES($1,$2,'active','units',$3)",
    [randomUUID(), ws, { unit_ids: [randomUUID()] }],
    /organization_scope_invalid/
  );
  await fails(
    "INSERT INTO organization_roles VALUES($1,$2,'active','custom','{}')",
    [randomUUID(), ws],
    /organization_scope_invalid/
  );
  await fails(
    "INSERT INTO organization_roles VALUES($1,$2,'active','units',$3)",
    [randomUUID(), ws, { unit_ids: 'all' }],
    /organization_scope_invalid/
  );
});
test('archived roles and expired or suspended memberships stop granting access immediately', async () => {
  const r = await role('organization');
  const id = await task(peer);
  await db.query("UPDATE organization_roles SET status='archived' WHERE id=$1", [r]);
  await asUser(actor, async () => assert.equal((await allowed(id)).allowed, false));
  await db.query("UPDATE organization_roles SET status='active' WHERE id=$1", [r]);
  await db.query(
    "UPDATE workspace_members SET access_expires_at=now()-interval '1 second' WHERE user_id=$1",
    [actor]
  );
  await asUser(actor, async () => assert.equal((await allowed(id)).allowed, false));
  await db.query(
    "UPDATE workspace_members SET access_expires_at=NULL,status='suspended' WHERE user_id=$1",
    [actor]
  );
  await asUser(actor, async () => assert.equal((await allowed(id)).allowed, false));
});
test('owner access remains scoped to its organization and respects suspension', async () => {
  const id = await task(peer),
    foreign = await task(owner, null, otherWs);
  await asUser(owner, async () => {
    assert.equal((await allowed(id)).allowed, true);
    assert.equal((await allowed(foreign)).allowed, false);
  });
  await db.query('UPDATE workspaces SET organization_enabled=false WHERE id=$1', [ws]);
  await asUser(owner, async () => assert.equal((await allowed(id)).allowed, false));
});
test('administrative permissions stored in a limited role cannot administer the whole organization', async () => {
  const p = await permissionFor('roles.manage');
  await role('own', {}, p);
  await asUser(actor, async () =>
    assert.equal(
      (await first("SELECT has_organization_permission($1,'roles.manage') allowed", [ws])).allowed,
      false
    )
  );
  await role('organization', {}, p);
  await asUser(actor, async () =>
    assert.equal(
      (await first("SELECT has_organization_permission($1,'roles.manage') allowed", [ws])).allowed,
      true
    )
  );
});
test('creation validates the new assignment against the scope for that precise action', async () => {
  const p = await permissionFor('tasks.create');
  await role('assigned', {}, p);
  await asUser(actor, async () => {
    assert.equal((await newTaskAllowed()).allowed, false);
    assert.equal((await newTaskAllowed([actor])).allowed, true);
    assert.equal((await newTaskAllowed([peer])).allowed, false);
    assert.equal((await newTaskAllowed([randomUUID()])).allowed, false);
  });
});
test('creation and assignment permissions cannot exchange their scopes', async () => {
  const create = await permissionFor('tasks.create'),
    assign = await permissionFor('tasks.assign');
  await role('organization', {}, create);
  await role('assigned', {}, assign);
  await asUser(actor, async () => {
    assert.equal((await newTaskAllowed([peer])).allowed, true);
    assert.equal((await newTaskAllowed([peer], [], null, 'tasks.assign')).allowed, false);
  });
});
test('email assignment uses confirmed Auth identity, never editable profile metadata', async () => {
  const p = await permissionFor('reviews.comment');
  await role('assigned', {}, p);
  const doc = await document(peer, [{ email: `${outside}@example.invalid` }]);
  await db.query('UPDATE user_profiles SET email=$1 WHERE id=$2', [
    `${outside}@example.invalid`,
    actor,
  ]);
  await asUser(actor, async () =>
    assert.equal(
      (
        await first('SELECT organization_can_access_resource($1,$2,$3,$4) allowed', [
          ws,
          'reviews.comment',
          'document',
          doc,
        ])
      ).allowed,
      false
    )
  );
  const mine = await document(peer, [{ email: `${actor}@example.invalid` }]);
  await asUser(actor, async () =>
    assert.equal(
      (
        await first('SELECT organization_can_access_resource($1,$2,$3,$4) allowed', [
          ws,
          'reviews.comment',
          'document',
          mine,
        ])
      ).allowed,
      true
    )
  );
});
test('scope restrictions intersect private comment audiences', async () => {
  const p = await permissionFor('reviews.view');
  await role('team', {}, p);
  const doc = await document(peer);
  const version = await first(
    "INSERT INTO document_versions(document_id,workspace_id,version_number,sha256,status,created_by) VALUES($1,$2,1,$3,'draft',$4) RETURNING id",
    [doc, ws, '0'.repeat(64), peer]
  );
  await db.exec(
    "DROP POLICY fixture_existing_read ON collaboration_comments;CREATE POLICY fixture_existing_read ON collaboration_comments FOR SELECT TO authenticated USING(audience<>'private' OR author_id=(SELECT auth.uid()) OR (SELECT auth.uid())=ANY(recipient_ids));"
  );
  const internal = await first(
    "INSERT INTO collaboration_comments(workspace_id,document_id,document_version_id,author_id,body,audience) VALUES($1,$2,$3,$4,'Internal','internal') RETURNING id",
    [ws, doc, version.id, outside]
  );
  await db.query(
    "INSERT INTO collaboration_comments(workspace_id,document_id,document_version_id,author_id,body,audience) VALUES($1,$2,$3,$4,'Private','private')",
    [ws, doc, version.id, outside]
  );
  await asUser(actor, async () =>
    assert.deepEqual(
      (await db.query('SELECT id FROM collaboration_comments')).rows.map((row) => row.id),
      [internal.id]
    )
  );
});
test('task children inherit the parent boundary and cannot be moved to a foreign task', async () => {
  await role('own');
  await role('own', {}, editPermission);
  const mine = await task(actor),
    theirs = await task(outside);
  await db.exec(
    'GRANT INSERT,UPDATE,DELETE ON task_checklist_items TO authenticated;CREATE POLICY fixture_task_write ON task_checklist_items FOR ALL TO authenticated USING(true) WITH CHECK(true);'
  );
  const entry = await first(
    'INSERT INTO task_checklist_items(workspace_id,tarea_id) VALUES($1,$2) RETURNING id',
    [ws, mine]
  );
  await db.query('INSERT INTO task_checklist_items(workspace_id,tarea_id) VALUES($1,$2)', [
    ws,
    theirs,
  ]);
  await asUser(actor, async () => {
    assert.deepEqual(
      (await db.query('SELECT id FROM task_checklist_items')).rows.map((row) => row.id),
      [entry.id]
    );
    await fails(
      'UPDATE task_checklist_items SET tarea_id=$1 WHERE id=$2',
      [theirs, entry.id],
      /row-level security/
    );
  });
});
test('root task DML is unavailable directly; action-aware server routes must authorize it', async () => {
  await asUser(actor, async () => {
    const result = await first(
      "SELECT has_table_privilege('authenticated','tareas','UPDATE') writable,has_table_privilege('authenticated','tareas','INSERT') creatable"
    );
    assert.equal(result.writable, false);
    assert.equal(result.creatable, false);
  });
});
test('internal context resolvers and anonymous scope RPCs cannot be called directly', async () => {
  const privileges = await first(
    "SELECT has_function_privilege('authenticated','private.organization_resource_context(uuid,text,uuid,integer)','EXECUTE') context,has_function_privilege('anon','public.organization_can_access_resource(uuid,text,text,uuid)','EXECUTE') anonymous"
  );
  assert.equal(privileges.context, false);
  assert.equal(privileges.anonymous, false);
});

test('assigned form recipients cannot read another recipients response or inflate response totals', async () => {
  const p = await permissionFor('requests.view');
  await role('assigned', {}, p);
  const form = (
    await first(
      "INSERT INTO form_templates(workspace_id,name,created_by,status) VALUES($1,'Synthetic',$2,'published') RETURNING id",
      [ws, owner]
    )
  ).id;
  const responses = [];
  for (const recipient of [actor, outside]) {
    const token = (
      await first(
        "INSERT INTO form_tokens(template_id,recipient_email,recipient_user_id,expires_at) VALUES($1,$2,$3,now()+interval '1 day') RETURNING id",
        [form, `${recipient}@example.invalid`, recipient]
      )
    ).id;
    responses.push(
      (
        await first(
          "INSERT INTO form_responses(token_id,template_id,workspace_id,response_data,field_hashes) VALUES($1,$2,$3,'{}','{}') RETURNING id",
          [token, form, ws]
        )
      ).id
    );
  }
  await asUser(actor, async () => {
    for (let i = 0; i < responses.length; i++)
      assert.equal(
        (
          await first('SELECT organization_can_access_resource($1,$2,$3,$4) allowed', [
            ws,
            'requests.view',
            'form_response',
            responses[i],
          ])
        ).allowed,
        i === 0
      );
    const overview = await first('SELECT * FROM colabora_forms_overview($1)', [ws]);
    assert.equal(Number(overview.response_count), 1);
  });
});

test('an assigned reviewer can access its round, version and document but not an unrelated document', async () => {
  const p = await permissionFor('reviews.view');
  await role('assigned', {}, p);
  const doc = await document(peer),
    other = await document(outside);
  const version = (
    await first(
      "INSERT INTO document_versions(document_id,workspace_id,version_number,sha256,status,created_by) VALUES($1,$2,1,$3,'draft',$4) RETURNING id",
      [doc, ws, '0'.repeat(64), peer]
    )
  ).id;
  const round = (
    await first(
      "INSERT INTO collaboration_review_rounds(workspace_id,document_id,document_version_id,title,requested_by) VALUES($1,$2,$3,'Synthetic',$4) RETURNING id",
      [ws, doc, version, peer]
    )
  ).id;
  await db.query(
    'INSERT INTO collaboration_reviewers(workspace_id,review_round_id,user_id) VALUES($1,$2,$3)',
    [ws, round, actor]
  );
  await asUser(actor, async () => {
    for (const [kind, id] of [
      ['document', doc],
      ['version', version],
      ['review', round],
    ])
      assert.equal(
        (
          await first('SELECT organization_can_access_resource($1,$2,$3,$4) allowed', [
            ws,
            'reviews.view',
            kind,
            id,
          ])
        ).allowed,
        true
      );
    assert.equal(
      (
        await first('SELECT organization_can_access_resource($1,$2,$3,$4) allowed', [
          ws,
          'reviews.view',
          'document',
          other,
        ])
      ).allowed,
      false
    );
  });
});

test('request items and delivered files inherit the responsible persons scope', async () => {
  const p = await permissionFor('requests.view');
  await role('assigned', {}, p);
  const files = [];
  for (const responsible of [actor, outside]) {
    const request = (
      await first(
        "INSERT INTO collaboration_document_requests(workspace_id,folio,title,recipient_name,recipient_email,responsible_user_id,created_by) VALUES($1,$2,'Synthetic','Synthetic','qa@example.invalid',$3,$4) RETURNING id",
        [ws, randomUUID(), responsible, owner]
      )
    ).id;
    const item = (
      await first(
        "INSERT INTO collaboration_request_items(workspace_id,request_id,item_type,title) VALUES($1,$2,'document','Synthetic') RETURNING id",
        [ws, request]
      )
    ).id;
    files.push(
      (
        await first(
          "INSERT INTO collaboration_request_files(workspace_id,request_item_id,original_name,storage_path,mime_type,byte_size,sha256) VALUES($1,$2,'synthetic.pdf','synthetic.pdf','application/pdf',0,$3) RETURNING id",
          [ws, item, '0'.repeat(64)]
        )
      ).id
    );
  }
  await asUser(actor, async () =>
    assert.deepEqual(
      (await db.query('SELECT id FROM collaboration_request_files')).rows.map((row) => row.id),
      [files[0]]
    )
  );
});

test('activity and batch source pickers preserve the same resource boundaries', async () => {
  const p = await permissionFor('collaboration.view_dashboard');
  await role('own', {}, p);
  await role('own');
  const mine = await task(actor),
    theirs = await task(outside),
    events = [];
  for (const resource of [mine, theirs])
    events.push(
      (
        await first(
          "INSERT INTO collaboration_activity_events(workspace_id,actor_user_id,event_type,resource_type,resource_id,summary) VALUES($1,$2,'updated','task',$3,'Synthetic') RETURNING id",
          [ws, outside, resource]
        )
      ).id
    );
  await asUser(actor, async () => {
    assert.deepEqual(
      (await db.query('SELECT id FROM collaboration_activity_events')).rows.map((row) => row.id),
      [events[0]]
    );
    assert.deepEqual(
      (
        await first('SELECT organization_filter_resource_ids($1,$2,$3,$4) ids', [
          ws,
          ['tasks.view'],
          'task',
          [mine, theirs],
        ])
      ).ids,
      [mine]
    );
    assert.equal(
      (await first('SELECT organization_resource_scope_version($1) version', [ws])).version,
      1
    );
    assert.equal(
      (await first('SELECT organization_resource_scope_version($1) version', [otherWs])).version,
      null
    );
  });
});

test('pagination and aggregate totals retain the own scope over a representative page', async (t) => {
  await role('own');
  await db.query(
    "INSERT INTO tareas(id,workspace_id,estado,created_by) SELECT gen_random_uuid(),$1,'nueva',CASE WHEN n%2=0 THEN $2::uuid ELSE $3::uuid END FROM generate_series(1,500) n",
    [ws, actor, outside]
  );
  await asUser(actor, async () => {
    assert.equal(
      Number((await first('SELECT count(*) total FROM tareas WHERE workspace_id=$1', [ws])).total),
      250
    );
    const rows = (
      await db.query(
        'SELECT id,created_by FROM tareas WHERE workspace_id=$1 ORDER BY id LIMIT 100',
        [ws]
      )
    ).rows;
    assert.equal(rows.length, 100);
    assert.ok(rows.every((row) => row.created_by === actor));
    const plan = (
      await db.query(
        'EXPLAIN (ANALYZE,FORMAT JSON) SELECT id FROM tareas WHERE workspace_id=$1 ORDER BY id LIMIT 100',
        [ws]
      )
    ).rows[0]['QUERY PLAN'][0];
    t.diagnostic(
      `PGlite only; 500 synthetic rows; execution ${plan['Execution Time']} ms. This is not a production capacity measurement.`
    );
  });
});

async function automation(createdBy = actor, workspace = ws) {
  return (
    await first(
      "INSERT INTO collaboration_automations(workspace_id,name,status,created_by) VALUES($1,'Synthetic','active',$2) RETURNING id",
      [workspace, createdBy]
    )
  ).id;
}
const workerAllowed = (source, action = 'activity', doc = null, assignee = null) =>
  first("SELECT organization_authorize_automation_action($1,'automation',$2,$3,$4) decision", [
    source,
    action,
    doc,
    assignee,
  ]);
test('workers authorize the persisted principal and reject suspended or expired owners', async () => {
  const p = await permissionFor('automations.manage');
  await role('own', {}, p);
  const source = await automation(),
    doc = await document(actor);
  assert.equal((await workerAllowed(source, 'activity', doc, outside)).decision.allowed, true);
  await db.query("UPDATE workspace_members SET status='suspended' WHERE user_id=$1", [actor]);
  assert.equal((await workerAllowed(source, 'activity', doc)).decision.allowed, false);
  await db.query(
    "UPDATE workspace_members SET status='active',access_expires_at=now()-interval '1 second' WHERE user_id=$1",
    [actor]
  );
  assert.equal((await workerAllowed(source)).decision.allowed, false);
});
test('worker actions keep their document, team, creation and assignment scopes', async () => {
  const p = await permissionFor('automations.manage');
  await role('team', {}, p);
  const source = await automation(),
    inside = await document(peer),
    other = await document(outside);
  assert.equal((await workerAllowed(source, 'activity', inside)).decision.allowed, true);
  assert.equal((await workerAllowed(source, 'activity', other)).decision.allowed, false);
  await role('organization', {}, await permissionFor('tasks.create'));
  assert.equal((await workerAllowed(source, 'create_task', inside, peer)).decision.allowed, false);
  await role('team', {}, await permissionFor('tasks.assign'));
  assert.equal((await workerAllowed(source, 'create_task', inside, peer)).decision.allowed, true);
  assert.equal(
    (await workerAllowed(source, 'create_task', inside, outside)).decision.allowed,
    false
  );
  const foreign = await document(peer);
  await db.query('UPDATE documentos SET workspace_id=$1 WHERE id=$2', [otherWs, foreign]);
  assert.equal((await workerAllowed(source, 'activity', foreign)).decision.allowed, false);
});
test('service-only worker authorization cannot be called by a signed-in browser', async () => {
  const source = await automation(owner);
  await asUser(actor, () =>
    fails(
      "SELECT organization_authorize_automation_action($1,'automation','activity',NULL,NULL)",
      [source],
      /permission denied/
    )
  );
  assert.equal(
    (
      await first(
        "SELECT has_function_privilege('service_role','organization_authorize_automation_action(uuid,text,text,uuid,uuid)','EXECUTE') allowed"
      )
    ).allowed,
    true
  );
  assert.equal(
    (
      await first(
        "SELECT has_function_privilege('authenticated','private.organization_actor_context_allowed(uuid,text,jsonb,uuid)','EXECUTE') allowed"
      )
    ).allowed,
    false
  );
});
test('offboarding rechecks its stored requester inside the processing transition', async () => {
  const p = await permissionFor('members.offboard');
  const r = await role('organization', {}, p),
    job = randomUUID();
  await db.query("INSERT INTO organization_member_offboarding_jobs VALUES($1,$2,$3,'pending')", [
    job,
    ws,
    actor,
  ]);
  await db.query(
    "UPDATE organization_member_offboarding_jobs SET status='processing' WHERE id=$1",
    [job]
  );
  await db.query("UPDATE organization_member_offboarding_jobs SET status='pending' WHERE id=$1", [
    job,
  ]);
  await db.query("UPDATE organization_roles SET status='archived' WHERE id=$1", [r]);
  await fails(
    "UPDATE organization_member_offboarding_jobs SET status='processing' WHERE id=$1",
    [job],
    /organization_offboarding_permission_revoked/
  );
  assert.equal(
    (await first('SELECT status FROM organization_member_offboarding_jobs WHERE id=$1', [job]))
      .status,
    'pending'
  );
});
test('team roles can edit a peers checklist while terminal and foreign tasks remain protected', async () => {
  await role('team');
  await role('team', {}, editPermission);
  const mine = await task(peer),
    other = await task(outside),
    closed = await task(peer);
  await db.query("UPDATE tareas SET estado='completada' WHERE id=$1", [closed]);
  await db.exec('GRANT INSERT,UPDATE,DELETE ON task_checklist_items TO authenticated;');
  await asUser(actor, async () => {
    const item = (
      await first(
        'INSERT INTO task_checklist_items(workspace_id,tarea_id,created_by) VALUES($1,$2,$3) RETURNING id',
        [ws, mine, actor]
      )
    ).id;
    await fails(
      'INSERT INTO task_checklist_items(workspace_id,tarea_id,created_by) VALUES($1,$2,$3)',
      [ws, closed, actor],
      /row-level security/
    );
    await fails(
      'UPDATE task_checklist_items SET tarea_id=$1 WHERE id=$2',
      [other, item],
      /row-level security/
    );
    assert.equal(
      (await db.query('DELETE FROM task_checklist_items WHERE id=$1 RETURNING id', [item])).rows
        .length,
      1
    );
  });
});

test('task mutations recheck assignment, version and permissions inside the write transaction', async () => {
  await role('own', {}, editPermission);
  const mine = await task(actor);
  const mutate = (changes, version = 1) =>
    first("SELECT colabora_mutate_task($1,$2,$3,'update',$4,$5,NULL) data", [
      ws,
      mine,
      actor,
      version,
      changes,
    ]);
  await fails(
    "SELECT colabora_mutate_task($1,$2,$3,'update',1,$4,NULL)",
    [ws, mine, actor, { assigned_to: outside }],
    /organization_mutation_scope_denied/
  );
  assert.equal((await mutate({ prioridad: 'alta' })).data.prioridad, 'alta');
  await fails(
    "SELECT colabora_mutate_task($1,$2,$3,'update',1,'{}',NULL)",
    [ws, mine, actor],
    /task_version_conflict/
  );
  assert.equal(
    Number(
      (await first('SELECT count(*) total FROM task_history WHERE tarea_id=$1', [mine])).total
    ),
    1
  );
  assert.equal(
    (await first('SELECT optimistic_version FROM tareas WHERE id=$1', [mine])).optimistic_version,
    2
  );
  await db.query("UPDATE workspace_members SET status='suspended' WHERE user_id=$1", [actor]);
  await fails(
    "SELECT colabora_mutate_task($1,$2,$3,'start',2,'{}',NULL)",
    [ws, mine, actor],
    /organization_mutation_scope_denied/
  );
});
test('assignment permission cannot be used to change priority or deadline', async () => {
  await role('own', {}, await permissionFor('tasks.assign'));
  const mine = await task(actor);
  await fails(
    "SELECT colabora_mutate_task($1,$2,$3,'reassign',1,$4,NULL)",
    [ws, mine, actor, { prioridad: 'critica' }],
    /organization_mutation_scope_denied/
  );
  assert.equal(
    (await first('SELECT prioridad FROM tareas WHERE id=$1', [mine])).prioridad,
    'media'
  );
});
test('completion requires checklist and a recorded result; verified sources cannot be skipped', async () => {
  await role('own', {}, await permissionFor('tasks.complete'));
  const mine = await task(actor);
  const finish = "SELECT colabora_mutate_task($1,$2,$3,'complete',$5,'{}',$4) data";
  const args = async (reason) => [
    ws,
    mine,
    actor,
    reason,
    (await first('SELECT optimistic_version FROM tareas WHERE id=$1', [mine])).optimistic_version,
  ];
  await fails(finish, await args('Short'), /task_result_required/);
  const item = (
    await first(
      'INSERT INTO task_checklist_items(workspace_id,tarea_id,created_by,done) VALUES($1,$2,$3,false) RETURNING id',
      [ws, mine, actor]
    )
  ).id;
  await fails(finish, await args('Resultado revisado correctamente'), /task_completion_pending/);
  await db.query('UPDATE task_checklist_items SET done=true WHERE id=$1', [item]);
  await db.query("UPDATE tareas SET tipo='firmar_documento',source_type='document' WHERE id=$1", [
    mine,
  ]);
  await fails(
    finish,
    await args('Resultado revisado correctamente'),
    /task_source_action_required/
  );
  assert.equal((await first('SELECT estado FROM tareas WHERE id=$1', [mine])).estado, 'nueva');
  await db.query("UPDATE tareas SET tipo='revisar_documento',source_type=NULL WHERE id=$1", [mine]);
  assert.equal(
    (await first(finish, await args('Resultado revisado correctamente'))).data.estado,
    'completada'
  );
});
test('a future task cannot start through the individual transaction', async () => {
  await role('own', {}, editPermission);
  const mine = await task(actor);
  await db.query("UPDATE tareas SET scheduled_for=now()+interval '1 day' WHERE id=$1", [mine]);
  await fails(
    "SELECT colabora_mutate_task($1,$2,$3,'start',$4,'{}',NULL)",
    [
      ws,
      mine,
      actor,
      (await first('SELECT optimistic_version FROM tareas WHERE id=$1', [mine])).optimistic_version,
    ],
    /task_not_due/
  );
  assert.equal((await first('SELECT estado FROM tareas WHERE id=$1', [mine])).estado, 'nueva');
});
test('workflow executions use their stored creator and reject inactive workflows', async () => {
  const p = await permissionFor('workflows.manage');
  await role('organization', {}, p);
  const source = randomUUID(),
    doc = await document(peer);
  await db.query("INSERT INTO organization_approval_workflows VALUES($1,$2,$3,'active')", [
    source,
    ws,
    actor,
  ]);
  const decision = () =>
    first("SELECT organization_authorize_automation_action($1,'workflow','notify',$2,$3) data", [
      source,
      doc,
      outside,
    ]);
  assert.equal((await decision()).data.principal_id, actor);
  await db.query("UPDATE organization_approval_workflows SET status='archived' WHERE id=$1", [
    source,
  ]);
  assert.equal((await decision()).data.allowed, false);
});
test('bulk updates keep success and failure separate without changing inaccessible or stale rows', async () => {
  await role('own', {}, editPermission);
  const mine = await task(actor),
    other = await task(outside),
    stale = await task(actor);
  const items = [
    { id: mine, optimistic_version: 1 },
    { id: other, optimistic_version: 1 },
    { id: stale, optimistic_version: 9 },
  ];
  const result = (
    await first("SELECT colabora_bulk_mutate_tasks($1,$2,$3,'update',$4) data", [
      ws,
      actor,
      items,
      { prioridad: 'critica' },
    ])
  ).data;
  assert.equal(result.filter((row) => row.success).length, 1);
  assert.equal(result.find((row) => row.id === other).code, 'organization_mutation_scope_denied');
  assert.equal(result.find((row) => row.id === stale).code, 'task_version_conflict');
  assert.equal(
    (await first('SELECT prioridad FROM tareas WHERE id=$1', [other])).prioridad,
    'media'
  );
  assert.equal(
    (await first('SELECT prioridad FROM tareas WHERE id=$1', [mine])).prioridad,
    'critica'
  );
  await asUser(actor, () =>
    fails(
      "SELECT colabora_mutate_task($1,$2,$3,'start',1,'{}',NULL)",
      [ws, mine, actor],
      /permission denied/
    )
  );
});
test('the optimized permission list matches precise grants and excludes limited administration', async () => {
  await role('own', {}, editPermission);
  await role('own', {}, await permissionFor('roles.manage'));
  await asUser(actor, async () =>
    assert.deepEqual(
      (
        await db.query('SELECT permission_key FROM get_my_organization_permissions($1)', [ws])
      ).rows.map((row) => row.permission_key),
      ['tasks.edit']
    )
  );
  await role('organization', {}, permission);
  await asUser(actor, async () =>
    assert.deepEqual(
      (
        await db.query('SELECT permission_key FROM get_my_organization_permissions($1)', [ws])
      ).rows.map((row) => row.permission_key),
      ['tasks.edit', 'tasks.view']
    )
  );
});
test('broad list permissions use a query-level workspace set without widening edit or child scopes', async (t) => {
  await role('organization');
  await role('own', {}, editPermission);
  await db.query(
    "INSERT INTO tareas(id,workspace_id,estado,created_by) SELECT gen_random_uuid(),$1,'nueva',$2 FROM generate_series(1,500)",
    [ws, peer]
  );
  const foreign = await task(actor, null, otherWs);
  await asUser(actor, async () => {
    assert.equal(Number((await first('SELECT count(*) total FROM tareas')).total), 500);
    assert.equal((await allowed(foreign)).allowed, false);
    assert.equal(
      (
        await first(
          "SELECT organization_can_access_resource($1,'tasks.edit','task',id) allowed FROM tareas LIMIT 1",
          [ws]
        )
      ).allowed,
      false
    );
    const plan = (
      await db.query('EXPLAIN (ANALYZE,FORMAT JSON) SELECT id FROM tareas ORDER BY id LIMIT 100')
    ).rows[0]['QUERY PLAN'][0];
    t.diagnostic(
      `Broad access PGlite only: ${plan['Execution Time']} ms; not a production capacity measurement.`
    );
  });
});
test('broad RLS grants still reject a task or child whose parent belongs to another workspace', async () => {
  await role('organization');
  const space = (
    await first(
      "INSERT INTO collaboration_spaces(workspace_id,name,space_type,created_by) VALUES($1,'Foreign','project',$2) RETURNING id",
      [otherWs, owner]
    )
  ).id;
  const malformed = await task(peer);
  await db.query('UPDATE tareas SET collaboration_space_id=$1 WHERE id=$2', [space, malformed]);
  await db.query(
    'INSERT INTO task_checklist_items(workspace_id,tarea_id,created_by) VALUES($1,$2,$3)',
    [ws, malformed, peer]
  );
  await asUser(actor, async () => {
    assert.equal((await db.query('SELECT id FROM tareas')).rows.length, 0);
    assert.equal((await db.query('SELECT id FROM task_checklist_items')).rows.length, 0);
  });
});
test('directory uploads version and audit atomically, retain pending status and finalize idempotently', async () => {
  await role('organization', {}, await permissionFor('directory.manage'));
  const person = randomUUID();
  await db.query('INSERT INTO organization_directory_people VALUES($1,$2)', [person, ws]);
  const create = async (id) => {
    const values = {
      person_id: person,
      evidence_type: 'appointment',
      display_name: 'Synthetic',
      storage_path: `${ws}/${person}/${id}-synthetic.pdf`,
      mime_type: 'application/pdf',
      size_bytes: 8,
      sha256_hash: '0'.repeat(64),
      file_name: 'synthetic.pdf',
      status: 'verified',
    };
    return first('SELECT finalize_organization_directory_evidence($1,$2,$3,$4) id', [
      ws,
      actor,
      id,
      values,
    ]);
  };
  const a = randomUUID(),
    b = randomUUID();
  await create(a);
  await create(a);
  await create(b);
  const rows = (
    await db.query('SELECT id,version,status FROM organization_directory_evidence ORDER BY version')
  ).rows;
  assert.deepEqual(
    rows.map((row) => row.version),
    [1, 2]
  );
  assert.ok(rows.every((row) => row.status === 'pending'));
  assert.equal(
    Number(
      (
        await first(
          "SELECT count(*) total FROM organization_audit_events WHERE event_type='directory.evidence.uploaded'"
        )
      ).total
    ),
    2
  );
  await db.query("UPDATE workspace_members SET status='suspended' WHERE user_id=$1", [actor]);
  await fails(
    'SELECT finalize_organization_directory_evidence($1,$2,$3,$4)',
    [ws, actor, randomUUID(), {}],
    /organization_permission_denied/
  );
});
test('a failed upload audit rolls the evidence record back with its transaction', async () => {
  await role('organization', {}, await permissionFor('directory.manage'));
  const person = randomUUID(),
    id = randomUUID();
  await db.query('INSERT INTO organization_directory_people VALUES($1,$2)', [person, ws]);
  await db.exec(
    "CREATE FUNCTION pg_temp.reject_evidence_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic_audit_unavailable';END;$$;CREATE TRIGGER reject_evidence_audit BEFORE INSERT ON organization_audit_events FOR EACH ROW WHEN(NEW.event_type='directory.evidence.uploaded') EXECUTE FUNCTION pg_temp.reject_evidence_audit();"
  );
  const values = {
    person_id: person,
    evidence_type: 'appointment',
    display_name: 'Synthetic',
    storage_path: `${ws}/${person}/${id}-synthetic.pdf`,
    mime_type: 'application/pdf',
    size_bytes: 8,
    sha256_hash: '0'.repeat(64),
    file_name: 'synthetic.pdf',
  };
  await fails(
    'SELECT finalize_organization_directory_evidence($1,$2,$3,$4)',
    [ws, actor, id, values],
    /synthetic_audit_unavailable/
  );
  assert.equal(
    Number((await first('SELECT count(*) total FROM organization_directory_evidence')).total),
    0
  );
  assert.equal(
    (
      await first(
        "SELECT has_function_privilege('authenticated','finalize_organization_directory_evidence(uuid,uuid,uuid,jsonb)','EXECUTE') allowed"
      )
    ).allowed,
    false
  );
});

test('the evidence transaction rejects absent required metadata rather than accepting SQL nulls', async () => {
  await role('organization', {}, await permissionFor('directory.manage'));
  const person = randomUUID(),
    id = randomUUID();
  await db.query('INSERT INTO organization_directory_people VALUES($1,$2)', [person, ws]);
  await fails(
    'SELECT finalize_organization_directory_evidence($1,$2,$3,$4)',
    [
      ws,
      actor,
      id,
      {
        person_id: person,
        storage_path: `${ws}/${person}/${id}-synthetic.pdf`,
        evidence_type: 'appointment',
        display_name: 'Synthetic',
        mime_type: 'application/pdf',
        size_bytes: 8,
        file_name: 'synthetic.pdf',
      },
    ],
    /catalog_fields_invalid/
  );
  assert.equal(
    Number((await first('SELECT count(*) total FROM organization_directory_evidence')).total),
    0
  );
});
