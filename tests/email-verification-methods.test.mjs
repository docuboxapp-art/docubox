import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dashboardPath = new URL(
  '../src/app/documents-dashboard/components/VerificationProgressBar.tsx',
  import.meta.url
);
const profilePath = new URL('../src/app/mi-perfil/page.tsx', import.meta.url);
const registrationPath = new URL('../src/app/registro/page.tsx', import.meta.url);
const sendRoutePath = new URL(
  '../src/app/api/registro/send-verification-email/route.ts',
  import.meta.url
);
const verifyRoutePath = new URL('../src/app/api/registro/verify-email/route.ts', import.meta.url);
const migrationPath = new URL(
  '../supabase/migrations/20260831053244_verification_two_required_methods.sql',
  import.meta.url
);

test('identity progress requires only email and biometric verification', async () => {
  const [dashboard, profile, migration] = await Promise.all([
    readFile(dashboardPath, 'utf8'),
    readFile(profilePath, 'utf8'),
    readFile(migrationPath, 'utf8'),
  ]);

  assert.match(dashboard, /const requiredTotal = 2/);
  assert.doesNotMatch(dashboard, /label: 'Número telefónico'/);
  assert.match(profile, /\{steps\} de 2 verificaciones completadas/);
  assert.doesNotMatch(profile, /label: 'Número Telefónico'/);
  assert.match(
    migration,
    /NEW\.all_verified := \(NEW\.email_verified AND NEW\.biometric_verified\)/
  );
  assert.doesNotMatch(migration, /NEW\.email_verified AND NEW\.phone_verified/);
});

test('phone is optional during registration', async () => {
  const registration = await readFile(registrationPath, 'utf8');

  assert.match(registration, /data\.phone && data\.phone\.replace/);
  assert.match(registration, /Número de teléfono\{' '\}/);
  assert.match(registration, />\(opcional\)<\/span>/);
});

test('email verification uses a bound link and never an OTP', async () => {
  const [profile, sendRoute, verifyRoute] = await Promise.all([
    readFile(profilePath, 'utf8'),
    readFile(sendRoutePath, 'utf8'),
    readFile(verifyRoutePath, 'utf8'),
  ]);

  assert.doesNotMatch(profile, /signInWithOtp/);
  assert.match(profile, /Se envió un enlace de validación/);
  assert.match(sendRoute, /x-docubox-registration-signature/);
  assert.match(sendRoute, /sessionUser\.id === userId/);
  assert.match(sendRoute, /createHash\('sha256'\)\.update\(token\)/);
  assert.match(sendRoute, /Validar correo/);
  assert.doesNotMatch(sendRoute, /\{\{\s*\.Token\s*\}\}/);
  assert.match(verifyRoute, /createHash\('sha256'\)\.update\(token\)/);
  assert.match(verifyRoute, /email_confirm: true/);
  assert.match(verifyRoute, /user_verification_status/);
});

test('verification email follows the current Docubox visual language', async () => {
  const sendRoute = await readFile(sendRoutePath, 'utf8');

  assert.match(sendRoute, /docubox-logo-2026\.png/);
  assert.match(sendRoute, /Seguridad de la cuenta/);
  assert.match(sendRoute, /background-color:#F6F8FB/);
  assert.match(sendRoute, /background-color:#1E6BFF/);
  assert.match(sendRoute, /'Google Sans','Google Sans Text'/);
  assert.doesNotMatch(sendRoute, /linear-gradient/);
  assert.doesNotMatch(sendRoute, /docubox-myi2411\.public\.builtwithrocket\.new/);
  assert.doesNotMatch(sendRoute, /font-family:'Inter'/);
  assert.doesNotMatch(sendRoute, /✉️|📄|✍️|👥|ℹ️/u);
});
