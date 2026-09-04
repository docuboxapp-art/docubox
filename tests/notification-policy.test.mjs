import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { transformSync } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function loadPolicy() {
  const output = transformSync(read('src/lib/notifications/policy.ts'), {
    loader: 'ts',
    format: 'cjs',
    target: 'node20',
  }).code;
  const module = { exports: {} };
  new Function('module', 'exports', output)(module, module.exports);
  return module.exports;
}

test('notification types retain the product taxonomy', () => {
  const { NOTIFICATION_TYPE_DEFINITIONS } = loadPolicy();
  assert.deepEqual(Object.keys(NOTIFICATION_TYPE_DEFINITIONS), [
    'document',
    'task',
    'request',
    'alert',
    'info',
  ]);
  assert.match(NOTIFICATION_TYPE_DEFINITIONS.request.description, /firma, aprobación, revisión/i);
});

test('event policies model requests, alerts and low-priority information', () => {
  const { notificationEventPolicy } = loadPolicy();
  assert.deepEqual(notificationEventPolicy('signature.requested'), {
    legacyType: 'request',
    legacyPriority: 'media',
    category: 'SIGNATURE',
    severity: 'info',
    channels: ['in_app', 'email'],
  });
  assert.equal(notificationEventPolicy('document.completed').legacyPriority, 'baja');
  assert.equal(notificationEventPolicy('security.suspicious_login').severity, 'critical');
  assert.equal(notificationEventPolicy('document.legal_hold.applied').category, 'RETENTION');
  assert.deepEqual(notificationEventPolicy('document.expiring').channels, ['in_app', 'email']);
  assert.equal(notificationEventPolicy('task.assigned').legacyType, 'task');
  assert.equal(notificationEventPolicy('organization.invitation.created').legacyType, 'request');
});

test('priority preservation and critical delivery are enforced by the emitter', () => {
  const source = read('src/lib/notifications/service.ts');
  assert.match(source, /priority: legacyPriority \?\? toLegacyPriority\(severity\)/);
  assert.match(source, /\[\.\.\.requestedChannels, 'in_app', 'email'\]/);
  assert.match(source, /isMandatoryNotification\(category, severity\)/);
});
