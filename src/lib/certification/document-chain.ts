import { sha256Hex } from './canonical';

export const DOCUBOX_DOCUMENT_CHAIN_SCHEMA = 'DBX' as const;
export const DOCUBOX_DOCUMENT_CHAIN_VERSION = '1.0' as const;
export const DOCUBOX_DOCUMENT_CHAIN_ENCODING = 'UTF-8-PIPE' as const;

export interface DocuboxDocumentChainInput {
  documentUuid: string;
  folio: string;
  documentVersion: number;
  documentSha256: string;
  evidenceManifestSha256: string;
  closedAtUtc: string;
}

export interface DocuboxDocumentChainPayload {
  schema: typeof DOCUBOX_DOCUMENT_CHAIN_SCHEMA;
  schema_version: typeof DOCUBOX_DOCUMENT_CHAIN_VERSION;
  chain_encoding: typeof DOCUBOX_DOCUMENT_CHAIN_ENCODING;
  document_uuid: string;
  document_folio: string;
  document_version: number;
  document_body_sha256: string;
  evidence_manifest_sha256: string;
  closed_at_utc: string;
}

function normalizedText(value: string, field: string) {
  const normalized = String(value || '').normalize('NFC').trim();
  if (!normalized || /[|\r\n]/.test(normalized)) {
    throw new Error(`${field} no puede estar vacio ni contener separadores de cadena.`);
  }
  return normalized;
}

function normalizedSha256(value: string, field: string) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!/^[A-F0-9]{64}$/.test(normalized)) {
    throw new Error(`${field} debe ser una huella SHA-256 valida.`);
  }
  return normalized;
}

function normalizedUtc(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('closedAtUtc debe ser una fecha valida.');
  return date.toISOString();
}

export function createDocuboxDocumentChainPayload(
  input: DocuboxDocumentChainInput
): DocuboxDocumentChainPayload {
  const documentVersion = Number(input.documentVersion);
  if (!Number.isInteger(documentVersion) || documentVersion < 1) {
    throw new Error('documentVersion debe ser un entero positivo.');
  }

  return {
    schema: DOCUBOX_DOCUMENT_CHAIN_SCHEMA,
    schema_version: DOCUBOX_DOCUMENT_CHAIN_VERSION,
    chain_encoding: DOCUBOX_DOCUMENT_CHAIN_ENCODING,
    document_uuid: normalizedText(input.documentUuid, 'documentUuid').toUpperCase(),
    document_folio: normalizedText(input.folio, 'folio'),
    document_version: documentVersion,
    document_body_sha256: normalizedSha256(input.documentSha256, 'documentSha256'),
    evidence_manifest_sha256: normalizedSha256(
      input.evidenceManifestSha256,
      'evidenceManifestSha256'
    ),
    closed_at_utc: normalizedUtc(input.closedAtUtc),
  };
}

export function serializeDocuboxDocumentChain(payload: DocuboxDocumentChainPayload) {
  return [
    '',
    '',
    payload.schema,
    payload.schema_version,
    payload.document_uuid,
    payload.document_folio,
    String(payload.document_version),
    payload.document_body_sha256,
    payload.evidence_manifest_sha256,
    payload.closed_at_utc,
    '',
    '',
  ].join('|');
}

export function buildDocuboxDocumentChain(input: DocuboxDocumentChainInput) {
  const payload = createDocuboxDocumentChainPayload(input);
  const text = serializeDocuboxDocumentChain(payload);
  return {
    payload,
    text,
    canonical: text,
    bytes: Buffer.from(text, 'utf8'),
    sha256: sha256Hex(Buffer.from(text, 'utf8')),
  };
}

export function isDocuboxDocumentChainPayload(
  value: unknown
): value is DocuboxDocumentChainPayload {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DocuboxDocumentChainPayload>;
  return (
    candidate.schema === DOCUBOX_DOCUMENT_CHAIN_SCHEMA &&
    candidate.schema_version === DOCUBOX_DOCUMENT_CHAIN_VERSION &&
    candidate.chain_encoding === DOCUBOX_DOCUMENT_CHAIN_ENCODING
  );
}
