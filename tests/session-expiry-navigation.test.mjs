import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const compiled = await build({
  entryPoints: ['src/lib/security/session-expiry-navigation.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { redirectExpiredAccountSession } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);
test('late account expiry callbacks use the current route and preserve the case code gate', () => {
  const redirects = [];
  const location = { pathname: '/expedientes/consultar', assign: (path) => redirects.push(path) };
  // An account check started on a protected screen, but completes after navigation.
  location.pathname = '/expediente/' + 'a'.repeat(64);
  redirectExpiredAccountSession(location);
  assert.deepEqual(redirects, []);
  location.pathname = '/expedientes/consultar';
  redirectExpiredAccountSession(location);
  assert.deepEqual(redirects, ['/login?reason=session-expired']);
});
test('other protected account routes retain the expiry redirect', () => {
  for (const pathname of ['/expedientes', '/formularios', '/mis-documentos', '/configuracion']) {
    const redirects = [];
    redirectExpiredAccountSession({ pathname, assign: (path) => redirects.push(path) });
    assert.deepEqual(redirects, ['/login?reason=session-expired']);
  }
});
