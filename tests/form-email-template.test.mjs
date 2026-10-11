import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFormEmail } from '../supabase/functions/_shared/form-email-template.ts';

const options = {
  recipientName: 'Ana & Luis',
  formName: 'Solicitud <especial>',
  workspaceName: 'Equipo & Asociados',
  requesterName: 'María & José',
  formUrl: 'https://docubox-docubox.vercel.app/portal-formulario/abc123',
  expiresAt: '2026-10-12T14:53:20Z',
};

test('form invitation uses the Docubox email layout and escapes form details', () => {
  const html = buildFormEmail({ ...options, variant: 'invitation', requireLiveness: true });

  assert.match(html, /docubox-logo-2026\.png/);
  assert.match(html, /background-color:#F6F8FB/);
  assert.match(html, /Completar formulario/);
  assert.match(html, /portal-formulario\/abc123/);
  assert.match(html, /Solicitud &lt;especial&gt;/);
  assert.match(html, /Ana &amp; Luis/);
  assert.match(html, /Solicitado por/);
  assert.match(html, /María &amp; José/);
  assert.doesNotMatch(html, /Solicitado por<\/td>.*Equipo &amp; Asociados/);
  assert.match(html, /prueba de vida/);
  assert.doesNotMatch(html, /Solicitud <especial>/);
});

test('form reminder keeps the same layout and a clear expiry timezone', () => {
  const html = buildFormEmail({ ...options, variant: 'reminder' });

  assert.match(html, /docubox-logo-2026\.png/);
  assert.match(html, /Continuar formulario/);
  assert.match(html, /Fecha límite/);
  assert.match(html, /María &amp; José/);
  assert.match(html, /UTC/);
  assert.match(html, /portal-formulario\/abc123/);
  assert.doesNotMatch(html, /prueba de vida/);
});

test('invitation and reminder without configured expiry explicitly state that there is no deadline', () => {
  const html = buildFormEmail({ ...options, variant: 'invitation', expiresAt: null });
  const reminder = buildFormEmail({ ...options, variant: 'reminder', expiresAt: null });
  assert.match(html, /Fecha límite/);
  assert.match(html, /Sin fecha límite/);
  assert.match(reminder, /Sin fecha límite/);
  assert.doesNotMatch(html, /Invalid Date/);
  assert.match(html, /Completar formulario/);
});

test('self-addressed invitation and reminder say the launcher is the respondent', () => {
  for (const variant of ['invitation', 'reminder']) {
    const html = buildFormEmail({ ...options, variant, sentToSelf: true });
    assert.match(html, /María &amp; José \(tú\)/);
    assert.match(html, /tu propia cuenta|solicitaste para ti/);
    assert.doesNotMatch(html, /María &amp; José te ha enviado/);
  }
});

test('public invitation with only an email uses a neutral greeting', () => {
  const html = buildFormEmail({ ...options, variant: 'public_invitation', recipientName: '' });
  assert.match(html, /Hola,<\/p>/);
  assert.doesNotMatch(html, /Hola <strong>Participante<\/strong>/);
});
