'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Users, Search, Plus, Mail, Phone, Trash2, Check, LayoutGrid, List, MoreVertical, Eye, Tag, FileText, ChevronDown, Activity, Edit2, Save, ArrowLeft, Hash, StickyNote, MapPin, X, Pencil, ExternalLink, Shield, ShieldOff, ShieldAlert, AlertTriangle, Bell, Send, PenLine, IdCard, Clock, Archive, Ban, BookOpen, Layers, CheckCircle2, XCircle, AlertCircle, Info, Calendar, User } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import Icon from '@/components/ui/AppIcon';


// ─── Types ────────────────────────────────────────────────────────────────────
interface Contact {
  id: string;
  nombre: string;
  apellido_paterno: string | null;
  apellido_materno: string | null;
  email: string | null;
  telefono: string | null;
  rfc: string | null;
  curp: string | null;
  notas: string | null;
  etiqueta_rol?: string | null;
  tipo_persona?: string | null;
  empresa?: string | null;
  cargo?: string | null;
  direccion?: string | null;
  canal_preferido?: string | null;
  tags?: string[] | null;
  created_at: string;
}

interface ContactNote {
  id: string;
  contact_id: string;
  user_id: string;
  content: string;
  created_at: string;
}

interface ContactCustomField {
  id: string;
  contact_id: string;
  user_id: string;
  field_name: string;
  field_value: string | null;
  created_at: string;
  updated_at: string;
}

interface UserProfile {
  nombre: string | null;
  apellido_paterno: string | null;
  apellido_materno: string | null;
  email: string | null;
  telefono: string | null;
  rfc: string | null;
  curp: string | null;
  personalidad_juridica: string | null;
  regimen_fiscal: string | null;
  codigo_postal: string | null;
  estado: string | null;
  municipio: string | null;
  colonia: string | null;
  localidad: string | null;
  calle: string | null;
  num_exterior: string | null;
  num_interior: string | null;
}

interface ContactFormData {
  nombre: string;
  apellido_paterno: string;
  apellido_materno: string;
  email: string;
  telefono: string;
  rfc: string;
  curp: string;
  tipo_persona: string;
  empresa: string;
  cargo: string;
  direccion: string;
  canal_preferido: string;
}

interface PlatformUser {
  id: string;
  full_name: string;
  email: string;
}

interface RolOption {
  id: string;
  nombre: string;
}

interface SharedDocument {
  id: string;
  nombre: string;
  tipo: string | null;
  estado: string | null;
  created_at: string;
}

const emptyForm: ContactFormData = {
  nombre: '', apellido_paterno: '', apellido_materno: '',
  email: '', telefono: '', rfc: '', curp: '',
  tipo_persona: 'Persona física', empresa: '', cargo: '',
  direccion: '', canal_preferido: 'WhatsApp',
};

const avatarColors = [
  'bg-blue-500', 'bg-violet-500', 'bg-emerald-500',
  'bg-orange-500', 'bg-pink-500', 'bg-teal-500',
];

function getInitials(c: Contact) {
  const parts = [c.nombre, c.apellido_paterno].filter(Boolean);
  return parts.map((p) => p![0].toUpperCase()).join('').slice(0, 2) || 'C';
}

function getFullName(c: Contact) {
  return [c.nombre, c.apellido_paterno, c.apellido_materno].filter(Boolean).join(' ');
}

