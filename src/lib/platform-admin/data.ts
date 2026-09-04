import 'server-only';

import { createServiceClient } from '@/lib/supabase/server';

type ServiceClient = ReturnType<typeof createServiceClient>;

export type PlatformMetric = {
  label: string;
  value: number;
  tone: 'blue' | 'green' | 'amber' | 'red' | 'slate';
  detail: string;
};

export type PlatformRow = Record<string, string | number | boolean | null>;

export type PlatformOrganizationDetail = {
  summary: PlatformRow;
  members: PlatformRow[];
  subscriptions: PlatformRow[];
  controls: PlatformRow | null;
};

export type PlatformUserDetail = {
  profile: PlatformRow;
  memberships: PlatformRow[];
  security: PlatformRow;
  controls: PlatformRow | null;
};

async function countRows(service: ServiceClient, table: string) {
  const result = await service.from(table).select('*', { count: 'exact', head: true });
  return result.error ? null : (result.count ?? 0);
}

async function countMatching(
  service: ServiceClient,
  table: string,
  column: string,
  value: string | boolean
) {
  const result = await service
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq(column, value);
  return result.error ? null : (result.count ?? 0);
}

function metric(
  label: string,
  value: number | null,
  tone: PlatformMetric['tone'],
  detail: string
): PlatformMetric {
  return {
    label,
    value: value ?? 0,
    tone,
    detail: value === null ? 'Fuente aún no disponible' : detail,
  };
}

export async function loadPlatformOverview(service = createServiceClient()) {
  const [
    organizations,
    users,
    activeUsers,
    documents,
    completedDocuments,
    certifications,
    timestamps,
    nom151,
    encryptedArtifacts,
    activeSubscriptions,
    securityFailures,
    supportRequests,
  ] = await Promise.all([
    countRows(service, 'workspaces'),
    countRows(service, 'user_profiles'),
    countMatching(service, 'user_profiles', 'is_active', true),
    countRows(service, 'documentos'),
    countMatching(service, 'documentos', 'estado', 'completado'),
    countMatching(service, 'document_certifications', 'verification_status', 'valid'),
    countMatching(service, 'timestamp_records', 'status', 'VALID'),
    countMatching(service, 'nom151_constancias_doc', 'verification_status', 'verified'),
    countMatching(service, 'document_encryption_metadata', 'status', 'active'),
    countMatching(service, 'subscriptions', 'status', 'active'),
    countMatching(service, 'document_encryption_security_events', 'result', 'failure'),
    countMatching(service, 'platform_support_access_requests', 'status', 'pending'),
  ]);

  return {
    metrics: [
      metric('Organizaciones', organizations, 'blue', 'Tenants registrados'),
      metric('Usuarios activos', activeUsers, 'green', `${users ?? 0} usuarios totales`),
      metric('Documentos', documents, 'slate', `${completedDocuments ?? 0} completados`),
      metric('PAdES verificados', certifications, 'green', 'Evidencia criptográfica válida'),
      metric('Sellos RFC 3161', timestamps, 'blue', 'Tokens TSA válidos'),
      metric('Constancias NOM-151', nom151, 'green', 'Constancias verificadas'),
      metric('Artefactos cifrados', encryptedArtifacts, 'blue', 'Metadatos activos AES-256-GCM'),
      metric('Suscripciones activas', activeSubscriptions, 'slate', 'Estado comercial vigente'),
      metric('Fallos de seguridad', securityFailures, 'red', 'Eventos de cifrado fallidos'),
      metric('Accesos por aprobar', supportRequests, 'amber', 'Solicitudes asistidas pendientes'),
    ],
    generatedAt: new Date().toISOString(),
  };
}

