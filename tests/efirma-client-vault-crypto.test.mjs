import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import test from 'node:test';

import forge from 'node-forge';

const vaultModule = await import(
  pathToFileURL(path.join(process.cwd(), 'src', 'lib', 'efirma', 'client-vault.ts')).href
);

function bytesToBase64(bytes) {
  return Buffer.from(bytes, 'binary').toString('base64');
}

function createFixture(password) {
  const pair = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 });
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = pair.publicKey;
  certificate.serialNumber = '01';
  certificate.validity.notBefore = new Date(Date.now() - 60_000);
  certificate.validity.notAfter = new Date(Date.now() + 86_400_000);
  const attributes = [{ name: 'commonName', value: 'EFIRMA TEST' }];
  certificate.setSubject(attributes);
  certificate.setIssuer(attributes);
  certificate.sign(pair.privateKey, forge.md.sha256.create());

  const privateKeyInfo = forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(pair.privateKey));
  const encryptedPrivateKey = forge.pki.encryptPrivateKeyInfo(privateKeyInfo, password, {
    algorithm: 'aes256',
    count: 10_000,
    saltSize: 16,
    prfAlgorithm: 'sha256',
  });

  return {
    pair,
    certificateBase64: bytesToBase64(
      forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes()
    ),
    keyBytes: Uint8Array.from(forge.asn1.toDer(encryptedPrivateKey).getBytes(), (character) =>
      character.charCodeAt(0)
    ),
  };
}

test('encrypts, unlocks and signs without exposing the private key', async () => {
  const password = 'correct horse battery staple';
  const fixture = createFixture(password);
  const material = await vaultModule.encryptEfirmaKeyForStorage(
    fixture.keyBytes,
    password,
    fixture.certificateBase64
  );

  assert.equal(material.wrap_algorithm, 'AES-256-GCM');
  assert.equal(material.kdf_algorithm, 'PBKDF2-SHA256');
  assert.notEqual(
    material.encrypted_key_ciphertext,
    Buffer.from(fixture.keyBytes).toString('base64')
  );

  const payload = Buffer.from('docubox local signature', 'utf8').toString('base64');
  const signatureBase64 = await vaultModule.signEfirmaPayloadLocally(material, password, payload);
  const digest = forge.md.sha256.create();
  digest.update('docubox local signature', 'utf8');
  assert.equal(
    fixture.pair.publicKey.verify(
      digest.digest().bytes(),
      Buffer.from(signatureBase64, 'base64').toString('binary')
    ),
    true
  );
});

test('rejects the wrong password before a signature is produced', async () => {
  const fixture = createFixture('right-password');
  const material = await vaultModule.encryptEfirmaKeyForStorage(
    fixture.keyBytes,
    'right-password',
    fixture.certificateBase64
  );

  await assert.rejects(
    vaultModule.signEfirmaPayloadLocally(material, 'wrong-password', 'cGF5bG9hZA=='),
    /EFIRMA_PASSWORD_INVALID/
  );
});
