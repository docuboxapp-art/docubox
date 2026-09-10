import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const provider = await read('../src/lib/document-conversion/cloudconvert-provider.ts');
const client = await read('../src/lib/document-conversion/client.ts');
const createRoute = await read('../src/app/api/document-conversion/jobs/route.ts');
const statusRoute = await read('../src/app/api/document-conversion/jobs/[id]/route.ts');
const conversionServer = await read('../src/lib/document-conversion/server.ts');
const step = await read('../src/app/crear-documento/components/StepSubir.tsx');
const page = await read('../src/app/crear-documento/page.tsx');
const mobileUploadRoute = await read('../src/app/api/mobile-upload/submit/route.ts');

test('CloudConvert quota is checked server-side before a conversion job is created', () => {
  assert.match(provider, /request\('\/users\/me'\)/);
  assert.match(provider, /credits <= 0/);
  assert.match(provider, /await this\.assertCreditsAvailable\(\);[\s\S]*request\('\/jobs'/);
  assert.match(provider, /CONVERSION_QUOTA_EXHAUSTED/);
});

test('provider failures distinguish quota, rate limiting, availability, failure and timeout', () => {
  for (const code of [
    'CONVERSION_QUOTA_EXHAUSTED',
    'CONVERSION_RATE_LIMITED',
    'CONVERSION_PROVIDER_UNAVAILABLE',
    'CONVERSION_FAILED',
    'CONVERSION_TIMEOUT',
  ]) {
    assert.match(provider, new RegExp(code));
  }
  assert.match(provider, /status === 429/);
  assert.match(provider, /retry-after/);
});

test('Office conversions have an atomic per-user usage cap before a provider job is created', () => {
  assert.match(createRoute, /reserveOfficeConversionAttempt\(user\.id\)/);
  assert.match(
    createRoute,
    /reserveOfficeConversionAttempt[\s\S]*CloudConvertProvider\.fromEnvironment/
  );
  assert.match(conversionServer, /rpc\('consume_server_rate_limit'/);
  assert.match(conversionServer, /document-conversion:office:user:/);
  assert.match(conversionServer, /CONVERSION_USAGE_LIMITED/);
});

test('only server code reads the CloudConvert API key and client uses direct form upload', () => {
  assert.match(provider, /process\.env/);
  assert.doesNotMatch(client, /CLOUDCONVERT_API_KEY|CloudConvertProvider/);
  assert.match(client, /new FormData\(\)/);
  assert.match(client, /fetch\(upload\.url/);
  assert.match(createRoute, /CloudConvertProvider\.fromEnvironment\(\)/);
});

test('job polling is authenticated and bound to the creator through a signed short-lived token', () => {
  assert.match(createRoute, /issueConversionJobToken/);
  assert.match(statusRoute, /requireConversionUser/);
  assert.match(statusRoute, /verifyConversionJobToken/);
  assert.match(statusRoute, /x-document-conversion-token/);
});

test('PDF bypasses conversion while supported Office formats are prepared before step two', () => {
  assert.match(client, /if \(extension === 'pdf'\) return file/);
  assert.match(step, /application\/pdf,\.pdf,\.doc,\.docx,\.xls,\.xlsx,\.ppt,\.pptx/);
  assert.match(step, /PDF recomendado\. También Word \(\.doc, \.docx\), Excel \(\.xls, \.xlsx\) y/);
  assert.match(step, /PowerPoint \(\.ppt, \.pptx\), hasta 25 MB\./);
  assert.match(page, /prepareDocument\(selectedFile, session\.access_token/);
  assert.match(page, /setFile\(preparedFile\)/);
  assert.match(page, /setShowPreparationMessage\(true\)/);
  assert.match(page, /2_500/);
});

test('quota exhaustion stays generic in the UI and never advances the document flow', () => {
  assert.match(page, /CONVERSION_QUOTA_EXHAUSTED/);
  assert.match(
    page,
    /No fue posible preparar el documento en este momento\. Intenta nuevamente más tarde\./
  );
  assert.doesNotMatch(page, /CloudConvert|créditos|proveedor/);
});

test('the legacy mobile relay only accepts PDF so Office content cannot cross a Vercel Function', () => {
  assert.match(mobileUploadRoute, /new Set\(\['application\/pdf'\]\)/);
  assert.doesNotMatch(mobileUploadRoute, /wordprocessingml/);
});
