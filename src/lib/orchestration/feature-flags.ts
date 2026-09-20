import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

export const PHASE_C_FEATURE_KEYS = {
  scheduledSending: 'scheduled_sending',
  delayedRouting: 'delayed_routing',
  agreementActions: 'agreement_actions',
  multichannel: 'multichannel_orchestration',
  webhooks: 'webhook_dispatcher',
} as const;

export async function isPhaseCFeatureEnabled(service: SupabaseClient, featureKey: string) {
  if (
    process.env.NODE_ENV !== 'production' &&
    process.env.DOCUBOX_PHASE_C_LOCAL_ENABLED !== 'false'
  ) {
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
