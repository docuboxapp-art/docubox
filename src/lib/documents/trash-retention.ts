import 'server-only';
import { evaluateDocumentDisposition } from './lifecycle-policy';

type TrashedDocument = {
  id: string;
  legal_hold?: boolean | null;
  legal_hold_status?: string | null;
  retention_status?: string | null;
  retention_until?: string | null;
  deleted_at?: string | null;
  trashed_at?: string | null;
  restore_until?: string | null;
  estado?: string | null;
  participantes?: unknown;
};

export type TrashRetentionStatus = {
  purgeEligible: boolean;
  blockers: string[];
  reason: 'NONE' | 'LEGAL_HOLD' | 'RECOVERY_PERIOD' | 'RETENTION_ACTIVE';
};

export function classifyTrashRetention(
  documents: TrashedDocument[]
): Map<string, TrashRetentionStatus> {
  return new Map(
    documents.map((document) => {
      const disposition = evaluateDocumentDisposition(document);
      const blockers = [
        ...(disposition.legalHoldActive ? ['LEGAL_HOLD'] : []),
        ...(disposition.retentionActive ? ['RETENTION_ACTIVE'] : []),
        ...(disposition.withinRecoveryPeriod ? ['RECOVERY_PERIOD'] : []),
      ];
      return [
        document.id,
        {
          purgeEligible: disposition.canPurgeFromTrash,
          blockers,
          reason: blockers.includes('LEGAL_HOLD')
            ? 'LEGAL_HOLD'
            : blockers.includes('RETENTION_ACTIVE')
              ? 'RETENTION_ACTIVE'
              : blockers.includes('RECOVERY_PERIOD')
                ? 'RECOVERY_PERIOD'
                : 'NONE',
        },
      ];
    })
  );
}
