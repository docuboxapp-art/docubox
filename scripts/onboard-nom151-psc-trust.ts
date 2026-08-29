import { createHash, X509Certificate } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SOURCE_URL = 'https://psc.economia.gob.mx/certificados/ACR2_SE.cer';
const EXPECTED_FINGERPRINT = 'b2f258c42c3066c54c3d9bbcb9a4c16bed4e7b74f302643a11af26961e09c720';
const OUTPUT = join(process.cwd(), 'infra', 'nom151', 'trust', 'roots', 'ACR2_SE.pem');

function sha256(value: Uint8Array) {
  return createHash('sha256').update(value).digest('hex');
}

async function main() {
  const response = await fetch(SOURCE_URL, { redirect: 'follow' });
  if (!response.ok) throw new Error(`NOM151_TRUST_DOWNLOAD_HTTP_${response.status}`);
  const der = new Uint8Array(await response.arrayBuffer());
  if (sha256(der) !== EXPECTED_FINGERPRINT) {
    throw new Error('NOM151_TRUST_ROOT_FILE_HASH_MISMATCH');
  }
  const certificate = new X509Certificate(der);
  const fingerprint = certificate.fingerprint256.replace(/:/g, '').toLowerCase();
  if (fingerprint !== EXPECTED_FINGERPRINT) throw new Error('NOM151_UNTRUSTED_ROOT');
  if (!certificate.ca || certificate.subject !== certificate.issuer) {
    throw new Error('NOM151_TRUST_ROOT_PROFILE_INVALID');
  }
  const now = Date.now();
  if (
    new Date(certificate.validFrom).getTime() > now ||
    new Date(certificate.validTo).getTime() < now
  ) {
    throw new Error('NOM151_TRUST_ROOT_EXPIRED');
  }
  const base64 = Buffer.from(der)
    .toString('base64')
    .match(/.{1,64}/g)
    ?.join('\n');
  if (!base64) throw new Error('NOM151_TRUST_ROOT_ENCODING_FAILED');
  await mkdir(join(process.cwd(), 'infra', 'nom151', 'trust', 'roots'), { recursive: true });
  await writeFile(
    OUTPUT,
    `-----BEGIN CERTIFICATE-----\n${base64}\n-----END CERTIFICATE-----\n`,
    'utf8'
  );
  console.info('NOM151 PSC TRUST ROOT ONBOARDED');
  console.info(`fingerprint_sha256=${fingerprint}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
