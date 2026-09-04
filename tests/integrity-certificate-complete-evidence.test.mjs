import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile('src/lib/certification/pdf.ts', 'utf8');
const sectionBuilder = source.slice(
  source.indexOf('function completeEvidenceSections'),
  source.indexOf('function drawCompleteEvidenceAppendix'),
);
const appendixRenderer = source.slice(
  source.indexOf('function drawCompleteEvidenceAppendix'),
  source.indexOf('export async function generateIntegrityCertificatePdf'),
);

test('integrity certificate exposes every available chain, seal and hash in its complete appendix', () => {
  for (const field of [
    'DOCUMENT_BODY_SHA256',
    'DOCUMENT_CHAIN_SHA256',
    'EVIDENCE_CHAIN_SHA256',
    'EVIDENCE_SEAL_SHA256',
    'CERTIFICATION_ROOT_SHA256',
    'DOCUMENT_CHAIN_DISPLAY',
    'SEAL_BASE64',
    'PUBLIC_KEY_FINGERPRINT_SHA256',
    'EVIDENCE_CHAIN_DISPLAY',
    'EVIDENCE_SEAL_BASE64',
    'MESSAGE_IMPRINT_SHA256',
    'TOKEN_SHA256',
  ]) {
    assert.match(sectionBuilder, new RegExp(`['"]${field}['"]`));
  }
});

test('complete evidence appendix paginates without truncating values', () => {
  assert.match(appendixRenderer, /wrapTechnicalText\(`\$\{label\}=\$\{value\}`/);
  assert.match(appendixRenderer, /for \(const \[lineIndex, lineText\] of lines\.entries\(\)\)/);
  assert.doesNotMatch(appendixRenderer, /truncateHash|abbreviateBase64|\.slice\(/);
  assert.match(source, /allPages\.forEach\(\(page, index\) => drawFooter\(page, logo, regular, index \+ 1, allPages\.length\)\)/);
});

test('missing RFC 3161 evidence is represented truthfully instead of fabricated', () => {
  assert.match(sectionBuilder, /\['STATUS', 'NOT_PRESENT'\]/);
  assert.match(sectionBuilder, /data\.timestamp\.messageImprintSha256/);
});
