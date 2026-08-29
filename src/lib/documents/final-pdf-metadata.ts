import { createHash } from 'node:crypto';
import { PDFDocument, PDFName } from 'pdf-lib';

export type FinalPdfAdditionalMetadata = {
  name: string;
  dataType: string;
  value: string;
  snapshotHash?: string | null;
};

export type FinalPdfTechnicalMetadata = {
  documentId: string;
  documentFolio: string;
  tenantId: string;
  workspaceId: string;
  documentVersion: number;
  title: string;
  documentType: string;
  originalSha256: string;
  createdAt: string;
  completedAt: string;
  creatorId: string;
  creatorName: string;
  signatureMethods: string[];
  participantCount: number;
  status: string;
  workflow: string;
  caseFileId: string | null;
  templateId: string | null;
  formId: string | null;
  nom151Status: string;
  certificationStatus: string;
  pdfSignatureStatus: string;
  certificateStatus: string;
  padesProfile: string | null;
  timestampStatus: string;
  tsaProvider: string | null;
  evidenceChainSha256: string | null;
  identityVerificationStatus: string;
  assuranceLevel: string;
  additionalDocumentMetadata: FinalPdfAdditionalMetadata[];
};

function xml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
    .join(',')}}`;
}

function validDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function hashFinalPdfMetadata(metadata: FinalPdfTechnicalMetadata) {
  return createHash('sha256').update(canonicalize(metadata), 'utf8').digest('hex');
}

export function buildFinalPdfXmp(metadata: FinalPdfTechnicalMetadata, snapshotSha256: string) {
  const additional = metadata.additionalDocumentMetadata
    .map((item) => `
          <rdf:li rdf:parseType="Resource">
            <dbx:name>${xml(item.name)}</dbx:name>
            <dbx:dataType>${xml(item.dataType)}</dbx:dataType>
            <dbx:value>${xml(item.value)}</dbx:value>
            <dbx:snapshotSHA256>${xml(item.snapshotHash || '')}</dbx:snapshotSHA256>
          </rdf:li>`)
    .join('');
  const methods = metadata.signatureMethods.map((method) => `<rdf:li>${xml(method)}</rdf:li>`).join('');

  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Docubox Final Document Metadata 1.0">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:xmp="http://ns.adobe.com/xap/1.0/"
      xmlns:pdf="http://ns.adobe.com/pdf/1.3/"
      xmlns:dbx="https://docubox.mx/ns/metadata/1.0/">
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xml(metadata.title)}</rdf:li></rdf:Alt></dc:title>
      <dc:creator><rdf:Seq><rdf:li>${xml(metadata.creatorName)}</rdf:li></rdf:Seq></dc:creator>
      <pdf:Producer>Docubox FinalDocumentRenderer 1.0</pdf:Producer>
      <xmp:CreatorTool>Docubox</xmp:CreatorTool>
      <xmp:CreateDate>${xml(metadata.createdAt)}</xmp:CreateDate>
      <xmp:ModifyDate>${xml(metadata.completedAt)}</xmp:ModifyDate>
      <dbx:documentId>${xml(metadata.documentId)}</dbx:documentId>
      <dbx:documentFolio>${xml(metadata.documentFolio)}</dbx:documentFolio>
      <dbx:tenantId>${xml(metadata.tenantId)}</dbx:tenantId>
      <dbx:workspaceId>${xml(metadata.workspaceId)}</dbx:workspaceId>
      <dbx:documentVersion>${metadata.documentVersion}</dbx:documentVersion>
      <dbx:documentType>${xml(metadata.documentType)}</dbx:documentType>
      <dbx:originalSHA256>${xml(metadata.originalSha256)}</dbx:originalSHA256>
      <dbx:status>${xml(metadata.status)}</dbx:status>
      <dbx:workflow>${xml(metadata.workflow)}</dbx:workflow>
      <dbx:participantCount>${metadata.participantCount}</dbx:participantCount>
      <dbx:creatorId>${xml(metadata.creatorId)}</dbx:creatorId>
      <dbx:caseFileId>${xml(metadata.caseFileId || '')}</dbx:caseFileId>
      <dbx:templateId>${xml(metadata.templateId || '')}</dbx:templateId>
      <dbx:formId>${xml(metadata.formId || '')}</dbx:formId>
      <dbx:nom151Status>${xml(metadata.nom151Status)}</dbx:nom151Status>
      <dbx:certificationStatus>${xml(metadata.certificationStatus)}</dbx:certificationStatus>
      <dbx:pdfSignatureStatus>${xml(metadata.pdfSignatureStatus)}</dbx:pdfSignatureStatus>
      <dbx:certificateStatus>${xml(metadata.certificateStatus)}</dbx:certificateStatus>
      <dbx:padesProfile>${xml(metadata.padesProfile || '')}</dbx:padesProfile>
      <dbx:timestampStatus>${xml(metadata.timestampStatus)}</dbx:timestampStatus>
      <dbx:tsaProvider>${xml(metadata.tsaProvider || '')}</dbx:tsaProvider>
      <dbx:evidenceChainSHA256>${xml(metadata.evidenceChainSha256 || '')}</dbx:evidenceChainSHA256>
      <dbx:identityVerificationStatus>${xml(metadata.identityVerificationStatus)}</dbx:identityVerificationStatus>
      <dbx:assuranceLevel>${xml(metadata.assuranceLevel)}</dbx:assuranceLevel>
      <dbx:metadataSnapshotSHA256>${snapshotSha256}</dbx:metadataSnapshotSHA256>
      <dbx:signatureMethods><rdf:Bag>${methods}</rdf:Bag></dbx:signatureMethods>
      <dbx:additionalDocumentMetadata><rdf:Seq>${additional}
        </rdf:Seq></dbx:additionalDocumentMetadata>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

export function applyFinalPdfMetadata(pdf: PDFDocument, metadata: FinalPdfTechnicalMetadata) {
  const snapshotSha256 = hashFinalPdfMetadata(metadata);
  const createdAt = validDate(metadata.createdAt);
  const completedAt = validDate(metadata.completedAt);

  pdf.setTitle(metadata.title);
  pdf.setAuthor(metadata.creatorName || 'Docubox');
  pdf.setSubject(`Documento firmado y cerrado en Docubox - ${metadata.documentFolio}`);
  pdf.setCreator('Docubox');
  pdf.setProducer('Docubox FinalDocumentRenderer 1.0');
  pdf.setKeywords([
    'Docubox',
    'documento firmado',
    `document_id:${metadata.documentId}`,
    `folio:${metadata.documentFolio}`,
    `version:${metadata.documentVersion}`,
    `estado:${metadata.status}`,
    `metadata_sha256:${snapshotSha256}`,
  ]);
  if (createdAt) pdf.setCreationDate(createdAt);
  if (completedAt) pdf.setModificationDate(completedAt);

  const xmp = buildFinalPdfXmp(metadata, snapshotSha256);
  const stream = pdf.context.stream(new TextEncoder().encode(xmp), {
    Type: PDFName.of('Metadata'),
    Subtype: PDFName.of('XML'),
  });
  const reference = pdf.context.register(stream);
  pdf.catalog.set(PDFName.of('Metadata'), reference);

  return { snapshotSha256, xmp };
}
