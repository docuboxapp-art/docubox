import assert from 'node:assert/strict';
import test from 'node:test';
import { canAccessOrganizationSection, filterOrganizationNavigation } from './navigation.ts';

const items = [
  { href: '/organizacion', permission: 'organization.read' },
  { href: '/organizacion/miembros', permission: 'members.read' },
  { href: '/organizacion/auditoria', permission: 'audit.read' },
];

test('owner and admin can see every organization section', () => {
  assert.equal(filterOrganizationNavigation(items, 'owner', []).length, 3);
  assert.equal(filterOrganizationNavigation(items, 'admin', []).length, 3);
});

test('member navigation is limited to effective permissions', () => {
  assert.deepEqual(
    filterOrganizationNavigation(items, 'member', ['organization.read', 'members.read']).map((item) => item.href),
    ['/organizacion', '/organizacion/miembros'],
  );
});

test('a missing permission fails closed', () => {
  assert.equal(canAccessOrganizationSection('member', [], 'security.read'), false);
});

test('an item without a permission remains available', () => {
  assert.equal(canAccessOrganizationSection('member', []), true);
});
