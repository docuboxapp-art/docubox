'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import AppLayout from '@/components/AppLayout';
import { CheckSquare, Search, FileSignature, Eye, AlertTriangle, Clock, Calendar, ArrowRight, Flame, LayoutGrid, CalendarDays, List, ChevronLeft, ChevronRight, Inbox, X, MessageSquare, Paperclip, History, Shield, Link2, Play, CheckCircle2, XCircle, Download, Upload, UserCheck, FileText, FolderOpen, Zap, Bell, MoreHorizontal, Plus, AlertCircle, Users, ClipboardCheck, Lock, RefreshCw, BookOpen, Star, Send, Cpu, Edit2, Trash2, ToggleLeft, ToggleRight, Save,  } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';

// ─── Types ────────────────────────────────────────────────────────────────────
type TaskType =
  | 'firmar_documento' | 'revisar_documento' | 'aprobar_documento'
  | 'subir_anexo'| 'validar_identidad' | 'corregir_datos' | 'resolver_comentario' |'confirmar_lectura' | 'descargar_constancia' | 'validar_efirma'
  | 'obtener_nom151' | 'cerrar_expediente';

type Priority = 'critica' | 'alta' | 'media' | 'baja';
type TaskStatus =
  | 'nueva' | 'pendiente' | 'en_proceso' | 'bloqueada' | 'en_revision' |'vencida' | 'escalada' | 'completada' | 'cancelada' | 'rechazada';
type ViewMode = 'lista' | 'kanban' | 'calendario' | 'documento';

interface ChecklistItem { id: string; text: string; done: boolean; position?: number; }
interface Comment { id: string; author: string; avatar: string; text: string; date: string; }
interface ActivityEntry { id: string; action: string; user: string; date: string; icon: React.ElementType; color: string; }
interface Attachment { id: string; name: string; size: string; type: string; storage_path?: string; }
interface Dependency { id: string; taskId: string; title: string; status: TaskStatus; }

interface Task {
  id: string;
  title: string;
  description: string;
  type: TaskType;
  priority: Priority;
  status: TaskStatus;
  risk: 'alto' | 'medio' | 'bajo';
  dueDate: string;
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
  attachments: Attachment[];
  dependencies: Dependency[];
  mainAction: string;
}

interface AutomationRule {
  id: string;
  nombre: string;
  descripcion: string;
  activa: boolean;
  trigger_type: string;
  action_type: string;
  trigger_config: Record<string, any>;
  action_config: Record<string, any>;
  prioridad: number;
  ejecutada_count: number;
  created_at: string;
}

interface DocumentOption {
  id: string;
  nombre: string;
  tipo?: string;
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
};

const PRIORITY_CONFIG: Record<Priority, { label: string; className: string; dot: string }> = {
  critica: { label: 'Crítica', className: 'text-red-700 bg-red-50 border border-red-200',         dot: 'bg-red-500' },
  alta:    { label: 'Alta',    className: 'text-orange-700 bg-orange-50 border border-orange-200', dot: 'bg-orange-500' },
  media:   { label: 'Media',   className: 'text-amber-700 bg-amber-50 border border-amber-200',    dot: 'bg-amber-400' },
  baja:    { label: 'Baja',    className: 'text-slate-600 bg-slate-50 border border-slate-200',    dot: 'bg-slate-400' },
};

const STATUS_CONFIG: Record<TaskStatus, { label: string; className: string; dot: string }> = {
  nueva:       { label: 'Nueva',       className: 'text-blue-700 bg-blue-50 border border-blue-200',       dot: 'bg-blue-500' },
  pendiente:   { label: 'Pendiente',   className: 'text-amber-700 bg-amber-50 border border-amber-200',    dot: 'bg-amber-400' },
  en_proceso:  { label: 'En proceso',  className: 'text-cyan-700 bg-cyan-50 border border-cyan-200',       dot: 'bg-cyan-500' },
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

const TRIGGER_LABELS: Record<string, string> = {
  tarea_vencida: 'Tarea vencida', firma_fallida: 'Firma fallida',
  prerequisito_incompleto: 'Prerequisito incompleto', plazo_proximo: 'Plazo próximo',
  estado_cambiado: 'Estado cambiado', tarea_creada: 'Tarea creada',
  tarea_completada: 'Tarea completada', documento_rechazado: 'Documento rechazado',
};

const ACTION_LABELS: Record<string, string> = {
  escalar_tarea: 'Escalar tarea', notificar_firmante: 'Notificar firmante',
  bloquear_operacion: 'Bloquear operación', generar_tarea_reintento: 'Generar tarea de reintento',
  enviar_recordatorio: 'Enviar recordatorio', cambiar_estado: 'Cambiar estado',
  asignar_responsable: 'Asignar responsable', crear_tarea: 'Crear tarea',
};

const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const DAYS_SHORT = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}
function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}
function getDueBadge(task: Task) {
  if (task.isOverdue || task.status === 'vencida') return { text: 'Vencida', urgent: true };
  const diff = new Date(task.dueDate).getTime() - Date.now();
  const days = Math.ceil(diff / 86400000);
  if (days <= 0) return { text: 'Hoy', urgent: true };
  if (days === 1) return { text: 'Mañana', urgent: true };
  if (days <= 3) return { text: `${days} días`, urgent: true };
  return { text: formatDate(task.dueDate), urgent: false };
}
function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const ICON_MAP: Record<string, React.ElementType> = {
  Plus, Zap, Lock, AlertTriangle, AlertCircle, Bell, Users, Eye, CheckCircle2,
  UserCheck, Send, RefreshCw, FolderOpen, MessageSquare, FileText,
};

function mapRowToTask(row: any): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    type: row.tipo as TaskType,
    priority: row.prioridad as Priority,
    status: row.estado as TaskStatus,
    risk: row.riesgo as 'alto' | 'medio' | 'bajo',
    dueDate: row.due_date || new Date().toISOString(),
    createdAt: row.created_at,
    sla: row.sla || '',
    responsible: row.responsible_name || '',
    responsibleAvatar: row.responsible_avatar || '??',
    creator: row.creator_name || '',
    documentName: row.document_name || '',
    documentId: row.document_id || '',
    expedienteId: row.expediente_id || '',
    expedienteName: row.expediente_name || '',
    isOverdue: row.is_overdue || false,
    isBlocked: row.is_blocked || false,
    isCritical: row.is_critical || false,
    tags: row.tags || [],
    checklist: (row.checklist || []) as ChecklistItem[],
    comments: (row.comments || []) as Comment[],
    activity: ((row.activity || []) as any[]).map((a: any) => ({ ...a, icon: ICON_MAP[a.icon] || Plus })),
    attachments: (row.attachments || []) as Attachment[],
    dependencies: (row.dependencies || []) as Dependency[],
    mainAction: row.main_action || 'Ver tarea',
  };
}

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Avatar({ initials, size = 'sm' }: { initials: string; size?: 'xs' | 'sm' | 'md' }) {
  const colors = ['bg-blue-500','bg-purple-500','bg-green-500','bg-amber-500','bg-cyan-500','bg-pink-500','bg-indigo-500','bg-teal-500'];
  const idx = (initials?.charCodeAt(0) || 0) % colors.length;
  const sz = size === 'xs' ? 'w-5 h-5 text-[9px]' : size === 'sm' ? 'w-7 h-7 text-[11px]' : 'w-9 h-9 text-sm';
  return <div className={`${sz} ${colors[idx]} rounded-full flex items-center justify-center text-white font-bold flex-shrink-0`}>{initials || '?'}</div>;
}