function Spinner({ size = 'sm' }: { size?: 'sm\' | \'md' }) {
  const s = size === 'sm' ? 'h-3.5 w-3.5' : 'h-5 w-5';
  return (
    <svg className={`animate-spin ${s}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

// ─── Profile Field ────────────────────────────────────────────────────────────
function ProfileField({
  label, value, mono = false, fullWidth = false, icon,
}: {
  label: string; value: string | null | undefined; mono?: boolean; fullWidth?: boolean; icon?: React.ReactNode;
}) {
  return (
    <div className={fullWidth ? 'col-span-2' : ''}>
      <p className="text-[10px] text-gray-400 mb-0.5">{label}</p>
      <div className="border border-gray-200 rounded-md px-3 py-2 bg-white min-h-[34px] flex items-center gap-1.5">
        {icon}
        <span className={`text-sm text-gray-800 ${mono ? 'font-mono' : ''}`}>
          {value || <span className="text-gray-300">—</span>}
        </span>
      </div>
    </div>
  );
}

// ─── Smart Alerts Widget ──────────────────────────────────────────────────────
function SmartAlertsWidget({ contact, userProfile }: { contact: Contact; userProfile: UserProfile | null }) {
  const alerts: { id: string; label: string; desc: string; level: 'error\' | \'warning\' | \'info' }[] = [];

  if (!contact.email) {
    alerts.push({ id: 'no-email', label: 'Correo no verificado', desc: 'No se recomienda enviar documentos legales.', level: 'error' });
  }
  if (!contact.rfc && !userProfile?.rfc) {
    alerts.push({ id: 'no-rfc', label: 'RFC incompleto', desc: 'Faltan datos fiscales.', level: 'warning' });
  }
  if (!userProfile?.curp && !contact.curp) {
    alerts.push({ id: 'no-identity', label: 'Identidad no validada', desc: 'No tiene INE, CURP o e.firma validada.', level: 'warning' });
  }
  if (!contact.telefono && !userProfile?.telefono) {
    alerts.push({ id: 'no-method', label: 'Método de firma no configurado', desc: 'No tiene teléfono o correo válido para OTP.', level: 'warning' });
  }

  const levelConfig = {
    error: { icon: XCircle, bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', iconColor: 'text-red-500' },
    warning: { icon: AlertCircle, bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', iconColor: 'text-amber-500' },
    info: { icon: Info, bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', iconColor: 'text-blue-500' },
  };

  if (alerts.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2">
          <AlertTriangle size={13} className="text-amber-500" />
          <span className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Alertas inteligentes</span>
        </div>
        <div className="px-4 py-4 flex items-center gap-2">
          <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
          <p className="text-xs text-emerald-600 font-medium">Sin alertas activas</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle size={13} className="text-amber-500" />
          <span className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Alertas inteligentes</span>
        </div>
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">{alerts.length}</span>
      </div>
      <div className="px-3 py-3 space-y-2">
        {alerts.map((alert) => {
          const cfg = levelConfig[alert.level];
          const Icon = cfg.icon;
          return (
            <div key={alert.id} className={`flex items-start gap-2 px-3 py-2 rounded-lg border ${cfg.bg} ${cfg.border}`}>
              <Icon size={13} className={`${cfg.iconColor} shrink-0 mt-0.5`} />
              <div>
                <p className={`text-[11px] font-semibold ${cfg.text}`}>{alert.label}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">{alert.desc}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Identity Verification Widget ─────────────────────────────────────────────
function IdentityVerificationWidget({ contact, userProfile }: { contact: Contact; userProfile: UserProfile | null }) {
  const hasCurp = !!(userProfile?.curp || contact.curp);
  const hasRfc = !!(userProfile?.rfc || contact.rfc);
  const hasPhone = !!(userProfile?.telefono || contact.telefono);
  const isVerified = hasCurp && hasRfc;

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2">
        <Shield size={13} className="text-blue-500" />
        <span className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Verificación de identidad</span>
      </div>
      <div className="px-4 py-3">
        <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border ${isVerified ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-200'}`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isVerified ? 'bg-emerald-100' : 'bg-gray-200'}`}>
            {isVerified
              ? <ShieldAlert size={16} className="text-emerald-600" />
              : <ShieldOff size={16} className="text-gray-400" />}
          </div>
          <div>
            <p className={`text-xs font-semibold ${isVerified ? 'text-emerald-700' : 'text-gray-600'}`}>
              {isVerified ? 'Verificado' : 'No verificado'}
            </p>
            <p className="text-[10px] text-gray-400">
              {isVerified ? 'Identidad confirmada' : 'Pendiente de validar identidad'}
            </p>
          </div>
        </div>
        <div className="mt-3 space-y-1.5">
          {[
            { label: 'CURP', ok: hasCurp },
            { label: 'RFC', ok: hasRfc },
            { label: 'Teléfono', ok: hasPhone },
          ].map(({ label, ok }) => (
            <div key={label} className="flex items-center justify-between">
              <span className="text-[11px] text-gray-500">{label}</span>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${ok ? 'text-emerald-600 bg-emerald-50 border-emerald-200' : 'text-gray-400 bg-gray-50 border-gray-200'}`}>
                {ok ? 'Disponible' : 'No cargado'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Recent Documents Widget ───────────────────────────────────────────────────
function RecentDocumentsWidget({ docs, loading }: { docs: SharedDocument[]; loading: boolean }) {
  const recent = [...docs].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 4);

  const estadoColor: Record<string, string> = {
    completado: 'bg-emerald-100 text-emerald-700',
    en_progreso: 'bg-blue-100 text-blue-700',
    en_espera: 'bg-yellow-100 text-yellow-700',
    vencido: 'bg-orange-100 text-orange-700',
    cancelado: 'bg-gray-100 text-gray-500',
    rechazado: 'bg-red-100 text-red-700',
    borrador: 'bg-gray-100 text-gray-600',
  };

  const estadoLabel: Record<string, string> = {
    completado: 'Firmado', en_progreso: 'En progreso', en_espera: 'En espera',
    vencido: 'Vencido', cancelado: 'Cancelado', rechazado: 'Rechazado', borrador: 'Borrador',
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2">
        <Clock size={13} className="text-gray-400" />
        <span className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Recientes</span>
      </div>
      <div className="px-3 py-3">
        {loading ? (
          <div className="flex justify-center py-3"><Spinner /></div>
        ) : recent.length === 0 ? (
          <p className="text-xs text-gray-300 italic text-center py-2">Sin documentos recientes</p>
        ) : (
          <div className="space-y-2">
            {recent.map((doc) => (
              <div key={doc.id} className="flex items-center gap-2 group">
                <FileText size={12} className="text-primary shrink-0" />
                <span className="flex-1 text-[11px] text-gray-700 truncate leading-tight">{doc.nombre}</span>
                <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${estadoColor[doc.estado || ''] || 'bg-gray-100 text-gray-500'}`}>
                  {estadoLabel[doc.estado || ''] || doc.estado || '—'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Quick Actions Panel ───────────────────────────────────────────────────────
function QuickActionsPanel({ contact }: { contact: Contact }) {
  const actions = [
    { icon: Send, label: 'Enviar documento', desc: 'Iniciar flujo de firma', color: 'text-blue-600 bg-blue-50 border-blue-200 hover:bg-blue-100' },
    { icon: PenLine, label: 'Solicitar firma', desc: 'Agregar como firmante', color: 'text-violet-600 bg-violet-50 border-violet-200 hover:bg-violet-100' },
    { icon: IdCard, label: 'Solicitar validación', desc: 'INE, CURP, RFC, selfie', color: 'text-emerald-600 bg-emerald-50 border-emerald-200 hover:bg-emerald-100' },
    { icon: Bell, label: 'Enviar recordatorio', desc: 'Documentos pendientes', color: 'text-amber-600 bg-amber-50 border-amber-200 hover:bg-amber-100' },
    { icon: BookOpen, label: 'Ver expediente', desc: 'Información completa', color: 'text-gray-600 bg-gray-50 border-gray-200 hover:bg-gray-100' },
    { icon: FileText, label: 'Ver documentos', desc: 'Historial de documentos', color: 'text-gray-600 bg-gray-50 border-gray-200 hover:bg-gray-100' },
    { icon: Layers, label: 'Agregar a plantilla', desc: 'Firmante predeterminado', color: 'text-gray-600 bg-gray-50 border-gray-200 hover:bg-gray-100' },
    { icon: Ban, label: 'Bloquear contacto', desc: 'Evitar envío de docs', color: 'text-orange-600 bg-orange-50 border-orange-200 hover:bg-orange-100' },
    { icon: Archive, label: 'Archivar contacto', desc: 'Con auditoría', color: 'text-gray-500 bg-gray-50 border-gray-200 hover:bg-gray-100' },
  ];

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2">
        <Activity size={13} className="text-primary" />
        <span className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Acciones rápidas</span>
      </div>
      <div className="px-3 py-3 space-y-1.5">
        {actions.map(({ icon: Icon, label, desc, color }) => (
          <button
            key={label}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left transition-colors ${color}`}
          >
            <Icon size={13} className="shrink-0" />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold leading-tight">{label}</p>
              <p className="text-[10px] opacity-70 leading-tight">{desc}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── History Timeline ──────────────────────────────────────────────────────────
function HistoryTimeline({ contact, docs, notes }: { contact: Contact; docs: SharedDocument[]; notes: ContactNote[] }) {
  type TimelineEvent = {
    id: string;
    date: string;
    label: string;
    type: 'document' | 'note' | 'contact' | 'system';
  };

  const events: TimelineEvent[] = [];

  // Contact creation
  events.push({
    id: 'created',
    date: contact.created_at,
    label: `Contacto agregado al sistema`,
    type: 'contact',
  });

  // Documents
  docs.forEach((doc) => {
    const stateLabel: Record<string, string> = {
      completado: 'Firmó',
      en_progreso: 'Recibió para firma',
      en_espera: 'Documento en espera de firma',
      vencido: 'Documento vencido sin firma',
      cancelado: 'Documento cancelado',
      rechazado: 'Rechazó',
      borrador: 'Documento en borrador',
    };
    events.push({
      id: `doc-${doc.id}`,
      date: doc.created_at,
      label: `${stateLabel[doc.estado || ''] || 'Documento'}: ${doc.nombre}`,
      type: 'document',
    });
  });

  // Notes
  notes.forEach((note) => {
    events.push({
      id: `note-${note.id}`,
      date: note.created_at,
      label: `Nota registrada: "${note.content.slice(0, 60)}${note.content.length > 60 ? '…' : ''}"`,
      type: 'note',
    });
  });

  // Sort descending
  events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const typeConfig = {
    document: { color: 'bg-blue-500', icon: FileText },
    note: { color: 'bg-amber-400', icon: StickyNote },
    contact: { color: 'bg-emerald-500', icon: User },
    system: { color: 'bg-gray-400', icon: Activity },
  };

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });

  return (
    <div className="p-5">
      <div className="flex items-center gap-2 mb-5">
        <Calendar size={15} className="text-primary" />
        <h3 className="text-sm font-semibold text-gray-800">Línea de tiempo de actividad</h3>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 font-semibold">{events.length}</span>
      </div>
      {events.length === 0 ? (
        <div className="text-center py-12">
          <Clock size={28} className="text-gray-200 mx-auto mb-2" />
          <p className="text-sm text-gray-400">Sin historial registrado.</p>
        </div>
      ) : (
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[15px] top-0 bottom-0 w-px bg-gray-200" />
          <div className="space-y-4">
            {events.map((event) => {
              const cfg = typeConfig[event.type];
              const Icon = cfg.icon;
              return (
                <div key={event.id} className="flex items-start gap-4 relative">
                  <div className={`w-[30px] h-[30px] rounded-full ${cfg.color} flex items-center justify-center shrink-0 z-10 shadow-sm`}>
                    <Icon size={13} className="text-white" />
                  </div>
                  <div className="flex-1 bg-white border border-gray-100 rounded-xl px-4 py-3 shadow-sm">
                    <p className="text-sm text-gray-800 leading-snug">{event.label}</p>
                    <p className="text-[10px] text-gray-400 mt-1 flex items-center gap-1">
                      <Clock size={9} />
                      {formatDate(event.date)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Contact Detail View ──────────────────────────────────────────────────────
function ContactDetailView({
  contact, idx, onClose, onUpdated, onDelete,
}: {
  contact: Contact; idx: number; onClose: () => void; onUpdated: () => void; onDelete: () => void;
}) {
  type Tab = 'destacada' | 'actividades' | 'documentos' | 'notas' | 'historial';
  const [activeTab, setActiveTab] = useState<Tab>('destacada');
  const [roles, setRoles] = useState<RolOption[]>([]);
  const [selectedRol, setSelectedRol] = useState<string>(contact.etiqueta_rol || '');
  const [sharedDocs, setSharedDocs] = useState<SharedDocument[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [docFilter, setDocFilter] = useState<'todos' | 'firmados' | 'pendientes' | 'vencidos' | 'cancelados'>('todos');

  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const [customFields, setCustomFields] = useState<ContactCustomField[]>([]);
  const [loadingFields, setLoadingFields] = useState(false);
  const [addingField, setAddingField] = useState(false);
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldValue, setNewFieldValue] = useState('');
  const [savingField, setSavingField] = useState(false);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [editingFieldValue, setEditingFieldValue] = useState('');

  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState<ContactFormData>({
    nombre: contact.nombre || '',
    apellido_paterno: contact.apellido_paterno || '',
    apellido_materno: contact.apellido_materno || '',
    email: contact.email || '',
    telefono: contact.telefono || '',
    rfc: contact.rfc || '',
    curp: contact.curp || '',
    tipo_persona: contact.tipo_persona || 'Persona física',
    empresa: contact.empresa || '',
    cargo: contact.cargo || '',
    direccion: contact.direccion || '',
    canal_preferido: contact.canal_preferido || 'WhatsApp',
  });
  const [savingEdit, setSavingEdit] = useState(false);

  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);

  const [tags, setTags] = useState<string[]>(contact.tags || []);
  const [newTag, setNewTag] = useState('');
  const [addingTag, setAddingTag] = useState(false);

  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    if (!contact.email) return;
    const loadProfile = async () => {
      setLoadingProfile(true);
      try {
        const { data } = await supabase
          .from('user_profiles')
          .select('nombre, apellido_paterno, apellido_materno, email, telefono, rfc, curp, personalidad_juridica, regimen_fiscal, codigo_postal, estado, municipio, colonia, localidad, calle, num_exterior, num_interior')
          .eq('email', contact.email)
          .maybeSingle();
        if (data) setUserProfile(data);
      } catch { /* silent */ }
      finally { setLoadingProfile(false); }
    };
    loadProfile();
  }, [contact.email]);

  useEffect(() => {
    supabase.from('rol').select('id, nombre').order('nombre').then(({ data }) => {
      if (data) setRoles(data);
    });
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoadingDocs(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !contact.email) return;
        const { data } = await supabase
          .from('documentos')
          .select('id, nombre, tipo, estado, created_at, participantes')
          .eq('user_id', user.id)
          .not('participantes', 'is', null);
        if (data) {
          const filtered = data.filter((doc) => {
            const parts = doc.participantes as Array<{ email?: string }> | null;
            return Array.isArray(parts) && parts.some((p) => p.email === contact.email);
          });
          setSharedDocs(filtered.map((d) => ({
            id: d.id, nombre: d.nombre || 'Sin título',
            tipo: d.tipo, estado: d.estado, created_at: d.created_at,
          })));
        }
      } catch { /* silent */ }
      finally { setLoadingDocs(false); }
    };
    load();
  }, [contact.email]);

  const loadNotes = useCallback(async () => {
    setLoadingNotes(true);
    try {
      const { data } = await supabase
        .from('contact_notes')
        .select('*')
        .eq('contact_id', contact.id)
        .order('created_at', { ascending: false });
      if (data) setNotes(data);
    } catch { /* silent */ }
    finally { setLoadingNotes(false); }
  }, [contact.id]);

  const loadCustomFields = useCallback(async () => {
    setLoadingFields(true);
    try {
      const { data } = await supabase
        .from('contact_custom_fields')
        .select('*')
        .eq('contact_id', contact.id)
        .order('created_at', { ascending: true });
      if (data) setCustomFields(data);
    } catch { /* silent */ }
    finally { setLoadingFields(false); }
  }, [contact.id]);

  useEffect(() => {
    loadNotes();
    loadCustomFields();
  }, [loadNotes, loadCustomFields]);

  const handleSaveNote = async () => {
    if (!newNote.trim()) return;
    setSavingNote(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase.from('contact_notes').insert({
        contact_id: contact.id, user_id: user.id, content: newNote.trim(),
      });
      if (!error) { setNewNote(''); await loadNotes(); }
    } catch { /* silent */ }
    finally { setSavingNote(false); }
  };

  const handleAddCustomField = async () => {
    if (!newFieldName.trim()) return;
    setSavingField(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase.from('contact_custom_fields').insert({
        contact_id: contact.id, user_id: user.id,
        field_name: newFieldName.trim(), field_value: newFieldValue.trim() || null,
      });
      if (!error) {
        setNewFieldName(''); setNewFieldValue(''); setAddingField(false);
        await loadCustomFields();
      }
    } catch { /* silent */ }
    finally { setSavingField(false); }
  };

  const handleUpdateFieldValue = async (fieldId: string) => {
    try {
      await supabase.from('contact_custom_fields').update({ field_value: editingFieldValue }).eq('id', fieldId);
      setEditingFieldId(null);
      await loadCustomFields();
    } catch { /* silent */ }
  };

  const handleDeleteCustomField = async (fieldId: string) => {
    try {
      await supabase.from('contact_custom_fields').delete().eq('id', fieldId);
      await loadCustomFields();
    } catch { /* silent */ }
  };

  const handleSaveEdit = async () => {
    setSavingEdit(true);
    try {
      await supabase.from('contacts').update({
        nombre: editData.nombre.toUpperCase(),
        apellido_paterno: editData.apellido_paterno ? editData.apellido_paterno.toUpperCase() : null,
        apellido_materno: editData.apellido_materno ? editData.apellido_materno.toUpperCase() : null,
        email: editData.email || null, telefono: editData.telefono || null,
        rfc: editData.rfc || null, curp: editData.curp || null,
        tipo_persona: editData.tipo_persona || 'Persona física',
        empresa: editData.empresa || null, cargo: editData.cargo || null,
        direccion: editData.direccion || null, canal_preferido: editData.canal_preferido || 'WhatsApp',
      }).eq('id', contact.id);
      setEditMode(false);
      onUpdated();
    } catch { /* silent */ }
    finally { setSavingEdit(false); }
  };

  const handleAddTag = async () => {
    if (!newTag.trim()) return;
    const updated = [...tags, newTag.trim()];
    await supabase.from('contacts').update({ tags: updated }).eq('id', contact.id);
    setTags(updated); setNewTag(''); setAddingTag(false); onUpdated();
  };

  const handleRemoveTag = async (tag: string) => {
    const updated = tags.filter((t) => t !== tag);
    await supabase.from('contacts').update({ tags: updated }).eq('id', contact.id);
    setTags(updated); onUpdated();
  };

  const firmadosCount = sharedDocs.filter(d => d.estado === 'completado').length;
  const pendientesCount = sharedDocs.filter(d => ['en_progreso', 'en_espera', 'borrador'].includes(d.estado || '')).length;
  const vencidosCount = sharedDocs.filter(d => d.estado === 'vencido').length;
  const canceladosCount = sharedDocs.filter(d => d.estado === 'cancelado').length;

  const filteredDocs = sharedDocs.filter(d => {
    if (docFilter === 'todos') return true;
    if (docFilter === 'firmados') return d.estado === 'completado';
    if (docFilter === 'pendientes') return ['en_progreso', 'en_espera', 'borrador'].includes(d.estado || '');
    if (docFilter === 'vencidos') return d.estado === 'vencido';
    if (docFilter === 'cancelados') return d.estado === 'cancelado';
    return true;
  });

  const estadoBadge = (estado: string | null) => {
    const map: Record<string, { label: string; cls: string }> = {
      borrador: { label: 'Borrador', cls: 'bg-gray-100 text-gray-600' },
      en_progreso: { label: 'En Progreso', cls: 'bg-blue-100 text-blue-700' },
      en_espera: { label: 'En Espera', cls: 'bg-yellow-100 text-yellow-700' },
      completado: { label: 'Firmado', cls: 'bg-emerald-100 text-emerald-700' },
      rechazado: { label: 'Rechazado', cls: 'bg-red-100 text-red-700' },
      cancelado: { label: 'Cancelado', cls: 'bg-gray-100 text-gray-500' },
      vencido: { label: 'Vencido', cls: 'bg-orange-100 text-orange-700' },
    };
    const key = (estado || '').toLowerCase();
    const { label, cls } = map[key] || { label: estado || '—', cls: 'bg-gray-100 text-gray-500' };
    return <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${cls}`}>{label}</span>;
  };

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });

  const formatRelative = (d: string) => {
    const diff = Date.now() - new Date(d).getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'hoy';
    if (days === 1) return 'hace 1 día';
    if (days < 30) return `hace ${days} días`;
    return formatDate(d);
  };

  const tabCount: Record<Tab, number | null> = {
    destacada: null,
    actividades: sharedDocs.length || null,
    documentos: sharedDocs.length || null,
    notas: notes.length || null,
    historial: null,
  };

  return (
    <div className="bg-[#f0f4f8] min-h-screen">
      {/* ── Top Bar (gradient like reference image) ── */}
      <div
        className="sticky top-0 z-20"
        style={{ background: 'linear-gradient(135deg, #dce8f5 0%, #e8eef7 50%, #d8e6f3 100%)' }}
      >
        <div className="px-4 py-3 flex items-center justify-between">
          {/* Left: back + contact info */}
          <div className="flex items-center gap-4">
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors font-medium"
            >
              <ArrowLeft size={15} />
              Contactos
            </button>
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-white text-lg font-bold shrink-0 shadow-md ${avatarColors[idx % avatarColors.length]}`}>
                {getInitials(contact)}
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-base font-bold text-gray-900">{getFullName(contact)}</h1>
                </div>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {contact.email && (
                    <span className="flex items-center gap-1 text-xs text-gray-500">
                      <Mail size={10} />{contact.email}
                    </span>
                  )}
                  {/* Status badges */}
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/70 border border-gray-300 text-gray-600">
                    <ShieldOff size={9} className="text-gray-400" />
                    No verificado
                  </span>
                  {contact.email && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 border border-blue-200 text-blue-700">
                      <Mail size={9} />
                      Correo
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-100 border border-purple-200 text-purple-700">
                    Invitación
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Edit + Delete buttons */}
          <div className="flex items-center gap-2">
            {editMode ? (
              <>
                <button
                  onClick={handleSaveEdit}
                  disabled={savingEdit || !editData.nombre.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 shadow-sm"
                >
                  {savingEdit ? <Spinner /> : <Save size={13} />}
                  Guardar
                </button>
                <button
                  onClick={() => setEditMode(false)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-white/80 border border-gray-300 text-gray-600 rounded-lg text-sm font-medium hover:bg-white transition-colors"
                >
                  <X size={13} />
                  Cancelar
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setEditMode(true)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-white/80 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-white transition-colors shadow-sm"
                >
                  <Edit2 size={13} />
                  Editar
                </button>
                <button
                    onClick={onClose}
                    className="w-9 h-9 flex items-center justify-center bg-white/80 border border-gray-300 text-gray-600 rounded-lg hover:bg-white hover:text-gray-900 transition-colors shadow-sm"
                    title="Cerrar"
                  >
                    <X size={15} />
                  </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Main Content: 30/70 layout ── */}
      <div className="px-4 py-4">
        <div className="grid gap-4" style={{ gridTemplateColumns: '30% 1fr' }}>

          {/* ── LEFT PANEL (30%) ── */}
          <div className="space-y-3">
            {/* Identity Verification */}
            <IdentityVerificationWidget contact={contact} userProfile={userProfile} />

            {/* Smart Alerts */}
            <SmartAlertsWidget contact={contact} userProfile={userProfile} />

            {/* Recent Documents */}
            <RecentDocumentsWidget docs={sharedDocs} loading={loadingDocs} />

            {/* Quick Actions */}
            <QuickActionsPanel contact={contact} />

            {/* Tags */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2">
                <Tag size={12} className="text-gray-400" />
                <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Tags</span>
              </div>
              <div className="px-4 py-3">
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {tags.map((tag) => (
                    <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 border border-gray-200 group">
                      {tag}
                      <button onClick={() => handleRemoveTag(tag)} className="opacity-0 group-hover:opacity-100 transition-opacity ml-0.5">
                        <X size={9} className="text-gray-400 hover:text-red-500" />
                      </button>
                    </span>
                  ))}
                  {selectedRol && !tags.includes(selectedRol) && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                      {selectedRol}
                    </span>
                  )}
                </div>
                {addingTag ? (
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
                      placeholder="Nuevo tag..."
                      className="flex-1 border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
                      autoFocus
                    />
                    <button onClick={handleAddTag} className="px-2 py-1 bg-primary text-white rounded-lg text-xs"><Check size={11} /></button>
                    <button onClick={() => setAddingTag(false)} className="px-2 py-1 border border-gray-200 rounded-lg text-xs text-gray-500"><X size={11} /></button>
                  </div>
                ) : (
                  <button onClick={() => setAddingTag(true)} className="text-[11px] text-primary hover:underline flex items-center gap-0.5">
                    <Plus size={10} /> Agregar tag
                  </button>
                )}
              </div>
            </div>

            {/* Custom Fields */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Hash size={12} className="text-gray-400" />
                  <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Campos personalizados</span>
                </div>
                <button onClick={() => setAddingField(true)} className="text-[11px] text-primary hover:underline flex items-center gap-0.5">
                  <Plus size={10} /> Agregar
                </button>
              </div>
              <div className="px-4 py-3">
                {loadingFields ? (
                  <div className="flex justify-center py-2"><Spinner /></div>
                ) : (
                  <div className="space-y-2">
                    {customFields.map((f) => (
                      <div key={f.id} className="flex items-center justify-between gap-2 group">
                        <span className="text-[11px] text-gray-500 shrink-0">{f.field_name}</span>
                        {editingFieldId === f.id ? (
                          <div className="flex gap-1 flex-1">
                            <input
                              type="text"
                              value={editingFieldValue}
                              onChange={(e) => setEditingFieldValue(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleUpdateFieldValue(f.id)}
                              className="flex-1 border border-gray-200 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
                              autoFocus
                            />
                            <button onClick={() => handleUpdateFieldValue(f.id)} className="text-emerald-600"><Check size={11} /></button>
                            <button onClick={() => setEditingFieldId(null)} className="text-gray-400"><X size={11} /></button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 flex-1 justify-end">
                            <span className="text-xs font-semibold text-gray-800 text-right">{f.field_value || <span className="text-gray-300 italic">—</span>}</span>
                            <button onClick={() => { setEditingFieldId(f.id); setEditingFieldValue(f.field_value || ''); }} className="opacity-0 group-hover:opacity-100 transition-opacity">
                              <Pencil size={10} className="text-gray-400 hover:text-primary" />
                            </button>
                            <button onClick={() => handleDeleteCustomField(f.id)} className="opacity-0 group-hover:opacity-100 transition-opacity">
                              <X size={10} className="text-gray-400 hover:text-red-500" />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                    {customFields.length === 0 && !addingField && (
                      <p className="text-xs text-gray-300 italic">Sin campos personalizados</p>
                    )}
                    {addingField && (
                      <div className="border border-dashed border-gray-200 rounded-lg p-2.5 space-y-2 mt-2">
                        <input
                          type="text"
                          value={newFieldName}
                          onChange={(e) => setNewFieldName(e.target.value)}
                          placeholder="Nombre del campo"
                          className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
                          autoFocus
                        />
                        <input
                          type="text"
                          value={newFieldValue}
                          onChange={(e) => setNewFieldValue(e.target.value)}
                          placeholder="Valor"
                          className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
                        />
                        <div className="flex gap-1.5">
                          <button
                            onClick={handleAddCustomField}
                            disabled={savingField || !newFieldName.trim()}
                            className="flex items-center gap-1 px-2.5 py-1 bg-primary text-white rounded text-xs disabled:opacity-50"
                          >
                            {savingField ? <Spinner /> : <Check size={11} />}
                            Guardar
                          </button>
                          <button onClick={() => { setAddingField(false); setNewFieldName(''); setNewFieldValue(''); }} className="px-2.5 py-1 border border-gray-200 rounded text-xs text-gray-500">
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── RIGHT PANEL (70%) ── */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            {/* Tabs */}
            <div className="border-b border-gray-200 flex items-center overflow-x-auto bg-white">
              {([
                { key: 'destacada', label: 'Información destacada' },
                { key: 'actividades', label: 'Actividades' },
                { key: 'documentos', label: 'Documentos' },
                { key: 'notas', label: 'Notas' },
                { key: 'historial', label: 'Historial' },
              ] as { key: Tab; label: string }[]).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap flex items-center gap-1.5 ${
                    activeTab === key ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {label}
                  {tabCount[key] !== null && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${activeTab === key ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-gray-500'}`}>
                      {tabCount[key]}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* ── Tab: Información destacada ── */}
            {activeTab === 'destacada' && (
              <div className="p-5">
                {editMode ? (
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                      <Edit2 size={14} className="text-primary" />
                      Editar información del contacto
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {[
                        { label: 'Nombre *', key: 'nombre' },
                        { label: 'Apellido Paterno', key: 'apellido_paterno' },
                        { label: 'Apellido Materno', key: 'apellido_materno' },
                        { label: 'Correo Electrónico', key: 'email' },
                        { label: 'Teléfono', key: 'telefono' },
                        { label: 'RFC', key: 'rfc' },
                      ].map(({ label, key }) => (
                        <div key={key}>
                          <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                          <input
                            type="text"
                            value={editData[key as keyof ContactFormData]}
                            onChange={(e) => setEditData({ ...editData, [key]: e.target.value })}
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                          />
                        </div>
                      ))}
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-medium text-gray-600 mb-1">CURP</label>
                        <input
                          type="text"
                          value={editData.curp}
                          onChange={(e) => setEditData({ ...editData, curp: e.target.value })}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Tipo de persona</label>
                        <select
                          value={editData.tipo_persona}
                          onChange={(e) => setEditData({ ...editData, tipo_persona: e.target.value })}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                        >
                          <option>Persona física</option>
                          <option>Persona moral</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Empresa</label>
                        <input
                          type="text"
                          value={editData.empresa}
                          onChange={(e) => setEditData({ ...editData, empresa: e.target.value })}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Cargo</label>
                        <input
                          type="text"
                          value={editData.cargo}
                          onChange={(e) => setEditData({ ...editData, cargo: e.target.value })}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <label className="block text-xs font-medium text-gray-600 mb-1">Dirección</label>
                        <input
                          type="text"
                          value={editData.direccion}
                          onChange={(e) => setEditData({ ...editData, direccion: e.target.value })}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Canal preferido</label>
                        <select
                          value={editData.canal_preferido}
                          onChange={(e) => setEditData({ ...editData, canal_preferido: e.target.value })}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                        >
                          <option>WhatsApp</option>
                          <option>Email</option>
                          <option>SMS</option>
                        </select>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {loadingProfile ? (
                      <div className="flex justify-center py-8"><Spinner size="md" /></div>
                    ) : (
                      <>
                        <div>
                          <h4 className="text-xs font-semibold text-blue-600 flex items-center gap-1.5 mb-3">
                            <Users size={13} />
                            Datos de Identidad
                          </h4>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                            <ProfileField label="Tipo de Persona" value={userProfile?.personalidad_juridica || contact.tipo_persona} />
                            <ProfileField label="CURP" value={userProfile?.curp || contact.curp} mono />
                            <ProfileField label="Nombre" value={userProfile?.nombre || contact.nombre} />
                            <ProfileField label="Apellido Paterno" value={userProfile?.apellido_paterno || contact.apellido_paterno} />
                            <ProfileField label="Apellido Materno" value={userProfile?.apellido_materno || contact.apellido_materno} />
                            <ProfileField
                              label="Nombre Completo / Razón Social"
                              value={userProfile ? [userProfile.nombre, userProfile.apellido_paterno, userProfile.apellido_materno].filter(Boolean).join(' ') : getFullName(contact)}
                            />
                            <ProfileField label="Correo Electrónico" value={userProfile?.email || contact.email} icon={<Mail size={11} className="text-gray-400" />} />
                            <ProfileField label="Número de Teléfono" value={userProfile?.telefono || contact.telefono} icon={<Phone size={11} className="text-gray-400" />} />
                          </div>
                        </div>
                        <div>
                          <h4 className="text-xs font-semibold text-blue-600 flex items-center gap-1.5 mb-3">
                            <FileText size={13} />
                            Datos Fiscales
                          </h4>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                            <ProfileField label="RFC" value={userProfile?.rfc || contact.rfc} mono />
                            <ProfileField label="Régimen Fiscal" value={userProfile?.regimen_fiscal} />
                          </div>
                        </div>
                        <div>
                          <h4 className="text-xs font-semibold text-blue-600 flex items-center gap-1.5 mb-3">
                            <MapPin size={13} />
                            Domicilio Fiscal
                          </h4>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                            <ProfileField label="Código Postal" value={userProfile?.codigo_postal} fullWidth />
                            <ProfileField label="Estado" value={userProfile?.estado} />
                            <ProfileField label="Municipio o Alcaldía" value={userProfile?.municipio} />
                            <ProfileField label="Colonia" value={userProfile?.colonia} />
                            <ProfileField label="Localidad" value={userProfile?.localidad} />
                            <ProfileField label="Calle" value={userProfile?.calle} fullWidth />
                            <ProfileField label="Número Exterior" value={userProfile?.num_exterior} />
                            <ProfileField label="Número Interior (Opcional)" value={userProfile?.num_interior} />
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── Tab: Actividades ── */}
            {activeTab === 'actividades' && (
              <div className="p-5 space-y-3">
                {loadingDocs ? (
                  <div className="flex justify-center py-12"><Spinner size="md" /></div>
                ) : sharedDocs.length === 0 ? (
                  <div className="text-center py-12">
                    <Activity size={28} className="text-gray-200 mx-auto mb-2" />
                    <p className="text-sm text-gray-400">Sin actividad registrada.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {sharedDocs.map((doc) => (
                      <div key={doc.id} className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0">
                        <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${doc.estado === 'completado' ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-800 font-medium leading-tight">{doc.nombre}</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {doc.estado === 'completado' ? 'Documento firmado' : 'Documento en proceso'} · {formatDate(doc.created_at)}
                          </p>
                        </div>
                        {estadoBadge(doc.estado)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Tab: Documentos ── */}
            {activeTab === 'documentos' && (
              <div className="p-5">
                <div className="flex items-center gap-1.5 mb-4 flex-wrap">
                  {([
                    { key: 'todos', label: `Todos (${sharedDocs.length})` },
                    { key: 'firmados', label: `Firmados (${firmadosCount})` },
                    { key: 'pendientes', label: `Pendientes (${pendientesCount})` },
                    { key: 'vencidos', label: `Vencidos (${vencidosCount})` },
                    { key: 'cancelados', label: `Cancelados (${canceladosCount})` },
                  ] as { key: typeof docFilter; label: string }[]).map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => setDocFilter(key)}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                        docFilter === key ? 'bg-primary text-white border-primary' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {loadingDocs ? (
                  <div className="flex justify-center py-12"><Spinner size="md" /></div>
                ) : filteredDocs.length === 0 ? (
                  <div className="text-center py-12">
                    <FileText size={28} className="text-gray-200 mx-auto mb-2" />
                    <p className="text-sm text-gray-400">Sin documentos en esta categoría.</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {filteredDocs.map((doc) => (
                      <div key={doc.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 transition-colors group">
                        <FileText size={14} className="text-primary shrink-0" />
                        <span className="flex-1 text-sm text-primary font-medium truncate">{doc.nombre}</span>
                        {estadoBadge(doc.estado)}
                        <span className="text-xs text-gray-400 shrink-0">{formatDate(doc.created_at)}</span>
                        <button className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-gray-400 hover:text-primary flex items-center gap-0.5">
                          Ver <ExternalLink size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Tab: Notas ── */}
            {activeTab === 'notas' && (
              <div className="p-5 space-y-4">
                {loadingNotes ? (
                  <div className="flex justify-center py-8"><Spinner size="md" /></div>
                ) : notes.length > 0 ? (
                  <div className="space-y-3">
                    {notes.map((n) => (
                      <div key={n.id} className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-gray-600">Nota interna</span>
                          <span className="text-[10px] text-gray-400">{formatRelative(n.created_at)}</span>
                        </div>
                        <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{n.content}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6">
                    <StickyNote size={24} className="text-gray-200 mx-auto mb-2" />
                    <p className="text-sm text-gray-400">Sin notas registradas para este contacto.</p>
                  </div>
                )}
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                    <span className="text-xs font-semibold text-gray-600">Agregar nota</span>
                  </div>
                  <div className="p-4">
                    <textarea
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      placeholder="Escribe una nota sobre este contacto..."
                      rows={4}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none bg-white"
                    />
                    <div className="flex justify-end mt-2">
                      <button
                        onClick={handleSaveNote}
                        disabled={!newNote.trim() || savingNote}
                        className="flex items-center gap-1.5 px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                      >
                        {savingNote ? <Spinner /> : <Check size={13} />}
                        Guardar nota
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Tab: Historial ── */}
            {activeTab === 'historial' && (
              <HistoryTimeline contact={contact} docs={sharedDocs} notes={notes} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Search Platform Users Modal ──────────────────────────────────────────────
function SearchUserModal({
  onClose, onSave, existingEmails,
}: {
  onClose: () => void; onSave: () => void; existingEmails: string[];
}) {
  const [searchCriteria, setSearchCriteria] = useState<'correo' | 'rfc' | 'curp' | 'telefono'>('correo');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlatformUser[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const criteriaPlaceholders: Record<string, string> = {
    correo: 'Ingresa Correo Electrónico...',
    rfc: 'Ingresa el RFC...',
    curp: 'Ingresa el CURP...',
    telefono: 'Ingresa el número de teléfono...',
  };

  const performSearch = async (q: string, criteria: string) => {
    if (!q.trim()) { setResults([]); setSearched(false); setIsSearching(false); return; }
    setIsSearching(true); setSearched(true);
    try {
      const res = await fetch(`/api/documentos/buscar-participante?q=${encodeURIComponent(q.trim())}&criteria=${criteria}`);
      const data = await res.json();
      setResults(data.users || []);
    } catch { setResults([]); }
    finally { setIsSearching(false); }
  };

  const handleSearch = () => performSearch(query, searchCriteria);
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') handleSearch(); };

  const handleAddContact = async (u: PlatformUser) => {
    setSaving(u.id); setError(null);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No autenticado');
      const { data: existing } = await supabase.from('contacts').select('id').eq('user_id', user.id).eq('email', u.email).maybeSingle();
      if (existing) { setSaved((prev) => [...prev, u.id]); return; }
      const nameParts = (u.full_name || u.email).split(' ');
      const { error: err } = await supabase.from('contacts').insert({
        user_id: user.id,
        nombre: (nameParts[0] || u.email).toUpperCase(),
        apellido_paterno: nameParts[1] ? nameParts[1].toUpperCase() : null,
        apellido_materno: nameParts[2] ? nameParts[2].toUpperCase() : null,
        email: u.email,
      });
      if (err) throw err;
      setSaved((prev) => [...prev, u.id]);
      onSave();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al agregar el contacto.');
    } finally { setSaving(null); }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const userAvatarColors = ['bg-blue-500', 'bg-violet-500', 'bg-emerald-500', 'bg-orange-500', 'bg-pink-500', 'bg-teal-500'];
  const getInitialsFromUser = (name: string) =>
    name.split(' ').filter(Boolean).slice(0, 2).map((n) => n[0].toUpperCase()).join('') || 'U';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col" style={{ maxHeight: '90vh' }}>
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">Nuevo Contacto</h2>
          <p className="text-sm text-gray-400 mt-1">Busca un usuario registrado en la plataforma para agregarlo a tus contactos.</p>
        </div>
        <div className="px-6 pt-4 shrink-0">
          <div className="flex items-center gap-2">
            <div className="relative">
              <select
                value={searchCriteria}
                onChange={(e) => setSearchCriteria(e.target.value as 'correo' | 'rfc' | 'curp' | 'telefono')}
                className="appearance-none border border-gray-200 rounded-lg pl-3 pr-7 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white cursor-pointer"
              >
                <option value="correo">Correo Electrónico</option>
                <option value="rfc">RFC</option>
                <option value="curp">CURP</option>
                <option value="telefono">Teléfono</option>
              </select>
              <ChevronDown size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-400" />
            </div>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={criteriaPlaceholders[searchCriteria]}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <button onClick={handleSearch} className="w-10 h-10 flex items-center justify-center bg-primary hover:bg-primary/90 text-white rounded-lg transition-colors shrink-0">
              <Search size={16} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 min-h-[200px]">
          {error && <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600 mb-3">{error}</div>}
          {isSearching ? (
            <div className="flex items-center justify-center py-12"><Spinner size="md" /></div>
          ) : !searched ? (
            <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
              <Search size={14} className="shrink-0" />
              Realiza una búsqueda para encontrar participantes en la plataforma.
            </div>
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2">
              <Users size={28} className="text-gray-300" />
              <p className="text-sm text-gray-400">No se encontraron usuarios registrados.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {results.map((u, idx) => {
                const isSaved = saved.includes(u.id);
                const isAlreadyContact = existingEmails.includes(u.email);
                const isSaving = saving === u.id;
                return (
                  <div key={u.id} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0 ${userAvatarColors[idx % userAvatarColors.length]}`}>
                      {getInitialsFromUser(u.full_name || u.email)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{u.full_name || u.email}</p>
                      <p className="text-xs text-gray-400 truncate">{u.email}</p>
                    </div>
                    <button
                      onClick={() => handleAddContact(u)}
                      disabled={isSaved || isAlreadyContact || isSaving}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0 ${
                        isSaved || isAlreadyContact
                          ? 'bg-emerald-50 text-emerald-600 border border-emerald-200 cursor-default' :'bg-primary hover:bg-primary/90 text-white'
                      } disabled:opacity-60`}
                    >
                      {isSaving ? <Spinner /> : isSaved || isAlreadyContact ? <Check size={13} /> : <Plus size={13} />}
                      {isSaved || isAlreadyContact ? 'Agregado' : 'Agregar'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end">
          <button onClick={onClose} className="px-5 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Contact Card ──────────────────────────────────────────────────────────────
function ContactCard({ contact, idx, onView, onDelete, deleting }: {
  contact: Contact; idx: number; onView: () => void; onDelete: () => void; deleting: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow relative group">
      <div className="flex items-start justify-between mb-4">
        <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white text-base font-bold shrink-0 ${avatarColors[idx % avatarColors.length]}`}>
          {getInitials(contact)}
        </div>
        <div className="relative">
          <button onClick={() => setMenuOpen(!menuOpen)} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors opacity-0 group-hover:opacity-100">
            <MoreVertical size={15} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-9 z-10 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[140px]">
              <button onClick={() => { setMenuOpen(false); onView(); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
                <Eye size={13} /> Ver Contacto
              </button>
              <button onClick={() => { setMenuOpen(false); onDelete(); }} disabled={deleting} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50">
                <Trash2 size={13} /> Eliminar
              </button>
            </div>
          )}
        </div>
      </div>
      <p className="font-semibold text-gray-900 text-sm leading-tight mb-0.5">{getFullName(contact)}</p>
      {contact.etiqueta_rol && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20 mb-2">
          <Tag size={9} />{contact.etiqueta_rol}
        </span>
      )}
      {contact.rfc && <p className="text-xs text-gray-400 mb-3">RFC: {contact.rfc}</p>}
      {!contact.rfc && <div className="mb-3" />}
      <div className="space-y-1.5">
        {contact.email && (
          <div className="flex items-center gap-2 text-gray-500">
            <Mail size={12} className="shrink-0 text-gray-400" />
            <span className="text-xs truncate">{contact.email}</span>
          </div>
        )}
        {contact.telefono && (
          <div className="flex items-center gap-2 text-gray-500">
            <Phone size={12} className="shrink-0 text-gray-400" />
            <span className="text-xs">{contact.telefono}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function ContactosPage() {
  const { user } = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [viewingContact, setViewingContact] = useState<{ contact: Contact; idx: number } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');

  const loadContacts = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .eq('user_id', user.id)
        .order('nombre', { ascending: true });
      if (!error && data) setContacts(data);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => { loadContacts(); }, [loadContacts]);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const supabase = createClient();
      await supabase.from('contacts').delete().eq('id', id);
      setContacts((prev) => prev.filter((c) => c.id !== id));
      if (viewingContact?.contact.id === id) setViewingContact(null);
    } catch { /* silent */ }
    finally { setDeletingId(null); }
  };

  const filtered = contacts.filter((c) => {
    const q = search.toLowerCase();
    const fullName = [c.nombre, c.apellido_paterno, c.apellido_materno].filter(Boolean).join(' ').toLowerCase();
    return fullName.includes(q) || (c.email || '').toLowerCase().includes(q) || (c.telefono || '').toLowerCase().includes(q) || (c.rfc || '').toLowerCase().includes(q);
  });

  const existingEmails = contacts.map((c) => c.email).filter(Boolean) as string[];

  if (viewingContact) {
    return (
      <AppLayout noPadding>
        <ContactDetailView
          contact={viewingContact.contact}
          idx={viewingContact.idx}
          onClose={() => setViewingContact(null)}
          onUpdated={loadContacts}
          onDelete={() => handleDelete(viewingContact.contact.id)}
        />
      </AppLayout>
    );
  }

  return (
    <AppLayout noPadding>
      <div className="px-4 sm:px-6 lg:px-8 pt-2 pb-4 md:pb-6 w-full min-h-[calc(100vh-8rem)]">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Users size={24} className="text-primary" />
              Contactos
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Gestiona tu agenda de contactos y su historial de documentos.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center border border-border rounded-lg overflow-hidden bg-white shadow-sm">
              <button onClick={() => setViewMode('grid')} className={`w-9 h-9 flex items-center justify-center transition-colors ${viewMode === 'grid' ? 'bg-muted/60 text-foreground' : 'text-muted-foreground hover:text-foreground'}`} title="Vista cuadrícula">
                <LayoutGrid size={16} />
              </button>
              <button onClick={() => setViewMode('list')} className={`w-9 h-9 flex items-center justify-center transition-colors ${viewMode === 'list' ? 'bg-muted/60 text-foreground' : 'text-muted-foreground hover:text-foreground'}`} title="Vista lista">
                <List size={16} />
              </button>
            </div>
            <div className="relative w-64">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nombre, email o RFC..."
                className="w-full border border-border rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white shadow-sm"
              />
            </div>
            <button
              onClick={() => setShowSearchModal(true)}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
            >
              <Plus size={14} />
              Agregar Contacto
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-32">
            <svg className="animate-spin h-8 w-8 text-primary" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 gap-4">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
              <Users size={28} className="text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="text-base font-semibold text-foreground mb-1">{search ? 'Sin resultados' : 'Tu agenda de contactos está vacía'}</p>
              <p className="text-sm text-muted-foreground max-w-xs">
                {search ? 'Intenta con otro término de búsqueda.' : 'Comienza agregando tu primer contacto para agilizar tus flujos de firma.'}
              </p>
            </div>
            {!search && (
              <button onClick={() => setShowSearchModal(true)} className="flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-lg text-sm font-medium transition-colors shadow-sm">
                <Plus size={15} /> Agregar Contacto
              </button>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
            {filtered.map((c, idx) => (
              <ContactCard key={c.id} contact={c} idx={idx} onView={() => setViewingContact({ contact: c, idx })} onDelete={() => handleDelete(c.id)} deleting={deletingId === c.id} />
            ))}
          </div>
        ) : (
          <div className="bg-white border border-border rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Contacto</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Etiqueta</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Correo</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Teléfono</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">RFC</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, idx) => (
                  <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0 ${avatarColors[idx % avatarColors.length]}`}>
                          {getInitials(c)}
                        </div>
                        <p className="font-semibold text-foreground">{getFullName(c)}</p>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      {c.etiqueta_rol ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                          <Tag size={10} />{c.etiqueta_rol}
                        </span>
                      ) : <span className="text-muted-foreground text-sm">—</span>}
                    </td>
                    <td className="px-5 py-3.5">
                      {c.email ? (
                        <div className="flex items-center gap-1.5 text-foreground">
                          <Mail size={13} className="text-muted-foreground shrink-0" />
                          <span className="text-sm">{c.email}</span>
                        </div>
                      ) : <span className="text-muted-foreground text-sm">—</span>}
                    </td>
                    <td className="px-5 py-3.5">
                      {c.telefono ? (
                        <div className="flex items-center gap-1.5 text-foreground">
                          <Phone size={13} className="text-muted-foreground shrink-0" />
                          <span className="text-sm">{c.telefono}</span>
                        </div>
                      ) : <span className="text-muted-foreground text-sm">—</span>}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-sm text-foreground">{c.rfc || <span className="text-muted-foreground">—</span>}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setViewingContact({ contact: c, idx })} className="w-8 h-8 flex items-center justify-center rounded-lg text-primary bg-primary/5 hover:bg-primary/10 transition-colors border border-primary/20" title="Ver contacto">
                          <Eye size={14} />
                        </button>
                        <button onClick={() => handleDelete(c.id)} disabled={deletingId === c.id} className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50" title="Eliminar contacto">
                          {deletingId === c.id ? <Spinner /> : <Trash2 size={14} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {showSearchModal && (
          <SearchUserModal
            onClose={() => setShowSearchModal(false)}
            onSave={loadContacts}
            existingEmails={existingEmails}
          />
        )}
      </div>
    </AppLayout>
  );
}
