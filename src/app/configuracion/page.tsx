'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import AppLayout from '@/components/AppLayout';
import { Bell, Globe, Users, ShieldCheck, Key, Palette, Check, Mail, Smartphone, Loader2, Plus, Trash2, Copy, Webhook, Eye, EyeOff, AlertCircle, CheckCircle, Clock, Filter, Download, Building2, Lock, Edit3, X, Save, Activity, Image, Upload, Search, Info, Zap, Globe2, Link2, Fingerprint,  } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { createClient } from '@/lib/supabase/client';

// ─── Types ────────────────────────────────────────────────────────────────────

type Section = 'delegacion' | 'auditoria' | 'integraciones' | 'regional' | 'notificaciones' | 'almacenamiento';

interface ToggleProps {
  enabled: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}

interface ApiKey {
  id: string;
  name: string;
  key: string;
  created_at: string;
  last_used?: string | null;
  is_active: boolean;
  workspace_id: string;
}

interface WebhookConfig {
  id: string;
  name: string;
  url: string;
  events: string[];
  is_active: boolean;
  created_at: string;
  workspace_id: string;
}

interface PermissionProfile {
  id: string;
  name: string;
  description: string;
  permissions: Record<string, boolean>;
  workspace_id: string;
  created_at: string;
}

interface AuditEvent {
  id: string;
  event_type: string;
  user_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  metadata?: Record<string, unknown> | null;
}

interface RegionalSettings {
  timezone: string;
  date_format: string;
  workspace_logo_url: string | null;
  brand_primary_color: string;
  brand_email_header: string;
  portal_name: string;
}

// ─── Toggle Switch ────────────────────────────────────────────────────────────

function ToggleSwitch({ enabled, onChange, disabled }: ToggleProps) {
  return (
    <button
      onClick={() => !disabled && onChange(!enabled)}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${enabled ? 'bg-primary' : 'bg-gray-200'}`}
    >
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-1'}`} />
    </button>
  );
}

// ─── Permission definitions ───────────────────────────────────────────────────

const PERMISSION_MODULES = [
  { key: 'usuarios', label: 'Usuarios y Grupos', description: 'Crear, editar y eliminar usuarios del workspace' },
  { key: 'documentos', label: 'Documentos', description: 'Gestión completa de documentos' },
  { key: 'firmas', label: 'Firmas', description: 'Configurar y gestionar flujos de firma' },
  { key: 'reportes', label: 'Reportes', description: 'Ver reportes y estadísticas' },
  { key: 'auditoria', label: 'Auditoría', description: 'Acceso al log de auditoría' },
  { key: 'integraciones', label: 'Integraciones', description: 'Gestionar API keys y webhooks' },
  { key: 'facturacion', label: 'Facturación', description: 'Ver y gestionar planes y pagos' },
  { key: 'marca', label: 'Marca Blanca', description: 'Configurar logo y colores del workspace' },
];

const WEBHOOK_EVENTS = [
  { key: 'document.signed', label: 'Documento firmado' },
  { key: 'document.completed', label: 'Documento completado' },
  { key: 'document.rejected', label: 'Documento rechazado' },
  { key: 'document.expired', label: 'Documento vencido' },
  { key: 'participant.signed', label: 'Participante firmó' },
  { key: 'participant.invited', label: 'Participante invitado' },
  { key: 'user.enrolled', label: 'Usuario enrolado' },
];

const TIMEZONES = [
  { value: 'America/Mexico_City', label: 'Ciudad de México (UTC-6)' },
  { value: 'America/Monterrey', label: 'Monterrey (UTC-6)' },
  { value: 'America/Cancun', label: 'Cancún (UTC-5)' },
  { value: 'America/Chihuahua', label: 'Chihuahua (UTC-7)' },
  { value: 'America/Tijuana', label: 'Tijuana (UTC-8)' },
  { value: 'America/New_York', label: 'Nueva York (UTC-5)' },
  { value: 'America/Los_Angeles', label: 'Los Ángeles (UTC-8)' },
  { value: 'Europe/Madrid', label: 'Madrid (UTC+1)' },
];

const DATE_FORMATS = [
  { value: 'DD/MM/YYYY', label: 'DD/MM/AAAA (31/12/2025)' },
  { value: 'MM/DD/YYYY', label: 'MM/DD/AAAA (12/31/2025)' },
  { value: 'YYYY-MM-DD', label: 'AAAA-MM-DD (2025-12-31)' },
  { value: 'D [de] MMMM [de] YYYY', label: '31 de diciembre de 2025' },
];

// ─── Sidebar items ────────────────────────────────────────────────────────────

