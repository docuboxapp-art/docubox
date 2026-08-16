import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findUnsupportedOrganizationSignatureMethods,
  resolveOrganizationGovernance,
} from './governance.ts';

test('document settings override lower-precedence settings', () => {
  const result = resolveOrganizationGovernance({
    defaults: { signature: { method: 'click_sign', otp: false } },
    organization: { signature: { otp: true } },
    template: { signature: { method: 'autografa' } },
    document: { signature: { method: 'efirma_sat' } },
  });
  assert.deepEqual(result.values, { signature: { method: 'efirma_sat', otp: true } });
  assert.equal(result.sources['signature.method'], 'document');
  assert.equal(result.sources['signature.otp'], 'organization');
});

test('a locked organization path cannot be weakened by later layers', () => {
  const result = resolveOrganizationGovernance({
    defaults: { evidence: { hash: true } },
    organization: { evidence: { tsa: true, hash: true } },
    template: { evidence: { tsa: false, hash: false } },
    document: { evidence: { tsa: false } },
    locks: { organization: ['evidence.tsa', 'evidence.hash'] },
  });
  assert.deepEqual(result.values, { evidence: { hash: true, tsa: true } });
  assert.deepEqual(result.lockedPaths.sort(), ['evidence.hash', 'evidence.tsa']);
});

test('arrays are replaced rather than merged ambiguously', () => {
  const result = resolveOrganizationGovernance({
    defaults: { methods: ['click_sign'] },
    unit: { methods: ['otp', 'autografa'] },
  });
  assert.deepEqual(result.values.methods, ['otp', 'autografa']);
  assert.equal(result.sources.methods, 'unit');
});

test('signature aliases used by existing documents match organization policies', () => {
  const unsupported = findUnsupportedOrganizationSignatureMethods(
    [{ tipoFirma: ['efirma', 'biometria', 'autografa'] }],
    ['efirma_sat', 'biometrica', 'autografa']
  );
  assert.deepEqual(unsupported, []);
});

test('signature methods outside the published policy fail closed', () => {
  const unsupported = findUnsupportedOrganizationSignatureMethods(
    [{ tipoFirma: ['autografa', 'csd'] }, { tipo_firma: ['otp', 'csd'] }],
    ['autografa', 'otp']
  );
  assert.deepEqual(unsupported, ['csd']);
});
