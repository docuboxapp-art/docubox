'use client';

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import AppLayout from '@/components/AppLayout';
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
  List,
  LayoutGrid,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Inbox,
  ChevronDown,
  Eye,
  Users,
  ChevronUp,
  Mail,
  AlertTriangle,
  Ban,
  ArrowUpDown,
  PauseCircle,
  FileSignature,
  AlertCircle,
  FileText,
  UserCheck,
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

const timeFilterOptions = [
  { value: '7', label: 'Últimos 7 días' },
  { value: '30', label: 'Últimos 30 días' },
  { value: '365', label: 'Último año' },
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

function formatBoardDate(dateStr: string) {
  const date = new Date(dateStr);
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'p.m.' : 'a.m.';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${day}/${month}/${year} a las ${hours}:${minutes} ${ampm}`;
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

function formatExpiresAtWithTime(dateStr: string) {
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
  const h = date.getHours();
  const m = date.getMinutes();
  if ((h === 23 && m === 59) || (h === 0 && m === 0)) {
    return `${day} ${month} ${year}`;
  }
  let hours = h;
  const minutes = m.toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'p.m.' : 'a.m.';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${day} ${month} ${year} a las ${hours.toString().padStart(2, '0')}:${minutes} ${ampm}`;
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

function getPriorityLabel(priority: MyParticipation['priority']): string {
  switch (priority) {
    case 'Urgente':
    case 'Alta':
      return 'Urgente';
    case 'Normal':
    case 'Baja':
      return 'Normal';
  }
}

function getStatusDotColor(status: MyParticipation['status']) {
  switch (status) {
    case 'pendiente':
      return 'bg-amber-500';
    case 'en-progreso':
      return 'bg-[hsl(214,72%,45%)]';
    case 'en-espera':
      return 'bg-[hsl(43,96%,52%)]';
    case 'completado':
      return 'bg-emerald-500';
    case 'vencido':
      return 'bg-gray-400';
    case 'rechazado':
      return 'bg-red-500';
    case 'cancelado':
      return 'bg-gray-500';
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

// ─── Participation Progress Bar ───────────────────────────────────────────────
function ParticipationProgressBar({
  req,
  size = 'normal',
}: {
  req: MyParticipation;
  size?: 'normal' | 'small';
}) {
  const total = req.signaturesTotal;
  const done = req.signaturesDone;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const parts = req.participantList ?? [];
  const sinRevision = parts.filter((p) => {
    const s = p.status ?? '';
    return s === 'Sin revisión' || s === 'sin_revisar' || s === '';
  }).length;
  const enRevision = parts.filter((p) => {
    const s = p.status ?? '';
    return s === 'En revisión' || s === 'en_revision';
  }).length;
  const firmados = parts.filter((p) => p.status === 'Firmado').length;
  const rechazados = parts.filter((p) => p.status === 'Rechazado').length;
  const aprobados = parts.filter((p) => p.status === 'Aprobado').length;
  const cancelados = parts.filter((p) => p.status === 'Cancelado').length;

  interface StatusChip {
    label: string;
    count: number;
    cls: string;
  }
  const chips: StatusChip[] = [];
  if (sinRevision > 0)
    chips.push({ label: 'Sin revisión', count: sinRevision, cls: 'bg-gray-100 text-gray-600' });
  if (enRevision > 0)
    chips.push({ label: 'En revisión', count: enRevision, cls: 'bg-blue-50 text-blue-600' });
  if (firmados > 0)
    chips.push({
      label: firmados === 1 ? 'Ha firmado' : 'Han firmado',
      count: firmados,
      cls: 'bg-emerald-100 text-emerald-700',
    });
  if (rechazados > 0)
    chips.push({
      label: rechazados === 1 ? 'Ha rechazado' : 'Han rechazado',
      count: rechazados,
      cls: 'bg-red-100 text-red-600',
    });
  if (aprobados > 0)
    chips.push({
      label: aprobados === 1 ? 'Ha aprobado' : 'Han aprobado',
      count: aprobados,
      cls: 'bg-blue-100 text-blue-700',
    });
  if (cancelados > 0)
    chips.push({
      label: cancelados === 1 ? 'Ha cancelado' : 'Han cancelado',
      count: cancelados,
      cls: 'bg-slate-100 text-slate-600',
    });

  if (size === 'small') {
    return (
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-muted-foreground">Progreso de participación</span>
          <span className="text-[10px] font-600 text-foreground">{pct}%</span>
        </div>
        <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {chips.map((chip, i) => (
              <span
                key={i}
                className={`inline-flex items-center gap-0.5 text-[9px] font-600 px-1.5 py-0.5 rounded-full ${chip.cls}`}
              >
                <span className="font-700">{chip.count}</span> {chip.label}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-muted-foreground">Progreso de participación</span>
        <span className="text-xs font-600 text-foreground">{pct}%</span>
      </div>
      <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {chips.map((chip, i) => (
            <span
              key={i}
              className={`inline-flex items-center gap-1 text-xs font-600 px-2 py-0.5 rounded-full ${chip.cls}`}
            >
              <span className="font-700">{chip.count}</span> {chip.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Participants Icon ────────────────────────────────────────────────────────
function ParticipantsIcon({ count }: { count: number }) {
  if (count <= 1) {
    return <User size={13} className="text-muted-foreground" />;
  }
  return <Users size={13} className="text-muted-foreground" />;
}

// ─── Participation Card (List View) ──────────────────────────────────────────
interface ParticipationCardProps {
  req: MyParticipation;
  isUrgentFilter?: boolean;
}

function ParticipationCard({ req, isUrgentFilter }: ParticipationCardProps) {
  const router = useRouter();
  const [showParticipants, setShowParticipants] = useState(false);

  const unsignedParticipants =
    req.participantList?.filter((p) => !PARTICIPATED_STATUSES.includes(p.status ?? '')) ?? [];
  const actoLabel = getActoLabel(req);

  return (
    <div className="w-full rounded-lg border border-slate-200/90 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-colors hover:border-slate-300 sm:p-5">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        {/* Left: document info */}
        <div className="flex-1 min-w-0">
          {/* Dates */}
          <div className="flex flex-col gap-0.5 mb-2">
            <div className="flex items-center gap-1.5">
              <Calendar size={13} className="text-muted-foreground flex-shrink-0" />
              <span className="text-xs text-muted-foreground">
                Recibido: {formatCreatedAt(req.receivedAt)}
              </span>
            </div>
            {req.status === 'completado' && req.completedAt && (
              <div className="flex items-center gap-1.5">
                <CheckCircle2 size={13} className="text-emerald-500 flex-shrink-0" />
                <span className="text-xs text-emerald-600 font-500">
                  Completado: {formatCreatedAt(req.completedAt)}
                </span>
              </div>
            )}
            {req.status === 'vencido' && req.expiredAt && (
              <div className="flex items-center gap-1.5">
                <Clock size={13} className="text-gray-400 flex-shrink-0" />
                <span className="text-xs text-gray-500 font-500">
                  Vencido: {formatCreatedAt(req.expiredAt)}
                </span>
              </div>
            )}
            {req.status === 'rechazado' && req.rejectedAt && (
              <div className="flex items-center gap-1.5">
                <XCircle size={13} className="text-red-400 flex-shrink-0" />
                <span className="text-xs text-red-500 font-500">
                  Rechazado: {formatCreatedAt(req.rejectedAt)}
                </span>
              </div>
            )}
            {req.status === 'cancelado' && req.canceladoAt && (
              <div className="flex items-center gap-1.5">
                <Ban size={13} className="text-gray-400 flex-shrink-0" />
                <span className="text-xs text-gray-500 font-500">
                  Cancelado: {formatCreatedAt(req.canceladoAt)}
                </span>
              </div>
            )}
            {req.tieneVencimiento &&
              req.expiresAt &&
              req.status !== 'completado' &&
              req.status !== 'vencido' &&
              req.status !== 'rechazado' &&
              req.status !== 'cancelado' && (
                <div className="flex items-center gap-1.5">
                  <Clock size={13} className="text-amber-500 flex-shrink-0" />
                  <span className="text-xs text-amber-600 font-500">
                    Vence: {formatExpiresAtWithTime(req.expiresAt)}
                  </span>
                </div>
              )}
          </div>

          {/* Document name */}
          <h3 className="text-base font-700 text-foreground leading-tight mb-1">
            {req.documentName}
          </h3>
          {req.description && (
            <p className="text-xs text-muted-foreground mb-2 leading-relaxed">{req.description}</p>
          )}

          {/* Status + Document Type + Priority + My participation status */}
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <span
              className={`inline-flex items-center gap-1 text-xs font-500 px-2.5 py-1 rounded-full ${getStatusBadgeClass(req.status)}`}
            >
              {getStatusIcon(req.status)}
              {getStatusLabel(req.status)}
            </span>
            {req.documentType && (
              <span className="inline-flex items-center gap-1 text-xs font-500 px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">
                <FileText size={11} />
                {req.documentType}
              </span>
            )}
            {req.legalHoldActive && <LegalHoldBadge />}
            <DocumentPriorityBadge priority={req.priority === 'Urgente' ? 'urgent' : 'normal'} />
            {/* Acto a realizar */}
            {actoLabel && (
              <span
                className={`inline-flex items-center gap-1 text-xs font-500 px-2.5 py-1 rounded-full ${getMySignatureBadge(req.mySignatureStatus)}`}
              >
                <FileSignature size={11} />
                Acto a realizar: {actoLabel}
              </span>
            )}
            {/* My participation status if participated */}
            {req.mySignatureStatus && PARTICIPATED_STATUSES.includes(req.mySignatureStatus) && (
              <span
                className={`inline-flex items-center gap-1 text-xs font-500 px-2.5 py-1 rounded-full ${getMySignatureBadge(req.mySignatureStatus)}`}
              >
                <FileSignature size={11} />
                {req.mySignatureStatus}
              </span>
            )}
          </div>

          {/* Sender info */}
          <div className="flex items-center gap-1.5 mb-2">
            <User size={13} className="text-muted-foreground flex-shrink-0" />
            <span className="text-xs text-muted-foreground">
              Enviado por: <span className="font-500 text-foreground">{req.senderName}</span>
            </span>
          </div>

          {/* Signature config: tipoFirma and campos count */}
          {(req.myTipoFirma && req.myTipoFirma.length > 0) ||
          (req.camposSolicitados && req.camposSolicitados.length > 0) ? (
            <div className="flex items-center gap-2 flex-wrap mb-2">
              {req.myTipoFirma && req.myTipoFirma.length > 0 && (
                <span className="inline-flex items-center gap-1 text-xs font-500 px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700">
                  <FileSignature size={11} />
                  {req.myTipoFirma.join(', ')}
                </span>
              )}
              {req.camposSolicitados && req.camposSolicitados.length > 0 && (
                <span className="inline-flex items-center gap-1 text-xs font-500 px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                    <polyline points="10 9 9 9 8 9" />
                  </svg>
                  {req.camposSolicitados.length}{' '}
                  {req.camposSolicitados.length === 1 ? 'campo a completar' : 'campos a completar'}
                </span>
              )}
            </div>
          ) : null}

          {/* Info box: En Espera */}
          {req.status === 'en-espera' && (req.enEsperaMotivo || req.enEsperaDescripcion) && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-1.5">
                <PauseCircle size={13} className="text-amber-500 flex-shrink-0" />
                <span className="text-xs font-600 text-amber-700">Documento en espera</span>
              </div>
              {req.enEsperaMotivo && (
                <p className="text-xs font-500 text-amber-800 mb-0.5">
                  <span className="text-amber-600">Motivo: </span>
                  {req.enEsperaMotivo}
                </p>
              )}
              {req.enEsperaDescripcion && (
                <p className="text-xs text-amber-700 leading-relaxed">{req.enEsperaDescripcion}</p>
              )}
            </div>
          )}

          {/* Info box: Próximo a Vencer */}
          {(req.status === 'pendiente' || req.status === 'en-progreso') &&
            (() => {
              if (!req.expiresAt) return false;
              const now = new Date();
              const expires = new Date(req.expiresAt);
              const diffHours = (expires.getTime() - now.getTime()) / (1000 * 60 * 60);
              return diffHours >= 0 && diffHours <= 72;
            })() && (
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                <div className="flex items-center gap-1.5 mb-1">
                  <Clock size={13} className="text-amber-500 flex-shrink-0" />
                  <span className="text-xs font-600 text-amber-700">Próximo a vencer</span>
                </div>
                <p className="text-xs text-amber-800">
                  <span className="font-500 text-amber-600">Vence: </span>
                  {formatExpiresAtWithTime(req.expiresAt!)}
                </p>
              </div>
            )}

          {/* Info box: Vencido */}
          {req.status === 'vencido' && unsignedParticipants.length > 0 && (
            <div className="mb-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-1.5">
                <AlertCircle size={13} className="text-orange-500 flex-shrink-0" />
                <span className="text-xs font-600 text-orange-700">
                  Usuarios que no participaron
                </span>
              </div>
              <div className="flex flex-col gap-1">
                {unsignedParticipants.map((p, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <div className="w-5 h-5 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
                      <User size={10} className="text-orange-500" />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs font-500 text-orange-800 leading-tight truncate">
                        {p.name}
                      </span>
                      <span className="text-[10px] text-orange-600 leading-tight truncate">
                        {p.email}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Info box: Rechazado */}
          {!isUrgentFilter &&
            req.status === 'rechazado' &&
            (req.rejectionMotivo || req.rejectionDescripcion) && (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <XCircle size={13} className="text-red-500 flex-shrink-0" />
                  <span className="text-xs font-600 text-red-700">Motivo de rechazo</span>
                </div>
                {req.rejectionMotivo && (
                  <p className="text-xs font-500 text-red-800 mb-0.5">
                    <span className="text-red-600">Motivo: </span>
                    {req.rejectionMotivo}
                  </p>
                )}
                {req.rejectionDescripcion && (
                  <p className="text-xs text-red-700 leading-relaxed">{req.rejectionDescripcion}</p>
                )}
              </div>
            )}

          {/* Info box: Cancelado */}
          {req.status === 'cancelado' && (req.cancelacionMotivo || req.cancelacionDescripcion) && (
            <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Ban size={13} className="text-gray-500 flex-shrink-0" />
                <span className="text-xs font-600 text-gray-700">Motivo de cancelación</span>
              </div>
              {req.cancelacionMotivo && (
                <p className="text-xs font-500 text-gray-800 mb-1">{req.cancelacionMotivo}</p>
              )}
              {req.cancelacionDescripcion && (
                <p className="text-xs text-gray-600 leading-relaxed">
                  {req.cancelacionDescripcion}
                </p>
              )}
            </div>
          )}

          {/* Participants count */}
          <div className="flex items-center gap-1.5">
            <ParticipantsIcon count={req.participants} />
            <button
              onClick={() => setShowParticipants((v) => !v)}
              className="text-xs text-muted-foreground hover:text-primary transition-colors underline-offset-2 hover:underline"
            >
              {req.participants === 1 ? '1 participante' : `${req.participants} participantes`}
            </button>
          </div>
        </div>

        {/* Right: progress + actions */}
        <div className="flex w-full shrink-0 flex-col gap-3 border-t border-slate-100 pt-4 lg:w-[330px] lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0 xl:w-[380px]">
          <ParticipationProgressBar req={req} />

          {/* Action buttons */}
          <div className="flex flex-col gap-2">
            {/* Firmar button: show when document is active and participant hasn't completed */}
            {(req.status === 'en-progreso' || req.status === 'pendiente') &&
              !PARTICIPATED_STATUSES.includes(req.mySignatureStatus ?? '') &&
              req.myActo?.toLowerCase() !== 'observador' &&
              req.myRol?.toLowerCase() !== 'observador' && (
                <button
                  onClick={() => router.push(`/firmar-documento/${req.supabaseId ?? req.id}`)}
                  className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-sm font-700 text-white transition-colors hover:bg-primary/90"
                >
                  <FileSignature size={14} />
                  {req.myActo === 'Aprobador' || req.myRol?.toLowerCase().includes('aprobador')
                    ? 'Aprobar Documento'
                    : 'Firmar Documento'}
                </button>
              )}
            <button
              onClick={() => router.push(`/visor-documento/${req.supabaseId ?? req.id}`)}
              className={`flex h-9 w-full items-center justify-center gap-1.5 rounded-md px-3 text-sm font-600 transition-colors ${
                (req.status === 'en-progreso' || req.status === 'pendiente') &&
                !PARTICIPATED_STATUSES.includes(req.mySignatureStatus ?? '') &&
                req.myActo?.toLowerCase() !== 'observador' &&
                req.myRol?.toLowerCase() !== 'observador'
                  ? 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  : 'bg-primary text-white hover:bg-primary/90'
              }`}
            >
              <Eye size={14} />
              Ver Documento
            </button>
          </div>

          {/* Toggle participants */}
          <button
            onClick={() => setShowParticipants((v) => !v)}
            className="flex items-center justify-center gap-1.5 text-xs font-500 text-muted-foreground hover:text-foreground transition-colors"
          >
            {showParticipants ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {showParticipants ? 'Ocultar Participantes' : 'Ver Participantes'}
          </button>

          {/* Participants panel */}
          {showParticipants && (
            <div className="border-t border-border/60 pt-4">
              <div className="flex items-center gap-2 mb-4">
                <Users size={16} className="text-muted-foreground" />
                <span className="text-sm font-600 text-foreground">Participantes</span>
              </div>
              <div className="flex flex-col">
                {req.participantList?.map((p, i) => (
                  <div key={i} className="flex flex-col gap-2 py-4 border-t border-border/60">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                        <User size={14} className="text-muted-foreground" />
                      </div>
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-xs font-500 text-foreground leading-snug">
                          {p.name}
                        </span>
                        <div className="flex items-center gap-1 mt-0.5">
                          <Mail size={11} className="text-muted-foreground flex-shrink-0" />
                          <span className="text-xs text-muted-foreground leading-tight truncate">
                            {p.email}
                          </span>
                        </div>
                        {/* Rol en el documento */}
                        {p.rol && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <UserCheck size={10} className="text-muted-foreground flex-shrink-0" />
                            <span className="text-xs text-muted-foreground leading-tight">
                              Rol: <span className="font-500 text-foreground">{p.rol}</span>
                            </span>
                          </div>
                        )}
                        {/* Acto en el documento */}
                        {p.acto && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <FileText size={10} className="text-muted-foreground flex-shrink-0" />
                            <span className="text-xs text-muted-foreground leading-tight">
                              Acto: <span className="font-500 text-foreground">{p.acto}</span>
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="pl-11">
                      <span
                        className={`text-xs font-500 px-3 py-1 rounded-full ${getParticipantStatusBadge(p.status)}`}
                      >
                        {getParticipantStatusLabel(p.status)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Participation Card (Grid View) ──────────────────────────────────────────
function ParticipationCardGrid({ req, isUrgentFilter }: ParticipationCardProps) {
  const router = useRouter();
  const [showParticipants, setShowParticipants] = useState(false);
  const actoLabel = getActoLabel(req);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-200/90 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-colors hover:border-slate-300">
      {/* Dates */}
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <Calendar size={13} className="text-muted-foreground flex-shrink-0" />
          <span className="text-xs text-muted-foreground">
            Recibido: {formatCreatedAt(req.receivedAt)}
          </span>
        </div>
        {req.status === 'completado' && req.completedAt && (
          <div className="flex items-center gap-1.5">
            <CheckCircle2 size={13} className="text-emerald-500 flex-shrink-0" />
            <span className="text-xs text-emerald-600 font-500">
              Completado: {formatCreatedAt(req.completedAt)}
            </span>
          </div>
        )}
        {req.status === 'vencido' && req.expiredAt && (
          <div className="flex items-center gap-1.5">
            <Clock size={13} className="text-gray-400 flex-shrink-0" />
            <span className="text-xs text-gray-500 font-500">
              Vencido: {formatCreatedAt(req.expiredAt)}
            </span>
          </div>
        )}
        {req.status === 'rechazado' && req.rejectedAt && (
          <div className="flex items-center gap-1.5">
            <XCircle size={13} className="text-red-400 flex-shrink-0" />
            <span className="text-xs text-red-500 font-500">
              Rechazado: {formatCreatedAt(req.rejectedAt)}
            </span>
          </div>
        )}
        {req.status === 'cancelado' && req.canceladoAt && (
          <div className="flex items-center gap-1.5">
            <Ban size={13} className="text-gray-400 flex-shrink-0" />
            <span className="text-xs text-gray-500 font-500">
              Cancelado: {formatCreatedAt(req.canceladoAt)}
            </span>
          </div>
        )}
        {req.tieneVencimiento &&
          req.expiresAt &&
          req.status !== 'completado' &&
          req.status !== 'vencido' &&
          req.status !== 'rechazado' &&
          req.status !== 'cancelado' && (
            <div className="flex items-center gap-1.5">
              <Clock size={13} className="text-amber-500 flex-shrink-0" />
              <span className="text-xs text-amber-600 font-500">
                Vence: {formatExpiresAt(req.expiresAt)}
              </span>
            </div>
          )}
      </div>

      {/* Status + Document Type + Priority */}
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={`inline-flex items-center gap-1 text-xs font-500 px-2.5 py-1 rounded-full ${getStatusBadgeClass(req.status)}`}
        >
          {getStatusIcon(req.status)}
          {getStatusLabel(req.status)}
        </span>
        {req.documentType && (
          <span className="inline-flex items-center gap-1 text-xs font-500 px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">
            <FileText size={11} />
            {req.documentType}
          </span>
        )}
        {req.priority === 'Urgente' && (
          <span className="inline-flex items-center gap-1 text-xs font-600 px-2.5 py-1 rounded-full bg-red-100 text-red-600 border border-red-200">
            <AlertTriangle size={11} />
            Urgente
          </span>
        )}
      </div>

      {/* Acto a realizar */}
      {actoLabel && (
        <span
          className={`inline-flex items-center gap-1 text-xs font-500 px-2.5 py-1 rounded-full w-fit ${getMySignatureBadge(req.mySignatureStatus)}`}
        >
          <FileSignature size={11} />
          Acto a realizar: {actoLabel}
        </span>
      )}
      {req.mySignatureStatus && PARTICIPATED_STATUSES.includes(req.mySignatureStatus) && (
        <span
          className={`inline-flex items-center gap-1 text-xs font-500 px-2.5 py-1 rounded-full w-fit ${getMySignatureBadge(req.mySignatureStatus)}`}
        >
          <FileSignature size={11} />
          {req.mySignatureStatus}
        </span>
      )}

      {/* Document name */}
      <div className="flex flex-wrap items-center gap-1.5 -mt-1">
        <h3 className="text-base font-700 text-foreground leading-tight">{req.documentName}</h3>
        {req.legalHoldActive && <LegalHoldBadge />}
      </div>
      {req.description && (
        <p className="text-xs text-muted-foreground leading-relaxed -mt-1">{req.description}</p>
      )}

      {/* Sender */}
      <div className="flex items-center gap-1.5">
        <User size={13} className="text-muted-foreground flex-shrink-0" />
        <span className="text-xs text-muted-foreground truncate">
          Por: <span className="font-500 text-foreground">{req.senderName}</span>
        </span>
      </div>

      {/* Info box: En Espera */}
      {req.status === 'en-espera' && req.enEsperaMotivo && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <PauseCircle size={13} className="text-amber-500 flex-shrink-0" />
            <span className="text-xs font-600 text-amber-700">En espera</span>
          </div>
          <p className="text-xs text-amber-700 leading-relaxed">{req.enEsperaMotivo}</p>
        </div>
      )}

      {/* Info box: Cancelado */}
      {req.status === 'cancelado' && req.cancelacionMotivo && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <Ban size={13} className="text-gray-500 flex-shrink-0" />
            <span className="text-xs font-600 text-gray-700">Cancelado</span>
          </div>
          <p className="text-xs text-gray-600 leading-relaxed">{req.cancelacionMotivo}</p>
        </div>
      )}

      {/* Participants */}
      <div className="flex items-center gap-1.5">
        <ParticipantsIcon count={req.participants} />
        <button
          onClick={() => setShowParticipants((v) => !v)}
          className="text-xs text-muted-foreground hover:text-primary transition-colors underline-offset-2 hover:underline"
        >
          {req.participants === 1 ? '1 participante' : `${req.participants} participantes`}
        </button>
      </div>

      {/* Participation progress */}
      <ParticipationProgressBar req={req} />

      {/* Action buttons */}
      <div className="flex flex-col gap-2 mt-auto">
        {/* Firmar button: show when document is active and participant hasn't completed */}
        {(req.status === 'en-progreso' || req.status === 'pendiente') &&
          !PARTICIPATED_STATUSES.includes(req.mySignatureStatus ?? '') &&
          req.myActo?.toLowerCase() !== 'observador' &&
          req.myRol?.toLowerCase() !== 'observador' && (
            <button
              onClick={() => router.push(`/firmar-documento/${req.supabaseId ?? req.id}`)}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-white text-sm font-500 hover:bg-primary/90 transition-colors"
            >
              <FileSignature size={14} />
              {req.myActo === 'Aprobador' || req.myRol?.toLowerCase().includes('aprobador')
                ? 'Aprobar Documento'
                : 'Firmar Documento'}
            </button>
          )}
        <button
          onClick={() => router.push(`/visor-documento/${req.supabaseId ?? req.id}`)}
          className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-500 transition-colors ${
            (req.status === 'en-progreso' || req.status === 'pendiente') &&
            !PARTICIPATED_STATUSES.includes(req.mySignatureStatus ?? '') &&
            req.myActo?.toLowerCase() !== 'observador' &&
            req.myRol?.toLowerCase() !== 'observador'
              ? 'border border-border text-foreground hover:bg-muted/50'
              : 'bg-primary text-white hover:bg-primary/90'
          }`}
        >
          <Eye size={14} />
          Ver Documento
        </button>
      </div>

      {/* Toggle participants */}
      <button
        onClick={() => setShowParticipants((v) => !v)}
        className="flex items-center justify-center gap-1.5 text-xs font-500 text-muted-foreground hover:text-foreground transition-colors"
      >
        {showParticipants ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        {showParticipants ? 'Ocultar Participantes' : 'Ver Participantes'}
      </button>

      {/* Participants panel */}
      {showParticipants && (
        <div className="border-t border-border pt-3">
          <div className="flex items-center gap-1.5 text-xs font-500 text-foreground mb-3">
            <Users size={13} className="text-muted-foreground" />
            <span>Participantes</span>
          </div>
          <div className="flex flex-col gap-3">
            {req.participantList?.map((p, i) => (
              <div
                key={i}
                className="flex flex-col gap-1 border border-border/60 rounded-lg px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                    <User size={10} className="text-muted-foreground" />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-xs font-600 text-foreground leading-tight truncate">
                      {p.name}
                    </span>
                    <div className="flex items-center gap-1">
                      <Mail size={10} className="text-muted-foreground flex-shrink-0" />
                      <span className="text-xs text-muted-foreground leading-tight truncate">
                        {p.email}
                      </span>
                    </div>
                    {p.rol && (
                      <span className="text-[10px] text-muted-foreground">
                        Rol: <span className="font-500">{p.rol}</span>
                      </span>
                    )}
                    {p.acto && (
                      <span className="text-[10px] text-muted-foreground">
                        Acto: <span className="font-500">{p.acto}</span>
                      </span>
                    )}
                  </div>
                </div>
                <div className="pl-7">
                  <span
                    className={`text-xs font-500 px-2 py-0.5 rounded-full ${getParticipantStatusBadge(p.status)}`}
                  >
                    {getParticipantStatusLabel(p.status)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Kanban Card ─────────────────────────────────────────────────────────────
function KanbanCard({ req, isUrgentFilter }: ParticipationCardProps) {
  const router = useRouter();
  const actoLabel = getActoLabel(req);

  return (
    <div
      className={`rounded-lg border bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-colors hover:border-slate-300 ${req.priority === 'Urgente' || req.priority === 'Alta' ? 'border-l-4 border-l-red-500 border-t-slate-200 border-r-slate-200 border-b-slate-200' : 'border-slate-200'}`}
    >
      {(req.priority === 'Urgente' || req.priority === 'Alta') && (
        <div className="flex items-center gap-1 mb-2">
          <span className="inline-flex items-center gap-1 text-[10px] font-600 px-2 py-0.5 rounded-full bg-red-100 text-red-600 border border-red-200">
            <AlertTriangle size={9} />
            Urgente
          </span>
        </div>
      )}
      {/* Dates — formatted as "07/05/2026 a las 8:00 a.m." */}
      <div className="flex flex-col gap-0.5 mb-2">
        <div className="flex items-center gap-1">
          <Calendar size={10} className="text-muted-foreground flex-shrink-0" />
          <span className="text-[10px] text-muted-foreground">
            Recibido: {formatBoardDate(req.receivedAt)}
          </span>
        </div>
        {req.tieneVencimiento &&
          req.expiresAt &&
          req.status !== 'completado' &&
          req.status !== 'vencido' &&
          req.status !== 'rechazado' &&
          req.status !== 'cancelado' && (
            <div className="flex items-center gap-1">
              <Clock size={10} className="text-amber-500 flex-shrink-0" />
              <span className="text-[10px] text-amber-600 font-500">
                Vence: {formatExpiresAt(req.expiresAt)}
              </span>
            </div>
          )}
        {req.status === 'completado' && req.completedAt && (
          <div className="flex items-center gap-1">
            <CheckCircle2 size={10} className="text-emerald-500 flex-shrink-0" />
            <span className="text-[10px] text-emerald-600 font-500">
              Completado: {formatExpiresAt(req.completedAt)}
            </span>
          </div>
        )}
      </div>
      <p className="text-xs font-700 text-foreground leading-tight mb-1 line-clamp-2">
        {req.documentName}
      </p>
      {req.description && (
        <p className="text-[10px] text-muted-foreground leading-relaxed mb-1 line-clamp-2">
          {req.description}
        </p>
      )}
      {/* Document type badge */}
      {req.documentType && (
        <div className="mb-1">
          <span className="inline-flex items-center gap-0.5 text-[10px] font-500 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
            <FileText size={9} />
            {req.documentType}
          </span>
        </div>
      )}
      <div className="flex items-center gap-1 mb-1">
        <User size={10} className="text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground truncate">Por: {req.senderName}</span>
      </div>
      {actoLabel && (
        <div className="mb-2">
          <span
            className={`text-[10px] font-500 px-2 py-0.5 rounded-full ${getMySignatureBadge(req.mySignatureStatus)}`}
          >
            Acto a realizar: {actoLabel}
          </span>
        </div>
      )}
      {req.mySignatureStatus && PARTICIPATED_STATUSES.includes(req.mySignatureStatus) && (
        <div className="mb-2">
          <span
            className={`text-[10px] font-500 px-2 py-0.5 rounded-full ${getMySignatureBadge(req.mySignatureStatus)}`}
          >
            {req.mySignatureStatus}
          </span>
        </div>
      )}
      <div className="mb-2">
        <ParticipationProgressBar req={req} size="small" />
      </div>
      {/* Firmar button for board card */}
      {(req.status === 'en-progreso' || req.status === 'pendiente') &&
        !PARTICIPATED_STATUSES.includes(req.mySignatureStatus ?? '') &&
        req.myActo?.toLowerCase() !== 'observador' &&
        req.myRol?.toLowerCase() !== 'observador' && (
          <button
            onClick={() => router.push(`/firmar-documento/${req.supabaseId ?? req.id}`)}
            className="w-full flex items-center justify-center gap-1.5 h-8 rounded-md bg-primary text-white text-xs font-500 hover:bg-primary/90 transition-colors mb-1.5"
          >
            <FileSignature size={12} />
            {req.myActo === 'Aprobador' || req.myRol?.toLowerCase().includes('aprobador')
              ? 'Aprobar'
              : 'Firmar'}
          </button>
        )}
      <button
        onClick={() => router.push(`/visor-documento/${req.supabaseId ?? req.id}`)}
        className={`w-full flex items-center justify-center gap-1.5 h-8 rounded-md text-xs font-500 transition-colors ${
          (req.status === 'en-progreso' || req.status === 'pendiente') &&
          !PARTICIPATED_STATUSES.includes(req.mySignatureStatus ?? '') &&
          req.myActo?.toLowerCase() !== 'observador' &&
          req.myRol?.toLowerCase() !== 'observador'
            ? 'border border-border text-foreground hover:bg-muted/50'
            : 'bg-primary text-white hover:bg-primary/90'
        }`}
      >
        <Eye size={12} />
        Ver Documento
      </button>
    </div>
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
  const router = useRouter();
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
                      <span className="w-6 h-6 rounded-full bg-primary text-white text-xs font-700 flex items-center justify-center">
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
                      <div
                        key={req.id}
                        onClick={() => router.push(`/visor-documento/${req.supabaseId ?? req.id}`)}
                        className="flex items-start gap-1 px-1 py-0.5 rounded text-[10px] font-500 bg-primary/10 text-primary cursor-pointer hover:bg-primary/20 transition-colors"
                        title={req.documentName}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1 ${getStatusDotColor(req.status)}`}
                        />
                        <div className="min-w-0">
                          <p className="truncate font-600 leading-tight">{req.documentName}</p>
                          <p className="truncate text-primary/60 leading-tight">
                            {req.senderName} · {req.id}
                          </p>
                        </div>
                      </div>
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
  const router = useRouter();
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
                    <span className="w-7 h-7 rounded-full bg-primary text-white text-sm font-700 flex items-center justify-center">
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
                    <div
                      key={req.id}
                      onClick={() => router.push(`/visor-documento/${req.supabaseId ?? req.id}`)}
                      className="flex items-start gap-1 px-1.5 py-1 rounded-lg text-xs font-500 bg-primary/10 text-primary cursor-pointer hover:bg-primary/20 transition-colors w-full overflow-hidden"
                      title={req.documentName}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1 ${getStatusDotColor(req.status)}`}
                      />
                      <div className="min-w-0 overflow-hidden flex-1">
                        <p className="truncate font-600 leading-tight text-xs">
                          {req.documentName}
                        </p>
                        <p className="truncate text-primary/60 leading-tight text-[10px]">
                          {req.senderName} · {req.id}
                        </p>
                      </div>
                    </div>
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
                  <span className="w-7 h-7 rounded-full bg-primary text-white text-sm font-700 flex items-center justify-center">
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
                    <div
                      key={req.id}
                      onClick={() => router.push(`/visor-documento/${req.supabaseId ?? req.id}`)}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-500 bg-primary/10 text-primary cursor-pointer hover:bg-primary/20 transition-colors mb-0.5 w-full overflow-hidden max-h-[44px]"
                      title={req.documentName}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${getStatusDotColor(req.status)}`}
                      />
                      <div className="min-w-0 overflow-hidden flex-1">
                        <p className="truncate font-600 leading-tight text-xs">
                          {req.documentName}
                        </p>
                        <p className="truncate text-primary/60 leading-tight text-[10px]">
                          {req.senderName} · {req.id}
                        </p>
                      </div>
                    </div>
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
  const router = useRouter();
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
            <span className="w-9 h-9 rounded-full bg-primary text-white text-lg font-700 flex items-center justify-center">
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
                <div
                  key={req.id}
                  onClick={() => router.push(`/visor-documento/${req.supabaseId ?? req.id}`)}
                  className={`bg-white rounded-lg border shadow-sm p-3 cursor-pointer hover:shadow-md transition-shadow ${req.priority === 'Urgente' ? 'border-l-4 border-l-red-500 border-t-border border-r-border border-b-border' : 'border-border'}`}
                >
                  <div className="flex items-center gap-1 mb-1.5">
                    <span
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${getStatusDotColor(req.status)}`}
                    />
                    <span
                      className={`text-[10px] font-600 px-1.5 py-0.5 rounded-full ${getStatusBadgeClass(req.status)}`}
                    >
                      {getStatusLabel(req.status)}
                    </span>
                  </div>
                  <p className="text-xs font-700 text-foreground leading-tight mb-1 line-clamp-2">
                    {req.documentName}
                  </p>
                  <p className="text-[10px] text-muted-foreground">{req.documentType}</p>
                  <div className="mt-2">
                    <ParticipationProgressBar req={req} size="small" />
                  </div>
                </div>
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
          <span className="w-9 h-9 rounded-full bg-primary text-white text-lg font-700 flex items-center justify-center">
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
                <div
                  key={req.id}
                  onClick={() => router.push(`/visor-documento/${req.supabaseId ?? req.id}`)}
                  className="flex items-center gap-2 bg-primary/10 text-primary rounded-lg px-2 py-1 cursor-pointer hover:bg-primary/20 transition-colors"
                  title={req.documentName}
                >
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${getStatusDotColor(req.status)}`}
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-600 leading-tight truncate">{req.documentName}</p>
                    <p className="text-[10px] text-primary/60">
                      {req.senderName} · {req.id}
                    </p>
                  </div>
                </div>
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
                  <div
                    key={req.id}
                    className="flex items-center gap-2 bg-primary/10 text-primary rounded-lg px-1 py-0.5 truncate mb-0.5 cursor-pointer hover:bg-primary/20 transition-colors"
                    title={req.documentName}
                    onClick={() => router.push(`/visor-documento/${req.supabaseId ?? req.id}`)}
                  >
                    <span
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${getStatusDotColor(req.status)}`}
                    />
                    <div>
                      <p className="text-xs font-600 leading-tight">{req.documentName}</p>
                      <p className="text-[10px] text-primary/60">
                        {req.senderName} · {req.id}
                      </p>
                    </div>
                  </div>
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
  const [loadingData, setLoadingData] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('lista');
  const [listLayout, setListLayout] = useState<'list' | 'grid'>('list');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('en-progreso');
  const [timeFilter, setTimeFilter] = useState('365');
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
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowCalViewDropdown(false);
      }
      if (dateSortRef.current && !dateSortRef.current.contains(e.target as Node)) {
        setShowDateDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    if (!TERMINAL_STATUSES.includes(statusFilter)) {
      setTimeFilter('365');
    }
  }, [statusFilter]);

  const showTimeFilter = TERMINAL_STATUSES.includes(statusFilter);

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
        const days = parseInt(timeFilter, 10);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
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
        if (dateStr && new Date(dateStr) < cutoff) return false;
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
        const operationalDifference = operationalPriorityRank({
          priority: a.priority === 'Urgente' ? 'urgent' : a.priority === 'Alta' ? 'high' : 'normal',
          expiresAt: a.expiresAt,
        }) - operationalPriorityRank({
          priority: b.priority === 'Urgente' ? 'urgent' : b.priority === 'Alta' ? 'high' : 'normal',
          expiresAt: b.expiresAt,
        });
        if (operationalDifference) return operationalDifference;
      }
      const da = new Date(a.receivedAt).getTime();
      const db = new Date(b.receivedAt).getTime();
      return dateSort === 'recientes' ? db - da : da - db;
    });

    return result;
  }, [items, statusFilter, timeFilter, search, dateSort]);

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
  }, []);

  useEffect(() => {
    fetchParticipaciones();
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

  async function handleRefresh() {
    fetchParticipaciones();
  }

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
              <h1 className="text-2xl font-700 leading-tight text-slate-950">
                Mis participaciones
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Consulta y atiende los documentos en los que participas.
              </p>
            </div>
            <span className="inline-flex h-7 w-fit items-center rounded-md border border-slate-200 bg-white px-2.5 text-xs font-600 text-slate-500">
              {items.length} participaciones
            </span>
          </div>

          {/* Data error banner */}
          {dataError && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-center gap-2">
              <AlertCircle size={16} className="flex-shrink-0" />
              {dataError}
            </div>
          )}

          {/* View toggle + Search row */}
          <section className="mb-4 overflow-visible rounded-lg border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="flex flex-col items-start justify-between gap-3 p-3 sm:flex-row sm:items-center">
              {/* View mode buttons */}
              <div className="flex h-9 items-center gap-0.5 rounded-md bg-slate-100 p-0.5">
                <button
                  onClick={() => setViewMode('lista')}
                  className={`flex h-8 items-center gap-1.5 rounded px-3 text-sm font-600 transition-colors ${viewMode === 'lista' ? 'bg-white text-slate-950 shadow-[0_1px_2px_rgba(15,23,42,0.08)]' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  <List size={15} />
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
                      <List size={16} />
                    </button>
                    <button
                      onClick={() => setListLayout('grid')}
                      className={`flex h-7 w-8 items-center justify-center rounded transition-colors ${listLayout === 'grid' ? 'bg-slate-100 text-slate-950' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-700'}`}
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
                        key={opt.value}
                        onClick={() => setStatusFilter(opt.value)}
                        className={`flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-600 transition-colors ${
                          statusFilter === opt.value
                            ? 'border-primary/30 bg-primary/10 text-primary'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {/* Time sub-filter — only for completed/closed statuses */}
                  {showTimeFilter && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground font-500 mr-1">Período:</span>
                      {timeFilterOptions.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => setTimeFilter(opt.value)}
                          className={`flex h-7 items-center rounded-md border px-2.5 text-xs font-600 transition-colors ${
                            timeFilter === opt.value
                              ? 'border-primary/30 bg-primary/10 text-primary'
                              : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
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
                  <p className="text-sm font-700 text-slate-800">Sin resultados</p>
                  <p className="mt-1 text-xs text-slate-500">
                    No se encontraron participaciones con los filtros aplicados.
                  </p>
                </div>
              ) : listLayout === 'grid' ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
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
                        <span className="text-xs font-700 text-slate-700">{col.label}</span>
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
                  <h2 className="text-sm font-700 text-slate-800">{getCalTitle()}</h2>
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
