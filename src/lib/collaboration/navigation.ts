import {
  Activity,
  BarChart3,
  Bot,
  BriefcaseBusiness,
  CalendarDays,
  CheckSquare2,
  ClipboardCheck,
  FileSearch,
  FolderKanban,
  Handshake,
  Settings2,
  ShieldCheck,
  UsersRound,
  Vote,
} from 'lucide-react';

export const collaborationNavigation = [
  { href: '/colabora', label: 'Resumen', icon: BriefcaseBusiness, permission: 'collaboration.view_dashboard', classification: 'standard' },
  { href: '/colabora/tareas', label: 'Tareas', icon: CheckSquare2, permission: 'tasks.view', classification: 'standard' },
  { href: '/colabora/revisiones', label: 'Revisiones', icon: FileSearch, permission: 'reviews.view', classification: 'standard' },
  { href: '/colabora/espacios', label: 'Espacios', icon: FolderKanban, permission: 'collaboration_spaces.view', classification: 'standard' },
  { href: '/colabora/calendario', label: 'Calendario', icon: CalendarDays, permission: 'collaboration_spaces.view', classification: 'standard' },
  { href: '/colabora/actividad', label: 'Actividad', icon: Activity, permission: 'collaboration.view_dashboard', classification: 'standard' },
  { href: '/colabora/solicitudes', label: 'Solicitudes', icon: ClipboardCheck, permission: 'requests.view', classification: 'standard' },
  { href: '/colabora/reportes', label: 'Reportes', icon: BarChart3, permission: 'reports.view', entitlement: 'collaboration_analytics', classification: 'mixed' },
  { href: '/colabora/salas', label: 'Salas externas', icon: UsersRound, permission: 'rooms.view', entitlement: 'collaboration_external_rooms', classification: 'pro' },
  { href: '/colabora/automatizaciones', label: 'Automatizaciones', icon: Bot, permission: 'automations.view', entitlement: 'collaboration_automations', classification: 'pro' },
  { href: '/colabora/negociacion', label: 'Negociacion', icon: Handshake, permission: 'reviews.view', entitlement: 'collaboration_advanced_workflows', classification: 'pro' },
  { href: '/colabora/comites', label: 'Comites', icon: Vote, permission: 'collaboration_spaces.view', entitlement: 'collaboration_advanced_workflows', classification: 'pro' },
  { href: '/colabora/cierres', label: 'Cierres', icon: ShieldCheck, permission: 'collaboration_spaces.view', entitlement: 'collaboration_advanced_workflows', classification: 'pro' },
  { href: '/colabora/configuracion', label: 'Configuracion', icon: Settings2, permission: 'collaboration.manage_settings', classification: 'shared' },
] as const;

export const collaborationProSections = new Set([
  'salas',
  'automatizaciones',
  'negociacion',
  'comites',
  'cierres',
]);

export const collaborationSectionEntitlements: Record<string, string> = {
  salas: 'collaboration_external_rooms',
  automatizaciones: 'collaboration_automations',
  negociacion: 'collaboration_advanced_workflows',
  comites: 'collaboration_advanced_workflows',
  cierres: 'collaboration_advanced_workflows',
};
