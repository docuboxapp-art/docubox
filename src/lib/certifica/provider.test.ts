import assert from 'node:assert/strict';
import test from 'node:test';
import { SandboxCertificationProvider } from './provider.ts';

test('sandbox provider is deterministic in legal semantics and never claims PSC validity', async () => {
  const provider = new SandboxCertificationProvider();
  const result = await provider.issue({ certificationId: 'cert-1', idempotencyKey: 'request-1', serviceKey: 'nom151', originalSha256: 'a'.repeat(64), manifestSha256: 'b'.repeat(64) });
  assert.equal(result.sandbox, true);
  assert.equal(result.evidence.legal_validity, false);
  assert.equal(result.evidence.watermark, 'NO VALIDO / DEMOSTRACION');
  assert.match(result.evidenceSha256, /^[a-f0-9]{64}$/);
});

