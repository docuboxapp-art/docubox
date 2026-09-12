import { sha256Hex } from '@/lib/certification/canonical';
import type { EvidenceV2Package, VerificationStatus } from './types';

export const EVIDENCE_V2_NAMESPACE = 'https://docubox.com.mx/schema/evidence/v2';

function esc(value: unknown) {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function tag(name: string, value: unknown, attributes = '') {
  if (value === null || value === undefined || value === '') return '';
  return `<${name}${attributes}>${esc(value)}</${name}>`;
}

function status(name: string, value: VerificationStatus) {
  return `<${name} status="${esc(value)}"/>`;
}

function renderParticipants(value: EvidenceV2Package['participants'], isV21: boolean) {
  return value
    .map(
      (participant) => `
    <Firmante ref="${esc(participant.participantRef)}" tipo="${esc(participant.participantType)}">
      ${isV21 ? tag('FirmanteID', participant.firmanteId) : ''}
      ${isV21 ? tag('Nombre', participant.name) : ''}
      ${isV21 ? tag('Correo', participant.email) : ''}
      ${tag('Rol', participant.role)}
      ${tag('Orden', participant.order)}
      ${tag('Obligatorio', participant.required === null || participant.required === undefined ? null : String(participant.required))}
      ${isV21 ? tag('MetodoEsperado', participant.expectedMethod) : ''}
      ${isV21 ? tag('EstadoParticipacion', participant.participationStatus) : ''}
      ${tag('FechaInvitacion', participant.invitationAt)}
      ${tag('FechaPrimerAcceso', participant.firstAccessAt)}
      ${tag('FechaFirma', participant.signedAt)}
      ${
        participant.identityVerification
          ? `<IdentidadVerificada estado="${esc(participant.identityVerification.status)}">
        ${tag('Metodo', participant.identityVerification.method)}
        ${tag('FechaVerificacion', participant.identityVerification.verifiedAt)}
        ${tag('EvidenciaRef', participant.identityVerification.evidenceRef)}
      </IdentidadVerificada>`
          : ''
      }
    </Firmante>`
    )
    .join('');
}

function renderSignatures(value: EvidenceV2Package['signatures'], isV21: boolean) {
  return value
    .map(
      (signature) => `
    <Firma ref="${esc(signature.signatureRef)}" firmanteRef="${esc(signature.participantRef)}" metodo="${esc(signature.method)}">
      ${isV21 ? tag('SignatureID', signature.signatureRef) : ''}
      ${isV21 ? tag('ParticipantRef', signature.participantId || signature.participantRef) : ''}
      ${isV21 ? tag('DocumentVersionRef', signature.documentVersionRef) : ''}
      ${isV21 ? tag('SignatureType', signature.method) : ''}
      ${tag('HashObjetoFirmado', signature.signedObjectHash, ' algoritmo="SHA-256"')}
      ${tag('FechaCaptura', signature.capturedAt)}
      ${isV21 ? tag('SignedAt', signature.signedAt) : ''}
      ${isV21 && signature.evidenceRole ? tag('EvidenceRole', signature.evidenceRole) : ''}
      ${
        isV21 && signature.context
          ? `<Contexto>
        <IP status="${esc(signature.context.ipStatus)}">${esc(signature.context.ipAddress)}</IP>
        <Geolocalizacion status="${esc(signature.context.geolocationStatus)}">
          ${tag('Latitude', signature.context.latitude)}${tag('Longitude', signature.context.longitude)}${tag('AccuracyMeters', signature.context.accuracyMeters)}
          ${tag('City', signature.context.city)}${tag('Region', signature.context.region)}${tag('Country', signature.context.country)}${tag('CountryCode', signature.context.countryCode)}
        </Geolocalizacion>
        <UserAgent status="${esc(signature.context.userAgentStatus)}">${esc(signature.context.userAgent)}</UserAgent>
        ${tag('DeviceInfo', signature.context.deviceInfo)}
      </Contexto>`
          : ''
      }
      ${
        isV21 && signature.consent
          ? `<Consentimiento>
        ${tag('ConsentTextVersion', signature.consent.textVersion)}
        ${tag('ConsentTextSHA256', signature.consent.textHash, ' algoritmo="SHA-256"')}
        ${tag('Accepted', String(signature.consent.accepted))}
        ${tag('AcceptedAt', signature.consent.acceptedAt)}
      </Consentimiento>`
          : ''
      }
      ${
        signature.autograph
          ? `<EvidenciaAutografa>
        ${isV21 ? tag('CaptureID', signature.autograph.captureId) : ''}
        ${tag('HashTrazo', signature.autograph.strokesHash, ' algoritmo="SHA-256"')}
        ${tag('HashImagenFirma', signature.autograph.imageHash, ' algoritmo="SHA-256"')}
        ${isV21 ? tag('HashCombinado', signature.autograph.combinedHash, ' algoritmo="SHA-256"') : ''}
        ${isV21 ? tag('ImageArtifactRef', signature.autograph.imageArtifactRef) : ''}
        ${isV21 ? tag('StrokesArtifactRef', signature.autograph.strokesArtifactRef) : ''}
        ${tag('EvidenceObjectID', signature.autograph.evidenceObjectId)}
        ${
          signature.autograph.consent
            ? `<Consentimiento>
          ${tag('ConsentTextVersion', signature.autograph.consent.textVersion)}
          ${tag('ConsentTextHash', signature.autograph.consent.textHash, ' algoritmo="SHA-256"')}
          ${tag('Accepted', signature.autograph.consent.accepted === undefined ? null : String(signature.autograph.consent.accepted))}
          ${tag('AcceptedAt', signature.autograph.consent.acceptedAt)}
        </Consentimiento>`
            : ''
        }
      </EvidenciaAutografa>`
          : ''
      }
      ${
        signature.certificate
          ? `<Certificado estadoValidacion="${esc(signature.certificate.validationStatus)}">
        ${tag('NumeroSerie', signature.certificate.serialNumber)}
        ${tag('RFC', signature.certificate.rfc)}
        ${tag('CURP', signature.certificate.curp)}
        ${tag('Titular', signature.certificate.subject)}
        ${tag('Issuer', signature.certificate.issuer)}
        ${tag('ValidFrom', signature.certificate.validFrom)}
        ${tag('ValidTo', signature.certificate.validTo)}
        ${tag('FingerprintSHA256', signature.certificate.fingerprintSha256, ' algoritmo="SHA-256"')}
      </Certificado>`
          : ''
      }
      ${
        signature.cryptographicEvidence
          ? `<EvidenciaCriptografica estadoValidacion="${esc(signature.cryptographicEvidence.validationStatus)}">
        ${isV21 ? tag('SignatureValue', signature.cryptographicEvidence.signatureValue) : ''}
        ${isV21 ? tag('SignedPayloadBase64', signature.cryptographicEvidence.signedPayloadBase64) : ''}
        ${tag('SignedPayloadHash', signature.cryptographicEvidence.signedPayloadHash, ' algoritmo="SHA-256"')}
        ${tag('SignatureHash', signature.cryptographicEvidence.signatureHash, ' algoritmo="SHA-256"')}
        ${tag('SignatureAlgorithm', signature.cryptographicEvidence.signatureAlgorithm)}
        ${tag('ArtifactRef', signature.cryptographicEvidence.artifactRef)}
        ${tag('ArtifactHash', signature.cryptographicEvidence.artifactHash, ' algoritmo="SHA-256"')}
        ${tag('ValidationProvider', signature.cryptographicEvidence.validationProvider)}
        ${tag('ValidatedAt', signature.cryptographicEvidence.validatedAt)}
      </EvidenciaCriptografica>`
          : ''
      }
    </Firma>`
    )
    .join('');
}

function renderEvents(value: EvidenceV2Package['events'], isV21: boolean) {
  return value
    .map(
      (event) => `
    <Evento sequence="${event.sequence}" ref="${esc(event.eventId)}" tipo="${esc(event.type)}" resultado="${esc(event.result)}" timestamp="${esc(event.occurredAt)}">
      ${tag('ActorRef', event.actorRef)}
      ${tag('ObjectRef', event.objectRef)}
      ${isV21 ? tag('EventCategory', event.eventCategory) : ''}
      ${isV21 ? tag('ActorType', event.actorType) : ''}
      ${isV21 ? tag('DocumentHash', event.documentHash, ' algoritmo="SHA-256"') : ''}
      ${isV21 ? tag('PayloadHash', event.payloadHash, ' algoritmo="SHA-256"') : ''}
      ${isV21 ? tag('ChainMaterial', event.chainMaterial) : ''}
      ${tag('SourceEventHash', event.sourceEventHash, ' algoritmo="SHA-256"')}
      ${tag('HashEvento', event.canonicalHash, ' algoritmo="SHA-256"')}
      ${tag('PreviousHash', event.previousHash, ' algoritmo="SHA-256"')}
      ${tag('ChainedHash', event.chainedHash, ' algoritmo="SHA-256"')}
    </Evento>`
    )
    .join('');
}

function renderTimestamps(value: EvidenceV2Package['timestamps']) {
  return value
    .map(
      (timestamp) => `
    <Estampa type="${esc(timestamp.type)}" status="${esc(timestamp.status)}" objectType="${esc(timestamp.objectType)}" validationStatus="${esc(timestamp.validationStatus)}">
      ${tag('ObjectHash', timestamp.objectHash, ' algoritmo="SHA-256"')}
      ${tag('Provider', timestamp.provider)}
      ${tag('IssuedAt', timestamp.issuedAt)}
      ${tag('SerialNumber', timestamp.serialNumber)}
      ${tag('PolicyOID', timestamp.policyOid)}
      ${tag('MessageImprint', timestamp.messageImprint, ' algoritmo="SHA-256"')}
      ${tag('ArtifactRef', timestamp.artifactRef)}
      ${tag('ArtifactHash', timestamp.artifactHash, ' algoritmo="SHA-256"')}
      ${tag('ManifestHash', timestamp.manifestHash, ' algoritmo="SHA-256"')}
      ${tag('ValidatedAt', timestamp.validatedAt)}
    </Estampa>`
    )
    .join('');
}

export function renderEvidenceV2Xml(value: EvidenceV2Package, xmlSha256 = '') {
  const metadata = value.document.metadata
    .map(
      (item) => `
      <Metadato id="${esc(item.id)}" tipo="${esc(item.type)}" origen="${esc(item.source)}">
        ${tag('Clave', item.key)}
        ${tag('Nombre', item.name)}
        ${tag('Valor', item.value)}
        ${tag('CreadoPorRef', item.createdByRef)}
        ${tag('FechaRegistro', item.recordedAt)}
        ${tag('HashSnapshot', item.snapshotHash, ' algoritmo="SHA-256"')}
        <Proteccion><IncluidoEnCierre>true</IncluidoEnCierre><MutableDespuesCierre>false</MutableDespuesCierre></Proteccion>
      </Metadato>`
    )
    .join('');
  const signature = value.docuboxSignature;
  const isV21 = value.schemaVersion === '2.1';
  const extract = value.document.extract;
  const relations = (value.document.relations || [])
    .map((relation) => `<Relacion tipo="${esc(relation.type)}" ref="${esc(relation.ref)}"/>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<DocuboxEvidencePackage xmlns="${EVIDENCE_V2_NAMESPACE}"${isV21 ? '' : ' xmlns:ds="http://www.w3.org/2000/09/xmldsig#"'} version="${esc(value.version)}" schemaVersion="${esc(value.schemaVersion)}">
  <Paquete estado="${esc(value.status)}">
    ${tag('EvidenceID', value.evidenceId)}
    ${tag('PackageID', value.packageId)}
    ${tag('Version', value.version)}
    ${tag('SchemaVersion', value.schemaVersion)}
    ${tag('GeneratedAt', value.generatedAt)}
    ${tag('ClosedAt', value.closedAt)}
    ${tag('Environment', value.environment)}
    ${tag('Platform', value.platform)}
    ${tag('PlatformVersion', value.platformVersion)}
    ${tag('Jurisdiction', value.jurisdiction)}
    ${tag('WorkspaceID', value.workspaceId)}
    ${tag('OrganizationID', value.organizationId)}
  </Paquete>
  <Documento>
    <Identificacion>
      ${tag('DocumentID', value.document.documentId)}
      ${tag('ExternalID', value.document.externalId)}
      ${tag('Nombre', value.document.name)}
      ${tag('NombreArchivo', value.document.fileName)}
      ${tag('MimeType', value.document.mimeType)}
      ${tag('TamanoBytes', value.document.sizeBytes)}
      ${tag('NumeroPaginas', value.document.pageCount)}
    </Identificacion>
    <Origen>
      ${tag('TipoOrigen', value.document.originType)}
      ${tag('CreatedByRef', value.document.createdByRef)}
      ${tag('CreatedAt', value.document.createdAt)}
    </Origen>
    <Versionado>
      ${tag('Version', value.document.version)}
      ${tag('VersionID', value.document.versionId)}
      ${tag('PreviousVersionID', value.document.previousVersionId)}
      ${tag('PreviousVersionHash', value.document.previousVersionHash, ' algoritmo="SHA-256"')}
    </Versionado>
    ${
      isV21
        ? `<ExtractoDocumento status="${extract ? 'available' : 'not_applicable'}">${
            extract
              ? `${tag('Source', extract.source)}${tag('SourceRef', extract.sourceRef)}${tag('Content', extract.content)}${tag('ReviewedAt', extract.reviewedAt)}`
              : ''
          }</ExtractoDocumento>`
        : ''
    }
    <MetadatosDocumento>${metadata}
      ${isV21 ? tag('MetadataSnapshotHash', value.document.metadataSnapshotHash, ' algoritmo="SHA-256" canonicalization="RFC8785"') : ''}
    </MetadatosDocumento>
    ${isV21 ? `<ContenidoCanonico mediaType="application/pdf"><DocumentVersionRef>${esc(value.document.versionId)}</DocumentVersionRef></ContenidoCanonico>` : ''}
    <Integridad>
      ${tag('HashOriginal', value.document.originalHash, ' algoritmo="SHA-256"')}
      ${tag('HashPreparado', value.document.preparedHash, ' algoritmo="SHA-256"')}
      ${tag('HashFinal', value.document.finalHash, ' algoritmo="SHA-256"')}
    </Integridad>
    <Fechas>
      ${tag('PreparedAt', value.document.preparedAt)}
      ${tag('SignatureFlowStartedAt', value.document.flowStartedAt)}
      ${tag('ClosedAt', value.closedAt)}
    </Fechas>
    ${isV21 ? `<Workflow status="${esc(value.document.workflow?.status || 'COMPLETED')}">${tag('CompletedAt', value.document.workflow?.completedAt || value.closedAt)}</Workflow>` : ''}
    ${isV21 ? `<Relaciones>${relations}</Relaciones>` : ''}
  </Documento>
  <Firmantes>${renderParticipants(value.participants, isV21)}
  </Firmantes>
  <Firmas>${renderSignatures(value.signatures, isV21)}
  </Firmas>
  <BitacoraProbatoria>${renderEvents(value.events, isV21)}
  </BitacoraProbatoria>
  <CadenaEvidencia algoritmo="SHA-256" version="${value.chain.algorithmVersion}">
    ${tag('GenesisHash', value.chain.genesisHash, ' algoritmo="SHA-256"')}
    ${tag('RootHash', value.chain.rootHash, ' algoritmo="SHA-256"')}
    ${tag('TotalEvents', value.chain.totalEvents)}
    ${isV21 ? tag('WatermarkSequence', value.chain.watermarkSequence ?? value.chain.totalEvents) : ''}
    ${tag('ClosedAt', value.closedAt)}
  </CadenaEvidencia>
  <EstampasTiempo>${renderTimestamps(value.timestamps)}
  </EstampasTiempo>
  <ConservacionNOM151 status="${esc(value.nom151.status)}">
    ${tag('RequestID', value.nom151.requestId)}
    ${tag('RequestedAt', value.nom151.requestedAt)}
    ${tag('HashSubmitted', value.nom151.hashSubmitted, ' algoritmo="SHA-256"')}
    ${tag('ProviderName', value.nom151.providerName)}
    ${tag('ProviderIdentifier', value.nom151.providerIdentifier)}
    ${tag('ConstanciaID', value.nom151.constanciaId)}
    ${tag('IssuedAt', value.nom151.issuedAt)}
    ${tag('ConstanciaHash', value.nom151.constanciaHash, ' algoritmo="SHA-256"')}
    ${tag('SerialNumber', value.nom151.serialNumber)}
    ${tag('Policy', value.nom151.policy)}
    ${tag('ArtifactRef', value.nom151.artifactRef)}
  </ConservacionNOM151>
  <Integridad>
    ${
      value.evidenceRoot
        ? `<EvidenceRoot algoritmo="SHA-256" canonicalization="RFC8785">
      ${tag('DocumentFinalHash', value.evidenceRoot.documentFinalHash, ' algoritmo="SHA-256"')}
      ${tag('MetadataSnapshotHash', value.evidenceRoot.metadataSnapshotHash, ' algoritmo="SHA-256"')}
      ${tag('EvidenceEventRootHash', value.evidenceRoot.evidenceEventRootHash, ' algoritmo="SHA-256"')}
      ${tag('SignaturesDigest', value.evidenceRoot.signaturesDigest, ' algoritmo="SHA-256"')}
      ${tag('PackageCoreDigest', value.evidenceRoot.packageCoreDigest, ' algoritmo="SHA-256"')}
      ${tag('Value', value.evidenceRoot.value, ' algoritmo="SHA-256"')}
    </EvidenceRoot>`
        : ''
    }
    ${tag('EvidencePackageDigest', value.packageDigest, ' algoritmo="SHA-256" canonicalization="docubox-evidence-root-v1"')}
    <HashXML algoritmo="SHA-256" canonicalization="docubox-evidence-xml-v2">${esc(xmlSha256)}</HashXML>
  </Integridad>
  <FirmaDocubox estado="${signature ? 'applied' : 'not_applied'}">
    ${
      signature
        ? `${tag('Algorithm', signature.algorithm)}
    ${tag('KeyID', signature.keyId)}
    ${tag('KeyVersion', signature.keyVersion)}
    ${tag('PublicKeyFingerprint', signature.publicKeyFingerprintSha256, ' algoritmo="SHA-256"')}
    ${signature.publicKeyPem ? tag('PublicKeyPemBase64', Buffer.from(signature.publicKeyPem, 'utf8').toString('base64')) : ''}
    ${tag('SignatureValue', signature.signatureBase64)}
    ${tag('SignatureHash', signature.signatureSha256, ' algoritmo="SHA-256"')}
    ${tag('SignedAt', signature.signedAt)}`
        : ''
    }
  </FirmaDocubox>
  <Verificacion modelo="docubox-evidence-verification-v1" overallStatus="${value.verification.overall}">
    ${status('DocumentIntegrity', value.verification.documentIntegrity)}
    ${status('ParticipantSignatures', value.verification.participantSignatures)}
    ${status('Certificates', value.verification.certificates)}
    ${status('EvidenceChain', value.verification.evidenceChain)}
    ${status('DocuboxSignature', value.verification.docuboxSignature)}
    ${status('Timestamp', value.verification.timestamp)}
    ${status('OpenTimestamps', value.verification.openTimestamps)}
    ${status('NOM151', value.verification.nom151)}
  </Verificacion>
</DocuboxEvidencePackage>`;
}

export function renderAndDigestEvidenceV2Xml(value: EvidenceV2Package) {
  const canonicalXml = renderEvidenceV2Xml(value, '');
  const xmlSha256 = sha256Hex(canonicalXml);
  const xml = renderEvidenceV2Xml(value, xmlSha256);
  return { xml, xmlSha256 };
}

/**
 * Structural validation is intentionally limited to the published v2 profile.
 * The matching XSD is shipped alongside this code for external validators.
 */
export function validateEvidenceV2Xml(xml: string) {
  const errors: string[] = [];
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) errors.push('DTD and entity declarations are not permitted');
  if (
    !new RegExp(
      `<DocuboxEvidencePackage[^>]+xmlns="${EVIDENCE_V2_NAMESPACE}"[^>]+version="2\\.[01]"`
    ).test(xml)
  )
    errors.push('The document does not declare the v2 root namespace and version');
  for (const block of [
    'Paquete',
    'Documento',
    'Firmantes',
    'Firmas',
    'BitacoraProbatoria',
    'CadenaEvidencia',
    'EstampasTiempo',
    'ConservacionNOM151',
    'FirmaDocubox',
    'Verificacion',
  ]) {
    if (!new RegExp(`<${block}(?:\\s|>)`).test(xml))
      errors.push(`Missing required block: ${block}`);
  }
  if (/schemaVersion="2\.1"/.test(xml)) {
    if (/xmlns:ds=/.test(xml)) errors.push('Evidence 2.1 must not claim XMLDSig');
    for (const block of [
      'ExtractoDocumento',
      'ContenidoCanonico',
      'Workflow',
      'Relaciones',
      'EvidenceRoot',
    ]) {
      if (!new RegExp(`<${block}(?:\\s|>)`).test(xml)) errors.push(`Missing v2.1 block: ${block}`);
    }
  }
  const xmlDigestMatches = xml.match(/<HashXML[^>]*>([a-f0-9]{64})<\/HashXML>/g) || [];
  if (xmlDigestMatches.length !== 1) errors.push('Exactly one SHA-256 XML digest is required');
  return { valid: errors.length === 0, errors };
}
