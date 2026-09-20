import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const types = await read('../src/lib/evidence-v2/types.ts');
const participation = await read('../src/lib/evidence-v2/participation-context.ts');
const service = await read('../src/lib/evidence-v2/service.ts');
const xml = await read('../src/lib/evidence-v2/xml.ts');
const parser = await read('../src/lib/evidence-v2/parser.ts');
const readiness = await read('../src/lib/evidence-v2/readiness.ts');

mkdirSync('.tmp/auth-002-tests', { recursive: true });
writeFileSync('.tmp/auth-002-tests/package.json', '{"type":"module"}\n');
execSync(
  'npx esbuild src/lib/evidence-v2/participation-context.ts --bundle --platform=node --format=esm --outfile=.tmp/auth-002-tests/participation-context.js --alias:@=./src',
  { stdio: 'pipe' }
);
const participationBuilder = await import('../.tmp/auth-002-tests/participation-context.js');

const committedAttempt = {
  id: '13131313-1313-4313-8313-131313131313',
  status: 'committed',
  participant_reference_id: '12121212-1212-4212-8212-121212121212',
  in_person_session_id: '17171717-1717-4717-8717-171717171717',
  signature_evidence_id: '18181818-1818-4818-8818-181818181818',
  participation_response_id: '15151515-1515-4515-8515-151515151515',
  correlation_id: '14141414-1414-4414-8414-141414141414',
  claimed_at: '2026-09-11T10:03:30+00:00',
  committed_at: '2026-09-11T10:04:00Z',
};
const completedSession = {
  id: committedAttempt.in_person_session_id,
  status: 'completed',
  participant_reference_id: committedAttempt.participant_reference_id,
  created_at: '2026-09-11T10:02:30Z',
  started_at: '2026-09-11T10:03:00Z',
  completed_at: '2026-09-11T10:04:00Z',
};
const completionEvent = {
  id: '16161616-1616-4616-8616-161616161616',
  event_key: `completion:${committedAttempt.id}:committed`,
  correlation_id: committedAttempt.correlation_id,
};

test('Evidence v2.1 adds an optional participation context without a new major version', () => {
  assert.match(types, /participation\?: EvidenceParticipationContext/);
  assert.match(types, /mode: 'remote' \| 'in_person'/);
  assert.match(types, /version: '2\.0' \| '2\.1'/);
  assert.doesNotMatch(types, /version: '3\.0'/);
});

test('the builder sources in-person facts only from committed AUTH-003 state', () => {
  assert.match(service, /from\('participant_completion_attempts'\)/);
  assert.match(service, /\.eq\('action_type', 'signature'\)/);
  assert.match(service, /\.eq\('status', 'committed'\)/);
  assert.match(service, /from\('in_person_signing_sessions'\)/);
  assert.match(service, /\.eq\('status', 'completed'\)/);
  assert.match(service, /participant\.completion_committed/);
  assert.match(service, /buildEvidenceParticipationContext/);
});

test('participation XML round-trip remains optional and is covered by signature digest', () => {
  assert.match(xml, /<Participation mode=/);
  assert.match(xml, /renderParticipation\(signature\.participation\)/);
  assert.match(parser, /item\.Participation/);
  assert.match(readiness, /IN_PERSON_PARTICIPATION_INCOMPLETE/);
  assert.match(readiness, /REMOTE_PARTICIPATION_HAS_KIOSK_SESSION/);
});

test('the participation projection cannot serialize kiosk credentials or OTP material', () => {
  assert.doesNotMatch(participation, /token_hash|start_claim_hash|cookie|password/i);
  assert.doesNotMatch(xml, /KioskToken|OTPCode|Cookie|BearerToken|Password/i);
  assert.match(participation, /method: 'authenticated_session'/);
  assert.match(participation, /status !== 'committed'/);
  assert.match(participation, /session\.status !== 'completed'/);
});

test('the projection is deterministic and normalizes persisted timestamps to UTC', () => {
  const input = {
    attempt: committedAttempt,
    session: completedSession,
    canonicalEvent: completionEvent,
    signingMethod: 'autografa_digital',
    consentTextHash: 'a'.repeat(64),
  };
  const first = participationBuilder.buildEvidenceParticipationContext(input);
  const second = participationBuilder.buildEvidenceParticipationContext(structuredClone(input));
  assert.deepEqual(first, second);
  assert.equal(first.mode, 'in_person');
  assert.equal(first.authentication.verifiedAt, '2026-09-11T10:03:30.000Z');
  assert.equal(first.inPersonSession.status, 'completed');
  assert.doesNotMatch(JSON.stringify(first), /token|otp|cookie|password|secret/i);
});

test('cancelled, expired and uncommitted sessions cannot claim a completed in-person act', () => {
  const build = (attemptStatus, sessionStatus) =>
    participationBuilder.buildEvidenceParticipationContext({
      attempt: { ...committedAttempt, status: attemptStatus },
      session: { ...completedSession, status: sessionStatus },
      canonicalEvent: completionEvent,
      signingMethod: 'autografa_digital',
    });
  assert.throws(() => build('claimed', 'completed'), /EVIDENCE_COMPLETION_NOT_COMMITTED/);
  assert.throws(() => build('expired', 'completed'), /EVIDENCE_COMPLETION_NOT_COMMITTED/);
  assert.throws(() => build('committed', 'cancelled'), /EVIDENCE_IN_PERSON_SESSION_NOT_COMPLETED/);
  assert.throws(() => build('committed', 'expired'), /EVIDENCE_IN_PERSON_SESSION_NOT_COMPLETED/);
});

test('participant and canonical correlation mismatches fail closed', () => {
  const base = {
    attempt: committedAttempt,
    session: completedSession,
    canonicalEvent: completionEvent,
    signingMethod: 'autografa_digital',
  };
  assert.throws(
    () =>
      participationBuilder.buildEvidenceParticipationContext({
        ...base,
        session: { ...completedSession, participant_reference_id: 'another-participant' },
      }),
    /EVIDENCE_IN_PERSON_SESSION_NOT_COMPLETED/
  );
  assert.throws(
    () =>
      participationBuilder.buildEvidenceParticipationContext({
        ...base,
        canonicalEvent: { ...completionEvent, correlation_id: 'another-correlation' },
      }),
    /EVIDENCE_COMPLETION_EVENT_MISSING/
  );
});

test('a committed remote act remains valid without any kiosk session', () => {
  const value = participationBuilder.buildEvidenceParticipationContext({
    attempt: { ...committedAttempt, in_person_session_id: null },
    canonicalEvent: completionEvent,
    signingMethod: 'firma_simple',
  });
  assert.equal(value.mode, 'remote');
  assert.equal(value.inPersonSession, undefined);
  assert.equal(value.signingMethod, 'firma_simple');
});