// ─── Metrics Dashboard ────────────────────────────────────────────────────────
function TaskMetrics({ tasks }: { tasks: Task[] }) {
  const total = tasks.length;
  const vencidas = tasks.filter(t => t.isOverdue || t.status === 'vencida').length;
  const criticas = tasks.filter(t => t.priority === 'critica' || t.isCritical).length;
  const bloqueadas = tasks.filter(t => t.isBlocked || t.status === 'bloqueada').length;
  const firmas = tasks.filter(t => t.type === 'firmar_documento' || t.type === 'validar_efirma').length;
  const anexos = tasks.filter(t => t.type === 'subir_anexo').length;
  const aprobaciones = tasks.filter(t => t.type === 'aprobar_documento').length;

  const metrics = [
    { label: 'Total pendientes',  value: total,       icon: CheckSquare,   color: 'text-blue-600',   bg: 'bg-blue-50',   border: 'border-blue-100' },
    { label: 'Vencidas',          value: vencidas,    icon: AlertTriangle, color: 'text-red-600',    bg: 'bg-red-50',    border: 'border-red-100' },
    { label: 'Críticas',          value: criticas,    icon: Flame,         color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-100' },
    { label: 'Bloqueadas',        value: bloqueadas,  icon: Lock,          color: 'text-rose-600',   bg: 'bg-rose-50',   border: 'border-rose-100' },
    { label: 'Firmas pendientes', value: firmas,      icon: FileSignature, color: 'text-indigo-600', bg: 'bg-indigo-50', border: 'border-indigo-100' },
    { label: 'Anexos faltantes',  value: anexos,      icon: Paperclip,     color: 'text-amber-600',  bg: 'bg-amber-50',  border: 'border-amber-100' },
    { label: 'Aprobaciones',      value: aprobaciones,icon: ClipboardCheck,color: 'text-green-600',  bg: 'bg-green-50',  border: 'border-green-100' },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
      {metrics.map((m) => {
        const MIcon = m.icon;
        return (
          <div key={m.label} className={`${m.bg} border ${m.border} rounded-xl p-3 flex flex-col gap-1.5`}>
            <div className="flex items-center justify-between">
              <MIcon size={15} className={m.color} />
              <span className={`text-2xl font-bold ${m.color} tabular-nums leading-none`}>{m.value}</span>
            </div>
            <p className="text-[11px] text-muted-foreground font-medium leading-tight">{m.label}</p>
          </div>
        );
      })}
    </div>
  );
}

// ─── New Task Lateral Drawer (45% width) ──────────────────────────────────────
interface NewTaskDrawerProps {
  onClose: () => void;
  onCreated: () => void;
  workspaceId: string | null;
  userId: string | null;
  userName?: string;
}

function NewTaskDrawer({ onClose, onCreated, workspaceId, userId, userName }: NewTaskDrawerProps) {
  const supabase = createClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentOption[]>([]);
  const [visible, setVisible] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    tipo: 'firmar_documento' as TaskType,
    prioridad: 'media' as Priority,
    riesgo: 'bajo' as 'alto' | 'medio' | 'bajo',
    due_date: '',
    sla: '48h',
    document_id: '',
    document_name: '',
    expediente_name: '',
    responsible_name: '',
    estado: 'nueva' as TaskStatus,
  });

  useEffect(() => {
    setVisible(true);
    if (!workspaceId) return;
    supabase
      .from('documentos')
      .select('id, nombre, tipo_documento')
      .eq('workspace_id', workspaceId)
      .not('estado', 'in', '(cancelado,archivado)')
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (data) setDocuments(data.map((d: any) => ({ id: d.id, nombre: d.nombre, tipo: d.tipo_documento })));
      });
  }, [workspaceId]);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 250);
  };

  const handleDocumentChange = (docId: string) => {
    const doc = documents.find(d => d.id === docId);
    setForm(f => ({ ...f, document_id: docId, document_name: doc?.nombre || '' }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) { setError('El título es requerido.'); return; }
    if (!workspaceId || !userId) { setError('No hay workspace activo.'); return; }
    setSaving(true);
    setError(null);
    try {
      const { data: inserted, error: insertError } = await supabase.from('tareas').insert({
        title: form.title.trim(),
        description: form.description.trim(),
        tipo: form.tipo,
        prioridad: form.prioridad,
        riesgo: form.riesgo,
        estado: form.estado,
        due_date: form.due_date || null,
        sla: form.sla,
        document_id: form.document_id || null,
        document_name: form.document_name,
        expediente_name: form.expediente_name,
        responsible_name: form.responsible_name,
        responsible_avatar: form.responsible_name.slice(0, 2).toUpperCase() || 'TA',
        creator_name: userName || '',
        creator_user_id: userId,
        workspace_id: workspaceId,
        is_overdue: false,
        is_blocked: false,
        is_critical: form.prioridad === 'critica',
        tags: [],
        checklist: [],
        comments: [],
        activity: [{ id: 'a1', action: `Tarea creada por ${userName || 'usuario'}`, user: userName || 'Sistema', date: new Date().toISOString(), icon: 'Plus', color: 'text-blue-500' }],
        attachments: [],
        dependencies: [],
        main_action: 'Ver tarea',
      }).select().single();

      if (insertError) throw insertError;

      // Insert initial history entry
      if (inserted) {
        await supabase.from('task_history').insert({
          tarea_id: inserted.id,
          workspace_id: workspaceId,
          action: `Tarea creada por ${userName || 'usuario'}`,
          actor_id: userId,
          actor_name: userName || 'Sistema',
          icon_name: 'Plus',
          color: 'text-blue-500',
        });
      }

      onCreated();
      handleClose();
    } catch (err: any) {
      setError(err.message || 'Error al crear la tarea.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className={`flex-1 bg-black/30 backdrop-blur-sm transition-opacity duration-250 ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={handleClose}
      />
      <div
        className={`bg-white shadow-2xl flex flex-col overflow-hidden transition-transform duration-250 ${visible ? 'translate-x-0' : 'translate-x-full'}`}
        style={{ width: '45%', minWidth: 380, maxWidth: 720 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-white flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
              <Plus size={16} className="text-primary" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">Nueva tarea</h2>
              <p className="text-xs text-muted-foreground">Completa los campos para crear la tarea</p>
            </div>
          </div>
          <button onClick={handleClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle size={14} className="flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Title */}
          <div>
            <label className="block text-sm font-semibold text-foreground mb-1.5">Título <span className="text-red-500">*</span></label>
            <input
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Ej: Firmar contrato de servicios"
              className="w-full text-sm border border-border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-semibold text-foreground mb-1.5">Descripción</label>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Describe la tarea..."
              rows={3}
              className="w-full text-sm border border-border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
            />
          </div>

          {/* Type + Priority */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-foreground mb-1.5">Tipo de tarea</label>
              <select
                value={form.tipo}
                onChange={e => setForm(f => ({ ...f, tipo: e.target.value as TaskType }))}
                className="w-full text-sm border border-border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white"
              >
                {Object.entries(TASK_TYPE_CONFIG).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-foreground mb-1.5">Prioridad</label>
              <select
                value={form.prioridad}
                onChange={e => setForm(f => ({ ...f, prioridad: e.target.value as Priority }))}
                className="w-full text-sm border border-border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white"
              >
                <option value="baja">Baja</option>
                <option value="media">Media</option>
                <option value="alta">Alta</option>
                <option value="critica">Crítica</option>
              </select>
            </div>
          </div>

          {/* Estado + Riesgo */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-foreground mb-1.5">Estado inicial</label>
              <select
                value={form.estado}
                onChange={e => setForm(f => ({ ...f, estado: e.target.value as TaskStatus }))}
                className="w-full text-sm border border-border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white"
              >
                <option value="nueva">Nueva</option>
                <option value="pendiente">Pendiente</option>
                <option value="en_proceso">En proceso</option>
                <option value="en_revision">En revisión</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-foreground mb-1.5">Nivel de riesgo</label>
              <div className="flex gap-2">
                {(['bajo', 'medio', 'alto'] as const).map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, riesgo: r }))}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-all ${
                      form.riesgo === r ? RISK_CONFIG[r].className : 'border-border text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {RISK_CONFIG[r].label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Document */}
          <div>
            <label className="block text-sm font-semibold text-foreground mb-1.5">
              <FileText size={13} className="inline mr-1" />
              Documento asociado
            </label>
            {documents.length > 0 ? (
              <select
                value={form.document_id}
                onChange={e => handleDocumentChange(e.target.value)}
                className="w-full text-sm border border-border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white"
              >
                <option value="">— Sin documento —</option>
                {documents.map(d => (
                  <option key={d.id} value={d.id}>{d.nombre}{d.tipo ? ` (${d.tipo})` : ''}</option>
                ))}
              </select>
            ) : (
              <input
                value={form.document_name}
                onChange={e => setForm(f => ({ ...f, document_name: e.target.value }))}
                placeholder="Nombre del documento"
                className="w-full text-sm border border-border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            )}
          </div>

          {/* Expediente */}
          <div>
            <label className="block text-sm font-semibold text-foreground mb-1.5">
              <FolderOpen size={13} className="inline mr-1" />
              Expediente (opcional)
            </label>
            <input
              value={form.expediente_name}
              onChange={e => setForm(f => ({ ...f, expediente_name: e.target.value }))}
              placeholder="Nombre del expediente"
              className="w-full text-sm border border-border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>

          {/* Due date + SLA */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-foreground mb-1.5">Fecha límite</label>
              <input
                type="datetime-local"
                value={form.due_date}
                onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
                className="w-full text-sm border border-border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-foreground mb-1.5">SLA</label>
              <select
                value={form.sla}
                onChange={e => setForm(f => ({ ...f, sla: e.target.value }))}
                className="w-full text-sm border border-border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white"
              >
                <option value="2h">2 horas</option>
                <option value="4h">4 horas</option>
                <option value="8h">8 horas</option>
                <option value="24h">24 horas</option>
                <option value="48h">48 horas</option>
                <option value="72h">72 horas</option>
                <option value="7d">7 días</option>
              </select>
            </div>
          </div>

          {/* Responsible */}
          <div>
            <label className="block text-sm font-semibold text-foreground mb-1.5">Responsable</label>
            <input
              value={form.responsible_name}
              onChange={e => setForm(f => ({ ...f, responsible_name: e.target.value }))}
              placeholder="Nombre del responsable"
              className="w-full text-sm border border-border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>
        </form>

        {/* Footer actions */}
        <div className="flex gap-3 px-6 py-4 border-t border-border bg-white flex-shrink-0">
          <button
            type="button"
            onClick={handleClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-border text-foreground hover:bg-muted transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit as any}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Save size={14} />}
            {saving ? 'Guardando...' : 'Crear tarea'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Automation Rule Modal ────────────────────────────────────────────────────
const TRIGGER_OPTIONS = [
  { value: 'tarea_vencida', label: 'Tarea vencida' },
  { value: 'firma_fallida', label: 'Firma fallida' },
  { value: 'prerequisito_incompleto', label: 'Prerequisito incompleto' },
  { value: 'plazo_proximo', label: 'Plazo próximo' },
  { value: 'estado_cambiado', label: 'Estado cambiado' },
  { value: 'tarea_creada', label: 'Tarea creada' },
  { value: 'tarea_completada', label: 'Tarea completada' },
  { value: 'documento_rechazado', label: 'Documento rechazado' },
];

const ACTION_OPTIONS = [
  { value: 'escalar_tarea', label: 'Escalar tarea' },
  { value: 'notificar_firmante', label: 'Notificar firmante' },
  { value: 'bloquear_operacion', label: 'Bloquear operación' },
  { value: 'generar_tarea_reintento', label: 'Generar tarea de reintento' },
  { value: 'enviar_recordatorio', label: 'Enviar recordatorio' },
  { value: 'cambiar_estado', label: 'Cambiar estado' },
  { value: 'asignar_responsable', label: 'Asignar responsable' },
  { value: 'crear_tarea', label: 'Crear tarea' },
];

interface AutomationModalProps {
  rule?: AutomationRule | null;
  onClose: () => void;
  onSaved: () => void;
  workspaceId: string | null;
  userId: string | null;
}

function AutomationModal({ rule, onClose, onSaved, workspaceId, userId }: AutomationModalProps) {
  const supabase = createClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    nombre: rule?.nombre || '',
    descripcion: rule?.descripcion || '',
    activa: rule?.activa ?? true,
    trigger_type: rule?.trigger_type || 'tarea_vencida',
    action_type: rule?.action_type || 'escalar_tarea',
    prioridad: rule?.prioridad ?? 0,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nombre.trim()) { setError('El nombre es requerido.'); return; }
    if (!workspaceId || !userId) { setError('No hay workspace activo.'); return; }
    setSaving(true);
    setError(null);
    try {
      if (rule) {
        const { error: updateError } = await supabase.from('automation_rules').update({
          nombre: form.nombre.trim(),
          descripcion: form.descripcion.trim(),
          activa: form.activa,
          trigger_type: form.trigger_type,
          action_type: form.action_type,
          prioridad: form.prioridad,
        }).eq('id', rule.id);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase.from('automation_rules').insert({
          nombre: form.nombre.trim(),
          descripcion: form.descripcion.trim(),
          activa: form.activa,
          trigger_type: form.trigger_type,
          action_type: form.action_type,
          trigger_config: {},
          action_config: {},
          prioridad: form.prioridad,
          workspace_id: workspaceId,
          created_by: userId,
        });
        if (insertError) throw insertError;
      }
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error al guardar la automatización.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-bold text-foreground">{rule ? 'Editar automatización' : 'Nueva automatización'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
          <div>
            <label className="block text-xs font-semibold text-foreground mb-1.5">Nombre *</label>
            <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Nombre de la regla" className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-foreground mb-1.5">Descripción</label>
            <textarea value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} rows={2} className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">Disparador</label>
              <select value={form.trigger_type} onChange={e => setForm(f => ({ ...f, trigger_type: e.target.value }))} className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary/30">
                {TRIGGER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">Acción</label>
              <select value={form.action_type} onChange={e => setForm(f => ({ ...f, action_type: e.target.value }))} className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary/30">
                {ACTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs font-semibold text-foreground">Estado:</label>
            <button type="button" onClick={() => setForm(f => ({ ...f, activa: !f.activa }))} className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${form.activa ? 'bg-green-50 text-green-700 border-green-200' : 'bg-muted text-muted-foreground border-border'}`}>
              {form.activa ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
              {form.activa ? 'Activa' : 'Inactiva'}
            </button>
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-border text-foreground hover:bg-muted transition-colors">Cancelar</button>
            <button type="submit" disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
              {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Save size={14} />}
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Delete Confirm Modal ─────────────────────────────────────────────────────
function DeleteConfirmModal({ title, onConfirm, onCancel, loading }: { title: string; onConfirm: () => void; onCancel: () => void; loading: boolean }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center"><Trash2 size={18} className="text-red-500" /></div>
          <div>
            <h3 className="text-sm font-bold text-foreground">Eliminar automatización</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Esta acción no se puede deshacer</p>
          </div>
        </div>
        <p className="text-sm text-foreground mb-5">¿Eliminar <span className="font-semibold">"{title}"</span>?</p>
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-border text-foreground hover:bg-muted transition-colors">Cancelar</button>
          <button onClick={onConfirm} disabled={loading} className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
            {loading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Trash2 size={14} />}
            Eliminar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Automation Rules Panel ───────────────────────────────────────────────────
function AutomationRulesPanel({ workspaceId, userId }: { workspaceId: string | null; userId: string | null }) {
  const supabase = createClient();
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editRule, setEditRule] = useState<AutomationRule | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AutomationRule | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchRules = useCallback(async () => {
    if (!workspaceId) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase.from('automation_rules').select('*').eq('workspace_id', workspaceId).order('prioridad', { ascending: true });
    setRules(data || []);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  const handleToggle = async (rule: AutomationRule) => {
    await supabase.from('automation_rules').update({ activa: !rule.activa }).eq('id', rule.id);
    setRules(prev => prev.map(r => r.id === rule.id ? { ...r, activa: !r.activa } : r));
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    await supabase.from('automation_rules').delete().eq('id', deleteTarget.id);
    setRules(prev => prev.filter(r => r.id !== deleteTarget.id));
    setDeleteTarget(null);
    setDeleting(false);
  };

  const TRIGGER_ICON_MAP: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
    tarea_vencida: { icon: AlertTriangle, color: 'text-red-500', bg: 'bg-red-50' },
    firma_fallida: { icon: XCircle, color: 'text-rose-500', bg: 'bg-rose-50' },
    prerequisito_incompleto: { icon: Lock, color: 'text-orange-500', bg: 'bg-orange-50' },
    plazo_proximo: { icon: Clock, color: 'text-amber-500', bg: 'bg-amber-50' },
    estado_cambiado: { icon: RefreshCw, color: 'text-blue-500', bg: 'bg-blue-50' },
    tarea_creada: { icon: Plus, color: 'text-green-500', bg: 'bg-green-50' },
    tarea_completada: { icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-50' },
    documento_rechazado: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-50' },
  };

  return (
    <div className="bg-white border border-border rounded-xl p-4 mb-5">
      <div className="flex items-center gap-2 mb-4">
        <Cpu size={15} className="text-primary" />
        <span className="text-sm font-bold text-foreground">Automatizaciones</span>
        <span className="ml-1 text-[10px] font-semibold text-green-600 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">{rules.filter(r => r.activa).length} activas</span>
        <button onClick={() => { setEditRule(null); setShowModal(true); }} className="ml-auto flex items-center gap-1.5 text-xs font-semibold bg-primary text-white px-3 py-1.5 rounded-lg hover:bg-primary/90 transition-colors">
          <Plus size={12} />Nueva
        </button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-6"><div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : rules.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground">
          <Cpu size={24} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">Sin automatizaciones configuradas</p>
          <button onClick={() => { setEditRule(null); setShowModal(true); }} className="mt-2 text-xs text-primary hover:underline">Crear la primera</button>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map(rule => {
            const triggerInfo = TRIGGER_ICON_MAP[rule.trigger_type] || { icon: Zap, color: 'text-primary', bg: 'bg-primary/10' };
            const TIcon = triggerInfo.icon;
            return (
              <div key={rule.id} className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${rule.activa ? 'border-border bg-white' : 'border-dashed border-border/60 bg-muted/20 opacity-60'}`}>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${triggerInfo.bg}`}><TIcon size={14} className={triggerInfo.color} /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-xs font-bold text-foreground truncate">{rule.nombre}</p>
                    {rule.activa ? <span className="text-[9px] font-semibold text-green-600 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded-full">Activa</span> : <span className="text-[9px] font-semibold text-gray-500 bg-gray-50 border border-gray-200 px-1.5 py-0.5 rounded-full">Inactiva</span>}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <span className="text-[10px] text-muted-foreground">{TRIGGER_LABELS[rule.trigger_type] || rule.trigger_type}</span>
                    <ArrowRight size={9} className="text-muted-foreground/50" />
                    <span className="text-[10px] text-muted-foreground">{ACTION_LABELS[rule.action_type] || rule.action_type}</span>
                    {rule.ejecutada_count > 0 && <span className="text-[9px] text-muted-foreground/60">· {rule.ejecutada_count}x</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => handleToggle(rule)} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                    {rule.activa ? <ToggleRight size={14} className="text-green-600" /> : <ToggleLeft size={14} />}
                  </button>
                  <button onClick={() => { setEditRule(rule); setShowModal(true); }} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"><Edit2 size={13} /></button>
                  <button onClick={() => setDeleteTarget(rule)} className="p-1.5 rounded-md hover:bg-red-50 text-muted-foreground hover:text-red-600 transition-colors"><Trash2 size={13} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {showModal && <AutomationModal rule={editRule} onClose={() => { setShowModal(false); setEditRule(null); }} onSaved={fetchRules} workspaceId={workspaceId} userId={userId} />}
      {deleteTarget && <DeleteConfirmModal title={deleteTarget.nombre} onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} loading={deleting} />}
    </div>
  );
}

// ─── Task Card ────────────────────────────────────────────────────────────────
function TaskCard({ task, onClick }: { task: Task; onClick: () => void }) {
  const typeInfo = TASK_TYPE_CONFIG[task.type];
  const priorityInfo = PRIORITY_CONFIG[task.priority];
  const statusInfo = STATUS_CONFIG[task.status];
  const riskInfo = RISK_CONFIG[task.risk];
  const dueInfo = getDueBadge(task);
  const TypeIcon = typeInfo.icon;
  const done = task.checklist.filter(c => c.done).length;
  const total = task.checklist.length;

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-xl border shadow-sm hover:shadow-md transition-all duration-150 cursor-pointer group ${
        task.isOverdue ? 'border-red-200 hover:border-red-300' : task.isBlocked ? 'border-orange-200 hover:border-orange-300' : 'border-border hover:border-primary/30'
      }`}
    >
      {(task.isCritical || task.isOverdue || task.isBlocked) && (
        <div className={`h-0.5 rounded-t-xl ${task.isOverdue ? 'bg-red-500' : task.isBlocked ? 'bg-orange-500' : 'bg-amber-400'}`} />
      )}
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${typeInfo.bg} border ${typeInfo.border}`}>
            <TypeIcon size={15} className={typeInfo.color} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                  <span className="text-[10px] font-mono text-muted-foreground/60">{task.id.slice(0,8).toUpperCase()}</span>
                  {task.isCritical && <span className="text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">CRÍTICA</span>}
                  {task.isBlocked && <span className="text-[9px] font-bold text-red-700 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full flex items-center gap-0.5"><Lock size={8}/>BLOQUEADA</span>}
                </div>
                <h3 className="text-sm font-bold text-foreground group-hover:text-primary transition-colors leading-tight line-clamp-2">{task.title}</h3>
              </div>
              <button onClick={e => e.stopPropagation()} className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
                <MoreHorizontal size={14} />
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 mt-2.5">
          <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${priorityInfo.className}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${priorityInfo.dot}`} />{priorityInfo.label}
          </span>
          <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusInfo.className}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${statusInfo.dot}`} />{statusInfo.label}
          </span>
          <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${riskInfo.className}`}>
            Riesgo {riskInfo.label}
          </span>
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-50 border border-slate-200 text-slate-600">
            <Clock size={9} />SLA {task.sla}
          </span>
        </div>

        <div className="mt-2.5 space-y-1">
          {task.documentName && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <FileText size={10} className="flex-shrink-0" />
              <span className="truncate font-medium text-foreground/70">{task.documentName}</span>
            </div>
          )}
          {task.expedienteName && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <FolderOpen size={10} className="flex-shrink-0" />
              <span className="truncate">{task.expedienteName}</span>
            </div>
          )}
          {task.responsible && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Avatar initials={task.responsibleAvatar} size="xs" />
              <span className="truncate">{task.responsible}</span>
            </div>
          )}
        </div>

        {total > 0 && (
          <div className="mt-2.5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-muted-foreground">Checklist</span>
              <span className="text-[10px] font-semibold text-foreground">{done}/{total}</span>
            </div>
            <div className="h-1 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${total > 0 ? (done/total)*100 : 0}%` }} />
            </div>
          </div>
        )}

        {task.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2.5">
            {task.tags.slice(0, 3).map(tag => (
              <span key={tag} className="text-[9px] font-semibold text-primary/70 bg-primary/5 border border-primary/10 px-1.5 py-0.5 rounded-full">{tag}</span>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/60">
          <div className={`flex items-center gap-1 text-[11px] font-semibold ${dueInfo.urgent ? 'text-red-600' : 'text-muted-foreground'}`}>
            <Calendar size={10} />
            <span>{dueInfo.text}</span>
            {dueInfo.urgent && <AlertTriangle size={10} />}
          </div>
          <button
            onClick={e => e.stopPropagation()}
            className="flex items-center gap-1 text-[11px] font-bold text-primary bg-primary/5 hover:bg-primary hover:text-white border border-primary/20 hover:border-primary px-2.5 py-1 rounded-lg transition-all duration-150"
          >
            {task.mainAction}<ArrowRight size={10} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Task Detail Drawer (45% lateral) ────────────────────────────────────────
type DrawerTab = 'info' | 'checklist' | 'comentarios' | 'adjuntos' | 'historial' | 'dependencias';

function TaskDetailDrawer({ task, onClose, onTaskUpdated, workspaceId, userId, userName }: {
  task: Task;
  onClose: () => void;
  onTaskUpdated: (taskId: string) => void;
  workspaceId: string | null;
  userId: string | null;
  userName?: string;
}) {
  const supabase = createClient();
  const [tab, setTab] = useState<DrawerTab>('info');
  const [visible, setVisible] = useState(false);

  // Checklist state
  const [checklist, setChecklist] = useState<ChecklistItem[]>(task.checklist);
  const [newCheckItem, setNewCheckItem] = useState('');
  const [addingCheck, setAddingCheck] = useState(false);

  // Comments state
  const [comments, setComments] = useState<Comment[]>(task.comments);
  const [newComment, setNewComment] = useState('');
  const [sendingComment, setSendingComment] = useState(false);

  // Attachments state
  const [attachments, setAttachments] = useState<Attachment[]>(task.attachments);
  const [uploadingFile, setUploadingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // History state
  const [history, setHistory] = useState<ActivityEntry[]>(task.activity);
  const [loadingHistory, setLoadingHistory] = useState(false);

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
    due_date: task.dueDate ? task.dueDate.slice(0, 16) : '',
    sla: task.sla,
    responsible_name: task.responsible,
  });
  const [savingEdit, setSavingEdit] = useState(false);

  const typeInfo = TASK_TYPE_CONFIG[task.type];
  const priorityInfo = PRIORITY_CONFIG[task.priority];
  const statusInfo = STATUS_CONFIG[task.status];
  const TypeIcon = typeInfo.icon;
  const doneCount = checklist.filter(c => c.done).length;

  useEffect(() => { setVisible(true); }, []);

  // Load relational data from dedicated tables
  useEffect(() => {
    if (!task.id || !workspaceId) return;

    // Load checklist from dedicated table
    supabase.from('task_checklist_items').select('*').eq('tarea_id', task.id).order('position', { ascending: true })
      .then(({ data }) => { if (data && data.length > 0) setChecklist(data.map((r: any) => ({ id: r.id, text: r.text, done: r.done, position: r.position }))); });

    // Load comments from dedicated table
    supabase.from('task_comments').select('*').eq('tarea_id', task.id).order('created_at', { ascending: true })
      .then(({ data }) => { if (data && data.length > 0) setComments(data.map((r: any) => ({ id: r.id, author: r.author_name, avatar: r.author_avatar, text: r.text, date: r.created_at }))); });

    // Load attachments from dedicated table
    supabase.from('task_attachments').select('*').eq('tarea_id', task.id).order('created_at', { ascending: false })
      .then(({ data }) => { if (data && data.length > 0) setAttachments(data.map((r: any) => ({ id: r.id, name: r.name, size: r.size, type: r.file_type, storage_path: r.storage_path }))); });

    // Load history from dedicated table
    supabase.from('task_history').select('*').eq('tarea_id', task.id).order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data && data.length > 0) {
          setHistory(data.map((r: any) => ({ id: r.id, action: r.action, user: r.actor_name, date: r.created_at, icon: ICON_MAP[r.icon_name] || Plus, color: r.color })));
        }
      });

    // Load dependencies
    supabase.from('task_dependencies').select('depends_on_id, tareas!task_dependencies_depends_on_id_fkey(id, title, estado)').eq('tarea_id', task.id)
      .then(({ data }) => {
        if (data && data.length > 0) {
          setDependencies(data.map((r: any) => ({
            id: r.depends_on_id,
            taskId: r.depends_on_id.slice(0, 8).toUpperCase(),
            title: r.tareas?.title || 'Tarea',
            status: (r.tareas?.estado || 'pendiente') as TaskStatus,
          })));
        }
      });

    // Load available tasks for dependency selection
    supabase.from('tareas').select('id, title, estado').eq('workspace_id', workspaceId).neq('id', task.id).limit(30)
      .then(({ data }) => {
        if (data) setAvailableTasks(data.map((r: any) => ({ id: r.id, title: r.title, status: r.estado as TaskStatus })));
      });
  }, [task.id, workspaceId]);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 250);
  };

  // ── Checklist operations ──
  const handleChecklistToggle = async (itemId: string) => {
    const item = checklist.find(c => c.id === itemId);
    if (!item) return;
    const newDone = !item.done;
    setChecklist(prev => prev.map(c => c.id === itemId ? { ...c, done: newDone } : c));

    // Try dedicated table first, fallback to JSONB
    const { error } = await supabase.from('task_checklist_items').update({ done: newDone }).eq('id', itemId);
    if (error) {
      // Fallback: update JSONB in tareas
      const updated = checklist.map(c => c.id === itemId ? { ...c, done: newDone } : c);
      await supabase.from('tareas').update({ checklist: updated }).eq('id', task.id);
    }
    await addHistoryEntry(`Checklist: "${item.text}" marcado como ${newDone ? 'completado' : 'pendiente'}`, 'CheckCircle2', 'text-green-500');
  };

  const handleAddCheckItem = async () => {
    if (!newCheckItem.trim() || !workspaceId) return;
    setAddingCheck(true);
    const newItem = { id: crypto.randomUUID(), text: newCheckItem.trim(), done: false, position: checklist.length };
    setChecklist(prev => [...prev, newItem]);
    setNewCheckItem('');

    // Try dedicated table
    const { error } = await supabase.from('task_checklist_items').insert({
      id: newItem.id, tarea_id: task.id, workspace_id: workspaceId,
      text: newItem.text, done: false, position: newItem.position, created_by: userId,
    });
    if (error) {
      // Fallback: update JSONB
      const updated = [...checklist, newItem];
      await supabase.from('tareas').update({ checklist: updated }).eq('id', task.id);
    }
    setAddingCheck(false);
  };

  const handleDeleteCheckItem = async (itemId: string) => {
    setChecklist(prev => prev.filter(c => c.id !== itemId));
    const { error } = await supabase.from('task_checklist_items').delete().eq('id', itemId);
    if (error) {
      const updated = checklist.filter(c => c.id !== itemId);
      await supabase.from('tareas').update({ checklist: updated }).eq('id', task.id);
    }
  };

  // ── Comment operations ──
  const handleSendComment = async () => {
    if (!newComment.trim() || !workspaceId || !userId) return;
    setSendingComment(true);
    const avatar = (userName || 'YO').slice(0, 2).toUpperCase();
    const newC: Comment = { id: crypto.randomUUID(), author: userName || 'Yo', avatar, text: newComment.trim(), date: new Date().toISOString() };
    setComments(prev => [...prev, newC]);
    setNewComment('');

    const { error } = await supabase.from('task_comments').insert({
      id: newC.id, tarea_id: task.id, workspace_id: workspaceId,
      author_id: userId, author_name: newC.author, author_avatar: avatar, text: newC.text,
    });
    if (error) {
      const updated = [...comments, newC];
      await supabase.from('tareas').update({ comments: updated }).eq('id', task.id);
    }
    await addHistoryEntry(`Comentario agregado por ${userName || 'usuario'}`, 'MessageSquare', 'text-blue-500');
    setSendingComment(false);
  };

  const handleDeleteComment = async (commentId: string) => {
    setComments(prev => prev.filter(c => c.id !== commentId));
    const { error } = await supabase.from('task_comments').delete().eq('id', commentId);
    if (error) {
      const updated = comments.filter(c => c.id !== commentId);
      await supabase.from('tareas').update({ comments: updated }).eq('id', task.id);
    }
  };

  // ── Attachment operations ──
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !workspaceId || !userId) return;
    setUploadingFile(true);

    const newAtt: Attachment = {
      id: crypto.randomUUID(),
      name: file.name,
      size: `${(file.size / 1024).toFixed(0)} KB`,
      type: file.name.split('.').pop()?.toUpperCase() || 'FILE',
    };
    setAttachments(prev => [...prev, newAtt]);

    const { error } = await supabase.from('task_attachments').insert({
      id: newAtt.id, tarea_id: task.id, workspace_id: workspaceId,
      name: newAtt.name, size: newAtt.size, file_type: newAtt.type, uploaded_by: userId,
    });
    if (error) {
      const updated = [...attachments, newAtt];
      await supabase.from('tareas').update({ attachments: updated }).eq('id', task.id);
    }
    await addHistoryEntry(`Adjunto "${file.name}" subido`, 'Paperclip', 'text-amber-500');
    setUploadingFile(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDeleteAttachment = async (attId: string) => {
    setAttachments(prev => prev.filter(a => a.id !== attId));
    const { error } = await supabase.from('task_attachments').delete().eq('id', attId);
    if (error) {
      const updated = attachments.filter(a => a.id !== attId);
      await supabase.from('tareas').update({ attachments: updated }).eq('id', task.id);
    }
  };

  // ── History helper ──
  const addHistoryEntry = async (action: string, iconName: string, color: string) => {
    if (!workspaceId) return;
    const entry = { id: crypto.randomUUID(), action, user: userName || 'Sistema', date: new Date().toISOString(), icon: ICON_MAP[iconName] || Plus, color };
    setHistory(prev => [entry, ...prev]);
    await supabase.from('task_history').insert({
      id: entry.id, tarea_id: task.id, workspace_id: workspaceId,
      action, actor_id: userId, actor_name: userName || 'Sistema', icon_name: iconName, color,
    });
  };

  // ── Dependency operations ──
  const handleAddDependency = async () => {
    if (!selectedDepTask || !workspaceId) return;
    const depTask = availableTasks.find(t => t.id === selectedDepTask);
    if (!depTask) return;
    setAddingDep(true);

    const newDep: Dependency = { id: selectedDepTask, taskId: selectedDepTask.slice(0, 8).toUpperCase(), title: depTask.title, status: depTask.status };
    setDependencies(prev => [...prev, newDep]);
    setSelectedDepTask('');

    const { error } = await supabase.from('task_dependencies').insert({
      tarea_id: task.id, depends_on_id: selectedDepTask, workspace_id: workspaceId,
    });
    if (error) {
      const updated = [...dependencies, newDep];
      await supabase.from('tareas').update({ dependencies: updated }).eq('id', task.id);
    }
    await addHistoryEntry(`Dependencia agregada: "${depTask.title}"`, 'Link2', 'text-purple-500');
    setAddingDep(false);
  };

  const handleRemoveDependency = async (depId: string) => {
    setDependencies(prev => prev.filter(d => d.id !== depId));
    const { error } = await supabase.from('task_dependencies').delete().eq('tarea_id', task.id).eq('depends_on_id', depId);
    if (error) {
      const updated = dependencies.filter(d => d.id !== depId);
      await supabase.from('tareas').update({ dependencies: updated }).eq('id', task.id);
    }
  };

  // ── Edit task ──
  const handleSaveEdit = async () => {
    setSavingEdit(true);
    const { error } = await supabase.from('tareas').update({
      title: editForm.title.trim(),
      description: editForm.description.trim(),
      prioridad: editForm.prioridad,
      estado: editForm.estado,
      riesgo: editForm.riesgo,
      due_date: editForm.due_date || null,
      sla: editForm.sla,
      responsible_name: editForm.responsible_name,
      responsible_avatar: editForm.responsible_name.slice(0, 2).toUpperCase(),
      is_critical: editForm.prioridad === 'critica',
    }).eq('id', task.id);

    if (!error) {
      await addHistoryEntry(`Tarea editada por ${userName || 'usuario'}`, 'Edit2', 'text-blue-500');
      onTaskUpdated(task.id);
      setEditMode(false);
    }
    setSavingEdit(false);
  };

  const tabs: { id: DrawerTab; label: string; icon: React.ElementType; count?: number }[] = [
    { id: 'info',         label: 'General',     icon: FileText },
    { id: 'checklist',    label: 'Checklist',   icon: CheckSquare, count: checklist.length },
    { id: 'comentarios',  label: 'Comentarios', icon: MessageSquare, count: comments.length },
    { id: 'adjuntos',     label: 'Adjuntos',    icon: Paperclip, count: attachments.length },
    { id: 'historial',    label: 'Historial',   icon: History },
    { id: 'dependencias', label: 'Dependencias',icon: Link2, count: dependencies.length },
  ];

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className={`flex-1 bg-black/30 backdrop-blur-sm transition-opacity duration-250 ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={handleClose}
      />
      <div
        className={`bg-white shadow-2xl flex flex-col overflow-hidden transition-transform duration-250 ${visible ? 'translate-x-0' : 'translate-x-full'}`}
        style={{ width: '45%', minWidth: 380, maxWidth: 720 }}
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-border bg-white flex-shrink-0">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${typeInfo.bg} border ${typeInfo.border}`}>
            <TypeIcon size={17} className={typeInfo.color} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <span className="text-[10px] font-mono text-muted-foreground">{task.id.slice(0,8).toUpperCase()}</span>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusInfo.className}`}>{statusInfo.label}</span>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${priorityInfo.className}`}>{priorityInfo.label}</span>
            </div>
            <h2 className="text-sm font-bold text-foreground leading-snug">{task.title}</h2>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => setEditMode(v => !v)}
              className={`p-1.5 rounded-lg transition-colors ${editMode ? 'bg-primary text-white' : 'hover:bg-muted text-muted-foreground hover:text-foreground'}`}
              title="Editar tarea"
            >
              <Edit2 size={14} />
            </button>
            <button onClick={handleClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Tabs — matching mis-participaciones style: text-sm, px-4 py-2 */}
        <div className="flex overflow-x-auto border-b border-border bg-white px-2 gap-0 flex-shrink-0">
          {tabs.map(t => {
            const TIcon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  tab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <TIcon size={13} />
                {t.label}
                {t.count !== undefined && t.count > 0 && (
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${tab === t.id ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">

          {/* ── Info / Edit ── */}
          {tab === 'info' && (
            <div className="space-y-4">
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
                      <label className="block text-xs font-semibold text-foreground mb-1.5">Estado</label>
                      <select value={editForm.estado} onChange={e => setEditForm(f => ({ ...f, estado: e.target.value as TaskStatus }))} className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary/30">
                        {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1.5">Prioridad</label>
                      <select value={editForm.prioridad} onChange={e => setEditForm(f => ({ ...f, prioridad: e.target.value as Priority }))} className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary/30">
                        {Object.entries(PRIORITY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1.5">Riesgo</label>
                      <select value={editForm.riesgo} onChange={e => setEditForm(f => ({ ...f, riesgo: e.target.value as 'alto' | 'medio' | 'bajo' }))} className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary/30">
                        <option value="bajo">Bajo</option>
                        <option value="medio">Medio</option>
                        <option value="alto">Alto</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1.5">SLA</label>
                      <select value={editForm.sla} onChange={e => setEditForm(f => ({ ...f, sla: e.target.value }))} className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary/30">
                        <option value="2h">2 horas</option><option value="4h">4 horas</option><option value="8h">8 horas</option>
                        <option value="24h">24 horas</option><option value="48h">48 horas</option><option value="72h">72 horas</option><option value="7d">7 días</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-foreground mb-1.5">Fecha límite</label>
                    <input type="datetime-local" value={editForm.due_date} onChange={e => setEditForm(f => ({ ...f, due_date: e.target.value }))} className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-foreground mb-1.5">Responsable</label>
                    <input value={editForm.responsible_name} onChange={e => setEditForm(f => ({ ...f, responsible_name: e.target.value }))} className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30" />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button onClick={() => setEditMode(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-border text-foreground hover:bg-muted transition-colors">Cancelar</button>
                    <button onClick={handleSaveEdit} disabled={savingEdit} className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                      {savingEdit ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Save size={14} />}
                      Guardar cambios
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Descripción</p>
                    <p className="text-sm text-foreground leading-relaxed">{task.description || 'Sin descripción.'}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: 'Tipo de tarea',  value: typeInfo.label },
                      { label: 'Estado',         value: statusInfo.label },
                      { label: 'Prioridad',      value: priorityInfo.label },
                      { label: 'Riesgo',         value: RISK_CONFIG[task.risk].label },
                      { label: 'SLA',            value: task.sla },
                      { label: 'Fecha límite',   value: formatDate(task.dueDate) },
                      { label: 'Responsable',    value: task.responsible || '—' },
                      { label: 'Creador',        value: task.creator || '—' },
                      { label: 'Documento',      value: task.documentName || '—' },
                      { label: 'Expediente',     value: task.expedienteName || '—' },
                    ].map(item => (
                      <div key={item.label} className="bg-muted/30 rounded-lg p-2.5">
                        <p className="text-[10px] text-muted-foreground font-semibold mb-0.5">{item.label}</p>
                        <p className="text-xs font-semibold text-foreground truncate" title={item.value}>{item.value}</p>
                      </div>
                    ))}
                  </div>
                  {task.tags.length > 0 && (
                    <div>
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Etiquetas</p>
                      <div className="flex flex-wrap gap-1.5">
                        {task.tags.map(tag => (
                          <span key={tag} className="text-[11px] font-semibold text-primary bg-primary/5 border border-primary/15 px-2.5 py-1 rounded-full">{tag}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Acciones</p>
                    <div className="flex flex-wrap gap-2">
                      <button className="flex items-center gap-1.5 text-xs font-semibold bg-primary text-white px-3 py-2 rounded-lg hover:bg-primary/90 transition-colors">
                        <Play size={12} />{task.mainAction}
                      </button>
                      <button className="flex items-center gap-1.5 text-xs font-semibold bg-white border border-border text-foreground px-3 py-2 rounded-lg hover:bg-muted transition-colors">
                        <Users size={12} />Reasignar
                      </button>
                      <button className="flex items-center gap-1.5 text-xs font-semibold bg-white border border-border text-foreground px-3 py-2 rounded-lg hover:bg-muted transition-colors">
                        <Bell size={12} />Recordatorio
                      </button>
                      <button className="flex items-center gap-1.5 text-xs font-semibold bg-white border border-red-200 text-red-600 px-3 py-2 rounded-lg hover:bg-red-50 transition-colors">
                        <XCircle size={12} />Cancelar
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Checklist ── */}
          {tab === 'checklist' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Progreso</p>
                <span className="text-xs font-bold text-primary">{doneCount}/{checklist.length} completados</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden mb-4">
                <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${checklist.length > 0 ? (doneCount/checklist.length)*100 : 0}%` }} />
              </div>

              {/* Add new item */}
              <div className="flex gap-2 mb-4">
                <input
                  value={newCheckItem}
                  onChange={e => setNewCheckItem(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddCheckItem()}
                  placeholder="Agregar elemento al checklist..."
                  className="flex-1 text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
                <button
                  onClick={handleAddCheckItem}
                  disabled={addingCheck || !newCheckItem.trim()}
                  className="px-3 py-2 bg-primary text-white rounded-lg text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1"
                >
                  {addingCheck ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Plus size={13} />}
                  Agregar
                </button>
              </div>

              {checklist.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckSquare size={28} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Sin elementos en el checklist</p>
                </div>
              )}
              {checklist.map(item => (
                <div key={item.id} className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/30 transition-colors group">
                  <div
                    onClick={() => handleChecklistToggle(item.id)}
                    className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors cursor-pointer ${item.done ? 'bg-primary border-primary' : 'border-border hover:border-primary/50'}`}
                  >
                    {item.done && <CheckCircle2 size={10} className="text-white" />}
                  </div>
                  <span
                    onClick={() => handleChecklistToggle(item.id)}
                    className={`flex-1 text-sm transition-colors cursor-pointer ${item.done ? 'line-through text-muted-foreground' : 'text-foreground'}`}
                  >
                    {item.text}
                  </span>
                  <button
                    onClick={() => handleDeleteCheckItem(item.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-all"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* ── Comentarios ── */}
          {tab === 'comentarios' && (
            <div className="space-y-4">
              {comments.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <MessageSquare size={28} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Sin comentarios aún</p>
                </div>
              )}
              {comments.map(c => (
                <div key={c.id} className="flex gap-3 group">
                  <Avatar initials={c.avatar} size="sm" />
                  <div className="flex-1 bg-muted/30 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-foreground">{c.author}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground">{formatDate(c.date)} {formatTime(c.date)}</span>
                        <button onClick={() => handleDeleteComment(c.id)} className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-all">
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-foreground/80 leading-relaxed">{c.text}</p>
                  </div>
                </div>
              ))}
              <div className="flex gap-2 mt-4 pt-4 border-t border-border">
                <Avatar initials={(userName || 'YO').slice(0, 2).toUpperCase()} size="sm" />
                <div className="flex-1 flex gap-2">
                  <input
                    value={newComment}
                    onChange={e => setNewComment(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSendComment()}
                    placeholder="Escribe un comentario..."
                    className="flex-1 text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                  <button
                    onClick={handleSendComment}
                    disabled={sendingComment || !newComment.trim()}
                    className="px-3 py-2 bg-primary text-white rounded-lg text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {sendingComment ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Send size={13} />}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Adjuntos ── */}
          {tab === 'adjuntos' && (
            <div className="space-y-2">
              <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} />
              {attachments.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <Paperclip size={28} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Sin adjuntos</p>
                </div>
              )}
              {attachments.map(a => (
                <div key={a.id} className="flex items-center gap-3 p-3 border border-border rounded-xl hover:bg-muted/20 transition-colors group">
                  <div className="w-8 h-8 bg-red-50 border border-red-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <FileText size={14} className="text-red-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-foreground truncate">{a.name}</p>
                    <p className="text-[10px] text-muted-foreground">{a.type} · {a.size}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                      <Download size={13} />
                    </button>
                    <button onClick={() => handleDeleteAttachment(a.id)} className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-all">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingFile}
                className="w-full mt-2 flex items-center justify-center gap-2 text-sm font-semibold text-primary border-2 border-dashed border-primary/30 hover:border-primary/60 hover:bg-primary/5 rounded-xl py-3 transition-colors disabled:opacity-50"
              >
                {uploadingFile ? <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" /> : <Upload size={13} />}
                {uploadingFile ? 'Subiendo...' : 'Subir adjunto'}
              </button>
            </div>
          )}

          {/* ── Historial ── */}
          {tab === 'historial' && (
            <div className="space-y-1">
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
                      <p className="text-xs text-foreground leading-snug">{a.action}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{a.user} · {formatDate(a.date)} {formatTime(a.date)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Dependencias ── */}
          {tab === 'dependencias' && (
            <div className="space-y-3">
              {/* Add dependency */}
              <div className="flex gap-2 mb-4">
                <select
                  value={selectedDepTask}
                  onChange={e => setSelectedDepTask(e.target.value)}
                  className="flex-1 text-sm border border-border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                >
                  <option value="">— Seleccionar tarea dependiente —</option>
                  {availableTasks
                    .filter(t => !dependencies.some(d => d.id === t.id))
                    .map(t => (
                      <option key={t.id} value={t.id}>{t.title}</option>
                    ))}
                </select>
                <button
                  onClick={handleAddDependency}
                  disabled={addingDep || !selectedDepTask}
                  className="px-3 py-2 bg-primary text-white rounded-lg text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1"
                >
                  {addingDep ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Plus size={13} />}
                  Agregar
                </button>
              </div>

              {dependencies.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Link2 size={28} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Sin dependencias</p>
                </div>
              ) : (
                dependencies.map(d => {
                  const s = STATUS_CONFIG[d.status] || STATUS_CONFIG['pendiente'];
                  return (
                    <div key={d.id} className="flex items-center gap-3 p-3 border border-border rounded-xl group">
                      <Link2 size={14} className="text-muted-foreground flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-foreground">{d.title}</p>
                        <p className="text-[10px] text-muted-foreground">{d.taskId}</p>
                      </div>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${s.className}`}>{s.label}</span>
                      <button onClick={() => handleRemoveDependency(d.id)} className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-all">
                        <X size={12} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Kanban View ──────────────────────────────────────────────────────────────
function KanbanView({ tasks, onTaskClick }: { tasks: Task[]; onTaskClick: (t: Task) => void }) {
  const columns: { id: TaskStatus; label: string; color: string; bg: string }[] = [
    { id: 'nueva',       label: 'Nueva',       color: 'border-t-blue-500',   bg: 'bg-blue-50/40' },
    { id: 'pendiente',   label: 'Pendiente',   color: 'border-t-amber-400',  bg: 'bg-amber-50/30' },
    { id: 'en_proceso',  label: 'En proceso',  color: 'border-t-cyan-500',   bg: 'bg-cyan-50/30' },
    { id: 'bloqueada',   label: 'Bloqueada',   color: 'border-t-red-500',    bg: 'bg-red-50/20' },
    { id: 'en_revision', label: 'En revisión', color: 'border-t-purple-500', bg: 'bg-purple-50/20' },
    { id: 'escalada',    label: 'Escalada',    color: 'border-t-orange-500', bg: 'bg-orange-50/20' },
  ];

  return (
    <div className="flex gap-3 overflow-x-auto pb-3">
      {columns.map(col => {
        const colTasks = tasks.filter(t => t.status === col.id);
        return (
          <div key={col.id} className={`flex-shrink-0 w-72 rounded-xl border border-border border-t-4 ${col.color} ${col.bg} flex flex-col`} style={{ minHeight: 480 }}>
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm font-bold text-foreground">{col.label}</span>
              <span className="text-xs font-semibold text-muted-foreground bg-white border border-border rounded-full w-6 h-6 flex items-center justify-center">{colTasks.length}</span>
            </div>
            <div className="mx-3 border-t border-dashed border-border/60 mb-2" />
            <div className="flex-1 px-3 pb-3 space-y-2 overflow-y-auto">
              {colTasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-muted-foreground/40">
                  <Inbox size={24} className="mb-1" /><span className="text-xs">Sin tareas</span>
                </div>
              ) : colTasks.map(task => {
                const typeInfo = TASK_TYPE_CONFIG[task.type];
                const TypeIcon = typeInfo.icon;
                const dueInfo = getDueBadge(task);
                return (
                  <div key={task.id} onClick={() => onTaskClick(task)} className="bg-white rounded-lg border border-border p-3 cursor-pointer hover:border-primary/30 hover:shadow-sm transition-all">
                    <div className="flex items-start gap-2 mb-2">
                      <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${typeInfo.bg}`}>
                        <TypeIcon size={11} className={typeInfo.color} />
                      </div>
                      <p className="text-xs font-semibold text-foreground leading-snug line-clamp-2">{task.title}</p>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <Avatar initials={task.responsibleAvatar} size="xs" />
                        <span className="text-[10px] text-muted-foreground truncate max-w-[80px]">{task.responsible.split(' ')[0]}</span>
                      </div>
                      <span className={`text-[10px] font-semibold ${dueInfo.urgent ? 'text-red-600' : 'text-muted-foreground'}`}>{dueInfo.text}</span>
                    </div>
                  </div>
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
function CalendarView({ tasks }: { tasks: Task[] }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth());
  const [today, setToday] = useState(new Date());

  useEffect(() => {
    const n = new Date();
    setToday(n); setYear(n.getFullYear()); setMonth(n.getMonth());
  }, []);

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
    <div className="bg-white rounded-xl border border-border overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border">
        <h3 className="text-sm font-bold text-foreground">{MONTHS_ES[month]} {year}</h3>
        <div className="flex items-center gap-1">
          <button onClick={prev} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"><ChevronLeft size={15} /></button>
          <button onClick={next} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"><ChevronRight size={15} /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 border-b border-border">
        {DAYS_SHORT.map(d => <div key={d} className="py-2 text-center text-[11px] font-bold text-muted-foreground">{d}</div>)}
      </div>
      {rows.map((row, ri) => (
        <div key={ri} className="grid grid-cols-7 border-b border-border last:border-b-0">
          {row.map((cell, ci) => {
            const isToday = isSameDay(cell.date, today);
            const dayTasks = tasks.filter(t => isSameDay(new Date(t.dueDate), cell.date));
            return (
              <div key={ci} className={`min-h-[80px] p-1.5 border-r border-border last:border-r-0 ${!cell.current ? 'bg-muted/20' : ''} ${isToday ? 'bg-primary/5' : ''}`}>
                <div className="flex justify-start mb-1">
                  {isToday
                    ? <span className="w-6 h-6 rounded-full bg-primary text-white text-[11px] font-bold flex items-center justify-center">{cell.date.getDate()}</span>
                    : <span className={`text-[11px] font-medium ${cell.current ? 'text-foreground' : 'text-muted-foreground/50'}`}>{cell.date.getDate()}</span>
                  }
                </div>
                <div className="space-y-0.5">
                  {dayTasks.slice(0, 2).map(t => {
                    const tc = TASK_TYPE_CONFIG[t.type];
                    return <div key={t.id} className={`text-[9px] font-semibold truncate px-1 py-0.5 rounded ${tc.bg} ${tc.color}`}>{t.title}</div>;
                  })}
                  {dayTasks.length > 2 && <span className="text-[9px] text-muted-foreground pl-1">+{dayTasks.length - 2}</span>}
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
    const key = t.documentId || 'sin-documento';
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  });

  return (
    <div className="space-y-3">
      {Object.entries(groups).map(([docId, docTasks]) => {
        const name = docTasks[0]?.documentName || 'Sin documento';
        return (
          <div key={docId} className="bg-white border border-border rounded-xl overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-muted/10">
              <FileText size={15} className="text-primary flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground truncate">{name}</p>
                <p className="text-[11px] text-muted-foreground">{docTasks.length} tarea{docTasks.length !== 1 ? 's' : ''}</p>
              </div>
            </div>
            <div className="divide-y divide-border">
              {docTasks.map(task => {
                const typeInfo = TASK_TYPE_CONFIG[task.type];
                const statusInfo = STATUS_CONFIG[task.status];
                const TypeIcon = typeInfo.icon;
                return (
                  <div key={task.id} onClick={() => onTaskClick(task)} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/20 cursor-pointer transition-colors">
                    <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${typeInfo.bg}`}>
                      <TypeIcon size={11} className={typeInfo.color} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-foreground">{task.title}</p>
                      <p className="text-[10px] text-muted-foreground">{typeInfo.label}</p>
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusInfo.className}`}>{statusInfo.label}</span>
                    <Avatar initials={task.responsibleAvatar} size="xs" />
                  </div>
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
  { id: 'asignadas_por_mi', label: 'Asignadas por mí' },
  { id: 'vencidas',         label: 'Vencidas' },
  { id: 'bloqueadas',       label: 'Bloqueadas' },
  { id: 'criticas',         label: 'Críticas' },
  { id: 'firma',            label: 'Firma' },
  { id: 'revision',         label: 'Revisión' },
  { id: 'anexos',           label: 'Anexos' },
  { id: 'aprobacion',       label: 'Aprobación' },
  { id: 'validacion_id',    label: 'Validación ID' },
  { id: 'efirma_sat',       label: 'e.firma SAT' },
];

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function PendingTasksPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('lista');
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showAutomations, setShowAutomations] = useState(false);
  const [showNewTask, setShowNewTask] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();
  const { user } = useAuth();
  const { workspaces } = useWorkspace();

  const activeWorkspaceId = workspaces?.[0]?.id ?? null;
  const userName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Usuario';

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!user) { setTasks([]); setLoading(false); return; }

      const wsIds = workspaces.map(w => w.id);

      if (wsIds.length === 0) {
        const { data: memberships } = await supabase.from('workspace_members').select('workspace_id').eq('user_id', user.id);
        const memberWsIds = (memberships || []).map((m: any) => m.workspace_id);
        if (memberWsIds.length === 0) { setTasks([]); setLoading(false); return; }

        const { data, error: fetchError } = await supabase.from('tareas').select('*').in('workspace_id', memberWsIds).not('estado', 'in', '(completada,cancelada,rechazada)').order('created_at', { ascending: false });
        if (fetchError) { setError('No se pudieron cargar las tareas.'); return; }
        setTasks((data || []).map(mapRowToTask));
      } else {
        const { data, error: fetchError } = await supabase.from('tareas').select('*').in('workspace_id', wsIds).not('estado', 'in', '(completada,cancelada,rechazada)').order('created_at', { ascending: false });
        if (fetchError) {
          setError(fetchError.code?.startsWith('42') ? 'Error de configuración: ' + fetchError.message : 'No se pudieron cargar las tareas.');
          return;
        }
        setTasks((data || []).map(mapRowToTask));
      }
    } catch {
      setError('Error inesperado al cargar las tareas.');
    } finally {
      setLoading(false);
    }
  }, [user, workspaces]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const handleTaskUpdated = useCallback((taskId: string) => {
    // Refresh the specific task
    supabase.from('tareas').select('*').eq('id', taskId).single().then(({ data }) => {
      if (data) {
        setTasks(prev => prev.map(t => t.id === taskId ? mapRowToTask(data) : t));
        setSelectedTask(prev => prev?.id === taskId ? mapRowToTask(data) : prev);
      }
    });
  }, []);

  const toggleFilter = useCallback((id: string) => {
    setActiveFilters(prev => prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]);
  }, []);

  const filtered = tasks.filter(task => {
    if (search) {
      const q = search.toLowerCase();
      if (!task.title.toLowerCase().includes(q) && !task.documentName.toLowerCase().includes(q) && !task.expedienteName.toLowerCase().includes(q)) return false;
    }
    if (activeFilters.includes('mis_tareas') && user) {
      const isResponsible = task.responsible === user.email || task.responsible === userName;
      if (!isResponsible) return false;
    }
    if (activeFilters.includes('asignadas_por_mi') && user) {
      const isCreator = task.creator === user.email || task.creator === userName;
      if (!isCreator) return false;
    }
    if (activeFilters.includes('vencidas') && !task.isOverdue && task.status !== 'vencida') return false;
    if (activeFilters.includes('bloqueadas') && !task.isBlocked && task.status !== 'bloqueada') return false;
    if (activeFilters.includes('criticas') && !task.isCritical && task.priority !== 'critica') return false;
    if (activeFilters.includes('firma') && task.type !== 'firmar_documento' && task.type !== 'validar_efirma') return false;
    if (activeFilters.includes('revision') && task.type !== 'revisar_documento') return false;
    if (activeFilters.includes('anexos') && task.type !== 'subir_anexo') return false;
    if (activeFilters.includes('aprobacion') && task.type !== 'aprobar_documento') return false;
    if (activeFilters.includes('validacion_id') && task.type !== 'validar_identidad') return false;
    if (activeFilters.includes('efirma_sat') && !task.tags.some(t => t.includes('e.firma'))) return false;
    return true;
  });

  const views: { id: ViewMode; label: string; icon: React.ElementType }[] = [
    { id: 'lista',      label: 'Lista',      icon: List },
    { id: 'kanban',     label: 'Kanban',     icon: LayoutGrid },
    { id: 'calendario', label: 'Calendario', icon: CalendarDays },
    { id: 'documento',  label: 'Documento',  icon: FileText },
  ];

  return (
    <AppLayout noPadding>
      <div className="w-full max-w-none px-4 sm:px-6 lg:px-8 pt-2 pb-4 md:pb-6 min-h-[calc(100vh-8rem)]">

        {/* Page Header — matches mis-participaciones style exactly */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <CheckSquare size={24} className="text-primary" />
              Tareas Pendientes
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Acciones que requieren tu atención · Plataforma de firma digital
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAutomations(v => !v)}
              className={`flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg border transition-colors ${
                showAutomations ? 'bg-primary text-white border-primary' : 'bg-white border-border text-foreground hover:bg-muted'
              }`}
            >
              <Cpu size={15} />Automatizaciones
            </button>
            <button
              onClick={() => setShowNewTask(true)}
              className="flex items-center gap-1.5 text-sm font-semibold bg-primary text-white px-3 py-2 rounded-lg hover:bg-primary/90 transition-colors"
            >
              <Plus size={15} />Nueva tarea
            </button>
          </div>
        </div>

        {/* Metrics */}
        <TaskMetrics tasks={tasks} />

        {/* Automations panel */}
        {showAutomations && (
          <AutomationRulesPanel workspaceId={activeWorkspaceId} userId={user?.id ?? null} />
        )}

        {/* View Tabs + Search — matching mis-participaciones style */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
          {/* View mode buttons — same style as mis-participaciones */}
          <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-xl border border-border">
            {views.map(v => {
              const VIcon = v.icon;
              return (
                <button
                  key={v.id}
                  onClick={() => setViewMode(v.id)}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150 ${
                    viewMode === v.id ? 'bg-primary text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <VIcon size={15} />{v.label}
                </button>
              );
            })}
          </div>
          <div className="relative flex-1 max-w-xs">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Buscar tareas, documentos..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>
          {!loading && filtered.length !== tasks.length && (
            <span className="text-xs text-muted-foreground">{filtered.length} de {tasks.length}</span>
          )}
        </div>

        {/* Divider — matches mis-participaciones */}
        <div className="border-t border-border mb-4" />

        {/* Quick Filters — pill style matching mis-participaciones: px-4 py-1.5 text-sm */}
        <div className="flex flex-wrap items-center gap-2 mb-5">
          {QUICK_FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => toggleFilter(f.id)}
              className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                activeFilters.includes(f.id)
                  ? 'bg-primary text-white border-primary' :'bg-white text-foreground border-border hover:border-primary/50 hover:text-primary'
              }`}
            >
              {activeFilters.includes(f.id) && <X size={11} />}
              {f.label}
            </button>
          ))}
          {activeFilters.length > 0 && (
            <button
              onClick={() => setActiveFilters([])}
              className="px-4 py-1.5 rounded-full text-sm font-medium text-muted-foreground hover:text-foreground border border-dashed border-border hover:border-foreground/30 transition-colors"
            >
              Limpiar filtros
            </button>
          )}
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm text-muted-foreground">Cargando tareas...</p>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex items-start gap-3">
            <AlertCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-700">Error al cargar las tareas</p>
              <p className="text-xs text-red-600 mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {/* Views */}
        {!loading && !error && (
          <>
            {viewMode === 'lista' && (
              filtered.length === 0 ? (
                <div className="bg-white rounded-xl border border-dashed border-border flex flex-col items-center justify-center py-16">
                  <CheckSquare size={32} className="text-muted-foreground/30 mb-3" />
                  <p className="text-sm font-semibold text-foreground">Sin tareas que coincidan</p>
                  <p className="text-xs text-muted-foreground mt-1">Ajusta los filtros o la búsqueda</p>
                  <button
                    onClick={() => setShowNewTask(true)}
                    className="mt-4 flex items-center gap-1.5 text-xs font-semibold bg-primary text-white px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors"
                  >
                    <Plus size={13} />Crear primera tarea
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
                  {filtered.map(task => (
                    <TaskCard key={task.id} task={task} onClick={() => setSelectedTask(task)} />
                  ))}
                </div>
              )
            )}
            {viewMode === 'kanban' && <KanbanView tasks={filtered} onTaskClick={setSelectedTask} />}
            {viewMode === 'calendario' && <CalendarView tasks={filtered} />}
            {viewMode === 'documento' && <DocumentoView tasks={filtered} onTaskClick={setSelectedTask} />}
          </>
        )}

        {!loading && !error && (
          <p className="text-xs text-muted-foreground mt-3 text-right">
            Mostrando {filtered.length} de {tasks.length} tareas
          </p>
        )}
      </div>

      {/* Task Detail Drawer — 45% lateral */}
      {selectedTask && (
        <TaskDetailDrawer
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onTaskUpdated={handleTaskUpdated}
          workspaceId={activeWorkspaceId}
          userId={user?.id ?? null}
          userName={userName}
        />
      )}

      {/* New Task Drawer — 45% lateral */}
      {showNewTask && (
        <NewTaskDrawer
          onClose={() => setShowNewTask(false)}
          onCreated={fetchTasks}
          workspaceId={activeWorkspaceId}
          userId={user?.id ?? null}
          userName={userName}
        />
      )}
    </AppLayout>
  );
}
