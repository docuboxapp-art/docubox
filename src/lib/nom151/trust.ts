import 'server-only';

import { createHash, X509Certificate } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

export type Nom151Environment = 'development' | 'sandbox' | 'production' | 'unknown';

export type Nom151CertificateEvidence = {
  subject: string;
  issuer: string;
  serial: string;
  fingerprintSha256: string;
  validFrom: string;
  validTo: string;
  validNow: boolean;
  ca: boolean;
};

export type Nom151TrustManifest = {
  id: string;
  version: string;
  status: 'active' | 'superseded';
  provider: string;
  psc: string;
  endpointHost: string;
  sourceUrl: string;
  root: { path: string; fingerprintSha256: string };
  intermediates: Array<{ path: string; fingerprintSha256: string }>;
  expectedSignerPolicyOids: string[];
  expectedTstPolicyOids: string[];
  requiredKeyUsages: string[];
  requiredExtendedKeyUsageOids: string[];
  signerMustBeCa: boolean;
};

export type Nom151TrustBundle = {
  loaded: boolean;
  version: string | null;
  manifest: Nom151TrustManifest | null;
  rootsPem: string[];
  intermediatesPem: string[];
  roots: Nom151CertificateEvidence[];
  intermediates: Nom151CertificateEvidence[];
  rootTrusted: boolean;
  certificatesWithinValidity: boolean;
  missing: string[];
  errors: string[];
};

const VALID_ENVIRONMENTS = new Set(['development', 'sandbox', 'production']);