export async function loadOrganizations(service = createServiceClient()): Promise<PlatformRow[]> {
  const result = await service
    .from('workspaces')
    .select('id,name,workspace_type,organization_enabled,verification_status,created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (result.error) return [];
  return (result.data ?? []) as PlatformRow[];
}

export async function loadOrganizationDetail(
  workspaceId: string,
  service = createServiceClient()
): Promise<PlatformOrganizationDetail | null> {
  const [workspace, members, subscriptions, controls] = await Promise.all([
    service
      .from('workspaces')
      .select(
        'id,name,workspace_type,owner_id,organization_enabled,legal_name,trade_name,rfc,industry,contact_email,timezone,locale,currency,verification_status,kyb_status,created_at,updated_at'
      )
      .eq('id', workspaceId)
      .maybeSingle(),
    service
      .from('workspace_members')
      .select(
        'id,user_id,role,status,job_title,mfa_required,biometric_required,last_access_at,joined_at'
      )
      .eq('workspace_id', workspaceId)
      .order('joined_at', { ascending: true }),
    service
      .from('subscriptions')
      .select('id,status,documents_used,documents_limit,current_period_end,created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false }),
    service
      .from('platform_organization_controls')
      .select('workspace_id,lifecycle_status,reason,changed_at,version')
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
  ]);

  if (workspace.error || !workspace.data) return null;
  return {
    summary: workspace.data as PlatformRow,
    members: members.error ? [] : ((members.data ?? []) as PlatformRow[]),
    subscriptions: subscriptions.error ? [] : ((subscriptions.data ?? []) as PlatformRow[]),
    controls: controls.error ? null : (controls.data as PlatformRow | null),
  };
}

export async function loadUsers(service = createServiceClient()): Promise<PlatformRow[]> {
  const result = await service
    .from('user_profiles')
    .select('id,full_name,email,is_active,created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (result.error) return [];
  return (result.data ?? []) as PlatformRow[];
}

export async function loadUserDetail(
  userId: string,
  service = createServiceClient()
): Promise<PlatformUserDetail | null> {
  const [profile, memberships, controls, passkeys, totp] = await Promise.all([
    service
      .from('user_profiles')
      .select('id,full_name,email,phone,is_active,created_at,updated_at')
      .eq('id', userId)
      .maybeSingle(),
    service
      .from('workspace_members')
      .select('id,workspace_id,role,status,job_title,last_access_at,joined_at')
      .eq('user_id', userId)
      .order('joined_at', { ascending: true }),
    service
      .from('platform_user_controls')
      .select('user_id,access_status,reason,changed_at,version')
      .eq('user_id', userId)
      .maybeSingle(),
    service
      .from('webauthn_credentials')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_active', true),
    service
      .from('user_totp_settings')
      .select('id')
      .eq('user_id', userId)
      .eq('is_enabled', true)
      .not('confirmed_at', 'is', null)
      .limit(1)
      .maybeSingle(),
  ]);

  if (profile.error || !profile.data) return null;
  return {
    profile: profile.data as PlatformRow,
    memberships: memberships.error ? [] : ((memberships.data ?? []) as PlatformRow[]),
    security: {
      totp_enrolled: !totp.error && Boolean(totp.data),
      active_passkeys: passkeys.error ? 0 : (passkeys.count ?? 0),
    },
    controls: controls.error ? null : (controls.data as PlatformRow | null),
  };
}

export async function loadSubscriptions(service = createServiceClient()): Promise<PlatformRow[]> {
  const result = await service
    .from('subscriptions')
    .select('id,workspace_id,status,documents_used,documents_limit,current_period_end,created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (result.error) return [];
  return (result.data ?? []) as PlatformRow[];
}

export async function loadPlans(service = createServiceClient()): Promise<PlatformRow[]> {
  const result = await service
    .from('subscription_plans')
    .select('id,name,slug,price,interval,documents_included,is_active,created_at')
    .order('price', { ascending: true })
    .limit(100);
  if (result.error) return [];
  return (result.data ?? []) as PlatformRow[];
}

export async function loadUsage(service = createServiceClient()): Promise<PlatformRow[]> {
  const result = await service
    .from('organization_usage_ledger')
    .select('id,workspace_id,metric_key,quantity,unit,source_type,occurred_at')
    .order('occurred_at', { ascending: false })
    .limit(100);
  if (result.error) return [];
  return (result.data ?? []) as PlatformRow[];
}

export async function loadDocuments(service = createServiceClient()): Promise<PlatformRow[]> {
  const [documentsResult, encryptionResult] = await Promise.all([
    service
      .from('documentos')
      .select('id,documento_id,workspace_id,estado,file_size,file_hash_sha256,created_at')
      .order('created_at', { ascending: false })
      .limit(100),
    service
      .from('document_encryption_metadata')
      .select('document_id,status,encryption_algorithm,kms_provider,kms_key_version,encrypted_at')
      .eq('status', 'active')
      .limit(500),
  ]);
  if (documentsResult.error) return [];

  const encryptionByDocument = new Map<string, Record<string, unknown>>();
  if (!encryptionResult.error) {
    for (const record of encryptionResult.data ?? []) {
      if (!encryptionByDocument.has(record.document_id)) {
        encryptionByDocument.set(record.document_id, record);
      }
    }
  }

  return (documentsResult.data ?? []).map((document) => {
    const encryption = encryptionByDocument.get(document.id);
    return {
      id: document.id,
      documento_id: document.documento_id,
      workspace_id: document.workspace_id,
      estado: document.estado,
      file_size: document.file_size,
      file_hash_sha256: document.file_hash_sha256,
      cifrado: encryption ? 'AES-256-GCM' : 'Sin evidencia activa',
      kms_version:
        typeof encryption?.kms_key_version === 'string' ? encryption.kms_key_version : null,
      created_at: document.created_at,
    };
  });
}

export async function loadCertifications(service = createServiceClient()): Promise<PlatformRow[]> {
  const result = await service
    .from('document_certifications')
    .select(
      'id,document_id,tenant_id,status,pades_profile,certificate_status,timestamp_status,verification_status,created_at,completed_at'
    )
    .order('created_at', { ascending: false })
    .limit(100);
  if (result.error) return [];
  return (result.data ?? []) as PlatformRow[];
}

export async function loadTimestamps(service = createServiceClient()): Promise<PlatformRow[]> {
  const result = await service
    .from('timestamp_records')
    .select('id,tenant_id,status,standard,gen_time,tsa_name,tsa_policy_oid,verified_at,created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (result.error) return [];
  return (result.data ?? []) as PlatformRow[];
}

export async function loadNom151(service = createServiceClient()): Promise<PlatformRow[]> {
  const result = await service
    .from('nom151_constancias_doc')
    .select(
      'id,documento_id,status,verification_status,provider,environment,production_trusted,psc_name,nubarium_codigo_validacion,created_at'
    )
    .order('created_at', { ascending: false })
    .limit(100);
  if (result.error) return [];
  return (result.data ?? []) as PlatformRow[];
}

export async function loadSecurityEvents(service = createServiceClient()): Promise<PlatformRow[]> {
  const result = await service
    .from('auth_security_events')
    .select('id,user_id,event_type,description,ip_address,created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (result.error) return [];
  return (result.data ?? []) as PlatformRow[];
}

export async function loadAuditEvents(service = createServiceClient()): Promise<PlatformRow[]> {
  const result = await service
    .from('platform_audit_events')
    .select(
      'id,actor_user_id,actor_role,action,entity_type,entity_id,workspace_id,correlation_id,risk_level,justification,outcome,occurred_at'
    )
    .order('occurred_at', { ascending: false })
    .limit(100);
  if (result.error) return [];
  return (result.data ?? []) as PlatformRow[];
}

export async function loadSupportAccess(service = createServiceClient()): Promise<PlatformRow[]> {
  const result = await service
    .from('platform_support_access_requests')
    .select(
      'id,requester_user_id,workspace_id,ticket_reference,reason,requested_permissions,status,approved_by,starts_at,expires_at,created_at'
    )
    .order('created_at', { ascending: false })
    .limit(100);
  if (result.error) return [];
  return (result.data ?? []).map((row) => ({
    ...row,
    requested_permissions: Array.isArray(row.requested_permissions)
      ? row.requested_permissions.join(', ')
      : '',
  })) as PlatformRow[];
}

export async function loadStaff(service = createServiceClient()): Promise<PlatformRow[]> {
  const result = await service
    .from('platform_staff')
    .select('user_id,status,requires_step_up,valid_until,created_at,platform_roles(role_key,name)')
    .order('created_at', { ascending: false })
    .limit(100);
  if (result.error) return [];
  return (result.data ?? []).map((row) => {
    const role = Array.isArray(row.platform_roles) ? row.platform_roles[0] : row.platform_roles;
    return {
      user_id: row.user_id,
      status: row.status,
      role: role && typeof role === 'object' && 'role_key' in role ? role.role_key : null,
      requires_step_up: row.requires_step_up,
      valid_until: row.valid_until,
      created_at: row.created_at,
    };
  }) as PlatformRow[];
}

export async function loadRoles(service = createServiceClient()): Promise<PlatformRow[]> {
  const result = await service
    .from('platform_roles')
    .select('id,role_key,name,description,is_system,created_at')
    .order('role_key', { ascending: true })
    .limit(100);
  if (result.error) return [];
  return (result.data ?? []) as PlatformRow[];
}

export async function loadFeatureFlags(service = createServiceClient()): Promise<PlatformRow[]> {
  const result = await service
    .from('platform_feature_flags')
    .select('flag_key,name,global_enabled,rollout_percentage,allowed_plans,updated_at')
    .order('flag_key', { ascending: true })
    .limit(100);
  if (result.error) return [];
  return (result.data ?? []).map((row) => ({
    ...row,
    allowed_plans: Array.isArray(row.allowed_plans) ? row.allowed_plans.join(', ') : '',
  })) as PlatformRow[];
}

export async function loadProviders(service = createServiceClient()): Promise<PlatformRow[]> {
  const result = await service
    .from('platform_provider_registry')
    .select(
      'provider_key,display_name,category,environment,status,health_status,capabilities,last_health_check_at,updated_at'
    )
    .order('category', { ascending: true })
    .limit(100);
  if (result.error) return [];
  return (result.data ?? []).map((row) => ({
    ...row,
    capabilities: Array.isArray(row.capabilities) ? row.capabilities.join(', ') : '',
  })) as PlatformRow[];
}

export async function loadSupportTickets(service = createServiceClient()): Promise<PlatformRow[]> {
  const result = await service
    .from('platform_support_tickets')
    .select(
      'id,ticket_reference,workspace_id,requester_user_id,assignee_user_id,subject,status,priority,sla_due_at,created_at'
    )
    .order('created_at', { ascending: false })
    .limit(100);
  if (result.error) return [];
  return (result.data ?? []) as PlatformRow[];
}

export async function loadIncidents(service = createServiceClient()): Promise<PlatformRow[]> {
  const result = await service
    .from('platform_incidents')
    .select(
      'id,incident_reference,title,provider_key,status,severity,affected_services,started_at,resolved_at'
    )
    .order('started_at', { ascending: false })
    .limit(100);
  if (result.error) return [];
  return (result.data ?? []).map((row) => ({
    ...row,
    affected_services: Array.isArray(row.affected_services) ? row.affected_services.join(', ') : '',
  })) as PlatformRow[];
}

export async function loadPermissions(service = createServiceClient()): Promise<PlatformRow[]> {
  const result = await service
    .from('platform_permissions')
    .select('permission_key,name,module,description,created_at')
    .order('module', { ascending: true })
    .order('permission_key', { ascending: true })
    .limit(250);
  if (result.error) return [];
  return (result.data ?? []) as PlatformRow[];
}

export async function loadApprovals(service = createServiceClient()): Promise<PlatformRow[]> {
  const result = await service
    .from('platform_admin_approvals')
    .select(
      'id,action_key,resource_type,resource_id,workspace_id,requested_by,status,approved_by,executed_by,expires_at,created_at'
    )
    .order('created_at', { ascending: false })
    .limit(100);
  if (result.error) return [];
  return (result.data ?? []) as PlatformRow[];
}

export async function loadSystemJobs(service = createServiceClient()): Promise<PlatformRow[]> {
  const result = await service
    .from('platform_system_jobs')
    .select(
      'id,job_type,workspace_id,correlation_id,status,attempt,max_attempts,provider_key,error_code,queued_at,started_at,completed_at,next_attempt_at'
    )
    .order('queued_at', { ascending: false })
    .limit(100);
  if (result.error) return [];
  return (result.data ?? []) as PlatformRow[];
}

export async function loadDeadLetterJobs(service = createServiceClient()): Promise<PlatformRow[]> {
  const result = await service
    .from('platform_dead_letter_jobs')
    .select(
      'id,job_id,first_failed_at,last_failed_at,attempts,error_code,error_summary,status,resolved_by,resolved_at,created_at'
    )
    .order('created_at', { ascending: false })
    .limit(100);
  if (result.error) return [];
  return (result.data ?? []) as PlatformRow[];
}

export async function loadKmsKeys(service = createServiceClient()): Promise<PlatformRow[]> {
  const result = await service
    .from('platform_kms_keys_metadata')
    .select(
      'id,provider_key,environment,location,key_ring,key_name,key_version,protection_level,algorithm,public_key_fingerprint_sha256,status,last_verified_at,last_rotated_at,next_rotation_at'
    )
    .order('environment', { ascending: true })
    .order('key_name', { ascending: true })
    .limit(100);
  if (result.error) return [];
  return (result.data ?? []) as PlatformRow[];
}

export async function loadCertificates(service = createServiceClient()): Promise<PlatformRow[]> {
  const result = await service
    .from('platform_certificate_registry')
    .select(
      'id,certificate_type,provider_key,environment,subject_dn,issuer_dn,serial_number,fingerprint_sha256,algorithm,not_before,not_after,trust_status,last_verified_at'
    )
    .order('not_after', { ascending: true })
    .limit(100);
  if (result.error) return [];
  return (result.data ?? []) as PlatformRow[];
}

export async function loadTrustBundles(service = createServiceClient()): Promise<PlatformRow[]> {
  const result = await service
    .from('platform_trust_bundles')
    .select('id,bundle_key,version,provider_key,environment,status,validated_at,created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (result.error) return [];
  return (result.data ?? []) as PlatformRow[];
}

export async function loadBackups(service = createServiceClient()): Promise<PlatformRow[]> {
  const result = await service
    .from('platform_backup_runs')
    .select(
      'id,backup_type,environment,status,size_bytes,retention_until,started_at,completed_at,verified_at'
    )
    .order('started_at', { ascending: false })
    .limit(100);
  if (result.error) return [];
  return (result.data ?? []) as PlatformRow[];
}

export async function loadRestoreTests(service = createServiceClient()): Promise<PlatformRow[]> {
  const result = await service
    .from('platform_restore_tests')
    .select('id,backup_run_id,environment,status,rpo_seconds,rto_seconds,started_at,completed_at')
    .order('started_at', { ascending: false })
    .limit(100);
  if (result.error) return [];
  return (result.data ?? []) as PlatformRow[];
}

export async function loadLegalHolds(service = createServiceClient()): Promise<PlatformRow[]> {
  const result = await service
    .from('platform_legal_holds')
    .select(
      'id,workspace_id,resource_type,resource_id,authority,status,starts_at,expires_at,created_by,created_at'
    )
    .order('created_at', { ascending: false })
    .limit(100);
  if (result.error) return [];
  return (result.data ?? []) as PlatformRow[];
}

export async function loadPrivacyRequests(service = createServiceClient()): Promise<PlatformRow[]> {
  const result = await service
    .from('platform_privacy_requests')
    .select(
      'id,request_reference,workspace_id,request_type,status,legal_hold_checked,assigned_to,due_at,completed_at,created_at'
    )
    .order('created_at', { ascending: false })
    .limit(100);
  if (result.error) return [];
  return (result.data ?? []) as PlatformRow[];
}

export async function loadIdentityVerifications(
  service = createServiceClient()
): Promise<PlatformRow[]> {
  const result = await service
    .from('identity_verification_sessions')
    .select(
      'id,workspace_id,status,decision,assurance_level,risk_level,provider,manual_review_required,started_at,completed_at,expires_at,created_at'
    )
    .order('created_at', { ascending: false })
    .limit(100);
  if (result.error) return [];
  return (result.data ?? []) as PlatformRow[];
}

export async function loadPasskeyPosture(service = createServiceClient()): Promise<PlatformRow[]> {
  const result = await service
    .from('webauthn_credentials')
    .select(
      'id,user_id,device_type,device_name,device_category,os,browser,context,registered_from,is_active,created_at,last_used_at'
    )
    .order('created_at', { ascending: false })
    .limit(100);
  if (result.error) return [];
  return (result.data ?? []) as PlatformRow[];
}
