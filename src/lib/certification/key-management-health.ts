import type { SupabaseClient } from '@supabase/supabase-js';
import { createCertificationProviderSet, type KeyManagementProvider, type ProviderHealth } from './providers';
import { CertificationError } from './types';

export type KeyManagementHealthResult = ProviderHealth & {
  checkedAt: string;
  latencyMs: number;
};

function providerName(provider: KeyManagementProvider) {
  return String((provider as { providerId?: string }).providerId || 'unknown');
}

/** Runs a synthetic, non-document provider check and persists only operational metadata. */
export async function runKeyManagementHealthCheck(
  supabase: SupabaseClient,
  tenantId: string,
  provider: KeyManagementProvider = createCertificationProviderSet().keyManagement,
): Promise<KeyManagementHealthResult> {
  const started = Date.now();
  const checkedAt = new Date().toISOString();
  const health = await provider.healthCheck();
  const result: KeyManagementHealthResult = { ...health, checkedAt, latencyMs: Date.now() - started };
  const providerId = providerName(provider);

  const configuration = await supabase.from('crypto_provider_configurations').upsert({
    tenant_id: tenantId,
    provider_type: 'KEY_MANAGEMENT',
    provider_name: providerId,
    environment: String(process.env.DOCUBOX_EXECUTION_ENVIRONMENT || process.env.NODE_ENV || 'development').toUpperCase(),
    enabled: health.ready,
    configuration_reference: providerId === 'openbao' ? 'infra/openbao' : null,
    secret_reference: providerId === 'openbao' ? 'OPENBAO_APPROLE' : null,
    health_status: health.ready ? 'OPERATIONAL' : 'DEGRADED',
    last_health_check_at: checkedAt,
    metadata: {
      key_id: health.keyId || null,
      key_version: health.keyVersion || null,
      missing: health.missing,
      latency_ms: result.latencyMs,
    },
  }, { onConflict: 'tenant_id,provider_type,environment' }).select('id').single();
  if (configuration.error || !configuration.data) {
    throw new CertificationError('CRYPTO_PROVIDER_CONFIGURATION_WRITE_FAILED', 'No fue posible registrar el estado del proveedor de llaves.', 500);
  }

  const testRecord = await supabase.from('crypto_provider_health_checks').insert({
    tenant_id: tenantId,
    provider_configuration_id: configuration.data.id,
    provider_name: providerId,
    key_id: health.keyId || null,
    key_version: health.keyVersion || null,
    algorithm: 'RSA-PSS-SHA256',
    protection_level: providerId === 'openbao' ? 'software' : 'unknown',
    result: health.ready ? 'SUCCESS' : 'FAILED',
    latency_ms: result.latencyMs,
    checked_at: checkedAt,
    detail: { missing: health.missing, code: health.ready ? null : health.missing[0] || 'PROVIDER_UNAVAILABLE' },
  });
  if (testRecord.error) {
    throw new CertificationError('CRYPTO_PROVIDER_HEALTH_WRITE_FAILED', 'No fue posible registrar la prueba del proveedor de llaves.', 500);
  }
  return result;
}
