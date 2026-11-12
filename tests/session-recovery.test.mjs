import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const middlewareSource = readFileSync('src/middleware.ts', 'utf8');
const recoveryScript = middlewareSource.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];
assert.ok(recoveryScript, 'the unavailable-session page needs its recovery script');

async function runRecoveryPage(responses) {
  const handlers = {};
  const navigations = [];
  const timers = [];
  let probes = 0;
  const button = {
    disabled: false,
    hidden: true,
    textContent: 'Reintentar ahora',
    addEventListener(name, handler) {
      handlers[name] = handler;
    },
  };
  const status = { textContent: '' };
  const context = {
    AbortController,
    Date,
    Math,
    document: {
      getElementById(id) {
        return id === 'retry-now' ? button : status;
      },
    },
    fetch: async () => {
      const response = responses[probes] ?? responses.at(-1);
      probes += 1;
      return { status: response };
    },
    window: {
      location: {
        href: 'http://localhost:4028/mis-documentos',
        replace(value) {
          navigations.push(value);
        },
      },
      setTimeout(handler, delay) {
        timers.push({ handler, delay });
        return timers.length;
      },
      clearTimeout() {},
      addEventListener() {},
    },
  };
  vm.runInNewContext(recoveryScript, context);
  await new Promise(setImmediate);
  return {
    button,
    handlers,
    navigations,
    status,
    timers,
    get probes() {
      return probes;
    },
  };
}

test('a transient failure keeps the page and manual retry checks again', async () => {
  const page = await runRecoveryPage([503, 200]);
  assert.equal(page.probes, 1);
  assert.deepEqual(page.navigations, []);
  assert.ok(page.timers.some((timer) => timer.delay < 5000));

  await page.handlers.click();
  assert.equal(page.probes, 2);
  assert.deepEqual(page.navigations, ['http://localhost:4028/mis-documentos']);
});

test('an invalid session sends the user to login', async () => {
  const page = await runRecoveryPage([401]);
  assert.deepEqual(page.navigations, ['/login?reason=session-expired']);
});

test('automatic recovery stops after five failed probes while manual retry stays available', async () => {
  const page = await runRecoveryPage([503]);
  for (let attempt = 1; attempt < 5; attempt += 1) {
    await page.timers.at(-1).handler();
    await new Promise(setImmediate);
  }
  assert.equal(page.probes, 5);
  assert.equal(page.button.hidden, false);
  assert.equal(page.timers.at(-1).delay, 25000);
  assert.match(page.status.textContent, /Puedes reintentar/);
});
