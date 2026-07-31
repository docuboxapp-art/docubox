// ─── Global Document Status Configuration ────────────────────────────────────
// These are the universal status definitions used across the entire webapp.

export interface DocumentStatusConfig {
  key: string;
  label: string;
  color: string;       // text color class
  bg: string;          // background class
  border: string;      // border class
  dot: string;         // dot/indicator bg class
  iconBg: string;      // icon container bg
  badgeClass: string;  // combined badge class for inline use
}

export interface ParticipationStatusConfig {
  key: string;
  label: string;
  desc: string;
  color: string;
  bg: string;
  border: string;
  dot: string;
  badgeClass: string;
}

// ─── Document States ──────────────────────────────────────────────────────────
export const DOCUMENT_STATUSES: DocumentStatusConfig[] = [
  {
    key: 'borrador',
    label: 'Borrador',
    color: 'text-gray-600',
    bg: 'bg-white',
    border: 'border-gray-300',
    iconBg: 'bg-gray-100',
    dot: 'bg-gray-400',
    badgeClass: 'bg-gray-100 text-gray-600 border border-gray-300',
  },
  {
    key: 'en_proceso',
    label: 'En progreso',
    color: 'text-blue-700',
    bg: 'bg-white',
    border: 'border-blue-300',
    iconBg: 'bg-blue-100',
    dot: 'bg-blue-500',
    badgeClass: 'bg-blue-50 text-blue-700 border border-blue-200',
  },
  {
    key: 'en_espera',
    label: 'En espera',
    color: 'text-orange-700',
    bg: 'bg-white',
    border: 'border-orange-300',
    iconBg: 'bg-orange-100',
    dot: 'bg-orange-500',
    badgeClass: 'bg-orange-50 text-orange-700 border border-orange-200',
  },
  {
    key: 'completado',
    label: 'Completado',
    color: 'text-green-700',
    bg: 'bg-white',
    border: 'border-green-300',
    iconBg: 'bg-green-100',
    dot: 'bg-green-500',
    badgeClass: 'bg-green-50 text-green-700 border border-green-200',
  },
  {
    key: 'rechazado',
    label: 'Rechazado',
    color: 'text-red-700',
    bg: 'bg-white',
    border: 'border-red-300',
    iconBg: 'bg-red-100',
    dot: 'bg-red-500',
    badgeClass: 'bg-red-50 text-red-700 border border-red-200',
  },
  {
    key: 'cancelado',
    label: 'Cancelado',
    color: 'text-slate-600',
    bg: 'bg-white',
    border: 'border-slate-300',
    iconBg: 'bg-slate-100',
    dot: 'bg-slate-400',
    badgeClass: 'bg-slate-100 text-slate-600 border border-slate-200',
  },
  {
    key: 'vencido',
    label: 'Vencido',
    color: 'text-rose-700',
    bg: 'bg-white',
    border: 'border-rose-300',
    iconBg: 'bg-rose-100',
    dot: 'bg-rose-500',
    badgeClass: 'bg-rose-50 text-rose-700 border border-rose-200',
  },
];

// ─── Participation States ─────────────────────────────────────────────────────
export const PARTICIPATION_STATUSES: ParticipationStatusConfig[] = [
  {
    key: 'sin_revisar',
    label: 'Sin revisar',
    desc: 'No ha abierto el documento en el visor',
    color: 'text-amber-700',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    dot: 'bg-amber-400',
    badgeClass: 'bg-amber-50 text-amber-700 border border-amber-200',
  },
  {
    key: 'en_revision',
    label: 'En revisión',
    desc: 'Ha abierto y está viendo el documento',
    color: 'text-cyan-700',
    bg: 'bg-cyan-50',
    border: 'border-cyan-200',
    dot: 'bg-cyan-500',
    badgeClass: 'bg-cyan-50 text-cyan-700 border border-cyan-200',
  },
  {
    key: 'firmo',
    label: 'Firmado',
    desc: 'Ha firmado el documento',
    color: 'text-green-700',
    bg: 'bg-green-50',
    border: 'border-green-200',
    dot: 'bg-green-500',
    badgeClass: 'bg-green-50 text-green-700 border border-green-200',
  },
  {
    key: 'rechazo',
    label: 'Rechazado',
    desc: 'Ha rechazado el documento',
    color: 'text-red-700',
    bg: 'bg-red-50',
    border: 'border-red-200',
    dot: 'bg-red-500',
    badgeClass: 'bg-red-50 text-red-700 border border-red-200',
  },
  {
    key: 'aprobo',
    label: 'Aprobado',
    desc: 'Ha aprobado el documento',
    color: 'text-blue-700',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    dot: 'bg-blue-500',
    badgeClass: 'bg-blue-50 text-blue-700 border border-blue-200',
  },
  {
    key: 'cancelo',
    label: 'Cancelado',
    desc: 'Ha cancelado un documento que creó',
    color: 'text-slate-600',
    bg: 'bg-slate-100',
    border: 'border-slate-300',
    dot: 'bg-slate-400',
    badgeClass: 'bg-slate-100 text-slate-600 border border-slate-300',
  },
  {
    key: 'urgente_atencion',
    label: 'Urgente atención',
    desc: 'Próximos a vencer (menos de 72 horas)',
    color: 'text-rose-700',
    bg: 'bg-rose-50',
    border: 'border-rose-300',
    dot: 'bg-rose-500',
    badgeClass: 'bg-rose-50 text-rose-700 border border-rose-200',
  },
  {
    key: 'participacion_vencida',
    label: 'Participación vencida',
    desc: 'El plazo de participación ha expirado',
    color: 'text-gray-600',
    bg: 'bg-gray-100',
    border: 'border-gray-300',
    dot: 'bg-gray-500',
    badgeClass: 'bg-gray-100 text-gray-600 border border-gray-300',
  },
];

// ─── Helper: get document status config by key ────────────────────────────────
export function getDocumentStatusConfig(key: string): DocumentStatusConfig {
  return DOCUMENT_STATUSES.find((s) => s.key === key) ?? DOCUMENT_STATUSES[0];
}

// ─── Helper: get participation status config by key ───────────────────────────
export function getParticipationStatusConfig(key: string): ParticipationStatusConfig {
  return PARTICIPATION_STATUSES.find((s) => s.key === key) ?? PARTICIPATION_STATUSES[0];
}
