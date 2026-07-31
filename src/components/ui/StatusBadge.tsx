import React from 'react';

export type DocumentStatus =
  | 'completado'
  | 'pendiente' |'en_proceso' |'en_progreso' |'en_espera' |'rechazado' |'vencido' |'borrador' |'cancelado' |'parcial'
  // Participation statuses
  | 'sin_revisar' |'en_revision' |'firmo' |'rechazo' |'aprobo' |'cancelo' |'urgente_atencion' |'participacion_vencida';

const statusConfig: Record<DocumentStatus, { label: string; className: string }> = {
  completado: {
    label: 'Completado',
    className: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  },
  pendiente: {
    label: 'Pendiente',
    className: 'bg-[hsl(43,96%,92%)] text-[hsl(43,96%,28%)] border border-[hsl(43,96%,78%)]',
  },
  en_proceso: {
    label: 'En progreso',
    className: 'bg-blue-50 text-blue-700 border border-blue-200',
  },
  en_progreso: {
    label: 'En progreso',
    className: 'bg-blue-50 text-blue-700 border border-blue-200',
  },
  en_espera: {
    label: 'En espera',
    className: 'bg-orange-50 text-orange-700 border border-orange-200',
  },
  rechazado: {
    label: 'Rechazado',
    className: 'bg-red-50 text-red-700 border border-red-200',
  },
  vencido: {
    label: 'Vencido',
    className: 'bg-rose-50 text-rose-700 border border-rose-200',
  },
  borrador: {
    label: 'Borrador',
    className: 'bg-slate-100 text-slate-600 border border-slate-200',
  },
  cancelado: {
    label: 'Cancelado',
    className: 'bg-slate-100 text-slate-600 border border-slate-200',
  },
  parcial: {
    label: 'Parcial',
    className: 'bg-[hsl(214,72%,94%)] text-[hsl(214,72%,22%)] border border-[hsl(214,72%,78%)]',
  },
  // Participation statuses
  sin_revisar: {
    label: 'Sin revisar',
    className: 'bg-amber-50 text-amber-700 border border-amber-200',
  },
  en_revision: {
    label: 'En revisión',
    className: 'bg-cyan-50 text-cyan-700 border border-cyan-200',
  },
  firmo: {
    label: 'Firmó',
    className: 'bg-green-50 text-green-700 border border-green-200',
  },
  rechazo: {
    label: 'Rechazó',
    className: 'bg-red-50 text-red-700 border border-red-200',
  },
  aprobo: {
    label: 'Aprobó',
    className: 'bg-blue-50 text-blue-700 border border-blue-200',
  },
  cancelo: {
    label: 'Canceló',
    className: 'bg-slate-100 text-slate-600 border border-slate-300',
  },
  urgente_atencion: {
    label: 'Urgente atención',
    className: 'bg-rose-50 text-rose-700 border border-rose-200',
  },
  participacion_vencida: {
    label: 'Participación vencida',
    className: 'bg-gray-100 text-gray-600 border border-gray-300',
  },
};

interface StatusBadgeProps {
  status: DocumentStatus;
  size?: 'sm' | 'md';
}

export default function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const config = statusConfig[status] ?? statusConfig['borrador'];
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium whitespace-nowrap ${config.className} ${
        size === 'sm' ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-1'
      }`}
    >
      {config.label}
    </span>
  );
}