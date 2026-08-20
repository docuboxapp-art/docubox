import { createHash, randomUUID } from 'crypto';
import type { CertificationServiceKey } from './domain';

export type ProviderRequest = {
  certificationId: string;
  idempotencyKey: string;
  serviceKey: CertificationServiceKey;
  originalSha256: string;
  manifestSha256: string;
};

export type ProviderResult = {
  providerOperationId: string;
  status: 'succeeded';
  issuer: string;
  issuedAt: string;
  evidenceType: 'rfc3161' | 'nom151' | 'technical_package';
  evidenceSha256: string;
  evidence: Record<string, unknown>;
  sandbox: boolean;
};

export interface CertificationProvider {
  readonly key: string;
  readonly mode: 'sandbox' | 'production';
  healthCheck(): Promise<{ healthy: boolean; detail: string }>;
  issue(request: ProviderRequest): Promise<ProviderResult>;
}

export class SandboxCertificationProvider implements CertificationProvider {
  readonly key = 'docubox-sandbox';
  readonly mode = 'sandbox' as const;

  async healthCheck() {
    return { healthy: true, detail: 'Sandbox disponible. No produce efectos legales PSC.' };
  }

  async issue(request: ProviderRequest): Promise<ProviderResult> {
    const issuedAt = new Date().toISOString();
    const evidence = {
      schema: 'DOCUBOX_CERTIFICA_SANDBOX',
      operation_id: `sandbox-${randomUUID()}`,
      certification_id: request.certificationId,
      original_sha256: request.originalSha256,
      manifest_sha256: request.manifestSha256,
      service: request.serviceKey,
      issued_at: issuedAt,
      watermark: 'NO VALIDO / DEMOSTRACION',
      legal_validity: false,
    };
    const evidenceSha256 = createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
    return {
      providerOperationId: evidence.operation_id,
      status: 'succeeded',
      issuer: 'Docubox Sandbox',
      issuedAt,
      evidenceType: request.serviceKey === 'nom151' ? 'nom151' : request.serviceKey === 'evidence_pro' ? 'technical_package' : 'rfc3161',
      evidenceSha256,
      evidence,
      sandbox: true,
    };
  }
}

export class HttpPscCertificationProvider implements CertificationProvider {
  readonly key = 'configured-psc';
  readonly mode = 'production' as const;
  private readonly baseUrl: string;
  private readonly token: string;

  constructor() {
    this.baseUrl = process.env.CERTIFICA_PSC_BASE_URL || '';
    this.token = process.env.CERTIFICA_PSC_API_TOKEN || '';
    if (!this.baseUrl || !this.token) throw new Error('psc_not_configured');
  }

  async healthCheck() {
    const response = await fetch(`${this.baseUrl}/health`, {
      headers: { Authorization: `Bearer ${this.token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    return { healthy: response.ok, detail: response.ok ? 'PSC operativo.' : `PSC no disponible (${response.status}).` };
  }

  async issue(request: ProviderRequest): Promise<ProviderResult> {
    const response = await fetch(`${this.baseUrl}/certifications`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': request.idempotencyKey,
      },
      body: JSON.stringify(request),
      cache: 'no-store',
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new Error(`psc_request_failed:${response.status}`);
    const payload = (await response.json()) as Partial<ProviderResult>;
    if (!payload.providerOperationId || !payload.evidenceSha256 || !payload.issuedAt || payload.sandbox) {
      throw new Error('psc_invalid_response');
    }
    return { ...payload, status: 'succeeded', sandbox: false } as ProviderResult;
  }
}

export function getCertificationProvider(mode?: string): CertificationProvider {
  const requested = mode || process.env.CERTIFICA_PSC_MODE || 'sandbox';
  return requested === 'production'
    ? new HttpPscCertificationProvider()
    : new SandboxCertificationProvider();
}

