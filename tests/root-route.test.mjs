import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the site root renders login without redirecting to a subpage', async () => {
  const [rootPage, middleware, config] = await Promise.all([
    readFile(new URL('../src/app/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/middleware.ts', import.meta.url), 'utf8'),
    readFile(new URL('../next.config.mjs', import.meta.url), 'utf8'),
  ]);

  assert.match(rootPage, /export\s*\{\s*default\s*\}\s*from\s*['"]\.\/login\/page['"]/);
  assert.match(middleware, /const PUBLIC_ROUTES = \[\s*'\/'/);
  assert.doesNotMatch(config, /destination:\s*['"]\/sign-up-login-screen['"]/);
});
