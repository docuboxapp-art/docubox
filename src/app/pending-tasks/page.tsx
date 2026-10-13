'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import AppLayout from '@/components/AppLayout';
import AppLogo from '@/components/ui/AppLogo';
import { CheckSquare, Search, FileSignature, Eye, AlertTriangle, Flame, LayoutGrid, CalendarDays, List, ChevronLeft, ChevronRight, Inbox, X, MessageSquare, History, Shield, Link2, Play, CheckCircle2, XCircle, Download, Upload, UserCheck, FileText, FolderOpen, Zap, Bell, Plus, AlertCircle, Users, ClipboardCheck, Lock, RefreshCw, BookOpen, Star, Send, Cpu, Edit2, Trash2, Save, ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import NewTaskWizard from './components/NewTaskWizard';
import { fetchAllPages } from '@/lib/tasks/pagination';
import { completionMode } from '@/lib/tasks/completion-policy';
import { dueCalendarLabel, isScheduledForLater, toLocalDateTimeInput } from '@/lib/tasks/schedule';
import { resourceStatusLabel } from '@/lib/tasks/resource-labels';
import { isFinishedTask, matchesTaskStatus, taskStatusAtTime, visibleTaskStatus, type TaskStatus, type TaskStatusScope } from '@/lib/tasks/view-state';

// ─── Types ────────────────────────────────────────────────────────────────────
type TaskType =
  | 'firmar_documento' | 'revisar_documento' | 'aprobar_documento'
  | 'subir_anexo'| 'validar_identidad' | 'corregir_datos' | 'resolver_comentario' |'confirmar_lectura' | 'descargar_constancia' | 'validar_efirma'
  | 'obtener_nom151' | 'cerrar_expediente' | 'retomar_borrador' | 'revisar_vencimiento'
  | 'responder_formulario' | 'seguimiento_formulario' | 'revisar_expediente';

type Priority = 'critica' | 'alta' | 'media' | 'baja';
type ViewMode = 'lista' | 'kanban' | 'calendario' | 'documento';

interface ChecklistItem { id: string; text: string; done: boolean; position?: number; }
interface Comment { id: string; authorId: string | null; author: string; avatar: string; text: string; date: string; }
interface ActivityEntry { id: string; action: string; user: string; date: string; icon: React.ElementType; color: string; }
interface Dependency { id: string; taskId: string; title: string; status: TaskStatus; }

interface Task {
  id: string;
  assignedTo: string | null;
  createdBy: string | null;
  workspaceId: string;
  sourceType: string | null;
  sourceId: string | null;
  automationKey: string | null;
  origin: 'manual' | 'sistema';
  workKind: 'accion' | 'actividad';
  resolutionNote: string | null;
  title: string;
  description: string;
  type: TaskType;
  priority: Priority;
  status: TaskStatus;
  risk: 'alto' | 'medio' | 'bajo';
  dueDate: string;
  scheduledFor: string;
  createdAt: string;
  sla: string;
  responsible: string;
  responsibleAvatar: string;
  creator: string;
  documentName: string;
  documentId: string;
  expedienteId: string;
  expedienteName: string;
  isOverdue: boolean;
  isBlocked: boolean;
  isCritical: boolean;
  tags: string[];
  checklist: ChecklistItem[];
  comments: Comment[];
  activity: ActivityEntry[];
  dependencies: Dependency[];
  mainAction: string;
}

// ─── Config Maps ──────────────────────────────────────────────────────────────
const TASK_TYPE_CONFIG: Record<TaskType, { label: string; icon: React.ElementType; color: string; bg: string; border: string }> = {
  firmar_documento:    { label: 'Firmar documento',     icon: FileSignature,  color: 'text-blue-600',   bg: 'bg-blue-50',    border: 'border-blue-200' },
  revisar_documento:   { label: 'Revisar documento',    icon: Eye,            color: 'text-purple-600', bg: 'bg-purple-50',  border: 'border-purple-200' },
  aprobar_documento:   { label: 'Aprobar documento',    icon: ClipboardCheck, color: 'text-green-600',  bg: 'bg-green-50',   border: 'border-green-200' },
  subir_anexo:         { label: 'Subir anexo',          icon: Upload,         color: 'text-amber-600',  bg: 'bg-amber-50',   border: 'border-amber-200' },
  validar_identidad:   { label: 'Validar identidad',    icon: UserCheck,      color: 'text-cyan-600',   bg: 'bg-cyan-50',    border: 'border-cyan-200' },
  corregir_datos:      { label: 'Corregir datos',       icon: RefreshCw,      color: 'text-orange-600', bg: 'bg-orange-50',  border: 'border-orange-200' },
  resolver_comentario: { label: 'Resolver comentario',  icon: MessageSquare,  color: 'text-pink-600',   bg: 'bg-pink-50',    border: 'border-pink-200' },
  confirmar_lectura:   { label: 'Confirmar lectura',    icon: BookOpen,       color: 'text-slate-600',  bg: 'bg-slate-50',   border: 'border-slate-200' },
  descargar_constancia:{ label: 'Descargar constancia', icon: Download,       color: 'text-teal-600',   bg: 'bg-teal-50',    border: 'border-teal-200' },
  validar_efirma:      { label: 'Validar e.firma SAT',  icon: Shield,         color: 'text-indigo-600', bg: 'bg-indigo-50',  border: 'border-indigo-200' },
  obtener_nom151:      { label: 'Obtener NOM-151',      icon: Star,           color: 'text-violet-600', bg: 'bg-violet-50',  border: 'border-violet-200' },
  cerrar_expediente:   { label: 'Cerrar expediente',    icon: FolderOpen,     color: 'text-emerald-600',bg: 'bg-emerald-50', border: 'border-emerald-200' },
  retomar_borrador:   { label: 'Continuar borrador', icon: FileText, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' },
  revisar_vencimiento: { label: 'Revisar vencimiento', icon: CalendarDays, color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' },
  responder_formulario: { label: 'Responder formulario', icon: ClipboardCheck, color: 'text-indigo-600', bg: 'bg-indigo-50', border: 'border-indigo-200' },
  seguimiento_formulario: { label: 'Seguimiento de formulario', icon: ClipboardCheck, color: 'text-indigo-600', bg: 'bg-indigo-50', border: 'border-indigo-200' },
  revisar_expediente: { label: 'Revisar expediente', icon: FolderOpen, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' },
};

const PRIORITY_CONFIG: Record<Priority, { label: string; className: string; dot: string }> = {
  critica: { label: 'Crítica', className: 'text-red-700 bg-red-50 border border-red-200',         dot: 'bg-red-500' },
  alta:    { label: 'Alta',    className: 'text-orange-700 bg-orange-50 border border-orange-200', dot: 'bg-orange-500' },
  media:   { label: 'Media',   className: 'text-amber-700 bg-amber-50 border border-amber-200',    dot: 'bg-amber-400' },
  baja:    { label: 'Baja',    className: 'text-slate-600 bg-slate-50 border border-slate-200',    dot: 'bg-slate-400' },
};

const STATUS_CONFIG: Record<TaskStatus, { label: string; className: string; dot: string }> = {
  nueva:       { label: 'Nueva',       className: 'text-blue-700 bg-blue-50 border border-blue-200',       dot: 'bg-blue-500' },
  programada:  { label: 'Programada',  className: 'text-indigo-700 bg-indigo-50 border border-indigo-200', dot: 'bg-indigo-500' },
  pendiente:   { label: 'Pendiente',   className: 'text-amber-700 bg-amber-50 border border-amber-200',    dot: 'bg-amber-400' },
  en_proceso:  { label: 'En progreso', className: 'text-cyan-700 bg-cyan-50 border border-cyan-200',       dot: 'bg-cyan-500' },
  bloqueada:   { label: 'Bloqueada',   className: 'text-red-700 bg-red-50 border border-red-200',          dot: 'bg-red-500' },
  en_revision: { label: 'En revisión', className: 'text-purple-700 bg-purple-50 border border-purple-200', dot: 'bg-purple-500' },
  vencida:     { label: 'Vencida',     className: 'text-red-800 bg-red-100 border border-red-300',         dot: 'bg-red-600' },
  escalada:    { label: 'Escalada',    className: 'text-orange-800 bg-orange-100 border border-orange-300',dot: 'bg-orange-600' },
  completada:  { label: 'Completada',  className: 'text-green-700 bg-green-50 border border-green-200',    dot: 'bg-green-500' },
  cancelada:   { label: 'Cancelada',   className: 'text-slate-600 bg-slate-50 border border-slate-200',    dot: 'bg-slate-400' },
  rechazada:   { label: 'Rechazada',   className: 'text-rose-700 bg-rose-50 border border-rose-200',       dot: 'bg-rose-500' },
};

const RISK_CONFIG: Record<'alto' | 'medio' | 'bajo', { label: string; className: string }> = {
  alto:  { label: 'Alto',  className: 'text-red-600 bg-red-50 border border-red-200' },
  medio: { label: 'Medio', className: 'text-amber-600 bg-amber-50 border border-amber-200' },
  bajo:  { label: 'Bajo',  className: 'text-green-600 bg-green-50 border border-green-200' },
};

const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const DAYS_SHORT = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDate(dateStr: string) {
  if (!dateStr) return 'Sin fecha';
  return new Date(dateStr).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}
function formatTime(dateStr: string) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}
function getDueBadge(task: Task) {
  if (!task.dueDate) return { text: 'Sin fecha', urgent: false };
  if (isFinishedTask(task.status)) return { text: formatDate(task.dueDate), urgent: false };
  if (task.isOverdue || task.status === 'vencida') return { text: 'Vencida', urgent: true };
  const label = dueCalendarLabel(task.dueDate);
  if (label) return { text: label, urgent: true };
  return { text: formatDate(task.dueDate), urgent: false };
}
function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function getTaskResource(task: Task) {
  const labels: Record<string, string> = {
    document: 'Documento', participant_requirement: 'Documento',
    form_template: 'Formulario', form_token: 'Invitación de formulario',
    form_response: 'Respuesta de formulario', template: 'Plantilla',
    case_file: 'Expediente', user: 'Perfil de usuario', task: 'Tarea vinculada',
  };
  const kind = labels[task.sourceType || ''] || (task.expedienteId ? 'Expediente' : 'Recurso');
  const name = task.documentName || task.expedienteName
    || (task.sourceType === 'user' ? task.responsible : '')
    || (task.title.includes(':') ? task.title.split(':').slice(1).join(':').trim() : '')
    || kind;
  return { kind, name };
}

const ICON_MAP: Record<string, React.ElementType> = {
  Plus, Zap, Lock, AlertTriangle, AlertCircle, Bell, Users, Eye, CheckCircle2,
  UserCheck, Send, RefreshCw, FolderOpen, MessageSquare, FileText,
};

function taskGuidance(task: Task) {
  if (task.type === 'retomar_borrador') return 'Abre el borrador, complétalo y guárdalo. El sistema cerrará esta acción cuando el documento avance o deje de estar inactivo.';
  if (task.type === 'revisar_vencimiento') return 'Revisa el plazo en el documento vinculado y realiza las acciones necesarias antes de la fecha límite.';
  if (task.type === 'seguimiento_formulario') return 'Abre el lanzamiento para revisar la invitación pendiente y dar seguimiento a su destinatario.';
  if (task.type === 'revisar_expediente') return 'Abre el expediente, revisa su fecha objetivo y atiende los pendientes de cierre.';
  if (task.type === 'subir_anexo') return 'Abre el recurso vinculado y completa el anexo o requisito faltante.';
  if (task.type === 'firmar_documento') return 'Abre el documento y continúa con el proceso de firma habilitado para ti.';
  if (task.type === 'aprobar_documento') return 'Abre el recurso, revisa su contenido y registra la aprobación en el flujo correspondiente.';
  if (task.type === 'validar_identidad') return 'Abre el recurso y continúa con la verificación de identidad indicada en el proceso.';
  if (task.workKind === 'actividad') return 'Consulta el recurso, realiza el trabajo indicado y registra aquí el resultado para cerrar la actividad.';
  return 'Abre el recurso vinculado para completar la acción y registra el seguimiento en esta tarea.';
}

function mapRowToTask(row: any): Task {
  return {
    id: row.id,
    assignedTo: row.assigned_to || null,
    createdBy: row.created_by || null,
    workspaceId: row.workspace_id,
    sourceType: row.source_type || null,
    sourceId: row.source_id || null,
    automationKey: row.automation_key || null,
    origin: row.origin === 'sistema' ? 'sistema' : 'manual',
    workKind: row.work_kind === 'actividad' ? 'actividad' : 'accion',
    resolutionNote: row.resolution_note || null,
    title: row.title,
    description: row.description || '',
    type: row.tipo as TaskType,
    priority: row.prioridad as Priority,
    status: row.estado as TaskStatus,
    risk: row.riesgo as 'alto' | 'medio' | 'bajo',
    dueDate: row.due_date || '',
    scheduledFor: row.scheduled_for || '',
    createdAt: row.created_at,
    sla: row.sla || '',
    responsible: row.responsible_name || '',
    responsibleAvatar: row.responsible_avatar || String(row.responsible_name || '')
      .trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part: string) => part[0].toUpperCase()).join('') || '?',
    creator: row.creator_name || '',
    documentName: row.document_name || '',
    documentId: row.document_id || '',
    expedienteId: row.expediente_id || '',
    expedienteName: row.expediente_name || '',
    isOverdue: Boolean(row.due_date && new Date(row.due_date).getTime() < Date.now() && !['completada','cancelada','rechazada'].includes(row.estado)),
    isBlocked: row.is_blocked || false,
    isCritical: row.is_critical || false,
    tags: row.tags || [],
    checklist: (row.checklist || []) as ChecklistItem[],
    comments: (row.comments || []) as Comment[],
    activity: ((row.activity || []) as any[]).map((a: any) => ({ ...a, icon: ICON_MAP[a.icon] || Plus })),
    dependencies: (row.dependencies || []) as Dependency[],
    mainAction: row.main_action || 'Ver tarea',
  };
}

function taskAtTime(task: Task, now: number): Task {
  const status = taskStatusAtTime(task, now);
  return {
    ...task,
    status,
    isOverdue: Boolean(task.dueDate && new Date(task.dueDate).getTime() < now
      && !isFinishedTask(status)),
  };
}

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Avatar({ initials, size = 'sm' }: { initials: string; size?: 'xs' | 'sm' | 'md' }) {
  const colors = ['bg-blue-500','bg-purple-500','bg-green-500','bg-amber-500','bg-cyan-500','bg-pink-500','bg-indigo-500','bg-teal-500'];
  const idx = (initials?.charCodeAt(0) || 0) % colors.length;
  const sz = size === 'xs' ? 'w-5 h-5 text-[9px]' : size === 'sm' ? 'w-7 h-7 text-[11px]' : 'w-9 h-9 text-sm';
  return <div className={`${sz} ${colors[idx]} flex flex-shrink-0 items-center justify-center rounded-lg font-semibold text-white`}>{initials || '?'}</div>;
}

// ─── Metrics Dashboard ────────────────────────────────────────────────────────
function TaskMetrics({ tasks, now }: { tasks: Task[]; now: number }) {
  const [open, setOpen] = useState(true);
  const active = tasks.filter(t => !isFinishedTask(t.status));
  const total = active.length;
  const vencidas = active.filter(t => t.isOverdue || t.status === 'vencida').length;
  const criticas = active.filter(t => t.priority === 'critica' || t.priority === 'alta' || t.isCritical).length;
  const bloqueadas = active.filter(t => t.isBlocked || t.status === 'bloqueada').length;
  const upcoming = active.filter(t => t.dueDate && new Date(t.dueDate).getTime() >= now
    && new Date(t.dueDate).getTime() <= now + 3 * 86400000).length;

  const metrics = [
    { label: 'Tareas abiertas',   value: total,       icon: CheckSquare,   color: 'text-blue-600',   bg: 'bg-blue-50',   border: 'border-blue-100' },
    { label: 'Vencidas',          value: vencidas,    icon: AlertTriangle, color: 'text-red-600',    bg: 'bg-red-50',    border: 'border-red-100' },
    { label: 'Alta prioridad',    value: criticas,    icon: Flame,         color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-100' },
    { label: 'Bloqueadas',        value: bloqueadas,  icon: Lock,          color: 'text-rose-600',   bg: 'bg-rose-50',   border: 'border-rose-100' },
    { label: 'Próximas a vencer', value: upcoming, icon: CalendarDays, color: 'text-indigo-600', bg: 'bg-indigo-50', border: 'border-indigo-100' },
  ];

  return (
    <section className="mb-4 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls="task-summary-metrics" className={`flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-slate-50 ${open ? 'border-b border-slate-200' : ''}`}>
        <span className="flex-1"><span className="block text-sm font-semibold text-slate-950">Resumen de tareas</span><span className="mt-0.5 block text-xs text-slate-500">Actividad del espacio de trabajo actual.</span></span>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">{total} abiertas</span>
        <ChevronDown size={18} className={`text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div id="task-summary-metrics" className="grid grid-cols-2 divide-x divide-y divide-slate-200 sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0">
      {metrics.map((m) => {
        const MIcon = m.icon;
        return (
          <div key={m.label} className="flex min-h-24 items-center gap-3 px-4 py-4">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${m.bg}`}>
              <MIcon size={17} className={m.color} />
            </span>
            <span className="min-w-0">
              <span className="block text-xl font-semibold leading-none tabular-nums text-slate-950">{m.value}</span>
              <span className="mt-1 block text-xs leading-4 text-slate-500">{m.label}</span>
            </span>
          </div>
        );
      })}
      </div>}
    </section>
  );
}

