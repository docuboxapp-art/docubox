import { notFound } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import DataTable from '@/components/platform-admin/PlatformDataTable';
import { getCurrentPlatformAccess, hasPlatformPermission } from '@/lib/platform-admin/access';
import {
  loadAuditEvents,
  loadApprovals,
  loadBackups,
  loadCertifications,
  loadCertificates,
  loadDeadLetterJobs,
  loadDocuments,
  loadFeatureFlags,
  loadIdentityVerifications,
  loadIncidents,
  loadKmsKeys,
  loadLegalHolds,
  loadNom151,
  loadOrganizationDetail,
  loadOrganizations,
  loadPasskeyPosture,
  loadPermissions,
  loadPlans,
  loadPlatformOverview,
  loadPrivacyRequests,
  loadProviders,
  loadRestoreTests,
  loadRoles,
  loadSecurityEvents,
  loadStaff,
  loadSubscriptions,
  loadSupportAccess,
  loadSupportTickets,
  loadSystemJobs,
  loadTimestamps,
  loadTrustBundles,
  loadUsage,
  loadUserDetail,
  loadUsers,
  type PlatformMetric,
} from '@/lib/platform-admin/data';
import { findPlatformNavItem } from '@/lib/platform-admin/navigation';

type PageProps = { params: Promise<{ section?: string[] }> };

const moduleCopy: Record<string, { title: string; description: string }> = {
  '': {
    title: 'Resumen de plataforma',
    description: 'Estado agregado de la operación de Docubox.',
  },
  'clientes/organizaciones': {
    title: 'Organizaciones',
    description: 'Tenants, estado y alta en plataforma.',
  },
  'clientes/usuarios': {
    title: 'Usuarios',
    description: 'Directorio de cuentas y estado de acceso.',
  },
  'clientes/actividad': {
    title: 'Actividad de clientes',
    description: 'Eventos administrativos recientes.',
  },
  'comercial/planes': { title: 'Planes', description: 'Catálogo comercial y límites base.' },
  'comercial/suscripciones': {
    title: 'Suscripciones',
    description: 'Vigencia y consumo documental contratado.',
  },
  'comercial/consumos': {
    title: 'Centro de consumo',
    description: 'Uso medido por organización y servicio.',
  },
  'comercial/promociones': { title: 'Promociones', description: 'Reglas comerciales vigentes.' },
  finanzas: { title: 'Finanzas', description: 'Indicadores financieros disponibles.' },
  'finanzas/transacciones': {
    title: 'Transacciones',
    description: 'Movimientos procesados por proveedores de pago.',
  },
  'finanzas/facturacion': { title: 'Facturación', description: 'Facturas y estado fiscal.' },
  'finanzas/conciliacion': {
    title: 'Conciliación',
    description: 'Cruce de movimientos y liquidaciones.',
  },
  'finanzas/reembolsos': {
    title: 'Reembolsos',
    description: 'Solicitudes y resoluciones financieras.',
  },
  'finanzas/creditos': { title: 'Créditos', description: 'Saldos y ajustes autorizados.' },
  'operacion/documentos': {
    title: 'Operación documental',
    description: 'Metadata técnica; el contenido permanece protegido.',
  },
  'operacion/firmas': { title: 'Firmas', description: 'Resultado agregado de procesos de firma.' },
  'operacion/pades-tsa': {
    title: 'PAdES / TSA',
    description: 'Evidencia de firma y sellado de tiempo.',
  },
  'operacion/nom151': {
    title: 'NOM-151',
    description: 'Constancias, verificación y entorno del proveedor.',
  },
  'operacion/identidad': {
    title: 'Identidad',
    description: 'Operación de verificaciones de identidad.',
  },
  'operacion/almacenamiento': {
    title: 'Almacenamiento',
    description: 'Cifrado y estado de artefactos.',
  },
  'soporte/tickets': { title: 'Tickets', description: 'Casos de soporte y SLA.' },
  'soporte/diagnostico': { title: 'Diagnóstico', description: 'Correlación de eventos técnicos.' },
  'soporte/acceso-asistido': {
    title: 'Acceso asistido',
    description: 'Solicitudes temporales, aprobadas y auditadas.',
  },
  'soporte/incidencias': {
    title: 'Incidencias',
    description: 'Afectaciones operativas y seguimiento.',
  },
  'comunicaciones/email': { title: 'Email', description: 'Entregas, rebotes y errores.' },
  'comunicaciones/sms': { title: 'SMS', description: 'Entregas y consumo del canal.' },
  'comunicaciones/whatsapp': { title: 'WhatsApp', description: 'Entregas y consumo del canal.' },
  'comunicaciones/plantillas': {
    title: 'Plantillas',
    description: 'Versiones transaccionales globales.',
  },
  'integraciones/proveedores': {
    title: 'Proveedores',
    description: 'Estado operativo sin exposición de credenciales.',
  },
  'integraciones/apis': { title: 'APIs', description: 'Clientes, límites y consumo.' },
  'integraciones/webhooks': { title: 'Webhooks', description: 'Entregas y reintentos.' },
  'integraciones/logs': {
    title: 'Logs de integración',
    description: 'Resultados sanitizados por correlación.',
  },
  'seguridad/eventos': {
    title: 'Eventos de seguridad',
    description: 'Acciones e intentos relevantes.',
  },
  'seguridad/accesos': { title: 'Accesos', description: 'Postura de acceso privilegiado.' },
  'seguridad/sesiones': { title: 'Sesiones', description: 'Actividad y revocaciones.' },
  'seguridad/kms-hsm': {
    title: 'KMS / HSM',
    description: 'Evidencia de protección criptográfica.',
  },
  'seguridad/cifrado': { title: 'Cifrado', description: 'Cobertura de artefactos cifrados.' },
  'seguridad/alertas': { title: 'Alertas', description: 'Eventos que requieren atención.' },
  analitica: { title: 'Analítica', description: 'Uso agregado de producto y operación.' },
  auditoria: { title: 'Auditoría', description: 'Bitácora administrativa append-only.' },
  'administracion/equipo': {
    title: 'Equipo interno',
    description: 'Personal de plataforma separado de usuarios cliente.',
  },
  'administracion/roles': {
    title: 'Roles y permisos',
    description: 'Acceso interno basado en permisos.',
  },
  'administracion/feature-flags': {
    title: 'Feature Flags',
    description: 'Capacidades globales, por plan y por tenant.',
  },
  'administracion/configuracion': {
    title: 'Configuración global',
    description: 'Políticas operativas de plataforma.',
  },
  'administracion/estado': {
    title: 'Estado del sistema',
    description: 'Resumen de fuentes y servicios.',
  },
};

