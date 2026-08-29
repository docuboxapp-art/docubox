import type { PdfSignatureProvider, PdfVerificationResult, VerifyPdfInput } from './pades';
import type { ProviderHealth } from './key-management';

export type IndependentPdfVerificationResult = PdfVerificationResult & {
  verifier: 'docubox-independent-pades-verifier/v1';
  verifiedAt: string;
};

export interface IndependentVerificationProvider {
  verifyPdf(input: VerifyPdfInput): Promise<IndependentPdfVerificationResult>;
  healthCheck(): Promise<ProviderHealth>;
}

/**
 * The verifier receives a fresh verification-only PAdES provider. It never
 * requests a signature, so a signing success alone can never turn into a valid
 * certification record.
 */
export class IndependentPadesVerificationProvider implements IndependentVerificationProvider {
  readonly providerId = 'docubox-independent-pades-verifier/v1' as const;

  constructor(private readonly verifier: Pick<PdfSignatureProvider, 'verifyPdf' | 'healthCheck'>) {}

  async verifyPdf(input: VerifyPdfInput): Promise<IndependentPdfVerificationResult> {
    const result = await this.verifier.verifyPdf(input);
    return { ...result, verifier: this.providerId, verifiedAt: new Date().toISOString() };
  }

  healthCheck() {
    return this.verifier.healthCheck();
  }
}
