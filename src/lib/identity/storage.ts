import type { SupabaseClient } from '@supabase/supabase-js';
import {
  IDENTITY_POLICY_PRESETS,
  clonePolicyConfig,
  type IdentityPolicyConfig,
  type IdentityPolicyRecord,
  type IdentityPolicyStatus,
} from './schema';

const LOCAL_KEY = 'docubox_identity_policies';

function localPolicies(workspaceId: string): IdentityPolicyRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]') as IdentityPolicyRecord[];
    return parsed.filter((item) => item.workspaceId === workspaceId);
  } catch {
    return [];
  }
}

function saveLocal(record: IdentityPolicyRecord) {
  const current = typeof window === 'undefined' ? [] : JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
  const next = [...current.filter((item: IdentityPolicyRecord) => item.id !== record.id), record];
  localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
}

function starterPolicies(workspaceId: string): IdentityPolicyRecord[] {
  const now = new Date().toISOString();
  return IDENTITY_POLICY_PRESETS.slice(0, 3).map((preset, index) => ({
    id: `starter-${preset.id}`,
    workspaceId,
    name: preset.name,
    description: preset.description,
    status: index === 1 ? 'active' : 'draft',
    policyType: preset.config.type,
    assuranceLevel: preset.config.assuranceLevel,
    version: 1,
    config: clonePolicyConfig(preset.config),
    updatedAt: now,
  }));
}

export async function listIdentityPolicies(supabase: SupabaseClient, workspaceId: string): Promise<{ policies: IdentityPolicyRecord[]; remote: boolean }> {
  const { data, error } = await supabase
    .from('identity_policies')
    .select('id,workspace_id,name,description,status,policy_type,assurance_level,current_version,updated_at,identity_policy_versions(config,version,status)')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false });

  if (!error && data) {
    return {
      remote: true,
      policies: data.map((row: any) => {
        const versions = Array.isArray(row.identity_policy_versions) ? row.identity_policy_versions : [];
        const selected = versions.find((version: any) => version.version === row.current_version) || versions.sort((a: any, b: any) => b.version - a.version)[0];
        return {
          id: row.id,
          workspaceId: row.workspace_id,
          name: row.name,
          description: row.description || '',
          status: row.status,
          policyType: row.policy_type,
          assuranceLevel: row.assurance_level,
          version: selected?.version || row.current_version || 1,
          config: selected?.config || IDENTITY_POLICY_PRESETS[1].config,
          updatedAt: row.updated_at,
        } as IdentityPolicyRecord;
      }),
    };
  }

  const local = localPolicies(workspaceId);
  if (local.length) return { policies: local, remote: false };
  const starters = starterPolicies(workspaceId);
  starters.forEach(saveLocal);
  return { policies: starters, remote: false };
}

export async function getIdentityPolicy(supabase: SupabaseClient, workspaceId: string, id: string): Promise<IdentityPolicyRecord | null> {
  const { policies } = await listIdentityPolicies(supabase, workspaceId);
  return policies.find((item) => item.id === id) || null;
}

export async function saveIdentityPolicy(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  config: IdentityPolicyConfig,
  options: { id?: string; status: IdentityPolicyStatus },
): Promise<{ record: IdentityPolicyRecord; remote: boolean }> {
  const now = new Date().toISOString();
  const isStarter = options.id?.startsWith('starter-');
  const localExisting = options.id ? localPolicies(workspaceId).find((item) => item.id === options.id) : undefined;
  const nextVersion = options.status === 'active' && localExisting?.status === 'active' ? localExisting.version + 1 : localExisting?.version || 1;

  if (!isStarter) {
    let policyId = options.id;
    if (policyId) {
      const { error } = await supabase.from('identity_policies').update({
        name: config.name,
        description: config.description,
        status: options.status,
        policy_type: config.type,
        assurance_level: config.assuranceLevel,
        updated_at: now,
      }).eq('id', policyId).eq('workspace_id', workspaceId);
      if (error) policyId = undefined;
    } else {
      const { data, error } = await supabase.from('identity_policies').insert({
        workspace_id: workspaceId,
        name: config.name,
        description: config.description,
        status: options.status,
        policy_type: config.type,
        assurance_level: config.assuranceLevel,
        current_version: 1,
        created_by: userId,
      }).select('id').single();
      if (!error) policyId = data?.id;
    }

    if (policyId) {
      const { data: previous } = await supabase.from('identity_policy_versions').select('version').eq('policy_id', policyId).order('version', { ascending: false }).limit(1);
      const version = previous?.[0]?.version ? previous[0].version + (options.status === 'active' ? 1 : 0) : 1;
      const { error: versionError } = await supabase.from('identity_policy_versions').upsert({
        workspace_id: workspaceId,
        policy_id: policyId,
        version,
        status: options.status === 'active' ? 'published' : 'draft',
        config,
        published_at: options.status === 'active' ? now : null,
        published_by: options.status === 'active' ? userId : null,
        created_by: userId,
      }, { onConflict: 'policy_id,version' });
      if (!versionError) {
        await supabase.from('identity_policies').update({ current_version: version }).eq('id', policyId);
        return {
          remote: true,
          record: { id: policyId, workspaceId, name: config.name, description: config.description, status: options.status, policyType: config.type, assuranceLevel: config.assuranceLevel, version, config, updatedAt: now },
        };
      }
    }
  }

  const record: IdentityPolicyRecord = {
    id: isStarter ? crypto.randomUUID() : options.id || crypto.randomUUID(),
    workspaceId,
    name: config.name,
    description: config.description,
    status: options.status,
    policyType: config.type,
    assuranceLevel: config.assuranceLevel,
    version: nextVersion,
    config,
    updatedAt: now,
  };
  if (isStarter && typeof window !== 'undefined') {
    const current = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]') as IdentityPolicyRecord[];
    localStorage.setItem(LOCAL_KEY, JSON.stringify(current.filter((item) => item.id !== options.id)));
  }
  saveLocal(record);
  return { record, remote: false };
}

export async function deleteIdentityPolicy(supabase: SupabaseClient, workspaceId: string, id: string) {
  if (!id.startsWith('starter-')) await supabase.from('identity_policies').delete().eq('id', id).eq('workspace_id', workspaceId);
  if (typeof window !== 'undefined') {
    const current = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]') as IdentityPolicyRecord[];
    localStorage.setItem(LOCAL_KEY, JSON.stringify(current.filter((item) => item.id !== id)));
  }
}
