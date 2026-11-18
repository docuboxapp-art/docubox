'use client';

import React, { useState, useRef, useEffect } from 'react';
import AppLayout from '@/components/AppLayout';
import ActivityHub, { ActivityLoading } from '@/components/activity/ActivityHub';
import ActivityTypeTabs from '@/components/activity/ActivityTypeTabs';
import { ActivitySummary, type ActivitySummaryMetric } from '@/components/documents/ActivitySummary';
import { useRouter } from 'next/navigation';
import { hasEffectiveParticipation } from '@/lib/documents/participant-visibility';

import { Send, Search, User, UserPlus, Calendar, Clock, CheckCircle2, XCircle, LayoutList, LayoutGrid, CalendarDays, ChevronLeft, ChevronRight, Inbox, ChevronDown, Eye, Users, Mail, AlertTriangle, Ban, AlertCircle, ArrowUpDown, PauseCircle, FileText, Tag, UserCheck, UserMinus, MoreHorizontal } from 'lucide-react';
import { AñadirParticipantesModal, ConfigurarParticipacionModal } from '@/app/crear-documento/components/StepParticipantes';
import type { Participant } from '@/app/crear-documento/components/types';

interface ParticipantListItem {
  id?: string | null;
  userId?: string | null;
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
  currentAccess?: boolean;
  historicalParticipation?: boolean;
  relationshipStatus?: string;
  isCurrentUser?: boolean;
}

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
  participantList?: ParticipantListItem[];
  participantMode?: 'solo_yo' | 'yo_y_otros' | 'solo_otros' | null;
  participationOrder?: string;
  uninviteEvents?: { date: string; label: string }[];
  inviteEvents?: { date: string; label: string }[];
  signaturesTotal: number;
  signaturesDone: number;
  supabaseId?: string;
  ownerEmail?: string;
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

function canSendReminderToParticipant(req: ParticipationRequest, participant: ParticipantListItem) {
  if (req.status !== 'en-progreso' || !participant.email?.trim() || participant.currentAccess === false) return false;
  if (PARTICIPATED_STATUSES.includes(participant.status ?? '')) return false;
  return true;
}

async function sendParticipationReminder(
  req: ParticipationRequest,
  participant: { name: string; email: string }
) {
  const response = await fetch('/api/documentos/send-reminder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      participantEmail: participant.email,
      participantName: participant.name,
      documentName: req.documentName,
      documentId: req.supabaseId ?? req.id,
    }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(
      response.status < 500 && typeof payload.error === 'string'
        ? payload.error
        : 'No fue posible enviar el recordatorio. Inténtalo de nuevo más tarde.'
    );
  }
}

async function cancelDocumentRequest(
  req: ParticipationRequest,
  motivo: string,
  descripcion: string
) {
  const response = await fetch('/api/documentos/update-estado', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'cancelar',
      documentoId: req.supabaseId ?? req.id,
      motivo,
      descripcion,
    }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'No fue posible cancelar el documento.');
  }
}

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