// ─── Task Card ────────────────────────────────────────────────────────────────
function TaskListRow({ task, onClick }: { task: Task; onClick: () => void }) {
  const type = TASK_TYPE_CONFIG[task.type] || TASK_TYPE_CONFIG.revisar_documento;
  const Icon = type.icon;
  const resource = getTaskResource(task);
  const status = STATUS_CONFIG[visibleTaskStatus(task)] || STATUS_CONFIG.pendiente;
  const priority = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.media;
  const due = getDueBadge(task);
  return <button type="button" onClick={onClick} aria-label={`Ver tarea ${task.title}`} className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-slate-100 bg-white px-4 py-4 text-left transition-colors last:border-b-0 hover:bg-blue-50/40 focus-visible:bg-blue-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50 lg:grid-cols-[minmax(0,3fr)_minmax(0,1.7fr)_minmax(0,1.5fr)_105px_110px_20px] lg:gap-4 lg:px-5">
    <span className="flex min-w-0 items-start gap-3">
      <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${type.bg} ${type.border}`}><Icon size={18} className={type.color} /></span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold leading-5 text-slate-950 group-hover:text-blue-700">{task.title}</span>
        <span className="mt-0.5 block line-clamp-2 text-xs leading-5 text-slate-500">{task.description || taskGuidance(task)}</span>
        <span className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-500"><span className="font-medium text-slate-700">{type.label}</span><span aria-hidden="true">·</span><span className="flex items-center gap-1"><span className={`h-1.5 w-1.5 rounded-full ${priority.dot}`} />{priority.label}</span>{task.origin === 'sistema' && <><span aria-hidden="true">·</span><span>Automática</span></>}</span>
        <span className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 lg:hidden"><span>{resource.kind}: {resource.name}</span><span aria-hidden="true">·</span><span className={due.urgent ? 'font-semibold text-red-600' : ''}>{due.text}</span><span aria-hidden="true">·</span><span>{status.label}</span></span>
      </span>
    </span>
    <span className="hidden min-w-0 lg:block"><span className="block text-[11px] text-slate-500">{resource.kind}</span><span className="mt-1 block truncate text-xs font-medium text-slate-800">{resource.name}</span></span>
    <span className="hidden min-w-0 items-center gap-2 lg:flex"><Avatar initials={task.responsibleAvatar} size="sm" /><span className="truncate text-xs text-slate-700">{task.responsible || 'Sin asignar'}</span></span>
    <span className="hidden lg:inline-flex"><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${status.className}`}><span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />{status.label}</span></span>
    <span className="hidden lg:block"><span className={`block text-xs font-semibold ${task.isOverdue ? 'text-red-600' : 'text-slate-800'}`}>{task.dueDate ? formatDate(task.dueDate) : 'Sin fecha límite'}</span>{task.dueDate && !isFinishedTask(task.status) && due.text !== formatDate(task.dueDate) && <span className={`mt-1 block text-[11px] ${task.isOverdue ? 'text-red-600' : 'text-slate-500'}`}>{due.text === 'Vencida' ? 'Plazo vencido' : due.text}</span>}</span>
    <ChevronRight size={18} className="text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-blue-600" />
  </button>;
}

function TaskGridCard({ task, onClick }: { task: Task; onClick: () => void }) {
  const type = TASK_TYPE_CONFIG[task.type] || TASK_TYPE_CONFIG.revisar_documento;
  const Icon = type.icon;
  const resource = getTaskResource(task);
  const status = STATUS_CONFIG[visibleTaskStatus(task)] || STATUS_CONFIG.pendiente;
  const priority = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.media;
  const due = getDueBadge(task);
  const completed = task.checklist.filter(item => item.done).length;
  return <button type="button" onClick={onClick} aria-label={`Ver tarea ${task.title}`} className="group flex min-h-[260px] w-full flex-col rounded-xl border border-slate-200 bg-white p-4 text-left shadow-[0_1px_3px_rgba(15,23,42,0.04)] transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-[0_8px_24px_rgba(15,23,42,0.09)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
    <span className="flex w-full items-start justify-between gap-2"><span className="flex min-w-0 items-center gap-2.5"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${type.bg} ${type.border}`}><Icon size={17} className={type.color} /></span><span className="min-w-0"><span className="block truncate text-xs font-semibold text-slate-700">{type.label}</span><span className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500"><span className={`h-1.5 w-1.5 rounded-full ${priority.dot}`} />{priority.label}{task.origin === 'sistema' ? ' · Automática' : task.workKind === 'actividad' ? ' · Actividad' : ''}</span></span></span><span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium ${status.className}`}><span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />{status.label}</span></span>
    <span className="mt-4 line-clamp-2 text-base font-semibold leading-6 text-slate-950 group-hover:text-blue-700">{task.title}</span>
    <span className="mt-1.5 line-clamp-2 min-h-9 text-xs leading-[18px] text-slate-500">{task.description || taskGuidance(task)}</span>
    <span className="mt-4 flex w-full min-w-0 items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2.5"><FileText size={15} className="shrink-0 text-slate-500" /><span className="min-w-0"><span className="block text-[10px] uppercase tracking-wide text-slate-500">{resource.kind}</span><span className="block truncate text-xs font-medium text-slate-800">{resource.name}</span></span></span>
    {task.checklist.length > 0 && <span className="mt-3 flex w-full items-center gap-2 text-[11px] text-slate-500"><span>Avance {completed}/{task.checklist.length}</span><span className="h-1 flex-1 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-blue-500" style={{ width: `${Math.round(completed / task.checklist.length * 100)}%` }} /></span></span>}
    <span className="mt-auto flex w-full items-center justify-between gap-2 border-t border-slate-100 pt-3"><span className="flex min-w-0 items-center gap-2"><Avatar initials={task.responsibleAvatar} size="xs" /><span className="truncate text-[11px] text-slate-600">{task.responsible || 'Sin asignar'}</span></span><span className={`shrink-0 text-xs font-semibold ${due.urgent ? 'text-red-600' : 'text-slate-700'}`}>{!task.dueDate ? 'Sin fecha' : due.text === 'Vencida' ? 'Vencida' : /^\d+ días$/.test(due.text) ? `Vence en ${due.text}` : `${isFinishedTask(task.status) ? 'Límite' : 'Vence'} ${due.text.toLowerCase()}`}</span></span>
  </button>;
}

