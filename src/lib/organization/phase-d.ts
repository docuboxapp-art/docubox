import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

export const PHASE_D_FLAGS = {
  signingGroups: 'advanced_signing_groups',
  delegation: 'signature_delegation',
  custody: 'document_custody_transfer',
  crossTenantCustody: 'cross_tenant_document_custody',
  retention: 'organization_retention_policies',
  witness: 'electronic_witness_routing',
} as const;

export async function isPhaseDFeatureEnabled(
  service: SupabaseClient,
  key: (typeof PHASE_D_FLAGS)[keyof typeof PHASE_D_FLAGS]
) {
  if (process.env.NODE_ENV !== 'production') {
    return process.env.DOCUBOX_PHASE_D_ENABLED !== 'false';
  }
  const result = await service
    .from('platform_feature_flags')
    .select('global_enabled,rollout_percentage')
    .eq('flag_key', key)
    .maybeSingle();
  if (result.error || !result.data?.global_enabled) return false;
  return Number(result.data.rollout_percentage || 0) > 0;
}

export async function snapshotDocumentSigningGroups(service: SupabaseClient, documentId: string) {
  const enabled = await isPhaseDFeatureEnabled(service, PHASE_D_FLAGS.signingGroups);
  if (!enabled) return { enabled: false };
  const result = await service.rpc('snapshot_document_signing_groups', {
    p_document_id: documentId,
  });
  if (result.error) throw result.error;
  return { enabled: true, data: result.data };
}
