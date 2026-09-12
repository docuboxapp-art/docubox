import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CertificateProvider } from './certificates';
import type { ProviderHealth } from './key-management';
import type {
  EmbedSignatureInput,
  PdfSignatureProvider,
  PdfVerificationResult,
  PadesBtUpgradeResult,
  PreparePdfInput,
  PreparedPdf,
  SignedPdfResult,
  UpgradePadesBtInput,
  VerifyPdfInput,
} from './pades';
import { CertificationError } from './types';
import type { PdfNativeProtectionPolicy } from '@/lib/documents/pdf-native-protection';

const MAX_RUNTIME_OUTPUT_BYTES = 160 * 1024 * 1024;

type RuntimeResponse = {
  ok: true;
  pdf_base64: string;
  pdf_sha256: string;
  cms_base64: string;
  cms_sha256: string;
  byte_range: [number, number, number, number];
  signature_algorithm: 'RSA-PKCS1-SHA256';
  digest_algorithm: 'SHA-256';
  signing_time: string;
  key_id: string;
  key_version: string;
  signature_count: number;
  encryption: 'AES-256';
};

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

function runtimePolicy(policy: PdfNativeProtectionPolicy) {
  return {
    deny_print: policy.denyPrint,
    deny_copy_content: policy.denyCopyContent,
    deny_modify: policy.denyModify,
    deny_page_extraction: policy.denyPageExtraction,
    deny_document_assembly: policy.denyDocumentAssembly,
  };
}

export function resolvePdfSecurityRuntimeCommand(
  options: {
    cwd?: string;
    platform?: NodeJS.Platform;
    pythonBin?: string;
    script?: string;
  } = {}
) {
  const cwd = options.cwd || process.cwd();
  const platform = options.platform || process.platform;
  const localCandidates =
    platform === 'win32'
      ? [join(cwd, '.venv-pdf-security', 'Scripts', 'python.exe')]
      : [
          join(cwd, '.venv-pdf-security', 'bin', 'python3'),
          join(cwd, '.venv-pdf-security', 'bin', 'python'),
        ];
  const localPython = localCandidates.find((candidate) => existsSync(candidate));

  return {
    executable:
      options.pythonBin?.trim() ||
      process.env.DOCUBOX_PDF_SECURITY_PYTHON_BIN?.trim() ||
      localPython ||
      (platform === 'win32' ? 'py' : 'python3'),
    script:
      options.script?.trim() ||
      process.env.DOCUBOX_PDF_SECURITY_SCRIPT?.trim() ||
      join(cwd, 'vps', 'signer', 'pdf_security.py'),
  };
}

function runtimeTimeoutMs() {
  const parsed = Number(process.env.DOCUBOX_PDF_SECURITY_TIMEOUT_MS || 120_000);
  return Number.isFinite(parsed) ? Math.min(600_000, Math.max(10_000, parsed)) : 120_000;
}

async function callRemoteRuntime(
  url: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const token = process.env.DOCUBOX_PDF_SECURITY_TOKEN?.trim();
  if (!token) {
    throw new CertificationError(
      'DOCUBOX_PDF_SECURITY_TOKEN_MISSING',
      'El procesador remoto de protección PDF no tiene autenticación configurada.',
      503
    );
  }
  const response = await fetch(`${url.replace(/\/$/, '')}/pdf-security`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(runtimeTimeoutMs()),
    cache: 'no-store',
  }).catch(() => null);
  if (!response) {
    throw new CertificationError(
      'PDF_SECURITY_RUNTIME_UNAVAILABLE',
      'El procesador remoto de protección nativa del PDF no está disponible.',
      503
    );
  }
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength > MAX_RUNTIME_OUTPUT_BYTES) {
    throw new CertificationError(
      'PDF_SECURITY_RUNTIME_OUTPUT_TOO_LARGE',
      'La salida del procesador PDF excedió el límite permitido.',
      502
    );
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(Buffer.from(body).toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new CertificationError(
      'PDF_SECURITY_RUNTIME_RESPONSE_INVALID',
      'El procesador PDF devolvió una respuesta inválida.',
      502
    );
  }
  if (!response.ok || parsed.ok !== true) {
    throw new CertificationError(
      typeof parsed.code === 'string' ? parsed.code : 'PDF_SECURITY_RUNTIME_FAILED',
      'No fue posible aplicar la protección nativa al PDF final.',
      response.status >= 500 ? 502 : response.status
    );
  }
  return parsed;
}

