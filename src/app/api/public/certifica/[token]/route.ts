import { createServiceClient } from '@/lib/supabase/server';
import { sha256 } from '@/lib/certifica/server';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const started = Date.now();
  const { token } = await context.params;
  if (!/^[A-Za-z0-9_-]{20,120}$/.test(token)) return Response.json({ success: false, error: 'Referencia no valida.' }, { status: 400 });
  const service = createServiceClient();
  const link = await service.from('certification_public_links').select('certification_id,workspace_id,status,visibility,expires_at').eq('public_token_hash', sha256(token)).maybeSingle();
  if (link.error || !link.data || link.data.status !== 'active' || (link.data.expires_at && new Date(link.data.expires_at) < new Date())) return Response.json({ success: false, error: 'No se encontro una certificacion publica vigente.' }, { status: 404 });
  const [certification, evidences, manifest] = await Promise.all([
    service.from('certification_cases').select('id,human_folio,public_id,title,service_key,status,provider_mode,original_filename,original_sha256,final_sha256,file_classification,certified_existence_at,issued_at,validated_at,warnings').eq('id', link.data.certification_id).single(),
    service.from('certification_evidences').select('evidence_type,issuer_type,status,folio,issued_at,validated_at,sha256,validation_result').eq('certification_id', link.data.certification_id),
    service.from('certification_manifests').select('schema_version,canonical_sha256,created_at').eq('certification_id', link.data.certification_id).maybeSingle(),
  ]);
  if (certification.error || !certification.data) return Response.json({ success: false, error: 'No se encontro la certificacion.' }, { status: 404 });
  await service.from('certification_verification_runs').insert({ certification_id: certification.data.id, workspace_id: link.data.workspace_id, source: 'public_id', overall_status: certification.data.status === 'validated' ? 'valid' : 'valid_with_warnings', validator_version: 'docubox-certifica/1.0', duration_ms: Date.now() - started, details: { public_link: true } });
  return Response.json({ success: true, certification: certification.data, evidences: evidences.data || [], manifest: manifest.data, verification: { checked_at: new Date().toISOString(), overall_status: certification.data.status === 'validated' ? 'valid' : 'valid_with_warnings', original_hash_matches_final: certification.data.original_sha256 === certification.data.final_sha256 } });
}