// ─── Full-screen task detail ─────────────────────────────────────────────────
type DrawerTab = 'info' | 'checklist' | 'comentarios' | 'historial' | 'dependencias';

function TaskDetailDrawer({ task, onClose, onTaskUpdated, onOpenTask, workspaceId, userId, userName, canReassign, canModerateComments }: {
  task: Task;
  onClose: () => void;
  onTaskUpdated: (taskId: string) => void;
  onOpenTask: (taskId: string) => boolean;
  workspaceId: string | null;
  userId: string | null;
  userName?: string;
  canReassign: boolean;
  canModerateComments: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [tab, setTab] = useState<DrawerTab>('info');

  // Checklist state
  const [checklist, setChecklist] = useState<ChecklistItem[]>(task.checklist);
  const [newCheckItem, setNewCheckItem] = useState('');
  const [addingCheck, setAddingCheck] = useState(false);

  // Comments state
  const [comments, setComments] = useState<Comment[]>(task.comments);
  const [newComment, setNewComment] = useState('');
  const [sendingComment, setSendingComment] = useState(false);

  // History state
  const [history, setHistory] = useState<ActivityEntry[]>(task.activity);

  // Dependencies state
  const [dependencies, setDependencies] = useState<Dependency[]>(task.dependencies);
  const [availableTasks, setAvailableTasks] = useState<{ id: string; title: string; status: TaskStatus }[]>([]);
  const [selectedDepTask, setSelectedDepTask] = useState('');
  const [addingDep, setAddingDep] = useState(false);

  // Edit mode
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({
    title: task.title,
    description: task.description,
    prioridad: task.priority,
    estado: task.status,
    riesgo: task.risk,
    due_date: toLocalDateTimeInput(task.dueDate),
    scheduled_for: isScheduledForLater(task.scheduledFor) ? toLocalDateTimeInput(task.scheduledFor) : '',
    sla: task.sla,
    responsible_name: task.responsible,
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [reminderRetryAt, setReminderRetryAt] = useState<string | null>(null);
  const [reminderClock, setReminderClock] = useState(() => Date.now());
  const [reminderHistoryStatus, setReminderHistoryStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reassignOpen, setReassignOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [completeOpen, setCompleteOpen] = useState(false);
  const [completionReason, setCompletionReason] = useState('');
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);
  const [newAssignee, setNewAssignee] = useState(task.assignedTo || '');
  const [sourceInfo, setSourceInfo] = useState<{ name: string; status: string } | null>(null);
  const [sourceLoading, setSourceLoading] = useState(true);
  const [canCompleteSystem, setCanCompleteSystem] = useState(false);

  const typeInfo = TASK_TYPE_CONFIG[task.type] || TASK_TYPE_CONFIG.revisar_documento;
  const priorityInfo = PRIORITY_CONFIG[task.priority];
  const statusInfo = STATUS_CONFIG[visibleTaskStatus(task)];
  const TypeIcon = typeInfo.icon;
  const doneCount = checklist.filter(c => c.done).length;
  const blockingDependencies = dependencies.filter(dependency => dependency.status !== 'completada');
  const canManageTask = Boolean(canReassign || (userId && task.createdBy === userId));
  const canActTask = Boolean(canManageTask || (userId && task.assignedTo === userId));
  const canEditStructure = canActTask && !['completada', 'cancelada', 'rechazada'].includes(task.status);
  const completionNeedsAttestation = task.origin === 'manual' && completionMode(task.type, task.sourceType) === 'attested';
  const lastReminder = history.filter(entry => entry.action === 'Recordatorio enviado')
    .reduce((latest, entry) => Math.max(latest, new Date(entry.date).getTime() || 0), 0);
  const reminderAvailableAt = Math.max(lastReminder ? lastReminder + 24 * 60 * 60 * 1000 : 0,
    reminderRetryAt ? new Date(reminderRetryAt).getTime() || 0 : 0);
  const reminderOnCooldown = reminderAvailableAt > reminderClock;

  useEffect(() => {
    const timer = window.setInterval(() => setReminderClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const ruleId = task.automationKey?.startsWith('custom:') ? task.automationKey.slice(7) : null;
    if (!ruleId) return;
    let active = true;
    supabase.from('task_custom_rules').select('target_kind,condition_kind').eq('id', ruleId)
      .eq('workspace_id', workspaceId || '').maybeSingle().then(({ data }) => {
        if (active) setCanCompleteSystem(Boolean(data && data.target_kind !== 'task' && data.condition_kind === 'created'));
      });
    return () => { active = false; };
  }, [task.automationKey, workspaceId, supabase]);

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    const loadSource = async () => {
      const sourceId = task.sourceId || task.documentId || task.expedienteId;
      if (!sourceId) return;
      if (task.sourceType === 'form_token') {
        const { data: token } = await supabase.from('form_tokens').select('template_id,used_at,expires_at').eq('id', sourceId).maybeSingle();
        if (!token) return;
        const { data: form } = await supabase.from('form_templates').select('name').eq('id', token.template_id).maybeSingle();
        if (active) setSourceInfo({ name: form?.name || 'Formulario', status: token.used_at ? 'Respondida' : token.expires_at && new Date(token.expires_at) < new Date() ? 'Vencida' : 'Invitación pendiente' });
        return;
      }
      if (task.sourceType === 'participant_requirement') {
        const { data } = await supabase.from('participant_document_requirements').select('name,status').eq('id', sourceId).maybeSingle();
        if (active && data) setSourceInfo({ name: data.name, status: data.status });
        return;
      }
      if (task.sourceType === 'form_response') {
        const { data: response } = await supabase.from('form_responses').select('folio,respondent_name,submitted_at,status,template_id').eq('id', sourceId).maybeSingle();
        if (!response) return;
        const { data: form } = await supabase.from('form_templates').select('name').eq('id', response.template_id).maybeSingle();
        const reference = response.folio || response.respondent_name || (response.submitted_at ? new Date(response.submitted_at).toLocaleDateString('es-MX') : sourceId.slice(0, 8).toUpperCase());
        if (active) setSourceInfo({ name: `${form?.name || 'Formulario'} · ${reference}`, status: response.status });
        return;
      }
      const sourceTable = task.sourceType === 'document' ? 'documentos'
        : task.sourceType === 'case_file' ? 'case_files'
        : task.sourceType === 'form_template' ? 'form_templates'
        : task.sourceType === 'template' ? 'plantillas'
        : task.sourceType === 'user' ? 'user_profiles'
        : task.sourceType === 'task' ? 'tareas' : null;
      if (!sourceTable) return;
      const nameField = sourceTable === 'case_files' || sourceTable === 'tareas' ? 'title'
        : sourceTable === 'form_templates' ? 'name' : sourceTable === 'user_profiles' ? 'full_name' : 'nombre';
      const stateField = ['case_files', 'form_templates'].includes(sourceTable) ? 'status'
        : ['documentos', 'tareas', 'plantillas'].includes(sourceTable) ? 'estado' : null;
      const { data } = await supabase.from(sourceTable).select('*').eq('id', sourceId).maybeSingle();
      if (active && data) {
        const row = data as unknown as Record<string, unknown>;
        setSourceInfo({ name: String(row[nameField] || row.email || ''), status: stateField ? String(row[stateField] || '') : 'Usuario del espacio' });
      }
    };
    void loadSource().catch(() => { /* The resource may have been removed or access revoked. */ })
      .finally(() => { if (active) setSourceLoading(false); });
    if (canReassign) {
      supabase.from('workspace_members').select('user_id,user_profiles!workspace_members_user_id_fkey(full_name,email)').eq('workspace_id', workspaceId).eq('status', 'active')
        .then(({ data }) => { if (active) setMembers((data || []).map((member: any) => {
          const profile = Array.isArray(member.user_profiles) ? member.user_profiles[0] : member.user_profiles;
          return { id: member.user_id, name: profile?.full_name || profile?.email || 'Usuario' };
        })); });
    }
    return () => { active = false; };
  }, [workspaceId, task.sourceType, task.sourceId, task.documentId, task.expedienteId, canReassign, supabase]);

  const runAction = async (action: 'open' | 'start' | 'complete' | 'cancel' | 'remind' | 'reassign') => {
    if (!workspaceId) return;
    setActionBusy(true); setActionError('');
    const session = await supabase.auth.getSession();
    const jwt = session.data.session?.access_token;
    if (!jwt) { setActionError('Tu sesión expiró.'); setActionBusy(false); return; }
    try {
    const response = await fetch(`/api/tareas/${task.id}/action`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ workspaceId, action, reason: action === 'cancel' ? cancelReason : action === 'complete' ? completionReason || undefined : undefined,
        assigneeId: action === 'reassign' ? newAssignee : undefined }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (action === 'remind' && response.status === 429 && typeof result.retryAt === 'string') {
        setReminderRetryAt(result.retryAt);
        setReminderClock(Date.now());
      } else setActionError(result.error || 'No se pudo realizar la acción.');
      setActionBusy(false);
      return;
    }
    if (action === 'open' && result.href) {
      if (result.href.startsWith('/mis-tareas?task=')) {
        const linkedId = new URL(result.href, window.location.origin).searchParams.get('task');
        if (linkedId && onOpenTask(linkedId)) { setActionBusy(false); return; }
        setActionError('La tarea vinculada no está disponible en este espacio.');
        setActionBusy(false);
        return;
      }
      router.push(result.href);
      return;
    }
    setReassignOpen(false); setCancelOpen(false); setCancelReason(''); setCompleteOpen(false); setCompletionReason('');
    if (action === 'remind') {
      setReminderRetryAt(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
      setReminderClock(Date.now());
    }
    onTaskUpdated(task.id);
    const { data: latestHistory } = await supabase.from('task_history').select('*').eq('tarea_id', task.id).order('created_at', { ascending: false });
    if (latestHistory) setHistory(latestHistory.map((entry: any) => ({ id: entry.id, action: entry.action, user: entry.actor_name,
      date: entry.created_at, icon: ICON_MAP[entry.icon_name] || Plus, color: entry.color })));
    setActionBusy(false);
    } catch {
      setActionError('No se pudo conectar con el servicio de tareas. Inténtalo de nuevo.');
      setActionBusy(false);
    }
  };

  // Load relational data from dedicated tables
  useEffect(() => {
    if (!task.id || !workspaceId) return;

    // Load checklist from dedicated table
    supabase.from('task_checklist_items').select('*').eq('tarea_id', task.id).order('position', { ascending: true })
      .then(({ data }) => { if (data) setChecklist(data.map((r: any) => ({ id: r.id, text: r.text, done: r.done, position: r.position }))); });

    // Load comments from dedicated table
    supabase.from('task_comments').select('*').eq('tarea_id', task.id).order('created_at', { ascending: true })
      .then(({ data }) => { if (data) setComments(data.map((r: any) => ({ id: r.id, authorId: r.author_id, author: r.author_name, avatar: r.author_avatar, text: r.text, date: r.created_at }))); });

    // Load history from dedicated table
    supabase.from('task_history').select('*').eq('tarea_id', task.id).order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error || !data) { setReminderHistoryStatus('error'); return; }
        setHistory(data.map((r: any) => ({ id: r.id, action: r.action, user: r.actor_name, date: r.created_at, icon: ICON_MAP[r.icon_name] || Plus, color: r.color })));
        setReminderHistoryStatus('ready');
      }, () => setReminderHistoryStatus('error'));

    // Load dependencies
    supabase.from('task_dependencies').select('depends_on_id, tareas!task_dependencies_depends_on_id_fkey(id, title, estado)').eq('tarea_id', task.id)
      .then(({ data }) => {
        if (data) {
          setDependencies(data.map((r: any) => ({
            id: r.depends_on_id,
            taskId: r.depends_on_id.slice(0, 8).toUpperCase(),
            title: r.tareas?.title || 'Tarea',
            status: (r.tareas?.estado || 'pendiente') as TaskStatus,
          })));
        }
      });

    // Load available tasks for dependency selection
    fetchAllPages((from, to) => supabase.from('tareas').select('id, title, estado')
      .eq('workspace_id', workspaceId).neq('id', task.id)
      .not('source_id', 'is', null)
      .not('estado', 'in', '(completada,cancelada,rechazada)')
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(from, to))
      .then(data => setAvailableTasks(data.map((r: any) => ({ id: r.id, title: r.title, status: r.estado as TaskStatus }))))
      .catch(loadError => setActionError(loadError instanceof Error ? loadError.message : 'No se pudieron cargar las dependencias.'));
  }, [task.id, workspaceId, supabase]);

  const handleClose = () => {
    onClose();
  };

  const refreshHistory = async () => {
    setReminderHistoryStatus('loading');
    try {
      const { data, error } = await supabase.from('task_history').select('*').eq('tarea_id', task.id).order('created_at', { ascending: false });
      if (error || !data) { setReminderHistoryStatus('error'); return; }
      setHistory(data.map((entry: any) => ({ id: entry.id, action: entry.action, user: entry.actor_name,
        date: entry.created_at, icon: ICON_MAP[entry.icon_name] || Plus, color: entry.color })));
      setReminderHistoryStatus('ready');
    } catch { setReminderHistoryStatus('error'); }
  };

  // ── Checklist operations ──
  const handleChecklistToggle = async (itemId: string) => {
    if (!canEditStructure) return;
    const item = checklist.find(c => c.id === itemId);
    if (!item) return;
    const newDone = !item.done;
    const { error } = await supabase.from('task_checklist_items').update({ done: newDone }).eq('id', itemId);
    if (error) { setActionError(error.message); return; }
    setChecklist(prev => prev.map(c => c.id === itemId ? { ...c, done: newDone } : c));
    setActionError('');
    await refreshHistory();
    onTaskUpdated(task.id);
  };

  const handleAddCheckItem = async () => {
    if (!canEditStructure || !newCheckItem.trim() || !workspaceId) return;
    setAddingCheck(true);
    const newItem = { id: crypto.randomUUID(), text: newCheckItem.trim(), done: false, position: checklist.length };
    const { error } = await supabase.from('task_checklist_items').insert({
      id: newItem.id, tarea_id: task.id, workspace_id: workspaceId,
      text: newItem.text, done: false, position: newItem.position, created_by: userId,
    });
    if (error) setActionError(error.message);
    else { setChecklist(prev => [...prev, newItem]); setNewCheckItem(''); setActionError(''); await refreshHistory(); onTaskUpdated(task.id); }
    setAddingCheck(false);
  };

  const handleDeleteCheckItem = async (itemId: string) => {
    if (!canEditStructure) return;
    const { error } = await supabase.from('task_checklist_items').delete().eq('id', itemId);
    if (error) setActionError(error.message);
    else { setChecklist(prev => prev.filter(c => c.id !== itemId)); setActionError(''); await refreshHistory(); onTaskUpdated(task.id); }
  };

  // ── Comment operations ──
  const handleSendComment = async () => {
    if (!newComment.trim() || !workspaceId || !userId) return;
    setSendingComment(true);
    const avatar = (userName || 'YO').slice(0, 2).toUpperCase();
    const newC: Comment = { id: crypto.randomUUID(), authorId: userId, author: userName || 'Yo', avatar, text: newComment.trim(), date: new Date().toISOString() };
    const { error } = await supabase.from('task_comments').insert({
      id: newC.id, tarea_id: task.id, workspace_id: workspaceId,
      author_id: userId, author_name: newC.author, author_avatar: avatar, text: newC.text,
    });
    if (error) setActionError(error.message);
    else { setComments(prev => [...prev, newC]); setNewComment(''); setActionError(''); await refreshHistory(); }
    setSendingComment(false);
  };

  const handleDeleteComment = async (commentId: string) => {
    const { error } = await supabase.from('task_comments').delete().eq('id', commentId);
    if (error) setActionError(error.message);
    else { setComments(prev => prev.filter(c => c.id !== commentId)); setActionError(''); await refreshHistory(); }
  };

  // ── Dependency operations ──
  const handleAddDependency = async () => {
    if (!canEditStructure || !selectedDepTask || !workspaceId) return;
    const depTask = availableTasks.find(t => t.id === selectedDepTask);
    if (!depTask) return;
    setAddingDep(true);

    const newDep: Dependency = { id: selectedDepTask, taskId: selectedDepTask.slice(0, 8).toUpperCase(), title: depTask.title, status: depTask.status };
    const { error } = await supabase.from('task_dependencies').insert({
      tarea_id: task.id, depends_on_id: selectedDepTask, workspace_id: workspaceId,
    });
    if (error) setActionError(error.message);
    else { setDependencies(prev => [...prev, newDep]); setSelectedDepTask(''); setActionError(''); await refreshHistory(); }
    setAddingDep(false);
  };

  const handleRemoveDependency = async (depId: string) => {
    if (!canEditStructure) return;
    const { error } = await supabase.from('task_dependencies').delete().eq('tarea_id', task.id).eq('depends_on_id', depId);
    if (error) setActionError(error.message);
    else { setDependencies(prev => prev.filter(d => d.id !== depId)); setActionError(''); await refreshHistory(); }
  };

  // ── Edit task ──
  const handleSaveEdit = async () => {
    setSavingEdit(true);
    setActionError('');
    const session = await supabase.auth.getSession();
    const jwt = session.data.session?.access_token;
    if (!jwt || !workspaceId) { setActionError('Tu sesión expiró.'); setSavingEdit(false); return; }
    try {
    const response = await fetch(`/api/tareas/${task.id}/action`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ workspaceId, action: 'edit', title: editForm.title,
        description: editForm.description, priority: editForm.prioridad,
        dueDate: editForm.due_date ? new Date(editForm.due_date).toISOString() : null,
        scheduledFor: editForm.scheduled_for ? new Date(editForm.scheduled_for).toISOString() : null }) });
    const result = await response.json().catch(() => ({}));
    if (response.ok) {
      onTaskUpdated(task.id);
      setEditMode(false);
    } else setActionError(result.error || 'No se pudo guardar la actividad.');
    } catch {
      setActionError('No se pudo conectar con el servicio de tareas. Inténtalo de nuevo.');
    } finally { setSavingEdit(false); }
  };

  const tabs: { id: DrawerTab; label: string; icon: React.ElementType; count?: number }[] = [
    { id: 'info',         label: 'General',     icon: FileText },
    { id: 'checklist',    label: 'Checklist',   icon: CheckSquare, count: checklist.length },
    { id: 'comentarios',  label: 'Comentarios', icon: MessageSquare, count: comments.length },
    { id: 'historial',    label: 'Historial',   icon: History },
    { id: 'dependencias', label: 'Dependencias',icon: Link2, count: dependencies.length },
  ];

  return (
    <div role="dialog" aria-modal="true" aria-label={`Detalle de ${task.title}`} className="fixed inset-0 z-[70] overflow-hidden bg-white">
      <div className="flex h-full w-full flex-col overflow-hidden bg-white">
        <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-2.5 sm:px-6 lg:px-8">
          <AppLogo size={34} imageClassName="max-sm:w-24" />
          <button type="button" onClick={handleClose} className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 text-sm font-medium text-slate-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600 sm:px-3">
            <X size={16} /><span className="hidden sm:inline">Cerrar</span>
          </button>
        </header>

        <section className="shrink-0 border-b border-slate-200 bg-[#edf3f8] px-4 py-3 sm:px-6 lg:px-8">
          <div className="mx-auto flex w-full max-w-[1480px] items-start gap-3">
            <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${typeInfo.bg} ${typeInfo.border}`}><TypeIcon size={18} className={typeInfo.color} /></span>
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-slate-500">{task.id.slice(0, 8).toUpperCase()}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusInfo.className}`}>{statusInfo.label}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${priorityInfo.className}`}>{priorityInfo.label}</span>
              </div>
              <h1 className="break-words text-[20px] font-normal leading-snug text-slate-950">{task.title}</h1>
            </div>
            {canManageTask && task.origin === 'manual' && !['completada','cancelada','rechazada'].includes(task.status) && <button type="button"
              onClick={() => setEditMode(value => !value)} aria-label={editMode ? 'Cancelar edición' : 'Editar tarea'} title={editMode ? 'Cancelar edición' : 'Editar tarea'}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors ${editMode ? 'border-primary bg-primary text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-primary hover:text-primary'}`}
            ><Edit2 size={16} /></button>}
          </div>
        </section>

        <nav aria-label="Secciones de la tarea" className="shrink-0 overflow-x-auto border-b border-slate-200 bg-white px-4 sm:px-6 lg:px-8">
          <div className="mx-auto flex w-full max-w-[1480px] gap-0">
          {tabs.map(t => {
            const TIcon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? 'page' : undefined}
                className={`flex min-h-12 items-center gap-2 border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors sm:px-4 ${
                  tab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <TIcon size={16} />
                {t.label}
                {t.count !== undefined && t.count > 0 && (
                  <span className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${tab === t.id ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
          </div>
        </nav>

        {/* Content */}
        <main className="flex-1 overflow-y-auto bg-white px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1480px] pb-12">
          <div className="w-full max-w-[1080px] space-y-8">
          {actionError && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{actionError}</p>}

          {/* ── Info / Edit ── */}
          {tab === 'info' && (
            <div className="space-y-8">
              {editMode ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-foreground mb-1.5">Título</label>
                    <input value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-foreground mb-1.5">Descripción</label>
                    <textarea value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} rows={3} className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1.5">Prioridad</label>
                      <select value={editForm.prioridad} onChange={e => setEditForm(f => ({ ...f, prioridad: e.target.value as Priority }))} className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary/30">
                        {Object.entries(PRIORITY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-foreground mb-1.5">Fecha límite</label>
                    <input type="datetime-local" value={editForm.due_date} onChange={e => setEditForm(f => ({ ...f, due_date: e.target.value }))} className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-foreground mb-1.5">Inicio programado (opcional)</label>
                    <input type="datetime-local" value={editForm.scheduled_for} onChange={e => setEditForm(f => ({ ...f, scheduled_for: e.target.value }))} className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30" />
                    <p className="mt-1 text-xs text-slate-500">Déjalo vacío para que la tarea esté disponible ahora.</p>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button onClick={() => setEditMode(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-border text-foreground hover:bg-muted transition-colors">Cancelar</button>
                    <button onClick={handleSaveEdit} disabled={savingEdit} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                      {savingEdit ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Save size={14} />}
                      Guardar cambios
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <section aria-labelledby="task-detail-heading" className="space-y-8">
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">{task.workKind === 'accion' ? 'Acción del proceso' : 'Actividad'} · {task.origin === 'sistema' ? 'Generada por el sistema' : 'Creada manualmente'}</p>
                      <p className="text-sm leading-6 text-slate-600">{canCompleteSystem ? 'Esta acción surgió al crearse el recurso. Puedes completarla después de atenderla.' : task.origin === 'sistema' ? 'Esta acción se cerrará automáticamente cuando se resuelva la condición del recurso vinculado.' : task.workKind === 'accion' ? 'Abre el recurso vinculado para realizar la acción y registra aquí el seguimiento.' : 'Puedes registrar avances y completar esta actividad desde aquí.'}</p>
                    </div>
                    <div className="grid gap-x-12 gap-y-7 lg:grid-cols-2">
                      <div className="min-w-0 space-y-2">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Descripción</h3>
                        <p className="break-words text-sm leading-6 text-slate-800">{task.description || 'Sin descripción.'}</p>
                      </div>
                      <div className="min-w-0 space-y-2">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Qué sigue</h3>
                        <p className="break-words text-sm leading-6 text-slate-800">{taskGuidance(task)}</p>
                      </div>
                    </div>
                    <div className="space-y-5">
                    <h3 id="task-detail-heading" className="text-base font-semibold text-slate-900">Información de la tarea</h3>
                    <dl className="grid gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
                      {[
                        { label: 'Tipo de trabajo', value: task.workKind === 'accion' ? 'Acción del proceso' : 'Actividad' },
                        { label: 'Tipo de tarea', value: typeInfo.label },
                        { label: 'Estado', value: statusInfo.label },
                        { label: 'Prioridad', value: priorityInfo.label },
                        { label: 'Riesgo', value: RISK_CONFIG[task.risk].label },
                        { label: 'Creada el', value: task.createdAt ? `${formatDate(task.createdAt)} · ${formatTime(task.createdAt)}` : '—' },
                        ...(task.scheduledFor ? [{ label: 'Inicio programado', value: `${formatDate(task.scheduledFor)} · ${formatTime(task.scheduledFor)}` }] : []),
                        { label: 'Fecha límite', value: formatDate(task.dueDate) },
                        { label: 'Responsable', value: task.responsible || '—' },
                        { label: 'Creador', value: task.creator || '—' },
                        { label: 'Recurso vinculado', value: sourceInfo?.name || task.documentName || task.expedienteName || '—' },
                        { label: 'Estado del recurso', value: sourceLoading ? 'Consultando estado…' : resourceStatusLabel(sourceInfo?.status) || 'Estado no disponible' },
                      ].filter(item => Boolean(item.value)).map(item => (
                        <div key={item.label} className="min-w-0 space-y-1">
                          <dt className="text-xs font-medium text-slate-500">{item.label}</dt>
                          <dd className="break-words text-sm font-medium leading-6 text-slate-900">{item.value}</dd>
                        </div>
                      ))}
                    </dl>
                    </div>
                  </section>
                  {task.tags.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Etiquetas</p>
                      <div className="flex flex-wrap gap-1.5">
                        {task.tags.map(tag => (
                          <span key={tag} className="text-[11px] font-semibold text-primary bg-primary/5 border border-primary/15 px-2.5 py-1 rounded-full">{tag}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {task.resolutionNote && <div className="space-y-2"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Motivo de cierre</p><p className="text-sm leading-6 text-slate-800">{task.resolutionNote}</p></div>}
                  {canActTask ? <div className="space-y-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Acciones</p>
                    {task.status === 'programada' && <p className="text-sm text-indigo-700">Podrás iniciar, recordar o completar esta tarea a partir del {formatDate(task.scheduledFor)} a las {formatTime(task.scheduledFor)}.</p>}
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => runAction('open')} disabled={actionBusy} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50">
                        <Play size={16} />{task.type === 'retomar_borrador' ? 'Continuar borrador' : 'Abrir recurso vinculado'}
                      </button>
                      {!['completada','cancelada','rechazada'].includes(task.status) && <>
                        {task.status !== 'programada' && task.type !== 'retomar_borrador' && ['pendiente','nueva'].includes(task.status) && <button onClick={() => runAction('start')} disabled={actionBusy} className="inline-flex h-10 items-center rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">Marcar en proceso</button>}
                        {task.status !== 'programada' && (task.origin === 'manual' || canCompleteSystem) && <button onClick={() => setCompleteOpen(value => !value)} disabled={actionBusy} className="inline-flex h-10 items-center gap-2 rounded-lg border border-green-200 px-4 text-sm font-medium text-green-700 hover:bg-green-50 disabled:opacity-50"><CheckCircle2 size={16} />Completar</button>}
                        {canReassign && task.sourceType !== 'user' && <button onClick={() => setReassignOpen(value => !value)} disabled={actionBusy} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Users size={16} />Reasignar</button>}
                        {task.status !== 'programada' && <button onClick={() => runAction('remind')} disabled={actionBusy || reminderOnCooldown || !task.assignedTo || reminderHistoryStatus !== 'ready'} aria-describedby="task-reminder-help" className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"><Bell size={16} />Recordatorio</button>}
                        {canManageTask && <button onClick={() => setCancelOpen(value => !value)} disabled={actionBusy} className="inline-flex h-10 items-center gap-2 rounded-lg border border-red-200 px-4 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"><XCircle size={16} />Cancelar</button>}
                      </>}
                    </div>
                    {task.status !== 'programada' && !['completada','cancelada','rechazada'].includes(task.status) && <p id="task-reminder-help" className="text-xs leading-5 text-slate-500">
                      {!task.assignedTo ? 'Asigna una persona para enviarle un recordatorio.' : reminderOnCooldown
                        ? `Ya se envió un recordatorio. Podrás enviar otro el ${formatDate(new Date(reminderAvailableAt).toISOString())} a las ${formatTime(new Date(reminderAvailableAt).toISOString())}`
                        : reminderHistoryStatus === 'loading' ? 'Comprobando cuándo se envió el último recordatorio…'
                        : reminderHistoryStatus === 'error' ? <span>No se pudo comprobar el último recordatorio. <button type="button" onClick={() => void refreshHistory()} className="font-medium text-primary hover:underline">Reintentar</button></span>
                        : 'Envía una notificación al responsable de la tarea. Se permite una cada 24 horas.'}
                    </p>}
                    {completeOpen && <div className="mt-6 max-w-2xl space-y-2">
                      <p className="text-sm font-semibold text-slate-900">Confirmar el resultado</p>
                      <p className="mt-1 text-sm leading-6 text-slate-600">{completionNeedsAttestation
                        ? 'Describe qué hiciste y cuál fue el resultado. Esta constancia quedará guardada en el historial de la tarea.'
                        : 'Comprobaremos el resultado en el recurso vinculado antes de cerrar. Puedes agregar una nota para el historial.'}</p>
                      {checklist.length > doneCount && <p className="mt-2 text-sm text-amber-700">Primero completa los {checklist.length - doneCount} elementos pendientes del checklist.</p>}
                      {blockingDependencies.length > 0 && <p className="mt-2 text-sm text-amber-700">Completa primero {blockingDependencies.length === 1 ? 'la tarea vinculada pendiente' : `las ${blockingDependencies.length} tareas vinculadas pendientes`} en Dependencias.</p>}
                      <label className="mt-3 block text-sm font-medium text-slate-700">Nota de cierre{completionNeedsAttestation ? ' *' : ''}
                        <textarea value={completionReason} onChange={event => setCompletionReason(event.target.value)} maxLength={1000} rows={3}
                          placeholder={completionNeedsAttestation ? 'Ej. Revisé el documento y confirmé los datos solicitados…' : 'Información adicional sobre el resultado'}
                          className="mt-1 w-full rounded-md border border-slate-200 bg-white p-3 text-sm font-normal" />
                      </label>
                      <button onClick={() => runAction('complete')} disabled={actionBusy || checklist.length > doneCount || blockingDependencies.length > 0 || (completionNeedsAttestation && completionReason.trim().length < 15)}
                        className="mt-3 inline-flex h-10 items-center gap-2 rounded-md bg-green-700 px-4 text-sm font-semibold text-white disabled:opacity-50"><CheckCircle2 size={16} />Confirmar cierre</button>
                    </div>}
                    {reassignOpen && <div className="mt-3 flex max-w-lg gap-2"><select aria-label="Nuevo responsable" value={newAssignee} onChange={event => setNewAssignee(event.target.value)} className="h-10 flex-1 rounded-md border border-slate-200 bg-white px-3 text-sm"><option value="">Selecciona un integrante</option>{members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select><button onClick={() => runAction('reassign')} disabled={!newAssignee || actionBusy} className="rounded-md bg-blue-600 px-4 text-sm text-white disabled:opacity-50">Guardar</button></div>}
                    {cancelOpen && <div className="mt-3 flex max-w-lg flex-col gap-2"><label className="text-sm text-slate-700">Motivo de cancelación<input value={cancelReason} onChange={event => setCancelReason(event.target.value)} minLength={5} maxLength={1000} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3" placeholder="Explica por qué ya no se necesita" /></label><button onClick={() => runAction('cancel')} disabled={cancelReason.trim().length < 5 || actionBusy} className="self-start rounded-md bg-red-600 px-4 py-2 text-sm text-white disabled:opacity-50">Confirmar cancelación</button></div>}
                  </div> : <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">Esta tarea está asignada a otra persona. Puedes consultar su avance aquí.</p>}
                </>
              )}
            </div>
          )}

          {/* ── Checklist ── */}
          {tab === 'checklist' && (
            <section aria-label="Checklist de la tarea" className="space-y-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div><h2 className="text-base font-semibold text-slate-900">Checklist</h2><p className="mt-1 text-sm text-slate-500">Elementos necesarios para completar esta tarea.</p></div>
                <span className="shrink-0 text-sm font-medium text-primary">{doneCount}/{checklist.length} completados</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden mb-4">
                <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${checklist.length > 0 ? (doneCount/checklist.length)*100 : 0}%` }} />
              </div>

              {/* Add new item */}
              {canEditStructure && <div className="mb-4 flex gap-2">
                <input
                  aria-label="Nuevo elemento del checklist"
                  value={newCheckItem}
                  onChange={e => setNewCheckItem(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddCheckItem()}
                  placeholder="Agregar elemento al checklist..."
                  className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <button
                  onClick={handleAddCheckItem}
                  disabled={addingCheck || !newCheckItem.trim()}
                  className="flex h-10 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {addingCheck ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Plus size={13} />}
                  Agregar
                </button>
              </div>}

              {checklist.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckSquare size={28} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Sin elementos en el checklist</p>
                </div>
              )}
              {checklist.map(item => (
                <div key={item.id} className="group flex min-h-14 items-center gap-3 border-b border-slate-100 py-3">
                  <button type="button" disabled={!canEditStructure} aria-label={`${item.done ? 'Marcar pendiente' : 'Completar'} ${item.text}`} aria-pressed={item.done}
                    onClick={() => handleChecklistToggle(item.id)}
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors disabled:cursor-default ${item.done ? 'bg-primary border-primary' : 'border-slate-300 hover:border-primary/50'}`}
                  >
                    {item.done && <CheckCircle2 size={12} className="text-white" />}
                  </button>
                  <span
                    className={`flex-1 text-sm transition-colors ${item.done ? 'line-through text-muted-foreground' : 'text-foreground'}`}
                  >
                    {item.text}
                  </span>
                  {canEditStructure && <button type="button" aria-label={`Eliminar ${item.text}`}
                    onClick={() => handleDeleteCheckItem(item.id)}
                    className="rounded p-2 text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:bg-red-50 focus-visible:text-red-600"
                  >
                    <Trash2 size={16} />
                  </button>}
                </div>
              ))}
            </section>
          )}

          {/* ── Comentarios ── */}
          {tab === 'comentarios' && (
            <section aria-label="Comentarios de la tarea" className="space-y-5">
              <div><h2 className="text-base font-semibold text-slate-900">Comentarios</h2><p className="mt-1 text-sm text-slate-500">Registra avances o contexto para quienes participan en esta tarea.</p></div>
              {comments.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <MessageSquare size={28} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Sin comentarios aún</p>
                </div>
              )}
              {comments.map(c => (
                <div key={c.id} className="flex gap-3 group">
                  <Avatar initials={c.avatar} size="sm" />
                  <div className="min-w-0 flex-1 rounded-lg bg-slate-50 p-4">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-slate-900">{c.author}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500">{formatDate(c.date)} {formatTime(c.date)}</span>
                        {(c.authorId === userId || canModerateComments) && <button type="button" onClick={() => handleDeleteComment(c.id)} aria-label={`Eliminar comentario de ${c.author}`} className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600 focus-visible:bg-red-50 focus-visible:text-red-600">
                          <Trash2 size={15} />
                        </button>}
                      </div>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{c.text}</p>
                  </div>
                </div>
              ))}
              <div className="mt-4 flex gap-3 border-t border-slate-200 pt-4">
                <Avatar initials={(userName || 'YO').slice(0, 2).toUpperCase()} size="sm" />
                <div className="flex min-w-0 flex-1 flex-col items-end gap-2">
                  <textarea
                    aria-label="Escribir comentario"
                    value={newComment}
                    onChange={e => setNewComment(e.target.value)}
                    onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void handleSendComment(); } }}
                    placeholder="Escribe un comentario o actualización..."
                    rows={3} maxLength={2000}
                    className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <button type="button"
                    onClick={handleSendComment}
                    disabled={sendingComment || !newComment.trim()}
                    className="flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    {sendingComment ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <Send size={16} />}
                    Enviar comentario
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* ── Historial ── */}
          {tab === 'historial' && (
            <section aria-label="Historial de la tarea" className="space-y-3">
              <div><h2 className="text-base font-semibold text-slate-900">Historial</h2><p className="mt-1 text-sm text-slate-500">Cambios y resultados registrados para esta tarea.</p></div>
              {history.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <History size={28} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Sin historial</p>
                </div>
              )}
              {history.map((a, i) => {
                const AIcon = a.icon;
                return (
                  <div key={a.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                        <AIcon size={12} className={a.color} />
                      </div>
                      {i < history.length - 1 && <div className="w-px flex-1 bg-border mt-1" />}
                    </div>
                    <div className="pb-4 flex-1">
                      <p className="text-sm leading-6 text-slate-800">{a.action}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{a.user} · {formatDate(a.date)} {formatTime(a.date)}</p>
                    </div>
                  </div>
                );
              })}
            </section>
          )}

          {/* ── Dependencias ── */}
          {tab === 'dependencias' && (
            <section aria-label="Dependencias de la tarea" className="space-y-4">
              <div><h2 className="text-base font-semibold text-slate-900">Dependencias</h2><p className="mt-1 text-sm text-slate-500">Completa las tareas vinculadas antes de cerrar esta tarea.</p></div>
              {/* Add dependency */}
              {canEditStructure && <div className="mb-4 flex gap-2">
                <select
                  aria-label="Tarea de la que depende"
                  value={selectedDepTask}
                  onChange={e => setSelectedDepTask(e.target.value)}
                  className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="">— Selecciona la tarea que debe completarse antes —</option>
                  {availableTasks
                    .filter(t => !dependencies.some(d => d.id === t.id))
                    .map(t => (
                      <option key={t.id} value={t.id}>{t.title}</option>
                    ))}
                </select>
                <button
                  onClick={handleAddDependency}
                  disabled={addingDep || !selectedDepTask}
                  className="flex h-10 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {addingDep ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Plus size={13} />}
                  Agregar
                </button>
              </div>}

              {dependencies.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Link2 size={28} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Sin dependencias</p>
                </div>
              ) : (
                dependencies.map(d => {
                  const s = STATUS_CONFIG[d.status] || STATUS_CONFIG['pendiente'];
                  return (
                    <div key={d.id} className="flex min-h-16 items-center gap-3 border-b border-slate-100 py-3">
                      <Link2 size={16} className="shrink-0 text-slate-500" />
                      <div className="flex-1 min-w-0">
                        <p className="break-words text-sm font-medium text-slate-900">{d.title}</p>
                        <p className="mt-0.5 font-mono text-xs text-slate-500">{d.taskId}</p>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${s.className}`}>{s.label}</span>
                      <button type="button" onClick={() => { if (!onOpenTask(d.id)) setActionError('La tarea vinculada no está disponible en este espacio.'); }} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-primary hover:bg-blue-50">Ver tarea</button>
                      {canEditStructure && <button type="button" onClick={() => handleRemoveDependency(d.id)} aria-label={`Quitar dependencia ${d.title}`} className="rounded p-2 text-slate-500 hover:bg-red-50 hover:text-red-600 focus-visible:bg-red-50 focus-visible:text-red-600">
                        <X size={16} />
                      </button>}
                    </div>
                  );
                })
              )}
            </section>
          )}
          </div>
          </div>
        </main>
      </div>
    </div>
  );
}