async function callRuntime(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const remoteUrl = process.env.DOCUBOX_PDF_SECURITY_URL?.trim();
  if (remoteUrl) return callRemoteRuntime(remoteUrl, payload);
  const command = resolvePdfSecurityRuntimeCommand();
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, [command.script], {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const finish = (error?: Error, value?: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value || {});
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(
        new CertificationError(
          'PDF_SECURITY_RUNTIME_TIMEOUT',
          'La protección nativa del PDF excedió el tiempo permitido.',
          504
        )
      );
    }, runtimeTimeoutMs());

    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_RUNTIME_OUTPUT_BYTES) {
        child.kill();
        finish(
          new CertificationError(
            'PDF_SECURITY_RUNTIME_OUTPUT_TOO_LARGE',
            'La salida del procesador PDF excedió el límite permitido.',
            502
          )
        );
        return;
      }
      stdout.push(chunk);
    });
    // Drain stderr without persisting it: provider output can contain sensitive details.
    child.stderr.resume();
    child.on('error', () => {
      finish(
        new CertificationError(
          'PDF_SECURITY_RUNTIME_UNAVAILABLE',
          'El procesador de protección nativa del PDF no está disponible.',
          503
        )
      );
    });
    child.on('close', (code) => {
      if (settled) return;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(Buffer.concat(stdout).toString('utf8')) as Record<string, unknown>;
      } catch {
        finish(
          new CertificationError(
            'PDF_SECURITY_RUNTIME_RESPONSE_INVALID',
            'El procesador PDF devolvió una respuesta inválida.',
            502
          )
        );
        return;
      }
      if (code !== 0 || parsed.ok !== true) {
        finish(
          new CertificationError(
            typeof parsed.code === 'string' ? parsed.code : 'PDF_SECURITY_RUNTIME_FAILED',
            'No fue posible aplicar la protección nativa al PDF final.',
            502
          )
        );
        return;
      }
      finish(undefined, parsed);
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function parseRuntimeResponse(value: Record<string, unknown>): RuntimeResponse {
  const range = value.byte_range;
  if (
    value.ok !== true ||
    value.encryption !== 'AES-256' ||
    value.signature_algorithm !== 'RSA-PKCS1-SHA256' ||
    value.digest_algorithm !== 'SHA-256' ||
    typeof value.pdf_base64 !== 'string' ||
    typeof value.pdf_sha256 !== 'string' ||
    typeof value.cms_base64 !== 'string' ||
    typeof value.cms_sha256 !== 'string' ||
    typeof value.signing_time !== 'string' ||
    typeof value.key_id !== 'string' ||
    typeof value.key_version !== 'string' ||
    !Array.isArray(range) ||
    range.length !== 4 ||
    !range.every((item) => Number.isSafeInteger(item) && Number(item) >= 0)
  ) {
    throw new CertificationError(
      'PDF_SECURITY_RUNTIME_RESPONSE_INVALID',
      'El procesador PDF devolvió metadatos criptográficos inválidos.',
      502
    );
  }
  return value as RuntimeResponse;
}

export class PyHankoProtectedPdfSignatureProvider implements PdfSignatureProvider {
  readonly providerId = 'pyhanko-aes256-kms' as const;

  constructor(
    private readonly policy: PdfNativeProtectionPolicy,
    private readonly certificateProvider: CertificateProvider,
    private readonly verifier: PdfSignatureProvider
  ) {}

  async preparePdf(input: PreparePdfInput): Promise<PreparedPdf> {
    if (!Buffer.from(input.pdfBytes).subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      throw new CertificationError(
        'PADES_SOURCE_PDF_INVALID',
        'El archivo fuente no es un PDF firmable válido.',
        422
      );
    }
    return {
      pdfBytes: input.pdfBytes,
      byteRange: [0, 0, 0, 0],
      signedBytes: input.pdfBytes,
      documentDigestSha256: sha256(input.pdfBytes),
      contentsStart: 0,
      contentsEnd: 0,
      signatureHexLength: 0,
    };
  }

  async embedSignature(input: EmbedSignatureInput): Promise<SignedPdfResult> {
    if (input.profile !== 'PAdES-B-B') {
      throw new CertificationError(
        'PDF_SECURITY_PADES_PROFILE_INVALID',
        'El PDF protegido debe iniciar como PAdES-B-B antes de aplicar TSA.',
        409
      );
    }
    const response = parseRuntimeResponse(
      await callRuntime({
        operation: 'protect_and_sign',
        pdf_base64: Buffer.from(input.prepared.pdfBytes).toString('base64'),
        policy: runtimePolicy(this.policy),
        signature_count: 1,
        tenant_id: input.tenantId,
        idempotency_key: input.idempotencyKey,
      })
    );
    const pdfBytes = new Uint8Array(Buffer.from(response.pdf_base64, 'base64'));
    const cmsBytes = new Uint8Array(Buffer.from(response.cms_base64, 'base64'));
    if (sha256(pdfBytes) !== response.pdf_sha256 || sha256(cmsBytes) !== response.cms_sha256) {
      throw new CertificationError(
        'PDF_SECURITY_RUNTIME_HASH_MISMATCH',
        'La salida protegida no coincide con sus huellas criptográficas.',
        502
      );
    }
    const certificate = await this.certificateProvider.verifyCertificateChain();
    if (!certificate.certificate) {
      throw new CertificationError(
        'PADES_CERTIFICATE_INVALID',
        'No existe un certificado X.509 válido vinculado a la llave administrada.',
        503
      );
    }
    const verification = await this.verifier.verifyPdf({
      pdfBytes,
      expectedCertificateFingerprintSha256: certificate.certificate.fingerprintSha256,
    });
    if (!verification.valid || verification.profile !== 'PAdES-B-B') {
      throw new CertificationError(
        'PADES_POST_SIGN_VERIFICATION_FAILED',
        verification.detail || 'La firma PAdES del PDF protegido no pudo verificarse.',
        502
      );
    }
    return {
      pdfBytes,
      profile: 'PAdES-B-B',
      byteRange: response.byte_range,
      cmsBytes,
      cmsHashSha256: response.cms_sha256,
      pdfHashAfterSignature: response.pdf_sha256,
      certificateSerialNumber: certificate.certificate.serialNumber,
      certificateFingerprintSha256: certificate.certificate.fingerprintSha256,
      signatureAlgorithm: 'RSA-PKCS1-SHA256',
      digestAlgorithm: 'SHA-256',
      signingTimeDeclared: response.signing_time,
      keyId: response.key_id,
      keyVersion: response.key_version,
      timestamp: null,
    };
  }

  verifyPdf(input: VerifyPdfInput): Promise<PdfVerificationResult> {
    return this.verifier.verifyPdf(input);
  }

  upgradeToPadesBt(input: UpgradePadesBtInput): Promise<PadesBtUpgradeResult> {
    return this.verifier.upgradeToPadesBt(input);
  }

  async healthCheck(): Promise<ProviderHealth> {
    const base = await this.verifier.healthCheck();
    try {
      await callRuntime({ operation: 'health' });
      return { ...base, provider: this.providerId };
    } catch {
      return {
        ...base,
        ready: false,
        missing: [...new Set([...base.missing, 'DOCUBOX_PDF_SECURITY_RUNTIME'])],
        provider: this.providerId,
      };
    }
  }
}