function getDocumentIconTone(status: ParticipationRequest['status']) {
  switch (status) {
    case 'en-progreso': return 'bg-primary/10 text-primary';
    case 'en-espera': return 'bg-amber-50 text-amber-600';
    case 'completado': return 'bg-emerald-50 text-emerald-600';
    case 'vencido':
    case 'rechazado': return 'bg-red-50 text-red-600';
    case 'cancelado': return 'bg-slate-100 text-slate-500';
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
  const [error, setError] = useState('');

  async function handleConfirm() {
    setLoading(true);
    setError('');
    try {
      await onConfirm();
      setSent(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible enviar el recordatorio.');
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
          <h2 className="text-base font-600 text-foreground mb-1">Recordatorio enviado</h2>
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
          <h2 className="text-base font-600 text-foreground">Enviar recordatorio</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-5">
          ¿Deseas enviar un recordatorio a <span className="font-600 text-foreground">{participantName}</span> para que participe en el documento <span className="font-600 text-foreground">{documentName}</span>?
        </p>
        {error && <p role="alert" className="mb-4 text-xs text-red-600">{error}</p>}
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

interface UninviteParticipantButtonProps {
  request: ParticipationRequest;
  participant: ParticipantListItem;
  compact?: boolean;
  onRevoked: (
    requestId: string,
    participant: ParticipantListItem,
    hadEffectiveParticipation: boolean,
    revokedAt?: string
  ) => void;
}

function UninviteParticipantButton({
  request,
  participant,
  compact = false,
  onRevoked,
}: UninviteParticipantButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (
    participant.currentAccess === false ||
    participant.isCurrentUser ||
    PARTICIPATED_STATUSES.includes(participant.status ?? '') ||
    hasEffectiveParticipation({
      participation_status: participant.status,
      sub_estado: participant.subEstado,
      historical_participation: participant.historicalParticipation,
    })
  ) return null;

  async function handleConfirm() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/documentos/update-estado', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'desinvitar',
          documentoId: request.supabaseId ?? request.id,
          participantId: participant.id || participant.userId,
          participantEmail: participant.email,
          motivo: 'OWNER_UNINVITED_PARTICIPANT',
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'No fue posible desinvitar al participante.');
      }
      onRevoked(request.id, participant, payload.hadEffectiveParticipation === true, payload.revokedAt);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible desinvitar al participante.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Desinvitar participante"
        aria-label={`Desinvitar a ${participant.name}`}
        className={`inline-flex items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 ${compact ? 'h-7 w-7' : 'h-8 w-8'}`}
      >
        <UserMinus size={compact ? 12 : 14} />
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="uninvite-participant-title"
            className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
          >
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-red-50 text-red-600">
                <UserMinus size={18} />
              </span>
              <h2 id="uninvite-participant-title" className="text-lg font-600 text-foreground">
                Desinvitar participante
              </h2>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {participant.name} perderá el acceso a <span className="font-600 text-foreground">{request.documentName}</span> y el documento dejará de aparecer en su espacio. Solo puedes desinvitar a alguien que aún no lo ha revisado ni ha interactuado con él. La desinvitación quedará en la actividad del documento.
            </p>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={loading}
                className="h-10 rounded-md border border-border bg-white px-4 text-sm font-600 text-foreground hover:bg-muted/40 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={loading}
                className="h-10 rounded-md bg-red-600 px-4 text-sm font-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {loading ? 'Procesando...' : 'Desinvitar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible cancelar el documento.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 relative">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle size={20} className="text-red-500 flex-shrink-0" />
          <h2 className="text-lg font-600 text-red-600">Cancelar Documento</h2>
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
function ParticipationProgressBar({ req, size = 'normal' }: { req: ParticipationRequest; size?: 'normal' | 'small' | 'grid' }) {
  const total = req.signaturesTotal;
  const done = req.signaturesDone;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

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
                <span className="font-600">{chip.count}</span> {chip.label}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (size === 'grid') {
    return (
      <div aria-label={`${done} de ${total} participaciones completadas, ${pct}%`}>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-200/80">
          <div className={`h-full rounded-full transition-all duration-300 ${pct === 100 ? 'bg-emerald-500' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-2 flex min-h-6 flex-wrap gap-1">
          {chips.map((chip, index) => (
            <span key={index} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-normal ${chip.cls}`}>
              {chip.count} {chip.label}
            </span>
          ))}
        </div>
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
              <span className="font-600">{chip.count}</span> {chip.label}
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

function InviteParticipantsButton({ request, onInvite, compact = false }: {
  request: ParticipationRequest;
  onInvite: (request: ParticipationRequest) => void;
  compact?: boolean;
}) {
  if (request.status !== 'en-progreso' ||
      (request.participantMode !== 'yo_y_otros' && request.participantMode !== 'solo_otros')) return null;
  return (
    <button type="button" onClick={() => onInvite(request)}
      title="Invitar participantes" aria-label={`Invitar participantes a ${request.documentName}`}
      className={`inline-flex items-center justify-center gap-1 rounded-md border border-slate-200 bg-white text-primary transition-colors hover:border-primary/30 hover:bg-primary/5 ${compact ? 'h-7 px-2 text-[11px]' : 'h-8 px-2.5 text-xs'}`}>
      <UserPlus size={compact ? 12 : 14} /> Invitar participantes
    </button>
  );
}

function InviteParticipantsModal({ request, onClose, onInvited }: {
  request: ParticipationRequest;
  onClose: () => void;
  onInvited: () => Promise<void>;
}) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [configuring, setConfiguring] = useState<Participant | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const existing: Participant[] = (request.participantList ?? []).map((participant) => ({
    id: participant.id || participant.userId || participant.email,
    name: participant.name, email: participant.email,
    role: 'firmante',
  }));

  async function submit() {
    if (!participants.length || participants.some((participant) => !participant.configured)) {
      setError('Configura el acto, rol, firma y notificación de cada nuevo participante.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/documentos/invitar-participantes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId: request.supabaseId ?? request.id, participants }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'No fue posible invitar participantes.');
      await onInvited();
      if (body.queued) {
        setResult('Participantes agregados. Recibirán la invitación cuando llegue su turno.');
      } else if (body.deliveryFailed > 0) {
        setResult('Participantes agregados. Algunas notificaciones no se pudieron enviar; revisa sus canales de contacto.');
      } else {
        onClose();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible invitar participantes.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[40] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
        <div role="dialog" aria-modal="true" aria-labelledby="invite-participants-title"
          className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div>
              <h2 id="invite-participants-title" className="flex items-center gap-2 text-lg font-600 text-foreground">
                <UserPlus size={19} className="text-primary" /> Invitar participantes
              </h2>
              <p className="mt-1 text-sm text-slate-500">{request.documentName}</p>
            </div>
            <button type="button" onClick={onClose} disabled={saving}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">Cerrar</button>
          </div>
          <div className="min-h-0 space-y-3 overflow-y-auto px-5 py-4">
            {request.participationOrder !== 'paralelo' && (
              <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                El documento tiene orden de participación. Los nuevos participantes quedarán al final del flujo y recibirán su invitación al llegar su turno.
              </p>
            )}
            {participants.map((participant) => (
              <div key={participant.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-600 text-foreground">{participant.name}</p>
                  <p className="truncate text-xs text-slate-500">{participant.email} · {participant.configured ? `${participant.acto} · ${participant.rolDocumento}` : 'Falta configurar participación'}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button type="button" onClick={() => setConfiguring(participant)} className="text-xs text-primary hover:underline">Configurar</button>
                  <button type="button" onClick={() => setParticipants((current) => current.filter((item) => item.id !== participant.id))}
                    className="text-xs text-red-600 hover:underline">Quitar</button>
                </div>
              </div>
            ))}
            {!result && <button type="button" onClick={() => setShowPicker(true)}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 px-4 py-3 text-sm text-primary hover:border-primary/40 hover:bg-primary/5">
              <UserPlus size={15} /> Agregar participante
            </button>}
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            {result && <p role="status" className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-700">{result}</p>}
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
            <button type="button" onClick={onClose} disabled={saving}
              className="h-9 rounded-md border border-slate-200 px-4 text-sm text-slate-700 hover:bg-slate-50">{result ? 'Cerrar' : 'Cancelar'}</button>
            {!result && <button type="button" onClick={submit} disabled={saving || participants.length === 0}
              className="h-9 rounded-md bg-primary px-4 text-sm font-600 text-white hover:bg-primary/90 disabled:opacity-50">
              {saving ? 'Invitando...' : `Invitar ${participants.length || ''} participante${participants.length === 1 ? '' : 's'}`}
            </button>}
          </div>
        </div>
      </div>
      {showPicker && <AñadirParticipantesModal
        onClose={() => setShowPicker(false)}
        onAdd={(participant) => {
          setParticipants((current) => [...current, participant]);
          setShowPicker(false);
          setConfiguring(participant);
        }}
        existingParticipants={[...existing, ...participants]}
        currentUserEmail={request.ownerEmail}
        mode={request.participantMode}
      />}
      {configuring && <ConfigurarParticipacionModal
        participant={configuring}
        onClose={() => setConfiguring(null)}
        onSave={(updated) => {
          setParticipants((current) => current.map((item) => item.id === updated.id ? updated : item));
          return true;
        }}
        supplementalResources={[]}
      />}
    </>
  );
}

// ─── Request Card (List View) ─────────────────────────────────────────────────
interface RequestCardProps {
  req: ParticipationRequest;
  onCancelled: (id: string) => void;
  onInvite: (request: ParticipationRequest) => void;
  onParticipantRevoked: (
    requestId: string,
    participant: ParticipantListItem,
    hadEffectiveParticipation: boolean,
    revokedAt?: string
  ) => void;
}

function RequestCard({
  req,
  onCancelled,
  onInvite,
  onParticipantRevoked,
}: RequestCardProps) {
  const router = useRouter();
  const [showParticipants, setShowParticipants] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [reminderModal, setReminderModal] = useState<{
    idx: number;
    name: string;
    email: string;
  } | null>(null);
  const [openedAt] = useState(() => Date.now());
  const actionsRef = useRef<HTMLDivElement>(null);

  const isCancellable = req.status === 'en-progreso' || req.status === 'en-espera';
  const total = Math.max(0, req.signaturesTotal);
  const done = Math.max(0, req.signaturesDone);
  const progress = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const expiresAt = req.tieneVencimiento && req.expiresAt ? new Date(req.expiresAt) : null;
  const expiresSoon =
    isCancellable &&
    expiresAt !== null &&
    expiresAt.getTime() > openedAt &&
    expiresAt.getTime() - openedAt <= 72 * 60 * 60 * 1000;
  const participants = req.participantList ?? [];
  const unsignedParticipants = participants.filter(
    (p) => !PARTICIPATED_STATUSES.includes(p.status ?? '')
  );
  const rejectedParticipants = participants.filter((p) => p.status === 'Rechazado');
  const detailsId = `request-details-${req.id}`;
  const actionsId = `request-actions-${req.id}`;
  const activity = [
    { date: req.sentAt, label: 'Solicitud creada por ti' },
    ...(req.inviteEvents ?? []),
    ...(req.uninviteEvents ?? []),
    ...(req.completedAt ? [{ date: req.completedAt, label: 'Documento completado' }] : []),
    ...(req.rejectedAt ? [{ date: req.rejectedAt, label: 'Documento rechazado' }] : []),
    ...(req.canceladoAt ? [{ date: req.canceladoAt, label: 'Documento cancelado' }] : []),
    ...(req.expiredAt ? [{ date: req.expiredAt, label: 'Documento vencido' }] : []),
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  useEffect(() => {
    if (!showActions) return;
    function closeOnOutsideClick(event: MouseEvent) {
      if (actionsRef.current && !actionsRef.current.contains(event.target as Node)) {
        setShowActions(false);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setShowActions(false);
    }
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [showActions]);

  async function handleCancelConfirm(motivo: string, descripcion: string) {
    await cancelDocumentRequest(req, motivo, descripcion);
    setShowCancelModal(false);
    onCancelled(req.id);
  }

  async function handleSendReminder() {
    if (!reminderModal) return;
    await sendParticipationReminder(req, reminderModal);
  }

  return (
    <>
      {showCancelModal && (
        <CancelModal
          req={req}
          onClose={() => setShowCancelModal(false)}
          onConfirm={handleCancelConfirm}
        />
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

      <article className="relative rounded-lg border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="grid gap-4 px-4 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center xl:grid-cols-[minmax(260px,2.3fr)_auto_minmax(130px,1fr)_minmax(145px,1fr)_auto] xl:gap-5">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setShowParticipants((value) => !value)}
              aria-label={
                showParticipants
                  ? `Ocultar participantes de ${req.documentName}`
                  : `Ver participantes de ${req.documentName}`
              }
              aria-expanded={showParticipants}
              aria-controls={detailsId}
              className="flex h-8 w-6 flex-shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {showParticipants ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
            </button>
            <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${getDocumentIconTone(req.status)}`}>
              <FileText size={19} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-600 text-foreground" title={req.documentName}>
                {req.documentName}
              </h3>
              {req.description && (
                <p className="mt-1 line-clamp-2 text-xs leading-4 text-slate-600" title={req.description}>
                  {req.description}
                </p>
              )}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <FileText size={11} aria-hidden="true" />
                  {req.documentType || 'Documento'}
                </span>
                <span className="hidden text-slate-300 sm:inline">·</span>
                <span>Creado: {formatDate(req.sentAt)}</span>
                <span className="hidden text-slate-300 sm:inline">·</span>
                <span className="inline-flex items-center gap-1">
                  <ParticipantsIcon count={req.participants} />
                  {req.participants} {req.participants === 1 ? 'participante' : 'participantes'}
                </span>
              </div>
              {req.etiquetas && req.etiquetas.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1" aria-label="Etiquetas del documento">
                  {req.etiquetas.map((etiqueta, index) => (
                    <span
                      key={`${etiqueta.nombre}-${index}`}
                      className="inline-flex max-w-full items-center gap-1 rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700"
                      title={`Etiqueta: ${etiqueta.nombre}`}
                    >
                      <Tag size={10} className="shrink-0" aria-hidden="true" />
                      <span className="truncate">{etiqueta.nombre}</span>
                    </span>
                  ))}
                </div>
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
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <div className="flex min-w-0 items-start gap-2 text-xs text-muted-foreground">
            <Calendar
              size={15}
              className="mt-0.5 flex-shrink-0 text-slate-500"
              aria-hidden="true"
            />
            <div className="min-w-0">
              {req.priority === 'Urgente' && (
                <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 font-600 text-red-600">
                  <AlertTriangle size={11} aria-hidden="true" />
                  Urgente
                </span>
              )}
              {expiresSoon && req.priority !== 'Urgente' && (
                <span className="mb-1 inline-flex rounded-full bg-amber-50 px-2 py-0.5 font-600 text-amber-700">
                  Próximo a vencer
                </span>
              )}
              <p className="whitespace-nowrap">
                {expiresAt
                  ? `${req.status === 'vencido' ? 'Venció' : 'Vence'}: ${formatExpiresAt(req.expiresAt!)}`
                  : 'Sin vencimiento'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 md:justify-end">
            <button
              type="button"
              onClick={() => router.push(`/visor-documento/${req.supabaseId ?? req.id}`)}
              className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-primary px-3 text-xs font-600 text-white transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <Eye size={14} aria-hidden="true" />
              Ver documento
            </button>
            <div className="relative" ref={actionsRef}>
              <button
                type="button"
                onClick={() => setShowActions((value) => !value)}
                aria-label={`Acciones de ${req.documentName}`}
                aria-haspopup="menu"
                aria-expanded={showActions}
                aria-controls={actionsId}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <MoreHorizontal size={17} aria-hidden="true" />
              </button>
              {showActions && (
                <div
                  id={actionsId}
                  role="menu"
                  className="absolute right-0 top-full z-30 mt-1 w-52 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setShowParticipants((value) => !value);
                      setShowActions(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <Users size={15} aria-hidden="true" />
                    {showParticipants ? 'Ocultar participantes' : 'Ver participantes'}
                  </button>
                  {isCancellable && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setShowActions(false);
                        setShowCancelModal(true);
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                    >
                      <Ban size={15} aria-hidden="true" />
                      Cancelar solicitud
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {showParticipants && (
          <div id={detailsId} className="border-t border-slate-200 bg-slate-50/60 p-3 sm:p-4">
            <div className="rounded-lg border border-blue-100 bg-blue-50/30 p-4">
              <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="flex items-center gap-2 text-sm font-600 text-foreground">
                    <Users size={16} className="text-slate-500" aria-hidden="true" />
                    Participantes ({req.participants})
                  </h4>
                  <InviteParticipantsButton request={req} onInvite={onInvite} compact />
                </div>
                <div className="w-full sm:max-w-xs">
                  <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                    <span>Progreso de participación</span>
                    <span className="font-600 text-foreground">{progress}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              </div>

              {participants.length > 0 ? (
                <div className="space-y-2">
                  {participants.map((participant, index) => (
                    <div
                      key={participant.id ?? participant.userId ?? index}
                      className="grid gap-3 rounded-lg border border-blue-100 bg-white/80 px-3 py-3 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] md:items-center"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-600 text-primary">
                          {participant.name
                            .trim()
                            .split(/\s+/)
                            .slice(0, 2)
                            .map((part) => part[0]?.toUpperCase())
                            .join('') || '—'}
                        </span>
                        <div className="min-w-0">
                          <p
                            className="truncate text-xs font-600 text-foreground"
                            title={participant.name}
                          >
                            {participant.name}
                          </p>
                          <p
                            className="flex items-center gap-1 truncate text-xs text-muted-foreground"
                            title={participant.email}
                          >
                            <Mail size={11} className="flex-shrink-0" aria-hidden="true" />
                            {participant.email}
                          </p>
                        </div>
                      </div>
                      <div className="min-w-0 space-y-1 text-xs text-muted-foreground">
                        {participant.rol && (
                          <p className="flex items-center gap-1.5">
                            <UserCheck size={12} aria-hidden="true" />
                            Rol:{' '}
                            <span className="truncate font-600 text-foreground">
                              {participant.rol}
                            </span>
                          </p>
                        )}
                        {participant.acto && (
                          <p className="flex items-center gap-1.5">
                            <FileText size={12} aria-hidden="true" />
                            Acción:{' '}
                            <span className="truncate font-600 text-foreground">
                              {participant.acto}
                            </span>
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 md:justify-end">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-600 ${getParticipantStatusBadge(participant.status)}`}
                        >
                          {getParticipantStatusLabel(participant.status)}
                        </span>
                        {participant.currentAccess === false &&
                          participant.historicalParticipation && (
                            <span className="text-xs text-slate-500">Acceso revocado</span>
                          )}
                        {canSendReminderToParticipant(req, participant) && (
                            <button
                              type="button"
                              onClick={() =>
                                setReminderModal({
                                  idx: index,
                                  name: participant.name,
                                  email: participant.email,
                                })
                              }
                              className="inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-xs font-600 text-primary hover:bg-primary/5"
                            >
                              <Send size={12} aria-hidden="true" />
                              Enviar recordatorio
                            </button>
                          )}
                        {isCancellable && (
                          <UninviteParticipantButton
                            request={req}
                            participant={participant}
                            onRevoked={onParticipantRevoked}
                            compact
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-lg bg-slate-50 px-3 py-4 text-xs text-muted-foreground">
                  Aún no hay detalles de participantes disponibles.
                </p>
              )}
            </div>

            {req.status === 'vencido' && unsignedParticipants.length > 0 && (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Sin participar: {unsignedParticipants.map((p) => p.name).join(', ')}.
              </p>
            )}
            {req.status === 'rechazado' &&
              (rejectedParticipants.length > 0 || req.rejectionMotivo) && (
                <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  Rechazado
                  {rejectedParticipants.length > 0
                    ? ` por ${rejectedParticipants.map((p) => p.name).join(', ')}`
                    : ''}
                  {req.rejectionMotivo ? ` · Motivo: ${req.rejectionMotivo}` : ''}
                  {req.rejectionDescripcion ? ` · ${req.rejectionDescripcion}` : ''}
                </p>
              )}
            {req.status === 'cancelado' &&
              (req.cancelacionMotivo || req.cancelacionDescripcion) && (
                <p className="mt-3 rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-xs text-slate-700">
                  Motivo de cancelación: {req.cancelacionMotivo}
                  {req.cancelacionDescripcion ? ` · ${req.cancelacionDescripcion}` : ''}
                </p>
              )}
            {req.status === 'en-espera' &&
              (req.enEsperaUsuario || req.enEsperaMotivo || req.enEsperaDescripcion) && (
                <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Documento en espera{req.enEsperaUsuario ? ` por ${req.enEsperaUsuario}` : ''}
                  {req.enEsperaMotivo ? ` · ${req.enEsperaMotivo}` : ''}
                  {req.enEsperaDescripcion ? ` · ${req.enEsperaDescripcion}` : ''}
                </p>
              )}

            <div className="mt-4 px-1">
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
        )}
      </article>
    </>
  );
}
// ─── Request Card (Grid View) ────────────────────────────────────────────────
function RequestCardGrid({ req, onCancelled, onInvite, onParticipantRevoked }: RequestCardProps) {
  const router = useRouter();
  const [showParticipants, setShowParticipants] = useState(false);
  const [actionsPlacement, setActionsPlacement] = useState<'top' | 'footer' | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [reminderModal, setReminderModal] = useState<{ idx: number; name: string; email: string } | null>(null);
  const [openedAt] = useState(() => Date.now());
  const topActionsRef = useRef<HTMLDivElement>(null);
  const footerActionsRef = useRef<HTMLDivElement>(null);

  const isCancellable = req.status === 'en-progreso' || req.status === 'en-espera';
  const unsignedParticipants = req.participantList?.filter(p => !PARTICIPATED_STATUSES.includes(p.status ?? '')) ?? [];
  const rejectedParticipants = req.participantList?.filter(p => p.status === 'Rechazado') ?? [];
  const total = Math.max(0, req.signaturesTotal);
  const done = Math.max(0, req.signaturesDone);
  const progress = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const expiresAt = req.tieneVencimiento && req.expiresAt ? new Date(req.expiresAt) : null;
  const expiresSoon = isCancellable && expiresAt !== null &&
    expiresAt.getTime() > openedAt && expiresAt.getTime() - openedAt <= 72 * 60 * 60 * 1000;
  const firstParticipant = req.participantList?.[0];
  const participantNameParts = firstParticipant?.name.trim().split(/\s+/).filter(Boolean) ?? [];
  const initials = participantNameParts.length > 1
    ? `${participantNameParts[0][0]}${participantNameParts[participantNameParts.length - 1][0]}`.toUpperCase()
    : participantNameParts[0]?.slice(0, 2).toUpperCase() || '—';
  const participantsId = `grid-participants-${req.id}`;
  const cardTone = req.status === 'completado'
    ? 'border-emerald-200 bg-white'
    : req.status === 'vencido' || req.status === 'rechazado'
      ? 'border-red-200 bg-white'
      : expiresSoon
        ? 'border-amber-200 bg-white'
        : 'border-slate-200/90 bg-white';
  useEffect(() => {
    if (!actionsPlacement) return;
    function closeOnOutsideClick(event: MouseEvent) {
      if (!topActionsRef.current?.contains(event.target as Node) && !footerActionsRef.current?.contains(event.target as Node)) {
        setActionsPlacement(null);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setActionsPlacement(null);
    }
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [actionsPlacement]);

  async function handleCancelConfirm(motivo: string, descripcion: string) {
    await cancelDocumentRequest(req, motivo, descripcion);
    setShowCancelModal(false);
    onCancelled(req.id);
  }

  async function handleSendReminder() {
    if (!reminderModal) return;
    await sendParticipationReminder(req, reminderModal);
  }

  function renderActionsMenu(placement: 'top' | 'footer') {
    const open = actionsPlacement === placement;
    const menuId = `grid-actions-${placement}-${req.id}`;
    return (
      <div className="relative shrink-0" ref={placement === 'top' ? topActionsRef : footerActionsRef}>
        <button
          type="button"
          onClick={() => setActionsPlacement(open ? null : placement)}
          aria-label={`Acciones de ${req.documentName}`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={menuId}
          className={`flex items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${placement === 'footer' ? 'h-10 w-10' : 'h-9 w-9'}`}
        >
          <MoreHorizontal size={17} aria-hidden="true" />
        </button>
        {open && (
          <div id={menuId} role="menu" className={`absolute right-0 z-30 w-52 rounded-lg border border-slate-200 bg-white p-1 shadow-lg ${placement === 'footer' ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
            <button type="button" role="menuitem" onClick={() => { setShowParticipants((value) => !value); setActionsPlacement(null); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
              <Users size={15} aria-hidden="true" />
              {showParticipants ? 'Ocultar participantes' : 'Ver participantes'}
            </button>
            {isCancellable && (
              <button type="button" role="menuitem" onClick={() => { setActionsPlacement(null); setShowCancelModal(true); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50">
                <Ban size={15} aria-hidden="true" /> Cancelar solicitud
              </button>
            )}
          </div>
        )}
      </div>
    );
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
      <article className={`relative flex h-full min-w-0 flex-col gap-3 rounded-lg border p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-colors hover:border-slate-300 ${cardTone}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <span className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full ${expiresSoon ? 'bg-amber-50 text-amber-600' : getDocumentIconTone(req.status)}`}>
              <FileText size={21} aria-hidden="true" />
            </span>
            <span className={`inline-flex min-w-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-500 ${expiresSoon ? 'bg-amber-100 text-amber-700' : req.status === 'vencido' ? 'bg-red-100 text-red-700' : getStatusBadgeClass(req.status)}`}>
              {expiresSoon ? <Clock size={13} aria-hidden="true" /> : req.status === 'vencido' ? <AlertTriangle size={13} aria-hidden="true" /> : getStatusIcon(req.status)}
              {expiresSoon ? 'Próximo a vencer' : getStatusLabel(req.status)}
            </span>
            {req.priority === 'Urgente' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-[11px] text-red-600">
                <AlertTriangle size={12} aria-hidden="true" /> Urgente
              </span>
            )}
          </div>
          {renderActionsMenu('top')}
        </div>

        <div className="min-w-0">
          <h3 className="truncate text-base font-600 text-foreground" title={req.documentName}>{req.documentName}</h3>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {req.documentType || 'Documento'} · Creado: {formatDate(req.sentAt)}
          </p>
          <p className="mt-2 min-h-9 line-clamp-2 text-sm leading-relaxed text-slate-500" title={req.description || undefined}>
            {req.description || ' '}
          </p>
        </div>

        {/* Info box: Vencido */}
        {showParticipants && req.status === 'vencido' && unsignedParticipants.length > 0 && (
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
        {showParticipants && req.status === 'rechazado' && rejectedParticipants.length > 0 && (
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
        {showParticipants && req.status === 'cancelado' && (req.cancelacionMotivo || req.cancelacionDescripcion) && (
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
        {showParticipants && req.status === 'en-espera' && (req.enEsperaUsuario || req.enEsperaMotivo || req.enEsperaDescripcion) && (
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

        <div className="mt-auto space-y-3">
          <div className="flex w-full items-center gap-2.5">
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-600 text-slate-600">{initials}</span>
            {req.participants > 1 && <span className="-ml-4 flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-slate-100 text-xs text-slate-600">+{req.participants - 1}</span>}
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-500 text-foreground">{req.participants} {req.participants === 1 ? 'participante' : 'participantes'}</span>
              <span className="block text-xs text-muted-foreground">{done} de {total} completados</span>
            </span>
            <span className="text-xs font-600 text-foreground">{progress}%</span>
          </div>
          <ParticipationProgressBar req={req} size="grid" />
          <div className={`flex min-h-8 items-center gap-2 text-xs ${req.status === 'vencido' || expiresSoon ? 'text-red-600' : 'text-muted-foreground'}`}>
            <Calendar size={14} className={`flex-shrink-0 ${req.status === 'vencido' || expiresSoon ? 'text-red-500' : 'text-slate-500'}`} aria-hidden="true" />
            <span>
              {req.status === 'completado' && req.completedAt
                ? `Completado: ${formatExpiresAt(req.completedAt)}`
                : req.status === 'vencido' && req.expiresAt
                  ? `Venció: ${formatExpiresAt(req.expiresAt)}`
                  : req.status === 'rechazado' && req.rejectedAt
                    ? `Rechazado: ${formatExpiresAt(req.rejectedAt)}`
                    : req.status === 'cancelado' && req.canceladoAt
                      ? `Cancelado: ${formatExpiresAt(req.canceladoAt)}`
                      : expiresAt && req.expiresAt
                        ? `Vence: ${formatExpiresAt(req.expiresAt)}`
                        : 'Sin vencimiento'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.push(`/visor-documento/${req.supabaseId ?? req.id}`)}
              className="inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-600 text-white transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <Eye size={14} aria-hidden="true" /> Ver documento
            </button>
            {renderActionsMenu('footer')}
          </div>
          <button
            type="button"
            onClick={() => setShowParticipants((value) => !value)}
            aria-expanded={showParticipants}
            aria-controls={participantsId}
            aria-label={`${showParticipants ? 'Ocultar' : 'Ver'} participantes de ${req.documentName}`}
            className="flex w-full items-center justify-between gap-2 border-t border-slate-100 pt-2 text-left text-xs font-500 text-slate-600 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <span className="inline-flex items-center gap-2"><Users size={14} aria-hidden="true" />{showParticipants ? 'Ocultar participantes' : 'Ver participantes'}</span>
            <ChevronDown size={15} aria-hidden="true" className={showParticipants ? 'rotate-180' : ''} />
          </button>
        </div>

        {/* Participants panel */}
        {showParticipants && req.participantList && req.participantList.length > 0 && (
          <div id={participantsId} className="rounded-lg border border-blue-100 bg-blue-50/30 p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs font-500 text-foreground">
              <span className="flex items-center gap-1.5"><Users size={13} className="text-muted-foreground" />Participantes</span>
              <InviteParticipantsButton request={req} onInvite={onInvite} compact />
            </div>
            <div className="flex flex-col gap-3">
              {req.participantList.map((p, i) => (
                <div key={i} className="flex flex-col gap-1 rounded-lg border border-blue-100 bg-white/80 px-3 py-2">
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
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className={`text-xs font-500 px-2 py-0.5 rounded-full ${getParticipantStatusBadge(p.status)}`}>
                        {getParticipantStatusLabel(p.status)}
                      </span>
                      {p.currentAccess === false && p.historicalParticipation && (
                        <span className="truncate text-[10px] font-500 text-slate-500">Acceso revocado</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {canSendReminderToParticipant(req, p) && (
                        <button
                          onClick={() => setReminderModal({ idx: i, name: p.name, email: p.email })}
                          className="flex items-center gap-1 text-[10px] font-500 text-primary hover:text-primary/80 transition-colors whitespace-nowrap"
                        >
                          <Send size={10} />
                          Enviar recordatorio
                        </button>
                      )}
                      {isCancellable && (
                        <UninviteParticipantButton
                          request={req}
                          participant={p}
                          compact
                          onRevoked={onParticipantRevoked}
                        />
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </article>
    </>
  );
}

function CalendarRequestCard({
  req,
  density = 'compact',
}: {
  req: ParticipationRequest;
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
        : req.status === 'en-espera'
          ? 'border-amber-200 bg-amber-50/60'
          : req.status === 'cancelado'
            ? 'border-slate-200 bg-slate-50'
            : 'border-primary/20 bg-primary/5';
  const dateLabel =
    req.status === 'completado' && req.completedAt
      ? `Completado: ${formatExpiresAt(req.completedAt)}`
      : req.status === 'vencido' && (req.expiredAt || req.expiresAt)
        ? `Venció: ${formatExpiresAt((req.expiredAt || req.expiresAt)!)}`
        : req.status === 'rechazado' && req.rejectedAt
          ? `Rechazado: ${formatExpiresAt(req.rejectedAt)}`
          : req.status === 'cancelado' && req.canceladoAt
            ? `Cancelado: ${formatExpiresAt(req.canceladoAt)}`
            : req.tieneVencimiento && req.expiresAt
              ? `Vence: ${formatExpiresAt(req.expiresAt)}`
              : 'Sin vencimiento';

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
            {req.documentType || 'Documento'} · {req.recipientName}
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
          <span className="flex items-start gap-1 text-[11px] text-slate-500">
            <Calendar size={12} className="mt-0.5 shrink-0" aria-hidden="true" /> {dateLabel}
          </span>
          {req.priority === 'Urgente' && (
            <span className="inline-flex items-center gap-1 text-[10px] text-red-600">
              <AlertTriangle size={11} aria-hidden="true" /> Urgente
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
  requests,
  calFilter,
}: {
  year: number;
  month: number;
  today: Date;
  requests: ParticipationRequest[];
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
              const dayRequests = getRequestsForDay(cell.date, requests, calFilter);
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
                    {dayRequests.slice(0, 2).map((req) => (
                      <CalendarRequestCard key={req.id} req={req} />
                    ))}
                    {dayRequests.length > 2 && (
                      <span className="text-[10px] text-muted-foreground/60 pl-1">
                        +{dayRequests.length - 2} más
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
  requests,
  calFilter,
}: {
  weekStart: Date;
  today: Date;
  requests: ParticipationRequest[];
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

  function getRelevantDateStr(req: ParticipationRequest): string | undefined {
    if (calFilter === 'todos') {
      switch (req.status) {
        case 'en-progreso':
        case 'en-espera':
          return req.sentAt;
        case 'completado':
          return req.completedAt ?? req.sentAt;
        case 'vencido':
          return req.expiredAt ?? req.expiresAt ?? undefined;
        case 'rechazado':
          return req.rejectedAt ?? req.sentAt;
        case 'cancelado':
          return req.canceladoAt ?? req.sentAt;
        default:
          return req.sentAt;
      }
    }
    switch (calFilter) {
      case 'en-progreso':
      case 'en-espera':
        return req.sentAt;
      case 'completado':
        return req.completedAt;
      case 'por-vencer':
        return req.expiresAt ?? undefined;
      case 'vencido':
        return req.expiredAt ?? req.expiresAt ?? undefined;
      case 'rechazado':
        return req.rejectedAt;
      case 'cancelado':
        return req.canceladoAt;
    }
    return undefined;
  }

  // Check if any request in the week has a specific time
  const weekRequests = days.flatMap((day) => getRequestsForDay(day, requests, calFilter));
  const hasHourlyEvents = weekRequests.some((req) => {
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
            const dayItems = getRequestsForDay(day, requests, calFilter);
            return (
              <div
                key={di}
                className={`border-r border-gray-200 last:border-r-0 p-2 ${isToday ? 'bg-primary/5' : ''}`}
              >
                <div className="flex flex-col gap-1">
                  {dayItems.map((req) => (
                    <CalendarRequestCard key={req.id} req={req} density="standard" />
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

  // Hourly view
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
              const dayRequests = getRequestsForDay(day, requests, calFilter).filter((req) => {
                const ds = getRelevantDateStr(req);
                return ds ? new Date(ds).getHours() === hour : false;
              });
              return (
                <div
                  key={di}
                  className={`border-r border-gray-100 last:border-r-0 px-0.5 py-0.5 relative overflow-hidden ${isToday ? 'bg-primary/5' : ''}`}
                >
                  {dayRequests.map((req) => (
                    <CalendarRequestCard key={req.id} req={req} />
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
  requests,
  calFilter,
}: {
  date: Date;
  today: Date;
  requests: ParticipationRequest[];
  calFilter: CalendarStatusFilter;
}) {
  const isToday = isSameDay(date, today);
  const dayName = DAYS_SHORT[(date.getDay() + 6) % 7];

  function getRelevantDateStr(req: ParticipationRequest): string | undefined {
    if (calFilter === 'todos') {
      switch (req.status) {
        case 'en-progreso':
        case 'en-espera':
          return req.sentAt;
        case 'completado':
          return req.completedAt ?? req.sentAt;
        case 'vencido':
          return req.expiredAt ?? req.expiresAt ?? undefined;
        case 'rechazado':
          return req.rejectedAt ?? req.sentAt;
        case 'cancelado':
          return req.canceladoAt ?? req.sentAt;
        default:
          return req.sentAt;
      }
    }
    switch (calFilter) {
      case 'en-progreso':
      case 'en-espera':
        return req.sentAt;
      case 'completado':
        return req.completedAt;
      case 'por-vencer':
        return req.expiresAt ?? undefined;
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

  const allDayRequests = getRequestsForDay(date, requests, calFilter).filter((req) => {
    const ds = getRelevantDateStr(req);
    return ds ? !hasSpecificTime(ds) : false;
  });

  const hasHourlyEvents = getRequestsForDay(date, requests, calFilter).some((req) => {
    const ds = getRelevantDateStr(req);
    return ds ? hasSpecificTime(ds) : false;
  });

  if (!hasHourlyEvents) {
    // Board-style day view
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
          {allDayRequests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Inbox size={32} className="text-muted-foreground/30" strokeWidth={1.5} />
              <span className="text-xs text-muted-foreground/60 mt-2">
                Sin solicitudes para este día
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {allDayRequests.map((req) => (
                <CalendarRequestCard key={req.id} req={req} density="expanded" />
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

      {allDayRequests.length > 0 && (
        <div className="border-b border-gray-200/60 px-4 py-2 bg-gray-50/60">
          <div className="flex items-start gap-3">
            <div className="w-16 flex-shrink-0 text-[10px] text-gray-400 text-right pt-1 pr-2">
              Todo el día
            </div>
            <div className="flex-1 flex flex-col gap-1">
              {allDayRequests.map((req) => (
                <CalendarRequestCard key={req.id} req={req} density="standard" />
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto" style={{ maxHeight: '520px' }}>
        {HOURS.map((hour) => {
          const dayItems = getRequestsForDay(date, requests, calFilter).filter((req) => {
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
                  <CalendarRequestCard key={req.id} req={req} density="standard" />
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
function KanbanCard({ req, onCancelled, onInvite, onParticipantRevoked }: RequestCardProps) {
  const router = useRouter();
  const [showParticipants, setShowParticipants] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [reminderModal, setReminderModal] = useState<{ name: string; email: string } | null>(null);
  const [openedAt] = useState(() => Date.now());
  const actionsRef = useRef<HTMLDivElement>(null);
  const isCancellable = req.status === 'en-progreso' || req.status === 'en-espera';
  const total = Math.max(0, req.signaturesTotal);
  const done = Math.max(0, req.signaturesDone);
  const progress = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const expiresAt = req.tieneVencimiento && req.expiresAt ? new Date(req.expiresAt) : null;
  const expiresSoon =
    isCancellable &&
    expiresAt !== null &&
    expiresAt.getTime() > openedAt &&
    expiresAt.getTime() - openedAt <= 72 * 60 * 60 * 1000;
  const cardTone =
    req.status === 'completado'
      ? 'border-emerald-200/70 bg-gradient-to-br from-emerald-50/50 via-white to-white'
      : req.status === 'vencido' || req.status === 'rechazado'
        ? 'border-red-200/70 bg-gradient-to-br from-red-50/50 via-white to-white'
        : expiresSoon
          ? 'border-amber-200/70 bg-gradient-to-br from-amber-50/50 via-white to-white'
          : 'border-slate-200/90 bg-gradient-to-br from-primary/5 via-white to-white';
  const actionsId = `board-actions-${req.id}`;
  const participantsId = `board-participants-${req.id}`;

  useEffect(() => {
    if (!showActions) return;
    function closeOnOutsideClick(event: MouseEvent) {
      if (actionsRef.current && !actionsRef.current.contains(event.target as Node))
        setShowActions(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setShowActions(false);
    }
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [showActions]);

  async function handleCancelConfirm(motivo: string, descripcion: string) {
    await cancelDocumentRequest(req, motivo, descripcion);
    setShowCancelModal(false);
    onCancelled(req.id);
  }

  async function handleSendReminder() {
    if (!reminderModal) return;
    await sendParticipationReminder(req, reminderModal);
  }

  return (
    <>
      {showCancelModal && (
        <CancelModal
          req={req}
          onClose={() => setShowCancelModal(false)}
          onConfirm={handleCancelConfirm}
        />
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
      <article
        className={`relative flex min-w-0 flex-col gap-3 rounded-lg border p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-colors hover:border-slate-300 ${cardTone}`}
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
            {req.priority === 'Urgente' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-[11px] text-red-600">
                <AlertTriangle size={11} aria-hidden="true" /> Urgente
              </span>
            )}
          </div>
          <div className="relative shrink-0" ref={actionsRef}>
            <button
              type="button"
              onClick={() => setShowActions((value) => !value)}
              aria-label={`Acciones de ${req.documentName}`}
              aria-haspopup="menu"
              aria-expanded={showActions}
              aria-controls={actionsId}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <MoreHorizontal size={17} aria-hidden="true" />
            </button>
            {showActions && (
              <div
                id={actionsId}
                role="menu"
                className="absolute right-0 top-full z-30 mt-1 w-52 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowParticipants((value) => !value);
                    setShowActions(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
                >
                  <Users size={14} aria-hidden="true" />{' '}
                  {showParticipants ? 'Ocultar participantes' : 'Ver participantes'}
                </button>
                {isCancellable && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setShowActions(false);
                      setShowCancelModal(true);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50"
                  >
                    <Ban size={14} aria-hidden="true" /> Cancelar solicitud
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="min-w-0">
          <h3
            className="line-clamp-2 text-sm font-600 leading-snug text-foreground"
            title={req.documentName}
          >
            {req.documentName}
          </h3>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {req.documentType || 'Documento'} · Creado: {formatExpiresAt(req.sentAt)}
          </p>
          {req.description && (
            <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-slate-500">
              {req.description}
            </p>
          )}
        </div>

        <div className="space-y-2 border-t border-slate-200/70 pt-3">
          <button
            type="button"
            onClick={() => setShowParticipants((value) => !value)}
            aria-expanded={showParticipants}
            aria-controls={participantsId}
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
          <ParticipationProgressBar req={req} size="grid" />
        </div>

        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <Calendar size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            {req.status === 'completado' && req.completedAt
              ? `Completado: ${formatExpiresAt(req.completedAt)}`
              : req.status === 'vencido' && req.expiresAt
                ? `Venció: ${formatExpiresAt(req.expiresAt)}`
                : req.status === 'rechazado' && req.rejectedAt
                  ? `Rechazado: ${formatExpiresAt(req.rejectedAt)}`
                  : req.status === 'cancelado' && req.canceladoAt
                    ? `Cancelado: ${formatExpiresAt(req.canceladoAt)}`
                    : req.expiresAt && req.tieneVencimiento
                      ? `Vence: ${formatExpiresAt(req.expiresAt)}`
                      : 'Sin vencimiento'}
          </span>
        </p>
        <button
          type="button"
          onClick={() => router.push(`/visor-documento/${req.supabaseId ?? req.id}`)}
          className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-primary px-2 text-xs font-600 text-white hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Eye size={14} aria-hidden="true" /> Ver documento
        </button>

        {showParticipants && (
          <div id={participantsId} className="space-y-2 rounded-lg border border-blue-100 bg-blue-50/30 p-3">
            <InviteParticipantsButton request={req} onInvite={onInvite} compact />
            {req.participantList?.map((p, i) => (
              <div key={i} className="rounded-md border border-blue-100 bg-white/80 p-2">
                <p className="truncate text-xs font-600 text-foreground">{p.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">{p.email}</p>
                {(p.rol || p.acto) && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {[p.rol, p.acto].filter(Boolean).join(' · ')}
                  </p>
                )}
                <div className="mt-2 flex items-center justify-between gap-1.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] ${getParticipantStatusBadge(p.status)}`}
                  >
                    {getParticipantStatusLabel(p.status)}
                  </span>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {canSendReminderToParticipant(req, p) && (
                      <button
                        type="button"
                        onClick={() => setReminderModal({ name: p.name, email: p.email })}
                        className="inline-flex items-center gap-1 text-[11px] font-500 text-primary hover:text-primary/80"
                      >
                        <Send size={11} aria-hidden="true" /> Enviar recordatorio
                      </button>
                    )}
                    {isCancellable && (
                      <UninviteParticipantButton
                        request={req}
                        participant={p}
                        compact
                        onRevoked={onParticipantRevoked}
                      />
                    )}
                  </div>
                </div>
                {p.currentAccess === false && p.historicalParticipation && (
                  <p className="mt-1 text-[10px] text-slate-500">Acceso revocado</p>
                )}
              </div>
            ))}
            {!req.participantList?.length && (
              <p className="text-[11px] text-muted-foreground">Sin participantes disponibles.</p>
            )}
          </div>
        )}
      </article>
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
function DocumentRequestsPage() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [requests, setRequests] = useState<ParticipationRequest[]>([]);
  const [summaryNow] = useState(() => Date.now());
  const [inviteRequest, setInviteRequest] = useState<ParticipationRequest | null>(null);
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

  const showTimeFilter = TERMINAL_STATUSES.includes(statusFilter);
  const selectedPeriodLabel =
    timeFilter === 'custom'
      ? 'Rango personalizado'
      : timeFilterOptions.find((option) => option.value === timeFilter)?.label ?? 'Últimos 30 días';

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
        let dateStr: string | undefined;
        switch (r.status) {
          case 'completado': dateStr = r.completedAt ?? r.respondedAt ?? r.sentAt; break;
          case 'vencido': dateStr = r.expiredAt ?? r.expiresAt ?? r.sentAt; break;
          case 'rechazado': dateStr = r.rejectedAt ?? r.sentAt; break;
          case 'cancelado': dateStr = r.canceladoAt ?? r.sentAt; break;
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
          if (timeFilter === 'today') {
            cutoff.setHours(0, 0, 0, 0);
          } else {
            cutoff.setDate(cutoff.getDate() - Number(timeFilter));
          }
          if (eventTime < cutoff.getTime()) return false;
        }
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
  }, [requests, statusFilter, timeFilter, customPeriodRange, search, dateSort]);

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

  const summaryMetrics: ActivitySummaryMetric[] = React.useMemo(() => {
    const dueSoon = requests.filter((request) => {
      if (request.status !== 'en-progreso' || !request.expiresAt) return false;
      const remaining = new Date(request.expiresAt).getTime() - summaryNow;
      return remaining >= 0 && remaining <= 72 * 60 * 60 * 1000;
    }).length;
    return [
      { label: 'Solicitudes enviadas', value: requests.length, icon: Send, tone: 'blue' },
      { label: 'En progreso', value: requests.filter((request) => request.status === 'en-progreso').length, icon: Clock, tone: 'indigo' },
      { label: 'Próximas a vencer (72 h)', value: dueSoon, icon: AlertTriangle, tone: 'amber' },
      { label: 'Completadas', value: requests.filter((request) => request.status === 'completado').length, icon: CheckCircle2, tone: 'emerald' },
    ];
  }, [requests, summaryNow]);

  function handleCancelled(id: string) {
    setRequests(prev =>
      prev.map(r => r.id === id ? { ...r, status: 'cancelado' as const } : r)
    );
    if (statusFilter === 'en-progreso' || statusFilter === 'en-espera') {
      setStatusFilter('cancelado');
    }
  }

  function handleParticipantRevoked(
    requestId: string,
    participant: ParticipantListItem,
    hadEffectiveParticipation: boolean,
    revokedAt?: string
  ) {
    setRequests((current) =>
      current.map((request) => {
        if (request.id !== requestId) return request;
        const matchesParticipant = (entry: ParticipantListItem) =>
          (participant.id && entry.id === participant.id)
          || (participant.userId && entry.userId === participant.userId)
          || entry.email.toLowerCase() === participant.email.toLowerCase();
        const participantList = hadEffectiveParticipation
          ? (request.participantList || []).map((entry) =>
              matchesParticipant(entry)
                ? {
                    ...entry,
                    currentAccess: false,
                    historicalParticipation: true,
                    relationshipStatus: 'REVOKED',
                  }
                : entry
            )
          : (request.participantList || []).filter((entry) => !matchesParticipant(entry));
        return {
          ...request,
          participantList,
          uninviteEvents: [
            ...(request.uninviteEvents ?? []),
            { date: revokedAt || new Date().toISOString(), label: `Se desinvitó a ${participant.name}` },
          ],
          participants: participantList.length,
          signaturesTotal: participantList.length,
        };
      })
    );
  }

  async function handleParticipantsInvited() {
    try {
      const response = await fetch('/api/documentos/participation-requests');
      if (!response.ok) throw new Error('No se pudo actualizar la lista. Recarga la página.');
      const body = await response.json();
      setRequests(body.solicitudes ?? []);
    } catch {
      setDataError('Se agregaron los participantes, pero no se pudo actualizar la lista. Recarga la página.');
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
    return <ActivityLoading mode="sent" />;
  }

  return (
    <AppLayout noPadding>
      {inviteRequest && <InviteParticipantsModal
        request={inviteRequest}
        onClose={() => setInviteRequest(null)}
        onInvited={handleParticipantsInvited}
      />}
      <div className="-mx-4 -my-4 min-h-[calc(100vh-4rem)] bg-[#f6f8fb] px-4 py-4 sm:px-5 md:-my-6 md:py-5 lg:px-6">
        <div className="mx-auto w-full max-w-[1600px]">
        {/* Header */}
        <div className="mb-4 flex flex-col gap-3 border-b border-slate-200/80 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-600 leading-tight text-slate-950">Solicitudes enviadas</h1>
            <p className="mt-1 text-sm text-slate-500">
              Monitorea los documentos, formularios y expedientes que has enviado.
            </p>
          </div>
        </div>

        <ActivityTypeTabs mode="sent" active="documentos" />

        {/* Data error banner */}
        {dataError && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-center gap-2">
            <AlertCircle size={16} className="flex-shrink-0" />
            {dataError}
          </div>
        )}

        <ActivitySummary
          id="requests-summary-metrics"
          title="Resumen de solicitudes"
          description="Estado de tus solicitudes enviadas."
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
              <span className="text-xs font-600 text-slate-400">Periodo</span>
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setShowCalViewDropdown(v => !v)}
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
              <div className="relative min-w-[180px] flex-1 sm:w-72">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
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
                  onClick={() => setShowDateDropdown(v => !v)}
                  className="flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-600 text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
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

        {/* Status pill filters + Period filter for lista */}
        {viewMode !== 'tablero' && viewMode !== 'calendario' && (
          <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50/60 px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* Main status filters */}
              <div className="flex flex-wrap items-center gap-1.5">
                {statusFilterOptions.map((opt) => (
                  <button
                    type="button"
                    key={opt.value}
                    onClick={() => setStatusFilter(opt.value)}
                    className={`flex min-h-8 items-center rounded-md border px-2.5 text-xs font-normal transition-colors ${
                      statusFilter === opt.value
                        ? 'border-primary/25 bg-primary/5 text-primary' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Time sub-filter — only for terminal statuses */}
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
                                    setCustomPeriodDraft((range) => ({ ...range, start: event.target.value }));
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
                                    setCustomPeriodDraft((range) => ({ ...range, end: event.target.value }));
                                    setCustomPeriodError('');
                                  }}
                                  className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10"
                                />
                              </label>
                            </div>
                            {customPeriodError && <p role="alert" className="mt-2 text-xs text-red-600">{customPeriodError}</p>}
                            <div className="mt-3 flex justify-end gap-2">
                              <button type="button" onClick={() => { setShowCustomPeriod(false); setCustomPeriodError(''); }} className="h-8 rounded-md px-2.5 text-xs text-slate-600 hover:bg-slate-50">Volver</button>
                              <button
                                type="button"
                                disabled={!customPeriodDraft.start || !customPeriodDraft.end}
                                onClick={() => {
                                  if (customPeriodDraft.start > customPeriodDraft.end) {
                                    setCustomPeriodError('La fecha inicial debe ser anterior a la final.');
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
                  <Send size={19} />
                </span>
                <p className="text-sm font-600 text-slate-800">Sin resultados</p>
                <p className="mt-1 text-xs text-slate-500">No se encontraron solicitudes con los filtros aplicados.</p>
              </div>
            ) : listLayout === 'grid' ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {filtered.map((req) => (
                  <RequestCardGrid
                    key={req.id}
                    req={req}
                    onCancelled={handleCancelled}
                    onInvite={setInviteRequest}
                    onParticipantRevoked={handleParticipantRevoked}
                  />
                ))}
              </div>
            ) : (
              <div className="w-full space-y-3">
                {filtered.map((req) => (
                  <RequestCard
                    key={req.id}
                    req={req}
                    onCancelled={handleCancelled}
                    onInvite={setInviteRequest}
                    onParticipantRevoked={handleParticipantRevoked}
                  />
                ))}
              </div>
            )}
            <p className="mt-3 text-right text-xs text-slate-400">
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
                  className={`flex min-w-[220px] flex-1 flex-col rounded-lg border border-slate-200/90 border-t-2 ${col.borderColor} ${col.bgColor}`}
                  style={{ minHeight: '480px' }}
                >
                  <div className="flex items-center justify-between border-b border-slate-200/70 bg-white/70 px-3 py-2.5">
                    <span className="text-xs font-600 text-slate-700">{col.label}</span>
                    <span className="flex h-5 min-w-5 items-center justify-center rounded bg-white px-1.5 text-xs font-600 text-slate-500">{colItems.length}</span>
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
                          <KanbanCard
                            key={req.id}
                            req={req}
                            onCancelled={handleCancelled}
                            onInvite={setInviteRequest}
                            onParticipantRevoked={handleParticipantRevoked}
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
            <div className="mb-4 flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200/90 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
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
                  className={`flex h-8 items-center rounded-md border px-2.5 text-xs font-600 transition-colors ${
                    calFilter === opt.value
                      ? 'border-primary/30 bg-primary/10 text-primary' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex flex-col overflow-hidden rounded-lg border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]" style={{ minHeight: '600px' }}>
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <h2 className="text-sm font-600 text-slate-800">{getCalTitle()}</h2>
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
      </div>
    </AppLayout>
  );
}

export default function ParticipationRequestsPage() {
  return <ActivityHub mode="sent" documents={DocumentRequestsPage} />;
}
