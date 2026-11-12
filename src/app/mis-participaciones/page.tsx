'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import AppLayout from '@/components/AppLayout';
import { ActivitySummary, type ActivitySummaryMetric } from '@/components/documents/ActivitySummary';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { LegalHoldBadge } from '@/components/documents/LegalHoldBadge';
import { DocumentPriorityBadge } from '@/components/documents/DocumentPriorityBadge';
import { operationalPriorityRank } from '@/lib/documents/priority';

import {
  Search,
  User,
  Calendar,
  Clock,
  CheckCircle2,
  XCircle,
  LayoutList,
  LayoutGrid,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Inbox,
  ChevronDown,
  Eye,
  Users,
  Mail,
  AlertTriangle,
  Ban,
  ArrowUpDown,
  FileSignature,
  AlertCircle,
  FileText,
  MoreHorizontal,
} from 'lucide-react';

interface MyParticipation {
  id: string;
  documentName: string;
  documentType: string;
  description?: string;
  etiquetas?: string[];
  senderName: string;
  senderEmail: string;
  status:
    | 'pendiente'
    | 'en-progreso'
    | 'en-espera'
    | 'completado'
    | 'vencido'
    | 'rechazado'
    | 'cancelado';
  priority: 'Normal' | 'Alta' | 'Urgente' | 'Baja';
  receivedAt: string;
  respondedAt?: string;
  expiresAt?: string | null;
  tieneVencimiento?: boolean;
  completedAt?: string;
  expiredAt?: string;
  rejectedAt?: string;
  rejectionMotivo?: string;
  rejectionDescripcion?: string;
  canceladoAt?: string;
  cancelacionMotivo?: string;
  cancelacionDescripcion?: string;
  enEsperaMotivo?: string;
  enEsperaDescripcion?: string;
  message?: string;
  participants: number;
  participantList?: {
    name: string;
    email: string;
    phone?: string;
    notificationMethod?: 'email' | 'sms' | 'whatsapp' | 'docubox';
    status?: string;
    subEstado?: string;
    rol?: string;
    acto?: string;
  }[];
  signaturesTotal: number;
  signaturesDone: number;
  mySignatureStatus?: string;
  myRol?: string;
  myActo?: string;
  myTipoFirma?: string[];
  myParticipantId?: string | null;
  camposSolicitados?: any[];
  supabaseId?: string;
  legalHoldActive?: boolean;
  currentAccess?: boolean;
  historicalParticipation?: boolean;
}

const TERMINAL_STATUSES = ['completado', 'vencido', 'rechazado', 'cancelado'];
const PARTICIPATED_STATUSES = ['Firmado', 'Rechazado', 'Aprobado', 'Cancelado'];

const statusFilterOptions = [
  { value: 'en-progreso', label: 'En Progreso' },
  { value: 'urgente', label: 'Urgentes' },
  { value: 'proximo-a-vencer', label: 'Próximos a vencer' },
  { value: 'en-espera', label: 'En Espera' },
  { value: 'completado', label: 'Completados' },
  { value: 'vencido', label: 'Vencidos' },
  { value: 'rechazado', label: 'Rechazados' },
  { value: 'cancelado', label: 'Cancelados' },
];

type TimeFilter = 'todos' | '365' | '30' | '7' | 'today' | 'custom';

const timeFilterOptions: { value: TimeFilter; label: string }[] = [
  { value: 'todos', label: 'Cualquier fecha' },
  { value: '365', label: 'Último año' },
  { value: '30', label: 'Últimos 30 días' },
  { value: '7', label: 'Últimos 7 días' },
  { value: 'today', label: 'Hoy' },
  { value: 'custom', label: 'Rango personalizado...' },
];

// periodFilterOptions removed - only month selector used in tablero

const kanbanColumns: {
  status: MyParticipation['status'];
  label: string;
  borderColor: string;
  bgColor: string;
}[] = [
  {
    status: 'en-progreso',
    label: 'En Progreso',
    borderColor: 'border-t-blue-400',
    bgColor: 'bg-blue-50/40',
  },
  {
    status: 'en-espera',
    label: 'En Espera',
    borderColor: 'border-t-purple-400',
    bgColor: 'bg-purple-50/40',
  },
  {
    status: 'completado',
    label: 'Completados',
    borderColor: 'border-t-emerald-400',
    bgColor: 'bg-emerald-50/40',
  },
  {
    status: 'vencido',
    label: 'Vencidos',
    borderColor: 'border-t-orange-300',
    bgColor: 'bg-orange-50/40',
  },
  {
    status: 'rechazado',
    label: 'Rechazados',
    borderColor: 'border-t-red-400',
    bgColor: 'bg-red-50/40',
  },
  {
    status: 'cancelado',
    label: 'Cancelados',
    borderColor: 'border-t-gray-400',
    bgColor: 'bg-gray-50/40',
  },
];

const MONTHS_ES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];
const DAYS_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

