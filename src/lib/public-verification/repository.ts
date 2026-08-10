import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ArtifactType,
  LocatedVerificationDocument,
  PublicVerificationParticipant,
  VerificationArtifactMatch,
} from './types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

export function sha256Token(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function normalizeSha256(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^sha-?256:/, '')
    .replace(/\s+/g, '');
  return SHA256_PATTERN.test(normalized) ? normalized : null;
}

function maskEmail(value: string) {
  const [local, domain] = value.trim().toLowerCase().split('@');
  if (!local || !domain) return null;
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(3, Math.min(8, local.length - visible.length)))}@${domain}`;
}

function signatureMethodLabel(value: unknown) {
  const method = String(value || '').toLowerCase();
  if (method.includes('efirma') || method.includes('e.firma')) return 'e.firma SAT';
  if (method.includes('autograph') || method.includes('autografa'))
    return 'Firma autógrafa digital';
  if (method.includes('click')) return 'Click & Sign';
  return method ? String(value) : 'Firma electrónica';
}

function sanitizeParticipants(
  value: unknown,
  evidence: Array<Record<string, any>> = []
): PublicVerificationParticipant[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 25).map((participant: Record<string, any>, index) => {
    const rawEmail = String(participant.correo || participant.email || '')
      .trim()
      .toLowerCase();
    const rawName = String(participant.nombre || participant.name || 'Participante')
      .replace(/\s*\([^)]*\)\s*$/i, '')
      .trim();
    const matchingEvidence =
      evidence.find(
        (item) =>
          rawEmail &&
          String(item.participant_email || '')
            .trim()
            .toLowerCase() === rawEmail
      ) ||
      evidence.find(
        (item) =>
          rawName &&
          String(item.participant_name || item.efirma_nombre || '')
            .trim()
            .toLowerCase() === rawName.toLowerCase()
      ) ||
      (value.length === 1 ? evidence[0] : evidence[index]);
    const configuredMethods = Array.isArray(participant.tipoFirma)
      ? participant.tipoFirma
      : [participant.tipoFirma || participant.signatureMethod].filter(Boolean);
    const evidenceEmail = String(matchingEvidence?.participant_email || '')
      .trim()
      .toLowerCase();

    return {
      name: rawName || 'Participante',
      email: maskEmail(rawEmail || evidenceEmail),
      role: String(participant.acto || participant.rolDocumento || 'Participante'),
      status: String(participant.sub_estado || participant.estado || 'completado'),
      signatureMethod: signatureMethodLabel(
        configuredMethods[0] || matchingEvidence?.evidence_type
      ),
      signedAt: matchingEvidence?.captured_at || null,
    };
  });
}

async function findPublicLink(supabase: SupabaseClient, identifier: string) {
  const digest = sha256Token(identifier);
  const { data, error } = await supabase
    .from('public_verifications')
    .select('id,document_id,visibility_level,status,expires_at,revoked_at')
    .or(`public_token_hash.eq.${digest},verification_code_hash.eq.${digest}`)
    .maybeSingle();
  if (error) return null;
  if (!data || data.status !== 'active' || data.revoked_at) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return null;
  return data;
}

export async function locateVerificationDocument(
  supabase: SupabaseClient,
  identifier: string
): Promise<LocatedVerificationDocument | null> {
  const clean = decodeURIComponent(identifier).trim();
  if (!clean || clean.length > 160) return null;
  const publicLink = await findPublicLink(supabase, clean);
  let documentId = publicLink?.document_id || null;

  if (!documentId && UUID_PATTERN.test(clean)) {
    const { data: certification } = await supabase
      .from('document_certifications')
      .select('document_id')
      .eq('verification_uuid', clean)
      .in('status', ['COMPLETED', 'REVOKED'])
      .maybeSingle();
    documentId = certification?.document_id || clean;
  }

  const select =
    'id,documento_id,folio_interno,nombre,estado,es_publico,owner_id,workspace_id,file_url,file_size,file_hash_sha256,sealed_pdf_path,sealed_pdf_hash,xml_evidencia_path,xml_hash_sha256,created_at,updated_at,fecha_completado,participantes';
  let document: any = null;
  if (documentId) {
    const { data } = await supabase
      .from('documentos')
      .select(select)
      .eq('id', documentId)
      .eq('estado', 'completado')
      .maybeSingle();
    document = data;
  }
  if (!document) {
    const { data } = await supabase
      .from('documentos')
      .select(select)
      .eq('documento_id', clean)
      .eq('estado', 'completado')
      .maybeSingle();
    document = data;
  }
  if (!document) {
    const { data } = await supabase
      .from('documentos')
      .select(select)
      .eq('folio_interno', clean)
      .eq('estado', 'completado')
      .maybeSingle();
    document = data;
  }
  if (!document) return null;

  const [{ data: certification }, { data: nom151 }, workspaceResult, ownerResult, evidenceResult] =
    await Promise.all([
      supabase
        .from('document_certifications')
        .select(
          'verification_uuid,status,document_body_sha256,certified_pdf_sha256,document_chain_canonical_json,created_at'
        )
        .eq('document_id', document.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('nom151_constancias_doc')
        .select('constancia_sha256,created_at,status')
        .eq('documento_id', document.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      document.workspace_id
        ? supabase.from('workspaces').select('name').eq('id', document.workspace_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from('profiles').select('full_name').eq('id', document.owner_id).maybeSingle(),
      supabase
        .from('signature_evidence')
        .select(
          'evidence_type,captured_at,participant_name,participant_email,participant_role,efirma_nombre'
        )
        .eq('document_id', document.id)
        .eq('is_voided', false)
        .order('captured_at', { ascending: true }),
    ]);

  const hashes: VerificationArtifactMatch[] = [];
  addHash(hashes, 'ORIGINAL_DOCUMENT', document.file_hash_sha256, document.created_at);
  addHash(hashes, 'SIGNED_DOCUMENT', document.sealed_pdf_hash, document.fecha_completado);
  addHash(hashes, 'EVIDENCE_XML', document.xml_hash_sha256, document.updated_at);
  addHash(
    hashes,
    'ORIGINAL_DOCUMENT',
    certification?.document_body_sha256,
    certification?.created_at
  );
  addHash(
    hashes,
    'CERTIFICATION_PDF',
    certification?.certified_pdf_sha256,
    certification?.created_at
  );
  addHash(hashes, 'NOM151_CONSTANCY', nom151?.constancia_sha256, nom151?.created_at);

  return {
    id: document.id,
    folio: document.folio_interno || document.documento_id,
    name: document.nombre,
    status: document.estado,
    isPublic: Boolean(
      document.es_publico && (!publicLink || publicLink.visibility_level === 'document')
    ),
    issuer: ownerResult.data?.full_name || 'Cuenta Docubox',
    workspaceName: workspaceResult.data?.name || 'Espacio personal',
    ownerId: document.owner_id,
    fileSize: document.file_size || null,
    pageCount: certification?.document_chain_canonical_json?.page_count || null,
    createdAt: document.created_at,
    completedAt: document.fecha_completado || document.updated_at,
    fileUrl: document.file_url,
    sealedPdfPath: document.sealed_pdf_path,
    participants: sanitizeParticipants(document.participantes, evidenceResult.data || []),
    hashes: deduplicateHashes(hashes),
    xmlPresent: Boolean(document.xml_evidencia_path || document.xml_hash_sha256),
    nom151Present: Boolean(nom151),
    certificationVerificationUuid: certification?.verification_uuid || null,
    certificationStatus: certification?.status || null,
    publicLinkId: publicLink?.id || null,
    visibilityLevel: publicLink?.visibility_level || null,
  };
}

export async function findArtifactsByHash(supabase: SupabaseClient, rawHash: string) {
  const hash = normalizeSha256(rawHash);
  if (!hash) return { hash: null, document: null, matches: [] as VerificationArtifactMatch[] };

  const { data: indexed } = await supabase
    .from('document_artifacts')
    .select('document_id,artifact_type,file_hash,hash_algorithm,created_at')
    .eq('hash_algorithm', 'SHA-256')
    .eq('file_hash', hash)
    .limit(20);
  if (indexed?.length) {
    const document = await locateVerificationDocumentById(supabase, indexed[0].document_id);
    return {
      hash,
      document,
      matches: indexed.map((row) => ({
        type: row.artifact_type as ArtifactType,
        algorithm: row.hash_algorithm,
        hash: row.file_hash,
        registeredAt: row.created_at,
      })),
    };
  }

  const columns = ['file_hash_sha256', 'sealed_pdf_hash', 'xml_hash_sha256'] as const;
  for (const column of columns) {
    const { data } = await supabase
      .from('documentos')
      .select('id')
      .eq(column, hash)
      .eq('estado', 'completado')
      .limit(1)
      .maybeSingle();
    if (data) {
      const document = await locateVerificationDocumentById(supabase, data.id);
      const type: ArtifactType =
        column === 'sealed_pdf_hash'
          ? 'SIGNED_DOCUMENT'
          : column === 'xml_hash_sha256'
            ? 'EVIDENCE_XML'
            : 'ORIGINAL_DOCUMENT';
      return { hash, document, matches: [{ type, algorithm: 'SHA-256', hash }] };
    }
  }
  return { hash, document: null, matches: [] as VerificationArtifactMatch[] };
}

async function locateVerificationDocumentById(supabase: SupabaseClient, id: string) {
  return locateVerificationDocument(supabase, id);
}

function addHash(
  target: VerificationArtifactMatch[],
  type: ArtifactType,
  value?: string | null,
  registeredAt?: string | null
) {
  const hash = value ? normalizeSha256(value) : null;
  if (hash) target.push({ type, algorithm: 'SHA-256', hash, registeredAt });
}

function deduplicateHashes(values: VerificationArtifactMatch[]) {
  return values.filter(
    (value, index) =>
      values.findIndex(
        (candidate) => candidate.type === value.type && candidate.hash === value.hash
      ) === index
  );
}
