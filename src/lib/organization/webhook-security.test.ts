import test from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateNetworkAddress, parsePublicWebhookUrl } from './webhook-security.ts';

test('rejects private and loopback webhook destinations', () => {
  for (const address of [
    '127.0.0.1',
    '10.1.2.3',
    '172.20.0.1',
    '192.168.1.10',
    '169.254.169.254',
    '::1',
    'fd00::1',
  ]) {
    assert.equal(isPrivateNetworkAddress(address), true, address);
  }
});

test('accepts public addresses and HTTPS public hostnames', () => {
  assert.equal(isPrivateNetworkAddress('8.8.8.8'), false);
  assert.equal(
    parsePublicWebhookUrl('https://events.example.com/docubox')?.hostname,
    'events.example.com'
  );
});

test('rejects insecure, local, and credential-bearing webhook URLs', () => {
  assert.equal(parsePublicWebhookUrl('http://events.example.com'), null);
  assert.equal(parsePublicWebhookUrl('https://localhost/hook'), null);
  assert.equal(parsePublicWebhookUrl('https://user:password@events.example.com/hook'), null);
  assert.equal(parsePublicWebhookUrl('https://192.168.1.10/hook'), null);
});
