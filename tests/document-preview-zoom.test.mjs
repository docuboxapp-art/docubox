import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const built = await build({
  entryPoints: ['src/lib/documents/preview-zoom.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { fitPreviewZoom } = await import(
  `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`
);
const viewport = (pageWidth, clientWidth = 390, renderedZoom) => ({
  clientWidth,
  querySelector: () => ({
    getBoundingClientRect: () => ({ width: pageWidth }),
    dataset: { previewZoom: renderedZoom },
  }),
});

test('the same PDF fits a phone equally from different initial zoom levels', () => {
  const from100 = fitPreviewZoom(viewport(612), 100);
  const from200 = fitPreviewZoom(viewport(1224), 200);
  assert.equal(from100, from200);
  assert.ok((612 * from100) / 100 <= 390 - 32);
});
test('template fitting uses its rendered scale when the requested zoom was clamped', () => {
  const fitted = fitPreviewZoom(viewport(1600, 390, 200), 300);
  assert.ok((800 * fitted) / 100 <= 390 - 32);
});
test('fit respects viewer limits on very narrow and very wide screens', () => {
  assert.equal(fitPreviewZoom(viewport(1000, 100), 100, 25, 300), 25);
  assert.equal(fitPreviewZoom(viewport(100, 2000), 100, 25, 300), 300);
});
test('unloaded or hidden previews retain the current zoom', () => {
  assert.equal(fitPreviewZoom(null, 80), 80);
  assert.equal(fitPreviewZoom(viewport(0), 80), 80);
});

test('a canvas awaiting its PDF render is not mistaken for a 300px page', () => {
  const pending = viewport(300);
  pending.querySelector = () => ({
    getBoundingClientRect: () => ({ width: 300 }),
    dataset: { previewReady: 'false' },
  });
  assert.equal(fitPreviewZoom(pending, 55), 55);
});

test('fit uses the painted canvas zoom while a newer zoom is requested', () => {
  assert.equal(fitPreviewZoom(viewport(612, 390, 100), 200), 58);
});
