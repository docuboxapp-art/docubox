import assert from 'node:assert/strict';
import test from 'node:test';
import { isExecutableOffboarding, transferableAssetTotal, validateOffboardingSelection } from './continuity.ts';

test('transferable asset total excludes authorities that must be suspended', () => {
  assert.equal(transferableAssetTotal({ documents: 2, tasks: 3, active_authorities: 4 }), 5);
});

test('owner offboarding is blocked until ownership is transferred', () => {
  assert.match(validateOffboardingSelection({ memberId: 'member-1', memberRole: 'owner', confirmation: 'DAR DE BAJA' }), /transfiere la propiedad/i);
});

test('successor is required only when transferable assets exist', () => {
  assert.match(validateOffboardingSelection({ memberId: 'member-1', transferableAssets: 1, confirmation: 'DAR DE BAJA' }), /sucesor/i);
  assert.equal(validateOffboardingSelection({ memberId: 'member-1', transferableAssets: 0, confirmation: 'DAR DE BAJA' }), '');
});

test('scheduled job is executable only after its effective time', () => {
  const now = Date.parse('2026-08-15T12:00:00Z');
  assert.equal(isExecutableOffboarding('scheduled', '2026-08-15T11:59:00Z', now), true);
  assert.equal(isExecutableOffboarding('scheduled', '2026-08-15T12:01:00Z', now), false);
  assert.equal(isExecutableOffboarding('completed', '2026-08-15T11:59:00Z', now), false);
});
