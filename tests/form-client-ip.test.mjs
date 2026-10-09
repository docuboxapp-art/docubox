import assert from 'node:assert/strict';
import test from 'node:test';
import { getClientIp } from '../supabase/functions/_shared/client-ip.ts';

test('uses only the client address from a forwarded IP chain', () => {
  const headers = new Headers({
    'x-forwarded-for': '177.230.62.203,177.230.62.203, 13.248.99.201',
  });

  assert.equal(getClientIp(headers), '177.230.62.203');
});

test('accepts IPv6 and falls back when the forwarded address is invalid', () => {
  assert.equal(getClientIp(new Headers({ 'x-forwarded-for': '2001:db8::1, 10.0.0.1' })), '2001:db8::1');
  assert.equal(
    getClientIp(new Headers({ 'x-forwarded-for': 'invalid', 'cf-connecting-ip': '203.0.113.8' })),
    '203.0.113.8'
  );
});

test('does not pass malformed addresses to inet columns', () => {
  assert.equal(getClientIp(new Headers({ 'x-forwarded-for': '999.999.999.999' })), null);
  assert.equal(getClientIp(new Headers({ 'x-forwarded-for': '203.0.113.8:1234' })), null);
  assert.equal(getClientIp(new Headers()), null);
});
