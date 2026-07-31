'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import AppLayout from '@/components/AppLayout';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

import { Send, Search, User, Calendar, Clock, CheckCircle2, XCircle, List, LayoutGrid, CalendarDays, ChevronLeft, ChevronRight, Inbox, ChevronDown, Eye, Users, ChevronUp, Mail, AlertTriangle, Ban, AlertCircle, ArrowUpDown, PauseCircle, FileText, UserCheck } from 'lucide-react';

interface ParticipationRequest {
  id: string;
  recipientName: string;
  recipientEmail: string;
  recipientRfc: string;
  documentName: string;
  documentType: string;
  description?: string;
  status: 'en-progreso' | 'en-espera' | 'completado' | 'vencido' | 'rechazado' | 'cancelado';
  priority: 'Normal' | 'Alta' | 'Urgente' | 'Baja';
  sentAt: string;
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
  enEsperaUsuario?: string;
  enEsperaMotivo?: string;
  enEsperaDescripcion?: string;
  enEsperaEmail?: string;
  message?: string;
  participants: number;
  etiquetas?: { nombre: string; color?: string }[];
  participantList?: {
    name: string;
    email: string;
    phone?: string;
    notificationMethod?: 'email' | 'sms' | 'whatsapp' | 'docubox';
    status?: string;
    subEstado?: string;
    rol?: string;
    acto?: string;
    rejectionMotivo?: string;
    rejectionDescripcion?: string;
  }[];
  signaturesTotal: number;
  signaturesDone: number;
  supabaseId?: string;
}

const MOTIVOS_CANCELACION = [
  'Error en el documento',
  'Cambio en los términos acordados',
  'Solicitud del cliente o contraparte',
  'Documento duplicado',
  'Información incorrecta de participantes',
  'Proceso interno cancelado',
  'Vencimiento anticipado requerido',
  'Otro motivo',
];

// Statuses that show time sub-filter
const TERMINAL_STATUSES = ['completado', 'vencido', 'rechazado', 'cancelado'];
// Statuses that count as "participated"
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

const kanbanColumns: { status: ParticipationRequest['status']; label: string; borderColor: string; bgColor: string }[] = [
  { status: 'en-progreso', label: 'En Progreso', borderColor: 'border-t-blue-400', bgColor: 'bg-blue-50/40' },
  { status: 'en-espera', label: 'En Espera', borderColor: 'border-t-purple-400', bgColor: 'bg-purple-50/40' },
  { status: 'completado', label: 'Completados', borderColor: 'border-t-emerald-400', bgColor: 'bg-emerald-50/40' },
  { status: 'vencido', label: 'Vencidos', borderColor: 'border-t-orange-300', bgColor: 'bg-orange-50/40' },
  { status: 'rechazado', label: 'Rechazados', borderColor: 'border-t-red-400', bgColor: 'bg-red-50/40' },
  { status: 'cancelado', label: 'Cancelados', borderColor: 'border-t-gray-400', bgColor: 'bg-gray-50/40' },
];

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const DAYS_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

