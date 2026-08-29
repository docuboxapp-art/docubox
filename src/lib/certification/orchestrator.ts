import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createCertification, getCertificationSummary } from './engine';
import { createCertificationProviderSet, type CertificationProviderSet } from './providers';
import { CertificationError, type CertificationSummary } from './types';

export type CertificationExecutionInput = {
  documentId: string;
  actorId: string;
  idempotencyKey: string;
  documentVersionId?: string | null;
};

/**
 * Coordinates one certification per immutable document version. It deliberately
 * owns execution concerns while the engine retains deterministic evidence work.
 */
export class CertificationOrchestrator {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly providers: CertificationProviderSet = createCertificationProviderSet(),
  ) {}

  async execute(input: CertificationExecutionInput): Promise<CertificationSummary> {
    if (!input.idempotencyKey || input.idempotencyKey.length > 160) {
      throw new CertificationError('IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key no es valido.', 400);
    }
    return createCertification(
      this.supabase,
      input.documentId,
      input.actorId,
      input.idempotencyKey,
      input.documentVersionId,
      {
        providers: this.providers,
        leaseOwner: `orchestrator:${randomUUID()}`,
      },
    );
  }

  async retry(input: CertificationExecutionInput) {
    return this.execute(input);
  }

  async getStatus(documentId: string, actorId: string) {
    return getCertificationSummary(this.supabase, documentId, actorId);
  }
}
