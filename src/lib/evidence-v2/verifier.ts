import { constants, createPublicKey, verify } from 'node:crypto';
import { sha256Hex } from '@/lib/certification/canonical';
import { evidenceV2SigningPayload, normalizeSha256 } from './canonical';
import { validateEvidenceV2Xml } from './xml';

function text(xml: string, name: string) {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)<\\/${name}>`));
  return match?.[1]?.trim() || null;
}

function attribute(xml: string, name: string, attributeName: string) {
  const match = xml.match(new RegExp(`<${name}\\s+[^>]*${attributeName}="([^"]+)"[^>]*>`));
  return match?.[1] || null;
}

export type EvidenceV2Verification = {
  valid: boolean;
  overall: 'valid' | 'valid_with_pending_certifications' | 'invalid' | 'incomplete';
  xmlIntegrity: 'valid' | 'invalid';
  chainIntegrity: 'valid' | 'invalid';
  docuboxSignature: 'valid' | 'invalid' | 'not_applied';
  errors: string[];
};

export function verifyEvidenceV2Xml(xml: string): EvidenceV2Verification {
  const errors = [...validateEvidenceV2Xml(xml).errors];
  const storedXmlHash = text(xml, 'HashXML');
  const canonicalXml = xml.replace(/(<HashXML[^>]*>)[^<]*(<\/HashXML>)/, '$1$2');
  const xmlIntegrity =
    storedXmlHash &&
    /^[a-f0-9]{64}$/i.test(storedXmlHash) &&
    sha256Hex(canonicalXml) === storedXmlHash
      ? 'valid'
      : 'invalid';
  if (xmlIntegrity === 'invalid') errors.push('XML digest does not match the serialized package');

  const eventPattern =
    /<Evento\s+([^>]*)>[\s\S]*?<HashEvento[^>]*>([a-f0-9]{64})<\/HashEvento>[\s\S]*?<PreviousHash[^>]*>([a-f0-9]{64})<\/PreviousHash>[\s\S]*?<ChainedHash[^>]*>([a-f0-9]{64})<\/ChainedHash>[\s\S]*?<\/Evento>/gi;
  const events = [...xml.matchAll(eventPattern)].map((match) => ({
    sequence: Number((match[1].match(/sequence="(\d+)"/) || [])[1]),
    eventHash: match[2].toLowerCase(),
    previousHash: match[3].toLowerCase(),
    chainedHash: match[4].toLowerCase(),
  }));
  const genesisHash = text(xml, 'GenesisHash');
  const rootHash = text(xml, 'RootHash');
  let previous = genesisHash?.toLowerCase() || '';
  let chainIntegrity: 'valid' | 'invalid' = 'valid';
  for (const [index, event] of events.entries()) {
    const computed = sha256Hex(
      Buffer.concat([
        Buffer.from('docubox-evidence-chain-v1\0', 'utf8'),
        Buffer.from(previous, 'hex'),
        Buffer.from(event.eventHash, 'hex'),
      ])
    );
    if (
      event.sequence !== index + 1 ||
      event.previousHash !== previous ||
      event.chainedHash !== computed
    )
      chainIntegrity = 'invalid';
    previous = event.chainedHash;
  }
  if (!genesisHash || !rootHash || previous !== rootHash.toLowerCase()) chainIntegrity = 'invalid';
  if (chainIntegrity === 'invalid') errors.push('Evidence chain does not match its root hash');

  let docuboxSignature: EvidenceV2Verification['docuboxSignature'] = 'not_applied';
  if (attribute(xml, 'FirmaDocubox', 'estado') === 'applied') {
    try {
      const finalHash = text(xml, 'HashFinal');
      const packageDigest = text(xml, 'EvidencePackageDigest');
      const signature = text(xml, 'SignatureValue');
      const publicKeyBase64 = text(xml, 'PublicKeyPemBase64');
      const algorithm = text(xml, 'Algorithm');
      if (!finalHash || !packageDigest || !signature || !publicKeyBase64 || !algorithm)
        throw new Error('incomplete Docubox signature');
      const payload = evidenceV2SigningPayload({
        document: { finalHash: normalizeSha256(finalHash, 'HashFinal') },
        chain: { rootHash: normalizeSha256(rootHash!, 'RootHash') },
        packageDigest: normalizeSha256(packageDigest, 'EvidencePackageDigest'),
      } as never);
      const publicKey = createPublicKey(Buffer.from(publicKeyBase64, 'base64'));
      const valid =
        algorithm === 'RSA-PSS-SHA256'
          ? verify(
              'sha256',
              Buffer.from(payload.canonical, 'utf8'),
              { key: publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 },
              Buffer.from(signature, 'base64')
            )
          : verify(
              'sha256',
              Buffer.from(payload.canonical, 'utf8'),
              { key: publicKey, padding: constants.RSA_PKCS1_PADDING },
              Buffer.from(signature, 'base64')
            );
      docuboxSignature = valid ? 'valid' : 'invalid';
      if (!valid) errors.push('Docubox KMS signature verification failed');
    } catch {
      docuboxSignature = 'invalid';
      errors.push('Docubox KMS signature is malformed');
    }
  }
  const declaredOverall = attribute(xml, 'Verificacion', 'overallStatus');
  const hasPendingExternalCertification = declaredOverall === 'valid_with_pending_certifications';
  const overall =
    xmlIntegrity === 'invalid' || chainIntegrity === 'invalid' || docuboxSignature === 'invalid'
      ? 'invalid'
      : docuboxSignature !== 'valid'
        ? 'incomplete'
        : hasPendingExternalCertification
          ? 'valid_with_pending_certifications'
          : 'valid';
  return {
    valid: errors.length === 0 && overall !== 'incomplete',
    overall,
    xmlIntegrity,
    chainIntegrity,
    docuboxSignature,
    errors,
  };
}
