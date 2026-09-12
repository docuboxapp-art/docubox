import { canonicalizeRFC8785, sha256Hex } from '@/lib/certification/canonical';
import type { EvidenceChainEvent, EvidenceEventSource, EvidenceV2Package } from './types';

export const EVIDENCE_V2_CHAIN_ALGORITHM = 'docubox-evidence-chain-v1' as const;
export const EVIDENCE_V2_ROOT_SCHEMA = 'docubox-evidence-root-v1' as const;
export const EVIDENCE_V21_ROOT_SCHEMA = 'docubox-evidence-root-v2.1' as const;

const SHA256 = /^[a-f0-9]{64}$/i;

function omitNullish(candidate: unknown): unknown {
  if (Array.isArray(candidate)) return candidate.map(omitNullish);
  if (candidate && typeof candidate === 'object') {
    return Object.fromEntries(
      Object.entries(candidate as Record<string, unknown>)
        .filter(([, item]) => item !== null && item !== undefined)
        .map(([key, item]) => [key, omitNullish(item)])
    );
  }
  return candidate;
}

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
  const usesSourceChain =
    ordered.length > 0 &&
    ordered.every((event) => event.chainMaterial && event.sourceEventHash && event.payloadHash);
  if (usesSourceChain) {
    let previousSourceHash = '0'.repeat(64);
    const events: EvidenceChainEvent[] = ordered.map((event, index) => {
      if (!Number.isInteger(event.sequence) || event.sequence !== index + 1) {
        throw new TypeError('Evidence events must use a contiguous sequence beginning at one');
      }
      const sourceEventHash = normalizeSha256(event.sourceEventHash!, 'sourceEventHash');
      const declaredPrevious = event.previousSourceHash
        ? normalizeSha256(event.previousSourceHash, 'previousSourceHash')
        : '0'.repeat(64);
      if (declaredPrevious !== previousSourceHash) {
        throw new TypeError('The legal evidence source chain is not contiguous');
      }
      if (sha256Hex(String(event.chainMaterial)) !== sourceEventHash) {
        throw new TypeError('The legal evidence source event hash is invalid');
      }
      const row: EvidenceChainEvent = {
        ...event,
        occurredAt: canonicalUtc(event.occurredAt, 'event.occurredAt'),
        sourceEventHash,
        canonicalHash: normalizeSha256(event.payloadHash!, 'payloadHash'),
        previousHash: declaredPrevious,
        chainedHash: sourceEventHash,
      };
      previousSourceHash = sourceEventHash;
      return row;
    });
    return {
      events,
      chain: {
        algorithmVersion: EVIDENCE_V2_CHAIN_ALGORITHM,
        genesisHash: '0'.repeat(64),
        rootHash: previousSourceHash,
        totalEvents: events.length,
        watermarkSequence: events.length,
      },
    };
  }
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

function evidenceCore(
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
  >,
  omitNulls: boolean
) {
  const core = {
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
  };
  if (!omitNulls) return core;
  return omitNullish(core);
}

export function evidenceV2PackageDigest(value: Parameters<typeof evidenceCore>[0]) {
  return sha256Hex(canonicalizeRFC8785(evidenceCore(value, true)));
}

export function metadataSnapshotDigest(metadata: EvidenceV2Package['document']['metadata']) {
  return sha256Hex(
    canonicalizeRFC8785(
      omitNullish({
        schema: 'docubox-document-metadata-snapshot-v1',
        metadata: [...metadata].sort((left, right) => left.id.localeCompare(right.id)),
      })
    )
  );
}

export function evidenceSignaturesDigest(signatures: EvidenceV2Package['signatures']) {
  return sha256Hex(
    canonicalizeRFC8785(
      omitNullish({
        schema: 'docubox-evidence-signatures-v1',
        signatures: [...signatures].sort((left, right) =>
          left.signatureRef.localeCompare(right.signatureRef)
        ),
      })
    )
  );
}

export function evidencePackageCoreDigest(
  value: Pick<
    EvidenceV2Package,
    | 'evidenceId'
    | 'packageId'
    | 'schemaVersion'
    | 'closedAt'
    | 'document'
    | 'participants'
    | 'timestamps'
    | 'nom151'
  >
) {
  return sha256Hex(
    canonicalizeRFC8785(
      omitNullish({
        schema: 'docubox-evidence-package-core-v2.1',
        evidence_id: value.evidenceId,
        package_id: value.packageId,
        schema_version: value.schemaVersion,
        closed_at: canonicalUtc(value.closedAt, 'closedAt'),
        document: value.document,
        participants: value.participants,
        timestamps: value.timestamps,
        nom151: value.nom151,
      })
    )
  );
}

export function buildEvidenceRoot(
  value: Pick<
    EvidenceV2Package,
    | 'evidenceId'
    | 'packageId'
    | 'schemaVersion'
    | 'closedAt'
    | 'document'
    | 'participants'
    | 'signatures'
    | 'chain'
    | 'timestamps'
    | 'nom151'
  >
): NonNullable<EvidenceV2Package['evidenceRoot']> {
  const documentFinalHash = normalizeSha256(value.document.finalHash, 'document.finalHash');
  const metadataSnapshotHash =
    value.document.metadataSnapshotHash || metadataSnapshotDigest(value.document.metadata);
  const evidenceEventRootHash = normalizeSha256(value.chain.rootHash, 'chain.rootHash');
  const signaturesDigest = evidenceSignaturesDigest(value.signatures);
  const packageCoreDigest = evidencePackageCoreDigest(value);
  const canonical = canonicalizeRFC8785({
    schema: EVIDENCE_V21_ROOT_SCHEMA,
    document_final_hash: documentFinalHash,
    metadata_snapshot_hash: normalizeSha256(metadataSnapshotHash, 'metadataSnapshotHash'),
    evidence_event_root_hash: evidenceEventRootHash,
    signatures_digest: signaturesDigest,
    package_core_digest: packageCoreDigest,
  });
  return {
    algorithm: 'SHA-256',
    canonicalization: 'RFC8785',
    documentFinalHash,
    metadataSnapshotHash: normalizeSha256(metadataSnapshotHash, 'metadataSnapshotHash'),
    evidenceEventRootHash,
    signaturesDigest,
    packageCoreDigest,
    value: sha256Hex(canonical),
  };
}

/** Accepts packages emitted before null/omitted fields were normalized. */
export function evidenceV2LegacyPackageDigest(value: Parameters<typeof evidenceCore>[0]) {
  return sha256Hex(canonicalizeRFC8785(evidenceCore(value, false)));
}

export function evidenceV2SigningPayload(
  value: Pick<EvidenceV2Package, 'document' | 'chain' | 'packageDigest' | 'evidenceRoot'>
) {
  const canonical = canonicalizeRFC8785({
    schema: 'docubox-evidence-signature-v1',
    document_final_hash: normalizeSha256(value.document.finalHash, 'document.finalHash'),
    evidence_root_hash: normalizeSha256(
      value.evidenceRoot?.value || value.chain.rootHash,
      'evidenceRoot'
    ),
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
    if (event.chainMaterial && event.sourceEventHash) {
      if (sha256Hex(event.chainMaterial) !== event.chainedHash) return false;
      if (event.sourceEventHash !== event.chainedHash) return false;
    } else if (event.chainedHash !== chainDigest(previous, event.canonicalHash)) return false;
    previous = event.chainedHash;
  }
  return previous === normalizeSha256(chain.rootHash, 'rootHash');
}
