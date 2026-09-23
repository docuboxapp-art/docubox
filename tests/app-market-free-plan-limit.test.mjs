import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  FREE_PLAN_MODULE_LIMIT,
  toggleFreePlanModule,
} from '../src/lib/app-market/module-selection.ts';

const marketSource = fs.readFileSync(
  path.join(process.cwd(), 'src', 'app', 'app-market', 'page.tsx'),
  'utf8'
);
const migrationSource = fs.readFileSync(
  path.join(process.cwd(), 'supabase', 'migrations', '20260921082806_free_plan_two_apps.sql'),
  'utf8'
);

test('the free plan accepts two apps and rejects a third', () => {
  assert.equal(FREE_PLAN_MODULE_LIMIT, 2);
  const first = toggleFreePlanModule([], 'plantillas');
  const second = toggleFreePlanModule(first.nextIds, 'formularios');
  const third = toggleFreePlanModule(second.nextIds, 'expedientes');

  assert.deepEqual(second.nextIds, ['plantillas', 'formularios']);
  assert.equal(third.accepted, false);
  assert.deepEqual(third.nextIds, second.nextIds);
});

test('an installed app can be removed without affecting the other one', () => {
  const result = toggleFreePlanModule(['plantillas', 'formularios'], 'plantillas');
  assert.equal(result.accepted, true);
  assert.deepEqual(result.nextIds, ['formularios']);
});

test('App Market communicates the two-app allowance', () => {
  assert.match(marketSource, /2 aplicaciones incluidas/);
  assert.match(marketSource, /hasta dos aplicaciones/);
  assert.match(marketSource, /de \{FREE_PLAN_MODULE_LIMIT\} aplicaciones activas/);
});

test('the database preserves the legacy selection and enforces the limit', () => {
  assert.match(migrationSource, /active_module_ids TEXT\[\]/);
  assert.match(migrationSource, /SET active_module_ids = ARRAY\[active_module_id\]/);
  assert.match(migrationSource, /cardinality\(active_module_ids\) <= 2/);
  assert.match(migrationSource, /\(SELECT auth\.uid\(\)\) = user_id/);
});
