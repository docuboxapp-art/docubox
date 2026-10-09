import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  approximateLoginLocation,
  clientIp,
  shouldAlertForLocation,
} from '../src/lib/security/login-location.ts';

const originalVercel = process.env.VERCEL;
test.after(() => {
  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
});

const known = [
  { device_fingerprint: 'chrome|windows|desktop', city: 'Mazatlan', country: 'Mexico' },
];

test('Vercel IP metadata is approximate and does not assert a city for local requests', () => {
  process.env.VERCEL = '1';
  const headers = new Headers({
    'x-vercel-forwarded-for': '189.1.2.3',
    'x-vercel-ip-city': 'Mazatl%C3%A1n',
    'x-vercel-ip-country': 'MX',
    'x-vercel-ip-latitude': '23.24',
    'x-vercel-ip-longitude': '-106.42',
  });
  assert.equal(clientIp(headers), '189.1.2.3');
  assert.deepEqual(approximateLoginLocation(headers, '189.1.2.3'), {
    city: 'Mazatlán', country: 'Mexico', countryCode: 'MX', region: null,
    latitude: 23.24, longitude: -106.42, timezone: null,
  });
  assert.equal(approximateLoginLocation(headers, '::1').city, null);
  delete process.env.VERCEL;
  assert.equal(approximateLoginLocation(headers, '189.1.2.3').city, null);
});

test('browser changes in a known city and unavailable locations do not send alerts', () => {
  const location = {
    city: 'Mazatlán', country: 'Mexico', countryCode: 'MX', region: null,
    latitude: null, longitude: null, timezone: null,
  };
  assert.equal(shouldAlertForLocation(known, 'firefox|windows|desktop', location), false);
  assert.equal(shouldAlertForLocation(known, 'firefox|windows|desktop', { ...location, city: null }), false);
  assert.equal(shouldAlertForLocation([], 'firefox|windows|desktop', location), false);
});

test('unusual country or new browser plus different city triggers an alert', () => {
  const location = {
    city: 'Culiacán', country: 'Mexico', countryCode: 'MX', region: null,
    latitude: null, longitude: null, timezone: null,
  };
  assert.equal(shouldAlertForLocation(known, 'firefox|windows|desktop', location), true);
  assert.equal(shouldAlertForLocation(known, 'chrome|windows|desktop', location), false);
  assert.equal(shouldAlertForLocation(known, 'chrome|windows|desktop', {
    ...location, city: 'Phoenix', country: 'United States', countryCode: 'US',
  }), true);
});

test('device reporting remains asynchronous and TOTP reports only after verification', () => {
  const report = readFileSync(new URL('../src/lib/security/report-login-device.ts', import.meta.url), 'utf8');
  const totp = readFileSync(new URL('../src/components/totp/TotpVerificationPage.tsx', import.meta.url), 'utf8');
  assert.match(report, /void fetch\('\/api\/security\/check-device'/);
  assert.match(report, /keepalive: true/);
  assert.ok(totp.indexOf('if (!res.ok)') < totp.indexOf('reportLoginDevice(session.user.id, session.access_token)'));
});
