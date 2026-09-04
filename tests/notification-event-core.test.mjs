import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('notification event core persists lifecycle, delivery and preference controls', () => {
  const migration = read('supabase/migrations/20260903184030_notification_event_core.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.notification_preferences/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.notification_deliveries/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.notification_event_log/i);
  assert.match(migration, /UNIQUE\(notification_id, channel\)/i);
  assert.match(migration, /immutable_notification_event_log/i);
});

test('notifications are read-only from the browser and tenant-safe from the service', () => {
  const migration = read('supabase/migrations/20260903184030_notification_event_core.sql');
  const service = read('src/lib/notifications/service.ts');
  assert.match(migration, /REVOKE ALL ON TABLE public\.notifications FROM anon, authenticated/i);
  assert.match(migration, /GRANT SELECT ON TABLE public\.notifications TO authenticated/i);
  assert.match(migration, /USING \(\(SELECT auth\.uid\(\)\) = user_id\)/i);
  assert.match(service, /Document events must remain tenant-scoped/i);
  assert.match(service, /from\('documentos'\)/i);
});

test('domain event emission sanitizes sensitive metadata and deduplicates per recipient', () => {
  const policy = read('src/lib/notifications/policy.ts');
  const service = read('src/lib/notifications/service.ts');
  assert.match(policy, /password\|passphrase\|secret\|token\|private/i);
  assert.match(service, /\$\{cleanText\(input\.deduplicationKey, 360\)\}:\$\{recipient\.userId\}/i);
  assert.match(service, /outcome: 'deduplicated'/i);
  assert.match(service, /notification_event_log/i);
});

test('client notification mutations go through authenticated routes rather than direct table writes', () => {
  const client = read('src/lib/notifications/client.ts');
  const page = read('src/app/notifications/page.tsx');
  const nav = read('src/components/TopNav.tsx');
  assert.match(client, /fetch\('\/api\/notifications'/i);
  assert.match(page, /updateNotifications\('archived'/i);
  assert.match(nav, /updateNotifications\('read'/i);
  assert.doesNotMatch(page, /\.from\('notifications'\)\.delete/i);
});

test('new-device checks are session-bound before any notification can be emitted', () => {
  const route = read('src/app/api/security/check-device/route.ts');
  assert.match(route, /authData\.user\.id !== userId/i);
  assert.match(route, /eventType: 'security\.new_device'/i);
  assert.match(route, /deduplicationKey: `security\.new_device:/i);
});