const canonicalModuleKeys: Record<string, string> = {
  organizations: 'clientes/organizaciones',
  users: 'clientes/usuarios',
  plans: 'producto/planes',
  subscriptions: 'finanzas/suscripciones',
  usage: 'consumos',
  finance: 'finanzas',
  documents: 'operacion/documentos',
  storage: 'operacion/almacenamiento',
  jobs: 'operacion/jobs',
  dlq: 'operacion/dlq',
  signatures: 'firma-certificacion/firmas',
  'signatures/efirma': 'firma-certificacion/efirma',
  'signatures/autograph': 'firma-certificacion/autografa',
  'signatures/pades': 'firma-certificacion/pades',
  'signatures/tsa': 'firma-certificacion/tsa',
  'signatures/nom151': 'firma-certificacion/nom151',
  integrity: 'operacion/documentos',
  identity: 'identidad/verificaciones',
  'identity/ocr': 'identidad/ocr',
  'identity/liveness': 'identidad/prueba-vida',
  'identity/passkeys': 'identidad/passkeys',
  'support/tickets': 'soporte/tickets',
  'support/access': 'soporte/acceso-asistido',
  incidents: 'soporte/incidencias',
  providers: 'integraciones/proveedores',
  security: 'seguridad',
  'security/events': 'seguridad/eventos',
  'security/kms': 'seguridad/kms-hsm',
  'security/encryption': 'seguridad/cifrado',
  alerts: 'seguridad/alertas',
  system: 'infraestructura',
  'system/services': 'infraestructura/servicios',
  'system/jobs': 'infraestructura/jobs',
  'system/dlq': 'infraestructura/dlq',
  'system/backups': 'infraestructura/backups',
  audit: 'auditoria',
  staff: 'administracion/equipo',
  roles: 'administracion/roles',
  approvals: 'administracion/aprobaciones',
};

