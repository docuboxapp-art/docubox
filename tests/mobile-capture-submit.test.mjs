import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync('src/app/api/mobile-upload/submit-id-capture/route.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const feedback = {};
new Function('exports', ts.transpileModule(readFileSync('src/lib/identity/verification-feedback.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(feedback);

async function submit({ mode = 'public_form_liveness', live = true, code = 0, unavailable = false } = {}) {
  const image = Buffer.alloc(300, 42).toString('base64');
  const video = Buffer.alloc(300, 17).toString('base64');
  const token = 'a'.repeat(64);
  const session = { id: 'session-1', user_id: 'user-1', metadata: { mode,
    ...(mode === 'case_portal_liveness' ? { case_invitation_id: 'invite-1' }
      : mode === 'id_capture' ? { document_id: 'document-1' } : { form_id: 'form-1' }),
  } };
  let submittedLog;
  let providerInput;
  let updatedSession;
  class Unavailable extends Error {}
  const lookup = (data) => ({ select() { return this; }, eq() { return this; }, is() { return this; },
    gt() { return this; }, lte() { return this; }, maybeSingle: async () => ({ data }) });
  const service = {
    rpc: async () => ({ error: null }),
    from(table) {
      if (table === 'case_participant_invitations') return lookup({ id: 'invite-1', case_file_id: 'case-1' });
      if (table === 'case_files') return lookup({ status: 'open' });
      if (table === 'case_invitation_access_grants') return lookup({ invitation_id: 'invite-1' });
      if (table === 'mobile_upload_sessions') return {
        select: () => ({ eq() { return this; }, gt() { return this; }, maybeSingle: async () => ({ data: session }) }),
        update: (row) => { updatedSession = row; return { eq() { return this; }, select: () => ({ maybeSingle: async () => ({ data: { id: 'session-1' } }) }) }; },
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
    if (name === '@/lib/identity/verification-feedback') return feedback;
    if (name === '@/lib/identity/verify-provider') return {
      IdentityProviderUnavailableError: Unavailable,
      verifyIdentityAndLiveness: async (input) => {
        if (unavailable) throw new Unavailable('Servicio temporalmente no disponible.');
        providerInput = input;
        return {
          provider: 'TEST', status: live ? 'VALID' : 'INVALID', document_validation: { valid: true },
          document_fields: { curp: 'CURP' }, face_validation: { match: true, score: 99.91 },
          liveness: { passed: live, method: 'TEST', code },
        };
      },
    };
    throw new Error(`Unexpected import: ${name}`);
  }, exports);

  const response = await exports.POST({
    headers: new Headers(),
    json: async () => ({ token, anversoData: null, reversoData: null, selfieData: `data:image/jpeg;base64,${image}`, selfieVideo: `data:video/mp4;base64,${video}` }),
  });
  return { response, providerInput, submittedLog, updatedSession, image, video };
}

test('stored-ID mobile capture accepts a video data URL without resending the ID', async () => {
  const { response, providerInput, submittedLog, image, video } = await submit();
  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(providerInput.front, image);
  assert.equal(providerInput.video, video);
  assert.equal(submittedLog.selfie_video_b64, `encrypted:${video.length}`);
});

test('signing, forms and case invitations share the same server liveness requirement', async () => {
  for (const mode of ['id_capture', 'public_form_liveness', 'case_portal_liveness']) {
    const accepted = await submit({ mode });
    assert.equal(accepted.response.status, 200);
    assert.equal(accepted.updatedSession.status, 'completed');
    for (const [code, reason] of [[1, 'LIVENESS_SPOOF_DETECTED'], [2, 'LIVENESS_NO_FACE'], [3, 'LIVENESS_MULTIPLE_FACES']]) {
      const rejected = await submit({ mode, live: false, code });
      assert.equal(rejected.response.status, 422);
      assert.equal(rejected.response.body.success, false);
      assert.equal(rejected.response.body.verification_failed, true);
      assert.equal(rejected.response.body.failure_reason, reason);
      assert.equal(rejected.response.body.error, feedback.verificationFailureMessage(reason));
      assert.equal(rejected.updatedSession.status, 'identity_failed');
      assert.equal(rejected.updatedSession.metadata.verification_failure_reason, reason);
      assert.equal(rejected.submittedLog.raw_nubarium_response.liveness_code, code);
      assert.equal(rejected.submittedLog.raw_nubarium_response.face_match, true);
    }
  }
});

test('provider unavailability preserves the pending session and does not record a false rejection', async () => {
  const { response, updatedSession, submittedLog } = await submit({ unavailable: true });
  assert.equal(response.status, 503);
  assert.equal(updatedSession, undefined);
  assert.equal(submittedLog, undefined);
});
