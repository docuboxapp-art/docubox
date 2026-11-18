export type CatalogField = {
  key: string;
  label: string;
  type?:
    'text' | 'email' | 'number' | 'date' | 'textarea' | 'checkbox' | 'select' | 'list' | 'relation';
  required?: boolean;
  choices?: string[];
  relation?:
    'members' | 'units' | 'people' | 'certificates' | 'workflows' | 'policies' | 'evidence';
  min?: number;
  max?: number;
};
type CatalogDefinition = {
  table: string;
  title: string;
  permission: string;
  create?: boolean;
  sensitive?: boolean;
  fields: CatalogField[];
  statuses?: string[];
  versioned?: boolean;
};
export const organizationCatalogs: Record<string, CatalogDefinition> = {
  directory: {
    table: 'organization_directory_people',
    title: 'Persona del directorio',
    permission: 'directory',
    create: true,
    fields: [
      { key: 'full_name', label: 'Nombre completo', required: true },
      { key: 'email', label: 'Correo', type: 'email' },
      { key: 'phone', label: 'Teléfono' },
      {
        key: 'person_type',
        label: 'Tipo de persona',
        type: 'select',
        choices: ['individual', 'legal_entity'],
        required: true,
      },
      {
        key: 'relationship_type',
        label: 'Relación',
        type: 'select',
        choices: ['collaborator', 'representative', 'attorney', 'authorized_signer'],
        required: true,
      },
      { key: 'job_title', label: 'Cargo' },
      { key: 'area_name', label: 'Área' },
      { key: 'member_id', label: 'Miembro vinculado', type: 'relation', relation: 'members' },
      { key: 'valid_from', label: 'Vigente desde', type: 'date' },
      { key: 'valid_until', label: 'Vigente hasta', type: 'date' },
    ],
    statuses: ['active', 'inactive'],
  },
  authorities: {
    table: 'organization_authorities',
    title: 'Facultad de firma',
    permission: 'authorities',
    create: true,
    sensitive: true,
    fields: [
      { key: 'person_id', label: 'Persona', type: 'relation', relation: 'people', required: true },
      { key: 'authority_type', label: 'Tipo de facultad', required: true },
      {
        key: 'modality',
        label: 'Modalidad',
        type: 'select',
        choices: ['individual', 'joint', 'several'],
        required: true,
      },
      { key: 'legal_basis', label: 'Fundamento', type: 'textarea' },
      { key: 'evidence_id', label: 'Evidencia validada', type: 'relation', relation: 'evidence' },
      { key: 'monetary_limit', label: 'Límite monetario', type: 'number', min: 0 },
      { key: 'currency', label: 'Moneda', required: true },
      { key: 'document_types', label: 'Tipos de documento (separados por coma)', type: 'list' },
      { key: 'areas', label: 'Áreas (separadas por coma)', type: 'list' },
      {
        key: 'required_representatives',
        label: 'Representantes requeridos',
        type: 'number',
        min: 1,
        max: 100,
      },
      { key: 'identity_required', label: 'Requerir identidad acreditada', type: 'checkbox' },
      { key: 'valid_from', label: 'Vigente desde', type: 'date' },
      { key: 'valid_until', label: 'Vigente hasta', type: 'date' },
    ],
    statuses: ['pending_validation', 'active', 'suspended', 'revoked'],
  },
  policies: {
    table: 'organization_signature_policies',
    title: 'Política de firma',
    permission: 'signature_policies',
    create: true,
    sensitive: true,
    versioned: true,
    fields: [
      { key: 'name', label: 'Nombre', required: true },
      { key: 'description', label: 'Descripción', type: 'textarea' },
      {
        key: 'security_level',
        label: 'Nivel de seguridad',
        type: 'select',
        choices: ['basic', 'reinforced', 'advanced', 'custom'],
        required: true,
      },
      {
        key: 'allowed_signature_types',
        label: 'Métodos de firma (separados por coma)',
        type: 'list',
        required: true,
      },
      {
        key: 'resource_scope',
        label: 'Aplicación (separada por coma)',
        type: 'list',
        choices: ['documents', 'forms', 'cases'],
      },
    ],
    statuses: ['draft', 'archived'],
  },
  resources: {
    table: 'organization_shared_resources',
    title: 'Recurso compartido',
    permission: 'resources',
    versioned: true,
    fields: [
      { key: 'name', label: 'Nombre', required: true },
      { key: 'description', label: 'Descripción', type: 'textarea' },
      { key: 'configuration', label: 'Contenido o instrucciones', type: 'textarea' },
      {
        key: 'visibility',
        label: 'Visibilidad',
        type: 'select',
        choices: ['organization', 'area', 'team', 'private'],
        required: true,
      },
      { key: 'workflow_id', label: 'Flujo de aprobación', type: 'relation', relation: 'workflows' },
      {
        key: 'signature_policy_id',
        label: 'Política de firma',
        type: 'relation',
        relation: 'policies',
      },
    ],
    statuses: ['archived'],
  },
  centers: {
    table: 'organization_cost_centers',
    title: 'Centro de costo',
    permission: 'billing',
    create: true,
    fields: [
      { key: 'code', label: 'Código', required: true },
      { key: 'name', label: 'Nombre', required: true },
      { key: 'description', label: 'Descripción', type: 'textarea' },
      { key: 'budget', label: 'Presupuesto', type: 'number', min: 0 },
      { key: 'currency', label: 'Moneda', required: true },
      {
        key: 'alert_threshold_percent',
        label: 'Umbral de alerta (%)',
        type: 'number',
        min: 1,
        max: 100,
      },
      { key: 'owner_member_id', label: 'Responsable', type: 'relation', relation: 'members' },
    ],
    statuses: ['active', 'inactive'],
  },
  templates: {
    table: 'organization_communication_templates',
    title: 'Plantilla de comunicación',
    permission: 'branding',
    create: true,
    fields: [
      { key: 'template_key', label: 'Clave', required: true },
      { key: 'name', label: 'Nombre', required: true },
      { key: 'subject', label: 'Asunto', required: true },
      { key: 'body_text', label: 'Contenido', type: 'textarea', required: true, max: 20000 },
    ],
    statuses: ['draft', 'active', 'archived'],
  },
  domains: {
    table: 'organization_sender_domains',
    title: 'Dominio remitente',
    permission: 'branding',
    fields: [
      { key: 'sender_name', label: 'Nombre del remitente' },
      { key: 'sender_email', label: 'Correo remitente', type: 'email' },
      { key: 'reply_to', label: 'Responder a', type: 'email' },
    ],
  },
  networks: {
    table: 'organization_trusted_networks',
    title: 'Red de confianza',
    permission: 'security',
    create: true,
    sensitive: true,
    fields: [
      { key: 'name', label: 'Nombre', required: true },
      { key: 'network_cidr', label: 'Red CIDR', required: true },
      { key: 'mode', label: 'Modo', type: 'select', choices: ['allow', 'block'], required: true },
    ],
    statuses: ['active', 'inactive'],
  },
  alerts: {
    table: 'organization_security_alert_rules',
    title: 'Regla de alerta',
    permission: 'security',
    create: true,
    sensitive: true,
    fields: [
      {
        key: 'event_key',
        label: 'Evento',
        type: 'select',
        choices: [
          'auth.anomaly',
          'auth.multiple_failures',
          'privilege.escalation',
          'download.bulk',
          'certificate.changed',
        ],
        required: true,
      },
      { key: 'display_name', label: 'Nombre', required: true },
      {
        key: 'severity',
        label: 'Severidad',
        type: 'select',
        choices: ['info', 'warning', 'high', 'critical'],
        required: true,
      },
      {
        key: 'channels',
        label: 'Canales (separados por coma)',
        type: 'list',
        choices: ['in_app', 'email'],
        required: true,
      },
      { key: 'recipients', label: 'Destinatarios (separados por coma)', type: 'list' },
      { key: 'enabled', label: 'Habilitada', type: 'checkbox' },
    ],
  },
  certificates: {
    table: 'organization_certificates',
    title: 'Certificado',
    permission: 'certificates',
    sensitive: true,
    fields: [
      { key: 'alias', label: 'Alias', required: true },
      { key: 'provider_name', label: 'Nombre del proveedor' },
    ],
    statuses: ['revoked'],
  },
  certificate_access: {
    table: 'organization_certificate_permissions',
    title: 'Permiso de certificado',
    permission: 'certificates',
    create: true,
    sensitive: true,
    fields: [
      {
        key: 'certificate_id',
        label: 'Certificado',
        type: 'relation',
        relation: 'certificates',
        required: true,
      },
      { key: 'member_id', label: 'Miembro', type: 'relation', relation: 'members' },
      { key: 'unit_id', label: 'Equipo o área', type: 'relation', relation: 'units' },
      { key: 'document_types', label: 'Tipos de documento (separados por coma)', type: 'list' },
      { key: 'amount_limit', label: 'Límite monetario', type: 'number', min: 0 },
    ],
  },
  integrations: {
    table: 'organization_integrations',
    title: 'Integración',
    permission: 'integrations',
    sensitive: true,
    fields: [{ key: 'display_name', label: 'Nombre', required: true }],
    statuses: ['disabled', 'not_configured'],
  },
};

