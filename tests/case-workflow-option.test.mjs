import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const bundle = await build({
  entryPoints: ['src/lib/case-files/experience.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { DEFAULT_CASE_EXPERIENCE, normalizeCaseExperience, isCaseWizardStepEnabled } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
test('legacy optional workflow preference never hides the mandatory review policy', () => {
  assert.equal(
    isCaseWizardStepEnabled('stages', { ...DEFAULT_CASE_EXPERIENCE, configureWorkflow: false }),
    true
  );
  assert.equal(normalizeCaseExperience({ configureWorkflow: false }).configureWorkflow, true);
});
test('all seven steps remain visible even when design editing is disabled', () => {
  const ids = ['general', 'content', 'verification', 'stages', 'design', 'preview', 'publish'];
  const shown = ids.filter((id) =>
    isCaseWizardStepEnabled(id, { ...DEFAULT_CASE_EXPERIENCE, configureDesign: false })
  );
  assert.ok(shown.includes('stages'));
  assert.equal(shown.includes('design'), true);
  assert.equal(shown.length, 7);
  assert.equal(shown.at(-1), 'publish');
});
