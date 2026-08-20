import { randomBytes, randomUUID } from 'crypto';
import { z } from 'zod';
import { authorizeOrganizationRequest, OrganizationApiError } from '@/lib/organization/server';
import { buildCanonicalManifest, CERTIFICATION_DECLARATION, CERTIFICATION_SERVICES, stableStringify } from '@/lib/certifica/domain';
import { getCertificationProvider } from '@/lib/certifica/provider';
import { appendCertificationEvent, certificaApiFailure, hashRequestContext, requireCertification, sha256 } from '@/lib/certifica/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

const bodySchema = z.object({ workspace_id: z.string().uuid(), accept_declaration: z.literal(true), idempotency_key: z.string().min(8).max(180).optional() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let id = '';
  let workspaceId = '';
  let serviceClient: any;
  let actorId: string | undefined;
  try {
    ({ id } = await context.params);
    const input = bodySchema.parse(await request.json());
    workspaceId = input.workspace_id;
    const auth = await authorizeOrganizationRequest(request, workspaceId, 'certifications.submit');
    serviceClient = auth.service;
    actorId = auth.user.id;
    const certification = await requireCertification(auth.service, id, workspaceId);
    if (['issued', 'validated', 'issued_with_warnings', 'stored'].includes(certification.status)) {
      return Response.json({ success: true, case: certification, idempotent: true });
    }
    if (!['ready', 'requires_review'].includes(certification.status)) throw new OrganizationApiError(409, 'certification_not_ready', 'Analiza y corrige el documento antes de confirmar.');
    if (!certification.original_sha256 || !certification.original_storage_path) throw new OrganizationApiError(409, 'original_required', 'Falta el documento original.');
    if (certification.malware_status !== 'clean' && process.env.NODE_ENV === 'production') throw new OrganizationApiError(409, 'security_scan_required', 'El documento no cuenta con un analisis de seguridad valido.');
    const downloaded = await auth.service.storage.from('certification-originals').download(certification.original_storage_path);
    if (downloaded.error || !downloaded.data) throw new OrganizationApiError(503, 'original_unavailable', 'No se pudo leer el original privado.');
    const finalOriginalHash = sha256(Buffer.from(await downloaded.data.arrayBuffer()));
    if (finalOriginalHash !== certification.original_sha256) throw new OrganizationApiError(409, 'original_integrity_mismatch', 'El original cambio despues del analisis. La certificacion fue bloqueada.');

    const issuedAt = new Date().toISOString();
    const manifest = buildCanonicalManifest({ certificationId: id, publicId: certification.public_id, folio: certification.human_folio, workspaceId, title: certification.title, serviceKey: certification.service_key, originalSha256: certification.original_sha256, originalFilename: certification.original_filename, originalSizeBytes: certification.original_size_bytes, createdAt: certification.created_at, issuedAt, providerMode: certification.provider_mode });
    const canonical = stableStringify(manifest);
    const manifestHash = sha256(canonical);
    const requestContext = hashRequestContext(request);
    const declarationHash = sha256(CERTIFICATION_DECLARATION.text);
    const declarationResult = await auth.service.from('certification_declarations').upsert({ certification_id: id, workspace_id: workspaceId, accepted_by: auth.user.id, text_version: CERTIFICATION_DECLARATION.version, declaration_text: CERTIFICATION_DECLARATION.text, declaration_sha256: declarationHash, session_id: randomUUID(), ip_hash_sha256: requestContext.ipHash, user_agent_hash_sha256: requestContext.userAgentHash, accepted_at: issuedAt }, { onConflict: 'certification_id' });
    if (declarationResult.error) throw declarationResult.error;
    const existingManifest = await auth.service.from('certification_manifests').select('canonical_sha256').eq('certification_id', id).maybeSingle();
    if (existingManifest.error) throw existingManifest.error;
    if (existingManifest.data && existingManifest.data.canonical_sha256 !== manifestHash) {
      throw new OrganizationApiError(409, 'manifest_conflict', 'Ya existe un manifiesto inmutable distinto para esta operacion.');
    }
    if (!existingManifest.data) {
      const manifestResult = await auth.service.from('certification_manifests').insert({ certification_id: id, workspace_id: workspaceId, schema_version: '1.0', canonical_json: manifest, canonical_sha256: manifestHash });
      if (manifestResult.error) throw manifestResult.error;
    }

    let evidence: Record<string, unknown> = { manifest_sha256: manifestHash, original_sha256: finalOriginalHash };
    let evidenceType = 'docubox_integrity';
    let evidenceStatus = 'valid';
    let providerId: string | null = null;
    let finalStatus = 'validated';
    const product = CERTIFICATION_SERVICES[certification.service_key as keyof typeof CERTIFICATION_SERVICES];
    if (product.requiresPsc) {
      const provider = getCertificationProvider(certification.provider_mode);
      const providerRow = await auth.service.from('psc_providers').select('id').eq('provider_key', provider.key).maybeSingle();
      if (providerRow.error) throw providerRow.error;
      providerId = providerRow.data?.id || null;
      if (!providerId) throw new OrganizationApiError(503, 'psc_provider_missing', 'El proveedor seleccionado no esta registrado.');
      const operationKey = input.idempotency_key || `${id}:${certification.service_key}:v1`;
      const prior = await auth.service.from('certification_provider_transactions').select('*').eq('provider_id', providerId).eq('idempotency_key', operationKey).maybeSingle();
      if (prior.error) throw prior.error;
      if (prior.data?.status === 'succeeded') return Response.json({ success: true, certification_id: id, status: certification.status, idempotent: true });
      const transaction = prior.data || (await auth.service.from('certification_provider_transactions').insert({ certification_id: id, workspace_id: workspaceId, provider_id: providerId, operation_type: certification.service_key === 'nom151' || certification.service_key === 'evidence_pro' ? 'nom151' : 'timestamp', idempotency_key: operationKey, status: 'submitted', request_sha256: sha256(JSON.stringify({ finalOriginalHash, manifestHash })), attempts: 1, submitted_at: issuedAt }).select('*').single()).data;
      if (!transaction) throw new OrganizationApiError(500, 'provider_transaction_failed', 'No se pudo preparar la solicitud al proveedor.');
      const providerResult = await provider.issue({ certificationId: id, idempotencyKey: operationKey, serviceKey: certification.service_key, originalSha256: finalOriginalHash, manifestSha256: manifestHash });
      await auth.service.from('certification_provider_transactions').update({ provider_operation_id: providerResult.providerOperationId, status: 'succeeded', response_sha256: providerResult.evidenceSha256, response_redacted: { issuer: providerResult.issuer, sandbox: providerResult.sandbox }, completed_at: providerResult.issuedAt, updated_at: providerResult.issuedAt }).eq('id', transaction.id);
      evidence = providerResult.evidence;
      evidenceType = providerResult.evidenceType;
      evidenceStatus = providerResult.sandbox ? 'sandbox' : 'valid';
      finalStatus = providerResult.sandbox ? 'issued_with_warnings' : 'validated';
    }
    const evidenceInsert = await auth.service.from('certification_evidences').insert({ certification_id: id, workspace_id: workspaceId, evidence_type: evidenceType, issuer_type: product.requiresPsc && certification.provider_mode === 'production' ? 'psc' : 'docubox', status: evidenceStatus, folio: certification.human_folio, issued_at: issuedAt, validated_at: issuedAt, sha256: sha256(stableStringify(evidence)), validation_result: { hash_match: true, sandbox: evidenceStatus === 'sandbox' }, metadata: evidence }).select('id').single();
    if (evidenceInsert.error) throw evidenceInsert.error;
    const publicToken = randomBytes(24).toString('base64url');
    const linkResult = await auth.service.from('certification_public_links').insert({ certification_id: id, workspace_id: workspaceId, public_token_hash: sha256(publicToken), visibility: 'technical_summary', created_by: auth.user.id }).select('id').single();
    if (linkResult.error?.code !== '23505' && linkResult.error) throw linkResult.error;
    const total = Number(product.price || 0);
    const updated = await auth.service.from('certification_cases').update({ status: finalStatus, provider_id: providerId, final_sha256: finalOriginalHash, quoted_amount: total, total_amount: total, submitted_at: issuedAt, issued_at: issuedAt, validated_at: finalStatus === 'validated' ? issuedAt : null, certified_existence_at: product.requiresPsc ? issuedAt : null, retention_ends_at: new Date(new Date(issuedAt).setUTCFullYear(new Date(issuedAt).getUTCFullYear() + certification.retention_years)).toISOString(), updated_at: issuedAt }).eq('id', id).select('*').single();
    if (updated.error) throw updated.error;
    await appendCertificationEvent({ service: auth.service, certificationId: id, workspaceId, actorId: auth.user.id, eventType: 'certification.issued', payload: { service_key: certification.service_key, provider_mode: certification.provider_mode, status: finalStatus, original_sha256: finalOriginalHash, manifest_sha256: manifestHash } });
    return Response.json({ success: true, case: updated.data, public_token: publicToken, public_url: `/verificar-certificacion/c/${publicToken}` });
  } catch (error) {
    if (id && workspaceId && serviceClient) {
      await serviceClient.from('certification_cases').update({ status: 'provider_error', error_code: error instanceof Error ? error.message.split(':')[0] : 'submission_failed', error_detail: 'La operacion fallo de forma cerrada. No se emitio una certificacion valida.', updated_at: new Date().toISOString() }).eq('id', id).eq('workspace_id', workspaceId);
      await appendCertificationEvent({ service: serviceClient, certificationId: id, workspaceId, actorId, eventType: 'certification.failed', result: 'failed', payload: { code: error instanceof Error ? error.message.split(':')[0] : 'submission_failed' } }).catch(() => undefined);
    }
    return certificaApiFailure(error);
  }
}
