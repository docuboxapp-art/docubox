import { writeFile, mkdir } from 'node:fs/promises';
import { createBitcoinAnchorCertificate } from '../src/lib/blockchain-evidence/certificate';

await mkdir('output/pdf', { recursive: true });
const bytes = await createBitcoinAnchorCertificate({
  publicToken: '0123456789abcdef0123456789abcdef0123456789abcdef',
  documentHash: 'a'.repeat(64),
  manifestHash: 'b'.repeat(64),
  proofHash: 'c'.repeat(64),
  blockHeight: 912345,
  blockHash: 'd'.repeat(64),
  attestedAt: '2026-09-08T16:20:00.000Z',
  verifiedAt: '2026-09-08T16:24:00.000Z',
  verificationUrl:
    'https://app.docubox.com.mx/verify/blockchain/0123456789abcdef0123456789abcdef0123456789abcdef',
});
await writeFile('output/pdf/blockchain-anchor-certificate-fixture.pdf', bytes);
