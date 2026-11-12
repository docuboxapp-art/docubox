import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { build } from 'esbuild';
const compiled = await build({
  entryPoints: ['src/lib/case-files/consultation-refresh.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { subscribeToCaseListReturn } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);
function setup() {
  const browser = new EventTarget(),
    page = new EventTarget();
  page.visibilityState = 'visible';
  let requests = 0;
  const dispose = subscribeToCaseListReturn(() => requests++, browser, page);
  return { browser, page, dispose, requests: () => requests };
}
test('returning to the case list coalesces visibility and focus into one refresh', async () => {
  const f = setup();
  f.page.dispatchEvent(new Event('visibilitychange'));
  f.browser.dispatchEvent(new Event('focus'));
  await pause(190);
  assert.equal(f.requests(), 1);
  f.dispose();
});
test('hidden case lists do not refresh, including when hidden before the callback', async () => {
  const f = setup();
  f.browser.dispatchEvent(new Event('focus'));
  f.page.visibilityState = 'hidden';
  f.page.dispatchEvent(new Event('visibilitychange'));
  await pause(190);
  assert.equal(f.requests(), 0);
  f.dispose();
});
test('leaving the workspace cancels pending refresh and removes its listeners', async () => {
  const f = setup();
  f.browser.dispatchEvent(new Event('focus'));
  f.dispose();
  f.browser.dispatchEvent(new Event('focus'));
  f.page.dispatchEvent(new Event('visibilitychange'));
  await pause(190);
  assert.equal(f.requests(), 0);
});
