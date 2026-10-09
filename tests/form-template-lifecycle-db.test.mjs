import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

// Isolated PostgreSQL/WASM. Install only in the ignored test prefix:
// npm install --prefix .tmp/form-wizard-db --no-save --package-lock=false @electric-sql/pglite
const runtime = resolve('.tmp/form-wizard-db/node_modules/@electric-sql/pglite/dist');
test(
  'form version migration: real SQL, grants, RLS and lifecycle in isolated PostgreSQL',
  { skip: !existsSync(runtime) && 'PGlite test runtime not installed' },
  async (t) => {
    const { PGlite } = await import(pathToFileURL(resolve(runtime, 'index.js')).href);
    const { pgcrypto } = await import(pathToFileURL(resolve(runtime, 'contrib/pgcrypto.js')).href);
    const db = new PGlite({ extensions: { pgcrypto } });
    t.after(() => db.close());
    const A = 'aaaaaaaa-0000-4000-8000-000000000001';
    const B = 'bbbbbbbb-0000-4000-8000-000000000001';
    const C = 'cccccccc-0000-4000-8000-000000000001';
    const workflowA = 'aaaaaaaa-0000-4000-8000-000000000003';
    const workflowB = 'bbbbbbbb-0000-4000-8000-000000000003';
    const docA = 'aaaaaaaa-0000-4000-8000-000000000002';
    const docB = 'bbbbbbbb-0000-4000-8000-000000000002';
    const archivedLegacy = 'aaaaaaaa-0000-4000-8000-000000000004';
    await db.exec(`CREATE EXTENSION pgcrypto;
    CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    CREATE TABLE public.workspaces(id uuid PRIMARY KEY, owner_id uuid, workspace_type text, organization_settings jsonb DEFAULT '{}');
    CREATE TABLE public.workspace_members(workspace_id uuid, user_id uuid, role text DEFAULT 'member');
    CREATE TABLE public.documentos(id uuid PRIMARY KEY);
    CREATE TABLE public.organization_approval_workflows(id uuid PRIMARY KEY, workspace_id uuid, status text);
    CREATE TABLE public.organization_workflow_instances(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid, workflow_id uuid,
      subject_type text, subject_id text, status text DEFAULT 'active', started_by uuid
    );
    INSERT INTO auth.users VALUES ('${A}'), ('${B}'), ('${C}');
    INSERT INTO public.workspaces(id,owner_id,workspace_type,organization_settings) VALUES
      ('${A}','${A}','personal','{}'),
      ('${B}','${B}','business','{"default_workflow_id":"${workflowB}"}');
    INSERT INTO public.workspace_members VALUES ('${A}','${A}','owner'), ('${B}','${B}','owner'), ('${B}','${C}','member');
    INSERT INTO public.organization_approval_workflows VALUES ('${workflowA}','${A}','published'), ('${workflowB}','${B}','published');
    CREATE FUNCTION public.has_organization_permission(ws_id uuid, requested_permission text)
    RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT EXISTS (SELECT 1 FROM public.workspace_members
      WHERE workspace_id=ws_id AND user_id=auth.uid() AND role='owner')
    $$;
    CREATE FUNCTION public.start_organization_workflow_instance(
      ws_id uuid, target_workflow_id uuid, requested_subject_type text,
      requested_subject_id text, requested_context jsonb, requested_idempotency_key uuid
    ) RETURNS uuid LANGUAGE plpgsql AS $$
    DECLARE result uuid;
    BEGIN
      IF NOT public.has_organization_permission(ws_id, 'workflows.execute') THEN
        RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE='42501';
      END IF;
      INSERT INTO public.organization_workflow_instances(workspace_id,workflow_id,subject_type,subject_id,started_by)
      VALUES (ws_id,target_workflow_id,requested_subject_type,requested_subject_id,auth.uid())
      RETURNING id INTO result;
      RETURN result;
    END; $$;`);
    await db.exec(
      readFileSync('supabase/migrations/20260511200000_form_builder_module.sql', 'utf8')
    );
    // Only the canonical form-template extension is needed, not the unrelated response engine.
    const canonical = readFileSync(
      'supabase/migrations/20260802010000_formularios_firmables.sql',
      'utf8'
    );
    await db.exec(
      canonical.slice(0, canonical.indexOf('CREATE TABLE IF NOT EXISTS public.form_sections'))
    );
    const fields = JSON.stringify([{ id: 'name', type: 'text', label: 'Name', slug: 'name' }]);
    for (const [id, workspace] of [
      [docA, A],
      [docB, B],
    ]) {
      await db.query(
        `INSERT INTO public.form_templates(id,workspace_id,created_by,name,status,schema,settings) VALUES ($1,$2,$2,'Synthetic','published',$3,'{"requiresSignature":true,"allowedSignatureTypes":["click_sign"]}')`,
        [id, workspace, fields]
      );
    }
    await db.query(
      `INSERT INTO public.form_templates(id,workspace_id,created_by,name,status,schema,settings) VALUES ($1,$2,$2,'Legacy archive','archived',$3,'{}')`,
      [archivedLegacy, A, fields]
    );
    await db.exec(
      readFileSync('supabase/migrations/20261004062701_form_template_version_lifecycle.sql', 'utf8')
    );
    await db.exec(
      readFileSync('supabase/migrations/20261004062751_form_template_governed_lifecycle.sql', 'utf8')
    );
    await db.exec(
      readFileSync('supabase/migrations/20261006200813_form_template_revisions.sql', 'utf8')
    );
    await db.exec(
      readFileSync('supabase/migrations/20261006222253_defer_form_signature_method_selection.sql', 'utf8')
    );
    await db.exec(`GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
    GRANT SELECT,INSERT,UPDATE,DELETE ON public.form_templates,public.form_tokens,public.form_responses TO authenticated;
    GRANT SELECT ON public.workspaces,public.organization_approval_workflows,public.organization_workflow_instances,public.workspace_members TO authenticated;
    GRANT UPDATE ON public.organization_workflow_instances TO authenticated;`);
    const asUser = async (id) => {
      await db.exec('RESET ROLE');
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [id]);
      await db.exec('SET ROLE authenticated');
    };
    await asUser(A);

    await t.test('existing publications migrate without losing content', async () => {
      const { rows } = await db.query('SELECT * FROM public.form_templates WHERE id=$1', [docA]);
      assert.equal(rows[0].version_number, 1);
      assert.ok(rows[0].published_at);
      assert.equal(rows[0].schema[0].slug, 'name');
      const legacy = (await db.query('SELECT archived_from_status FROM public.form_templates WHERE id=$1', [archivedLegacy])).rows[0];
      assert.equal(legacy.archived_from_status, 'closed');
    });

    await t.test('closed forms migrate to paused without losing content or reactivation', async () => {
      await db.query("UPDATE public.form_templates SET status='closed' WHERE id=$1", [docA]);
      const before = (await db.query('SELECT * FROM public.form_templates WHERE id=$1', [docA])).rows[0];
      await db.exec('RESET ROLE');
      await db.exec(readFileSync('supabase/migrations/20261007061018_remove_closed_form_status.sql', 'utf8'));
      await asUser(A);
      const after = (await db.query('SELECT * FROM public.form_templates WHERE id=$1', [docA])).rows[0];
      assert.equal(after.status, 'paused');
      const { status: beforeStatus, updated_at: beforeUpdated, ...beforeContent } = before;
      const { status: afterStatus, updated_at: afterUpdated, ...afterContent } = after;
      assert.deepEqual(afterContent, beforeContent);
      assert.equal((await db.query('SELECT archived_from_status FROM public.form_templates WHERE id=$1', [archivedLegacy])).rows[0].archived_from_status, 'paused');
      const triggers = (await db.query("SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.form_templates'::regclass AND tgname='zz_guard_form_template_lifecycle'")).rows;
      assert.equal(triggers[0].tgenabled, 'O');
      await assert.rejects(db.query("UPDATE public.form_templates SET status='closed' WHERE id=$1", [docA]), /check constraint/);
      await db.query("UPDATE public.form_templates SET status='published' WHERE id=$1", [docA]);
    });

    await t.test(
      'A and B cannot read or version each other, including direct family inserts',
      async () => {
        for (const [user, other, otherDoc] of [
          [A, B, docB],
          [B, A, docA],
        ]) {
          await asUser(user);
          assert.equal(
            (await db.query('SELECT * FROM public.form_templates WHERE workspace_id=$1', [other]))
              .rows.length,
            0
          );
          await assert.rejects(
            db.query('SELECT * FROM public.create_form_template_version($1)', [otherDoc]),
            /not accessible/
          );
          await assert.rejects(
            db.query(
              `INSERT INTO public.form_templates(workspace_id,created_by,name,root_template_id) VALUES ($1,$1,'Forged',$2)`,
              [user, otherDoc]
            ),
            /not accessible/
          );
        }
        await asUser(A);
      }
    );

    let draft;
    await t.test('authorized version is a separate draft; source remains published', async () => {
      draft = (await db.query('SELECT * FROM public.create_form_template_version($1)', [docA]))
        .rows[0];
      assert.equal(draft.version_number, 2);
      assert.equal(draft.status, 'draft');
      assert.equal(draft.root_template_id, docA);
      assert.notEqual(draft.id, docA);
      assert.equal(draft.published_at, null);
      assert.equal(
        (await db.query('SELECT status FROM public.form_templates WHERE id=$1', [docA])).rows[0]
          .status,
        'published'
      );
    });

    await t.test('same-number revision preserves the original published row and its links', async () => {
      await db.query(
        "INSERT INTO public.form_tokens(template_id,recipient_email,expires_at) VALUES ($1,'revision@example.invalid',now()+interval '1 day')",
        [docA]
      );
      const revision = (await db.query('SELECT * FROM public.create_form_template_revision($1)', [docA])).rows[0];
      assert.equal(revision.version_number, 1);
      assert.equal(revision.revision_number, 2);
      assert.equal(revision.source_template_id, docA);
      assert.equal(revision.status, 'draft');
      await db.query('UPDATE public.form_templates SET name=$1,publication_comment=$2 WHERE id=$3',
        ['Revised form', 'Clarified questions', revision.id]);
      await db.query("UPDATE public.form_templates SET status='published' WHERE id=$1", [revision.id]);
      const original = (await db.query('SELECT name,status,revision_number FROM public.form_templates WHERE id=$1', [docA])).rows[0];
      assert.equal(original.name, 'Synthetic');
      assert.equal(original.status, 'published');
      assert.equal(original.revision_number, 1);
      assert.equal((await db.query('SELECT template_id FROM public.form_tokens WHERE recipient_email=$1',
        ['revision@example.invalid'])).rows[0].template_id, docA);
      await assert.rejects(db.query('UPDATE public.form_templates SET publication_comment=$1 WHERE id=$2',
        ['changed', revision.id]));
      await assert.rejects(db.query('UPDATE public.form_templates SET revision_number=9 WHERE id=$1', [revision.id]));
      const nextRevision = (await db.query('SELECT * FROM public.create_form_template_revision($1)', [revision.id])).rows[0];
      assert.equal(nextRevision.version_number, 1);
      assert.equal(nextRevision.revision_number, 3);
      await assert.rejects(db.query('SELECT * FROM public.create_form_template_revision($1)', [docA]), /latest revision/);
    });

    await t.test('published schema and identity cannot be overwritten or downgraded', async () => {
      for (const mutation of [
        "name='Changed'",
        "schema='[]'",
        "settings='{}'",
        `pdf_schema='{"header":"Changed"}'`,
        "status='draft'",
        'version_number=99',
        `workspace_id='${B}'`,
      ]) {
        await assert.rejects(
          db.query(`UPDATE public.form_templates SET ${mutation} WHERE id=$1`, [docA]),
          undefined,
          mutation
        );
      }
    });

    await t.test(
      'draft edits and publication succeed; invalid publication is rejected',
      async () => {
        await db.query(
          "UPDATE public.form_templates SET name='Version two', schema='[]' WHERE id=$1",
          [draft.id]
        );
        await assert.rejects(
          db.query("UPDATE public.form_templates SET status='published' WHERE id=$1", [draft.id]),
          /at least one field/
        );
        await db.query('UPDATE public.form_templates SET schema=$1 WHERE id=$2', [
          fields,
          draft.id,
        ]);
        await db.query("UPDATE public.form_templates SET status='published' WHERE id=$1", [
          draft.id,
        ]);
        const published = (
          await db.query('SELECT * FROM public.form_templates WHERE id=$1', [draft.id])
        ).rows[0];
        assert.equal(published.name, 'Version two');
        assert.ok(published.published_at);
        await assert.rejects(
          db.query("UPDATE public.form_templates SET name='Overwrite' WHERE id=$1", [draft.id])
        );
      }
    );

    await t.test('personal publication remains direct even with stale workflow settings', async () => {
      await db.exec('RESET ROLE');
      await db.query("UPDATE public.workspaces SET organization_settings=$1 WHERE id=$2", [
        JSON.stringify({ default_workflow_id: workflowA }), A,
      ]);
      await asUser(A);
      const candidate = (await db.query('SELECT * FROM public.create_form_template_version($1)', [docA])).rows[0];
      await db.query("UPDATE public.form_templates SET status='published' WHERE id=$1", [candidate.id]);
      assert.equal((await db.query('SELECT status FROM public.form_templates WHERE id=$1', [candidate.id])).rows[0].status, 'published');
      await db.exec('RESET ROLE');
      await db.query("UPDATE public.workspaces SET organization_settings='{}' WHERE id=$1", [A]);
      await asUser(A);
    });

    await t.test('published forms pause and resume without changing the version; closing is rejected', async () => {
      await db.query("UPDATE public.form_templates SET status='paused' WHERE id=$1", [draft.id]);
      assert.equal((await db.query('SELECT status FROM public.form_templates WHERE id=$1', [draft.id])).rows[0].status, 'paused');
      await db.query("UPDATE public.form_templates SET status='published' WHERE id=$1", [draft.id]);
      assert.equal((await db.query('SELECT status FROM public.form_templates WHERE id=$1', [draft.id])).rows[0].status, 'published');
      await assert.rejects(db.query("UPDATE public.form_templates SET status='closed' WHERE id=$1", [draft.id]), /check constraint/);
      const resumed = (await db.query('SELECT status,version_number FROM public.form_templates WHERE id=$1', [draft.id])).rows[0];
      assert.equal(resumed.status, 'published');
      assert.equal(resumed.version_number, 2);
    });

    await t.test('organization approval gates publication and follows workflow decisions', async () => {
      await asUser(B);
      const candidate = (await db.query('SELECT * FROM public.create_form_template_version($1)', [docB])).rows[0];
      await assert.rejects(
        db.query("UPDATE public.form_templates SET status='published' WHERE id=$1", [candidate.id]),
        /submit for approval/
      );
      const request = await db.query(
        'SELECT public.submit_form_for_approval($1,$2,$3,$4,$5) AS id',
        [B, candidate.id, workflowB, { publication_comment: 'Revisar' }, crypto.randomUUID()]
      );
      const instanceId = request.rows[0].id;
      assert.equal((await db.query('SELECT status FROM public.form_templates WHERE id=$1', [candidate.id])).rows[0].status, 'in_review');
      await assert.rejects(db.query("UPDATE public.form_templates SET name='Changed' WHERE id=$1", [candidate.id]));
      await assert.rejects(db.query("UPDATE public.form_templates SET status='published' WHERE id=$1", [candidate.id]));
      await db.query("UPDATE public.organization_workflow_instances SET status='approved' WHERE id=$1", [instanceId]);
      const approved = (await db.query('SELECT status,published_at FROM public.form_templates WHERE id=$1', [candidate.id])).rows[0];
      assert.equal(approved.status, 'published');
      assert.ok(approved.published_at);

      const rejected = (await db.query('SELECT * FROM public.create_form_template_version($1)', [candidate.id])).rows[0];
      const rejectedRequest = await db.query(
        'SELECT public.submit_form_for_approval($1,$2,$3,$4,$5) AS id',
        [B, rejected.id, workflowB, {}, crypto.randomUUID()]
      );
      await db.query("UPDATE public.organization_workflow_instances SET status='rejected' WHERE id=$1", [rejectedRequest.rows[0].id]);
      assert.equal((await db.query('SELECT status FROM public.form_templates WHERE id=$1', [rejected.id])).rows[0].status, 'draft');
      await db.query("UPDATE public.form_templates SET name='Corrected' WHERE id=$1", [rejected.id]);
      const expiredRequest = await db.query(
        'SELECT public.submit_form_for_approval($1,$2,$3,$4,$5) AS id',
        [B, rejected.id, workflowB, {}, crypto.randomUUID()]
      );
      await db.query("UPDATE public.organization_workflow_instances SET status='expired' WHERE id=$1", [expiredRequest.rows[0].id]);
      assert.equal((await db.query('SELECT status FROM public.form_templates WHERE id=$1', [rejected.id])).rows[0].status, 'draft');
      await asUser(C);
      await assert.rejects(db.query('SELECT * FROM public.create_form_template_version($1)', [docB]), /permission/);
      await assert.rejects(db.query('SELECT * FROM public.create_form_template_revision($1)', [docB]), /permission/);
      await assert.rejects(
        db.query('SELECT public.submit_form_for_approval($1,$2,$3,$4,$5)', [B, rejected.id, workflowB, {}, crypto.randomUUID()]),
        /permission/
      );
      await asUser(A);
    });

    await t.test('draft-only deletion, references and archive protect issued links', async () => {
      const unused = (
        await db.query('SELECT * FROM public.create_form_template_version($1)', [docA])
      ).rows[0];
      await db.query('DELETE FROM public.form_templates WHERE id=$1', [unused.id]);
      await assert.rejects(
        db.query('DELETE FROM public.form_templates WHERE id=$1', [docA]),
        /Only unused drafts/
      );
      const linked = (
        await db.query('SELECT * FROM public.create_form_template_version($1)', [docA])
      ).rows[0];
      await db.query(
        "INSERT INTO public.form_tokens(template_id,recipient_email,expires_at) VALUES ($1,'synthetic@example.invalid',now()+interval '1 day')",
        [linked.id]
      );
      await assert.rejects(
        db.query('DELETE FROM public.form_templates WHERE id=$1', [linked.id]),
        /Only unused drafts/
      );
      await db.query("UPDATE public.form_templates SET status='archived' WHERE id=$1", [docA]);
      assert.equal((await db.query('SELECT archived_from_status FROM public.form_templates WHERE id=$1', [docA])).rows[0].archived_from_status, 'published');
      await assert.rejects(db.query("UPDATE public.form_templates SET status='draft' WHERE id=$1", [docA]));
      await db.query("UPDATE public.form_templates SET status='published' WHERE id=$1", [docA]);
      assert.equal((await db.query('SELECT status,archived_at FROM public.form_templates WHERE id=$1', [docA])).rows[0].status, 'published');
    });

    await t.test('version creation rolls back atomically', async () => {
      const before = (await db.query('SELECT count(*)::int AS n FROM public.form_templates'))
        .rows[0].n;
      await db.exec('BEGIN');
      await db.query('SELECT * FROM public.create_form_template_version($1)', [docA]);
      await db.exec('ROLLBACK');
      assert.equal(
        (await db.query('SELECT count(*)::int AS n FROM public.form_templates')).rows[0].n,
        before
      );
    });

    await t.test('anonymous execution is revoked', async () => {
      await db.exec('RESET ROLE; SET ROLE anon');
      await assert.rejects(
        db.query('SELECT * FROM public.create_form_template_version($1)', [docA]),
        /permission denied/
      );
      await assert.rejects(
        db.query('SELECT * FROM public.create_form_template_revision($1)', [docA]),
        /permission denied/
      );
      await assert.rejects(db.query('SELECT * FROM public.form_templates'), /permission denied/);
      await db.exec('RESET ROLE');
    });
  }
);