export const organizationValueLabels: Record<string, string> = {
  individual: 'Individual',
  legal_entity: 'Persona moral',
  collaborator: 'Colaborador',
  representative: 'Representante',
  attorney: 'Apoderado',
  authorized_signer: 'Firmante autorizado',
  joint: 'Mancomunada',
  several: 'Indistinta',
  basic: 'Básico',
  reinforced: 'Reforzado',
  custom: 'Personalizado',
  area: 'Área',
  team: 'Equipo',
  'auth.anomaly': 'Acceso inusual',
  'auth.multiple_failures': 'Múltiples intentos fallidos',
  'privilege.escalation': 'Cambio de roles y permisos',
  'download.bulk': 'Exportación masiva de auditoría',
  'certificate.changed': 'Cambio de certificado',
  advanced: 'Avanzado',
  qualified: 'Cualificado',
  organization: 'Organización',
  units: 'Equipos',
  private: 'Privado',
  active: 'Activo',
  inactive: 'Inactivo',
  draft: 'Borrador',
  archived: 'Archivado',
  pending_validation: 'Pendiente de validación',
  suspended: 'Suspendido',
  revoked: 'Revocado',
  allow: 'Permitir',
  block: 'Bloquear',
  info: 'Informativa',
  warning: 'Advertencia',
  high: 'Alta',
  critical: 'Crítica',
  disabled: 'Deshabilitada',
  not_configured: 'Pendiente de configurar',
};
