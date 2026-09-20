import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const topNav = await readFile(new URL('../src/components/TopNav.tsx', import.meta.url), 'utf8');
const rootLayout = await readFile(new URL('../src/app/layout.tsx', import.meta.url), 'utf8');

test('TopNav starts with the same search state on the server and client', () => {
  assert.match(topNav, /const \[searchCollapsed, setSearchCollapsed\] = useState\(false\)/);
  assert.doesNotMatch(
    topNav,
    /useState\(\(\) => \{[\s\S]{0,240}localStorage\.getItem\(SEARCH_COLLAPSED_KEY\)/
  );
});

test('the theme bootstrap uses the Next.js script component', () => {
  assert.match(rootLayout, /import Script from 'next\/script'/);
  assert.match(rootLayout, /<Script id="docubox-theme-init" strategy="beforeInteractive">/);
  assert.doesNotMatch(rootLayout, /<script\b/);
});
