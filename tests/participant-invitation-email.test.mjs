import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sendRoute = await readFile(
  new URL('../src/app/api/documentos/enviar/route.ts', import.meta.url),
  'utf8'
);
const advanceParticipationRoute = await readFile(
  new URL('../src/app/api/documentos/advance-participation/route.ts', import.meta.url),
  'utf8'
);
const reminderRoute = await readFile(
  new URL('../src/app/api/documentos/send-reminder/route.ts', import.meta.url),
  'utf8'
);
const emailService = await readFile(
  new URL('../src/lib/emailNotifications.ts', import.meta.url),
  'utf8'
);
const emailFunction = await readFile(
  new URL('../supabase/functions/send-email-notifications/index.ts', import.meta.url),
  'utf8'
);
const supabaseConfig = await readFile(
  new URL('../supabase/config.toml', import.meta.url),
  'utf8'
);
const publicUrl = await readFile(new URL('../src/lib/publicAppUrl.ts', import.meta.url), 'utf8');

test('email-selected participants receive an individual participant portal link', () => {
  assert.doesNotMatch(
    sendRoute,
    /if \(participant\.isCurrentUser\) return participant;/,
    'Every participant must receive a portal token, including the creator when participating.'
  );
  assert.match(sendRoute, /portal_token: portalToken/);
  assert.match(sendRoute, /portal_token_hash: createHash\('sha256'\)/);
  assert.doesNotMatch(
    sendRoute,
    /!p\.visible \|\| !p\.email \|\| p\.isCurrentUser/,
    'The creator email must not be silently excluded when email notification was selected.'
  );
  assert.match(sendRoute, /documentUrl: getParticipantPortalUrl\(portalToken\)/);
  assert.match(publicUrl, /\/portal-participante\/\$\{encodeURIComponent\(portalToken\)\}/);
});

test('email delivery keeps the per-participant URL through the provider template', () => {
  assert.match(emailService, /const participantDocumentUrl = p\.documentUrl \|\| documentUrl/);
  assert.match(emailService, /creator_participation_invitation' : 'participant_invitation'/);
  assert.match(emailService, /documentUrl: participantDocumentUrl/);
  assert.match(
    emailFunction,
    /const ctaUrl = documentUrl \|\| `\$\{APP_URL\}\/mis-participaciones`;/
  );
  assert.match(emailFunction, /creatorIsParticipant \? "Completar mi participaci\\u00f3n" : "Revisar documento"/);
});

test('a creator who is also a participant receives a dedicated participation template', () => {
  assert.match(
    emailService,
    /type: p\.isCurrentUser \? 'creator_participation_invitation' : 'participant_invitation'/
  );
  assert.match(emailFunction, /function buildCreatorParticipationInvitationHtml/);
  assert.match(emailFunction, /Tu participaci\\u00f3n está pendiente/);
  assert.match(emailFunction, /Creaste este documento/);
  assert.match(emailFunction, /Completar mi participaci\\u00f3n/);
  assert.match(emailFunction, /case "creator_participation_invitation"/);
});

test('participant emails use the sender full name from user_profiles', () => {
  for (const route of [sendRoute, advanceParticipationRoute, reminderRoute]) {
    assert.match(route, /\.from\('user_profiles'\)/);
    assert.doesNotMatch(route, /\.from\('profiles'\)/);
  }
});

test('participant invitations embed a centered white mail icon instead of an emoji', () => {
  assert.doesNotMatch(emailFunction, /&#9993;/);
  assert.doesNotMatch(emailFunction, /&#x2709;&#xFE0E;/);
  assert.match(emailFunction, /src="cid:\$\{PARTICIPANT_INVITATION_ICON_CID\}"/);
  assert.match(emailFunction, /width="24" height="24"/);
  assert.match(emailFunction, /margin:0 auto/);
  assert.match(emailFunction, /content: PARTICIPANT_INVITATION_ICON_BASE64/);
  assert.match(emailFunction, /content_id: PARTICIPANT_INVITATION_ICON_CID/);
  assert.match(emailFunction, /content_type: "image\/png"/);
});

test('email aliases used by the participant form remain accepted', () => {
  for (const alias of ['email', 'correo', 'correo electron']) {
    assert.match(emailService, new RegExp(alias.replace(' ', '\\s+')));
  }
});

test('email delivery requires a cryptographically verified server token', () => {
  assert.match(
    supabaseConfig,
    /\[functions\.send-email-notifications\]\s+verify_jwt\s*=\s*true/
  );
  assert.match(emailFunction, /getJwtRole\(authorization\) !== "service_role"/);
});
