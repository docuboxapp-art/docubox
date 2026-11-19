import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PGlite } = require('../.tmp/colabora-db-qa/node_modules/@electric-sql/pglite');

test('organization RPC hardening preserves permitted callers and trigger provisioning', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE FUNCTION public.bootstrap_business_organization(uuid,uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN;END$$;
      CREATE FUNCTION public.organization_trigger() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN PERFORM public.bootstrap_business_organization(NEW.id,NEW.id);RETURN NEW;END$$;
      CREATE FUNCTION public.organization_browser_rpc() RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
      CREATE FUNCTION public.organization_worker_rpc() RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
      REVOKE ALL ON FUNCTION public.organization_worker_rpc() FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.organization_worker_rpc() TO service_role;
      CREATE FUNCTION public.unrelated_rpc() RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
      CREATE TABLE public.fixture(id uuid);
      CREATE TRIGGER fixture BEFORE INSERT ON public.fixture FOR EACH ROW EXECUTE FUNCTION public.organization_trigger();`);
    const sql = await readFile(
      'supabase/migrations/20261118162322_organization_rpc_privilege_hardening.sql',
      'utf8'
    );
    await db.exec(sql);
    await db.exec(sql);
    const allowed = async (role, signature) =>
      (await db.query("SELECT has_function_privilege($1,$2,'EXECUTE') allowed", [role, signature]))
        .rows[0].allowed;
    assert.equal(await allowed('anon', 'organization_browser_rpc()'), false);
    assert.equal(await allowed('authenticated', 'organization_browser_rpc()'), true);
    assert.equal(await allowed('authenticated', 'organization_worker_rpc()'), false);
    assert.equal(await allowed('service_role', 'organization_worker_rpc()'), true);
    assert.equal(
      await allowed('authenticated', 'bootstrap_business_organization(uuid,uuid)'),
      false
    );
    assert.equal(await allowed('anon', 'bootstrap_business_organization(uuid,uuid)'), false);
    assert.equal(await allowed('authenticated', 'organization_trigger()'), false);
    assert.equal(await allowed('anon', 'unrelated_rpc()'), true);
    await db.exec('INSERT INTO fixture VALUES(gen_random_uuid())');
    assert.equal((await db.query('SELECT count(*)::integer total FROM fixture')).rows[0].total, 1);
  } finally {
    await db.close();
  }
});
