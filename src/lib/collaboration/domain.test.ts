import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canUseCollaboration,
  hasCollaborationEntitlement,
  hasCollaborationPro,
  normalizeCollaborationAccess,
} from './domain.ts';

test('access normalization fails closed', () => {
  const access = normalizeCollaborationAccess(null);
  assert.equal(access.accessible, false);
  assert.equal(canUseCollaboration(access), false);
});

test('an active entitlement still enforces granular permissions', () => {
  const access = normalizeCollaborationAccess({
    eligible: true,
    accessible: true,
    write_allowed: true,
    code: 'OK',
    membership_role: 'member',
    permissions: ['tasks.view'],
  });
  assert.equal(canUseCollaboration(access, 'tasks.view'), true);
  assert.equal(canUseCollaboration(access, 'tasks.create', true), false);
});

test('read-only access rejects mutations', () => {
  const access = normalizeCollaborationAccess({
    eligible: true,
    accessible: true,
    write_allowed: false,
    code: 'READ_ONLY',
    membership_role: 'admin',
  });
  assert.equal(canUseCollaboration(access, 'tasks.view'), true);
  assert.equal(canUseCollaboration(access, 'tasks.edit', true), false);
});

test('standard analytics does not satisfy an advanced Pro requirement', () => {
  const access = normalizeCollaborationAccess({
    eligible: true,
    accessible: true,
    write_allowed: true,
    commercial_tier: 'standard',
    entitlements: {
      collaboration_analytics: { status: 'active', access_level: 'basic' },
    },
  });
  assert.equal(
    hasCollaborationEntitlement(access, 'collaboration_analytics', {
      proFeature: true,
      minimumLevel: 'advanced',
    }),
    false,
  );
  assert.equal(hasCollaborationPro(access), false);
});

test('suspended Pro entitlements are not usable through direct Pro routes', () => {
  const access = normalizeCollaborationAccess({
    eligible: true,
    accessible: true,
    write_allowed: true,
    commercial_tier: 'standard',
    entitlements: {
      collaboration_external_rooms: { status: 'suspended', access_level: 'enabled' },
    },
  });
  assert.equal(
    hasCollaborationEntitlement(access, 'collaboration_external_rooms', { proFeature: true }),
    false,
  );
});