function normalizedPath(value: string) {
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

function normalizeFingerprint(value: unknown) {
  const normalized = String(value || '')
    .replace(/:/g, '')
    .trim()
    .toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function splitPemCertificates(value: string) {
  return value.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
}

function certificateEvidence(pem: string): Nom151CertificateEvidence {
  const certificate = new X509Certificate(pem);
  const now = Date.now();
  return {
    subject: certificate.subject,
    issuer: certificate.issuer,
    serial: certificate.serialNumber,
    fingerprintSha256: certificate.fingerprint256.replace(/:/g, '').toLowerCase(),
    validFrom: new Date(certificate.validFrom).toISOString(),
    validTo: new Date(certificate.validTo).toISOString(),
    validNow:
      new Date(certificate.validFrom).getTime() <= now &&
      new Date(certificate.validTo).getTime() >= now,
    ca: certificate.ca,
  };
}

async function readPemSetting(directValue: string | undefined, pathValue: string | undefined) {
  const direct = directValue?.replace(/\\n/g, '\n').trim();
  if (direct) return splitPemCertificates(direct);
  if (!pathValue?.trim()) return [];
  return splitPemCertificates(await readFile(normalizedPath(pathValue.trim()), 'utf8'));
}

export function resolveNom151Environment(): {
  environment: Nom151Environment;
  explicit: boolean;
  source: 'NOM151_ENVIRONMENT' | 'NOM151_PROVIDER_ENVIRONMENT' | 'none';
} {
  const configured = process.env.NOM151_ENVIRONMENT?.trim().toLowerCase();
  if (configured) {
    return {
      environment: VALID_ENVIRONMENTS.has(configured)
        ? (configured as Nom151Environment)
        : 'unknown',
      explicit: VALID_ENVIRONMENTS.has(configured),
      source: 'NOM151_ENVIRONMENT',
    };
  }
  const legacy = process.env.NOM151_PROVIDER_ENVIRONMENT?.trim().toLowerCase();
  if (legacy) {
    return {
      environment: VALID_ENVIRONMENTS.has(legacy) ? (legacy as Nom151Environment) : 'unknown',
      explicit: false,
      source: 'NOM151_PROVIDER_ENVIRONMENT',
    };
  }
  return { environment: 'unknown', explicit: false, source: 'none' };
}

export function endpointFingerprint(endpoint: string) {
  return createHash('sha256').update(endpoint.trim()).digest('hex');
}

export async function loadNom151TrustBundle(): Promise<Nom151TrustBundle> {
  const missing: string[] = [];
  const errors: string[] = [];
  const manifestPath = process.env.NOM151_PSC_TRUST_MANIFEST_PATH?.trim();
  let manifest: Nom151TrustManifest | null = null;
  if (!manifestPath) {
    missing.push('NOM151_PSC_TRUST_MANIFEST_PATH');
  } else {
    try {
      manifest = JSON.parse(
        await readFile(normalizedPath(manifestPath), 'utf8')
      ) as Nom151TrustManifest;
      if (!manifest.id || !manifest.version || manifest.status !== 'active') {
        errors.push('NOM151_TRUST_MANIFEST_INVALID');
      }
    } catch {
      errors.push('NOM151_TRUST_MANIFEST_INVALID');
    }
  }

  let rootsPem: string[] = [];
  let intermediatesPem: string[] = [];
  try {
    rootsPem = await readPemSetting(
      process.env.NOM151_PSC_TRUST_ROOT_PEM,
      process.env.NOM151_PSC_TRUST_ROOT_PATH
    );
  } catch {
    errors.push('NOM151_TRUST_ROOT_INVALID');
  }
  try {
    intermediatesPem = await readPemSetting(
      process.env.NOM151_PSC_TRUST_INTERMEDIATES_PEM,
      process.env.NOM151_PSC_TRUST_INTERMEDIATES_PATH
    );
  } catch {
    errors.push('NOM151_TRUST_INTERMEDIATES_INVALID');
  }
  if (!rootsPem.length) missing.push('NOM151_PSC_TRUST_ROOT_PATH');

  let roots: Nom151CertificateEvidence[] = [];
  let intermediates: Nom151CertificateEvidence[] = [];
  try {
    roots = rootsPem.map(certificateEvidence);
    intermediates = intermediatesPem.map(certificateEvidence);
  } catch {
    errors.push('NOM151_TRUST_CERTIFICATE_INVALID');
  }

  const configuredFingerprint = normalizeFingerprint(process.env.NOM151_PSC_TRUST_ROOT_SHA256);
  if (!configuredFingerprint) missing.push('NOM151_PSC_TRUST_ROOT_SHA256');
  const manifestFingerprint = normalizeFingerprint(manifest?.root?.fingerprintSha256);
  const rootTrusted = Boolean(
    configuredFingerprint &&
    manifestFingerprint &&
    configuredFingerprint === manifestFingerprint &&
    roots.some(
      (root) =>
        root.fingerprintSha256 === configuredFingerprint && root.ca && root.subject === root.issuer
    )
  );
  if (rootsPem.length && !rootTrusted) errors.push('NOM151_UNTRUSTED_ROOT');
  if (
    manifest &&
    (manifest.intermediates.length !== intermediates.length ||
      !manifest.intermediates.every((expected) =>
        intermediates.some(
          (certificate) =>
            certificate.fingerprintSha256 === normalizeFingerprint(expected.fingerprintSha256)
        )
      ))
  ) {
    errors.push('NOM151_TRUST_INTERMEDIATES_MISMATCH');
  }

  const configuredVersion = process.env.NOM151_PSC_TRUST_BUNDLE_VERSION?.trim() || null;
  if (!configuredVersion) missing.push('NOM151_PSC_TRUST_BUNDLE_VERSION');
  if (configuredVersion && manifest && configuredVersion !== manifest.version) {
    errors.push('NOM151_TRUST_BUNDLE_VERSION_MISMATCH');
  }

  const certificatesWithinValidity = [...roots, ...intermediates].every(
    (certificate) => certificate.validNow
  );
  if (!certificatesWithinValidity) errors.push('NOM151_TRUST_CERTIFICATE_EXPIRED');

  return {
    loaded: Boolean(manifest && rootsPem.length && !errors.length),
    version: configuredVersion,
    manifest,
    rootsPem,
    intermediatesPem,
    roots,
    intermediates,
    rootTrusted,
    certificatesWithinValidity,
    missing: [...new Set(missing)],
    errors: [...new Set(errors)],
  };
}