type ViewMode = 'lista' | 'tablero' | 'calendario';
type CalendarView = 'mes' | 'semana' | 'dia';
type CalendarStatusFilter =
  | 'en-progreso'
  | 'urgente'
  | 'proximo-a-vencer'
  | 'en-espera'
  | 'completado'
  | 'vencido'
  | 'rechazado'
  | 'cancelado'
  | 'todos';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatCreatedAt(dateStr: string) {
  const date = new Date(dateStr);
  const day = date.getDate();
  const monthsShort = [
    'ene',
    'feb',
    'mar',
    'abr',
    'may',
    'jun',
    'jul',
    'ago',
    'sep',
    'oct',
    'nov',
    'dic',
  ];
  const month = monthsShort[date.getMonth()];
  const year = date.getFullYear();
  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'p.m.' : 'a.m.';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${day} ${month} ${year} a las ${hours.toString().padStart(2, '0')}:${minutes} ${ampm}`;
}

function formatExpiresAt(dateStr: string) {
  const date = new Date(dateStr);
  const day = date.getDate();
  const monthsShort = [
    'ene',
    'feb',
    'mar',
    'abr',
    'may',
    'jun',
    'jul',
    'ago',
    'sep',
    'oct',
    'nov',
    'dic',
  ];
  const month = monthsShort[date.getMonth()];
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}

function getStatusIcon(status: MyParticipation['status']) {
  switch (status) {
    case 'completado':
      return <CheckCircle2 size={14} className="text-emerald-600" />;
    case 'rechazado':
      return <XCircle size={14} className="text-red-500" />;
    case 'cancelado':
      return <XCircle size={14} className="text-gray-500" />;
    case 'vencido':
      return <Clock size={14} className="text-gray-400" />;
    case 'en-espera':
      return <Clock size={14} className="text-amber-500" />;
    case 'pendiente':
      return <Clock size={14} className="text-amber-500" />;
    default:
      return <Clock size={14} className="text-blue-500" />;
  }
}

function getStatusLabel(status: MyParticipation['status']) {
  switch (status) {
    case 'pendiente':
      return 'Pendiente';
    case 'en-progreso':
      return 'En Progreso';
    case 'en-espera':
      return 'En Espera';
    case 'completado':
      return 'Completado';
    case 'vencido':
      return 'Vencido';
    case 'rechazado':
      return 'Rechazado';
    case 'cancelado':
      return 'Cancelado';
  }
}

function getStatusBadgeClass(status: MyParticipation['status']) {
  switch (status) {
    case 'pendiente':
      return 'bg-amber-100 text-amber-700';
    case 'en-progreso':
      return 'bg-[hsl(214,72%,94%)] text-[hsl(214,72%,30%)]';
    case 'en-espera':
      return 'bg-[hsl(43,96%,92%)] text-[hsl(43,96%,28%)]';
    case 'completado':
      return 'bg-emerald-100 text-emerald-700';
    case 'vencido':
      return 'bg-gray-100 text-gray-600';
    case 'rechazado':
      return 'bg-red-100 text-red-600';
    case 'cancelado':
      return 'bg-gray-200 text-gray-600';
  }
}

function getMySignatureBadge(status?: string) {
  switch (status) {
    case 'Firmó':
    case 'Firmado':
      return 'bg-emerald-100 text-emerald-700';
    case 'Rechazó':
    case 'Rechazado':
      return 'bg-red-100 text-red-600';
    case 'Aprobó':
    case 'Aprobado':
      return 'bg-blue-100 text-blue-700';
    case 'Canceló':
    case 'Cancelado':
      return 'bg-slate-100 text-slate-600';
    default:
      return 'bg-amber-100 text-amber-700';
  }
}

function getParticipantStatusBadge(status?: string) {
  switch (status) {
    case 'Firmó':
    case 'Firmado':
      return 'bg-emerald-100 text-emerald-700';
    case 'Rechazó':
    case 'Rechazado':
      return 'bg-red-100 text-red-600';
    case 'Aprobó':
    case 'Aprobado':
      return 'bg-blue-100 text-blue-700';
    case 'Canceló':
    case 'Cancelado':
      return 'bg-slate-100 text-slate-600';
    case 'En revisión':
    case 'en_revision':
      return 'bg-blue-50 text-blue-600';
    case 'Sin revisión':
    case 'sin_revisar':
      return 'bg-gray-100 text-gray-500';
    default:
      return 'bg-amber-100 text-amber-700';
  }
}

function getParticipantStatusLabel(status?: string): string {
  switch (status) {
    case 'Firmado':
      return 'Firmado';
    case 'Aprobado':
      return 'Aprobado';
    case 'Rechazado':
      return 'Rechazado';
    case 'Cancelado':
      return 'Cancelado';
    case 'En revisión':
    case 'en_revision':
      return 'En revisión';
    case 'Sin revisión':
    case 'sin_revisar':
      return 'Sin revisión';
    default:
      return status ?? 'En revisión';
  }
}

// Determine the "acto a realizar" label
function getActoLabel(req: MyParticipation): string | null {
  if (req.myActo) return req.myActo;
  if (req.myRol) {
    const rol = req.myRol.toLowerCase();
    if (rol.includes('firmante') || rol.includes('firma')) return 'Firmar';
    if (rol.includes('aprobador') || rol.includes('aprueba')) return 'Aprobar';
    if (rol.includes('observador')) return 'Observar';
  }
  return null;
}

function getWeekStart(date: Date): Date {
  let d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function getParticipationsForDay(
  date: Date,
  items: MyParticipation[],
  calFilter: CalendarStatusFilter = 'todos'
): MyParticipation[] {
  return items.filter((req) => {
    if (calFilter === 'todos') {
      let dateStr: string | undefined;
      switch (req.status) {
        case 'pendiente':
        case 'en-progreso':
        case 'en-espera':
          dateStr = req.receivedAt;
          break;
        case 'completado':
          dateStr = req.completedAt ?? req.receivedAt;
          break;
        case 'vencido':
          dateStr = req.expiredAt ?? req.expiresAt ?? undefined;
          break;
        case 'rechazado':
          dateStr = req.rejectedAt ?? req.receivedAt;
          break;
        case 'cancelado':
          dateStr = req.canceladoAt ?? req.receivedAt;
          break;
        default:
          dateStr = req.receivedAt;
      }
      if (!dateStr) return false;
      return isSameDay(new Date(dateStr), date);
    }
    if (calFilter === 'urgente') {
      if (req.priority !== 'Urgente' || req.status !== 'en-progreso') return false;
      return isSameDay(new Date(req.receivedAt), date);
    }
    if (calFilter === 'proximo-a-vencer') {
      const now = new Date();
      if (req.status !== 'en-progreso') return false;
      if (!req.expiresAt) return false;
      const expires = new Date(req.expiresAt);
      const diffHours = (expires.getTime() - now.getTime()) / (1000 * 60 * 60);
      if (diffHours < 0 || diffHours > 72) return false;
      return isSameDay(new Date(req.expiresAt), date);
    }
    let dateStr: string | undefined;
    switch (calFilter) {
      case 'en-progreso':
      case 'en-espera':
        if (req.status !== calFilter) return false;
        dateStr = req.receivedAt;
        break;
      case 'completado':
        if (req.status !== 'completado') return false;
        dateStr = req.completedAt;
        break;
      case 'vencido':
        if (req.status !== 'vencido') return false;
        dateStr = req.expiredAt ?? req.expiresAt ?? undefined;
        break;
      case 'rechazado':
        if (req.status !== 'rechazado') return false;
        dateStr = req.rejectedAt ?? req.receivedAt;
        break;
      case 'cancelado':
        if (req.status !== 'cancelado') return false;
        dateStr = req.canceladoAt ?? req.receivedAt;
        break;
    }
    if (!dateStr) return false;
    return isSameDay(new Date(dateStr), date);
  });
}

// ─── Participants Icon ────────────────────────────────────────────────────────
function ParticipantsIcon({ count }: { count: number }) {
  if (count <= 1) {
    return <User size={13} className="text-muted-foreground" />;
  }
  return <Users size={13} className="text-muted-foreground" />;
}

// ─── Participation cards ─────────────────────────────────────────────────────
interface ParticipationCardProps {
  req: MyParticipation;
  isUrgentFilter?: boolean;
}

function getDocumentIconTone(status: MyParticipation['status']) {
  switch (status) {
    case 'pendiente':
    case 'en-espera':
      return 'bg-amber-50 text-amber-600';
    case 'en-progreso':
      return 'bg-primary/10 text-primary';
    case 'completado':
      return 'bg-emerald-50 text-emerald-600';
    case 'vencido':
    case 'rechazado':
      return 'bg-red-50 text-red-600';
    case 'cancelado':
      return 'bg-slate-100 text-slate-500';
  }
}

function canActOnParticipation(req: MyParticipation) {
  return (
    req.currentAccess !== false &&
    (req.status === 'en-progreso' || req.status === 'pendiente') &&
    !PARTICIPATED_STATUSES.includes(req.mySignatureStatus ?? '') &&
    req.myActo?.toLowerCase() !== 'observador' &&
    req.myRol?.toLowerCase() !== 'observador'
  );
}

function getParticipationActionLabel(req: MyParticipation) {
  return req.myActo === 'Aprobador' || req.myRol?.toLowerCase().includes('aprobador')
    ? 'Aprobar documento'
    : 'Firmar documento';
}

function getParticipationDateLabel(req: MyParticipation) {
  if (req.status === 'completado' && req.completedAt)
    return `Completado: ${formatExpiresAt(req.completedAt)}`;
  if (req.status === 'vencido' && (req.expiredAt || req.expiresAt))
    return `Venció: ${formatExpiresAt((req.expiredAt || req.expiresAt)!)}`;
  if (req.status === 'rechazado' && req.rejectedAt)
    return `Rechazado: ${formatExpiresAt(req.rejectedAt)}`;
  if (req.status === 'cancelado' && req.canceladoAt)
    return `Cancelado: ${formatExpiresAt(req.canceladoAt)}`;
  return req.tieneVencimiento && req.expiresAt
    ? `Vence: ${formatExpiresAt(req.expiresAt)}`
    : 'Sin vencimiento';
}

function isParticipationNearExpiry(req: MyParticipation, now: number) {
  if (!['pendiente', 'en-progreso'].includes(req.status) || !req.expiresAt) return false;
  const remaining = new Date(req.expiresAt).getTime() - now;
  return remaining > 0 && remaining <= 72 * 60 * 60 * 1000;
}

function ParticipationDetails({ req }: { req: MyParticipation }) {
  const total = Math.max(0, req.signaturesTotal);
  const done = Math.max(0, req.signaturesDone);
  const progress = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const activity = [
    { date: req.receivedAt, label: 'Participación recibida' },
    ...(req.completedAt ? [{ date: req.completedAt, label: 'Documento completado' }] : []),
    ...(req.rejectedAt ? [{ date: req.rejectedAt, label: 'Documento rechazado' }] : []),
    ...(req.canceladoAt ? [{ date: req.canceladoAt, label: 'Documento cancelado' }] : []),
    ...(req.expiredAt ? [{ date: req.expiredAt, label: 'Documento vencido' }] : []),
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h4 className="flex items-center gap-2 text-sm font-600 text-foreground">
            <Users size={16} className="text-slate-500" aria-hidden="true" />
            Participantes ({req.participants})
          </h4>
          <div className="w-full sm:max-w-xs">
            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span>Progreso de participación</span>
              <span className="font-600 text-foreground">{progress}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          {req.legalHoldActive && <LegalHoldBadge />}
          <DocumentPriorityBadge priority={req.priority === 'Urgente' ? 'urgent' : 'normal'} />
          {getActoLabel(req) && (
            <span
              className={`rounded-full px-2.5 py-1 ${getMySignatureBadge(req.mySignatureStatus)}`}
            >
              Acción: {getActoLabel(req)}
            </span>
          )}
          {req.mySignatureStatus && (
            <span
              className={`rounded-full px-2.5 py-1 ${getMySignatureBadge(req.mySignatureStatus)}`}
            >
              Mi estado: {req.mySignatureStatus}
            </span>
          )}
          {req.myTipoFirma?.length ? (
            <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-indigo-700">
              {req.myTipoFirma.join(', ')}
            </span>
          ) : null}
          {req.camposSolicitados?.length ? (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">
              {req.camposSolicitados.length}{' '}
              {req.camposSolicitados.length === 1 ? 'campo a completar' : 'campos a completar'}
            </span>
          ) : null}
        </div>
        {req.participantList?.length ? (
          <div className="space-y-2">
            {req.participantList.map((participant, index) => (
              <div
                key={`${participant.email}-${index}`}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 px-3 py-3"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-600 text-primary">
                  {participant.name
                    .trim()
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((part) => part[0]?.toUpperCase())
                    .join('') || '—'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-600 text-foreground">{participant.name}</p>
                  <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                    <Mail size={11} aria-hidden="true" />
                    {participant.email}
                  </p>
                  {(participant.rol || participant.acto) && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {participant.rol && `Rol: ${participant.rol}`}
                      {participant.rol && participant.acto && ' · '}
                      {participant.acto && `Acción: ${participant.acto}`}
                    </p>
                  )}
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-500 ${getParticipantStatusBadge(participant.status)}`}
                >
                  {getParticipantStatusLabel(participant.status)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Aún no hay detalles de participantes disponibles.
          </p>
        )}
      </div>
      {req.status === 'en-espera' && (req.enEsperaMotivo || req.enEsperaDescripcion) && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          En espera: {[req.enEsperaMotivo, req.enEsperaDescripcion].filter(Boolean).join(' — ')}
        </p>
      )}
      {req.status === 'vencido' &&
        req.participantList?.some((p) => !PARTICIPATED_STATUSES.includes(p.status ?? '')) && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Sin participar:{' '}
            {req.participantList
              .filter((p) => !PARTICIPATED_STATUSES.includes(p.status ?? ''))
              .map((p) => p.name)
              .join(', ')}
            .
          </p>
        )}
      {req.status === 'rechazado' && (req.rejectionMotivo || req.rejectionDescripcion) && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          Motivo de rechazo:{' '}
          {[req.rejectionMotivo, req.rejectionDescripcion].filter(Boolean).join(' — ')}
        </p>
      )}
      {req.status === 'cancelado' && (req.cancelacionMotivo || req.cancelacionDescripcion) && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          Motivo de cancelación:{' '}
          {[req.cancelacionMotivo, req.cancelacionDescripcion].filter(Boolean).join(' — ')}
        </p>
      )}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h4 className="mb-3 flex items-center gap-2 text-sm font-600 text-foreground">
          <Clock size={16} className="text-slate-500" aria-hidden="true" />
          Actividad reciente
        </h4>
        <ol className="flex min-w-0 overflow-x-auto pb-2">
          {activity.map((item, index) => (
            <li
              key={`${item.label}-${index}`}
              className="min-w-48 flex-1 pr-5 text-xs text-muted-foreground last:pr-0"
            >
              <div className="relative h-4" aria-hidden="true">
                <span className="absolute left-0 top-1 h-2 w-2 rounded-full bg-primary" />
                {index < activity.length - 1 && (
                  <span className="absolute left-2 right-0 top-[7px] h-px bg-slate-200" />
                )}
              </div>
              <time dateTime={item.date} className="mt-1 block whitespace-nowrap">
                {formatCreatedAt(item.date)}
              </time>
              <p className="mt-0.5 text-slate-700">{item.label}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function ParticipationActionsMenu({
  req,
  expanded,
  onToggle,
  variant,
}: {
  req: MyParticipation;
  expanded: boolean;
  onToggle: () => void;
  variant: 'list' | 'grid' | 'grid-footer' | 'board';
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = `participation-actions-${variant}-${req.id}`;

  useEffect(() => {
    if (!open) return;
    function closeOnOutsideClick(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div className="relative shrink-0" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={`Acciones de ${req.documentName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        className={`flex items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${variant === 'grid-footer' ? 'h-10 w-10' : 'h-9 w-9'}`}
      >
        <MoreHorizontal size={17} aria-hidden="true" />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          className={`absolute right-0 z-30 w-52 rounded-lg border border-slate-200 bg-white p-1 shadow-lg ${variant === 'grid-footer' ? 'bottom-full mb-1' : 'top-full mt-1'}`}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onToggle();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            <Users size={15} aria-hidden="true" />
            {expanded ? 'Ocultar participantes' : 'Ver participantes'}
          </button>
          {canActOnParticipation(req) && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                router.push(`/firmar-documento/${req.supabaseId ?? req.id}`);
              }}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-primary hover:bg-primary/5"
            >
              <FileSignature size={15} aria-hidden="true" />
              {getParticipationActionLabel(req)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ParticipationCard({ req }: ParticipationCardProps) {
  const router = useRouter();
  const [showDetails, setShowDetails] = useState(false);
  const [openedAt] = useState(() => Date.now());
  const total = Math.max(0, req.signaturesTotal);
  const done = Math.max(0, req.signaturesDone);
  const progress = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const expiresSoon = isParticipationNearExpiry(req, openedAt);
  const detailsId = `participation-details-${req.id}`;
  const canAct = canActOnParticipation(req);

  return (
    <article className="rounded-lg border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="grid gap-4 px-4 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center xl:grid-cols-[minmax(260px,2.3fr)_auto_minmax(130px,1fr)_minmax(145px,1fr)_auto] xl:gap-5">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => setShowDetails((value) => !value)}
            aria-expanded={showDetails}
            aria-controls={detailsId}
            aria-label={`${showDetails ? 'Ocultar' : 'Ver'} detalles de ${req.documentName}`}
            className="flex h-8 w-6 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {showDetails ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
          </button>
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${getDocumentIconTone(req.status)}`}
          >
            <FileText size={19} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-600 text-foreground" title={req.documentName}>
              {req.documentName}
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span>{req.documentType || 'Documento'}</span>
              <span className="hidden text-slate-300 sm:inline">·</span>
              <span>Recibido: {formatExpiresAt(req.receivedAt)}</span>
              <span className="hidden text-slate-300 sm:inline">·</span>
              <span>Por: {req.senderName}</span>
            </div>
            {req.description && (
              <p className="mt-1 truncate text-xs text-slate-500" title={req.description}>
                {req.description}
              </p>
            )}
          </div>
        </div>
        <span
          className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-600 ${getStatusBadgeClass(req.status)}`}
        >
          {getStatusIcon(req.status)}
          {getStatusLabel(req.status)}
        </span>
        <div
          className="min-w-0"
          aria-label={`${done} de ${total} participaciones completadas, ${progress}%`}
        >
          <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="whitespace-nowrap font-500">
              {done} de {total} completados
            </span>
            <span>{progress}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
          </div>
        </div>
        <div className="flex min-w-0 items-start gap-2 text-xs text-muted-foreground">
          <Calendar size={15} className="mt-0.5 shrink-0 text-slate-500" aria-hidden="true" />
          <div className="min-w-0">
            {req.priority === 'Urgente' && (
              <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 font-600 text-red-600">
                <AlertTriangle size={11} />
                Urgente
              </span>
            )}
            {expiresSoon && req.priority !== 'Urgente' && (
              <span className="mb-1 inline-flex rounded-full bg-amber-50 px-2 py-0.5 font-600 text-amber-700">
                Próximo a vencer
              </span>
            )}
            <p className="whitespace-nowrap">{getParticipationDateLabel(req)}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          {req.currentAccess === false ? (
            <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
              Acceso revocado
            </span>
          ) : (
            <>
              {canAct && (
                <button
                  type="button"
                  onClick={() => router.push(`/firmar-documento/${req.supabaseId ?? req.id}`)}
                  className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-primary/30 bg-primary/5 px-3 text-xs font-600 text-primary hover:bg-primary/10"
                >
                  <FileSignature size={14} aria-hidden="true" />
                  {getParticipationActionLabel(req)}
                </button>
              )}
              <button
                type="button"
                onClick={() => router.push(`/visor-documento/${req.supabaseId ?? req.id}`)}
                className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-primary px-3 text-xs font-600 text-white hover:bg-primary/90"
              >
                <Eye size={14} aria-hidden="true" />
                Ver documento
              </button>
            </>
          )}
          <ParticipationActionsMenu
            req={req}
            expanded={showDetails}
            onToggle={() => setShowDetails((value) => !value)}
            variant="list"
          />
        </div>
      </div>
      {showDetails && (
        <div id={detailsId} className="border-t border-slate-200 bg-slate-50/60 p-3 sm:p-4">
          <ParticipationDetails req={req} />
        </div>
      )}
    </article>
  );
}

function ParticipationCardGrid({ req }: ParticipationCardProps) {
  const router = useRouter();
  const [showDetails, setShowDetails] = useState(false);
  const [openedAt] = useState(() => Date.now());
  const total = Math.max(0, req.signaturesTotal);
  const done = Math.max(0, req.signaturesDone);
  const progress = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const expiresSoon = isParticipationNearExpiry(req, openedAt);
  const cardTone =
    req.status === 'completado'
      ? 'border-emerald-200 bg-white'
      : req.status === 'vencido' || req.status === 'rechazado'
        ? 'border-red-200 bg-white'
        : expiresSoon
          ? 'border-amber-200 bg-white'
          : 'border-slate-200/90 bg-white';
  const detailsId = `grid-participation-details-${req.id}`;
  const participantStatuses = Array.from(
    (req.participantList ?? []).reduce((counts, participant) => {
      const label = getParticipantStatusLabel(participant.status);
      const previous = counts.get(label);
      counts.set(label, { count: (previous?.count ?? 0) + 1, status: participant.status });
      return counts;
    }, new Map<string, { count: number; status?: string }>())
  );
  const participantNameParts = req.participantList?.[0]?.name.trim().split(/\s+/).filter(Boolean) ?? [];
  const initials = participantNameParts.length > 1
    ? `${participantNameParts[0][0]}${participantNameParts[participantNameParts.length - 1][0]}`.toUpperCase()
    : participantNameParts[0]?.slice(0, 2).toUpperCase() || '—';

  return (
    <article
      className={`flex h-full min-w-0 flex-col gap-3 rounded-lg border p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] hover:border-slate-300 ${cardTone}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${expiresSoon ? 'bg-amber-50 text-amber-600' : getDocumentIconTone(req.status)}`}
          >
            <FileText size={21} aria-hidden="true" />
          </span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-500 ${expiresSoon ? 'bg-amber-100 text-amber-700' : req.status === 'vencido' ? 'bg-red-100 text-red-700' : getStatusBadgeClass(req.status)}`}
          >
            {expiresSoon ? <Clock size={14} aria-hidden="true" /> : req.status === 'vencido' ? <AlertTriangle size={14} aria-hidden="true" /> : getStatusIcon(req.status)}
            {expiresSoon ? 'Próximo a vencer' : getStatusLabel(req.status)}
          </span>
          {req.priority === 'Urgente' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-[11px] text-red-600">
              <AlertTriangle size={12} aria-hidden="true" />
              Urgente
            </span>
          )}
        </div>
        <ParticipationActionsMenu
          req={req}
          expanded={showDetails}
          onToggle={() => setShowDetails((value) => !value)}
          variant="grid"
        />
      </div>
      <div className="min-w-0">
        <h3 className="truncate text-base font-600 text-foreground" title={req.documentName}>
          {req.documentName}
        </h3>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {req.documentType || 'Documento'} · Recibido: {formatExpiresAt(req.receivedAt)}
        </p>
        <p
          className="mt-2 min-h-9 line-clamp-2 text-sm leading-relaxed text-slate-500"
          title={req.description || undefined}
        >
          {req.description || ' '}
        </p>
      </div>
      <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
        <User size={13} className="shrink-0" aria-hidden="true" />
        Por: <span className="truncate font-500 text-foreground">{req.senderName}</span>
      </p>
      <div className="mt-auto space-y-3">
        <div className="flex w-full items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-600 text-slate-600">{initials}</span>
          {req.participants > 1 && <span className="-ml-4 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-white bg-slate-100 text-xs text-slate-600">+{req.participants - 1}</span>}
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-500 text-foreground">
              {req.participants} {req.participants === 1 ? 'participante' : 'participantes'}
            </span>
            <span className="block text-xs text-muted-foreground">
              {done} de {total} completados
            </span>
          </span>
          <span className="text-xs font-600 text-foreground">{progress}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
          <div className={`h-full rounded-full ${req.status === 'completado' ? 'bg-emerald-500' : 'bg-primary'}`} style={{ width: `${progress}%` }} />
        </div>
        {participantStatuses.length > 0 && (
          <div className="flex min-h-6 flex-wrap items-center gap-1.5">
            {participantStatuses.map(([label, value]) => (
              <span key={label} className={`rounded-full px-2.5 py-1 text-[11px] font-500 ${getParticipantStatusBadge(value.status ?? 'En revisión')}`}>
                {value.count} {label.toLowerCase()}
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {req.mySignatureStatus && (
            <span
              className={`rounded-full px-2 py-0.5 ${getMySignatureBadge(req.mySignatureStatus)}`}
            >
              {req.mySignatureStatus}
            </span>
          )}
          {getActoLabel(req) && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
              {getActoLabel(req)}
            </span>
          )}
          {req.legalHoldActive && <LegalHoldBadge />}
        </div>
        <p className={`flex min-h-8 items-center gap-2 text-xs ${req.status === 'vencido' || expiresSoon ? 'text-red-600' : 'text-muted-foreground'}`}>
          <Calendar size={14} className={`shrink-0 ${req.status === 'vencido' || expiresSoon ? 'text-red-500' : 'text-slate-500'}`} aria-hidden="true" />
          {getParticipationDateLabel(req)}
        </p>
        {req.currentAccess === false ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-center text-xs text-slate-500">
            Acceso revocado
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => router.push(`/visor-documento/${req.supabaseId ?? req.id}`)}
              className="inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-sm font-600 text-white hover:bg-primary/90"
            >
              <Eye size={14} aria-hidden="true" />
              Ver documento
            </button>
            <ParticipationActionsMenu
              req={req}
              expanded={showDetails}
              onToggle={() => setShowDetails((value) => !value)}
              variant="grid-footer"
            />
          </div>
        )}
        <button
          type="button"
          onClick={() => setShowDetails((value) => !value)}
          aria-expanded={showDetails}
          aria-controls={detailsId}
          aria-label={`${showDetails ? 'Ocultar' : 'Ver'} participantes de ${req.documentName}`}
          className="flex w-full items-center justify-between gap-2 border-t border-slate-100 pt-2 text-left text-xs font-500 text-slate-600 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <span className="inline-flex items-center gap-2"><Users size={14} aria-hidden="true" />{showDetails ? 'Ocultar participantes' : 'Ver participantes'}</span>
          <ChevronDown size={15} aria-hidden="true" className={showDetails ? 'rotate-180' : ''} />
        </button>
      </div>
      {showDetails && (
        <div id={detailsId} className="border-t border-slate-200 pt-3">
          <ParticipationDetails req={req} />
        </div>
      )}
    </article>
  );
}

// ─── Kanban Card ─────────────────────────────────────────────────────────────
function KanbanCard({ req }: ParticipationCardProps) {
  const router = useRouter();
  const [showDetails, setShowDetails] = useState(false);
  const [openedAt] = useState(() => Date.now());
  const total = Math.max(0, req.signaturesTotal);
  const done = Math.max(0, req.signaturesDone);
  const progress = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const canAct = canActOnParticipation(req);
  const expiresSoon = isParticipationNearExpiry(req, openedAt);
  const cardTone =
    req.status === 'completado'
      ? 'border-emerald-200/70 bg-gradient-to-br from-emerald-50/50 via-white to-white'
      : req.status === 'vencido' || req.status === 'rechazado'
        ? 'border-red-200/70 bg-gradient-to-br from-red-50/50 via-white to-white'
        : expiresSoon
          ? 'border-amber-200/70 bg-gradient-to-br from-amber-50/50 via-white to-white'
          : 'border-slate-200/90 bg-gradient-to-br from-primary/5 via-white to-white';
  const detailsId = `board-participation-details-${req.id}`;

  return (
    <article
      className={`flex min-w-0 flex-col gap-3 rounded-lg border p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-colors hover:border-slate-300 ${cardTone}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${getDocumentIconTone(req.status)}`}
          >
            <FileText size={18} aria-hidden="true" />
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-500 ${expiresSoon ? 'bg-amber-100 text-amber-700' : getStatusBadgeClass(req.status)}`}
          >
            {expiresSoon ? <Clock size={12} aria-hidden="true" /> : getStatusIcon(req.status)}
            {expiresSoon ? 'Próximo a vencer' : getStatusLabel(req.status)}
          </span>
          {(req.priority === 'Urgente' || req.priority === 'Alta') && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-[11px] text-red-600">
              <AlertTriangle size={11} aria-hidden="true" />{' '}
              {req.priority === 'Urgente' ? 'Urgente' : 'Alta prioridad'}
            </span>
          )}
        </div>
        <ParticipationActionsMenu
          req={req}
          expanded={showDetails}
          onToggle={() => setShowDetails((value) => !value)}
          variant="board"
        />
      </div>

      <div className="min-w-0">
        <h3
          className="line-clamp-2 text-sm font-600 leading-snug text-foreground"
          title={req.documentName}
        >
          {req.documentName}
        </h3>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {req.documentType || 'Documento'} · Recibido: {formatExpiresAt(req.receivedAt)}
        </p>
        {req.description && (
          <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-slate-500">
            {req.description}
          </p>
        )}
      </div>

      <p className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
        <User size={13} className="shrink-0" aria-hidden="true" />
        Por: <span className="truncate font-500 text-foreground">{req.senderName}</span>
      </p>

      <div className="space-y-2 border-t border-slate-200/70 pt-3">
        <button
          type="button"
          onClick={() => setShowDetails((value) => !value)}
          aria-expanded={showDetails}
          aria-controls={detailsId}
          className="flex w-full items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ParticipantsIcon count={req.participants} />
          </span>
          <span className="min-w-0 flex-1 text-[11px] text-foreground">
            {req.participants} {req.participants === 1 ? 'participante' : 'participantes'}
            <span className="block text-muted-foreground">
              {done} de {total} completados
            </span>
          </span>
          <span className="text-xs font-600 text-foreground">{progress}%</span>
        </button>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-slate-200"
          aria-label={`${progress}% completado`}
        >
          <div
            className={`h-full rounded-full ${progress === 100 ? 'bg-emerald-500' : 'bg-primary'}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          {req.mySignatureStatus && (
            <span
              className={`rounded-full px-2 py-0.5 ${getMySignatureBadge(req.mySignatureStatus)}`}
            >
              {req.mySignatureStatus}
            </span>
          )}
          {getActoLabel(req) && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
              {getActoLabel(req)}
            </span>
          )}
          {req.legalHoldActive && <LegalHoldBadge />}
        </div>
      </div>

      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
        <Calendar size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>{getParticipationDateLabel(req)}</span>
      </p>
      {req.currentAccess === false ? (
        <div className="flex h-9 items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 text-xs text-slate-500">
          <Ban size={13} aria-hidden="true" /> Acceso revocado
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => router.push(`/visor-documento/${req.supabaseId ?? req.id}`)}
            className="flex h-9 min-w-0 flex-1 items-center justify-center gap-1 rounded-md bg-primary px-2 text-xs font-600 text-white hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <Eye size={13} aria-hidden="true" /> Ver documento
          </button>
          {canAct && (
            <button
              type="button"
              onClick={() => router.push(`/firmar-documento/${req.supabaseId ?? req.id}`)}
              className="flex h-9 items-center justify-center gap-1 rounded-md border border-primary/30 bg-white px-2 text-xs font-600 text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              aria-label={getParticipationActionLabel(req)}
            >
              <FileSignature size={13} aria-hidden="true" />{' '}
              {getParticipationActionLabel(req).startsWith('Aprobar') ? 'Aprobar' : 'Firmar'}
            </button>
          )}
        </div>
      )}

      {showDetails && (
        <div id={detailsId} className="space-y-2 border-t border-slate-200 pt-3">
          {req.participantList?.map((participant, index) => (
            <div key={index} className="rounded-md border border-slate-200 bg-white/80 p-2">
              <p className="truncate text-xs font-600 text-foreground">{participant.name}</p>
              <p className="truncate text-[11px] text-muted-foreground">{participant.email}</p>
              {(participant.rol || participant.acto) && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {[participant.rol, participant.acto].filter(Boolean).join(' · ')}
                </p>
              )}
              {participant.status && (
                <span
                  className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] ${getParticipantStatusBadge(participant.status)}`}
                >
                  {getParticipantStatusLabel(participant.status)}
                </span>
              )}
            </div>
          ))}
          {!req.participantList?.length && (
            <p className="text-[11px] text-muted-foreground">Sin participantes disponibles.</p>
          )}
        </div>
      )}
    </article>
  );
}

function CalendarParticipationCard({
  req,
  density = 'compact',
}: {
  req: MyParticipation;
  density?: 'compact' | 'standard' | 'expanded';
}) {
  const router = useRouter();
  const compact = density === 'compact';
  const expanded = density === 'expanded';
  const total = Math.max(0, req.signaturesTotal);
  const done = Math.max(0, req.signaturesDone);
  const progress = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const tone =
    req.status === 'completado'
      ? 'border-emerald-200 bg-emerald-50/60'
      : req.status === 'vencido' || req.status === 'rechazado'
        ? 'border-red-200 bg-red-50/60'
        : req.status === 'pendiente' || req.status === 'en-espera'
          ? 'border-amber-200 bg-amber-50/60'
          : req.status === 'cancelado'
            ? 'border-slate-200 bg-slate-50'
            : 'border-primary/20 bg-primary/5';

  return (
    <button
      type="button"
      onClick={() => router.push(`/visor-documento/${req.supabaseId ?? req.id}`)}
      aria-label={`Ver documento ${req.documentName}, ${getStatusLabel(req.status)}`}
      title={req.documentName}
      className={`group block w-full min-w-0 rounded-md border text-left transition-colors hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${compact ? 'p-1.5' : expanded ? 'p-3.5' : 'p-2.5'} ${tone}`}
    >
      <span className="flex min-w-0 items-start gap-1.5">
        <span
          className={`flex shrink-0 items-center justify-center rounded-md ${compact ? 'h-5 w-5' : 'h-8 w-8'} ${getDocumentIconTone(req.status)}`}
        >
          <FileText size={compact ? 12 : 16} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          {!compact && (
            <span
              className={`mb-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] ${getStatusBadgeClass(req.status)}`}
            >
              {getStatusIcon(req.status)} {getStatusLabel(req.status)}
            </span>
          )}
          <span
            className={`block font-600 leading-snug text-slate-900 ${compact ? 'truncate text-[11px]' : 'line-clamp-2 text-xs'}`}
          >
            {req.documentName}
          </span>
        </span>
      </span>
      {compact ? (
        <span className="mt-1 flex min-w-0 items-center justify-between gap-1 text-[10px] text-slate-600">
          <span className="truncate">{getStatusLabel(req.status)}</span>
          <span className="shrink-0">
            {req.participants} {req.participants === 1 ? 'part.' : 'parts.'}
          </span>
        </span>
      ) : (
        <span className="mt-2 block space-y-2">
          <span className="block truncate text-[11px] text-slate-500">
            {req.documentType || 'Documento'} · Por: {req.senderName}
          </span>
          {expanded && req.description && (
            <span className="line-clamp-2 text-[11px] leading-relaxed text-slate-500">
              {req.description}
            </span>
          )}
          <span className="flex items-center justify-between gap-1 text-[11px] text-slate-600">
            <span>
              {req.participants} {req.participants === 1 ? 'participante' : 'participantes'} ·{' '}
              {done}/{total}
            </span>
            <span className="font-600 text-slate-800">{progress}%</span>
          </span>
          <span className="block h-1 overflow-hidden rounded-full bg-slate-200">
            <span
              className={`block h-full rounded-full ${progress === 100 ? 'bg-emerald-500' : 'bg-primary'}`}
              style={{ width: `${progress}%` }}
            />
          </span>
          {req.mySignatureStatus && (
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-[10px] ${getMySignatureBadge(req.mySignatureStatus)}`}
            >
              {req.mySignatureStatus}
            </span>
          )}
          <span className="flex items-start gap-1 text-[11px] text-slate-500">
            <Calendar size={12} className="mt-0.5 shrink-0" aria-hidden="true" />{' '}
            {getParticipationDateLabel(req)}
          </span>
          {(req.priority === 'Urgente' || req.priority === 'Alta') && (
            <span className="inline-flex items-center gap-1 text-[10px] text-red-600">
              <AlertTriangle size={11} aria-hidden="true" />{' '}
              {req.priority === 'Urgente' ? 'Urgente' : 'Alta prioridad'}
            </span>
          )}
          {expanded && (
            <span className="flex items-center gap-1 border-t border-slate-200 pt-2 text-xs font-600 text-primary">
              <Eye size={13} aria-hidden="true" /> Ver documento
            </span>
          )}
        </span>
      )}
    </button>
  );
}

// ─── Month Calendar ───────────────────────────────────────────────────────────
function MonthCalendar({
  year,
  month,
  today,
  items,
  calFilter,
}: {
  year: number;
  month: number;
  today: Date;
  items: MyParticipation[];
  calFilter: CalendarStatusFilter;
}) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = firstDay.getDay() === 0 ? -6 : firstDay.getDay() - 1;

  const cells: { date: Date; isCurrentMonth: boolean }[] = [];
  for (let i = startOffset - 1; i >= 0; i--) {
    cells.push({ date: new Date(year, month, -i), isCurrentMonth: false });
  }
  for (let d = 1; d <= lastDay.getDate(); d++) {
    cells.push({ date: new Date(year, month, d), isCurrentMonth: true });
  }
  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++) {
    cells.push({ date: new Date(year, month + 1, d), isCurrentMonth: false });
  }

  const rows: { date: Date; isCurrentMonth: boolean }[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  return (
    <div className="flex-1 flex flex-col">
      <div className="grid grid-cols-7 border-b border-gray-200">
        {DAYS_SHORT.map((d) => (
          <div
            key={d}
            className="py-2 text-center text-xs font-600 text-primary border-r border-gray-200 last:border-r-0"
          >
            {d}
          </div>
        ))}
      </div>
      <div className="flex-1 flex flex-col">
        {rows.map((row, ri) => (
          <div
            key={ri}
            className="flex-1 grid grid-cols-7 border-b border-gray-200 last:border-b-0"
            style={{ minHeight: '90px' }}
          >
            {row.map((cell, ci) => {
              const isToday = isSameDay(cell.date, today);
              const dayItems = getParticipationsForDay(cell.date, items, calFilter);
              return (
                <div
                  key={ci}
                  className={`border-r border-gray-200 last:border-r-0 p-1.5 relative ${isToday ? 'bg-primary/5' : ''} ${!cell.isCurrentMonth ? 'bg-gray-50/50' : ''}`}
                >
                  <div className="flex items-start justify-start mb-1">
                    {isToday ? (
                      <span className="w-6 h-6 rounded-full bg-primary text-white text-xs font-600 flex items-center justify-center">
                        {cell.date.getDate()}
                      </span>
                    ) : (
                      <span
                        className={`text-xs font-500 ${cell.isCurrentMonth ? 'text-gray-800' : 'text-gray-400'}`}
                      >
                        {cell.date.getDate()}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {dayItems.slice(0, 2).map((req) => (
                      <CalendarParticipationCard key={req.id} req={req} />
                    ))}
                    {dayItems.length > 2 && (
                      <span className="text-[10px] text-muted-foreground/60 pl-1">
                        +{dayItems.length - 2} más
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Week Calendar (board-style when no hourly events) ───────────────────────
function WeekCalendar({
  weekStart,
  today,
  items,
  calFilter,
}: {
  weekStart: Date;
  today: Date;
  items: MyParticipation[];
  calFilter: CalendarStatusFilter;
}) {
  const days: Date[] = Array.from({ length: 7 }, (_, i) => {
    let d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  function hasSpecificTime(dateStr: string): boolean {
    let d = new Date(dateStr);
    const h = d.getHours();
    const m = d.getMinutes();
    if (h === 0 && m === 0) return false;
    if (h === 23 && m === 59) return false;
    return true;
  }

  function getRelevantDateStr(req: MyParticipation): string | undefined {
    if (calFilter === 'todos') {
      switch (req.status) {
        case 'pendiente':
        case 'en-progreso':
        case 'en-espera':
          return req.receivedAt;
        case 'completado':
          return req.completedAt ?? req.receivedAt;
        case 'vencido':
          return req.expiredAt ?? req.expiresAt ?? undefined;
        case 'rechazado':
          return req.rejectedAt ?? req.receivedAt;
        case 'cancelado':
          return req.canceladoAt ?? req.receivedAt;
        default:
          return req.receivedAt;
      }
    }
    if (calFilter === 'urgente') return req.receivedAt;
    if (calFilter === 'proximo-a-vencer') return req.expiresAt ?? undefined;
    switch (calFilter) {
      case 'en-progreso':
      case 'en-espera':
        return req.receivedAt;
      case 'completado':
        return req.completedAt;
      case 'vencido':
        return req.expiredAt ?? req.expiresAt ?? undefined;
      case 'rechazado':
        return req.rejectedAt;
      case 'cancelado':
        return req.canceladoAt;
    }
    return undefined;
  }

  const weekItems = days.flatMap((day) => getParticipationsForDay(day, items, calFilter));
  const hasHourlyEvents = weekItems.some((req) => {
    const ds = getRelevantDateStr(req);
    return ds ? hasSpecificTime(ds) : false;
  });

  if (!hasHourlyEvents) {
    return (
      <div className="flex-1 flex flex-col">
        <div className="grid grid-cols-7 border-b border-gray-200">
          {days.map((day, i) => {
            const isToday = isSameDay(day, today);
            return (
              <div key={i} className="py-2 text-center border-r border-gray-200 last:border-r-0">
                <div className={`text-xs font-600 ${isToday ? 'text-primary' : 'text-gray-500'}`}>
                  {DAYS_SHORT[i]}
                </div>
                <div className="flex items-center justify-center mt-0.5">
                  {isToday ? (
                    <span className="w-7 h-7 rounded-full bg-primary text-white text-sm font-600 flex items-center justify-center">
                      {day.getDate()}
                    </span>
                  ) : (
                    <span className="text-sm font-500 text-gray-700">{day.getDate()}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex-1 grid grid-cols-7" style={{ minHeight: '200px' }}>
          {days.map((day, di) => {
            const isToday = isSameDay(day, today);
            const dayItems = getParticipationsForDay(day, items, calFilter);
            return (
              <div
                key={di}
                className={`border-r border-gray-200 last:border-r-0 p-2 ${isToday ? 'bg-primary/5' : ''}`}
              >
                <div className="flex flex-col gap-1">
                  {dayItems.map((req) => (
                    <CalendarParticipationCard key={req.id} req={req} density="standard" />
                  ))}
                  {dayItems.length === 0 && <div className="h-8" />}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-auto">
      <div
        className="grid border-b border-gray-200"
        style={{ gridTemplateColumns: '56px repeat(7, 1fr)' }}
      >
        <div className="border-r border-gray-200" />
        {days.map((day, i) => {
          const isToday = isSameDay(day, today);
          return (
            <div key={i} className="py-2 text-center border-r border-gray-200 last:border-r-0">
              <div className={`text-xs font-600 ${isToday ? 'text-primary' : 'text-gray-500'}`}>
                {DAYS_SHORT[i]}
              </div>
              <div className="flex items-center justify-center mt-0.5">
                {isToday ? (
                  <span className="w-7 h-7 rounded-full bg-primary text-white text-sm font-600 flex items-center justify-center">
                    {day.getDate()}
                  </span>
                ) : (
                  <span className="text-sm font-500 text-gray-700">{day.getDate()}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex-1 overflow-y-auto" style={{ maxHeight: '520px' }}>
        {HOURS.map((hour) => (
          <div
            key={hour}
            className="grid border-b border-gray-100"
            style={{ gridTemplateColumns: '56px repeat(7, 1fr)', minHeight: '48px' }}
          >
            <div className="border-r border-gray-200 px-2 py-1 text-[10px] text-gray-400 text-right leading-none pt-1">
              {hour === 0 ? '' : `${hour.toString().padStart(2, '0')}:00`}
            </div>
            {days.map((day, di) => {
              const isToday = isSameDay(day, today);
              const dayItems = getParticipationsForDay(day, items, calFilter).filter((req) => {
                const ds = getRelevantDateStr(req);
                return ds ? new Date(ds).getHours() === hour : false;
              });
              return (
                <div
                  key={di}
                  className={`border-r border-gray-100 last:border-r-0 px-0.5 py-0.5 relative overflow-hidden ${isToday ? 'bg-primary/5' : ''}`}
                >
                  {dayItems.map((req) => (
                    <CalendarParticipationCard key={req.id} req={req} />
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Day Calendar ─────────────────────────────────────────────────────────────
function DayCalendar({
  date,
  today,
  items,
  calFilter,
}: {
  date: Date;
  today: Date;
  items: MyParticipation[];
  calFilter: CalendarStatusFilter;
}) {
  const isToday = isSameDay(date, today);
  const dayName = DAYS_SHORT[(date.getDay() + 6) % 7];

  function getRelevantDateStr(req: MyParticipation): string | undefined {
    if (calFilter === 'todos') {
      switch (req.status) {
        case 'pendiente':
        case 'en-progreso':
        case 'en-espera':
          return req.receivedAt;
        case 'completado':
          return req.completedAt ?? req.receivedAt;
        case 'vencido':
          return req.expiredAt ?? req.expiresAt ?? undefined;
        case 'rechazado':
          return req.rejectedAt ?? req.receivedAt;
        case 'cancelado':
          return req.canceladoAt ?? req.receivedAt;
        default:
          return req.receivedAt;
      }
    }
    if (calFilter === 'urgente') return req.receivedAt;
    if (calFilter === 'proximo-a-vencer') return req.expiresAt ?? undefined;
    switch (calFilter) {
      case 'en-progreso':
      case 'en-espera':
        return req.receivedAt;
      case 'completado':
        return req.completedAt;
      case 'vencido':
        return req.expiredAt ?? req.expiresAt ?? undefined;
      case 'rechazado':
        return req.rejectedAt;
      case 'cancelado':
        return req.canceladoAt;
    }
    return undefined;
  }

  function hasSpecificTime(dateStr: string): boolean {
    let d = new Date(dateStr);
    const h = d.getHours();
    const m = d.getMinutes();
    if (h === 0 && m === 0) return false;
    if (h === 23 && m === 59) return false;
    return true;
  }

  const allDayItems = getParticipationsForDay(date, items, calFilter).filter((req) => {
    const ds = getRelevantDateStr(req);
    return ds ? !hasSpecificTime(ds) : false;
  });

  const hasHourlyEvents = getParticipationsForDay(date, items, calFilter).some((req) => {
    const ds = getRelevantDateStr(req);
    return ds ? hasSpecificTime(ds) : false;
  });

  if (!hasHourlyEvents) {
    return (
      <div className="flex-1 flex flex-col overflow-auto">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200/60">
          <div className={`text-sm font-600 ${isToday ? 'text-primary' : 'text-gray-500'}`}>
            {dayName}
          </div>
          {isToday ? (
            <span className="w-9 h-9 rounded-full bg-primary text-white text-lg font-600 flex items-center justify-center">
              {date.getDate()}
            </span>
          ) : (
            <span className="text-2xl font-600 text-gray-700">{date.getDate()}</span>
          )}
          <span className="text-sm text-gray-500">
            {MONTHS_ES[date.getMonth()]} {date.getFullYear()}
          </span>
        </div>
        <div className="flex-1 p-4">
          {allDayItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Inbox size={32} className="text-muted-foreground/30" strokeWidth={1.5} />
              <span className="text-xs text-muted-foreground/60 mt-2">
                Sin participaciones para este día
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {allDayItems.map((req) => (
                <CalendarParticipationCard key={req.id} req={req} density="expanded" />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-auto">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200/60">
        <div className={`text-sm font-600 ${isToday ? 'text-primary' : 'text-gray-500'}`}>
          {dayName}
        </div>
        {isToday ? (
          <span className="w-9 h-9 rounded-full bg-primary text-white text-lg font-600 flex items-center justify-center">
            {date.getDate()}
          </span>
        ) : (
          <span className="text-2xl font-600 text-gray-700">{date.getDate()}</span>
        )}
        <span className="text-sm text-gray-500">
          {MONTHS_ES[date.getMonth()]} {date.getFullYear()}
        </span>
      </div>

      {allDayItems.length > 0 && (
        <div className="border-b border-gray-200/60 px-4 py-2 bg-gray-50/60">
          <div className="flex items-start gap-3">
            <div className="w-16 flex-shrink-0 text-[10px] text-gray-400 text-right pt-1 pr-2">
              Todo el día
            </div>
            <div className="flex-1 flex flex-col gap-1">
              {allDayItems.map((req) => (
                <CalendarParticipationCard key={req.id} req={req} density="standard" />
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto" style={{ maxHeight: '520px' }}>
        {HOURS.map((hour) => {
          const dayItems = getParticipationsForDay(date, items, calFilter).filter((req) => {
            const ds = getRelevantDateStr(req);
            if (!ds || !hasSpecificTime(ds)) return false;
            return new Date(ds).getHours() === hour;
          });
          return (
            <div key={hour} className="flex border-b border-gray-100" style={{ minHeight: '56px' }}>
              <div className="w-16 flex-shrink-0 px-2 py-1 text-[10px] text-gray-400 text-right border-r border-gray-200 leading-none pt-1">
                {hour === 0 ? '' : `${hour.toString().padStart(2, '0')}:00`}
              </div>
              <div className="flex-1 px-2 py-1">
                {dayItems.map((req) => (
                  <CalendarParticipationCard key={req.id} req={req} density="standard" />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function MisParticipacionesPage() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const { user } = useAuth();

  const [items, setItems] = useState<MyParticipation[]>([]);
  const [summaryNow] = useState(() => Date.now());
  const [loadingData, setLoadingData] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('lista');
  const [listLayout, setListLayout] = useState<'list' | 'grid'>('list');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('en-progreso');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('30');
  const [showPeriodDropdown, setShowPeriodDropdown] = useState(false);
  const [showCustomPeriod, setShowCustomPeriod] = useState(false);
  const [customPeriodDraft, setCustomPeriodDraft] = useState({ start: '', end: '' });
  const [customPeriodRange, setCustomPeriodRange] = useState({ start: '', end: '' });
  const [customPeriodError, setCustomPeriodError] = useState('');
  // periodFilter removed - tablero filters by boardMonth/boardYear
  const [dateSort, setDateSort] = useState<'recientes' | 'antiguos'>('recientes');
  const [showDateDropdown, setShowDateDropdown] = useState(false);
  const [showCalViewDropdown, setShowCalViewDropdown] = useState(false);
  const [calView, setCalView] = useState<CalendarView>('mes');
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth());
  const [calWeekStart, setCalWeekStart] = useState<Date>(getWeekStart(today));
  const [calDay, setCalDay] = useState<Date>(new Date(today));
  const [boardMonth, setBoardMonth] = useState(now.getMonth());
  const [boardYear, setBoardYear] = useState(now.getFullYear());
  const [calFilter, setCalFilter] = useState<CalendarStatusFilter>('todos');

  const dateSortRef = useRef<HTMLDivElement>(null);
  const periodDropdownRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowCalViewDropdown(false);
      }
      if (dateSortRef.current && !dateSortRef.current.contains(e.target as Node)) {
        setShowDateDropdown(false);
      }
      if (periodDropdownRef.current && !periodDropdownRef.current.contains(e.target as Node)) {
        setShowPeriodDropdown(false);
        setShowCustomPeriod(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const showTimeFilter = TERMINAL_STATUSES.includes(statusFilter);
  const selectedPeriodLabel =
    timeFilter === 'custom'
      ? 'Rango personalizado'
      : (timeFilterOptions.find((option) => option.value === timeFilter)?.label ??
        'Últimos 30 días');

  const filtered = React.useMemo(() => {
    let result = items.filter((r) => {
      if (statusFilter === 'urgente') {
        if (r.priority !== 'Urgente') return false;
        if (r.status !== 'en-progreso') return false;
      } else if (statusFilter === 'proximo-a-vencer') {
        const nowTs = new Date();
        if (r.status !== 'en-progreso') return false;
        if (!r.expiresAt) return false;
        const expires = new Date(r.expiresAt);
        const diffHours = (expires.getTime() - nowTs.getTime()) / (1000 * 60 * 60);
        if (diffHours < 0 || diffHours > 72) return false;
      } else if (statusFilter !== 'todos' && r.status !== statusFilter) {
        return false;
      }
      // Time filter — only apply for terminal statuses
      if (TERMINAL_STATUSES.includes(statusFilter) && timeFilter !== 'todos') {
        let dateStr: string | undefined;
        switch (r.status) {
          case 'completado':
            dateStr = r.completedAt ?? r.receivedAt;
            break;
          case 'vencido':
            dateStr = r.expiredAt ?? r.expiresAt ?? r.receivedAt;
            break;
          case 'rechazado':
            dateStr = r.rejectedAt ?? r.receivedAt;
            break;
          case 'cancelado':
            dateStr = r.canceladoAt ?? r.receivedAt;
            break;
          default:
            dateStr = r.receivedAt;
        }
        const eventTime = dateStr ? new Date(dateStr).getTime() : NaN;
        if (!Number.isFinite(eventTime)) return false;
        if (timeFilter === 'custom') {
          if (!customPeriodRange.start || !customPeriodRange.end) return false;
          const start = new Date(`${customPeriodRange.start}T00:00:00`).getTime();
          const end = new Date(`${customPeriodRange.end}T23:59:59.999`).getTime();
          if (eventTime < start || eventTime > end) return false;
        } else {
          const cutoff = new Date();
          if (timeFilter === 'today') cutoff.setHours(0, 0, 0, 0);
          else cutoff.setDate(cutoff.getDate() - Number(timeFilter));
          if (eventTime < cutoff.getTime()) return false;
        }
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        if (
          !r.documentName.toLowerCase().includes(q) &&
          !r.senderName.toLowerCase().includes(q) &&
          !r.senderEmail.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });

    result = [...result].sort((a, b) => {
      if (dateSort === 'recientes') {
        const operationalDifference =
          operationalPriorityRank({
            priority:
              a.priority === 'Urgente' ? 'urgent' : a.priority === 'Alta' ? 'high' : 'normal',
            expiresAt: a.expiresAt,
          }) -
          operationalPriorityRank({
            priority:
              b.priority === 'Urgente' ? 'urgent' : b.priority === 'Alta' ? 'high' : 'normal',
            expiresAt: b.expiresAt,
          });
        if (operationalDifference) return operationalDifference;
      }
      const da = new Date(a.receivedAt).getTime();
      const db = new Date(b.receivedAt).getTime();
      return dateSort === 'recientes' ? db - da : da - db;
    });

    return result;
  }, [items, statusFilter, timeFilter, customPeriodRange, search, dateSort]);

  // Month-filtered items for tablero (filter by boardMonth/boardYear)
  const boardFiltered = React.useMemo(() => {
    return items.filter((r) => {
      let dateStr: string;
      if (TERMINAL_STATUSES.includes(r.status)) {
        dateStr = r.completedAt ?? r.canceladoAt ?? r.expiredAt ?? r.rejectedAt ?? r.receivedAt;
      } else {
        dateStr = r.receivedAt;
      }
      let d = new Date(dateStr);
      return d.getFullYear() === boardYear && d.getMonth() === boardMonth;
    });
  }, [items, boardMonth, boardYear]);

  const summaryMetrics: ActivitySummaryMetric[] = React.useMemo(() => {
    const requiresAction = items.filter((item) =>
      item.status === 'en-progreso' &&
      item.currentAccess !== false &&
      !PARTICIPATED_STATUSES.includes(item.mySignatureStatus ?? '')
    );
    const dueSoon = requiresAction.filter((item) => {
      if (!item.expiresAt) return false;
      const remaining = new Date(item.expiresAt).getTime() - summaryNow;
      return remaining >= 0 && remaining <= 72 * 60 * 60 * 1000;
    }).length;
    return [
      { label: 'Total de participaciones', value: items.length, icon: Inbox, tone: 'blue' },
      { label: 'Pendientes de mi acción', value: requiresAction.length, icon: FileSignature, tone: 'indigo' },
      { label: 'Próximas a vencer (72 h)', value: dueSoon, icon: AlertTriangle, tone: 'amber' },
      { label: 'Documentos completados', value: items.filter((item) => item.status === 'completado').length, icon: CheckCircle2, tone: 'emerald' },
    ];
  }, [items, summaryNow]);

  function prevMonth() {
    if (boardMonth === 0) {
      setBoardMonth(11);
      setBoardYear((y) => y - 1);
    } else setBoardMonth((m) => m - 1);
  }
  function nextMonth() {
    if (boardMonth === 11) {
      setBoardMonth(0);
      setBoardYear((y) => y + 1);
    } else setBoardMonth((m) => m + 1);
  }
  function calPrev() {
    if (calView === 'mes') {
      if (calMonth === 0) {
        setCalMonth(11);
        setCalYear((y) => y - 1);
      } else setCalMonth((m) => m - 1);
    } else if (calView === 'semana') {
      const prev = new Date(calWeekStart);
      prev.setDate(prev.getDate() - 7);
      setCalWeekStart(prev);
    } else {
      const prev = new Date(calDay);
      prev.setDate(prev.getDate() - 1);
      setCalDay(prev);
    }
  }
  function calNext() {
    if (calView === 'mes') {
      if (calMonth === 11) {
        setCalMonth(0);
        setCalYear((y) => y + 1);
      } else setCalMonth((m) => m + 1);
    } else if (calView === 'semana') {
      const next = new Date(calWeekStart);
      next.setDate(next.getDate() + 7);
      setCalWeekStart(next);
    } else {
      const next = new Date(calDay);
      next.setDate(next.getDate() + 1);
      setCalDay(next);
    }
  }

  function getCalTitle(): string {
    if (calView === 'mes') return `${MONTHS_ES[calMonth]} ${calYear}`;
    if (calView === 'semana') {
      return `Semana Del ${calWeekStart.getDate()} ${MONTHS_ES[calWeekStart.getMonth()]}`;
    }
    return `${calDay.getDate()} de ${MONTHS_ES[calDay.getMonth()]} ${calDay.getFullYear()}`;
  }

  const calViewLabels: Record<CalendarView, string> = { mes: 'Mes', semana: 'Semana', dia: 'Día' };

  const fetchParticipaciones = useCallback(async () => {
    try {
      setLoadingData(true);
      setDataError(null);
      const res = await fetch(`/api/documentos/mis-participaciones?t=${Date.now()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Error ${res.status}`);
      }
      const body = await res.json();
      setItems(body.participaciones ?? []);
    } catch (err: any) {
      setDataError(err.message ?? 'Error al cargar participaciones');
    } finally {
      setLoadingData(false);
    }
  }, [setLoadingData, setDataError, setItems]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchParticipaciones();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchParticipaciones]);

  // Real-time: re-fetch when documentos or participantes rows change for this user
  useEffect(() => {
    if (!user?.id) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`mis-participaciones-rt-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'documentos', filter: `owner_id=eq.${user.id}` },
        () => fetchParticipaciones()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'participantes', filter: `user_id=eq.${user.id}` },
        () => fetchParticipaciones()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, fetchParticipaciones]);

  if (loadingData) {
    return (
      <AppLayout noPadding>
        <div className="-mx-4 -my-4 flex min-h-[calc(100vh-4rem)] items-center justify-center bg-[#f6f8fb] px-4 md:-my-6">
          <div className="flex flex-col items-center gap-3 rounded-lg border border-slate-200/90 bg-white px-8 py-7 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm text-slate-500">Cargando participaciones...</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout noPadding>
      <div className="-mx-4 -my-4 min-h-[calc(100vh-4rem)] bg-[#f6f8fb] px-4 py-4 sm:px-5 md:-my-6 md:py-5 lg:px-6">
        <div className="mx-auto w-full max-w-[1600px]">
          {/* Header */}
          <div className="mb-4 flex flex-col gap-3 border-b border-slate-200/80 pb-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-2xl font-600 leading-tight text-slate-950">
                Mis participaciones
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Consulta y atiende los documentos en los que participas.
              </p>
            </div>
          </div>

          {/* Data error banner */}
          {dataError && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-center gap-2">
              <AlertCircle size={16} className="flex-shrink-0" />
              {dataError}
            </div>
          )}

          <ActivitySummary
            id="participations-summary-metrics"
            title="Resumen de participaciones"
            description="Documentos que requieren tu atención y avance de tus participaciones."
            metrics={summaryMetrics}
          />

          {/* View toggle + Search row */}
          <section className="mb-4 overflow-visible rounded-lg border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="flex flex-col items-start justify-between gap-3 p-3 sm:flex-row sm:items-center">
              {/* View mode buttons */}
              <div className="flex h-9 items-center gap-0.5 rounded-md bg-slate-100 p-0.5">
                <button
                  onClick={() => setViewMode('lista')}
                  className={`flex h-8 items-center gap-1.5 rounded px-3 text-sm font-600 transition-colors ${viewMode === 'lista' ? 'bg-white text-slate-950 shadow-[0_1px_2px_rgba(15,23,42,0.08)]' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  <LayoutList size={15} />
                  Lista
                </button>
                <button
                  onClick={() => setViewMode('tablero')}
                  className={`flex h-8 items-center gap-1.5 rounded px-3 text-sm font-600 transition-colors ${viewMode === 'tablero' ? 'bg-white text-slate-950 shadow-[0_1px_2px_rgba(15,23,42,0.08)]' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  <LayoutGrid size={15} />
                  Tablero
                </button>
                <button
                  onClick={() => setViewMode('calendario')}
                  className={`flex h-8 items-center gap-1.5 rounded px-3 text-sm font-600 transition-colors ${viewMode === 'calendario' ? 'bg-white text-slate-950 shadow-[0_1px_2px_rgba(15,23,42,0.08)]' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  <CalendarDays size={15} />
                  Calendario
                </button>
              </div>

              {/* Right side */}
              {viewMode === 'tablero' ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-600 text-slate-400">Periodo</span>
                  <div className="flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-2">
                    <button
                      onClick={prevMonth}
                      className="p-0.5 rounded hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <span className="text-xs font-500 text-foreground min-w-[110px] text-center">
                      {MONTHS_ES[boardMonth].toLowerCase()} {boardYear}
                    </span>
                    <button
                      onClick={nextMonth}
                      className="p-0.5 rounded hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              ) : viewMode === 'calendario' ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-600 text-slate-400">Periodo</span>
                  <div className="relative" ref={dropdownRef}>
                    <button
                      onClick={() => setShowCalViewDropdown((v) => !v)}
                      className="flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-600 text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
                    >
                      {calViewLabels[calView]}
                      <ChevronDown size={14} className="text-muted-foreground" />
                    </button>
                    {showCalViewDropdown && (
                      <div className="absolute right-0 top-full mt-1 bg-white border border-border rounded-lg shadow-lg z-20 min-w-[110px] py-1">
                        {(['mes', 'semana', 'dia'] as CalendarView[]).map((v) => (
                          <button
                            key={v}
                            onClick={() => {
                              setCalView(v);
                              setShowCalViewDropdown(false);
                            }}
                            className={`w-full text-left px-4 py-2 text-sm transition-colors ${calView === v ? 'bg-primary/10 text-primary font-600' : 'text-foreground hover:bg-muted/50'}`}
                          >
                            {calViewLabels[v]}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <div className="relative min-w-[180px] flex-1 sm:w-72">
                    <Search
                      size={15}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    />
                    <input
                      type="text"
                      placeholder="Buscar..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="h-9 w-full rounded-md border border-slate-200 bg-slate-50/70 pl-9 pr-4 text-sm transition-colors focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/10"
                    />
                  </div>
                  {/* Date sort dropdown */}
                  <div className="relative" ref={dateSortRef}>
                    <button
                      onClick={() => setShowDateDropdown((v) => !v)}
                      className="flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-600 text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
                      title="Ordenar por fecha"
                    >
                      <ArrowUpDown size={15} />
                      <span className="hidden sm:inline">
                        {dateSort === 'recientes' ? 'Más recientes' : 'Más antiguos'}
                      </span>
                      <ChevronDown
                        size={13}
                        className={`transition-transform ${showDateDropdown ? 'rotate-180' : ''}`}
                      />
                    </button>
                    {showDateDropdown && (
                      <div className="absolute right-0 top-full mt-1 bg-white border border-border rounded-lg shadow-lg z-20 py-1">
                        {(
                          [
                            { value: 'recientes', label: 'Más recientes' },
                            { value: 'antiguos', label: 'Más antiguos' },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => {
                              setDateSort(opt.value);
                              setShowDateDropdown(false);
                            }}
                            className={`w-full text-left px-4 py-2 text-sm transition-colors ${dateSort === opt.value ? 'bg-primary/10 text-primary font-600' : 'text-foreground hover:bg-muted/50'}`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* List / Grid toggle */}
                  <div className="flex h-9 items-center overflow-hidden rounded-md border border-slate-200 bg-white p-0.5">
                    <button
                      onClick={() => setListLayout('list')}
                      className={`flex h-7 w-8 items-center justify-center rounded transition-colors ${listLayout === 'list' ? 'bg-slate-100 text-slate-950' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-700'}`}
                      title="Vista lista"
                    >
                      <LayoutList size={16} />
                    </button>
                    <button
                      onClick={() => setListLayout('grid')}
                      className={`flex h-7 w-8 items-center justify-center rounded transition-colors ${listLayout === 'grid' ? 'bg-primary text-white shadow-sm' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-700'}`}
                      title="Vista cuadrícula"
                    >
                      <LayoutGrid size={16} />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Status pill filters */}
            {viewMode !== 'tablero' && viewMode !== 'calendario' && (
              <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50/60 px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {statusFilterOptions.map((opt) => (
                      <button
                        type="button"
                        key={opt.value}
                        onClick={() => setStatusFilter(opt.value)}
                        className={`flex min-h-8 items-center rounded-md border px-2.5 text-xs font-normal transition-colors ${
                          statusFilter === opt.value
                            ? 'border-primary/25 bg-primary/5 text-primary'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {/* Time sub-filter — only for completed/closed statuses */}
                  {showTimeFilter && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Período:</span>
                      <div className="relative" ref={periodDropdownRef}>
                        <button
                          type="button"
                          onClick={() => {
                            setShowPeriodDropdown((open) => !open);
                            setShowCustomPeriod(false);
                          }}
                          aria-expanded={showPeriodDropdown}
                          aria-label={`Período: ${selectedPeriodLabel}`}
                          className="flex min-h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-normal text-slate-900 transition-colors hover:border-slate-300 hover:bg-slate-50"
                        >
                          {selectedPeriodLabel}
                          <ChevronDown size={13} aria-hidden="true" />
                        </button>
                        {showPeriodDropdown && (
                          <div className="absolute right-0 top-full z-30 mt-1 min-w-[200px] rounded-lg border border-slate-200 bg-white py-1 font-normal shadow-[0_14px_35px_-20px_rgba(15,23,42,0.4)]">
                            {showCustomPeriod ? (
                              <div className="w-[260px] max-w-[calc(100vw-2rem)] p-3">
                                <p className="mb-3 text-xs text-slate-600">Rango personalizado</p>
                                <div className="space-y-2">
                                  <label className="block text-xs text-slate-600">
                                    Desde
                                    <input
                                      type="date"
                                      value={customPeriodDraft.start}
                                      max={customPeriodDraft.end || undefined}
                                      onChange={(event) => {
                                        setCustomPeriodDraft((range) => ({
                                          ...range,
                                          start: event.target.value,
                                        }));
                                        setCustomPeriodError('');
                                      }}
                                      className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10"
                                    />
                                  </label>
                                  <label className="block text-xs text-slate-600">
                                    Hasta
                                    <input
                                      type="date"
                                      value={customPeriodDraft.end}
                                      min={customPeriodDraft.start || undefined}
                                      onChange={(event) => {
                                        setCustomPeriodDraft((range) => ({
                                          ...range,
                                          end: event.target.value,
                                        }));
                                        setCustomPeriodError('');
                                      }}
                                      className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10"
                                    />
                                  </label>
                                </div>
                                {customPeriodError && (
                                  <p role="alert" className="mt-2 text-xs text-red-600">
                                    {customPeriodError}
                                  </p>
                                )}
                                <div className="mt-3 flex justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setShowCustomPeriod(false);
                                      setCustomPeriodError('');
                                    }}
                                    className="h-8 rounded-md px-2.5 text-xs text-slate-600 hover:bg-slate-50"
                                  >
                                    Volver
                                  </button>
                                  <button
                                    type="button"
                                    disabled={!customPeriodDraft.start || !customPeriodDraft.end}
                                    onClick={() => {
                                      if (customPeriodDraft.start > customPeriodDraft.end) {
                                        setCustomPeriodError(
                                          'La fecha inicial debe ser anterior a la final.'
                                        );
                                        return;
                                      }
                                      setCustomPeriodRange({ ...customPeriodDraft });
                                      setTimeFilter('custom');
                                      setShowPeriodDropdown(false);
                                      setShowCustomPeriod(false);
                                      setCustomPeriodError('');
                                    }}
                                    className="h-8 rounded-md bg-primary px-3 text-xs text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    Aplicar
                                  </button>
                                </div>
                              </div>
                            ) : (
                              timeFilterOptions.map((option) => (
                                <button
                                  key={option.value}
                                  type="button"
                                  aria-pressed={timeFilter === option.value}
                                  onClick={() => {
                                    if (option.value === 'custom') {
                                      setCustomPeriodDraft({ ...customPeriodRange });
                                      setShowCustomPeriod(true);
                                      return;
                                    }
                                    setTimeFilter(option.value);
                                    setShowPeriodDropdown(false);
                                  }}
                                  className={`block w-full px-3 py-2 text-left text-sm font-normal text-slate-900 transition-colors hover:bg-slate-50 ${timeFilter === option.value ? 'bg-slate-50' : ''}`}
                                >
                                  {option.label}
                                </button>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* ── Lista ── */}
          {viewMode === 'lista' && (
            <div className="flex-1 w-full min-w-0">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-lg border border-slate-200/90 bg-white py-16 text-center shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                  <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                    <FileSignature size={19} />
                  </span>
                  <p className="text-sm font-600 text-slate-800">Sin resultados</p>
                  <p className="mt-1 text-xs text-slate-500">
                    No se encontraron participaciones con los filtros aplicados.
                  </p>
                </div>
              ) : listLayout === 'grid' ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {filtered.map((req) => (
                    <ParticipationCardGrid
                      key={req.id}
                      req={req}
                      isUrgentFilter={statusFilter === 'urgente'}
                    />
                  ))}
                </div>
              ) : (
                <div className="w-full space-y-3">
                  {filtered.map((req) => (
                    <ParticipationCard
                      key={req.id}
                      req={req}
                      isUrgentFilter={statusFilter === 'urgente'}
                    />
                  ))}
                </div>
              )}
              <p className="mt-3 text-right text-xs text-slate-400">
                Mostrando {filtered.length} de {items.length} participaciones
              </p>
            </div>
          )}

          {/* ── Tablero ── */}
          {viewMode === 'tablero' && (
            <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: '520px' }}>
              {kanbanColumns.map((col) => {
                const colItems = boardFiltered.filter((r) => r.status === col.status);
                return (
                  <div
                    key={col.status}
                    className={`flex min-w-[220px] flex-1 flex-col rounded-lg border border-slate-200/90 border-t-2 ${col.borderColor} ${col.bgColor}`}
                    style={{ minHeight: '480px' }}
                  >
                    <div className="flex items-center justify-between border-b border-slate-200/70 bg-white/70 px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-600 text-slate-700">{col.label}</span>
                      </div>
                      <span className="flex h-5 min-w-5 items-center justify-center rounded bg-white px-1.5 text-xs font-600 text-slate-500">
                        {colItems.length}
                      </span>
                    </div>
                    <div className="flex-1 flex flex-col items-center justify-center p-3 gap-2">
                      {colItems.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                          <Inbox size={32} className="text-muted-foreground/30" strokeWidth={1.5} />
                          <span className="text-xs text-muted-foreground/60">
                            Sin participaciones
                          </span>
                        </div>
                      ) : (
                        <div className="w-full flex flex-col gap-2">
                          {colItems.map((req) => (
                            <KanbanCard
                              key={req.id}
                              req={req}
                              isUrgentFilter={statusFilter === 'urgente'}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Calendario ── */}
          {viewMode === 'calendario' && (
            <>
              {/* Calendar status filter pills */}
              <div className="mb-4 flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200/90 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                {(
                  [
                    { value: 'todos', label: 'Todos' },
                    { value: 'en-progreso', label: 'En Progreso' },
                    { value: 'urgente', label: 'Urgentes' },
                    { value: 'proximo-a-vencer', label: 'Próximos a Vencer' },
                    { value: 'en-espera', label: 'En Espera' },
                    { value: 'completado', label: 'Completados' },
                    { value: 'vencido', label: 'Vencidos' },
                    { value: 'rechazado', label: 'Rechazados' },
                    { value: 'cancelado', label: 'Cancelados' },
                  ] as { value: CalendarStatusFilter; label: string }[]
                ).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setCalFilter(opt.value)}
                    className={`flex h-8 items-center rounded-md border px-2.5 text-xs font-600 transition-colors ${
                      calFilter === opt.value
                        ? 'border-primary/30 bg-primary/10 text-primary'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <div
                className="flex flex-col overflow-hidden rounded-lg border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
                style={{ minHeight: '600px' }}
              >
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                  <h2 className="text-sm font-600 text-slate-800">{getCalTitle()}</h2>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={calPrev}
                      className="p-1 rounded hover:bg-gray-100 transition-colors text-gray-500 hover:text-gray-800"
                      aria-label="Período anterior"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <button
                      onClick={calNext}
                      className="p-1 rounded hover:bg-gray-100 transition-colors text-gray-500 hover:text-gray-800"
                      aria-label="Período siguiente"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
                {calView === 'mes' && (
                  <MonthCalendar
                    year={calYear}
                    month={calMonth}
                    today={today}
                    items={items}
                    calFilter={calFilter}
                  />
                )}
                {calView === 'semana' && (
                  <WeekCalendar
                    weekStart={calWeekStart}
                    today={today}
                    items={items}
                    calFilter={calFilter}
                  />
                )}
                {calView === 'dia' && (
                  <DayCalendar date={calDay} today={today} items={items} calFilter={calFilter} />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