const sidebarItems: { id: Section; label: string; icon: React.ElementType; description: string }[] = [
  { id: 'notificaciones', label: 'Notificaciones', icon: Bell, description: 'Canales, eventos y frecuencia de alertas' },
  { id: 'delegacion', label: 'Delegación y Roles', icon: Users, description: 'Perfiles de permisos granulares por workspace' },
  { id: 'auditoria', label: 'Auditoría y Reportes', icon: ShieldCheck, description: 'Visor filtrable de eventos de seguridad' },
  { id: 'integraciones', label: 'Integraciones y API', icon: Key, description: 'API keys y webhooks por workspace' },
  { id: 'almacenamiento', label: 'Almacenamiento', icon: Globe2, description: 'Conecta Google Drive, OneDrive y Dropbox' },
  { id: 'regional', label: 'Regional y Marca', icon: Globe, description: 'Zona horaria, formato y marca blanca' },
];

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ConfiguracionPage() {
  const { user } = useAuth();
  const { workspaces, activeWorkspace } = useWorkspace();
  const [activeSection, setActiveSection] = useState<Section>('notificaciones');

  // ── Notification state ──────────────────────────────────────────────────────
  const [notifEmail, setNotifEmail] = useState(true);
  const [notifSMS, setNotifSMS] = useState(false);
  const [notifPush, setNotifPush] = useState(true);
  const [notifInApp, setNotifInApp] = useState(true);
  const [notifFirma, setNotifFirma] = useState(true);
  const [notifTarea, setNotifTarea] = useState(true);
  const [notifSolicitud, setNotifSolicitud] = useState(true);
  const [notifVencimiento, setNotifVencimiento] = useState(true);
  const [notifSistema, setNotifSistema] = useState(false);
  const [notifComentario, setNotifComentario] = useState(true);
  const [notifEnrolamiento, setNotifEnrolamiento] = useState(true);
  const [notifFrecuencia, setNotifFrecuencia] = useState<'inmediata' | 'resumen_diario' | 'resumen_semanal'>('inmediata');
  const [notifSaved, setNotifSaved] = useState(false);
  const [notifSaving, setNotifSaving] = useState(false);

  // ── Delegation state ────────────────────────────────────────────────────────
  const [permProfiles, setPermProfiles] = useState<PermissionProfile[]>([]);
  const [permLoading, setPermLoading] = useState(false);
  const [showNewProfileModal, setShowNewProfileModal] = useState(false);
  const [editingProfile, setEditingProfile] = useState<PermissionProfile | null>(null);
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileDesc, setNewProfileDesc] = useState('');
  const [newProfilePerms, setNewProfilePerms] = useState<Record<string, boolean>>({});
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState('');

  // ── Audit state ─────────────────────────────────────────────────────────────
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditDateFilter, setAuditDateFilter] = useState<'today' | 'week' | '30days' | '90days' | 'all'>('30days');
  const [auditTypeFilter, setAuditTypeFilter] = useState('all');
  const [auditUserFilter, setAuditUserFilter] = useState('');
  const [auditPage, setAuditPage] = useState(1);
  const AUDIT_PAGE_SIZE = 15;

  // ── API Keys state ──────────────────────────────────────────────────────────
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [apiKeysLoading, setApiKeysLoading] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [creatingKey, setCreatingKey] = useState(false);
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([]);
  const [showWebhookModal, setShowWebhookModal] = useState(false);
  const [editingWebhook, setEditingWebhook] = useState<WebhookConfig | null>(null);
  const [webhookForm, setWebhookForm] = useState({ name: '', url: '', events: [] as string[] });
  const [webhookSaving, setWebhookSaving] = useState(false);
  const [webhookError, setWebhookError] = useState('');

  // ── Regional state ──────────────────────────────────────────────────────────
  const [regional, setRegional] = useState<RegionalSettings>({
    timezone: 'America/Mexico_City',
    date_format: 'DD/MM/YYYY',
    workspace_logo_url: null,
    brand_primary_color: '#6366f1',
    brand_email_header: '',
    portal_name: '',
  });
  const [regionalSaving, setRegionalSaving] = useState(false);
  const [regionalSaved, setRegionalSaved] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const currentWsId = activeWorkspace?.id || workspaces[0]?.id || null;

  // ── Load audit events ───────────────────────────────────────────────────────
  const loadAuditEvents = useCallback(async () => {
    if (!user) return;
    setAuditLoading(true);
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from('security_audit_chain')
        .select('id, event_type, user_id, ip_address, user_agent, created_at, metadata')
        .order('created_at', { ascending: false })
        .limit(500);
      if (data) setAuditEvents(data as AuditEvent[]);
    } catch { /* silent */ } finally { setAuditLoading(false); }
  }, [user]);

  // ── Load API keys (mock — no table yet, use local state) ───────────────────
  const loadApiKeys = useCallback(async () => {
    if (!currentWsId) return;
    setApiKeysLoading(true);
    // Simulate loading from workspace settings stored in workspace metadata
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from('workspaces')
        .select('id, name')
        .eq('id', currentWsId)
        .single();
      if (data) {
        // API keys are stored locally for now (no dedicated table)
        const stored = localStorage.getItem(`docubox_api_keys_${currentWsId}`);
        if (stored) setApiKeys(JSON.parse(stored));
        const storedWh = localStorage.getItem(`docubox_webhooks_${currentWsId}`);
        if (storedWh) setWebhooks(JSON.parse(storedWh));
      }
    } catch { /* silent */ } finally { setApiKeysLoading(false); }
  }, [currentWsId]);

  // ── Load permission profiles ────────────────────────────────────────────────
  const loadPermProfiles = useCallback(async () => {
    if (!currentWsId) return;
    setPermLoading(true);
    try {
      const stored = localStorage.getItem(`docubox_perm_profiles_${currentWsId}`);
      if (stored) setPermProfiles(JSON.parse(stored));
    } catch { /* silent */ } finally { setPermLoading(false); }
  }, [currentWsId]);

  // ── Load regional settings ──────────────────────────────────────────────────
  const loadRegional = useCallback(async () => {
    if (!currentWsId) return;
    try {
      const stored = localStorage.getItem(`docubox_regional_${currentWsId}`);
      if (stored) setRegional(JSON.parse(stored));
    } catch { /* silent */ }
  }, [currentWsId]);

  useEffect(() => {
    if (activeSection === 'auditoria') loadAuditEvents();
    if (activeSection === 'integraciones') loadApiKeys();
    if (activeSection === 'delegacion') loadPermProfiles();
    if (activeSection === 'regional') loadRegional();
  }, [activeSection, loadAuditEvents, loadApiKeys, loadPermProfiles, loadRegional]);

  // ─── Helpers ────────────────────────────────────────────────────────────────

  const generateApiKey = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const prefix = 'dbx_live_';
    let key = prefix;
    for (let i = 0; i < 40; i++) key += chars.charAt(Math.floor(Math.random() * chars.length));
    return key;
  };

  const maskKey = (key: string) => {
    const prefix = key.substring(0, 12);
    return prefix + '••••••••••••••••••••••••••••••••';
  };

  const handleCreateApiKey = () => {
    if (!newKeyName.trim() || !currentWsId) return;
    setCreatingKey(true);
    setTimeout(() => {
      const newKey: ApiKey = {
        id: crypto.randomUUID(),
        name: newKeyName.trim(),
        key: generateApiKey(),
        created_at: new Date().toISOString(),
        last_used: null,
        is_active: true,
        workspace_id: currentWsId,
      };
      let updated = [newKey, ...apiKeys];
      setApiKeys(updated);
      localStorage.setItem(`docubox_api_keys_${currentWsId}`, JSON.stringify(updated));
      setNewKeyName('');
      setCreatingKey(false);
      // Auto-reveal new key
      setRevealedKeys(prev => new Set([...prev, newKey.id]));
    }, 600);
  };

  const handleRevokeApiKey = (id: string) => {
    if (!confirm('¿Revocar esta API key? Los sistemas que la usen dejarán de funcionar.')) return;
    let updated = apiKeys.filter(k => k.id !== id);
    setApiKeys(updated);
    if (currentWsId) localStorage.setItem(`docubox_api_keys_${currentWsId}`, JSON.stringify(updated));
  };

  const handleCopyKey = (id: string, key: string) => {
    navigator.clipboard.writeText(key).catch(() => {});
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleSaveWebhook = () => {
    if (!webhookForm.name.trim() || !webhookForm.url.trim()) {
      setWebhookError('El nombre y la URL son obligatorios.');
      return;
    }
    if (!webhookForm.url.startsWith('https://')) {
      setWebhookError('La URL debe comenzar con https://');
      return;
    }
    setWebhookSaving(true);
    setTimeout(() => {
      let updated: WebhookConfig[];
      if (editingWebhook) {
        updated = webhooks.map(w => w.id === editingWebhook.id ? { ...w, ...webhookForm } : w);
      } else {
        const newWh: WebhookConfig = {
          id: crypto.randomUUID(),
          ...webhookForm,
          is_active: true,
          created_at: new Date().toISOString(),
          workspace_id: currentWsId || '',
        };
        updated = [newWh, ...webhooks];
      }
      setWebhooks(updated);
      if (currentWsId) localStorage.setItem(`docubox_webhooks_${currentWsId}`, JSON.stringify(updated));
      setShowWebhookModal(false);
      setEditingWebhook(null);
      setWebhookForm({ name: '', url: '', events: [] });
      setWebhookError('');
      setWebhookSaving(false);
    }, 600);
  };

  const handleDeleteWebhook = (id: string) => {
    if (!confirm('¿Eliminar este webhook?')) return;
    let updated = webhooks.filter(w => w.id !== id);
    setWebhooks(updated);
    if (currentWsId) localStorage.setItem(`docubox_webhooks_${currentWsId}`, JSON.stringify(updated));
  };

  const handleSavePermProfile = () => {
    if (!newProfileName.trim()) { setProfileError('El nombre es obligatorio.'); return; }
    setProfileSaving(true);
    setTimeout(() => {
      let updated: PermissionProfile[];
      if (editingProfile) {
        updated = permProfiles.map(p => p.id === editingProfile.id
          ? { ...p, name: newProfileName, description: newProfileDesc, permissions: newProfilePerms }
          : p
        );
      } else {
        const newP: PermissionProfile = {
          id: crypto.randomUUID(),
          name: newProfileName,
          description: newProfileDesc,
          permissions: newProfilePerms,
          workspace_id: currentWsId || '',
          created_at: new Date().toISOString(),
        };
        updated = [newP, ...permProfiles];
      }
      setPermProfiles(updated);
      if (currentWsId) localStorage.setItem(`docubox_perm_profiles_${currentWsId}`, JSON.stringify(updated));
      setShowNewProfileModal(false);
      setEditingProfile(null);
      setNewProfileName('');
      setNewProfileDesc('');
      setNewProfilePerms({});
      setProfileError('');
      setProfileSaving(false);
    }, 600);
  };

  const handleDeletePermProfile = (id: string) => {
    if (!confirm('¿Eliminar este perfil de permisos?')) return;
    let updated = permProfiles.filter(p => p.id !== id);
    setPermProfiles(updated);
    if (currentWsId) localStorage.setItem(`docubox_perm_profiles_${currentWsId}`, JSON.stringify(updated));
  };

  const handleSaveRegional = () => {
    setRegionalSaving(true);
    setTimeout(() => {
      if (currentWsId) localStorage.setItem(`docubox_regional_${currentWsId}`, JSON.stringify(regional));
      setRegionalSaving(false);
      setRegionalSaved(true);
      setTimeout(() => setRegionalSaved(false), 3000);
    }, 600);
  };

  const handleSaveNotifications = () => {
    setNotifSaving(true);
    setTimeout(() => {
      setNotifSaving(false);
      setNotifSaved(true);
      setTimeout(() => setNotifSaved(false), 3000);
    }, 600);
  };

  // ─── Audit helpers ───────────────────────────────────────────────────────────

  const getAuditEventLabel = (type: string) => {
    const map: Record<string, string> = {
      document_created: 'Documento creado',
      document_signed: 'Documento firmado',
      document_completed: 'Documento completado',
      document_rejected: 'Documento rechazado',
      document_deleted: 'Documento eliminado',
      user_login: 'Inicio de sesión',
      user_logout: 'Cierre de sesión',
      user_invited: 'Usuario invitado',
      user_removed: 'Usuario eliminado',
      api_key_created: 'API key creada',
      api_key_revoked: 'API key revocada',
      webhook_triggered: 'Webhook disparado',
      permission_changed: 'Permiso modificado',
      settings_updated: 'Configuración actualizada',
      session_timeout_inactivity: 'Timeout por inactividad',
      session_timeout_absolute: 'Timeout límite absoluto',
      login_attempt: 'Intento de inicio de sesión',
      login_success: 'Inicio de sesión exitoso',
      login_failed: 'Inicio de sesión fallido',
      device_enrolled: 'Dispositivo enrolado',
      mfa_enabled: 'MFA activado',
      mfa_disabled: 'MFA desactivado',
    };
    return map[type] || type.replace(/_/g, ' ');
  };

  const getAuditEventBadge = (type: string) => {
    if (type.includes('delete') || type.includes('failed') || type.includes('rejected') || type.includes('revoked')) return 'bg-red-50 text-red-700 border border-red-200';
    if (type.includes('created') || type.includes('success') || type.includes('completed') || type.includes('enabled') || type.includes('enrolled')) return 'bg-green-50 text-green-700 border border-green-200';
    if (type.includes('login') || type.includes('session') || type.includes('timeout')) return 'bg-orange-50 text-orange-700 border border-orange-200';
    if (type.includes('permission') || type.includes('settings') || type.includes('updated')) return 'bg-blue-50 text-blue-700 border border-blue-200';
    return 'bg-gray-50 text-gray-700 border border-gray-200';
  };

  const AUDIT_EVENT_TYPES = [
    { value: 'all', label: 'Todos los eventos' },
    { value: 'document', label: 'Documentos' },
    { value: 'user', label: 'Usuarios' },
    { value: 'auth', label: 'Autenticación' },
    { value: 'api', label: 'API / Webhooks' },
    { value: 'settings', label: 'Configuración' },
  ];

  const filterAuditByDate = (events: AuditEvent[]) => {
    const now = new Date();
    return events.filter(ev => {
      const d = new Date(ev.created_at);
      if (auditDateFilter === 'today') {
        return d.toDateString() === now.toDateString();
      } else if (auditDateFilter === 'week') {
        const ago = new Date(now); ago.setDate(now.getDate() - 7); return d >= ago;
      } else if (auditDateFilter === '30days') {
        const ago = new Date(now); ago.setDate(now.getDate() - 30); return d >= ago;
      } else if (auditDateFilter === '90days') {
        const ago = new Date(now); ago.setDate(now.getDate() - 90); return d >= ago;
      }
      return true;
    });
  };

  const filterAuditByType = (events: AuditEvent[]) => {
    if (auditTypeFilter === 'all') return events;
    return events.filter(ev => ev.event_type.includes(auditTypeFilter));
  };

  const filterAuditByUser = (events: AuditEvent[]) => {
    if (!auditUserFilter.trim()) return events;
    return events.filter(ev =>
      ev.user_id?.toLowerCase().includes(auditUserFilter.toLowerCase()) ||
      ev.ip_address?.toLowerCase().includes(auditUserFilter.toLowerCase())
    );
  };

  const filteredAudit = filterAuditByUser(filterAuditByType(filterAuditByDate(auditEvents)));
  const auditTotalPages = Math.max(1, Math.ceil(filteredAudit.length / AUDIT_PAGE_SIZE));
  const pagedAudit = filteredAudit.slice((auditPage - 1) * AUDIT_PAGE_SIZE, auditPage * AUDIT_PAGE_SIZE);

  // ─── Section renderers ───────────────────────────────────────────────────────

  const renderNotificaciones = () => (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Bell size={24} className="text-primary" />
            Notificaciones
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Configura cómo y cuándo recibes alertas de la plataforma.</p>
        </div>
        <button
          onClick={handleSaveNotifications}
          disabled={notifSaving}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-600 hover:bg-primary/90 transition-colors disabled:opacity-60 flex-shrink-0"
        >
          {notifSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Guardar preferencias
        </button>
      </div>

      {notifSaved && (
        <div className="flex items-center gap-2 px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm font-500">
          <CheckCircle size={15} />Preferencias de notificación guardadas correctamente.
        </div>
      )}

      {/* Canales */}
      <div className="bg-white border border-border rounded-xl p-5 flex flex-col gap-4">
        <h3 className="text-sm font-700 text-primary flex items-center gap-2"><Zap size={15} />Canales de notificación</h3>
        <div className="space-y-1">
          {[
            { icon: Mail, label: 'Correo electrónico', desc: 'Recibir notificaciones por email', value: notifEmail, set: setNotifEmail },
            { icon: Smartphone, label: 'SMS', desc: 'Notificaciones por mensaje de texto', value: notifSMS, set: setNotifSMS },
            { icon: Bell, label: 'Notificaciones push', desc: 'Alertas en el navegador', value: notifPush, set: setNotifPush },
            { icon: Activity, label: 'Notificaciones en app', desc: 'Centro de notificaciones dentro de la plataforma', value: notifInApp, set: setNotifInApp },
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-between py-3 border-b border-border/60 last:border-0 hover:bg-primary/5 rounded-lg px-2 transition-all duration-150 group">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-muted group-hover:bg-primary/10 flex items-center justify-center transition-colors duration-150">
                  <item.icon size={15} className="text-muted-foreground group-hover:text-primary transition-colors duration-150" />
                </div>
                <div>
                  <p className="text-sm font-500 text-foreground">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.desc}</p>
                </div>
              </div>
              <ToggleSwitch enabled={item.value} onChange={item.set} />
            </div>
          ))}
        </div>
      </div>

      {/* Frecuencia */}
      <div className="bg-white border border-border rounded-xl p-5 flex flex-col gap-4">
        <h3 className="text-sm font-700 text-primary flex items-center gap-2"><Clock size={15} />Frecuencia de envío</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { value: 'inmediata', label: 'Inmediata', desc: 'Cada evento al instante' },
            { value: 'resumen_diario', label: 'Resumen diario', desc: 'Un resumen cada día' },
            { value: 'resumen_semanal', label: 'Resumen semanal', desc: 'Un resumen cada semana' },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => setNotifFrecuencia(opt.value as typeof notifFrecuencia)}
              className={`flex flex-col items-start gap-1 p-4 rounded-xl border transition-all duration-150 text-left ${notifFrecuencia === opt.value ? 'border-primary bg-primary/5 shadow-sm' : 'border-border hover:bg-primary/5 hover:border-primary/30'}`}
            >
              <div className="flex items-center justify-between w-full">
                <p className="text-sm font-600 text-foreground">{opt.label}</p>
                {notifFrecuencia === opt.value && <Check size={15} className="text-primary" />}
              </div>
              <p className="text-xs text-muted-foreground">{opt.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Tipos de eventos */}
      <div className="bg-white border border-border rounded-xl p-5 flex flex-col gap-4">
        <h3 className="text-sm font-700 text-primary flex items-center gap-2"><Filter size={15} />Tipos de eventos</h3>
        <div className="space-y-1">
          {[
            { label: 'Solicitudes de firma', desc: 'Cuando alguien te envía un documento para firmar', value: notifFirma, set: setNotifFirma },
            { label: 'Tareas pendientes', desc: 'Recordatorios de tareas próximas a vencer', value: notifTarea, set: setNotifTarea },
            { label: 'Solicitudes enviadas', desc: 'Actualizaciones de tus solicitudes de firma', value: notifSolicitud, set: setNotifSolicitud },
            { label: 'Documentos por vencer', desc: 'Alertas de documentos próximos a expirar', value: notifVencimiento, set: setNotifVencimiento },
            { label: 'Comentarios y notas', desc: 'Cuando alguien comenta en tus documentos', value: notifComentario, set: setNotifComentario },
            { label: 'Enrolamiento biométrico', desc: 'Resultados de verificación de identidad', value: notifEnrolamiento, set: setNotifEnrolamiento },
            { label: 'Actualizaciones del sistema', desc: 'Mantenimiento y nuevas funcionalidades', value: notifSistema, set: setNotifSistema },
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-between py-3 border-b border-border/60 last:border-0 hover:bg-primary/5 rounded-lg px-2 transition-all duration-150">
              <div>
                <p className="text-sm font-500 text-foreground">{item.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
              </div>
              <ToggleSwitch enabled={item.value} onChange={item.set} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderDelegacion = () => (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Users size={24} className="text-primary" />
            Delegación y Roles Administrativos
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Crea perfiles de permisos granulares por workspace. Cada perfil puede tener acceso solo a los módulos que necesita.</p>
        </div>
        <button
          onClick={() => {
            setEditingProfile(null);
            setNewProfileName('');
            setNewProfileDesc('');
            setNewProfilePerms({});
            setProfileError('');
            setShowNewProfileModal(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-600 hover:bg-primary/90 transition-colors flex-shrink-0"
        >
          <Plus size={15} />
          Nuevo perfil
        </button>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl">
        <Info size={15} className="text-blue-600 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-blue-700">
          Los perfiles de permisos permiten asignar acceso granular a administradores del workspace. Un admin puede tener acceso solo a Usuarios y Grupos, o solo a Reportes, sin ver Facturación ni otras secciones sensibles.
        </p>
      </div>

      {/* Workspace selector */}
      <div className="bg-white border border-border rounded-xl p-5 flex flex-col gap-3">
        <h3 className="text-sm font-700 text-primary flex items-center gap-2"><Building2 size={15} />Workspace activo</h3>
        <div className="flex flex-wrap gap-2">
          {workspaces.map(ws => (
            <div key={ws.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm border ${ws.id === currentWsId ? 'border-primary bg-primary/5 text-primary font-600' : 'border-border text-muted-foreground'}`}>
              <Building2 size={13} />
              {ws.name}
              {ws.id === currentWsId && <Check size={13} />}
            </div>
          ))}
        </div>
      </div>

      {/* Permission profiles list */}
      <div className="bg-white border border-border rounded-xl p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-700 text-primary flex items-center gap-2"><Lock size={15} />Perfiles de permisos</h3>
          {permLoading && <Loader2 size={14} className="text-primary animate-spin" />}
        </div>

        {permProfiles.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
              <Users size={22} className="text-muted-foreground" />
            </div>
            <p className="text-sm font-600 text-foreground">Sin perfiles personalizados</p>
            <p className="text-xs text-muted-foreground max-w-xs">Crea perfiles de permisos granulares para asignar acceso específico a administradores del workspace.</p>
            <button
              onClick={() => { setEditingProfile(null); setNewProfileName(''); setNewProfileDesc(''); setNewProfilePerms({}); setShowNewProfileModal(true); }}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-600 hover:bg-primary/90 transition-colors"
            >
              <Plus size={14} />Crear primer perfil
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {permProfiles.map(profile => {
              const enabledCount = Object.values(profile.permissions).filter(Boolean).length;
              return (
                <div key={profile.id} className="flex items-start justify-between p-4 border border-border rounded-xl hover:border-primary/20 hover:bg-primary/5 transition-all duration-150">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-700 text-foreground">{profile.name}</p>
                      <span className="text-xs font-600 px-2 py-0.5 rounded-full bg-primary/10 text-primary">{enabledCount} módulos</span>
                    </div>
                    {profile.description && <p className="text-xs text-muted-foreground mt-0.5">{profile.description}</p>}
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {PERMISSION_MODULES.filter(m => profile.permissions[m.key]).map(m => (
                        <span key={m.key} className="text-[10px] font-600 px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">{m.label}</span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                    <button
                      onClick={() => {
                        setEditingProfile(profile);
                        setNewProfileName(profile.name);
                        setNewProfileDesc(profile.description);
                        setNewProfilePerms(profile.permissions);
                        setProfileError('');
                        setShowNewProfileModal(true);
                      }}
                      className="flex items-center gap-1 px-2.5 py-1.5 border border-border rounded-lg text-xs text-foreground hover:bg-gray-50 transition-colors"
                    >
                      <Edit3 size={11} />Editar
                    </button>
                    <button
                      onClick={() => handleDeletePermProfile(profile.id)}
                      className="flex items-center gap-1 px-2.5 py-1.5 border border-red-200 rounded-lg text-xs text-red-500 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* New/Edit Profile Modal */}
      {showNewProfileModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Users size={20} className="text-primary" />
                </div>
                <div>
                  <h2 className="text-base font-700 text-foreground">{editingProfile ? 'Editar perfil' : 'Nuevo perfil de permisos'}</h2>
                  <p className="text-xs text-muted-foreground">Define qué módulos puede acceder este perfil</p>
                </div>
              </div>
              <button onClick={() => setShowNewProfileModal(false)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors">
                <X size={16} className="text-muted-foreground" />
              </button>
            </div>
            <div className="px-6 py-5 overflow-y-auto flex-1 flex flex-col gap-4">
              <div>
                <label className="block text-xs font-600 text-muted-foreground mb-1.5">Nombre del perfil *</label>
                <input
                  type="text"
                  value={newProfileName}
                  onChange={e => setNewProfileName(e.target.value)}
                  placeholder="Ej: Admin de Documentos, Auditor, etc."
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-600 text-muted-foreground mb-1.5">Descripción</label>
                <input
                  type="text"
                  value={newProfileDesc}
                  onChange={e => setNewProfileDesc(e.target.value)}
                  placeholder="Descripción opcional del perfil"
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-600 text-muted-foreground mb-2">Módulos con acceso</label>
                <div className="space-y-2">
                  {PERMISSION_MODULES.map(mod => (
                    <div key={mod.key} className="flex items-center justify-between py-2.5 px-3 border border-border rounded-lg hover:bg-gray-50 transition-colors">
                      <div>
                        <p className="text-sm font-500 text-foreground">{mod.label}</p>
                        <p className="text-xs text-muted-foreground">{mod.description}</p>
                      </div>
                      <ToggleSwitch
                        enabled={!!newProfilePerms[mod.key]}
                        onChange={v => setNewProfilePerms(prev => ({ ...prev, [mod.key]: v }))}
                      />
                    </div>
                  ))}
                </div>
              </div>
              {profileError && (
                <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  <AlertCircle size={14} />{profileError}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-gray-50 flex-shrink-0">
              <button onClick={() => setShowNewProfileModal(false)} className="px-4 py-2 text-sm text-foreground hover:bg-gray-100 transition-colors font-500 rounded-lg">Cancelar</button>
              <button
                onClick={handleSavePermProfile}
                disabled={profileSaving || !newProfileName.trim()}
                className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-600 hover:bg-primary/90 transition-colors disabled:opacity-60"
              >
                {profileSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {editingProfile ? 'Guardar cambios' : 'Crear perfil'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderAuditoria = () => (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <ShieldCheck size={24} className="text-primary" />
            Auditoría y Reportes
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Visor filtrable de eventos de seguridad. Filtra por usuario, acción y rango de fecha.</p>
        </div>
        <button
          onClick={() => {
            const csv = ['Fecha,Hora,Evento,Usuario,IP,Dispositivo']
              .concat(filteredAudit.map(ev => {
                const d = new Date(ev.created_at);
                return [
                  d.toLocaleDateString('es-MX'),
                  d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
                  getAuditEventLabel(ev.event_type),
                  ev.user_id || '—',
                  ev.ip_address || '—',
                  ev.user_agent ? ev.user_agent.substring(0, 40) : '—',
                ].join(',');
              }))
              .join('\n');
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `auditoria_${new Date().toISOString().split('T')[0]}.csv`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          className="flex items-center gap-2 px-4 py-2 border border-border text-foreground rounded-lg text-sm font-600 hover:bg-gray-50 transition-colors flex-shrink-0"
        >
          <Download size={14} />
          Exportar CSV
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white border border-border rounded-xl p-5 flex flex-col gap-4">
        <h3 className="text-sm font-700 text-primary flex items-center gap-2"><Filter size={15} />Filtros</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Date filter */}
          <div>
            <label className="block text-xs font-600 text-muted-foreground mb-1.5">Rango de fecha</label>
            <select
              value={auditDateFilter}
              onChange={e => { setAuditDateFilter(e.target.value as typeof auditDateFilter); setAuditPage(1); }}
              className="w-full text-sm border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white transition-colors cursor-pointer"
            >
              <option value="today">Hoy</option>
              <option value="week">Últimos 7 días</option>
              <option value="30days">Últimos 30 días</option>
              <option value="90days">Últimos 90 días</option>
              <option value="all">Todo el historial</option>
            </select>
          </div>
          {/* Type filter */}
          <div>
            <label className="block text-xs font-600 text-muted-foreground mb-1.5">Tipo de evento</label>
            <select
              value={auditTypeFilter}
              onChange={e => { setAuditTypeFilter(e.target.value); setAuditPage(1); }}
              className="w-full text-sm border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white transition-colors cursor-pointer"
            >
              {AUDIT_EVENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          {/* User/IP filter */}
          <div>
            <label className="block text-xs font-600 text-muted-foreground mb-1.5">Usuario o IP</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={auditUserFilter}
                onChange={e => { setAuditUserFilter(e.target.value); setAuditPage(1); }}
                placeholder="Buscar por usuario o IP..."
                className="w-full pl-8 pr-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
              />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Activity size={13} />
          {auditLoading ? 'Cargando eventos...' : `${filteredAudit.length} eventos encontrados`}
          {auditLoading && <Loader2 size={13} className="animate-spin text-primary" />}
        </div>
      </div>

      {/* Events table */}
      <div className="bg-white border border-border rounded-xl overflow-hidden">
        {filteredAudit.length === 0 && !auditLoading ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
              <ShieldCheck size={22} className="text-muted-foreground" />
            </div>
            <p className="text-sm font-600 text-foreground">Sin eventos en este período</p>
            <p className="text-xs text-muted-foreground">Ajusta los filtros para ver más resultados.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-border">
                    <th className="text-left px-4 py-3 text-xs font-600 text-muted-foreground whitespace-nowrap">Fecha y hora</th>
                    <th className="text-left px-4 py-3 text-xs font-600 text-muted-foreground whitespace-nowrap">Evento</th>
                    <th className="text-left px-4 py-3 text-xs font-600 text-muted-foreground whitespace-nowrap">Usuario</th>
                    <th className="text-left px-4 py-3 text-xs font-600 text-muted-foreground whitespace-nowrap">IP</th>
                    <th className="text-left px-4 py-3 text-xs font-600 text-muted-foreground whitespace-nowrap">Dispositivo</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedAudit.map((ev, idx) => {
                    const d = new Date(ev.created_at);
                    const dateStr = d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
                    const timeStr = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
                    let deviceInfo = '—';
                    if (ev.user_agent) {
                      const ua = ev.user_agent;
                      let browser = '';
                      let os = '';
                      if (ua.includes('Chrome') && !ua.includes('Edg')) browser = 'Chrome';
                      else if (ua.includes('Firefox')) browser = 'Firefox';
                      else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
                      else if (ua.includes('Edg')) browser = 'Edge';
                      if (ua.includes('Windows')) os = 'Windows';
                      else if (ua.includes('Mac OS')) os = 'macOS';
                      else if (ua.includes('Android')) os = 'Android';
                      else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
                      else if (ua.includes('Linux')) os = 'Linux';
                      deviceInfo = [browser, os].filter(Boolean).join(' · ') || '—';
                    }
                    return (
                      <tr key={ev.id} className={`border-b border-border last:border-0 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="text-xs font-500 text-foreground">{dateStr}</p>
                          <p className="text-[10px] text-muted-foreground">{timeStr}</p>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-600 ${getAuditEventBadge(ev.event_type)}`}>
                            {getAuditEventLabel(ev.event_type)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap max-w-[140px] truncate">
                          {ev.user_id ? ev.user_id.substring(0, 8) + '...' : '—'}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{ev.ip_address || '—'}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{deviceInfo}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filteredAudit.length > AUDIT_PAGE_SIZE && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-gray-50">
                <p className="text-xs text-muted-foreground">
                  Mostrando {Math.min((auditPage - 1) * AUDIT_PAGE_SIZE + 1, filteredAudit.length)}–{Math.min(auditPage * AUDIT_PAGE_SIZE, filteredAudit.length)} de {filteredAudit.length}
                </p>
                <div className="flex items-center gap-1">
                  <button onClick={() => setAuditPage(p => Math.max(1, p - 1))} disabled={auditPage === 1} className="px-2.5 py-1 rounded text-xs font-600 bg-white border border-border text-muted-foreground hover:bg-gray-100 disabled:opacity-40 transition-colors">‹</button>
                  {Array.from({ length: Math.min(auditTotalPages, 5) }, (_, i) => i + 1).map(p => (
                    <button key={p} onClick={() => setAuditPage(p)} className={`px-2.5 py-1 rounded text-xs font-600 transition-colors ${auditPage === p ? 'bg-primary text-white' : 'bg-white border border-border text-muted-foreground hover:bg-gray-100'}`}>{p}</button>
                  ))}
                  <button onClick={() => setAuditPage(p => Math.min(auditTotalPages, p + 1))} disabled={auditPage === auditTotalPages} className="px-2.5 py-1 rounded text-xs font-600 bg-white border border-border text-muted-foreground hover:bg-gray-100 disabled:opacity-40 transition-colors">›</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );

  const renderIntegraciones = () => (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Key size={24} className="text-primary" />
            Integraciones y API Keys
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Gestiona API keys y webhooks por workspace para integrar sistemas externos.</p>
        </div>
      </div>

      {/* API Keys section */}
      <div className="bg-white border border-border rounded-xl p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-700 text-primary flex items-center gap-2"><Key size={15} />API Keys</h3>
          {apiKeysLoading && <Loader2 size={14} className="text-primary animate-spin" />}
        </div>

        <div className="flex items-start gap-3 px-3 py-3 bg-amber-50 border border-amber-200 rounded-xl">
          <AlertCircle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700">Las API keys otorgan acceso programático a tu workspace. Guárdalas en un lugar seguro y nunca las compartas públicamente.</p>
        </div>

        {/* Create new key */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newKeyName}
            onChange={e => setNewKeyName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreateApiKey()}
            placeholder="Nombre de la API key (ej: ERP Producción)"
            className="flex-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
          />
          <button
            onClick={handleCreateApiKey}
            disabled={creatingKey || !newKeyName.trim()}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-600 hover:bg-primary/90 transition-colors disabled:opacity-60 flex-shrink-0"
          >
            {creatingKey ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Generar
          </button>
        </div>

        {/* Keys list */}
        {apiKeys.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <Key size={22} className="text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Sin API keys generadas para este workspace.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {apiKeys.map(apiKey => (
              <div key={apiKey.id} className="flex items-start justify-between p-4 border border-border rounded-xl hover:border-primary/20 transition-all duration-150">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-700 text-foreground">{apiKey.name}</p>
                    <span className={`text-[10px] font-600 px-2 py-0.5 rounded-full ${apiKey.is_active ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-gray-100 text-gray-500 border border-gray-200'}`}>
                      {apiKey.is_active ? 'Activa' : 'Revocada'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <code className="text-xs font-mono text-muted-foreground bg-gray-50 border border-border rounded px-2 py-1 flex-1 min-w-0 truncate">
                      {revealedKeys.has(apiKey.id) ? apiKey.key : maskKey(apiKey.key)}
                    </code>
                    <button
                      onClick={() => setRevealedKeys(prev => {
                        const next = new Set(prev);
                        if (next.has(apiKey.id)) next.delete(apiKey.id); else next.add(apiKey.id);
                        return next;
                      })}
                      className="p-1.5 rounded-lg border border-border hover:bg-gray-50 transition-colors flex-shrink-0"
                      title={revealedKeys.has(apiKey.id) ? 'Ocultar' : 'Mostrar'}
                    >
                      {revealedKeys.has(apiKey.id) ? <EyeOff size={13} className="text-muted-foreground" /> : <Eye size={13} className="text-muted-foreground" />}
                    </button>
                    <button
                      onClick={() => handleCopyKey(apiKey.id, apiKey.key)}
                      className="p-1.5 rounded-lg border border-border hover:bg-gray-50 transition-colors flex-shrink-0"
                      title="Copiar"
                    >
                      {copiedKey === apiKey.id ? <Check size={13} className="text-green-600" /> : <Copy size={13} className="text-muted-foreground" />}
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Creada {new Date(apiKey.created_at).toLocaleDateString('es-MX')}
                    {apiKey.last_used && ` · Último uso ${new Date(apiKey.last_used).toLocaleDateString('es-MX')}`}
                  </p>
                </div>
                <button
                  onClick={() => handleRevokeApiKey(apiKey.id)}
                  className="flex items-center gap-1 px-2.5 py-1.5 border border-red-200 rounded-lg text-xs text-red-500 hover:bg-red-50 transition-colors ml-3 flex-shrink-0"
                >
                  <Trash2 size={11} />Revocar
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Webhooks section */}
      <div className="bg-white border border-border rounded-xl p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-700 text-primary flex items-center gap-2"><Webhook size={15} />Webhooks</h3>
          <button
            onClick={() => {
              setEditingWebhook(null);
              setWebhookForm({ name: '', url: '', events: [] });
              setWebhookError('');
              setShowWebhookModal(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-600 hover:bg-primary/90 transition-colors"
          >
            <Plus size={13} />Nuevo webhook
          </button>
        </div>

        <div className="flex items-start gap-3 px-3 py-3 bg-blue-50 border border-blue-200 rounded-xl">
          <Info size={14} className="text-blue-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700">Los webhooks permiten que tu ERP, CRM u otros sistemas reciban notificaciones en tiempo real cuando ocurren eventos de firma en Docubox.</p>
        </div>

        {webhooks.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <Webhook size={22} className="text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Sin webhooks configurados para este workspace.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {webhooks.map(wh => (
              <div key={wh.id} className="flex items-start justify-between p-4 border border-border rounded-xl hover:border-primary/20 transition-all duration-150">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-700 text-foreground">{wh.name}</p>
                    <span className={`text-[10px] font-600 px-2 py-0.5 rounded-full ${wh.is_active ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-gray-100 text-gray-500 border border-gray-200'}`}>
                      {wh.is_active ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{wh.url}</p>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {wh.events.map(ev => (
                      <span key={ev} className="text-[10px] font-600 px-1.5 py-0.5 rounded bg-primary/10 text-primary">{ev}</span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                  <button
                    onClick={() => {
                      setEditingWebhook(wh);
                      setWebhookForm({ name: wh.name, url: wh.url, events: wh.events });
                      setWebhookError('');
                      setShowWebhookModal(true);
                    }}
                    className="flex items-center gap-1 px-2.5 py-1.5 border border-border rounded-lg text-xs text-foreground hover:bg-gray-50 transition-colors"
                  >
                    <Edit3 size={11} />Editar
                  </button>
                  <button
                    onClick={() => handleDeleteWebhook(wh.id)}
                    className="flex items-center gap-1 px-2.5 py-1.5 border border-red-200 rounded-lg text-xs text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Webhook Modal */}
      {showWebhookModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Webhook size={20} className="text-primary" />
                </div>
                <div>
                  <h2 className="text-base font-700 text-foreground">{editingWebhook ? 'Editar webhook' : 'Nuevo webhook'}</h2>
                  <p className="text-xs text-muted-foreground">Configura el endpoint y los eventos</p>
                </div>
              </div>
              <button onClick={() => setShowWebhookModal(false)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors">
                <X size={16} className="text-muted-foreground" />
              </button>
            </div>
            <div className="px-6 py-5 overflow-y-auto flex-1 flex flex-col gap-4">
              <div>
                <label className="block text-xs font-600 text-muted-foreground mb-1.5">Nombre *</label>
                <input
                  type="text"
                  value={webhookForm.name}
                  onChange={e => setWebhookForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Ej: ERP Producción, CRM Ventas"
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-600 text-muted-foreground mb-1.5">URL del endpoint * (https://)</label>
                <input
                  type="url"
                  value={webhookForm.url}
                  onChange={e => setWebhookForm(f => ({ ...f, url: e.target.value }))}
                  placeholder="https://mi-erp.com/api/docubox-webhook"
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-600 text-muted-foreground mb-2">Eventos a escuchar</label>
                <div className="space-y-2">
                  {WEBHOOK_EVENTS.map(ev => (
                    <label key={ev.key} className="flex items-center gap-3 py-2 px-3 border border-border rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={webhookForm.events.includes(ev.key)}
                        onChange={e => setWebhookForm(f => ({
                          ...f,
                          events: e.target.checked ? [...f.events, ev.key] : f.events.filter(x => x !== ev.key)
                        }))}
                        className="w-4 h-4 rounded border-border text-primary focus:ring-primary/30"
                      />
                      <div>
                        <p className="text-sm font-500 text-foreground">{ev.label}</p>
                        <p className="text-xs text-muted-foreground font-mono">{ev.key}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              {webhookError && (
                <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  <AlertCircle size={14} />{webhookError}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-gray-50 flex-shrink-0">
              <button onClick={() => setShowWebhookModal(false)} className="px-4 py-2 text-sm text-foreground hover:bg-gray-100 transition-colors font-500 rounded-lg">Cancelar</button>
              <button
                onClick={handleSaveWebhook}
                disabled={webhookSaving}
                className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-600 hover:bg-primary/90 transition-colors disabled:opacity-60"
              >
                {webhookSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {editingWebhook ? 'Guardar cambios' : 'Crear webhook'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderRegional = () => (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Globe size={24} className="text-primary" />
            Regional y Marca Blanca
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Configura zona horaria, formato de fecha y la identidad visual de tu workspace.</p>
        </div>
        <button
          onClick={handleSaveRegional}
          disabled={regionalSaving}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-600 hover:bg-primary/90 transition-colors disabled:opacity-60 flex-shrink-0"
        >
          {regionalSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Guardar configuración
        </button>
      </div>

      {regionalSaved && (
        <div className="flex items-center gap-2 px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm font-500">
          <CheckCircle size={15} />Configuración regional y de marca guardada correctamente.
        </div>
      )}

      {/* Regional settings */}
      <div className="bg-white border border-border rounded-xl p-5 flex flex-col gap-4">
        <h3 className="text-sm font-700 text-primary flex items-center gap-2"><Globe2 size={15} />Configuración Regional</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-600 text-muted-foreground mb-1.5">Zona horaria</label>
            <select
              value={regional.timezone}
              onChange={e => setRegional(r => ({ ...r, timezone: e.target.value }))}
              className="w-full text-sm border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white transition-colors cursor-pointer"
            >
              {TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
            </select>
            <p className="text-xs text-muted-foreground mt-1">Afecta fechas en documentos, recordatorios y reportes.</p>
          </div>
          <div>
            <label className="block text-xs font-600 text-muted-foreground mb-1.5">Formato de fecha</label>
            <select
              value={regional.date_format}
              onChange={e => setRegional(r => ({ ...r, date_format: e.target.value }))}
              className="w-full text-sm border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white transition-colors cursor-pointer"
            >
              {DATE_FORMATS.map(df => <option key={df.value} value={df.value}>{df.label}</option>)}
            </select>
            <p className="text-xs text-muted-foreground mt-1">Cómo se muestran las fechas en documentos y la plataforma.</p>
          </div>
        </div>
      </div>

      {/* Branding */}
      <div className="bg-white border border-border rounded-xl p-5 flex flex-col gap-4">
        <h3 className="text-sm font-700 text-primary flex items-center gap-2"><Palette size={15} />Marca Blanca del Workspace</h3>
        <p className="text-xs text-muted-foreground">Personaliza la identidad visual del portal de firma y los correos enviados a tus clientes.</p>

        {/* Logo upload */}
        <div>
          <label className="block text-xs font-600 text-muted-foreground mb-2">Logo del workspace</label>
          <div className="flex items-start gap-4">
            <div className="w-20 h-20 rounded-xl border-2 border-dashed border-border bg-gray-50 flex items-center justify-center flex-shrink-0 overflow-hidden">
              {regional.workspace_logo_url ? (
                <img src={regional.workspace_logo_url} alt="Logo del workspace" className="w-full h-full object-contain p-1" />
              ) : (
                <Image size={24} className="text-muted-foreground" />
              )}
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => logoInputRef.current?.click()}
                disabled={logoUploading}
                className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm font-500 hover:bg-gray-50 transition-colors disabled:opacity-60"
              >
                {logoUploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {logoUploading ? 'Subiendo...' : 'Subir logo'}
              </button>
              {regional.workspace_logo_url && (
                <button
                  onClick={() => setRegional(r => ({ ...r, workspace_logo_url: null }))}
                  className="flex items-center gap-2 px-3 py-2 border border-red-200 rounded-lg text-sm font-500 text-red-500 hover:bg-red-50 transition-colors"
                >
                  <Trash2 size={14} />Eliminar logo
                </button>
              )}
              <p className="text-xs text-muted-foreground">PNG, SVG o JPG. Recomendado: 200×60px.</p>
            </div>
          </div>
          <input
            ref={logoInputRef}
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/svg+xml"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setLogoUploading(true);
              try {
                const reader = new FileReader();
                reader.onload = (ev) => {
                  setRegional(r => ({ ...r, workspace_logo_url: ev.target?.result as string }));
                  setLogoUploading(false);
                };
                reader.readAsDataURL(file);
              } catch { setLogoUploading(false); }
            }}
          />
        </div>

        {/* Portal name */}
        <div>
          <label className="block text-xs font-600 text-muted-foreground mb-1.5">Nombre del portal de firma</label>
          <input
            type="text"
            value={regional.portal_name}
            onChange={e => setRegional(r => ({ ...r, portal_name: e.target.value }))}
            placeholder="Ej: Portal de Firma ACME, Firma Digital Banorte"
            className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
          />
          <p className="text-xs text-muted-foreground mt-1">Aparece en el portal de firma y en los correos enviados a participantes.</p>
        </div>

        {/* Brand color */}
        <div>
          <label className="block text-xs font-600 text-muted-foreground mb-1.5">Color principal de marca</label>
          <div className="flex items-center gap-3">
            <div className="relative">
              <input
                type="color"
                value={regional.brand_primary_color}
                onChange={e => setRegional(r => ({ ...r, brand_primary_color: e.target.value }))}
                className="w-12 h-10 rounded-lg border border-border cursor-pointer p-0.5 bg-white"
              />
            </div>
            <input
              type="text"
              value={regional.brand_primary_color}
              onChange={e => {
                const val = e.target.value;
                if (/^#[0-9A-Fa-f]{0,6}$/.test(val)) setRegional(r => ({ ...r, brand_primary_color: val }));
              }}
              placeholder="#6366f1"
              className="w-32 px-3 py-2 border border-border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
            />
            <div className="flex items-center gap-2">
              {['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'].map(color => (
                <button
                  key={color}
                  onClick={() => setRegional(r => ({ ...r, brand_primary_color: color }))}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${regional.brand_primary_color === color ? 'border-foreground scale-110' : 'border-transparent hover:scale-105'}`}
                  style={{ backgroundColor: color }}
                  title={color}
                />
              ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Se aplica en botones, encabezados y acentos del portal de firma y correos.</p>
        </div>

        {/* Email header */}
        <div>
          <label className="block text-xs font-600 text-muted-foreground mb-1.5">Texto del encabezado de correos</label>
          <input
            type="text"
            value={regional.brand_email_header}
            onChange={e => setRegional(r => ({ ...r, brand_email_header: e.target.value }))}
            placeholder="Ej: ACME Corp · Firma Digital"
            className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
          />
          <p className="text-xs text-muted-foreground mt-1">Aparece en el encabezado de todos los correos enviados a participantes.</p>
        </div>

        {/* Preview */}
        <div>
          <label className="block text-xs font-600 text-muted-foreground mb-2">Vista previa del encabezado de correo</label>
          <div className="border border-border rounded-xl overflow-hidden">
            <div className="px-6 py-4 flex items-center gap-3" style={{ backgroundColor: regional.brand_primary_color + '18' }}>
              {regional.workspace_logo_url ? (
                <img src={regional.workspace_logo_url} alt="Logo" className="h-8 object-contain" />
              ) : (
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: regional.brand_primary_color }}>
                  <Building2 size={16} className="text-white" />
                </div>
              )}
              <p className="text-sm font-700 text-foreground">{regional.brand_email_header || regional.portal_name || 'Tu Empresa · Firma Digital'}</p>
            </div>
            <div className="px-6 py-4 bg-white">
              <p className="text-sm text-foreground">Hola <strong>Juan Pérez</strong>,</p>
              <p className="text-sm text-muted-foreground mt-1">Te han enviado un documento para firmar. Haz clic en el botón para revisar y firmar.</p>
              <div className="mt-3">
                <span className="inline-block px-4 py-2 rounded-lg text-white text-sm font-600" style={{ backgroundColor: regional.brand_primary_color }}>
                  Revisar documento
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderContent = () => {
    switch (activeSection) {
      case 'notificaciones': return renderNotificaciones();
      case 'delegacion': return renderDelegacion();
      case 'auditoria': return renderAuditoria();
      case 'integraciones': return renderIntegraciones();
      case 'almacenamiento': return renderAlmacenamiento();
      case 'regional': return renderRegional();
      default: return null;
    }
  };

  const renderAlmacenamiento = () => {
    const integrations = [
      {
        id: 'gdrive',
        name: 'Google Drive',
        desc: 'Importa y exporta documentos directamente desde tu Google Drive.',
        icon: (
          <svg width="32" height="32" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
            <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
            <path d="m43.65 25-13.75-23.8c-1.35.8 2.5 1.9 3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/>
            <path d="m73.55 76.8c1.35-.8 2.5-1.2 3.3 3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.5l5.85 11.5z" fill="#ea4335"/>
            <path d="m43.65 25 13.75-23.8c-1.35-.8 2.5-1.2 4.5-1.2h-18.5c0-1.5-.5-2.9-1.2-4.5z" fill="#00832d"/>
            <path d="m59.8 53h-32.3l-13.75 23.8c1.35-.8 2.8 1.2 4.5 1.2h50.8c1.6 0 3.1-.4 4.5-1.2z" fill="#00832d"/>
            <path d="m73.4 26.5-12.7-22c-.8-1.9 1.5-2.9 3.3-3.3l13.75 23.8 16.15 27h27.45c0-1.5-.5-2.9-1.2-4.5z" fill="#ffba00"/>
          </svg>
        ),
        color: 'bg-blue-50 border-blue-200',
        btnColor: 'bg-blue-600 hover:bg-blue-700',
      },
      {
        id: 'onedrive',
        name: 'OneDrive',
        desc: 'Conecta tu cuenta de Microsoft OneDrive para gestionar documentos.',
        icon: (
          <svg width="32" height="32" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
            <path fill="#1565c0" d="M28 20.1c1.3-3.2 4.4-5.5 8.1-5.5 4.8 0 8.6 4.1 8.6 8.6 0 .4 0 1 .1 1.5-3.1.5-5.5 3.1-5.5 8.1 0 3.2 2.4 5.5 5.5 5.5 2.4 0 4.6-2.3 4.6-5.5 0-1.5-.5-2.9-1.2-4.5z" />
            <path fill="#42a5f5" d="M28 20.1c-1.7-2.1-4.4-3.5-7.3-3.5-5.1 0-9.2 4.1-9.2 8.6 0 .5 0 1 .1 1.5-3.1.5-5.5 3.1-5.5 8.1 0 3.2 2.4 5.5 5.5 5.5 2.4 0 4.6-2.3 4.6-5.5 0-1.5-.5-2.9-1.2-4.5z" />
          </svg>
        ),
        color: 'bg-sky-50 border-sky-200',
        btnColor: 'bg-sky-600 hover:bg-sky-700',
      },
      {
        id: 'dropbox',
        name: 'Dropbox',
        desc: 'Sincroniza documentos con tu cuenta de Dropbox.',
        icon: (
          <svg width="32" height="32" viewBox="0 0 528 512" xmlns="http://www.w3.org/2000/svg">
            <path fill="#0061ff" d="M264.4 116.3l-132 84.3 132 84.3-132 83.6L0 284.1l132.3-84.3L0 116.3 132.3 32l132.1 84.3zM131.6 395.7l132-84.3 132 84.3-132 83.6L395.7 32 528 116.3l-132.3 83.5L528 283.4l-132.3 84.3-131.3-83.6z" />
          </svg>
        ),
        color: 'bg-indigo-50 border-indigo-200',
        btnColor: 'bg-indigo-600 hover:bg-indigo-700',
      },
    ];

    return (
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
            <Globe2 size={22} className="text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Almacenamiento en la nube</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Conecta servicios de almacenamiento para importar y exportar documentos</p>
          </div>
        </div>

        {/* Info */}
        <div className="bg-gray-50 border border-border rounded-xl px-4 py-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Al conectar un servicio de almacenamiento podrás importar documentos directamente al crear un nuevo documento, y exportar documentos firmados a tu nube preferida.
          </p>
        </div>

        {/* Integration cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {integrations.map((integ) => (
            <div key={integ.id} className={`border rounded-xl p-5 flex flex-col gap-4 ${integ.color}`}>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-white rounded-xl border border-white/80 flex items-center justify-center shadow-sm">
                  {integ.icon}
                </div>
                <div>
                  <p className="text-sm font-700 text-foreground">{integ.name}</p>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">No conectado</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{integ.desc}</p>
              <button className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 text-white text-sm font-600 rounded-lg transition-colors ${integ.btnColor}`}>
                <Link2 size={14} />
                Conectar {integ.name}
              </button>
            </div>
          ))}
        </div>

        {/* Connected accounts placeholder */}
        <div className="bg-white border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border bg-muted/30">
            <h3 className="text-sm font-700 text-foreground">Cuentas conectadas</h3>
          </div>
          <div className="p-8 flex flex-col items-center gap-3 text-center">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
              <Globe2 size={22} className="text-gray-400" />
            </div>
            <p className="text-sm font-600 text-foreground">No tienes cuentas conectadas</p>
            <p className="text-xs text-muted-foreground">Conecta un servicio de almacenamiento para comenzar</p>
          </div>
        </div>
      </div>
    );
  };

  const activeItem = sidebarItems.find(s => s.id === activeSection);

  return (
    <AppLayout noPadding>
      <div className="flex min-h-[calc(100vh-128px)]">
        <div className="flex flex-col md:flex-row w-full flex-1">
          {/* Internal Sidebar — horizontal tabs on mobile, vertical sidebar on md+ */}
          <aside className="w-full md:w-52 2xl:w-64 flex-shrink-0 bg-white border-b md:border-b-0 md:border-r border-border flex flex-col">
            <nav className="flex flex-row md:flex-col overflow-x-auto md:overflow-x-visible space-x-1 md:space-x-0 md:space-y-0.5 pt-2 md:pt-3 px-2 pb-2 md:pb-4 scrollbar-thin">
              {sidebarItems.map((item) => {
                const isActive = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveSection(item.id)}
                    className={`flex-shrink-0 md:w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-150 text-left whitespace-nowrap ${
                      isActive ? 'bg-primary/10 text-primary font-600 shadow-sm' : 'text-foreground hover:bg-gray-100 hover:text-primary'
                    }`}
                  >
                    <item.icon size={15} className={`flex-shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
              <div className="my-2 border-t border-border" />
              <Link
                href="/configuracion/verificacion-identidad"
                className="flex flex-shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm text-foreground transition-all duration-150 hover:bg-gray-100 hover:text-primary md:w-full"
              >
                <Fingerprint size={15} className="flex-shrink-0 text-muted-foreground" />
                <span>Verificación de identidad</span>
              </Link>
            </nav>
          </aside>

          {/* Main Content */}
          <div className="flex-1 overflow-auto bg-background px-4 md:px-6 py-5">
            {renderContent()}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
