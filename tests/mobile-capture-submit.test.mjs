import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync('src/app/api/mobile-upload/submit-id-capture/route.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

test('stored-ID mobile capture accepts a video data URL without resending the ID', async () => {
  const image = Buffer.alloc(300, 42).toString('base64');
  const video = Buffer.alloc(300, 17).toString('base64');
  const token = 'a'.repeat(64);
  const session = { id: 'session-1', user_id: 'user-1', metadata: { mode: 'public_form_liveness', form_id: 'form-1' } };
  let submittedLog;
  let providerInput;
  const service = {
    from(table) {
      if (table === 'mobile_upload_sessions') return {
        select: () => ({ eq() { return this; }, gt() { return this; }, maybeSingle: async () => ({ data: session }) }),
        update: () => ({ eq() { return this; }, select: () => ({ maybeSingle: async () => ({ data: { id: 'session-1' } }) }) }),
      };
      if (table === 'user_profiles') return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { curp: 'CURP', full_name: 'Ana Pérez' } }) }) }),
      };
      if (table === 'id_capture_logs') return {
        insert: (row) => { submittedLog = row; return { select: () => ({ single: async () => ({ data: { id: 'log-1' } }) }) }; },
      };
      throw new Error(`Unexpected table: ${table}`);
    },
  };
  const exports = {};
  new Function('require', 'exports', compiled)((name) => {
    if (name === 'next/server') return { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) } };
    if (name === '@/lib/supabase/server') return { createServiceClient: () => service };
    if (name === '@/lib/security/capability-token') return { hashCapabilityToken: () => 'hash' };
    if (name === '@/lib/identity/capture-crypto') return {
      captureEncryptionKey: () => Buffer.alloc(32),
      encryptCapture: (value) => `encrypted:${value.length}`,
      normalizeImageBase64: (value) => String(value || '').replace(/^data:image\/[^,]+,/, ''),
      normalizeVideoBase64: (value) => String(value || '').replace(/^data:video\/[^,]+,/, ''),
      validImageBase64: (value) => value.length >= 256 && /^[A-Za-z0-9+/=]+$/.test(value),
    };
    if (name === '@/lib/identity/stored-identity') return {
      findStoredIdentity: async () => ({ front: image, back: image, curp: 'CURP', nombre: 'Ana Pérez' }),
    };
    if (name === '@/lib/identity/verify-provider') return {
      IdentityProviderUnavailableError: class extends Error {},
      verifyIdentityAndLiveness: async (input) => {
        providerInput = input;
        return {
          provider: 'TEST', status: 'VALID', document_validation: { valid: true },
          document_fields: { curp: 'CURP' }, face_validation: { match: true, score: 99.91 },
          liveness: { passed: true, method: 'TEST' },
        };
      },
    };
    throw new Error(`Unexpected import: ${name}`);
  }, exports);

  const response = await exports.POST({
    headers: new Headers(),
    json: async () => ({ token, anversoData: null, reversoData: null, selfieData: `data:image/jpeg;base64,${image}`, selfieVideo: `data:video/mp4;base64,${video}` }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(providerInput.front, image);
  assert.equal(providerInput.video, video);
  assert.equal(submittedLog.selfie_video_b64, `encrypted:${video.length}`);
});
