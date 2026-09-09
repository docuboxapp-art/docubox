import { canonicalizeRFC8785, sha256Hex } from '@/lib/certification/canonical';
import type { EvidenceChainEvent, EvidenceEventSource, EvidenceV2Package } from './types';

export const EVIDENCE_V2_CHAIN_ALGORITHM = 'docubox-evidence-chain-v1' as const;
export const EVIDENCE_V2_ROOT_SCHEMA = 'docubox-evidence-root-v1' as const;

const SHA256 = /^[a-f0-9]{64}$/i;

export function normalizeSha256(value: string, field: string) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!SHA256.test(normalized)) throw new TypeError(`${field} must be a SHA-256 digest`);
  return normalized;
}

export function canonicalUtc(value: string, field: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${field} must be an ISO-8601 instant`);
  return date.toISOString();
}

function chainDigest(previousHash: string, eventHash: string) {
  return sha256Hex(
    Buffer.concat([
      Buffer.from(`${EVIDENCE_V2_CHAIN_ALGORITHM}\0`, 'utf8'),
      Buffer.from(normalizeSha256(previousHash, 'previousHash'), 'hex'),
      Buffer.from(normalizeSha256(eventHash, 'eventHash'), 'hex'),
    ])
  );
}

export function buildEvidenceV2Chain(input: {
  documentId: string;
  documentVersionId?: string | null;
  events: EvidenceEventSource[];
}) {
  const ordered = [...input.events].sort((left, right) => left.sequence - right.sequence);
  const genesisHash = sha256Hex(
    Buffer.from(
      canonicalizeRFC8785({
        schema: EVIDENCE_V2_CHAIN_ALGORITHM,
        document_id: input.documentId,
        document_version_id: input.documentVersionId || null,
      }),
      'utf8'
    )
  );
  let previousHash = genesisHash;
  const events: EvidenceChainEvent[] = ordered.map((event, index) => {
    if (!Number.isInteger(event.sequence) || event.sequence !== index + 1) {
      throw new TypeError('Evidence events must use a contiguous sequence beginning at one');
    }
    const canonical = canonicalizeRFC8785({
      schema: 'docubox-event-v1',
      event_id: String(event.eventId),
      sequence: event.sequence,
      type: String(event.type),
      result: String(event.result),
      occurred_at: canonicalUtc(event.occurredAt, 'event.occurredAt'),
      actor_ref: event.actorRef || null,
      object_ref: event.objectRef || null,
      source_event_hash: event.sourceEventHash
        ? normalizeSha256(event.sourceEventHash, 'sourceEventHash')
        : null,
    });
    const canonicalHash = sha256Hex(canonical);
    const chainedHash = chainDigest(previousHash, canonicalHash);
    const row: EvidenceChainEvent = {
      ...event,
      occurredAt: canonicalUtc(event.occurredAt, 'event.occurredAt'),
      sourceEventHash: event.sourceEventHash
        ? normalizeSha256(event.sourceEventHash, 'sourceEventHash')
        : null,
      canonicalHash,
      previousHash,
      chainedHash,
    };
    previousHash = chainedHash;
    return row;
  });
  return {
    events,
    chain: {
      algorithmVersion: EVIDENCE_V2_CHAIN_ALGORITHM,
      genesisHash,
      rootHash: previousHash,
      totalEvents: events.length,
    },
  };
}

export function evidenceV2PackageDigest(
  value: Pick<
    EvidenceV2Package,
    | 'version'
    | 'schemaVersion'
    | 'evidenceId'
    | 'packageId'
    | 'closedAt'
    | 'document'
    | 'participants'
    | 'signatures'
    | 'chain'
    | 'timestamps'
    | 'nom151'
  >
) {
  return sha256Hex(
    canonicalizeRFC8785({
      schema: EVIDENCE_V2_ROOT_SCHEMA,
      version: value.version,
      schema_version: value.schemaVersion,
      evidence_id: value.evidenceId,
      package_id: value.packageId,
      closed_at: canonicalUtc(value.closedAt, 'closedAt'),
      document: value.document,
      participants: value.participants,
      signatures: value.signatures,
      chain: value.chain,
      timestamps: value.timestamps,
      nom151: value.nom151,
    })
  );
}

export function evidenceV2SigningPayload(
  value: Pick<EvidenceV2Package, 'document' | 'chain' | 'packageDigest'>
) {
  const canonical = canonicalizeRFC8785({
    schema: 'docubox-evidence-signature-v1',
    document_final_hash: normalizeSha256(value.document.finalHash, 'document.finalHash'),
    evidence_root_hash: normalizeSha256(value.chain.rootHash, 'chain.rootHash'),
    evidence_package_digest: normalizeSha256(value.packageDigest, 'packageDigest'),
  });
  return { canonical, digestSha256: sha256Hex(canonical) };
}

export function verifyEvidenceV2Chain(
  events: EvidenceChainEvent[],
  chain: EvidenceV2Package['chain']
) {
  if (chain.totalEvents !== events.length) return false;
  let previous = normalizeSha256(chain.genesisHash, 'genesisHash');
  for (const event of events) {
    if (event.previousHash !== previous) return false;
    if (event.chainedHash !== chainDigest(previous, event.canonicalHash)) return false;
    previous = event.chainedHash;
  }
  return previous === normalizeSha256(chain.rootHash, 'rootHash');
}
