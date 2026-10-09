import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import test from 'node:test';

const cache = join(process.cwd(), 'node_modules/.cache/form-experience-defaults-test');
await mkdir(cache, { recursive: true });
await build({
  entryPoints: ['src/lib/forms/experience-defaults.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  outfile: join(cache, 'defaults.cjs'),
  logLevel: 'silent',
});
const {
  createDefaultFormExperienceDefaults,
  hasFormExperienceChanges,
  normalizeFormExperienceDefaults,
  getFormExperienceDefaultsStorageKey,
  readFormExperienceDefaults,
  writeFormExperienceDefaults,
} = createRequire(import.meta.url)(join(cache, 'defaults.cjs'));

test('experience defaults validate values and keep presentation mode consistent', () => {
  const defaults = createDefaultFormExperienceDefaults();
  assert.equal(defaults.requiresSignature, true);
  assert.equal(defaults.configureLinkExpiration, false);
  assert.equal(normalizeFormExperienceDefaults(null, true).configurePdfDetails, true);
  const normalized = normalizeFormExperienceDefaults({
    multiStep: false,
    mode: 'multistep',
    expirationHours: 0.5,
    requiresSignature: true,
  });
  assert.equal(normalized.mode, 'scroll');
  assert.equal(normalized.expirationHours, 0.5);
  assert.equal(normalized.configureLinkExpiration, true);
  assert.equal(normalized.requiresSignature, true);
  assert.equal(normalizeFormExperienceDefaults({ requiresSignature: false }).requiresSignature, true);
  assert.equal(normalizeFormExperienceDefaults({ configureLinkExpiration: false, expirationHours: 0.5 }).configureLinkExpiration, false);
  assert.equal(normalizeFormExperienceDefaults({ expirationHours: 0 }).expirationHours, 72);
});

test('only experience options count as pending changes', () => {
  const baseline = createDefaultFormExperienceDefaults();
  const settings = { ...baseline, documentNumber: 'FORM-2026-001' };
  assert.equal(hasFormExperienceChanges(settings, baseline), false);
  assert.equal(hasFormExperienceChanges({ ...settings, requiresSignature: true }, baseline), false);
  assert.equal(hasFormExperienceChanges({ ...settings, requiresSignature: false }, baseline), false);
  assert.equal(hasFormExperienceChanges({ ...settings, expirationHours: 0 }, baseline), false);
  assert.equal(hasFormExperienceChanges({ ...settings, configureLinkExpiration: true, expirationHours: 0 }, baseline), true);
});

test('experience defaults are scoped to their workspace', () => {
  const values = new Map();
  const originalWindow = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  };
  try {
    writeFormExperienceDefaults('workspace-a', {
      ...createDefaultFormExperienceDefaults(),
      allowSaveProgress: false,
    });
    assert.equal(readFormExperienceDefaults('workspace-a').allowSaveProgress, false);
    assert.equal(readFormExperienceDefaults('workspace-b').allowSaveProgress, true);
    assert.notEqual(
      getFormExperienceDefaultsStorageKey('workspace-a'),
      getFormExperienceDefaultsStorageKey('workspace-b')
    );
  } finally {
    globalThis.window = originalWindow;
  }
});
