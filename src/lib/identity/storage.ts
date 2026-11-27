import type { SupabaseClient } from '@supabase/supabase-js';
import {
  BASE_IDENTITY_POLICY,
  type IdentityPolicyConfig,
  type IdentityPolicyRecord,
  type IdentityPolicyStatus,
} from './schema';

const LOCAL_KEY = 'docubox_identity_policies';

function readLegacy(): IdentityPolicyRecord[] {
  try {
    const value = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
    return Array.isArray(value)
      ? value.filter((item) => typeof item?.id === 'string' && typeof item.workspaceId === 'string' && item.config)
      : [];
  } catch {
    return [];
  }
}

function removeLegacy(workspaceId: string, id: string) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(readLegacy().filter(
      (item) => item.workspaceId !== workspaceId || item.id !== id
    )));
  } catch {
    // The operation has already been confirmed by Supabase.
  }
}

function failure(error: { code?: string; message?: string }) {
  if (error.code === '42501') return new Error('Tu cuenta no tiene permiso para modificar las políticas.');
  if (error.message === 'identity_consent_required') return new Error('Activa los consentimientos requeridos para publicar.');
  if (error.code === '22023' || error.code === '23514') return new Error('Revisa el nombre, la descripción y los valores de la política.');
  return new Error('No se pudo completar la operación de políticas en Supabase.');
}

export type StoredIdentityPolicy = IdentityPolicyRecord & { needsSync?: boolean };

function normalizePolicyConfig(value: Partial<IdentityPolicyConfig>): IdentityPolicyConfig {
  const defaults = BASE_IDENTITY_POLICY;
  return {
    ...defaults,
    ...value,
    documents: Array.isArray(value.documents) ? value.documents.filter(Boolean) : [],
    appliesTo: Array.isArray(value.appliesTo) ? value.appliesTo : defaults.appliesTo,
    participantTypes: Array.isArray(value.participantTypes) ? value.participantTypes : defaults.participantTypes,
    captureModes: Array.isArray(value.captureModes) ? value.captureModes : defaults.captureModes,
    livenessChecks: Array.isArray(value.livenessChecks) ? value.livenessChecks : defaults.livenessChecks,
    comparisonChecks: Array.isArray(value.comparisonChecks) ? value.comparisonChecks : defaults.comparisonChecks,
  };
}

export async function listIdentityPolicies(supabase: SupabaseClient, workspaceId: string): Promise<StoredIdentityPolicy[]> {
  const { data, error } = await supabase
    .from('identity_policies')
    .select('id,workspace_id,name,description,status,policy_type,assurance_level,current_version,updated_at,identity_policy_versions(config,version)')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false });
  if (error) throw failure(error);
  const policies = (data ?? []).flatMap<StoredIdentityPolicy>((row) => {
    const selected = row.identity_policy_versions.find((version) => version.version === row.current_version);
    if (!selected) return [];
    return [{
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      description: row.description,
      status: row.status,
      policyType: row.policy_type,
      assuranceLevel: row.assurance_level,
      version: row.current_version,
      config: normalizePolicyConfig(selected.config ?? {}),
      updatedAt: row.updated_at,
    }];
  });
  const saved = new Set(policies.map((record) => record.id));
  const legacy = readLegacy().filter((item) =>
    item.workspaceId === workspaceId && !item.id.startsWith('starter-') && !saved.has(item.id)
  );
  return [
    ...policies,
    ...legacy.map((item) => ({ ...item, config: normalizePolicyConfig(item.config), needsSync: true })),
  ];
}

export async function getIdentityPolicy(supabase: SupabaseClient, workspaceId: string, id: string) {
  const policies = await listIdentityPolicies(supabase, workspaceId);
  return policies.find((item) => item.id === id) ?? null;
}

export async function saveIdentityPolicy(
  supabase: SupabaseClient,
  workspaceId: string,
  config: IdentityPolicyConfig,
  options: { id?: string; status: IdentityPolicyStatus; legacy?: boolean }
) {
  const { data, error } = await supabase.rpc('save_docubox_identity_policy', {
    p_workspace: workspaceId,
    p_id: options.legacy ? null : options.id ?? null,
    p_status: options.status,
    p_config: config,
  }).single<{ id: string; version: number; updated_at: string }>();
  if (error || !data) throw failure(error ?? {});
  if (options.id && options.legacy) removeLegacy(workspaceId, options.id);
  return data;
}

export async function deleteIdentityPolicy(supabase: SupabaseClient, workspaceId: string, policy: StoredIdentityPolicy) {
  if (!policy.needsSync) {
    const { error } = await supabase.rpc('save_docubox_identity_policy', {
      p_workspace: workspaceId,
      p_id: policy.id,
      p_status: 'delete',
      p_config: null,
    });
    if (error) throw failure(error);
  }
  removeLegacy(workspaceId, policy.id);
}