// ─── Kanban View ──────────────────────────────────────────────────────────────
function KanbanView({ tasks, onTaskClick }: { tasks: Task[]; onTaskClick: (t: Task) => void }) {
  const columns: { id: TaskStatus; label: string; color: string; bg: string }[] = [
    { id: 'nueva',       label: 'Nueva',       color: 'border-t-blue-500',   bg: 'bg-blue-50/40' },
    { id: 'programada',  label: 'Programada',  color: 'border-t-indigo-500', bg: 'bg-indigo-50/30' },
    { id: 'pendiente',   label: 'Pendiente',   color: 'border-t-amber-400',  bg: 'bg-amber-50/30' },
    { id: 'en_proceso',  label: 'En progreso', color: 'border-t-cyan-500',   bg: 'bg-cyan-50/30' },
    { id: 'bloqueada',   label: 'Bloqueada',   color: 'border-t-red-500',    bg: 'bg-red-50/20' },
    { id: 'en_revision', label: 'En revisión', color: 'border-t-purple-500', bg: 'bg-purple-50/20' },
    { id: 'escalada',    label: 'Escalada',    color: 'border-t-orange-500', bg: 'bg-orange-50/20' },
    { id: 'vencida',     label: 'Vencida',     color: 'border-t-red-600',    bg: 'bg-red-50/20' },
    { id: 'completada',  label: 'Completada',  color: 'border-t-green-500',  bg: 'bg-green-50/20' },
    { id: 'cancelada',   label: 'Cancelada',   color: 'border-t-slate-400',  bg: 'bg-slate-50/20' },
    { id: 'rechazada',   label: 'Rechazada',   color: 'border-t-rose-500',   bg: 'bg-rose-50/20' },
  ];
  const visibleColumns = columns.filter(col => tasks.some(task => visibleTaskStatus(task) === col.id));

  return (
    visibleColumns.length === 0 ? (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white px-5 py-12 text-center text-sm text-slate-500">Sin tareas para este tablero. Ajusta los filtros para ver otras etapas.</div>
    ) : <div className="flex gap-3 overflow-x-auto pb-3">
      {visibleColumns.map(col => {
        const colTasks = tasks.filter(t => visibleTaskStatus(t) === col.id);
        return (
          <div key={col.id} className={`flex min-h-[240px] w-72 flex-shrink-0 flex-col rounded-lg border border-slate-200/90 border-t-4 bg-white ${col.color} shadow-[0_1px_2px_rgba(15,23,42,0.03)]`}>
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm font-600 text-slate-900">{col.label}</span>
              <span className="flex h-6 w-6 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-xs font-600 text-slate-500">{colTasks.length}</span>
            </div>
            <div className="mx-3 mb-2 border-t border-dashed border-slate-200" />
            <div className="flex-1 px-3 pb-3 space-y-2 overflow-y-auto">
              {colTasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-muted-foreground/40">
                  <Inbox size={24} className="mb-1" /><span className="text-xs">Sin tareas</span>
                </div>
              ) : colTasks.map(task => {
                const typeInfo = TASK_TYPE_CONFIG[task.type] || TASK_TYPE_CONFIG.revisar_documento;
                const TypeIcon = typeInfo.icon;
                const dueInfo = getDueBadge(task);
                return (
                  <button key={task.id} type="button" onClick={() => onTaskClick(task)} className="w-full rounded-md border border-slate-200 bg-white p-3 text-left transition-colors hover:border-primary/30 hover:bg-primary/[0.03]">
                    <div className="flex items-start gap-2 mb-2">
                      <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${typeInfo.bg}`}>
                        <TypeIcon size={11} className={typeInfo.color} />
                      </div>
                      <p className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">{task.title}</p>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <Avatar initials={task.responsibleAvatar} size="xs" />
                        <span className="max-w-[100px] truncate text-xs text-muted-foreground">{task.responsible.split(' ')[0]}</span>
                      </div>
                      <span className={`text-xs font-semibold ${dueInfo.urgent ? 'text-red-600' : 'text-muted-foreground'}`}>{dueInfo.text}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Calendar View ────────────────────────────────────────────────────────────
function CalendarView({ tasks, onTaskClick }: { tasks: Task[]; onTaskClick: (t: Task) => void }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth());
  const [today] = useState(() => new Date());

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
  const cells: { date: Date; current: boolean }[] = [];
  for (let i = startOffset - 1; i >= 0; i--) cells.push({ date: new Date(year, month, -i), current: false });
  for (let d = 1; d <= lastDay.getDate(); d++) cells.push({ date: new Date(year, month, d), current: true });
  while (cells.length < 42) cells.push({ date: new Date(year, month + 1, cells.length - lastDay.getDate() - startOffset + 1), current: false });
  const rows: typeof cells[] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  const prev = () => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const next = () => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); };

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <h3 className="text-sm font-600 text-slate-900">{MONTHS_ES[month]} {year}</h3>
        <div className="flex items-center gap-2"><span className="hidden text-xs text-slate-500 sm:inline">Inicio programado · Fecha límite</span>
          <button onClick={prev} aria-label="Mes anterior" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><ChevronLeft size={15} /></button>
          <button onClick={next} aria-label="Mes siguiente" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><ChevronRight size={15} /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50/70">
        {DAYS_SHORT.map(d => <div key={d} className="py-2 text-center text-[11px] font-600 text-slate-500">{d}</div>)}
      </div>
      {rows.map((row, ri) => (
        <div key={ri} className="grid grid-cols-7 border-b border-slate-100 last:border-b-0">
          {row.map((cell, ci) => {
            const isToday = isSameDay(cell.date, today);
            const dayTasks = tasks.flatMap(task => {
              const starts = Boolean(task.scheduledFor && isSameDay(new Date(task.scheduledFor), cell.date));
              const due = Boolean(task.dueDate && isSameDay(new Date(task.dueDate), cell.date));
              return starts || due ? [{ task, label: starts && due ? 'Inicio y límite' : starts ? 'Inicio' : 'Límite' }] : [];
            });
            return (
              <div key={ci} className={`min-h-[80px] border-r border-slate-100 p-1.5 last:border-r-0 ${!cell.current ? 'bg-slate-50/70' : ''} ${isToday ? 'bg-primary/5' : ''}`}>
                <div className="flex justify-start mb-1">
                  {isToday
                    ? <span className="w-6 h-6 rounded-full bg-primary text-white text-[11px] font-semibold flex items-center justify-center">{cell.date.getDate()}</span>
                    : <span className={`text-[11px] font-medium ${cell.current ? 'text-foreground' : 'text-muted-foreground/50'}`}>{cell.date.getDate()}</span>
                  }
                </div>
                <div className="max-h-28 space-y-1 overflow-y-auto">
                  {dayTasks.map(({ task, label }) => {
                    const tc = TASK_TYPE_CONFIG[task.type] || TASK_TYPE_CONFIG.revisar_documento;
                    return <button key={task.id} onClick={() => onTaskClick(task)} title={`${label}: ${task.title}`} aria-label={`${label}: ${task.title}`} className={`block w-full truncate rounded px-1.5 py-1 text-left text-[11px] font-medium ${tc.bg} ${tc.color}`}><span className="font-semibold">{label} · </span>{task.title}</button>;
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─── Documento View ───────────────────────────────────────────────────────────
function DocumentoView({ tasks, onTaskClick }: { tasks: Task[]; onTaskClick: (t: Task) => void }) {
  const groups: Record<string, Task[]> = {};
  tasks.forEach(t => {
    const key = t.sourceId || t.documentId || t.expedienteId || t.id;
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  });

  return (
    <div className="space-y-3">
      {Object.entries(groups).map(([docId, docTasks]) => {
        const resource = getTaskResource(docTasks[0]);
        const reference = docTasks[0]?.sourceId || docTasks[0]?.documentId || docTasks[0]?.expedienteId;
        return (
          <div key={docId} className="overflow-hidden rounded-lg border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="flex items-center gap-3 border-b border-slate-200 bg-slate-50/70 px-4 py-3">
              <FileText size={15} className="text-primary flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-600 text-slate-900">{resource.name}</p>
                <p className="text-xs text-slate-500">{resource.kind}{reference ? ` · ${reference.slice(0, 8).toUpperCase()}` : ''} · {docTasks.length} tarea{docTasks.length !== 1 ? 's' : ''}</p>
              </div>
            </div>
            <div className="divide-y divide-slate-100">
              {docTasks.map(task => {
                const typeInfo = TASK_TYPE_CONFIG[task.type] || TASK_TYPE_CONFIG.revisar_documento;
                const statusInfo = STATUS_CONFIG[visibleTaskStatus(task)] || STATUS_CONFIG.pendiente;
                const TypeIcon = typeInfo.icon;
                return (
                  <button key={task.id} type="button" onClick={() => onTaskClick(task)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50/80">
                    <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${typeInfo.bg}`}>
                      <TypeIcon size={11} className={typeInfo.color} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground">{task.title}</p>
                      <p className="text-xs text-muted-foreground">{typeInfo.label}</p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusInfo.className}`}>{statusInfo.label}</span>
                    <Avatar initials={task.responsibleAvatar} size="xs" />
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Quick Filters ────────────────────────────────────────────────────────────
const QUICK_FILTERS = [
  { id: 'mis_tareas',       label: 'Mis tareas' },
  { id: 'asignadas_por_mi', label: 'Creadas por mí' },
  { id: 'vencidas',         label: 'Vencidas' },
  { id: 'programadas',      label: 'Programadas' },
  { id: 'bloqueadas',       label: 'Bloqueadas' },
  { id: 'criticas',         label: 'Alta prioridad' },
  { id: 'automaticas',      label: 'Del sistema' },
];
const QUICK_STATUS_FILTERS: Record<string, TaskStatus> = {
  vencidas: 'vencida', programadas: 'programada', bloqueadas: 'bloqueada',
};

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function PendingTasksPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('lista');
  const [listLayout, setListLayout] = useState<'rows' | 'grid'>('rows');
  const [statusScope, setStatusScope] = useState<TaskStatusScope>('active');
  const [kindScope, setKindScope] = useState<'all' | 'accion' | 'actividad'>('all');
  const [typeScope, setTypeScope] = useState<string>('all');
  const [sortMode, setSortMode] = useState<'due' | 'recent' | 'priority'>('due');
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showNewTask, setShowNewTask] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();
  const { user } = useAuth();
  const { activeWorkspace } = useWorkspace();

  const activeWorkspaceId = activeWorkspace?.id ?? null;
  const userName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Usuario';

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!user) { setTasks([]); setLoading(false); return; }

      if (!activeWorkspaceId) { setTasks([]); return; }
      const [rows, checklistRows] = await Promise.all([
        fetchAllPages((from, to) => supabase.from('tareas').select('*')
          .eq('workspace_id', activeWorkspaceId)
          .not('source_id', 'is', null)
          .order('created_at', { ascending: false }).order('id', { ascending: false })
          .range(from, to)),
        fetchAllPages((from, to) => supabase.from('task_checklist_items').select('id,tarea_id,text,done,position')
          .eq('workspace_id', activeWorkspaceId).order('id').range(from, to)),
      ]);
      const checklistByTask = new Map<string, ChecklistItem[]>();
      for (const item of checklistRows) {
        const items = checklistByTask.get(item.tarea_id) || [];
        items.push({ id: item.id, text: item.text, done: item.done, position: item.position });
        checklistByTask.set(item.tarea_id, items);
      }
      setTasks(rows.map(row => ({ ...mapRowToTask(row), checklist: (checklistByTask.get(row.id) || []).sort((a, b) => (a.position || 0) - (b.position || 0)) })));
      window.dispatchEvent(new Event('docubox:tasks-changed'));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Error inesperado al cargar las tareas.');
    } finally {
      setLoading(false);
    }
  }, [user, activeWorkspaceId, supabase]);

  useEffect(() => { const timer = window.setTimeout(() => { void fetchTasks(); }, 0); return () => window.clearTimeout(timer); }, [fetchTasks]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || selectedTask || tasks.length === 0) return;
    const taskId = new URLSearchParams(window.location.search).get('task');
    if (!taskId) return;
    const matchingTask = tasks.find((task) => task.id === taskId);
    if (matchingTask) { const timer = window.setTimeout(() => setSelectedTask(matchingTask), 0); return () => window.clearTimeout(timer); }
  }, [selectedTask, tasks]);

  const handleTaskUpdated = useCallback((taskId: string) => {
    Promise.all([
      supabase.from('tareas').select('*').eq('id', taskId).single(),
      supabase.from('task_checklist_items').select('id,text,done,position').eq('tarea_id', taskId).order('position', { ascending: true }),
    ]).then(([{ data, error: taskError }, { data: items, error: checklistError }]) => {
      if (taskError || checklistError) {
        setError('No se pudo actualizar la vista de tareas. Vuelve a cargar para ver los cambios.');
        return;
      }
      if (data) {
        const updated = mapRowToTask(data);
        if (items) updated.checklist = items.map(item => ({ id: item.id, text: item.text, done: item.done, position: item.position }));
        setTasks(prev => prev.map(t => t.id === taskId ? updated : t));
        setSelectedTask(prev => prev?.id === taskId ? updated : prev);
        window.dispatchEvent(new Event('docubox:tasks-changed'));
      }
    }).catch(() => setError('No se pudo actualizar la vista de tareas. Vuelve a cargar para ver los cambios.'));
  }, [supabase]);

  const toggleFilter = useCallback((id: string) => {
    const status = QUICK_STATUS_FILTERS[id];
    if (status) {
      setStatusScope(previous => previous === status ? 'active' : status);
      return;
    }
    setActiveFilters(prev => prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]);
  }, []);

  const displayTasks = useMemo(() => tasks.map(task => taskAtTime(task, now)), [tasks, now]);
  const filtered = displayTasks.filter(task => {
    if (search) {
      const q = search.trim().toLocaleLowerCase('es');
      const searchable = [task.title, task.description, task.documentName, task.expedienteName,
        task.responsible, TASK_TYPE_CONFIG[task.type]?.label].filter(Boolean).join(' ').toLocaleLowerCase('es');
      if (!searchable.includes(q)) return false;
    }
    if (!matchesTaskStatus(task, statusScope)) return false;
    if (kindScope !== 'all' && task.workKind !== kindScope) return false;
    if (typeScope !== 'all' && task.type !== typeScope) return false;
    if (activeFilters.includes('mis_tareas') && task.assignedTo !== user?.id) return false;
    if (activeFilters.includes('asignadas_por_mi') && (task.createdBy !== user?.id || task.origin !== 'manual')) return false;
    if (activeFilters.includes('criticas') && !task.isCritical && !['critica','alta'].includes(task.priority)) return false;
    if (activeFilters.includes('automaticas') && task.origin !== 'sistema') return false;
    return true;
  }).sort((a, b) => sortMode === 'recent'
    ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    : sortMode === 'priority'
      ? ['critica','alta','media','baja'].indexOf(a.priority) - ['critica','alta','media','baja'].indexOf(b.priority)
      : (a.dueDate ? new Date(a.dueDate).getTime() : Infinity) - (b.dueDate ? new Date(b.dueDate).getTime() : Infinity));
  const hasAppliedFilters = Boolean(search.trim() || statusScope !== 'active' || kindScope !== 'all' || typeScope !== 'all' || activeFilters.length);
  const resetFilters = () => {
    setSearch(''); setStatusScope('active'); setKindScope('all'); setTypeScope('all'); setActiveFilters([]);
  };

  const views: { id: ViewMode; label: string; icon: React.ElementType }[] = [
    { id: 'lista',      label: 'Lista',      icon: List },
    { id: 'kanban',     label: 'Tablero',    icon: LayoutGrid },
    { id: 'calendario', label: 'Calendario', icon: CalendarDays },
    { id: 'documento',  label: 'Recurso',    icon: FolderOpen },
  ];

  return (
    <AppLayout noPadding>
      <div className="-mx-4 -my-4 min-h-[calc(100vh-4rem)] bg-[#f6f8fb] px-4 py-4 sm:px-5 md:-my-6 md:py-5 lg:px-6">
        <div className="mx-auto w-full max-w-[1600px]">

        {/* Page Header */}
        <div className="mb-4 flex flex-col gap-3 border-b border-slate-200/80 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-600 leading-tight text-slate-950">
              Mis Tareas
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Acciones que requieren tu atención dentro del flujo documental.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/mis-tareas/automatizaciones" className="flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-600 text-slate-700 shadow-sm hover:bg-slate-50">
              <Cpu size={15} />Automatizaciones
            </Link>
            <button
              onClick={() => setShowNewTask(true)}
              className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-600 text-white shadow-sm transition-colors hover:bg-primary/90"
            >
              <Plus size={15} />Nueva tarea
            </button>
          </div>
        </div>

        {/* Metrics */}
        <TaskMetrics tasks={displayTasks} now={now} />

        {/* View Tabs + Search */}
        <section className="mb-4 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-2 px-4 py-3 lg:flex-row lg:items-center">
          {/* View mode buttons */}
          <div className="flex h-9 w-fit items-center overflow-hidden rounded-md border border-slate-200 bg-white p-0.5">
            {views.map(v => {
              const VIcon = v.icon;
              return (
                <button
                  key={v.id}
                  onClick={() => setViewMode(v.id)}
                  className={`flex h-7 items-center gap-1.5 rounded px-3 text-sm font-600 transition-colors ${
                    viewMode === v.id ? 'bg-slate-100 text-slate-950' : 'text-slate-400 hover:text-slate-700'
                  }`}
                >
                  <VIcon size={15} />{v.label}
                </button>
              );
            })}
          </div>
          <div className="relative min-w-[240px] flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              aria-label="Buscar tareas y recursos"
              placeholder="Buscar tareas, documentos..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-9 w-full rounded-md border border-slate-200 bg-slate-50/70 pl-9 pr-3 text-sm transition-colors focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/10"
            />
          </div>
          {viewMode === 'lista' && <div className="flex h-9 items-center gap-1 rounded-md border border-slate-200 p-1" aria-label="Diseño de lista">
            <button type="button" onClick={() => setListLayout('rows')} title="Vista de lista" aria-label="Vista de lista" aria-pressed={listLayout === 'rows'} className={`flex h-7 w-8 items-center justify-center rounded ${listLayout === 'rows' ? 'bg-slate-100 text-slate-900' : 'text-slate-400 hover:text-slate-700'}`}><List size={16} /></button>
            <button type="button" onClick={() => setListLayout('grid')} title="Vista de cuadrícula" aria-label="Vista de cuadrícula" aria-pressed={listLayout === 'grid'} className={`flex h-7 w-8 items-center justify-center rounded ${listLayout === 'grid' ? 'bg-slate-100 text-slate-900' : 'text-slate-400 hover:text-slate-700'}`}><LayoutGrid size={16} /></button>
          </div>}
          {!loading && filtered.length !== tasks.length && (
            <span className="inline-flex h-7 w-fit items-center rounded-md border border-slate-200 bg-white px-2.5 text-xs font-600 text-slate-500">{filtered.length} {filtered.length === 1 ? 'resultado' : 'resultados'} · {tasks.length} totales</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-4 py-3">
          <select aria-label="Tipo de trabajo" value={kindScope} onChange={event => setKindScope(event.target.value as typeof kindScope)} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700">
            <option value="all">Acciones y actividades</option><option value="accion">Acciones del proceso</option><option value="actividad">Actividades</option>
          </select>
          <select aria-label="Estado" value={statusScope} onChange={event => setStatusScope(event.target.value as typeof statusScope)} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700">
            <option value="active">Todas las abiertas</option>
            {Object.entries(STATUS_CONFIG).map(([key, config]) => <option key={key} value={key}>{config.label}</option>)}
            <option value="all">Todos los estados</option>
          </select>
          <select aria-label="Tipo de tarea" value={typeScope} onChange={event => setTypeScope(event.target.value)} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700">
            <option value="all">Todos los tipos</option>{Object.entries(TASK_TYPE_CONFIG).map(([key, config]) => <option key={key} value={key}>{config.label}</option>)}
          </select>
          <select aria-label="Ordenar tareas" value={sortMode} onChange={event => setSortMode(event.target.value as typeof sortMode)} className="ml-auto h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700">
            <option value="due">Próximo vencimiento</option><option value="recent">Más recientes</option><option value="priority">Prioridad</option>
          </select>
        </div>

        {/* Quick Filters */}
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-4 py-3">
          {QUICK_FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => toggleFilter(f.id)}
              aria-pressed={QUICK_STATUS_FILTERS[f.id] ? statusScope === QUICK_STATUS_FILTERS[f.id] : activeFilters.includes(f.id)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm font-500 transition-colors ${
                (QUICK_STATUS_FILTERS[f.id] ? statusScope === QUICK_STATUS_FILTERS[f.id] : activeFilters.includes(f.id))
                  ? 'border-primary bg-primary text-white' :'border-slate-200 bg-white text-slate-600 hover:border-primary/40 hover:text-primary'
              }`}
            >
              {(QUICK_STATUS_FILTERS[f.id] ? statusScope === QUICK_STATUS_FILTERS[f.id] : activeFilters.includes(f.id)) && <X size={11} />}
              {f.label}
            </button>
          ))}
          {hasAppliedFilters && (
            <button
              onClick={resetFilters}
              className="inline-flex h-8 items-center rounded-md border border-dashed border-slate-300 px-3 text-sm font-500 text-slate-500 transition-colors hover:border-slate-500 hover:text-slate-800"
            >
              Restablecer filtros
            </button>
          )}
        </div>
        </section>

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center rounded-lg border border-slate-200/90 bg-white py-20 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm text-slate-500">Cargando tareas...</p>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-5">
            <AlertCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-700">Error al cargar las tareas</p>
              <p className="text-xs text-red-600 mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {/* Views */}
        {!loading && !error && (
          filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white py-16">
              <CheckSquare size={32} className="mb-3 text-slate-300" />
              <p className="text-sm font-semibold text-slate-900">{tasks.length ? 'Sin tareas que coincidan' : 'Aún no hay tareas'}</p>
              <p className="mt-1 text-sm text-slate-500">{tasks.length ? 'Prueba con otro estado, tipo o término de búsqueda.' : 'Crea una tarea vinculada a un recurso existente.'}</p>
              <button type="button" onClick={tasks.length ? resetFilters : () => setShowNewTask(true)}
                className="mt-4 flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary/90">
                {tasks.length ? 'Restablecer filtros' : <><Plus size={15} />Nueva tarea</>}
              </button>
            </div>
          ) : (
            <>
              {viewMode === 'lista' && (
                <section aria-label="Resultados de tareas" className={listLayout === 'grid' ? 'space-y-3' : 'overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]'}>
                  <div className={listLayout === 'grid' ? 'flex flex-wrap items-end justify-between gap-2' : 'border-b border-slate-100 px-4 py-3 lg:px-5'}>
                    <div><h2 className="text-sm font-semibold text-slate-900">{listLayout === 'grid' ? 'Tareas en tarjetas' : 'Lista de trabajo'}</h2><p className="mt-0.5 text-xs text-slate-500">{filtered.length} {filtered.length === 1 ? 'tarea disponible' : 'tareas disponibles'} · Selecciona una para ver el detalle y continuar.</p></div>
                  </div>
                  {listLayout === 'grid' ? (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {filtered.map(task => <TaskGridCard key={task.id} task={task} onClick={() => setSelectedTask(task)} />)}
                    </div>
                  ) : (
                    <>
                      <div className="hidden grid-cols-[minmax(0,3fr)_minmax(0,1.7fr)_minmax(0,1.5fr)_105px_110px_20px] gap-4 border-b border-slate-100 bg-slate-50/70 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 lg:grid">
                        <span>Tarea y contexto</span><span>Recurso</span><span>Responsable</span><span>Estado</span><span>Fecha límite</span><span className="sr-only">Abrir</span>
                      </div>
                      <div>{filtered.map(task => <TaskListRow key={task.id} task={task} onClick={() => setSelectedTask(task)} />)}</div>
                    </>
                  )}
                </section>
              )}
              {viewMode === 'kanban' && <KanbanView tasks={filtered} onTaskClick={setSelectedTask} />}
              {viewMode === 'calendario' && <CalendarView tasks={filtered} onTaskClick={setSelectedTask} />}
              {viewMode === 'documento' && <DocumentoView tasks={filtered} onTaskClick={setSelectedTask} />}
            </>
          )
        )}

        {!loading && !error && (
          <p className="mt-3 text-right text-xs text-slate-500">
            Mostrando {filtered.length} {filtered.length === 1 ? 'tarea' : 'tareas'} · {tasks.length} en total
          </p>
        )}
        </div>
      </div>

      {/* Full-screen task detail */}
      {selectedTask && (
        <TaskDetailDrawer
          key={selectedTask.id}
          task={taskAtTime(selectedTask, now)}
          onClose={() => {
            setSelectedTask(null);
            window.history.replaceState(null, '', '/mis-tareas');
          }}
          onTaskUpdated={handleTaskUpdated}
          onOpenTask={(taskId) => {
            const linked = tasks.find(task => task.id === taskId);
            if (!linked) return false;
            window.history.replaceState(null, '', `/mis-tareas?task=${encodeURIComponent(taskId)}`);
            setSelectedTask(linked);
            return true;
          }}
          workspaceId={activeWorkspaceId}
          userId={user?.id ?? null}
          userName={userName}
          canReassign={Boolean(activeWorkspace?.organizationEnabled && ['owner','admin'].includes(activeWorkspace.role))}
          canModerateComments={Boolean(activeWorkspace && ['owner','admin'].includes(activeWorkspace.role))}
        />
      )}

      {/* Guided task creation */}
      {showNewTask && activeWorkspaceId && user?.id && (
        <NewTaskWizard onClose={() => setShowNewTask(false)} onCreated={fetchTasks}
          workspaceId={activeWorkspaceId} userId={user.id}
          isPersonal={activeWorkspace?.workspaceType === 'personal'}
          canAssign={Boolean(activeWorkspace?.organizationEnabled && ['owner','admin'].includes(activeWorkspace.role))} />
      )}
    </AppLayout>
  );
}
