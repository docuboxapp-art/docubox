import assert from 'node:assert/strict';
import test from 'node:test';
import { organizationRoleScopeSchema, isResourceScopedPermission } from './resource-scope.ts';
const unit = '11111111-1111-4111-8111-111111111111';
test('unit scopes require explicit selections and normalize duplicate ids', () => {
  assert.equal(
    organizationRoleScopeSchema.safeParse({ scope_type: 'units', scope_config: { unit_ids: [] } })
      .success,
    false
  );
  assert.deepEqual(
    organizationRoleScopeSchema.parse({
      scope_type: 'units',
      scope_config: { unit_ids: [unit, unit] },
    }).scope_config,
    { unit_ids: [unit] }
  );
});
test('custom scopes require a non-empty combination of allowed criteria', () => {
  for (const config of [
    {},
    { unit_ids: [], include_own: false, include_assigned: false },
    { include_own: 'true' },
    { all: true },
  ])
    assert.equal(
      organizationRoleScopeSchema.safeParse({ scope_type: 'custom', scope_config: config }).success,
      false
    );
  assert.equal(
    organizationRoleScopeSchema.safeParse({
      scope_type: 'custom',
      scope_config: { include_assigned: true },
    }).success,
    true
  );
});
test('simple scopes reject hidden configuration that could widen access', () => {
  for (const type of ['own', 'assigned', 'team', 'organization'])
    assert.equal(
      organizationRoleScopeSchema.safeParse({
        scope_type: type,
        scope_config: { unit_ids: [unit] },
      }).success,
      false
    );
});
test('administration requires organization-wide scope while resource actions support row scopes', () => {
  for (const key of [
    'tasks.edit',
    'requests.review_items',
    'rooms.manage_guests',
    'collaboration.view_dashboard',
  ])
    assert.equal(isResourceScopedPermission(key), true);
  for (const key of [
    'roles.manage',
    'members.update',
    'security.manage',
    'subscription.manage_addons',
    'reports.export',
    'tasksX.view',
  ])
    assert.equal(isResourceScopedPermission(key), false);
});