type ViewMode = 'lista' | 'tablero' | 'calendario';
type CalendarView = 'mes' | 'semana' | 'dia';
type CalendarStatusFilter = 'todos' | 'en-progreso' | 'en-espera' | 'completado' | 'por-vencer' | 'vencido' | 'rechazado' | 'cancelado';

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatCreatedAt(dateStr: string) {
  const date = new Date(dateStr);
  const day = date.getDate();
  const monthsShort = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const month = monthsShort[date.getMonth()];
  const year = date.getFullYear();
  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'p.m.' : 'a.m.';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${day} ${month} ${year} a las ${hours.toString().padStart(2, '0')}:${minutes} ${ampm}`;
}

// Format for tablero: "07/05/2026 a las 8:00 a.m."
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
  const monthsShort = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const month = monthsShort[date.getMonth()];
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}

function getStatusIcon(status: ParticipationRequest['status']) {
  switch (status) {
    case 'completado': return <CheckCircle2 size={14} className="text-emerald-600" />;
    case 'rechazado': return <XCircle size={14} className="text-red-500" />;
    case 'cancelado': return <XCircle size={14} className="text-gray-500" />;
    case 'vencido': return <Clock size={14} className="text-gray-400" />;
    case 'en-espera': return <Clock size={14} className="text-amber-500" />;
    default: return <Clock size={14} className="text-blue-500" />;
  }
}

function getStatusLabel(status: ParticipationRequest['status']) {
  switch (status) {
    case 'en-progreso': return 'En Progreso';
    case 'en-espera': return 'En Espera';
    case 'completado': return 'Completado';
    case 'vencido': return 'Vencido';
    case 'rechazado': return 'Rechazado';
    case 'cancelado': return 'Cancelado';
  }
}

function getStatusBadgeClass(status: ParticipationRequest['status']) {
  switch (status) {
    case 'en-progreso': return 'bg-[hsl(214,72%,94%)] text-[hsl(214,72%,30%)]';
    case 'en-espera': return 'bg-[hsl(43,96%,92%)] text-[hsl(43,96%,28%)]';
    case 'completado': return 'bg-emerald-100 text-emerald-700';
    case 'vencido': return 'bg-gray-100 text-gray-600';
    case 'rechazado': return 'bg-red-100 text-red-600';
    case 'cancelado': return 'bg-gray-200 text-gray-600';
  }
}

function getStatusDotColor(status: ParticipationRequest['status']) {
  switch (status) {
    case 'en-progreso': return 'bg-[hsl(214,72%,45%)]';
    case 'en-espera': return 'bg-[hsl(43,96%,52%)]';
    case 'completado': return 'bg-emerald-500';
    case 'vencido': return 'bg-gray-400';
    case 'rechazado': return 'bg-red-500';
    case 'cancelado': return 'bg-gray-500';
  }
}

function getParticipantStatusBadge(status?: string) {
  switch (status) {
    case 'Firmó': case 'Firmado': return 'bg-emerald-100 text-emerald-700';
    case 'Aprobó': case 'Aprobado': return 'bg-blue-100 text-blue-700';
    case 'Rechazó': case 'Rechazado': return 'bg-red-100 text-red-600';
    case 'Canceló': case 'Cancelado': return 'bg-slate-100 text-slate-600';
    case 'En revisión': case 'en_revision': return 'bg-blue-50 text-blue-600';
    case 'Sin revisión': case 'sin_revisar': return 'bg-gray-100 text-gray-500';
    default: return 'bg-amber-100 text-amber-700';
  }
}

function getParticipantStatusLabel(status?: string): string {
  switch (status) {
    case 'Firmado': return 'Firmado';
    case 'Aprobado': return 'Aprobado';
    case 'Rechazado': return 'Rechazado';
    case 'Cancelado': return 'Cancelado';
    case 'En revisión': case 'en_revision': return 'En revisión';
    case 'Sin revisión': case 'sin_revisar': return 'Sin revisión';
    default: return status ?? 'En revisión';
  }
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
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function getRequestsForDay(date: Date, requests: ParticipationRequest[], calFilter: CalendarStatusFilter = 'todos'): ParticipationRequest[] {
  return requests.filter(req => {
    if (calFilter === 'todos') {
      let dateStr: string | undefined;
      switch (req.status) {
        case 'en-progreso': case 'en-espera': dateStr = req.sentAt; break;
        case 'completado': dateStr = req.completedAt ?? req.sentAt; break;
        case 'vencido': dateStr = req.expiredAt ?? req.expiresAt ?? undefined; break;
        case 'rechazado': dateStr = req.rejectedAt ?? req.sentAt; break;
        case 'cancelado': dateStr = req.canceladoAt ?? req.sentAt; break;
        default: dateStr = req.sentAt;
      }
      if (!dateStr) return false;
      return isSameDay(new Date(dateStr), date);
    }

    let dateStr: string | undefined;
    switch (calFilter) {
      case 'en-progreso':
        if (req.status !== 'en-progreso') return false;
        dateStr = req.sentAt;
        break;
      case 'en-espera':
        if (req.status !== 'en-espera') return false;
        dateStr = req.sentAt;
        break;
      case 'completado':
        if (req.status !== 'completado') return false;
        dateStr = req.completedAt;
        break;
      case 'por-vencer':
        dateStr = req.expiresAt ?? undefined;
        break;
      case 'vencido':
        if (req.status !== 'vencido') return false;
        dateStr = req.expiredAt ?? req.expiresAt ?? undefined;
        break;
      case 'rechazado':
        if (req.status !== 'rechazado') return false;
        dateStr = req.rejectedAt ?? req.sentAt;
        break;
      case 'cancelado':
        if (req.status !== 'cancelado') return false;
        dateStr = req.canceladoAt ?? req.sentAt;
        break;
    }
    if (!dateStr) return false;
    return isSameDay(new Date(dateStr), date);
  });
}

// ─── Reminder Modal ───────────────────────────────────────────────────────────
interface ReminderModalProps {
  participantName: string;
  participantEmail: string;
  documentName: string;
  documentId?: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

function ReminderModal({ participantName, participantEmail, documentName, onClose, onConfirm }: ReminderModalProps) {
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    try {
      await onConfirm();
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
          <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">
            <CheckCircle2 size={24} className="text-emerald-600" />
          </div>
          <h2 className="text-base font-700 text-foreground mb-1">Recordatorio enviado</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Se ha enviado un recordatorio a <span className="font-600 text-foreground">{participantName}</span> ({participantEmail}).
          </p>
          <button
            onClick={onClose}
            className="w-full px-4 py-2.5 rounded-lg bg-primary text-white text-sm font-600 hover:bg-primary/90 transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center gap-2 mb-3">
          <Send size={18} className="text-primary flex-shrink-0" />
          <h2 className="text-base font-700 text-foreground">Enviar recordatorio</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-5">
          ¿Deseas enviar un recordatorio a <span className="font-600 text-foreground">{participantName}</span> para que participe en el documento <span className="font-600 text-foreground">{documentName}</span>?
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 px-4 py-2.5 rounded-lg border border-border text-sm font-500 text-foreground bg-white hover:bg-muted/40 transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className="flex-1 px-4 py-2.5 rounded-lg bg-primary text-white text-sm font-600 hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {loading ? 'Enviando...' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Cancel Modal ─────────────────────────────────────────────────────────────
interface CancelModalProps {
  req: ParticipationRequest;
  onClose: () => void;
  onConfirm: (motivo: string, descripcion: string) => Promise<void>;
}

function CancelModal({ req, onClose, onConfirm }: CancelModalProps) {
  const [motivo, setMotivo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleConfirm() {
    if (!motivo) {
      setError('Por favor selecciona un motivo de cancelación.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await onConfirm(motivo, descripcion);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 relative">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle size={20} className="text-red-500 flex-shrink-0" />
          <h2 className="text-lg font-700 text-red-600">Cancelar Documento</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-5">
          Esta acción detendrá el flujo de firma de <span className="font-600 text-foreground">{req.documentName}</span>. Todos los participantes serán notificados.
        </p>
        <div className="mb-4">
          <label className="block text-sm font-600 text-foreground mb-1.5">
            Motivo de cancelación <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <select
              value={motivo}
              onChange={(e) => { setMotivo(e.target.value); setError(''); }}
              className="w-full appearance-none border border-border rounded-lg px-3 py-2.5 text-sm text-foreground bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors pr-9"
            >
              <option value="">Selecciona un motivo</option>
              {MOTIVOS_CANCELACION.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          </div>
          {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
        </div>
        <div className="mb-6">
          <label className="block text-sm font-600 text-foreground mb-1.5">
            Descripción / Comentarios adicionales
          </label>
          <textarea
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            rows={3}
            placeholder="Explica brevemente por qué cancelas este documento..."
            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm text-foreground bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors resize-none"
          />
        </div>
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-5 py-2.5 rounded-lg border border-border text-sm font-500 text-foreground bg-white hover:bg-muted/40 transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading || !motivo}
            className="px-5 py-2.5 rounded-lg bg-red-500 text-white text-sm font-600 hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Procesando...' : 'Confirmar Cancelación'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Participation Progress Bar ───────────────────────────────────────────────
function ParticipationProgressBar({ req, size = 'normal' }: { req: ParticipationRequest; size?: 'normal' | 'small' }) {
  const total = req.signaturesTotal;
  const done = req.signaturesDone;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  // Build status summary
  const parts = req.participantList ?? [];
  const sinRevision = parts.filter(p => {
    const s = p.status ?? '';
    return s === 'Sin revisión' || s === 'sin_revisar' || s === '';
  }).length;
  const enRevision = parts.filter(p => {
    const s = p.status ?? '';
    return s === 'En revisión' || s === 'en_revision';
  }).length;
  const firmados = parts.filter(p => p.status === 'Firmado').length;
  const rechazados = parts.filter(p => p.status === 'Rechazado').length;
  const aprobados = parts.filter(p => p.status === 'Aprobado').length;
  const cancelados = parts.filter(p => p.status === 'Cancelado').length;

  interface StatusChip { label: string; count: number; cls: string }
  const chips: StatusChip[] = [];
  if (sinRevision > 0) chips.push({ label: 'Sin revisión', count: sinRevision, cls: 'bg-gray-100 text-gray-600' });
  if (enRevision > 0) chips.push({ label: 'En revisión', count: enRevision, cls: 'bg-blue-50 text-blue-600' });
  if (firmados > 0) chips.push({ label: firmados === 1 ? 'Ha firmado' : 'Han firmado', count: firmados, cls: 'bg-emerald-100 text-emerald-700' });
  if (rechazados > 0) chips.push({ label: rechazados === 1 ? 'Ha rechazado' : 'Han rechazado', count: rechazados, cls: 'bg-red-100 text-red-600' });
  if (aprobados > 0) chips.push({ label: aprobados === 1 ? 'Ha aprobado' : 'Han aprobado', count: aprobados, cls: 'bg-blue-100 text-blue-700' });
  if (cancelados > 0) chips.push({ label: cancelados === 1 ? 'Ha cancelado' : 'Han cancelado', count: cancelados, cls: 'bg-slate-100 text-slate-600' });

  if (size === 'small') {
    return (
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-muted-foreground">Progreso de participación</span>
          <span className="text-[10px] font-600 text-foreground">{pct}%</span>
        </div>
        <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {chips.map((chip, i) => (
              <span key={i} className={`inline-flex items-center gap-0.5 text-[9px] font-600 px-1.5 py-0.5 rounded-full ${chip.cls}`}>
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
        <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {chips.map((chip, i) => (
            <span key={i} className={`inline-flex items-center gap-1 text-xs font-600 px-2 py-0.5 rounded-full ${chip.cls}`}>
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
  // Group icon for 2+ participants
  return <Users size={13} className="text-muted-foreground" />;
}

// ─── Request Card (List View) ─────────────────────────────────────────────────
interface RequestCardProps {
  req: ParticipationRequest;
  onCancelled: (id: string) => void;
}

function RequestCard({ req, onCancelled }: RequestCardProps) {
  const router = useRouter();
  const [showParticipants, setShowParticipants] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [reminderModal, setReminderModal] = useState<{ idx: number; name: string; email: string } | null>(null);

  const isCancellable = req.status === 'en-progreso' || req.status === 'en-espera';

  const unsignedParticipants = req.participantList?.filter(p => !PARTICIPATED_STATUSES.includes(p.status ?? '')) ?? [];
  const rejectedParticipants = req.participantList?.filter(p => p.status === 'Rechazado') ?? [];

  async function handleCancelConfirm(motivo: string, descripcion: string) {
    const supabase = createClient();
    if (req.supabaseId) {
      await supabase
        .from('documentos')
        .update({
          estado: 'cancelado',
          cancelacion_motivo: motivo,
          cancelacion_descripcion: descripcion,
          cancelado_at: new Date().toISOString(),
        })
        .eq('id', req.supabaseId);
    }
    setShowCancelModal(false);
    onCancelled(req.id);
  }

  async function handleSendReminder() {
    if (!reminderModal) return;
    await fetch('/api/documentos/send-reminder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participantEmail: reminderModal.email,
        participantName: reminderModal.name,
        documentName: req.documentName,
        documentId: req.supabaseId ?? req.id,
      }),
    });
  }

  return (
    <>
      {showCancelModal && (
        <CancelModal req={req} onClose={() => setShowCancelModal(false)} onConfirm={handleCancelConfirm} />
      )}
      {reminderModal && (
        <ReminderModal
          participantName={reminderModal.name}
          participantEmail={reminderModal.email}
          documentName={req.documentName}
          documentId={req.supabaseId ?? req.id}
          onClose={() => setReminderModal(null)}
          onConfirm={handleSendReminder}
        />
      )}
      <div className="w-full rounded-xl border border-border bg-white shadow-sm hover:shadow-md transition-shadow p-5">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
          {/* Left: document info */}
          <div className="flex-1 min-w-0">
            {/* Dates */}
            <div className="flex flex-col gap-0.5 mb-2">
              <div className="flex items-center gap-1.5">
                <Calendar size={13} className="text-muted-foreground flex-shrink-0" />
                <span className="text-xs text-muted-foreground">Creado: {formatCreatedAt(req.sentAt)}</span>
              </div>
              {req.status === 'completado' && req.completedAt && (
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 size={13} className="text-emerald-500 flex-shrink-0" />
                  <span className="text-xs text-emerald-600 font-500">Completado: {formatCreatedAt(req.completedAt)}</span>
                </div>
              )}
              {req.status === 'vencido' && req.expiredAt && (
                <div className="flex items-center gap-1.5">
                  <Clock size={13} className="text-gray-400 flex-shrink-0" />
                  <span className="text-xs text-gray-500 font-500">Vencido: {formatCreatedAt(req.expiredAt)}</span>
                </div>
              )}
              {req.status === 'rechazado' && req.rejectedAt && (
                <div className="flex items-center gap-1.5">
                  <XCircle size={13} className="text-red-400 flex-shrink-0" />
                  <span className="text-xs text-red-500 font-500">Rechazado: {formatCreatedAt(req.rejectedAt)}</span>
                </div>
              )}
              {req.status === 'cancelado' && req.canceladoAt && (
                <div className="flex items-center gap-1.5">
                  <Ban size={13} className="text-gray-400 flex-shrink-0" />
                  <span className="text-xs text-gray-500 font-500">Cancelado: {formatCreatedAt(req.canceladoAt)}</span>
                </div>
              )}
              {req.tieneVencimiento && req.expiresAt && req.status !== 'completado' && req.status !== 'vencido' && req.status !== 'rechazado' && req.status !== 'cancelado' && (
                <div className="flex items-center gap-1.5">
                  <Clock size={13} className="text-amber-500 flex-shrink-0" />
                  <span className="text-xs text-amber-600 font-500">Vence: {formatExpiresAt(req.expiresAt)}</span>
                </div>
              )}
            </div>

            {/* Document name */}
            <h3 className="text-base font-700 text-foreground leading-tight mb-1">{req.documentName}</h3>
            {req.description && (
              <p className="text-xs text-muted-foreground mb-2 leading-relaxed">{req.description}</p>
            )}

            {/* Status + Document Type + Priority badges */}
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className={`inline-flex items-center gap-1 text-xs font-500 px-2.5 py-1 rounded-full ${getStatusBadgeClass(req.status)}`}>
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

            {/* Info box: Vencido */}
            {req.status === 'vencido' && unsignedParticipants.length > 0 && (
              <div className="mb-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2.5">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <AlertCircle size={13} className="text-orange-500 flex-shrink-0" />
                  <span className="text-xs font-600 text-orange-700">Usuarios que no participaron</span>
                </div>
                <div className="flex flex-col gap-1">
                  {unsignedParticipants.map((p, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <div className="w-5 h-5 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
                        <User size={10} className="text-orange-500" />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-500 text-orange-800 leading-tight truncate">{p.name}</span>
                        <span className="text-[10px] text-orange-600 leading-tight truncate">{p.email}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Info box: Rechazado */}
            {req.status === 'rechazado' && rejectedParticipants.length > 0 && (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <XCircle size={13} className="text-red-500 flex-shrink-0" />
                  <span className="text-xs font-600 text-red-700">Rechazo en participación</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {rejectedParticipants.map((p, i) => (
                    <div key={i} className="flex flex-col gap-0.5">
                      <span className="text-[10px] font-600 text-red-600 tracking-wide">Rechazado por</span>
                      <div className="flex items-center gap-1.5">
                        <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                          <User size={10} className="text-red-500" />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-xs font-500 text-red-800 leading-tight truncate">{p.name}</span>
                          <span className="text-[10px] text-red-600 leading-tight truncate">{p.email}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {req.rejectionMotivo && (
                  <div className="mt-2 pt-2 border-t border-red-200">
                    <p className="text-xs font-500 text-red-800 mb-0.5">
                      <span className="text-red-600">Motivo: </span>{req.rejectionMotivo}
                    </p>
                    {req.rejectionDescripcion && (
                      <p className="text-xs text-red-700 leading-relaxed">{req.rejectionDescripcion}</p>
                    )}
                  </div>
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
                {req.cancelacionMotivo && <p className="text-xs font-500 text-gray-800 mb-1">{req.cancelacionMotivo}</p>}
                {req.cancelacionDescripcion && <p className="text-xs text-gray-600 leading-relaxed">{req.cancelacionDescripcion}</p>}
              </div>
            )}

            {/* Info box: En Espera */}
            {req.status === 'en-espera' && (req.enEsperaUsuario || req.enEsperaMotivo || req.enEsperaDescripcion) && (
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <PauseCircle size={13} className="text-amber-500 flex-shrink-0" />
                  <span className="text-xs font-600 text-amber-700">Documento en espera</span>
                </div>
                {req.enEsperaUsuario && (
                  <div className="flex items-center gap-1.5 mb-1">
                    <div className="w-5 h-5 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                      <User size={10} className="text-amber-600" />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs font-500 text-amber-800 leading-tight truncate">{req.enEsperaUsuario}</span>
                      {req.enEsperaEmail && <span className="text-[10px] text-amber-600 leading-tight truncate">{req.enEsperaEmail}</span>}
                    </div>
                  </div>
                )}
                {req.enEsperaMotivo && <p className="text-xs font-500 text-amber-800 mb-0.5"><span className="text-amber-600">Motivo: </span>{req.enEsperaMotivo}</p>}
                {req.enEsperaDescripcion && <p className="text-xs text-amber-700 leading-relaxed">{req.enEsperaDescripcion}</p>}
              </div>
            )}

            {/* Participants count */}
            <div className="flex items-center gap-1.5">
              <ParticipantsIcon count={req.participants} />
              <button
                onClick={() => setShowParticipants(v => !v)}
                className="text-xs text-muted-foreground hover:text-primary transition-colors underline-offset-2 hover:underline"
              >
                {req.participants === 1 ? '1 participante' : `${req.participants} participantes`}
              </button>
            </div>
          </div>

          {/* Right: progress + actions */}
          <div className="w-full lg:w-[330px] xl:w-[380px] shrink-0 flex flex-col gap-3">
            <ParticipationProgressBar req={req} />

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              {isCancellable && (
                <button
                  onClick={() => setShowCancelModal(true)}
                  className="flex-1 px-3 py-2 rounded-lg border border-border text-sm font-500 text-foreground bg-white hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-colors"
                >
                  Cancelar
                </button>
              )}
              <button
                onClick={() => router.push(`/visor-documento/${req.supabaseId ?? req.id}`)}
                className={`${isCancellable ? 'flex-1' : 'w-full'} flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-white text-sm font-600 hover:bg-primary/90 transition-colors`}
              >
                <Eye size={12} />
                Ver Documento
              </button>
            </div>

            {/* Toggle participants */}
            <button
              onClick={() => setShowParticipants(v => !v)}
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
                          <span className="text-xs font-600 text-foreground leading-snug">{p.name}</span>
                          <div className="flex items-center gap-1 mt-0.5">
                            <Mail size={10} className="text-muted-foreground flex-shrink-0" />
                            <span className="text-xs text-muted-foreground leading-tight truncate">{p.email}</span>
                          </div>
                          {/* Rol en el documento */}
                          {p.rol && (
                            <div className="flex items-center gap-1 mt-0.5">
                              <UserCheck size={10} className="text-muted-foreground flex-shrink-0" />
                              <span className="text-xs text-muted-foreground leading-tight">Rol: <span className="font-600 text-foreground">{p.rol}</span></span>
                            </div>
                          )}
                          {/* Acto en el documento */}
                          {p.acto && (
                            <div className="flex items-center gap-1 mt-0.5">
                              <FileText size={10} className="text-muted-foreground flex-shrink-0" />
                              <span className="text-xs text-muted-foreground leading-tight">Acto: <span className="font-600 text-foreground">{p.acto}</span></span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="pl-11 flex items-center justify-between gap-2">
                        <span className={`text-xs font-500 px-3 py-1 rounded-full ${getParticipantStatusBadge(p.status)}`}>
                          {getParticipantStatusLabel(p.status)}
                        </span>
                        {req.status === 'en-progreso' && !PARTICIPATED_STATUSES.includes(p.status ?? '') && (
                          <button
                            onClick={() => setReminderModal({ idx: i, name: p.name, email: p.email })}
                            className="flex items-center gap-1 text-xs font-500 text-primary hover:text-primary/80 transition-colors whitespace-nowrap"
                          >
                            <Send size={11} />
                            Enviar recordatorio
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Request Card (Grid View) ────────────────────────────────────────────────
function RequestCardGrid({ req, onCancelled }: RequestCardProps) {
  const router = useRouter();
  const [showParticipants, setShowParticipants] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [reminderModal, setReminderModal] = useState<{ idx: number; name: string; email: string } | null>(null);

  const isCancellable = req.status === 'en-progreso' || req.status === 'en-espera';
  const unsignedParticipants = req.participantList?.filter(p => !PARTICIPATED_STATUSES.includes(p.status ?? '')) ?? [];
  const rejectedParticipants = req.participantList?.filter(p => p.status === 'Rechazado') ?? [];

  async function handleCancelConfirm(motivo: string, descripcion: string) {
    const supabase = createClient();
    if (req.supabaseId) {
      await supabase.from('documentos').update({
        estado: 'cancelado',
        cancelacion_motivo: motivo,
        cancelacion_descripcion: descripcion,
        cancelado_at: new Date().toISOString(),
      }).eq('id', req.supabaseId);
    }
    setShowCancelModal(false);
    onCancelled(req.id);
  }

  async function handleSendReminder() {
    if (!reminderModal) return;
    await fetch('/api/documentos/send-reminder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participantEmail: reminderModal.email,
        participantName: reminderModal.name,
        documentName: req.documentName,
        documentId: req.supabaseId ?? req.id,
      }),
    });
  }

  return (
    <>
      {showCancelModal && (
        <CancelModal req={req} onClose={() => setShowCancelModal(false)} onConfirm={handleCancelConfirm} />
      )}
      {reminderModal && (
        <ReminderModal
          participantName={reminderModal.name}
          participantEmail={reminderModal.email}
          documentName={req.documentName}
          documentId={req.supabaseId ?? req.id}
          onClose={() => setReminderModal(null)}
          onConfirm={handleSendReminder}
        />
      )}
      <div className="bg-white rounded-xl border border-border shadow-sm hover:shadow-md transition-shadow p-5 flex flex-col gap-3">
        {/* Top: date block */}
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <Calendar size={13} className="text-muted-foreground flex-shrink-0" />
            <span className="text-xs text-muted-foreground">Creado: {formatCreatedAt(req.sentAt)}</span>
          </div>
          {req.status === 'completado' && req.completedAt && (
            <div className="flex items-center gap-1.5">
              <CheckCircle2 size={13} className="text-emerald-500 flex-shrink-0" />
              <span className="text-xs text-emerald-600 font-500">Completado: {formatCreatedAt(req.completedAt)}</span>
            </div>
          )}
          {req.status === 'vencido' && req.expiredAt && (
            <div className="flex items-center gap-1.5">
              <Clock size={13} className="text-gray-400 flex-shrink-0" />
              <span className="text-xs text-gray-500 font-500">Vencido: {formatCreatedAt(req.expiredAt)}</span>
            </div>
          )}
          {req.status === 'rechazado' && req.rejectedAt && (
            <div className="flex items-center gap-1.5">
              <XCircle size={13} className="text-red-400 flex-shrink-0" />
              <span className="text-xs text-red-500 font-500">Rechazado: {formatCreatedAt(req.rejectedAt)}</span>
            </div>
          )}
          {req.status === 'cancelado' && req.canceladoAt && (
            <div className="flex items-center gap-1.5">
              <Ban size={13} className="text-gray-400 flex-shrink-0" />
              <span className="text-xs text-gray-500 font-500">Cancelado: {formatCreatedAt(req.canceladoAt)}</span>
            </div>
          )}
          {req.tieneVencimiento && req.expiresAt && req.status !== 'completado' && req.status !== 'vencido' && req.status !== 'rechazado' && req.status !== 'cancelado' && (
            <div className="flex items-center gap-1.5">
              <Clock size={13} className="text-amber-500 flex-shrink-0" />
              <span className="text-xs text-amber-600 font-500">Vence: {formatExpiresAt(req.expiresAt)}</span>
            </div>
          )}
        </div>

        {/* Status + Document Type + Priority */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center gap-1 text-xs font-500 px-2.5 py-1 rounded-full ${getStatusBadgeClass(req.status)}`}>
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

        {/* Document name */}
        <h3 className="text-base font-700 text-foreground leading-tight -mt-1">{req.documentName}</h3>
        {req.description && (
          <p className="text-xs text-muted-foreground leading-relaxed -mt-1">{req.description}</p>
        )}

        {/* Info box: Vencido */}
        {req.status === 'vencido' && unsignedParticipants.length > 0 && (
          <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2.5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <AlertCircle size={13} className="text-orange-500 flex-shrink-0" />
              <span className="text-xs font-600 text-orange-700">Usuarios que no participaron</span>
            </div>
            <div className="flex flex-col gap-1">
              {unsignedParticipants.map((p, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <div className="w-5 h-5 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
                    <User size={10} className="text-orange-500" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-500 text-orange-800 leading-tight truncate">{p.name}</span>
                    <span className="text-[10px] text-orange-600 leading-tight truncate">{p.email}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Info box: Rechazado */}
        {req.status === 'rechazado' && rejectedParticipants.length > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <XCircle size={13} className="text-red-500 flex-shrink-0" />
              <span className="text-xs font-600 text-red-700">Rechazo en participación</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {rejectedParticipants.map((p, i) => (
                <div key={i} className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-600 text-red-600 tracking-wide">Rechazado por</span>
                  <div className="flex items-center gap-1.5">
                    <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                      <User size={10} className="text-red-500" />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs font-500 text-red-800 leading-tight truncate">{p.name}</span>
                      <span className="text-[10px] text-red-600 leading-tight truncate">{p.email}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {req.rejectionMotivo && (
              <div className="mt-2 pt-2 border-t border-red-200">
                <p className="text-xs font-500 text-red-800 mb-0.5"><span className="text-red-600">Motivo: </span>{req.rejectionMotivo}</p>
                {req.rejectionDescripcion && <p className="text-xs text-red-700 leading-relaxed">{req.rejectionDescripcion}</p>}
              </div>
            )}
          </div>
        )}

        {/* Info box: Cancelado */}
        {req.status === 'cancelado' && (req.cancelacionMotivo || req.cancelacionDescripcion) && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Ban size={13} className="text-gray-500 flex-shrink-0" />
              <span className="text-xs font-600 text-gray-700">Motivo de cancelación</span>
            </div>
            {req.cancelacionMotivo && <p className="text-xs font-500 text-gray-800 mb-1">{req.cancelacionMotivo}</p>}
            {req.cancelacionDescripcion && <p className="text-xs text-gray-600 leading-relaxed">{req.cancelacionDescripcion}</p>}
          </div>
        )}

        {/* Info box: En Espera */}
        {req.status === 'en-espera' && (req.enEsperaUsuario || req.enEsperaMotivo || req.enEsperaDescripcion) && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <PauseCircle size={13} className="text-amber-500 flex-shrink-0" />
              <span className="text-xs font-600 text-amber-700">Documento en espera</span>
            </div>
            {req.enEsperaUsuario && (
              <div className="flex flex-col gap-0.5 mb-1.5">
                <span className="text-[10px] font-600 text-amber-600 tracking-wide">Colocado en espera por</span>
                <div className="flex items-center gap-1.5">
                  <div className="w-5 h-5 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                    <User size={10} className="text-amber-600" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-500 text-amber-800 leading-tight truncate">{req.enEsperaUsuario}</span>
                    {req.enEsperaEmail && <span className="text-[10px] text-amber-600 leading-tight truncate">{req.enEsperaEmail}</span>}
                  </div>
                </div>
              </div>
            )}
            {req.enEsperaMotivo && <p className="text-xs font-500 text-amber-800 mb-0.5"><span className="text-amber-600">Motivo: </span>{req.enEsperaMotivo}</p>}
            {req.enEsperaDescripcion && <p className="text-xs text-amber-700 leading-relaxed">{req.enEsperaDescripcion}</p>}
          </div>
        )}

        {/* Participants count */}
        <div className="flex items-center gap-1.5">
          <ParticipantsIcon count={req.participants} />
          <button
            onClick={() => setShowParticipants(v => !v)}
            className="text-xs text-muted-foreground hover:text-primary transition-colors underline-offset-2 hover:underline"
          >
            {req.participants === 1 ? '1 participante' : `${req.participants} participantes`}
          </button>
        </div>

        {/* Participation progress */}
        <ParticipationProgressBar req={req} />

        {/* Action buttons */}
        <div className="flex items-center gap-1.5">
          {isCancellable && (
            <button
              onClick={() => setShowCancelModal(true)}
              title="Cancelar"
              className="flex items-center justify-center w-8 h-8 rounded-md border border-border text-foreground bg-white hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-colors flex-shrink-0"
            >
              <Ban size={12} />
            </button>
          )}
          <button
            title="Ver Documento"
            onClick={() => router.push(`/visor-documento/${req.supabaseId ?? req.id}`)}
            className={`${isCancellable ? 'flex-1' : 'w-full'} flex items-center justify-center gap-1.5 h-8 rounded-md bg-primary text-white hover:bg-primary/90 transition-colors text-xs font-500 px-2`}
          >
            <Eye size={12} />
            <span>Ver Documento</span>
          </button>
        </div>

        {/* Toggle participants */}
        <button
          onClick={() => setShowParticipants(v => !v)}
          className="flex items-center justify-center gap-1.5 text-xs font-500 text-muted-foreground hover:text-foreground transition-colors"
        >
          {showParticipants ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {showParticipants ? 'Ocultar Participantes' : 'Ver Participantes'}
        </button>

        {/* Participants panel */}
        {showParticipants && req.participantList && req.participantList.length > 0 && (
          <div className="border-t border-border pt-3">
            <div className="flex items-center gap-1.5 text-xs font-500 text-foreground mb-3">
              <Users size={13} className="text-muted-foreground" />
              <span>Participantes</span>
            </div>
            <div className="flex flex-col gap-3">
              {req.participantList.map((p, i) => (
                <div key={i} className="flex flex-col gap-1 border border-border/60 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                      <User size={10} className="text-muted-foreground" />
                    </div>
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-xs font-600 text-foreground leading-tight truncate">{p.name}</span>
                      <div className="flex items-center gap-1">
                        <Mail size={10} className="text-muted-foreground flex-shrink-0" />
                        <span className="text-xs text-muted-foreground leading-tight truncate">{p.email}</span>
                      </div>
                      {p.rol && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <UserCheck size={10} className="text-muted-foreground flex-shrink-0" />
                          <span className="text-[10px] text-muted-foreground">Rol: <span className="font-600 text-foreground">{p.rol}</span></span>
                        </div>
                      )}
                      {p.acto && (
                        <span className="text-[10px] text-muted-foreground">Acto: <span className="font-500">{p.acto}</span></span>
                      )}
                    </div>
                  </div>
                  <div className="pl-7 flex items-center justify-between gap-2">
                    <span className={`text-xs font-500 px-2 py-0.5 rounded-full ${getParticipantStatusBadge(p.status)}`}>
                      {getParticipantStatusLabel(p.status)}
                    </span>
                    {req.status === 'en-progreso' && !PARTICIPATED_STATUSES.includes(p.status ?? '') && (
                      <button
                        onClick={() => setReminderModal({ idx: i, name: p.name, email: p.email })}
                        className="flex items-center gap-1 text-[10px] font-500 text-primary hover:text-primary/80 transition-colors whitespace-nowrap"
                      >
                        <Send size={10} />
                        Enviar recordatorio
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Month Calendar ───────────────────────────────────────────────────────────
function MonthCalendar({ year, month, today, requests, calFilter }: { year: number; month: number; today: Date; requests: ParticipationRequest[]; calFilter: CalendarStatusFilter }) {
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
          <div key={d} className="py-2 text-center text-xs font-600 text-primary border-r border-gray-200 last:border-r-0">{d}</div>
        ))}
      </div>
      <div className="flex-1 flex flex-col">
        {rows.map((row, ri) => (
          <div key={ri} className="flex-1 grid grid-cols-7 border-b border-gray-200 last:border-b-0" style={{ minHeight: '90px' }}>
            {row.map((cell, ci) => {
              const isToday = isSameDay(cell.date, today);
              const dayRequests = getRequestsForDay(cell.date, requests, calFilter);
              return (
                <div key={ci} className={`border-r border-gray-200 last:border-r-0 p-1.5 relative ${isToday ? 'bg-primary/5' : ''} ${!cell.isCurrentMonth ? 'bg-gray-50/50' : ''}`}>
                  <div className="flex items-start justify-start mb-1">
                    {isToday ? (
                      <span className="w-6 h-6 rounded-full bg-primary text-white text-xs font-700 flex items-center justify-center">{cell.date.getDate()}</span>
                    ) : (
                      <span className={`text-xs font-500 ${cell.isCurrentMonth ? 'text-gray-800' : 'text-gray-400'}`}>{cell.date.getDate()}</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {dayRequests.slice(0, 2).map((req) => (
                      <div
                        key={req.id}
                        onClick={() => router.push(`/visor-documento/${req.supabaseId ?? req.id}`)}
                        className="flex items-start gap-1 px-1 py-0.5 rounded text-[10px] font-500 bg-primary/10 text-primary cursor-pointer hover:bg-primary/20 transition-colors"
                        title={req.documentName}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1 ${getStatusDotColor(req.status)}`} />
                        <div className="min-w-0">
                          <p className="truncate font-600 leading-tight">{req.documentName}</p>
                          <p className="truncate text-primary/60 leading-tight">{req.recipientName} · {req.id}</p>
                        </div>
                      </div>
                    ))}
                    {dayRequests.length > 2 && (
                      <span className="text-[10px] text-muted-foreground/60 pl-1">+{dayRequests.length - 2} más</span>
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
function WeekCalendar({ weekStart, today, requests, calFilter }: { weekStart: Date; today: Date; requests: ParticipationRequest[]; calFilter: CalendarStatusFilter }) {
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

  function getRelevantDateStr(req: ParticipationRequest): string | undefined {
    if (calFilter === 'todos') {
      switch (req.status) {
        case 'en-progreso': case 'en-espera': return req.sentAt;
        case 'completado': return req.completedAt ?? req.sentAt;
        case 'vencido': return req.expiredAt ?? req.expiresAt ?? undefined;
        case 'rechazado': return req.rejectedAt ?? req.sentAt;
        case 'cancelado': return req.canceladoAt ?? req.sentAt;
        default: return req.sentAt;
      }
    }
    switch (calFilter) {
      case 'en-progreso': case 'en-espera': return req.sentAt;
      case 'completado': return req.completedAt;
      case 'por-vencer': return req.expiresAt ?? undefined;
      case 'vencido': return req.expiredAt ?? req.expiresAt ?? undefined;
      case 'rechazado': return req.rejectedAt;
      case 'cancelado': return req.canceladoAt;
    }
    return undefined;
  }

  // Check if any request in the week has a specific time
  const weekRequests = days.flatMap(day => getRequestsForDay(day, requests, calFilter));
  const hasHourlyEvents = weekRequests.some(req => {
    const ds = getRelevantDateStr(req);
    return ds ? hasSpecificTime(ds) : false;
  });

  if (!hasHourlyEvents) {
    // Board-style week view (like the reference image)
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const monthsShort = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

    return (
      <div className="flex-1 flex flex-col">
        <div className="grid grid-cols-7 border-b border-gray-200">
          {days.map((day, i) => {
            const isToday = isSameDay(day, today);
            return (
              <div key={i} className="py-2 text-center border-r border-gray-200 last:border-r-0">
                <div className={`text-xs font-600 ${isToday ? 'text-primary' : 'text-gray-500'}`}>{DAYS_SHORT[i]}</div>
                <div className="flex items-center justify-center mt-0.5">
                  {isToday ? (
                    <span className="w-7 h-7 rounded-full bg-primary text-white text-sm font-700 flex items-center justify-center">{day.getDate()}</span>
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
            const dayItems = getRequestsForDay(day, requests, calFilter);
            return (
              <div key={di} className={`border-r border-gray-200 last:border-r-0 p-2 ${isToday ? 'bg-primary/5' : ''}`}>
                <div className="flex flex-col gap-1">
                  {dayItems.map((req) => (
                    <div
                      key={req.id}
                      onClick={() => router.push(`/visor-documento/${req.supabaseId ?? req.id}`)}
                      className="flex items-start gap-1 px-1.5 py-1 rounded-lg text-xs font-500 bg-primary/10 text-primary cursor-pointer hover:bg-primary/20 transition-colors w-full overflow-hidden"
                      title={req.documentName}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1 ${getStatusDotColor(req.status)}`} />
                      <div className="min-w-0 overflow-hidden flex-1">
                        <p className="truncate font-600 leading-tight text-xs">{req.documentName}</p>
                        <p className="truncate text-primary/60 leading-tight text-[10px]">{req.recipientName} · {req.id}</p>
                      </div>
                    </div>
                  ))}
                  {dayItems.length === 0 && (
                    <div className="h-8" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Hourly view
  return (
    <div className="flex-1 flex flex-col overflow-auto">
      <div className="grid border-b border-gray-200" style={{ gridTemplateColumns: '56px repeat(7, 1fr)' }}>
        <div className="border-r border-gray-200" />
        {days.map((day, i) => {
          const isToday = isSameDay(day, today);
          return (
            <div key={i} className="py-2 text-center border-r border-gray-200 last:border-r-0">
              <div className={`text-xs font-600 ${isToday ? 'text-primary' : 'text-gray-500'}`}>{DAYS_SHORT[i]}</div>
              <div className="flex items-center justify-center mt-0.5">
                {isToday ? (
                  <span className="w-7 h-7 rounded-full bg-primary text-white text-sm font-700 flex items-center justify-center">{day.getDate()}</span>
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
          <div key={hour} className="grid border-b border-gray-100" style={{ gridTemplateColumns: '56px repeat(7, 1fr)', minHeight: '48px' }}>
            <div className="border-r border-gray-200 px-2 py-1 text-[10px] text-gray-400 text-right leading-none pt-1">
              {hour === 0 ? '' : `${hour.toString().padStart(2, '0')}:00`}
            </div>
            {days.map((day, di) => {
              const isToday = isSameDay(day, today);
              const dayRequests = getRequestsForDay(day, requests, calFilter).filter(req => {
                const ds = getRelevantDateStr(req);
                return ds ? new Date(ds).getHours() === hour : false;
              });
              return (
                <div key={di} className={`border-r border-gray-100 last:border-r-0 px-0.5 py-0.5 relative overflow-hidden ${isToday ? 'bg-primary/5' : ''}`}>
                  {dayRequests.map((req) => (
                    <div
                      key={req.id}
                      onClick={() => router.push(`/visor-documento/${req.supabaseId ?? req.id}`)}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-500 bg-primary/10 text-primary cursor-pointer hover:bg-primary/20 transition-colors mb-0.5 w-full overflow-hidden max-h-[44px]"
                      title={req.documentName}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${getStatusDotColor(req.status)}`} />
                      <div className="min-w-0 overflow-hidden flex-1">
                        <p className="truncate font-600 leading-tight text-xs">{req.documentName}</p>
                        <p className="truncate text-primary/60 leading-tight text-[10px]">{req.recipientName} · {req.id}</p>
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
function DayCalendar({ date, today, requests, calFilter }: { date: Date; today: Date; requests: ParticipationRequest[]; calFilter: CalendarStatusFilter }) {
  const router = useRouter();
  const isToday = isSameDay(date, today);
  const dayName = DAYS_SHORT[(date.getDay() + 6) % 7];

  function getRelevantDateStr(req: ParticipationRequest): string | undefined {
    if (calFilter === 'todos') {
      switch (req.status) {
        case 'en-progreso': case 'en-espera': return req.sentAt;
        case 'completado': return req.completedAt ?? req.sentAt;
        case 'vencido': return req.expiredAt ?? req.expiresAt ?? undefined;
        case 'rechazado': return req.rejectedAt ?? req.sentAt;
        case 'cancelado': return req.canceladoAt ?? req.sentAt;
        default: return req.sentAt;
      }
    }
    switch (calFilter) {
      case 'en-progreso': case 'en-espera': return req.sentAt;
      case 'completado': return req.completedAt;
      case 'por-vencer': return req.expiresAt ?? undefined;
      case 'vencido': return req.expiredAt ?? req.expiresAt ?? undefined;
      case 'rechazado': return req.rejectedAt;
      case 'cancelado': return req.canceladoAt;
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

  const allDayRequests = getRequestsForDay(date, requests, calFilter).filter(req => {
    const ds = getRelevantDateStr(req);
    return ds ? !hasSpecificTime(ds) : false;
  });

  const hasHourlyEvents = getRequestsForDay(date, requests, calFilter).some(req => {
    const ds = getRelevantDateStr(req);
    return ds ? hasSpecificTime(ds) : false;
  });

  if (!hasHourlyEvents) {
    // Board-style day view
    return (
      <div className="flex-1 flex flex-col overflow-auto">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200/60">
          <div className={`text-sm font-600 ${isToday ? 'text-primary' : 'text-gray-500'}`}>{dayName}</div>
          {isToday ? (
            <span className="w-9 h-9 rounded-full bg-primary text-white text-lg font-700 flex items-center justify-center">{date.getDate()}</span>
          ) : (
            <span className="text-2xl font-600 text-gray-700">{date.getDate()}</span>
          )}
          <span className="text-sm text-gray-500">{MONTHS_ES[date.getMonth()]} {date.getFullYear()}</span>
        </div>
        <div className="flex-1 p-4">
          {allDayRequests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Inbox size={32} className="text-muted-foreground/30" strokeWidth={1.5} />
              <span className="text-xs text-muted-foreground/60 mt-2">Sin solicitudes para este día</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {allDayRequests.map((req) => (
                <div
                  key={req.id}
                  onClick={() => router.push(`/visor-documento/${req.supabaseId ?? req.id}`)}
                  className={`bg-white rounded-lg border shadow-sm p-3 cursor-pointer hover:shadow-md transition-shadow ${req.priority === 'Urgente' ? 'border-l-4 border-l-red-500 border-t-border border-r-border border-b-border' : 'border-border'}`}
                >
                  <div className="flex items-center gap-1 mb-1.5">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${getStatusDotColor(req.status)}`} />
                    <span className={`text-[10px] font-600 px-1.5 py-0.5 rounded-full ${getStatusBadgeClass(req.status)}`}>{getStatusLabel(req.status)}</span>
                  </div>
                  <p className="text-xs font-700 text-foreground leading-tight mb-1 line-clamp-2">{req.documentName}</p>
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
        <div className={`text-sm font-600 ${isToday ? 'text-primary' : 'text-gray-500'}`}>{dayName}</div>
        {isToday ? (
          <span className="w-9 h-9 rounded-full bg-primary text-white text-lg font-700 flex items-center justify-center">{date.getDate()}</span>
        ) : (
          <span className="text-2xl font-600 text-gray-700">{date.getDate()}</span>
        )}
        <span className="text-sm text-gray-500">{MONTHS_ES[date.getMonth()]} {date.getFullYear()}</span>
      </div>

      {allDayRequests.length > 0 && (
        <div className="border-b border-gray-200/60 px-4 py-2 bg-gray-50/60">
          <div className="flex items-start gap-3">
            <div className="w-16 flex-shrink-0 text-[10px] text-gray-400 text-right pt-1 pr-2">Todo el día</div>
            <div className="flex-1 flex flex-col gap-1">
              {allDayRequests.map((req) => (
                <div
                  key={req.id}
                  onClick={() => router.push(`/visor-documento/${req.supabaseId ?? req.id}`)}
                  className="flex items-center gap-2 bg-primary/10 text-primary rounded-lg px-2 py-1 cursor-pointer hover:bg-primary/20 transition-colors"
                  title={req.documentName}
                >
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${getStatusDotColor(req.status)}`} />
                  <div className="min-w-0">
                    <p className="text-xs font-600 leading-tight truncate">{req.documentName}</p>
                    <p className="text-[10px] text-primary/60">{req.recipientName} · {req.id}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto" style={{ maxHeight: '520px' }}>
        {HOURS.map((hour) => {
          const dayItems = getRequestsForDay(date, requests, calFilter).filter(req => {
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
                  <div key={req.id} className="flex items-center gap-2 bg-primary/10 text-primary rounded-lg px-1 py-0.5 truncate mb-0.5 cursor-pointer hover:bg-primary/20 transition-colors" title={req.documentName} onClick={() => router.push(`/visor-documento/${req.supabaseId ?? req.id}`)}>
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${getStatusDotColor(req.status)}`} />
                    <div>
                      <p className="text-xs font-600 leading-tight">{req.documentName}</p>
                      <p className="text-[10px] text-primary/60">{req.recipientName} · {req.id}</p>
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

// ─── Kanban Card ─────────────────────────────────────────────────────────────
function KanbanCard({ req, onCancelled }: RequestCardProps) {
  const router = useRouter();
  const [showParticipants, setShowParticipants] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);

  const isCancellable = req.status === 'en-progreso' || req.status === 'en-espera';

  async function handleCancelConfirm(motivo: string, descripcion: string) {
    const supabase = createClient();
    if (req.supabaseId) {
      await supabase.from('documentos').update({
        estado: 'cancelado',
        cancelacion_motivo: motivo,
        cancelacion_descripcion: descripcion,
        cancelado_at: new Date().toISOString(),
      }).eq('id', req.supabaseId);
    }
    setShowCancelModal(false);
    onCancelled(req.id);
  }

  return (
    <>
      {showCancelModal && (
        <CancelModal req={req} onClose={() => setShowCancelModal(false)} onConfirm={handleCancelConfirm} />
      )}
      <div className={`bg-white rounded-lg border shadow-sm hover:shadow-md transition-shadow p-3 ${req.priority === 'Urgente' ? 'border-l-4 border-l-red-500 border-t-border border-r-border border-b-border' : 'border-border'}`}>
        {req.priority === 'Urgente' && (
          <div className="flex items-center gap-1 mb-2">
            <span className="inline-flex items-center gap-1 text-[10px] font-600 px-2 py-0.5 rounded-full bg-red-100 text-red-600 border border-red-200">
              <AlertTriangle size={9} />
              Urgente
            </span>
          </div>
        )}
        {/* Dates row — formatted as "07/05/2026 a las 8:00 a.m." */}
        <div className="flex flex-col gap-0.5 mb-2">
          <div className="flex items-center gap-1">
            <Calendar size={10} className="text-muted-foreground flex-shrink-0" />
            <span className="text-[10px] text-muted-foreground">Creado: {formatBoardDate(req.sentAt)}</span>
          </div>
          {req.tieneVencimiento && req.expiresAt && req.status !== 'completado' && req.status !== 'vencido' && req.status !== 'rechazado' && req.status !== 'cancelado' && (
            <div className="flex items-center gap-1">
              <Clock size={10} className="text-amber-500 flex-shrink-0" />
              <span className="text-[10px] text-amber-600 font-500">Vence: {formatExpiresAt(req.expiresAt)}</span>
            </div>
          )}
          {req.status === 'completado' && req.completedAt && (
            <div className="flex items-center gap-1">
              <CheckCircle2 size={10} className="text-emerald-500 flex-shrink-0" />
              <span className="text-[10px] text-emerald-600 font-500">Completado: {formatExpiresAt(req.completedAt)}</span>
            </div>
          )}
          {req.status === 'vencido' && req.expiredAt && (
            <div className="flex items-center gap-1">
              <Clock size={10} className="text-gray-400 flex-shrink-0" />
              <span className="text-[10px] text-gray-500 font-500">Vencido: {formatExpiresAt(req.expiredAt)}</span>
            </div>
          )}
          {req.status === 'rechazado' && req.rejectedAt && (
            <div className="flex items-center gap-1">
              <XCircle size={10} className="text-red-400 flex-shrink-0" />
              <span className="text-[10px] text-red-500 font-500">Rechazado: {formatExpiresAt(req.rejectedAt)}</span>
            </div>
          )}
          {req.status === 'cancelado' && req.canceladoAt && (
            <div className="flex items-center gap-1">
              <Ban size={10} className="text-gray-400 flex-shrink-0" />
              <span className="text-[10px] text-gray-500 font-500">Cancelado: {formatExpiresAt(req.canceladoAt)}</span>
            </div>
          )}
        </div>
        {/* Document name */}
        <p className="text-xs font-700 text-foreground leading-tight mb-1 line-clamp-2">{req.documentName}</p>
        {req.description && (
          <p className="text-[10px] text-muted-foreground leading-relaxed mb-2 line-clamp-2">{req.description}</p>
        )}

        {/* Document type badge inline */}
        {req.documentType && (
          <div className="mb-2">
            <span className="inline-flex items-center gap-1 text-[10px] font-500 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
              <FileText size={9} />
              {req.documentType}
            </span>
          </div>
        )}

        {/* Participants count */}
        <div className="flex items-center gap-1 mb-2">
          <ParticipantsIcon count={req.participants} />
          <button
            onClick={() => setShowParticipants(v => !v)}
            className="text-[10px] text-muted-foreground hover:text-primary transition-colors underline-offset-2 hover:underline"
          >
            {req.participants === 1 ? '1 participante' : `${req.participants} participantes`}
          </button>
        </div>

        {/* Participants panel */}
        {showParticipants && req.participantList && req.participantList.length > 0 && (
          <div className="border-t border-border/60 pt-2 mb-2">
            <div className="flex flex-col gap-1.5">
              {req.participantList.map((p, i) => (
                <div key={i} className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-600 text-foreground leading-tight truncate">{p.name}</span>
                  <div className="flex items-center gap-1">
                    <Mail size={8} className="text-muted-foreground flex-shrink-0" />
                    <span className="text-[9px] text-muted-foreground leading-tight truncate">{p.email}</span>
                  </div>
                  {p.rol && <span className="text-[9px] text-muted-foreground">Rol: <span className="font-500">{p.rol}</span></span>}
                  {p.acto && <span className="text-[9px] text-muted-foreground">Acto: <span className="font-500">{p.acto}</span></span>}
                  <span className={`text-[9px] font-500 px-1.5 py-0.5 rounded-full w-fit ${getParticipantStatusBadge(p.status)}`}>
                    {getParticipantStatusLabel(p.status)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Participation progress */}
        <div className="mb-2">
          <ParticipationProgressBar req={req} size="small" />
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5">
          {isCancellable && (
            <button
              onClick={() => setShowCancelModal(true)}
              title="Cancelar"
              className="flex items-center justify-center w-8 h-8 rounded-md border border-border text-foreground bg-white hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-colors flex-shrink-0"
            >
              <Ban size={12} />
            </button>
          )}
          <button
            title="Ver Documento"
            onClick={() => router.push(`/visor-documento/${req.supabaseId ?? req.id}`)}
            className={`${isCancellable ? 'flex-1' : 'w-full'} flex items-center justify-center gap-1.5 h-8 rounded-md bg-primary text-white hover:bg-primary/90 transition-colors text-xs font-500 px-2`}
          >
            <Eye size={12} />
            <span>Ver Documento</span>
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ParticipationRequestsPage() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [requests, setRequests] = useState<ParticipationRequest[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('lista');
  const [listLayout, setListLayout] = useState<'list' | 'grid'>('list');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('en-progreso');
  const [timeFilter, setTimeFilter] = useState('365');
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
    async function fetchSolicitudes() {
      try {
        setLoadingData(true);
        setDataError(null);
        const res = await fetch('/api/documentos/participation-requests');
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Error ${res.status}`);
        }
        const body = await res.json();
        setRequests(body.solicitudes ?? []);
      } catch (err: any) {
        setDataError(err.message ?? 'Error al cargar solicitudes');
      } finally {
        setLoadingData(false);
      }
    }
    fetchSolicitudes();
  }, []);

  useEffect(() => {
    if (!TERMINAL_STATUSES.includes(statusFilter)) {
      setTimeFilter('365');
    }
  }, [statusFilter]);

  const showTimeFilter = TERMINAL_STATUSES.includes(statusFilter);

  const filtered = React.useMemo(() => {
    let result = requests.filter(r => {
      // Status filter
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

      // Time filter (only for terminal statuses)
      if (TERMINAL_STATUSES.includes(statusFilter) && timeFilter !== 'todos') {
        const days = parseInt(timeFilter, 10);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        let dateStr: string | undefined;
        switch (r.status) {
          case 'completado': dateStr = r.completedAt; break;
          case 'vencido': dateStr = r.expiredAt ?? r.expiresAt ?? undefined; break;
          case 'rechazado': dateStr = r.rejectedAt ?? r.sentAt; break;
          case 'cancelado': dateStr = r.canceladoAt ?? r.sentAt; break;
        }
        if (dateStr && new Date(dateStr) < cutoff) return false;
      }

      // Search filter
      if (search.trim()) {
        const q = search.toLowerCase();
        if (
          !r.documentName.toLowerCase().includes(q) &&
          !r.recipientName.toLowerCase().includes(q) &&
          !r.recipientEmail.toLowerCase().includes(q)
        ) return false;
      }

      return true;
    });

    // Date sort
    result = [...result].sort((a, b) => {
      const da = new Date(a.sentAt).getTime();
      const db = new Date(b.sentAt).getTime();
      return dateSort === 'recientes' ? db - da : da - db;
    });

    return result;
  }, [requests, statusFilter, timeFilter, search, dateSort]);

  // Month-filtered requests for tablero (filter by boardMonth/boardYear)
  const boardFiltered = React.useMemo(() => {
    return requests.filter(r => {
      let dateStr: string;
      if (TERMINAL_STATUSES.includes(r.status)) {
        dateStr = r.completedAt ?? r.canceladoAt ?? r.expiredAt ?? r.rejectedAt ?? r.sentAt;
      } else {
        dateStr = r.sentAt;
      }
      let d = new Date(dateStr);
      return d.getFullYear() === boardYear && d.getMonth() === boardMonth;
    });
  }, [requests, boardMonth, boardYear]);

  function handleCancelled(id: string) {
    setRequests(prev =>
      prev.map(r => r.id === id ? { ...r, status: 'cancelado' as const } : r)
    );
    if (statusFilter === 'en-progreso' || statusFilter === 'en-espera') {
      setStatusFilter('cancelado');
    }
  }

  function prevMonth() {
    if (boardMonth === 0) { setBoardMonth(11); setBoardYear(y => y - 1); }
    else setBoardMonth(m => m - 1);
  }
  function nextMonth() {
    if (boardMonth === 11) { setBoardMonth(0); setBoardYear(y => y + 1); }
    else setBoardMonth(m => m + 1);
  }
  function calPrev() {
    if (calView === 'mes') {
      if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); }
      else setCalMonth(m => m - 1);
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
      if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); }
      else setCalMonth(m => m + 1);
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
      const weekEnd = new Date(calWeekStart);
      weekEnd.setDate(calWeekStart.getDate() + 6);
      return `Semana Del ${calWeekStart.getDate()} ${MONTHS_ES[calWeekStart.getMonth()]}`;
    }
    return `${calDay.getDate()} de ${MONTHS_ES[calDay.getMonth()]} ${calDay.getFullYear()}`;
  }

  const calViewLabels: Record<CalendarView, string> = { mes: 'Mes', semana: 'Semana', dia: 'Día' };

  if (loadingData) {
    return (
      <AppLayout noPadding>
        <div className="w-full max-w-none px-4 sm:px-6 lg:px-8 pt-2 pb-4 md:pb-6 min-h-[calc(100vh-8rem)] flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-muted-foreground">Cargando solicitudes...</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout noPadding>
      <div className="w-full max-w-none px-4 sm:px-6 lg:px-8 pt-2 pb-4 md:pb-6 min-h-[calc(100vh-8rem)]">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Send size={24} className="text-primary" />
              Solicitudes Enviadas
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Monitorea el estado de todos los documentos enviados para firma.
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

        {/* View toggle + Search row */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
          {/* View mode buttons */}
          <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-xl border border-border">
            <button
              onClick={() => setViewMode('lista')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-600 transition-all duration-150 ${viewMode === 'lista' ? 'bg-primary text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <List size={15} />
              Lista
            </button>
            <button
              onClick={() => setViewMode('tablero')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-600 transition-all duration-150 ${viewMode === 'tablero' ? 'bg-primary text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <LayoutGrid size={15} />
              Tablero
            </button>
            <button
              onClick={() => setViewMode('calendario')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-600 transition-all duration-150 ${viewMode === 'calendario' ? 'bg-primary text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <CalendarDays size={15} />
              Calendario
            </button>
          </div>

          {/* Right side */}
          {viewMode === 'tablero' ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-500 text-muted-foreground">Periodo:</span>
              <div className="flex items-center gap-2 border border-border rounded-lg px-3 py-1.5 bg-white">
                <button onClick={prevMonth} className="p-0.5 rounded hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground">
                  <ChevronLeft size={16} />
                </button>
                <span className="text-sm font-500 text-foreground min-w-[110px] text-center">
                  {MONTHS_ES[boardMonth].toLowerCase()} {boardYear}
                </span>
                <button onClick={nextMonth} className="p-0.5 rounded hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground">
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          ) : viewMode === 'calendario' ? (
            <div className="flex items-center gap-2">
              <span className="text-sm font-500 text-muted-foreground">Periodo:</span>
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setShowCalViewDropdown(v => !v)}
                  className="flex items-center gap-2 border border-border rounded-lg px-3 py-1.5 bg-white text-sm font-500 text-foreground hover:bg-muted/40 transition-colors"
                >
                  {calViewLabels[calView]}
                  <ChevronDown size={14} className="text-muted-foreground" />
                </button>
                {showCalViewDropdown && (
                  <div className="absolute right-0 top-full mt-1 bg-white border border-border rounded-lg shadow-lg z-20 min-w-[110px] py-1">
                    {(['mes', 'semana', 'dia'] as CalendarView[]).map((v) => (
                      <button
                        key={v}
                        onClick={() => { setCalView(v); setShowCalViewDropdown(false); }}
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
              <div className="relative flex-1 sm:w-64">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Buscar..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-sm border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                />
              </div>
              {/* Date sort dropdown */}
              <div className="relative" ref={dateSortRef}>
                <button
                  onClick={() => setShowDateDropdown(v => !v)}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm border border-border rounded-lg bg-white hover:border-primary/50 hover:text-primary transition-colors text-foreground"
                  title="Ordenar por fecha"
                >
                  <ArrowUpDown size={15} />
                  <span className="hidden sm:inline">{dateSort === 'recientes' ? 'Más recientes' : 'Más antiguos'}</span>
                  <ChevronDown size={13} className={`transition-transform ${showDateDropdown ? 'rotate-180' : ''}`} />
                </button>
                {showDateDropdown && (
                  <div className="absolute right-0 top-full mt-1 bg-white border border-border rounded-lg shadow-lg z-20 py-1">
                    {([
                      { value: 'recientes', label: 'Más recientes' },
                      { value: 'antiguos', label: 'Más antiguos' },
                    ] as const).map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => { setDateSort(opt.value); setShowDateDropdown(false); }}
                        className={`w-full text-left px-4 py-2 text-sm transition-colors ${dateSort === opt.value ? 'bg-primary/10 text-primary font-600' : 'text-foreground hover:bg-muted/50'}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* List / Grid toggle */}
              <div className="flex items-center border border-border rounded-lg overflow-hidden bg-white">
                <button
                  onClick={() => setListLayout('list')}
                  className={`p-2 transition-colors ${listLayout === 'list' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-primary'}`}
                  title="Vista lista"
                >
                  <List size={16} />
                </button>
                <button
                  onClick={() => setListLayout('grid')}
                  className={`p-2 transition-colors ${listLayout === 'grid' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-primary'}`}
                  title="Vista cuadrícula"
                >
                  <LayoutGrid size={16} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-border mb-4" />

        {/* Status pill filters + Period filter for lista */}
        {viewMode !== 'tablero' && viewMode !== 'calendario' && (
          <div className="flex flex-col gap-3 mb-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* Main status filters */}
              <div className="flex flex-wrap items-center gap-2">
                {statusFilterOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setStatusFilter(opt.value)}
                    className={`px-4 py-1.5 rounded-full text-sm font-500 border transition-colors ${
                      statusFilter === opt.value
                        ? 'bg-primary text-white border-primary' : 'bg-white text-foreground border-border hover:border-primary/50 hover:text-primary'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Time sub-filter — only for terminal statuses */}
              {showTimeFilter && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground font-500 mr-1">Período:</span>
                  {timeFilterOptions.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setTimeFilter(opt.value)}
                      className={`px-3 py-1 rounded-full text-xs font-500 border transition-colors ${
                        timeFilter === opt.value
                          ? 'bg-primary/10 text-primary border-primary/40' : 'bg-white text-muted-foreground border-border hover:border-primary/40 hover:text-primary'
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

        {/* ── Lista ── */}
        {viewMode === 'lista' && (
          <div className="flex-1 w-full min-w-0">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center bg-white rounded-xl border border-border">
                <Send size={32} className="text-muted-foreground/40 mb-3" />
                <p className="text-sm font-600 text-foreground">Sin resultados</p>
                <p className="text-xs text-muted-foreground mt-1">No se encontraron solicitudes con los filtros aplicados.</p>
              </div>
            ) : listLayout === 'grid' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
                {filtered.map((req) => (
                  <RequestCardGrid key={req.id} req={req} onCancelled={handleCancelled} />
                ))}
              </div>
            ) : (
              <div className="w-full space-y-4">
                {filtered.map((req) => (
                  <RequestCard key={req.id} req={req} onCancelled={handleCancelled} />
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-3 text-right">
              Mostrando {filtered.length} de {requests.length} solicitudes
            </p>
          </div>
        )}

        {/* ── Tablero ── */}
        {viewMode === 'tablero' && (
          <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: '520px' }}>
            {kanbanColumns.map((col) => {
              const colItems = boardFiltered.filter(r => r.status === col.status);
              return (
                <div
                  key={col.status}
                  className={`flex-1 min-w-[220px] rounded-xl border border-border border-t-2 ${col.borderColor} ${col.bgColor} flex flex-col`}
                  style={{ minHeight: '480px' }}
                >
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200/60">
                    <span className="text-sm font-600 text-foreground">{col.label}</span>
                    <span className="text-sm font-500 text-muted-foreground">{colItems.length}</span>
                  </div>
                  <div className="flex-1 flex flex-col items-center justify-center p-3 gap-2">
                    {colItems.length === 0 ? (
                      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                        <Inbox size={32} className="text-muted-foreground/30" strokeWidth={1.5} />
                        <span className="text-xs text-muted-foreground/60">Sin solicitudes</span>
                      </div>
                    ) : (
                      <div className="w-full flex flex-col gap-2">
                        {colItems.map((req) => (
                          <KanbanCard key={req.id} req={req} onCancelled={handleCancelled} />
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
            <div className="flex flex-wrap items-center gap-2 mb-5">
              {([
                { value: 'todos', label: 'Todos' },
                { value: 'en-progreso', label: 'En Progreso' },
                { value: 'en-espera', label: 'En Espera' },
                { value: 'completado', label: 'Completados' },
                { value: 'por-vencer', label: 'Por Vencer' },
                { value: 'vencido', label: 'Vencido' },
                { value: 'rechazado', label: 'Rechazado' },
                { value: 'cancelado', label: 'Cancelado' },
              ] as { value: CalendarStatusFilter; label: string }[]).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setCalFilter(opt.value)}
                  className={`px-4 py-1.5 rounded-full text-sm font-500 border transition-colors ${
                    calFilter === opt.value
                      ? 'bg-primary text-white border-primary' : 'bg-white text-foreground border-border hover:border-primary/50 hover:text-primary'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="bg-white rounded-xl border border-border overflow-hidden flex flex-col" style={{ minHeight: '600px' }}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                <h2 className="text-base font-700 text-gray-800">{getCalTitle()}</h2>
                <div className="flex items-center gap-1">
                  <button onClick={calPrev} className="p-1 rounded hover:bg-gray-100 transition-colors text-gray-500 hover:text-gray-800" aria-label="Período anterior">
                    <ChevronLeft size={16} />
                  </button>
                  <button onClick={calNext} className="p-1 rounded hover:bg-gray-100 transition-colors text-gray-500 hover:text-gray-800" aria-label="Período siguiente">
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
              {calView === 'mes' && (
                <MonthCalendar year={calYear} month={calMonth} today={today} requests={requests} calFilter={calFilter} />
              )}
              {calView === 'semana' && (
                <WeekCalendar weekStart={calWeekStart} today={today} requests={requests} calFilter={calFilter} />
              )}
              {calView === 'dia' && (
                <DayCalendar date={calDay} today={today} requests={requests} calFilter={calFilter} />
              )}
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}