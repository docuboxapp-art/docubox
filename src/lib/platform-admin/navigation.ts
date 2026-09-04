import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BellRing,
  Blocks,
  BookOpenCheck,
  Building2,
  ChartNoAxesCombined,
  CircleDollarSign,
  Clock3,
  Code2,
  CreditCard,
  Database,
  FileCheck2,
  FileKey2,
  FileStack,
  Gauge,
  HardDrive,
  KeyRound,
  Landmark,
  LifeBuoy,
  ListChecks,
  LockKeyhole,
  Mail,
  MessageCircle,
  ReceiptText,
  RefreshCcw,
  ScrollText,
  ServerCog,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Tags,
  TicketCheck,
  UserCog,
  UserRoundCog,
  Users,
  WalletCards,
  Webhook,
} from 'lucide-react';

export type PlatformNavItem = {
  label: string;
  href: string;
  permission: string;
  icon: LucideIcon;
  description: string;
};

export type PlatformNavGroup = { label: string; items: PlatformNavItem[] };

const item = (
  label: string,
  path: string,
  permission: string,
  icon: LucideIcon,
  description: string
): PlatformNavItem => ({
  label,
  href: path ? `/panel/${path}` : '/panel',
  permission,
  icon,
  description,
});

export const platformNavigation: PlatformNavGroup[] = [
  {
    label: '',
    items: [item('Inicio', '', 'dashboard.read', Gauge, 'Estado global verificable de Docubox.')],
  },
  {
    label: 'Clientes',
    items: [
      item(
        'Organizaciones',
        'organizations',
        'organization.read',
        Building2,
        'Tenants, estado, plan y postura operativa.'
      ),
      item(
        'Usuarios',
        'users',
        'user.read',
        Users,
        'Directorio de cuentas sin secretos de autenticación.'
      ),
    ],
  },
  {
    label: 'Producto',
    items: [
      item('Planes', 'plans', 'plan.read', Tags, 'Planes versionados, límites y entitlements.'),
      item(
        'Suscripciones',
        'subscriptions',
        'subscription.read',
        CreditCard,
        'Vigencia y estado comercial por organización.'
      ),
      item(
        'Consumos',
        'usage',
        'usage.read',
        ChartNoAxesCombined,
        'Uso medido por servicio y tenant.'
      ),
    ],
  },
  {
    label: 'Finanzas',
    items: [
      item(
        'Dashboard financiero',
        'finance',
        'billing.read',
        BarChart3,
        'MRR, ARR, ingresos y cartera.'
      ),
      item(
        'Transacciones',
        'finance/transactions',
        'billing.read',
        CircleDollarSign,
        'Movimientos y estado de pago.'
      ),
      item(
        'Facturación',
        'finance/invoices',
        'billing.read',
        ReceiptText,
        'Facturas y estado fiscal.'
      ),
      item(
        'Conciliación',
        'finance/reconciliation',
        'billing.read',
        Landmark,
        'Cruce de pagos y liquidaciones.'
      ),
      item(
        'Reembolsos',
        'finance/refunds',
        'billing.refund.request',
        RefreshCcw,
        'Solicitudes y four-eyes por importe.'
      ),
      item(
        'Créditos',
        'finance/credits',
        'billing.credit',
        WalletCards,
        'Créditos y ajustes autorizados.'
      ),
    ],
  },
  {
    label: 'Operación',
    items: [
      item(
        'Documentos',
        'documents',
        'document.metadata.read',
        FileStack,
        'Metadata técnica sin contenido privado.'
      ),
      item(
        'Almacenamiento',
        'storage',
        'document.integrity.read',
        HardDrive,
        'Objetos, cifrado e integridad.'
      ),
      item('Workflows', 'workflows', 'workflow.read', ListChecks, 'Ejecuciones, pasos y errores.'),
      item('Jobs', 'jobs', 'job.read', ServerCog, 'Trabajos asíncronos e intentos.'),
      item(
        'Cola de errores',
        'dlq',
        'job.read',
        AlertTriangle,
        'Dead letters con contexto sanitizado.'
      ),
    ],
  },
  {
    label: 'Firma y certificación',
    items: [
      item('Firmas', 'signatures', 'signature.read', FileCheck2, 'Resultados agregados de firma.'),
      item(
        'e.firma SAT',
        'signatures/efirma',
        'signature.read',
        FileKey2,
        'Evidencia pública sin material privado.'
      ),
      item(
        'Firma autógrafa',
        'signatures/autograph',
        'signature.read',
        FileCheck2,
        'Estado de firma autógrafa.'
      ),
      item(
        'PAdES',
        'signatures/pades',
        'signature.read',
        ShieldCheck,
        'PAdES y verificación independiente.'
      ),
      item('TSA', 'signatures/tsa', 'tsa.read', Clock3, 'Sellos RFC 3161 y trust.'),
      item(
        'NOM-151',
        'signatures/nom151',
        'nom151.read',
        BookOpenCheck,
        'Constancias y confianza productiva separada.'
      ),
      item(
        'Integridad',
        'integrity',
        'document.integrity.read',
        ShieldCheck,
        'Hashes, objetos y evidencia.'
      ),
    ],
  },
  {
    label: 'Identidad',
    items: [
      item(
        'Verificaciones',
        'identity',
        'identity.read',
        UserRoundCog,
        'Resultados sanitizados de identidad.'
      ),
      item('OCR', 'identity/ocr', 'identity.read', FileStack, 'Estado y calidad de OCR.'),
      item(
        'Prueba de vida',
        'identity/liveness',
        'identity.read',
        UserRoundCog,
        'Resultado sin imágenes biométricas.'
      ),
      item('MFA', 'identity/mfa', 'security.read', KeyRound, 'Cobertura y eventos MFA.'),
      item(
        'Passkeys',
        'identity/passkeys',
        'security.read',
        KeyRound,
        'Postura WebAuthn sin claves públicas.'
      ),
    ],
  },
  {
    label: 'Notificaciones',
    items: [
      item(
        'Email',
        'notifications/email',
        'notification.read',
        Mail,
        'Entregas, rebotes y reintentos.'
      ),
      item('SMS', 'notifications/sms', 'notification.read', Smartphone, 'Entregas y consumo SMS.'),
      item(
        'WhatsApp',
        'notifications/whatsapp',
        'notification.read',
        MessageCircle,
        'Entregas y consumo WhatsApp.'
      ),
      item(
        'Plantillas',
        'notifications/templates',
        'notification.read',
        ScrollText,
        'Plantillas transaccionales versionadas.'
      ),
    ],
  },
  {
    label: 'Soporte',
    items: [
      item(
        'Tickets',
        'support/tickets',
        'support.ticket.read',
        TicketCheck,
        'Casos, prioridad y estado.'
      ),
      item(
        'Diagnóstico',
        'support/diagnostics',
        'support.ticket.manage',
        ListChecks,
        'Correlación técnica sin contenido.'
      ),
      item(
        'Acceso asistido',
        'support/access',
        'support.access.request',
        LifeBuoy,
        'Sesiones temporales, acotadas y aprobadas.'
      ),
      item(
        'Incidencias',
        'incidents',
        'incident.read',
        AlertTriangle,
        'Afectaciones y seguimiento operativo.'
      ),
    ],
  },
  {
    label: 'Integraciones',
    items: [
      item(
        'Proveedores',
        'providers',
        'provider.read',
        Blocks,
        'Salud y configuración sin secretos.'
      ),
      item('API', 'api', 'api.read', Code2, 'Clientes, scopes, límites y uso.'),
      item('Webhooks', 'webhooks', 'webhook.read', Webhook, 'Entregas, errores y reintentos.'),
      item(
        'Logs',
        'integration-logs',
        'api.read',
        ListChecks,
        'Resultados sanitizados por correlación.'
      ),
    ],
  },
  {
    label: 'Seguridad',
    items: [
      item(
        'Security Center',
        'security',
        'security.read',
        ShieldCheck,
        'Postura consolidada de seguridad.'
      ),
      item(
        'Eventos',
        'security/events',
        'security.read',
        ShieldAlert,
        'Eventos e intentos relevantes.'
      ),
      item(
        'Sesiones',
        'security/sessions',
        'security.read',
        UserCog,
        'Sesiones, riesgo y revocación.'
      ),
      item('Riesgo', 'security/risk', 'security.read', Activity, 'Señales y score de riesgo.'),
      item('KMS/HSM', 'security/kms', 'kms.read', FileKey2, 'Llaves, protección y rotación.'),
      item(
        'Cifrado',
        'security/encryption',
        'security.read',
        LockKeyhole,
        'Cobertura de cifrado documental.'
      ),
      item('Alertas', 'alerts', 'alert.read', BellRing, 'Centro unificado de alertas.'),
    ],
  },
  {
    label: 'Infraestructura',
    items: [
      item(
        'Estado del sistema',
        'system',
        'system.read',
        Gauge,
        'NOC basado en health checks reales.'
      ),
      item(
        'Servicios',
        'system/services',
        'system.read',
        Blocks,
        'Dependencias y estado operativo.'
      ),
      item('Jobs', 'system/jobs', 'job.read', ServerCog, 'Trabajos backend.'),
      item('Dead Letter Queue', 'system/dlq', 'job.read', AlertTriangle, 'Trabajos agotados.'),
      item('Backups', 'system/backups', 'system.read', HardDrive, 'Copias y verificaciones.'),
      item(
        'Migraciones',
        'system/migrations',
        'system.read',
        Database,
        'Historial sin ejecución SQL libre.'
      ),
    ],
  },
  {
    label: '',
    items: [
      item('Auditoría', 'audit', 'audit.read', ScrollText, 'Bitácora administrativa append-only.'),
    ],
  },
  {
    label: 'Administración',
    items: [
      item(
        'Equipo interno',
        'staff',
        'staff.read',
        Users,
        'Personal interno separado de clientes.'
      ),
      item(
        'Roles y permisos',
        'roles',
        'role.read',
        ShieldCheck,
        'RBAC interno y permisos granulares.'
      ),
      item(
        'Aprobaciones',
        'approvals',
        'approval.read',
        ListChecks,
        'Acciones críticas pendientes y ejecutadas.'
      ),
      item(
        'Configuración global',
        'settings',
        'system.configure',
        Settings2,
        'Políticas no secretas versionadas.'
      ),
    ],
  },
];

export function permissionAllows(permissions: string[], permission: string) {
  return permissions.includes('*') || permissions.includes(permission);
}

export function findPlatformNavItem(pathname: string) {
  const items = platformNavigation.flatMap((group) => group.items);
  return (
    items.find((navItem) => navItem.href === pathname) ??
    items
      .filter((navItem) => navItem.href !== '/panel' && pathname.startsWith(`${navItem.href}/`))
      .sort((left, right) => right.href.length - left.href.length)[0]
  );
}

export function findPlatformNavGroup(pathname: string) {
  const current = findPlatformNavItem(pathname);
  if (!current) return undefined;
  return platformNavigation.find((group) =>
    group.items.some((navItem) => navItem.href === current.href)
  );
}