function MetricCard({ metric }: { metric: PlatformMetric }) {
  const accents = {
    blue: 'border-l-blue-500',
    green: 'border-l-emerald-500',
    amber: 'border-l-amber-500',
    red: 'border-l-red-500',
    slate: 'border-l-slate-400',
  };
  return (
    <div
      className={`rounded-lg border border-l-4 border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#121418] ${accents[metric.tone]}`}
    >
      <p className="text-xs font-medium text-slate-500">{metric.label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums">
        {new Intl.NumberFormat('es-MX').format(metric.value)}
      </p>
      <p className="mt-1 truncate text-xs text-slate-500" title={metric.detail}>
        {metric.detail}
      </p>
    </div>
  );
}

function UnavailableSource() {
  return (
    <section className="border border-amber-200 bg-amber-50 px-5 py-5 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <p className="text-sm font-semibold">Sin fuente operativa conectada</p>
          <p className="mt-1 max-w-3xl text-sm text-amber-800 dark:text-amber-200">
            Este módulo no publica métricas hasta contar con una fuente backend verificable y un
            permiso explícito. Docubox no genera datos de demostración ni infiere estados de salud.
          </p>
        </div>
      </div>
    </section>
  );
}

function DetailFields({ row }: { row: Record<string, string | number | boolean | null> }) {
  return (
    <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
      {Object.entries(row).map(([key, value]) => (
        <div key={key} className="min-w-0 border-b border-slate-100 pb-4 dark:border-slate-800">
          <dt className="text-xs font-medium uppercase text-slate-500">
            {key.replaceAll('_', ' ')}
          </dt>
          <dd className="mt-1 break-words text-sm text-slate-900 dark:text-slate-100">
            {value === null || value === ''
              ? '—'
              : typeof value === 'boolean'
                ? value
                  ? 'Sí'
                  : 'No'
                : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

async function renderOrganizationDetail(workspaceId: string) {
  const detail = await loadOrganizationDetail(workspaceId);
  if (!detail) notFound();
  return (
    <div className="space-y-6">
      <section className="border-y border-slate-200 bg-white px-5 py-6 dark:border-slate-800 dark:bg-[#121418]">
        <h2 className="mb-5 text-sm font-semibold">Resumen</h2>
        <DetailFields row={detail.summary} />
      </section>
      <section>
        <h2 className="mb-3 text-sm font-semibold">Usuarios</h2>
        <DataTable
          rows={detail.members}
          columns={[
            { key: 'user_id', label: 'Usuario', mono: true },
            { key: 'role', label: 'Rol' },
            { key: 'status', label: 'Estado' },
            { key: 'job_title', label: 'Puesto' },
            { key: 'last_access_at', label: 'Último acceso' },
            { key: 'joined_at', label: 'Alta' },
          ]}
          rowHrefPrefix="/panel/users"
        />
      </section>
      <section>
        <h2 className="mb-3 text-sm font-semibold">Plan y suscripción</h2>
        <DataTable
          rows={detail.subscriptions}
          columns={[
            { key: 'id', label: 'Suscripción', mono: true },
            { key: 'status', label: 'Estado' },
            { key: 'documents_used', label: 'Documentos usados' },
            { key: 'documents_limit', label: 'Límite' },
            { key: 'current_period_end', label: 'Renovación' },
          ]}
        />
      </section>
      <section className="border-y border-slate-200 bg-white px-5 py-6 dark:border-slate-800 dark:bg-[#121418]">
        <h2 className="mb-5 text-sm font-semibold">Control administrativo</h2>
        <DetailFields
          row={detail.controls ?? { lifecycle_status: 'Sin control administrativo adicional' }}
        />
      </section>
    </div>
  );
}

async function renderUserDetail(userId: string) {
  const detail = await loadUserDetail(userId);
  if (!detail) notFound();
  return (
    <div className="space-y-6">
      <section className="border-y border-slate-200 bg-white px-5 py-6 dark:border-slate-800 dark:bg-[#121418]">
        <h2 className="mb-5 text-sm font-semibold">Perfil</h2>
        <DetailFields row={detail.profile} />
      </section>
      <section className="border-y border-slate-200 bg-white px-5 py-6 dark:border-slate-800 dark:bg-[#121418]">
        <h2 className="mb-5 text-sm font-semibold">Seguridad</h2>
        <DetailFields row={detail.security} />
        <p className="mt-4 text-xs text-slate-500">
          No se muestran secretos TOTP, claves públicas, credenciales ni datos biométricos.
        </p>
      </section>
      <section>
        <h2 className="mb-3 text-sm font-semibold">Organizaciones</h2>
        <DataTable
          rows={detail.memberships}
          columns={[
            { key: 'workspace_id', label: 'Organización', mono: true },
            { key: 'role', label: 'Rol' },
            { key: 'status', label: 'Estado' },
            { key: 'job_title', label: 'Puesto' },
            { key: 'last_access_at', label: 'Último acceso' },
            { key: 'joined_at', label: 'Alta' },
          ]}
          rowHrefPrefix="/panel/organizations"
        />
      </section>
      <section className="border-y border-slate-200 bg-white px-5 py-6 dark:border-slate-800 dark:bg-[#121418]">
        <h2 className="mb-5 text-sm font-semibold">Control administrativo</h2>
        <DetailFields
          row={detail.controls ?? { access_status: 'Sin control administrativo adicional' }}
        />
      </section>
    </div>
  );
}

async function renderModule(key: string) {
  if (key.startsWith('organizations/')) {
    return renderOrganizationDetail(key.slice('organizations/'.length));
  }
  if (key.startsWith('users/')) {
    return renderUserDetail(key.slice('users/'.length));
  }
  switch (key) {
    case 'clientes/organizaciones':
      return (
        <DataTable
          rows={await loadOrganizations()}
          rowHrefPrefix="/panel/organizations"
          columns={[
            { key: 'id', label: 'Organización', mono: true },
            { key: 'name', label: 'Nombre' },
            { key: 'workspace_type', label: 'Tipo' },
            { key: 'organization_enabled', label: 'Organización' },
            { key: 'verification_status', label: 'Verificación' },
            { key: 'created_at', label: 'Alta' },
          ]}
        />
      );
    case 'clientes/usuarios':
      return (
        <DataTable
          rows={await loadUsers()}
          rowHrefPrefix="/panel/users"
          columns={[
            { key: 'id', label: 'Usuario', mono: true },
            { key: 'full_name', label: 'Nombre' },
            { key: 'email', label: 'Email' },
            { key: 'is_active', label: 'Activo' },
            { key: 'created_at', label: 'Registro' },
          ]}
        />
      );
    case 'comercial/planes':
    case 'producto/planes':
      return (
        <DataTable
          rows={await loadPlans()}
          columns={[
            { key: 'name', label: 'Plan' },
            { key: 'slug', label: 'Clave' },
            { key: 'price', label: 'Precio' },
            { key: 'interval', label: 'Periodo' },
            { key: 'documents_included', label: 'Documentos' },
            { key: 'is_active', label: 'Activo' },
          ]}
        />
      );
    case 'comercial/suscripciones':
    case 'finanzas/suscripciones':
    case 'finanzas':
      return (
        <DataTable
          rows={await loadSubscriptions()}
          columns={[
            { key: 'id', label: 'Suscripción', mono: true },
            { key: 'workspace_id', label: 'Organización', mono: true },
            { key: 'status', label: 'Estado' },
            { key: 'documents_used', label: 'Uso' },
            { key: 'documents_limit', label: 'Límite' },
            { key: 'current_period_end', label: 'Vigencia' },
          ]}
        />
      );
    case 'comercial/consumos':
    case 'consumos':
    case 'consumos/tenant':
    case 'consumos/servicio':
    case 'consumos/proveedor':
    case 'consumos/plan':
    case 'consumos/costos':
    case 'consumos/margen':
    case 'consumos/alertas':
    case 'analitica':
    case 'analitica/producto':
    case 'analitica/clientes':
    case 'analitica/usuarios':
    case 'analitica/firmas':
    case 'analitica/documentos':
    case 'analitica/conversion':
    case 'analitica/retencion':
    case 'analitica/churn':
    case 'analitica/consumos':
    case 'analitica/costos':
      return (
        <DataTable
          rows={await loadUsage()}
          columns={[
            { key: 'workspace_id', label: 'Organización', mono: true },
            { key: 'metric_key', label: 'Métrica' },
            { key: 'quantity', label: 'Cantidad' },
            { key: 'unit', label: 'Unidad' },
            { key: 'source_type', label: 'Origen' },
            { key: 'occurred_at', label: 'Fecha' },
          ]}
        />
      );
    case 'operacion/documentos':
    case 'operacion/almacenamiento':
    case 'seguridad/cifrado':
      return (
        <DataTable
          protectedContent
          rows={await loadDocuments()}
          columns={[
            { key: 'documento_id', label: 'Documento', mono: true },
            { key: 'workspace_id', label: 'Tenant', mono: true },
            { key: 'estado', label: 'Estado' },
            { key: 'file_size', label: 'Bytes' },
            { key: 'cifrado', label: 'Cifrado' },
            { key: 'kms_version', label: 'KEK versión' },
            { key: 'file_hash_sha256', label: 'SHA-256', mono: true },
            { key: 'created_at', label: 'Fecha' },
          ]}
        />
      );
    case 'operacion/jobs':
    case 'operacion/colas':
    case 'operacion/procesos':
    case 'infraestructura/jobs':
    case 'infraestructura/colas':
    case 'infraestructura/cron':
      return (
        <DataTable
          rows={await loadSystemJobs()}
          columns={[
            { key: 'id', label: 'Job', mono: true },
            { key: 'job_type', label: 'Tipo' },
            { key: 'workspace_id', label: 'Tenant', mono: true },
            { key: 'correlation_id', label: 'Correlación', mono: true },
            { key: 'status', label: 'Estado' },
            { key: 'attempt', label: 'Intento' },
            { key: 'max_attempts', label: 'Máximo' },
            { key: 'provider_key', label: 'Proveedor' },
            { key: 'error_code', label: 'Error' },
            { key: 'queued_at', label: 'En cola' },
          ]}
        />
      );
    case 'operacion/dlq':
    case 'infraestructura/dlq':
      return (
        <DataTable
          rows={await loadDeadLetterJobs()}
          columns={[
            { key: 'id', label: 'Registro', mono: true },
            { key: 'job_id', label: 'Job', mono: true },
            { key: 'status', label: 'Estado' },
            { key: 'error_code', label: 'Error' },
            { key: 'error_summary', label: 'Resumen sanitizado' },
            { key: 'attempts', label: 'Intentos' },
            { key: 'first_failed_at', label: 'Primer fallo' },
            { key: 'last_failed_at', label: 'Último fallo' },
          ]}
        />
      );
    case 'operacion/firmas':
    case 'firma-certificacion/firmas':
    case 'firma-certificacion/efirma':
    case 'firma-certificacion/autografa':
      return (
        <DataTable
          rows={await loadCertifications()}
          columns={[
            { key: 'id', label: 'Certificación', mono: true },
            { key: 'tenant_id', label: 'Tenant', mono: true },
            { key: 'status', label: 'Proceso' },
            { key: 'pades_profile', label: 'Perfil' },
            { key: 'verification_status', label: 'Verificación' },
            { key: 'completed_at', label: 'Finalizada' },
          ]}
        />
      );
    case 'operacion/pades-tsa':
    case 'firma-certificacion/pades':
    case 'firma-certificacion/tsa': {
      const [certifications, timestamps] = await Promise.all([
        loadCertifications(),
        loadTimestamps(),
      ]);
      return (
        <div className="space-y-5">
          <DataTable
            rows={certifications}
            columns={[
              { key: 'id', label: 'Certificación', mono: true },
              { key: 'pades_profile', label: 'PAdES' },
              { key: 'certificate_status', label: 'Certificado' },
              { key: 'timestamp_status', label: 'Timestamp' },
              { key: 'verification_status', label: 'Verificación' },
            ]}
          />
          <DataTable
            rows={timestamps}
            columns={[
              { key: 'id', label: 'Timestamp', mono: true },
              { key: 'status', label: 'Estado' },
              { key: 'standard', label: 'Estándar' },
              { key: 'tsa_name', label: 'TSA' },
              { key: 'tsa_policy_oid', label: 'Policy OID', mono: true },
              { key: 'gen_time', label: 'Gen time' },
            ]}
          />
        </div>
      );
    }
    case 'operacion/nom151':
    case 'firma-certificacion/nom151':
      return (
        <DataTable
          rows={await loadNom151()}
          columns={[
            { key: 'id', label: 'Constancia', mono: true },
            { key: 'documento_id', label: 'Documento', mono: true },
            { key: 'verification_status', label: 'Verificación' },
            { key: 'provider', label: 'PSC' },
            { key: 'environment', label: 'Entorno' },
            { key: 'production_trusted', label: 'Confianza productiva' },
            { key: 'nubarium_codigo_validacion', label: 'Folio' },
            { key: 'created_at', label: 'Emisión' },
          ]}
        />
      );
    case 'firma-certificacion/certificados':
      return (
        <DataTable
          rows={await loadCertificates()}
          columns={[
            { key: 'certificate_type', label: 'Tipo' },
            { key: 'provider_key', label: 'Proveedor' },
            { key: 'environment', label: 'Entorno' },
            { key: 'subject_dn', label: 'Sujeto' },
            { key: 'serial_number', label: 'Serial', mono: true },
            { key: 'fingerprint_sha256', label: 'Fingerprint', mono: true },
            { key: 'algorithm', label: 'Algoritmo' },
            { key: 'not_after', label: 'Expira' },
            { key: 'trust_status', label: 'Confianza' },
          ]}
        />
      );
    case 'firma-certificacion/trust-bundles':
      return (
        <DataTable
          rows={await loadTrustBundles()}
          columns={[
            { key: 'bundle_key', label: 'Bundle' },
            { key: 'version', label: 'Versión' },
            { key: 'provider_key', label: 'Proveedor' },
            { key: 'environment', label: 'Entorno' },
            { key: 'status', label: 'Estado' },
            { key: 'validated_at', label: 'Validado' },
          ]}
        />
      );
    case 'identidad/verificaciones':
    case 'identidad/ine':
    case 'identidad/ocr':
    case 'identidad/prueba-vida':
      return (
        <DataTable
          rows={await loadIdentityVerifications()}
          columns={[
            { key: 'id', label: 'Verificación', mono: true },
            { key: 'workspace_id', label: 'Tenant', mono: true },
            { key: 'status', label: 'Estado' },
            { key: 'decision', label: 'Decisión' },
            { key: 'assurance_level', label: 'Aseguramiento' },
            { key: 'risk_level', label: 'Riesgo' },
            { key: 'provider', label: 'Proveedor' },
            { key: 'manual_review_required', label: 'Revisión manual' },
            { key: 'created_at', label: 'Fecha' },
          ]}
        />
      );
    case 'identidad/passkeys':
      return (
        <DataTable
          rows={await loadPasskeyPosture()}
          columns={[
            { key: 'user_id', label: 'Usuario', mono: true },
            { key: 'device_name', label: 'Dispositivo' },
            { key: 'device_type', label: 'Autenticador' },
            { key: 'device_category', label: 'Categoría' },
            { key: 'os', label: 'SO' },
            { key: 'browser', label: 'Navegador' },
            { key: 'is_active', label: 'Activo' },
            { key: 'last_used_at', label: 'Último uso' },
          ]}
        />
      );
    case 'seguridad/eventos':
    case 'seguridad':
    case 'seguridad/alertas':
      return (
        <DataTable
          rows={await loadSecurityEvents()}
          columns={[
            { key: 'id', label: 'Evento', mono: true },
            { key: 'event_type', label: 'Tipo' },
            { key: 'user_id', label: 'Usuario', mono: true },
            { key: 'description', label: 'Descripción' },
            { key: 'ip_address', label: 'IP' },
            { key: 'created_at', label: 'Fecha' },
          ]}
        />
      );
    case 'seguridad/kms-hsm':
    case 'seguridad/llaves':
    case 'seguridad/rotaciones':
      return (
        <DataTable
          rows={await loadKmsKeys()}
          columns={[
            { key: 'provider_key', label: 'Proveedor' },
            { key: 'environment', label: 'Entorno' },
            { key: 'location', label: 'Ubicación' },
            { key: 'key_ring', label: 'Key ring' },
            { key: 'key_name', label: 'Llave' },
            { key: 'key_version', label: 'Versión' },
            { key: 'protection_level', label: 'Protección' },
            { key: 'algorithm', label: 'Algoritmo' },
            { key: 'status', label: 'Estado' },
            { key: 'next_rotation_at', label: 'Próxima rotación' },
          ]}
        />
      );
    case 'auditoria':
    case 'auditoria/administradores':
    case 'auditoria/usuarios':
    case 'auditoria/seguridad':
    case 'auditoria/configuracion':
    case 'auditoria/datos':
    case 'auditoria/exportaciones':
    case 'auditoria/accesos-privilegiados':
    case 'clientes/actividad':
      return (
        <DataTable
          rows={await loadAuditEvents()}
          columns={[
            { key: 'id', label: 'Evento', mono: true },
            { key: 'actor_user_id', label: 'Actor', mono: true },
            { key: 'actor_role', label: 'Rol' },
            { key: 'action', label: 'Acción' },
            { key: 'entity_type', label: 'Entidad' },
            { key: 'workspace_id', label: 'Tenant', mono: true },
            { key: 'risk_level', label: 'Riesgo' },
            { key: 'justification', label: 'Motivo' },
            { key: 'correlation_id', label: 'Correlación', mono: true },
            { key: 'outcome', label: 'Resultado' },
            { key: 'occurred_at', label: 'Fecha' },
          ]}
        />
      );
    case 'soporte/acceso-asistido':
      return (
        <DataTable
          rows={await loadSupportAccess()}
          columns={[
            { key: 'id', label: 'Solicitud', mono: true },
            { key: 'ticket_reference', label: 'Ticket' },
            { key: 'workspace_id', label: 'Tenant', mono: true },
            { key: 'reason', label: 'Motivo' },
            { key: 'requested_permissions', label: 'Permisos' },
            { key: 'status', label: 'Estado' },
            { key: 'expires_at', label: 'Expira' },
          ]}
        />
      );
    case 'soporte/tickets':
      return (
        <DataTable
          rows={await loadSupportTickets()}
          columns={[
            { key: 'ticket_reference', label: 'Ticket' },
            { key: 'workspace_id', label: 'Tenant', mono: true },
            { key: 'subject', label: 'Asunto' },
            { key: 'status', label: 'Estado' },
            { key: 'priority', label: 'Prioridad' },
            { key: 'assignee_user_id', label: 'Responsable', mono: true },
            { key: 'sla_due_at', label: 'SLA' },
          ]}
        />
      );
    case 'soporte/incidencias':
      return (
        <DataTable
          rows={await loadIncidents()}
          columns={[
            { key: 'incident_reference', label: 'Incidencia' },
            { key: 'title', label: 'Título' },
            { key: 'provider_key', label: 'Proveedor' },
            { key: 'status', label: 'Estado' },
            { key: 'severity', label: 'Severidad' },
            { key: 'affected_services', label: 'Servicios' },
            { key: 'started_at', label: 'Inicio' },
          ]}
        />
      );
    case 'integraciones/proveedores':
    case 'infraestructura':
    case 'infraestructura/servicios':
    case 'infraestructura/dependencias':
      return (
        <DataTable
          rows={await loadProviders()}
          columns={[
            { key: 'provider_key', label: 'Proveedor' },
            { key: 'display_name', label: 'Nombre' },
            { key: 'category', label: 'Categoría' },
            { key: 'environment', label: 'Entorno' },
            { key: 'status', label: 'Configuración' },
            { key: 'health_status', label: 'Salud' },
            { key: 'capabilities', label: 'Capacidades' },
            { key: 'last_health_check_at', label: 'Último health check' },
          ]}
        />
      );
    case 'infraestructura/backups':
      return (
        <DataTable
          rows={await loadBackups()}
          columns={[
            { key: 'id', label: 'Backup', mono: true },
            { key: 'backup_type', label: 'Tipo' },
            { key: 'environment', label: 'Entorno' },
            { key: 'status', label: 'Estado' },
            { key: 'size_bytes', label: 'Bytes' },
            { key: 'retention_until', label: 'Retención' },
            { key: 'started_at', label: 'Inicio' },
            { key: 'verified_at', label: 'Verificado' },
          ]}
        />
      );
    case 'infraestructura/restauraciones':
    case 'infraestructura/disaster-recovery':
      return (
        <DataTable
          rows={await loadRestoreTests()}
          columns={[
            { key: 'id', label: 'Prueba', mono: true },
            { key: 'backup_run_id', label: 'Backup', mono: true },
            { key: 'environment', label: 'Entorno' },
            { key: 'status', label: 'Estado' },
            { key: 'rpo_seconds', label: 'RPO (s)' },
            { key: 'rto_seconds', label: 'RTO (s)' },
            { key: 'started_at', label: 'Inicio' },
            { key: 'completed_at', label: 'Fin' },
          ]}
        />
      );
    case 'cumplimiento/legal-hold':
      return (
        <DataTable
          rows={await loadLegalHolds()}
          columns={[
            { key: 'id', label: 'Legal hold', mono: true },
            { key: 'workspace_id', label: 'Tenant', mono: true },
            { key: 'resource_type', label: 'Recurso' },
            { key: 'resource_id', label: 'ID', mono: true },
            { key: 'authority', label: 'Autoridad' },
            { key: 'status', label: 'Estado' },
            { key: 'starts_at', label: 'Inicio' },
            { key: 'expires_at', label: 'Expira' },
          ]}
        />
      );
    case 'cumplimiento/arco':
    case 'cumplimiento/exportacion-datos':
    case 'cumplimiento/eliminacion-datos':
      return (
        <DataTable
          rows={await loadPrivacyRequests()}
          columns={[
            { key: 'request_reference', label: 'Solicitud' },
            { key: 'workspace_id', label: 'Tenant', mono: true },
            { key: 'request_type', label: 'Tipo' },
            { key: 'status', label: 'Estado' },
            { key: 'legal_hold_checked', label: 'Legal hold revisado' },
            { key: 'assigned_to', label: 'Responsable', mono: true },
            { key: 'due_at', label: 'Vence' },
            { key: 'created_at', label: 'Alta' },
          ]}
        />
      );
    case 'administracion/equipo':
      return (
        <DataTable
          rows={await loadStaff()}
          columns={[
            { key: 'user_id', label: 'Usuario interno', mono: true },
            { key: 'role', label: 'Rol' },
            { key: 'status', label: 'Estado' },
            { key: 'requires_step_up', label: 'Reautenticación' },
            { key: 'valid_until', label: 'Vigencia' },
            { key: 'created_at', label: 'Alta' },
          ]}
        />
      );
    case 'administracion/roles':
      return (
        <DataTable
          rows={await loadRoles()}
          columns={[
            { key: 'role_key', label: 'Rol' },
            { key: 'name', label: 'Nombre' },
            { key: 'description', label: 'Alcance' },
            { key: 'is_system', label: 'Sistema' },
            { key: 'created_at', label: 'Alta' },
          ]}
        />
      );
    case 'administracion/permisos':
      return (
        <DataTable
          rows={await loadPermissions()}
          columns={[
            { key: 'permission_key', label: 'Permiso', mono: true },
            { key: 'name', label: 'Nombre' },
            { key: 'module', label: 'Módulo' },
            { key: 'description', label: 'Alcance' },
          ]}
        />
      );
    case 'administracion/aprobaciones':
      return (
        <DataTable
          rows={await loadApprovals()}
          columns={[
            { key: 'id', label: 'Solicitud', mono: true },
            { key: 'action_key', label: 'Acción' },
            { key: 'resource_type', label: 'Recurso' },
            { key: 'workspace_id', label: 'Tenant', mono: true },
            { key: 'requested_by', label: 'Solicita', mono: true },
            { key: 'status', label: 'Estado' },
            { key: 'approved_by', label: 'Aprueba', mono: true },
            { key: 'expires_at', label: 'Expira' },
          ]}
        />
      );
    case 'administracion/feature-flags':
    case 'producto/feature-flags':
    case 'administracion/feature-management':
      return (
        <DataTable
          rows={await loadFeatureFlags()}
          columns={[
            { key: 'flag_key', label: 'Flag' },
            { key: 'name', label: 'Capacidad' },
            { key: 'global_enabled', label: 'Global' },
            { key: 'rollout_percentage', label: 'Rollout %' },
            { key: 'allowed_plans', label: 'Planes' },
            { key: 'updated_at', label: 'Actualización' },
          ]}
        />
      );
    default:
      return <UnavailableSource />;
  }
}

export default async function PlatformAdminPage({ params }: PageProps) {
  const { section = [] } = await params;
  const key = section.join('/');
  const navigationKey =
    section.length > 1 && ['organizations', 'users'].includes(section[0]) ? section[0] : key;
  const pathname = navigationKey ? `/panel/${navigationKey}` : '/panel';
  const navItem = findPlatformNavItem(pathname);
  if (!navItem) notFound();
  const copy =
    section.length > 1 && ['organizations', 'users'].includes(section[0])
      ? { title: navItem.label, description: `Detalle operativo · ${section[1]}` }
      : (moduleCopy[key] ?? { title: navItem.label, description: navItem.description });

  const { user, access } = await getCurrentPlatformAccess();
  if (!user) notFound();
  if (!access || !hasPlatformPermission(access, navItem.permission)) notFound();

  const overview = key === '' ? await loadPlatformOverview() : null;

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase text-blue-600">Control Plane</p>
          <h1 className="mt-1 text-2xl font-semibold">{copy.title}</h1>
          <p className="mt-1 text-sm text-slate-500">{copy.description}</p>
        </div>
        {overview ? (
          <p className="text-xs text-slate-500">
            Actualizado{' '}
            {new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(
              new Date(overview.generatedAt)
            )}
          </p>
        ) : null}
      </div>

      {overview ? (
        <>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {overview.metrics.map((item) => (
              <MetricCard key={item.label} metric={item} />
            ))}
          </section>
          <section className="mt-6 grid gap-4 lg:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#121418]">
              <p className="text-sm font-semibold">Separación multi-tenant</p>
              <p className="mt-2 text-sm text-slate-500">
                Acceso interno resuelto fuera de los roles de organización.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#121418]">
              <p className="text-sm font-semibold">Contenido documental</p>
              <p className="mt-2 text-sm text-slate-500">
                Protegido; solo metadata operativa disponible.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#121418]">
              <p className="text-sm font-semibold">Acciones críticas</p>
              <p className="mt-2 text-sm text-slate-500">Reautenticación y auditoría requeridas.</p>
            </div>
          </section>
        </>
      ) : (
        await renderModule(canonicalModuleKeys[key] ?? key)
      )}
    </div>
  );
}
