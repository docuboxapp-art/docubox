import { XMLParser } from 'fast-xml-parser';
import type { EvidenceV2Package, VerificationStatus } from './types';

type XmlRecord = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
  processEntities: false,
  isArray: (_name, path) =>
    [
      'DocuboxEvidencePackage.Documento.MetadatosDocumento.Metadato',
      'DocuboxEvidencePackage.Firmantes.Firmante',
      'DocuboxEvidencePackage.Firmas.Firma',
      'DocuboxEvidencePackage.BitacoraProbatoria.Evento',
      'DocuboxEvidencePackage.EstampasTiempo.Estampa',
      'DocuboxEvidencePackage.Documento.Relaciones.Relacion',
    ].includes(String(path)),
});

function record(value: unknown): XmlRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as XmlRecord) : {};
}

function list(value: unknown) {
  return Array.isArray(value) ? value.map(record) : value ? [record(value)] : [];
}

function value(source: unknown, key: string) {
  const candidate = record(source)[key];
  if (candidate === null || candidate === undefined || candidate === '') return null;
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    const text = record(candidate)['#text'];
    return text === null || text === undefined || text === '' ? null : String(text);
  }
  return String(candidate);
}

function attr(source: unknown, key: string) {
  return value(source, `@_${key}`);
}

function numberValue(source: unknown, key: string) {
  const candidate = value(source, key);
  if (candidate === null) return null;
  const parsed = Number(candidate);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanValue(source: unknown, key: string) {
  const candidate = value(source, key);
  return candidate === null ? null : candidate === 'true';
}

function metadataValue(item: XmlRecord) {
  const raw = value(item, 'Valor');
  const type = attr(item, 'tipo');
  if (raw === null) return null;
  if (type === 'boolean') return raw === 'true';
  if (type === 'number' || type === 'currency') {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : raw;
  }
  return raw;
}

function status(source: unknown, key: string): VerificationStatus {
  return (attr(record(source)[key], 'status') || 'unavailable') as VerificationStatus;
}

export function parseEvidenceV2Xml(xml: string): EvidenceV2Package {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new TypeError('DTD and entity declarations are not permitted');
  const root = record(record(parser.parse(xml)).DocuboxEvidencePackage);
  const isV21 = attr(root, 'schemaVersion') === '2.1';
  const packageNode = record(root.Paquete);
  const documentNode = record(root.Documento);
  const identification = record(documentNode.Identificacion);
  const origin = record(documentNode.Origen);
  const versioning = record(documentNode.Versionado);
  const integrity = record(documentNode.Integridad);
  const extract = record(documentNode.ExtractoDocumento);
  const workflow = record(documentNode.Workflow);
  const relations = list(record(documentNode.Relaciones).Relacion);
  const dates = record(documentNode.Fechas);
  const metadata = list(record(documentNode.MetadatosDocumento).Metadato);
  const participants = list(record(root.Firmantes).Firmante);
  const signatures = list(record(root.Firmas).Firma);
  const events = list(record(root.BitacoraProbatoria).Evento);
  const chain = record(root.CadenaEvidencia);
  const timestamps = list(record(root.EstampasTiempo).Estampa);
  const nom151 = record(root.ConservacionNOM151);
  const packageIntegrity = record(root.Integridad);
  const evidenceRoot = record(packageIntegrity.EvidenceRoot);
  const docuboxSignature = record(root.FirmaDocubox);
  const verification = record(root.Verificacion);

  return {
    evidenceId: value(packageNode, 'EvidenceID') || '',
    packageId: value(packageNode, 'PackageID') || '',
    version: (attr(root, 'version') || '2.0') as EvidenceV2Package['version'],
    schemaVersion: (attr(root, 'schemaVersion') || '2.0') as EvidenceV2Package['schemaVersion'],
    generatedAt: value(packageNode, 'GeneratedAt') || '',
    closedAt: value(packageNode, 'ClosedAt') || '',
    environment: value(packageNode, 'Environment') || '',
    platform: value(packageNode, 'Platform') || '',
    platformVersion: value(packageNode, 'PlatformVersion') || '',
    jurisdiction: value(packageNode, 'Jurisdiction') || '',
    workspaceId: value(packageNode, 'WorkspaceID'),
    organizationId: value(packageNode, 'OrganizationID'),
    status: (attr(packageNode, 'estado') || 'closed') as EvidenceV2Package['status'],
    document: {
      documentId: value(identification, 'DocumentID') || '',
      externalId: value(identification, 'ExternalID'),
      name: value(identification, 'Nombre'),
      fileName: value(identification, 'NombreArchivo'),
      mimeType: value(identification, 'MimeType'),
      sizeBytes: numberValue(identification, 'TamanoBytes'),
      pageCount: numberValue(identification, 'NumeroPaginas'),
      originType: value(origin, 'TipoOrigen') as EvidenceV2Package['document']['originType'],
      createdByRef: value(origin, 'CreatedByRef'),
      createdAt: value(origin, 'CreatedAt'),
      versionId: value(versioning, 'VersionID'),
      version: numberValue(versioning, 'Version'),
      previousVersionId: value(versioning, 'PreviousVersionID'),
      previousVersionHash: value(versioning, 'PreviousVersionHash'),
      originalHash: value(integrity, 'HashOriginal'),
      preparedHash: value(integrity, 'HashPreparado'),
      finalHash: value(integrity, 'HashFinal') || '',
      preparedAt: value(dates, 'PreparedAt'),
      flowStartedAt: value(dates, 'SignatureFlowStartedAt'),
      metadata: metadata.map((item) => ({
        id: attr(item, 'id') || '',
        key: value(item, 'Clave') || '',
        name: value(item, 'Nombre') || '',
        type: attr(item, 'tipo') || 'text',
        value: metadataValue(item),
        source: (attr(item, 'origen') || 'user') as 'user' | 'system',
        createdByRef: value(item, 'CreadoPorRef'),
        recordedAt: value(item, 'FechaRegistro'),
        snapshotHash: value(item, 'HashSnapshot'),
      })),
      metadataSnapshotHash: value(record(documentNode.MetadatosDocumento), 'MetadataSnapshotHash'),
      extract:
        Object.keys(extract).length && attr(extract, 'status') === 'available'
          ? {
              source: value(extract, 'Source') as NonNullable<
                EvidenceV2Package['document']['extract']
              >['source'],
              sourceRef: value(extract, 'SourceRef'),
              content: value(extract, 'Content') || '',
              reviewedAt: value(extract, 'ReviewedAt'),
            }
          : null,
      workflow: Object.keys(workflow).length
        ? { status: attr(workflow, 'status') || '', completedAt: value(workflow, 'CompletedAt') }
        : undefined,
      relations: isV21
        ? relations.map((item) => ({
            type: attr(item, 'tipo') || '',
            ref: attr(item, 'ref') || '',
          }))
        : undefined,
    },
    participants: participants.map((item) => {
      const identity = record(item.IdentidadVerificada);
      return {
        participantRef: attr(item, 'ref') || '',
        firmanteId: value(item, 'FirmanteID'),
        name: value(item, 'Nombre'),
        email: value(item, 'Correo'),
        role: value(item, 'Rol') || '',
        participantType: (attr(item, 'tipo') ||
          'other') as EvidenceV2Package['participants'][number]['participantType'],
        order: numberValue(item, 'Orden'),
        required: booleanValue(item, 'Obligatorio'),
        expectedMethod: value(item, 'MetodoEsperado'),
        participationStatus: value(item, 'EstadoParticipacion'),
        invitationAt: value(item, 'FechaInvitacion'),
        firstAccessAt: value(item, 'FechaPrimerAcceso'),
        signedAt: value(item, 'FechaFirma'),
        identityVerification: Object.keys(identity).length
          ? {
              status: (attr(identity, 'estado') || 'unavailable') as VerificationStatus,
              method: value(identity, 'Metodo'),
              verifiedAt: value(identity, 'FechaVerificacion'),
              evidenceRef: value(identity, 'EvidenciaRef'),
            }
          : undefined,
      };
    }),
    signatures: signatures.map((item) => {
      const autograph = record(item.EvidenciaAutografa);
      const consent = record(autograph.Consentimiento);
      const certificate = record(item.Certificado);
      const cryptographicEvidence = record(item.EvidenciaCriptografica);
      const context = record(item.Contexto);
      const geolocation = record(context.Geolocalizacion);
      const signatureConsent = record(item.Consentimiento);
      return {
        signatureRef: attr(item, 'ref') || '',
        participantRef: attr(item, 'firmanteRef') || '',
        participantId: value(item, 'ParticipantRef'),
        documentVersionRef: value(item, 'DocumentVersionRef'),
        method: (attr(item, 'metodo') ||
          'firma_simple') as EvidenceV2Package['signatures'][number]['method'],
        signedObjectHash: value(item, 'HashObjetoFirmado'),
        capturedAt: value(item, 'FechaCaptura'),
        signedAt: value(item, 'SignedAt'),
        evidenceRole:
          value(item, 'EvidenceRole') === 'FINAL_SIGNATURE' ? 'FINAL_SIGNATURE' : undefined,
        context: Object.keys(context).length
          ? {
              ipStatus: (attr(context.IP, 'status') || 'unavailable') as NonNullable<
                EvidenceV2Package['signatures'][number]['context']
              >['ipStatus'],
              ipAddress: value(context, 'IP'),
              geolocationStatus: (attr(context.Geolocalizacion, 'status') ||
                'unavailable') as NonNullable<
                EvidenceV2Package['signatures'][number]['context']
              >['geolocationStatus'],
              latitude: numberValue(geolocation, 'Latitude'),
              longitude: numberValue(geolocation, 'Longitude'),
              accuracyMeters: numberValue(geolocation, 'AccuracyMeters'),
              city: value(geolocation, 'City'),
              region: value(geolocation, 'Region'),
              country: value(geolocation, 'Country'),
              countryCode: value(geolocation, 'CountryCode'),
              userAgentStatus: (attr(context.UserAgent, 'status') || 'unavailable') as NonNullable<
                EvidenceV2Package['signatures'][number]['context']
              >['userAgentStatus'],
              userAgent: value(context, 'UserAgent'),
              deviceInfo: value(context, 'DeviceInfo'),
            }
          : undefined,
        consent: Object.keys(signatureConsent).length
          ? {
              textVersion: value(signatureConsent, 'ConsentTextVersion') || '',
              textHash: value(signatureConsent, 'ConsentTextSHA256') || '',
              accepted: booleanValue(signatureConsent, 'Accepted') === true,
              acceptedAt: value(signatureConsent, 'AcceptedAt') || '',
            }
          : undefined,
        autograph: Object.keys(autograph).length
          ? {
              captureId: value(autograph, 'CaptureID'),
              strokesHash: value(autograph, 'HashTrazo'),
              imageHash: value(autograph, 'HashImagenFirma'),
              evidenceObjectId: value(autograph, 'EvidenceObjectID'),
              combinedHash: value(autograph, 'HashCombinado'),
              imageArtifactRef: value(autograph, 'ImageArtifactRef'),
              strokesArtifactRef: value(autograph, 'StrokesArtifactRef'),
              consent: Object.keys(consent).length
                ? {
                    textVersion: value(consent, 'ConsentTextVersion'),
                    textHash: value(consent, 'ConsentTextHash'),
                    accepted: booleanValue(consent, 'Accepted') ?? undefined,
                    acceptedAt: value(consent, 'AcceptedAt'),
                  }
                : undefined,
            }
          : undefined,
        certificate: Object.keys(certificate).length
          ? {
              signatureValue: value(cryptographicEvidence, 'SignatureValue'),
              signedPayloadBase64: value(cryptographicEvidence, 'SignedPayloadBase64'),
              serialNumber: value(certificate, 'NumeroSerie'),
              rfc: value(certificate, 'RFC'),
              curp: value(certificate, 'CURP'),
              subject: value(certificate, 'Titular'),
              issuer: value(certificate, 'Issuer'),
              validFrom: value(certificate, 'ValidFrom'),
              validTo: value(certificate, 'ValidTo'),
              fingerprintSha256: value(certificate, 'FingerprintSHA256'),
              validationStatus: (attr(certificate, 'estadoValidacion') ||
                'unavailable') as VerificationStatus,
            }
          : undefined,
        cryptographicEvidence: Object.keys(cryptographicEvidence).length
          ? {
              signedPayloadHash: value(cryptographicEvidence, 'SignedPayloadHash'),
              signatureHash: value(cryptographicEvidence, 'SignatureHash'),
              signatureAlgorithm: value(cryptographicEvidence, 'SignatureAlgorithm'),
              artifactRef: value(cryptographicEvidence, 'ArtifactRef'),
              artifactHash: value(cryptographicEvidence, 'ArtifactHash'),
              validationStatus: (attr(cryptographicEvidence, 'estadoValidacion') ||
                'unavailable') as VerificationStatus,
              validationProvider: value(cryptographicEvidence, 'ValidationProvider'),
              validatedAt: value(cryptographicEvidence, 'ValidatedAt'),
            }
          : undefined,
      };
    }),
    events: events.map((item) => ({
      eventId: attr(item, 'ref') || '',
      sequence: Number(attr(item, 'sequence') || 0),
      type: attr(item, 'tipo') || '',
      result: attr(item, 'resultado') || '',
      occurredAt: attr(item, 'timestamp') || '',
      actorRef: value(item, 'ActorRef'),
      objectRef: value(item, 'ObjectRef'),
      eventCategory: value(item, 'EventCategory'),
      actorType: value(item, 'ActorType'),
      documentHash: value(item, 'DocumentHash'),
      payloadHash: value(item, 'PayloadHash'),
      chainMaterial: value(item, 'ChainMaterial'),
      previousSourceHash: value(item, 'PreviousHash'),
      sourceEventHash: value(item, 'SourceEventHash'),
      canonicalHash: value(item, 'HashEvento') || '',
      previousHash: value(item, 'PreviousHash') || '',
      chainedHash: value(item, 'ChainedHash') || '',
    })),
    chain: {
      algorithmVersion: 'docubox-evidence-chain-v1',
      genesisHash: value(chain, 'GenesisHash') || '',
      rootHash: value(chain, 'RootHash') || '',
      totalEvents: Number(value(chain, 'TotalEvents') || 0),
      watermarkSequence: numberValue(chain, 'WatermarkSequence') || undefined,
    },
    evidenceRoot: Object.keys(evidenceRoot).length
      ? {
          algorithm: 'SHA-256',
          canonicalization: 'RFC8785',
          documentFinalHash: value(evidenceRoot, 'DocumentFinalHash') || '',
          metadataSnapshotHash: value(evidenceRoot, 'MetadataSnapshotHash') || '',
          evidenceEventRootHash: value(evidenceRoot, 'EvidenceEventRootHash') || '',
          signaturesDigest: value(evidenceRoot, 'SignaturesDigest') || '',
          packageCoreDigest: value(evidenceRoot, 'PackageCoreDigest') || '',
          value: value(evidenceRoot, 'Value') || '',
        }
      : undefined,
    packageDigest: value(packageIntegrity, 'EvidencePackageDigest') || '',
    timestamps: timestamps.map((item) => ({
      type: attr(item, 'type') as 'rfc3161' | 'opentimestamps',
      status: attr(item, 'status') as EvidenceV2Package['timestamps'][number]['status'],
      objectType: attr(item, 'objectType') as EvidenceV2Package['timestamps'][number]['objectType'],
      objectHash: value(item, 'ObjectHash') || '',
      provider: value(item, 'Provider'),
      issuedAt: value(item, 'IssuedAt'),
      serialNumber: value(item, 'SerialNumber'),
      policyOid: value(item, 'PolicyOID'),
      messageImprint: value(item, 'MessageImprint'),
      artifactRef: value(item, 'ArtifactRef'),
      validationStatus: (attr(item, 'validationStatus') || 'unavailable') as VerificationStatus,
      artifactHash: value(item, 'ArtifactHash'),
      manifestHash: value(item, 'ManifestHash'),
      validatedAt: value(item, 'ValidatedAt'),
    })),
    nom151: {
      status: (attr(nom151, 'status') || 'not_requested') as EvidenceV2Package['nom151']['status'],
      requestId: value(nom151, 'RequestID'),
      requestedAt: value(nom151, 'RequestedAt'),
      hashSubmitted: value(nom151, 'HashSubmitted'),
      providerName: value(nom151, 'ProviderName'),
      providerIdentifier: value(nom151, 'ProviderIdentifier'),
      constanciaId: value(nom151, 'ConstanciaID'),
      issuedAt: value(nom151, 'IssuedAt'),
      constanciaHash: value(nom151, 'ConstanciaHash'),
      serialNumber: value(nom151, 'SerialNumber'),
      policy: value(nom151, 'Policy'),
      artifactRef: value(nom151, 'ArtifactRef'),
    },
    docuboxSignature:
      attr(docuboxSignature, 'estado') === 'applied'
        ? {
            algorithm: value(docuboxSignature, 'Algorithm') || '',
            keyId: value(docuboxSignature, 'KeyID') || '',
            keyVersion: value(docuboxSignature, 'KeyVersion') || '',
            publicKeyPem: Buffer.from(
              value(docuboxSignature, 'PublicKeyPemBase64') || '',
              'base64'
            ).toString('utf8'),
            publicKeyFingerprintSha256: value(docuboxSignature, 'PublicKeyFingerprint') || '',
            signatureBase64: value(docuboxSignature, 'SignatureValue') || '',
            signatureSha256: value(docuboxSignature, 'SignatureHash') || '',
            signedAt: value(docuboxSignature, 'SignedAt') || '',
          }
        : null,
    verification: {
      documentIntegrity: status(verification, 'DocumentIntegrity'),
      participantSignatures: status(verification, 'ParticipantSignatures'),
      certificates: status(verification, 'Certificates'),
      evidenceChain: status(verification, 'EvidenceChain'),
      docuboxSignature: status(verification, 'DocuboxSignature'),
      timestamp: status(verification, 'Timestamp'),
      openTimestamps: status(verification, 'OpenTimestamps'),
      nom151: status(verification, 'NOM151'),
      overall: (attr(verification, 'overallStatus') ||
        'incomplete') as EvidenceV2Package['verification']['overall'],
    },
  };
}
