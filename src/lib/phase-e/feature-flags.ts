import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

export const PHASE_E_FEATURES = {
  contractualIntelligence: 'lucia_contractual',
  bulkRuntime: 'bulk_signature_runtime',
  organizationSso: 'organization_sso',
  publicApi: 'public_api_v1',
  workflowBuilder: 'workflow_builder',
} as const;

export async function isPhaseEFeatureEnabled(service: SupabaseClient, featureKey: string) {
  if (process.env.NODE_ENV !== 'production' && process.env.PHASE_E_FEATURES_ENABLED === 'true') {
    return true;
  }
  const result = await service
    .from('platform_feature_flags')
    .select('global_enabled,rollout_percentage')
    .eq('flag_key', featureKey)
    .maybeSingle();
  if (result.error || !result.data) return false;
  return result.data.global_enabled === true && Number(result.data.rollout_percentage || 0) > 0;
}
