import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transform } from 'esbuild';

const source = await readFile(
  new URL('../src/lib/documents/bootstrap-auth.server.ts', import.meta.url),
  'utf8'
);
const { code } = await transform(source, { loader: 'ts', format: 'esm' });
const { withDocumentBootstrapAuth, verifyDocumentBearer } = await import(
  'data:text/javascript,' + encodeURIComponent(code.replace('import "server-only";', ''))
);

test('bootstrap shares one verification through async document reads', async () => {
  let verifications = 0;
  const verify = async () => ({ user: 'fixture', sequence: ++verifications });
  const result = await withDocumentBootstrapAuth('scope-token', verify, () =>
    Promise.all(
      Array.from({ length: 3 }, async () => {
        await Promise.resolve();
        return verifyDocumentBearer('scope-token', verify);
      })
    )
  );
  assert.equal(verifications, 1);
  assert.deepEqual(
    result.map(({ sequence }) => sequence),
    [1, 1, 1]
  );
});

test('independent API calls and parallel requests verify their own identity', async () => {
  let verifications = 0;
  const verify = async () => ({ sequence: ++verifications });
  const results = await Promise.all([
    withDocumentBootstrapAuth('same-token', verify, () =>
      verifyDocumentBearer('same-token', verify)
    ),
    withDocumentBootstrapAuth('same-token', verify, () =>
      verifyDocumentBearer('same-token', verify)
    ),
    withDocumentBootstrapAuth(
      'different-token',
      async () => {
        assert.fail('A different Bearer cannot use the verification for the bootstrap token');
      },
      () => verifyDocumentBearer('same-token', verify)
    ),
    verifyDocumentBearer('same-token', verify),
  ]);
  assert.deepEqual(
    results.map(({ sequence }) => sequence),
    [1, 2, 3, 4]
  );
});

test('auth errors propagate and the next request verifies a recovered session', async () => {
  let verifications = 0;
  const denied = async () => {
    verifications++;
    throw new Error('Provider unavailable');
  };
  const invalid = await withDocumentBootstrapAuth('scope-token', denied, () =>
    Promise.allSettled([
      verifyDocumentBearer('scope-token', denied),
      verifyDocumentBearer('scope-token', denied),
    ])
  );
  assert.equal(verifications, 1);
  assert.ok(invalid.every((item) => item.status === 'rejected'));
  const recovered = await verifyDocumentBearer('scope-token', async () => 'verified');
  assert.equal(recovered, 'verified');
});
