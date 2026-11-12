import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const module = {};
new Function('exports', ts.transpileModule(readFileSync('src/lib/identity/selfie-frame.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(module);

test('portrait and landscape camera frames retain their original geometry without CSS crop or mirroring', () => {
  for (const [videoWidth, videoHeight] of [[640, 480], [480, 640], [1280, 720]]) {
    const video = { readyState: 2, videoWidth, videoHeight };
    const calls = [];
    const canvas = { getContext: () => ({ drawImage: (...args) => calls.push(args) }),
      toDataURL: (mime, quality) => { assert.equal(mime, 'image/jpeg'); assert.equal(quality, 0.92); return 'photo'; } };
    assert.equal(module.captureSelfieFrame(video, canvas), 'photo');
    assert.equal(canvas.width, videoWidth);
    assert.equal(canvas.height, videoHeight);
    assert.deepEqual(calls, [[video, 0, 0]]);
  }
});

test('an unavailable or empty camera frame is not submitted', () => {
  for (const video of [{ readyState: 1, videoWidth: 640, videoHeight: 480 },
    { readyState: 2, videoWidth: 0, videoHeight: 0 }]) {
    assert.equal(module.captureSelfieFrame(video, {}), null);
  }
});
