export type EvidenceV2Status =
  'open' | 'closing' | 'closed' | 'partially_certified' | 'certified' | 'verification_failed';

export type VerificationStatus = 'valid' | 'invalid' | 'pending' | 'unavailable' | 'not_applicable';

export type EvidenceEventSource = {
  eventId: string;
  sequence: number;
  type: string;
  result: string;
  occurredAt: string;
  actorRef?: string | null;
  objectRef?: string | null;
  sourceEventHash?: string | null;
};

export type EvidenceChainEvent = EvidenceEventSource & {
  canonicalHash: string;
  previousHash: string;
  chainedHash: string;
};

export type EvidenceParticipant = {
  participantRef: string;
  role: string;
  participantType: 'signer' | 'approver' | 'reviewer' | 'witness' | 'recipient' | 'other';
  order?: number | null;
  required?: boolean | null;
  invitationAt?: string | null;
  firstAccessAt?: string | null;
  signedAt?: string | null;
  identityVerification?: {
    status: VerificationStatus;
    method?: string | null;
    verifiedAt?: string | null;
    evidenceRef?: string | null;
  };
};

export type EvidenceSignature = {
  signatureRef: string;
  participantRef: string;
  method:
    | 'efirma_sat'
    | 'autografa_digital'
    | 'firma_simple'
    | 'firma_biometrica'
    | 'certificado_digital';
  signedObjectHash: string | null;
  capturedAt: string | null;
  autograph?: {
    strokesHash?: string | null;
    imageHash?: string | null;
    evidenceObjectId?: string | null;
    consent?: {
      textVersion?: string | null;
      textHash?: string | null;
      accepted?: boolean;
      acceptedAt?: string | null;
    };
  };
  certificate?: {
    serialNumber?: string | null;
    rfc?: string | null;
    curp?: string | null;
    subject?: string | null;
    issuer?: string | null;
    validFrom?: string | null;
    validTo?: string | null;
    fingerprintSha256?: string | null;
    validationStatus: VerificationStatus;
  };
  cryptographicEvidence?: {
    signedPayloadHash?: string | null;
    signatureHash?: string | null;
    signatureAlgorithm?: string | null;
    artifactRef?: string | null;
    artifactHash?: string | null;
    validationStatus: VerificationStatus;
    validationProvider?: string | null;
    validatedAt?: string | null;
  };
};

export type EvidenceTimestamp = {
  type: 'rfc3161' | 'opentimestamps';
  status:
    | 'requested'
    | 'pending'
    | 'issued'
    | 'verified'
    | 'failed'
    | 'pending_bitcoin'
    | 'verified_bitcoin';
  objectType: 'evidence_root' | 'final_pdf' | 'evidence_package';
  objectHash: string;
  provider?: string | null;
  issuedAt?: string | null;
  serialNumber?: string | null;
  policyOid?: string | null;
  messageImprint?: string | null;
  artifactRef?: string | null;
  artifactHash?: string | null;
  manifestHash?: string | null;
  validationStatus: VerificationStatus;
  validatedAt?: string | null;
};

export type EvidenceNom151 = {
  status: 'not_requested' | 'pending' | 'issued' | 'verified' | 'failed' | 'revoked';
  requestId?: string | null;
  requestedAt?: string | null;
  hashSubmitted?: string | null;
  providerName?: string | null;
  providerIdentifier?: string | null;
  constanciaId?: string | null;
  issuedAt?: string | null;
  constanciaHash?: string | null;
  serialNumber?: string | null;
  policy?: string | null;
  artifactRef?: string | null;
};

export type DocuboxEvidenceSignature = {
  algorithm: string;
  keyId: string;
  keyVersion: string;
  publicKeyPem: string;
  publicKeyFingerprintSha256: string;
  signatureBase64: string;
  signatureSha256: string;
  signedAt: string;
};

export type EvidenceV2Package = {
  evidenceId: string;
  packageId: string;
  version: '2.0';
  schemaVersion: '2.0';
  generatedAt: string;
  closedAt: string;
  environment: string;
  platform: string;
  platformVersion: string;
  jurisdiction: string;
  workspaceId: string | null;
  organizationId: string | null;
  status: EvidenceV2Status;
  document: {
    documentId: string;
    externalId?: string | null;
    name?: string | null;
    fileName?: string | null;
    mimeType?: string | null;
    sizeBytes?: number | null;
    pageCount?: number | null;
    originType?: 'upload' | 'template' | 'form' | 'editor' | 'api' | 'integration' | null;
    createdByRef?: string | null;
    createdAt?: string | null;
    versionId?: string | null;
    version?: number | null;
    previousVersionId?: string | null;
    previousVersionHash?: string | null;
    originalHash?: string | null;
    preparedHash?: string | null;
    finalHash: string;
    preparedAt?: string | null;
    flowStartedAt?: string | null;
    metadata: Array<{
      id: string;
      key: string;
      name: string;
      type: string;
      value: string | number | boolean | null;
      source: 'user' | 'system';
      createdByRef?: string | null;
      recordedAt?: string | null;
      snapshotHash?: string | null;
    }>;
  };
  participants: EvidenceParticipant[];
  signatures: EvidenceSignature[];
  events: EvidenceChainEvent[];
  chain: {
    algorithmVersion: 'docubox-evidence-chain-v1';
    genesisHash: string;
    rootHash: string;
    totalEvents: number;
  };
  packageDigest: string;
  timestamps: EvidenceTimestamp[];
  nom151: EvidenceNom151;
  docuboxSignature: DocuboxEvidenceSignature | null;
  verification: {
    documentIntegrity: VerificationStatus;
    participantSignatures: VerificationStatus;
    certificates: VerificationStatus;
    evidenceChain: VerificationStatus;
    docuboxSignature: VerificationStatus;
    timestamp: VerificationStatus;
    openTimestamps: VerificationStatus;
    nom151: VerificationStatus;
    overall: 'valid' | 'valid_with_pending_certifications' | 'invalid' | 'incomplete';
  };
};

export type EvidenceV2BuildInput = Omit<
  EvidenceV2Package,
  'events' | 'chain' | 'packageDigest' | 'docuboxSignature' | 'verification'
> & {
  events: EvidenceEventSource[];
};
