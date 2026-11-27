'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import AppLayout from '@/components/AppLayout';
import ResponsiveSidebar from '@/components/ResponsiveSidebar';
import { BottomNotice } from '@/components/ui/BottomNotice';
import { Bell, Globe, Users, ShieldCheck, Key, Palette, Loader2, Filter, Download, Building2, Save, Activity, Image, Upload, Search, Globe2, Link2, Fingerprint, FileText, FileCog, Trash2 } from 'lucide-react';
import { NotificationPreferencesPanel } from './NotificationPreferencesPanel';
import { CatalogSettingsPanel } from './CatalogSettingsPanel';
import { Tags } from 'lucide-react';
import OrganizationAdvancedAdministration from '@/app/organizacion/_components/OrganizationAdvancedAdministration';
import { loadTemplateDocumentSettings, saveTemplateDocumentSettings } from '@/lib/templates/remote-document-settings';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { createClient } from '@/lib/supabase/client';
import { TemplateDocumentSettingsPanel } from '@/components/templates/TemplateDocumentSettingsPanel';
import { FormPdfDefaultsPanel } from '@/components/forms/FormPdfDefaultsPanel';
import { FormExperienceDefaultsPanel } from '@/components/forms/FormExperienceDefaultsPanel';
import { FormLegalDefaultsPanel } from '@/components/forms/FormLegalDefaultsPanel';
import { FormAppearanceDefaultsPanel } from '@/components/forms/FormAppearanceDefaultsPanel';
import { ParticipationTermsSettingsPanel } from '@/components/signing/ParticipationTermsSettingsPanel';
import { WorkspaceManagementSection } from '@/components/workspaces/WorkspaceManagementSection';
import { useTableOrdering } from '@/components/workspaces/useTableOrdering';
import { tableDate } from '@/lib/workspaces/list-order';
import { DEFAULT_TABLE_PAGE_SIZE, shouldShowTablePagination } from '@/lib/workspaces/table-pagination';
import {
  DEFAULT_TEMPLATE_DOCUMENT_SETTINGS,
  type TemplateDocumentSettings,
} from '@/lib/templates/document-settings';
import {
  createDefaultFormPdfDefaults,
  type FormPdfDefaults,
} from '@/lib/forms/pdf-defaults';
import {
  createDefaultFormExperienceDefaults,
  type FormExperienceDefaults,
} from '@/lib/forms/experience-defaults';
import { createDefaultFormLegalDefaults, type FormLegalDefaults } from '@/lib/forms/legal-field-content';
import { formDefaultsErrorMessage, loadFormDefaults, saveFormDefault } from '@/lib/forms/remote-defaults';
import { createDefaultFormAppearance, type FormAppearance } from '@/lib/forms/schema';

// ─── Types ────────────────────────────────────────────────────────────────────

type Section = 'espacios-trabajo' | 'auditoria' | 'integraciones' | 'regional' | 'notificaciones' | 'almacenamiento' | 'plantillas' | 'formularios' | 'participacion' | 'catalogos';

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

function SettingsSectionHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 border-b border-slate-200/80 pb-4 sm:flex-row sm:items-end sm:justify-between dark:border-slate-700">
      <div className="min-w-0">
        <h1 className="text-2xl font-600 text-slate-950 dark:text-white">{title}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

// ─── Permission definitions ───────────────────────────────────────────────────

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

const DEFAULT_REGIONAL: RegionalSettings = {
  timezone: 'America/Mexico_City',
  date_format: 'DD/MM/YYYY',
  workspace_logo_url: null,
  brand_primary_color: '#6366f1',
  brand_email_header: '',
  portal_name: '',
};

const DATE_FORMATS = [
  { value: 'DD/MM/YYYY', label: 'DD/MM/AAAA (31/12/2025)' },
  { value: 'MM/DD/YYYY', label: 'MM/DD/AAAA (12/31/2025)' },
  { value: 'YYYY-MM-DD', label: 'AAAA-MM-DD (2025-12-31)' },
  { value: 'D [de] MMMM [de] YYYY', label: '31 de diciembre de 2025' },
];

function normalizeRegional(value: Partial<RegionalSettings> | null): RegionalSettings {
  const candidate = value ?? {};
  return {
    timezone: TIMEZONES.find(({ value }) => value === candidate.timezone)?.value ?? DEFAULT_REGIONAL.timezone,
    date_format: DATE_FORMATS.find(({ value }) => value === candidate.date_format)?.value ?? DEFAULT_REGIONAL.date_format,
    workspace_logo_url:
      typeof candidate.workspace_logo_url === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(candidate.workspace_logo_url)
        ? candidate.workspace_logo_url
        : null,
    brand_primary_color: /^#[0-9a-f]{6}$/i.test(candidate.brand_primary_color ?? '')
      ? candidate.brand_primary_color!
      : DEFAULT_REGIONAL.brand_primary_color,
    brand_email_header: typeof candidate.brand_email_header === 'string' ? candidate.brand_email_header.slice(0, 160) : '',
    portal_name: typeof candidate.portal_name === 'string' ? candidate.portal_name.slice(0, 160) : '',
  };
}

function auditDateParts(value: string, settings: RegionalSettings) {
  const date = new Date(value);
  const { timezone: timeZone, date_format: format } = settings;
  const parts = new Intl.DateTimeFormat('es-MX', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (name: 'year' | 'month' | 'day') => parts.find(({ type }) => type === name)?.value ?? '';
  const dateText = format === 'YYYY-MM-DD' ? [part('year'), part('month'), part('day')].join('-')
    : format === 'MM/DD/YYYY' ? [part('month'), part('day'), part('year')].join('/')
    : format === 'D [de] MMMM [de] YYYY' ? date.toLocaleDateString('es-MX', { timeZone, dateStyle: 'long' })
    : [part('day'), part('month'), part('year')].join('/');
  return [dateText, date.toLocaleTimeString('es-MX', { timeZone, hour: '2-digit', minute: '2-digit' })];
}

// ─── Sidebar items ────────────────────────────────────────────────────────────

type SidebarItem =
  | { type: 'section'; id: Section; label: string; icon: React.ElementType }
  | { type: 'link'; href: string; label: string; icon: React.ElementType };

const sidebarSections: { label: string; items: SidebarItem[] }[] = [
  {
    label: 'Principal',
    items: [
      { type: 'section', id: 'espacios-trabajo', label: 'Espacios de trabajo', icon: Building2 },
      { type: 'section', id: 'notificaciones', label: 'Notificaciones', icon: Bell },
    ],
  },
  {
    label: 'Configuración del espacio',
    items: [
      { type: 'section', id: 'plantillas', label: 'Plantillas', icon: FileText },
      { type: 'section', id: 'formularios', label: 'Formularios', icon: FileCog },
      { type: 'section', id: 'catalogos', label: 'Catálogos y etiquetas', icon: Tags },
      { type: 'section', id: 'participacion', label: 'Firma y participación', icon: ShieldCheck },
      { type: 'section', id: 'regional', label: 'Regional y marca', icon: Globe },
      { type: 'section', id: 'almacenamiento', label: 'Almacenamiento', icon: Globe2 },
    ],
  },
  {
    label: 'Seguridad e integraciones',
    items: [
      { type: 'section', id: 'integraciones', label: 'Integraciones y API', icon: Key },
      { type: 'section', id: 'auditoria', label: 'Auditoría y reportes', icon: ShieldCheck },
      { type: 'link', href: '/organizacion/roles', label: 'Delegación y roles', icon: Users },
      {
        type: 'link',
        href: '/configuracion/verificacion-identidad',
        label: 'Verificación de identidad',
        icon: Fingerprint,
      },
    ],
  },
];

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ConfiguracionPage() {
  const { user } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const [activeSection, setActiveSection] = useState<Section>('notificaciones');
  return (
    <WorkspaceConfiguration
      key={`${user?.id}:${activeWorkspace?.id}`}
      activeSection={activeSection}
      setActiveSection={setActiveSection}
    />
  );
}

function WorkspaceConfiguration({
  activeSection,
  setActiveSection,
}: {
  activeSection: Section;
  setActiveSection: (section: Section) => void;
}) {
  const { user } = useAuth();
  const { workspaces, activeWorkspace } = useWorkspace();

  // ── Audit state ─────────────────────────────────────────────────────────────
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditDateFilter, setAuditDateFilter] = useState<'today' | 'week' | '30days' | '90days' | 'all'>('30days');
  const [auditTypeFilter, setAuditTypeFilter] = useState('all');
  const [auditUserFilter, setAuditUserFilter] = useState('');
  const [auditPage, setAuditPage] = useState(1);
  const AUDIT_PAGE_SIZE = DEFAULT_TABLE_PAGE_SIZE;

  const [regional, setRegional] = useState<RegionalSettings>(DEFAULT_REGIONAL);
  const [auditRegional, setAuditRegional] = useState(DEFAULT_REGIONAL);
  const [loadedSettings, setLoadedSettings] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState('');
  const [settingsRevision, setSettingsRevision] = useState(0);
  const [auditResultWorkspace, setAuditResultWorkspace] = useState<string | null>(null);
  const [auditError, setAuditError] = useState('');
  const [templateSaving, setTemplateSaving] = useState(false);
  const [regionalSaving, setRegionalSaving] = useState(false);
  const [regionalSaved, setRegionalSaved] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // ── Template defaults state ────────────────────────────────────────────────
  const [templateDocumentSettings, setTemplateDocumentSettings] =
    useState<TemplateDocumentSettings>(DEFAULT_TEMPLATE_DOCUMENT_SETTINGS);
  const [templateSettingsSaved, setTemplateSettingsSaved] = useState(false);
  const [formPdfDefaults, setFormPdfDefaults] =
    useState<FormPdfDefaults>(createDefaultFormPdfDefaults);
  const [formExperienceDefaults, setFormExperienceDefaults] =
    useState<FormExperienceDefaults>(createDefaultFormExperienceDefaults);
  const [formAppearanceDefaults, setFormAppearanceDefaults] =
    useState<FormAppearance>(createDefaultFormAppearance);
  const [formLegalDefaults, setFormLegalDefaults] = useState<FormLegalDefaults>(createDefaultFormLegalDefaults);
  const [formConfigTab, setFormConfigTab] = useState<'general' | 'legal' | 'web' | 'pdf'>('general');
  const [formExperienceSaved, setFormExperienceSaved] = useState(false);
  const [formDefaultsSaved, setFormDefaultsSaved] = useState(false);
  const [formDefaultsError, setFormDefaultsError] = useState('');
  const [formDefaultsLoadedWorkspaceId, setFormDefaultsLoadedWorkspaceId] = useState<string | null>(null);

  const currentWsId = activeWorkspace?.id || workspaces[0]?.id || null;

  const canEditWorkspace = Boolean(activeWorkspace &&
    (activeWorkspace.ownerId === user?.id || activeWorkspace.role === 'owner' || activeWorkspace.role === 'admin'));

  const loadAuditEvents = useCallback(async (isCurrent: () => boolean) => {
    if (!user || !currentWsId || !canEditWorkspace) return;
    setAuditLoading(true);
    setAuditError('');
    setAuditPage(1);
    try {
      const client = createClient();
      const [{ data, error }, regionalSettings] = await Promise.all([
        client
          .from('security_audit_chain')
          .select('id, event_type:action, user_id:actor_id, ip_address, user_agent, created_at, metadata')
          .eq('workspace_id', currentWsId)
          .order('created_at', { ascending: false })
          .limit(500),
        client.from('workspace_ui_settings').select('value')
          .eq('workspace_id', currentWsId).eq('kind', 'regional').maybeSingle(),
      ]);
      if (error) throw error;
      if (isCurrent()) {
        setAuditEvents(data as AuditEvent[]);
        setAuditRegional(normalizeRegional(regionalSettings.data?.value));
        setAuditResultWorkspace(currentWsId);
      }
    } catch {
      if (isCurrent()) {
        setAuditEvents([]);
        setAuditError('No se pudo consultar la auditoría de este espacio.');
      }
    } finally {
      if (isCurrent()) setAuditLoading(false);
    }
  }, [user, currentWsId, canEditWorkspace]);

  const loadWorkspaceSettings = useCallback(async (isCurrent: () => boolean) => {
    if (!currentWsId || (activeSection !== 'regional' && activeSection !== 'plantillas')) return;
    setLoadedSettings(null);
    setSettingsError('');
    try {
      if (activeSection === 'plantillas') {
        const settings = await loadTemplateDocumentSettings(currentWsId);
        if (!isCurrent()) return;
        setTemplateDocumentSettings(settings);
      } else {
        const { data, error } = await createClient()
          .from('workspace_ui_settings')
          .select('value')
          .eq('workspace_id', currentWsId)
          .eq('kind', 'regional')
          .maybeSingle();
        if (error) throw error;
        if (!isCurrent()) return;
        let legacy: Partial<RegionalSettings> = {};
        if (!data) {
          try {
            legacy = JSON.parse(localStorage.getItem('docubox_regional_' + currentWsId) || '{}');
          } catch { /* El valor inicial sigue disponible. */ }
        }
        setRegional(normalizeRegional(data?.value ?? legacy));
      }
      setLoadedSettings(currentWsId + ':' + activeSection);
    } catch {
      if (isCurrent()) setSettingsError('No se pudo cargar la configuración de este espacio.');
    }
  }, [activeSection, currentWsId]);

  const loadFormPdfDefaults = useCallback(async (isCurrent: () => boolean) => {
    if (!currentWsId) return;
    setFormDefaultsLoadedWorkspaceId(null);
    try {
      const defaults = await loadFormDefaults(currentWsId);
      if (!isCurrent()) return;
      setFormPdfDefaults(defaults.pdf);
      setFormExperienceDefaults(defaults.experience);
      setFormAppearanceDefaults(defaults.appearance);
      setFormLegalDefaults(defaults.legal);
      setFormExperienceSaved(true);
      setFormDefaultsError('');
      setFormDefaultsLoadedWorkspaceId(currentWsId);
    } catch (error) {
      if (!isCurrent()) return;
      setFormDefaultsError(formDefaultsErrorMessage(error));
      setFormDefaultsLoadedWorkspaceId(currentWsId);
    }
  }, [currentWsId]);

  useEffect(() => {
    let active = true;
    const frame = window.requestAnimationFrame(() => {
      if (activeSection === 'auditoria') void loadAuditEvents(() => active);
      void loadWorkspaceSettings(() => active);
      if (activeSection === 'formularios') void loadFormPdfDefaults(() => active);
    });
    return () => { active = false; window.cancelAnimationFrame(frame); };
  }, [activeSection, loadAuditEvents, loadWorkspaceSettings, loadFormPdfDefaults, settingsRevision]);

  // ─── Helpers ────────────────────────────────────────────────────────────────

  const handleSaveRegional = async () => {
    if (!currentWsId || !canEditWorkspace || regionalSaving || logoUploading) return;
    if (!/^#[0-9a-f]{6}$/i.test(regional.brand_primary_color)) {
      setSettingsError('Escribe un color hexadecimal de seis dígitos.');
      return;
    }
    setRegionalSaving(true);
    setSettingsError('');
    setRegionalSaved(false);
    try {
      const { error } = await createClient()
        .from('workspace_ui_settings')
        .upsert({ workspace_id: currentWsId, kind: 'regional', value: normalizeRegional(regional) })
        .select('workspace_id')
        .single();
      if (error) throw error;
      setRegionalSaved(true);
      setTimeout(() => setRegionalSaved(false), 3000);
    } catch {
      setSettingsError('No se pudo guardar la configuración regional.');
    } finally {
      setRegionalSaving(false);
    }
  };

  const handleSaveTemplateDocumentSettings = async (settings: TemplateDocumentSettings) => {
    if (!currentWsId || !canEditWorkspace || templateSaving) return;
    setTemplateSaving(true);
    setSettingsError('');
    setTemplateSettingsSaved(false);
    try {
      const saved = await saveTemplateDocumentSettings(currentWsId, settings);
      setTemplateDocumentSettings(saved);
      setTemplateSettingsSaved(true);
      setTimeout(() => setTemplateSettingsSaved(false), 3000);
    } catch {
      setSettingsError('No se pudieron guardar los valores predeterminados de plantillas.');
    } finally {
      setTemplateSaving(false);
    }
  };

  const handleSaveFormPdfDefaults = async (settings: FormPdfDefaults) => {
    try {
      if (!currentWsId) throw new Error('Selecciona un espacio de trabajo.');
      setFormPdfDefaults(await saveFormDefault(currentWsId, 'pdf', settings));
      setFormDefaultsError('');
      setFormDefaultsSaved(true);
      setTimeout(() => setFormDefaultsSaved(false), 3000);
    } catch (error) {
      setFormDefaultsError(formDefaultsErrorMessage(error));
    }
  };

  const handleSaveFormExperienceDefaults = async (settings: FormExperienceDefaults) => {
    try {
      if (!currentWsId) throw new Error('Selecciona un espacio de trabajo.');
      setFormExperienceDefaults(await saveFormDefault(currentWsId, 'experience', settings));
      setFormExperienceSaved(true);
      setFormDefaultsError('');
      setFormDefaultsSaved(true);
      setTimeout(() => setFormDefaultsSaved(false), 3000);
    } catch (error) {
      setFormDefaultsError(formDefaultsErrorMessage(error));
    }
  };

  const handleSaveFormAppearanceDefaults = async (appearance: FormAppearance) => {
    try {
      if (!currentWsId) throw new Error('Selecciona un espacio de trabajo.');
      setFormAppearanceDefaults(await saveFormDefault(currentWsId, 'appearance', appearance));
      setFormDefaultsError('');
      setFormDefaultsSaved(true);
      setTimeout(() => setFormDefaultsSaved(false), 3000);
    } catch (error) {
      setFormDefaultsError(formDefaultsErrorMessage(error));
    }
  };

  const handleSaveFormLegalDefaults = async (settings: FormLegalDefaults) => {
    try {
      if (!currentWsId) throw new Error('Selecciona un espacio de trabajo.');
      setFormLegalDefaults(await saveFormDefault(currentWsId, 'legal', settings));
      setFormDefaultsError('');
      setFormDefaultsSaved(true);
      setTimeout(() => setFormDefaultsSaved(false), 3000);
    } catch (error) {
      setFormDefaultsError(formDefaultsErrorMessage(error));
    }
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

  const filteredAudit = auditResultWorkspace === currentWsId ? filterAuditByUser(filterAuditByType(filterAuditByDate(auditEvents))) : [];
  const { orderedRows: orderedAudit, sortHeading } = useTableOrdering(filteredAudit, {
    date: (event) => tableDate(event.created_at),
    event: (event) => getAuditEventLabel(event.event_type),
    user: (event) => event.user_id,
  }, () => setAuditPage(1));
  const auditTotalPages = Math.max(1, Math.ceil(filteredAudit.length / AUDIT_PAGE_SIZE));
  const pagedAudit = orderedAudit.slice((auditPage - 1) * AUDIT_PAGE_SIZE, auditPage * AUDIT_PAGE_SIZE);

  // ─── Section renderers ───────────────────────────────────────────────────────

  const renderAuditoria = () => (
    <div className="flex flex-col gap-6">
      <SettingsSectionHeader
        title="Auditoría y reportes"
        description="Consulta y filtra eventos de seguridad por usuario, acción y fecha."
        actions={<button
          disabled={auditLoading || !filteredAudit.length}
          onClick={() => {
            const csv = ['Fecha,Hora,Evento,Usuario,IP,Dispositivo']
              .concat(orderedAudit.map(ev => {
                return [
                  ...auditDateParts(ev.created_at, auditRegional),
                  getAuditEventLabel(ev.event_type),
                  ev.user_id || '—',
                  ev.ip_address || '—',
                  ev.user_agent ? ev.user_agent.substring(0, 40) : '—',
                ].map((value) => {
                  const text = /^[\s=+@-]/.test(value) ? "'" + value : value;
                  return '"' + text.replace(/"/g, '""') + '"';
                }).join(',');
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
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-600 text-slate-700 transition-colors hover:bg-slate-50"
        >
          <Download size={14} />
          Exportar CSV
        </button>}
      />

      {/* Filters */}
      <div className="bg-white border border-border rounded-xl p-5 flex flex-col gap-4">
        <h3 className="text-sm font-600 text-primary flex items-center gap-2"><Filter size={15} />Filtros</h3>
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
        {auditError ? (
          <p role="alert" className="p-4 text-sm text-destructive">{auditError} <button type="button" className="underline" onClick={() => setSettingsRevision((revision) => revision + 1)}>Reintentar</button></p>
        ) : filteredAudit.length === 0 && !auditLoading ? (
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
                <thead className="workspace-table-heading">
                  <tr className="bg-gray-50 border-b border-border">
                    <th className="text-left px-4 py-3 whitespace-nowrap" {...sortHeading('date', 'Fecha y hora')} />
                    <th className="text-left px-4 py-3 whitespace-nowrap" {...sortHeading('event', 'Evento')} />
                    <th className="text-left px-4 py-3 whitespace-nowrap" {...sortHeading('user', 'Usuario')} />
                    <th className="text-left px-4 py-3 text-xs font-600 text-muted-foreground whitespace-nowrap">IP</th>
                    <th className="text-left px-4 py-3 text-xs font-600 text-muted-foreground whitespace-nowrap">Dispositivo</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedAudit.map((ev, idx) => {
                    const [dateStr, timeStr] = auditDateParts(ev.created_at, auditRegional);
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
            {shouldShowTablePagination(filteredAudit.length) && (
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

  const renderRegional = () => (
    <div className="flex flex-col gap-6">
      <SettingsSectionHeader
        title="Regional y marca blanca"
        description="Configura zona horaria, formato de fecha e identidad visual del espacio de trabajo."
        actions={
          <button
            onClick={handleSaveRegional}
            disabled={!canEditWorkspace || regionalSaving || logoUploading}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-600 text-white transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {regionalSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Guardar configuración
          </button>
        }
      />

      {regionalSaved && <BottomNotice message="Configuración regional y de marca guardada correctamente." tone="success" onClose={() => setRegionalSaved(false)} />}

      {/* Regional settings */}
      <div className="bg-white border border-border rounded-xl p-5 flex flex-col gap-4">
        <h3 className="text-sm font-600 text-primary flex items-center gap-2"><Globe2 size={15} />Configuración Regional</h3>
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
            <p className="text-xs text-muted-foreground mt-1">Formato de las fechas en la auditoría y sus exportaciones.</p>
          </div>
        </div>
      </div>

      {/* Branding */}
      <div className="bg-white border border-border rounded-xl p-5 flex flex-col gap-4">
        <h3 className="text-sm font-600 text-primary flex items-center gap-2"><Palette size={15} />Marca Blanca del Workspace</h3>
        <p className="text-xs text-muted-foreground">Guarda una vista previa de marca para este espacio.</p>
        {activeWorkspace?.organizationEnabled && (
          <Link href="/organizacion/marca-comunicaciones" className="w-fit text-sm font-medium text-primary hover:underline">
            Administrar marca y comunicaciones de la organización
          </Link>
        )}

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
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              e.target.value = '';
              if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 500 * 1024) {
                setSettingsError('Elige una imagen PNG, JPG o WebP de hasta 500 KB.');
                return;
              }
              setSettingsError('');
              setLogoUploading(true);
              try {
                const reader = new FileReader();
                reader.onload = (ev) => {
                  setRegional(r => ({ ...r, workspace_logo_url: ev.target?.result as string }));
                  setLogoUploading(false);
                };
                reader.onerror = () => {
                  setLogoUploading(false);
                  setSettingsError('No se pudo leer la imagen.');
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
          <p className="text-xs text-muted-foreground mt-1">Nombre que se muestra en la vista previa de marca.</p>
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
          <p className="text-xs text-muted-foreground mt-1">Color de acento de la vista previa.</p>
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
          <p className="text-xs text-muted-foreground mt-1">Texto que se muestra en la vista previa del encabezado.</p>
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
              <p className="text-sm font-600 text-foreground">{regional.brand_email_header || regional.portal_name || 'Tu Empresa · Firma Digital'}</p>
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

  const renderPlantillas = () => (
    <div className="flex flex-col gap-6">
      <SettingsSectionHeader
        title="Configuración de plantillas"
        description="Define los valores predeterminados que se aplicarán al crear nuevas plantillas."
      />

      {templateSettingsSaved && <BottomNotice message="Configuración de plantillas guardada correctamente." tone="success" onClose={() => setTemplateSettingsSaved(false)} />}

      <div className="max-w-xl">
        <TemplateDocumentSettingsPanel
          key={JSON.stringify(templateDocumentSettings)}
          initialSettings={templateDocumentSettings}
          onSave={handleSaveTemplateDocumentSettings}
          title="Valores predeterminados"
          description="Se aplican a las nuevas plantillas de este espacio de trabajo."
        />
      </div>
    </div>
  );

  const renderFormularios = () => (
    <div className="flex flex-col gap-6">
      <SettingsSectionHeader
        title="Configuración de formularios"
        description="Define la experiencia, los textos legales, el diseño web y el PDF de los formularios nuevos."
      />
      {formDefaultsSaved && formDefaultsLoadedWorkspaceId === currentWsId && <BottomNotice message="Configuración de formularios guardada correctamente." tone="success" onClose={() => setFormDefaultsSaved(false)} />}
      {formDefaultsError && formDefaultsLoadedWorkspaceId === currentWsId && (
        <BottomNotice message={formDefaultsError} tone="critical" onClose={() => setFormDefaultsError('')} />
      )}
      {currentWsId && formDefaultsLoadedWorkspaceId !== currentWsId ? (
        <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Cargando configuración guardada...</div>
      ) : <>
      <div role="tablist" aria-label="Valores predeterminados de formularios" className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {([
          ['general', 'General'],
          ['legal', 'Consentimientos y declaraciones'],
          ['web', 'Diseño del formulario'],
          ['pdf', 'Diseño del PDF'],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={formConfigTab === id} onClick={() => setFormConfigTab(id)} className={'shrink-0 border-b-2 px-4 py-3 text-sm font-medium ' + (formConfigTab === id ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-800')}>
            {label}
          </button>
        ))}
      </div>
      {formConfigTab === 'general' && <div className="w-full max-w-4xl min-w-0" role="tabpanel">
        <FormExperienceDefaultsPanel
          key={`experience:${currentWsId || 'personal'}:${JSON.stringify(formExperienceDefaults)}`}
          initialSettings={formExperienceDefaults}
          saved={formExperienceSaved}
          onSave={handleSaveFormExperienceDefaults}
        />
      </div>}
      {formConfigTab === 'legal' && <div className="w-full max-w-4xl min-w-0" role="tabpanel">
        <FormLegalDefaultsPanel
          key={`legal:${currentWsId || 'personal'}:${JSON.stringify(formLegalDefaults)}`}
          initialSettings={formLegalDefaults}
          onSave={handleSaveFormLegalDefaults}
        />
      </div>}
      {formConfigTab === 'web' && <div className="w-full min-w-0" role="tabpanel">
        <FormAppearanceDefaultsPanel
          key={`appearance:${currentWsId || 'personal'}:${JSON.stringify(formAppearanceDefaults)}`}
          initialSettings={formAppearanceDefaults}
          saved={!formDefaultsError}
          onSave={handleSaveFormAppearanceDefaults}
        />
      </div>}
      {formConfigTab === 'pdf' && <div className="w-full min-w-0" role="tabpanel">
        <FormPdfDefaultsPanel
          key={`${currentWsId || 'personal'}:${JSON.stringify(formPdfDefaults)}`}
          initialSettings={formPdfDefaults}
          saved={!formDefaultsError}
          onSave={handleSaveFormPdfDefaults}
        />
      </div>}
      </>}
    </div>
  );

  const renderWorkspaceSettings = (render: () => React.ReactNode) => {
    if (!currentWsId) return <p className="text-sm text-muted-foreground">Selecciona un espacio de trabajo.</p>;
    const ready = loadedSettings === currentWsId + ':' + activeSection;
    return (
      <div className="space-y-4">
        {settingsError && <p role="alert" className="text-sm text-destructive">{settingsError} {!ready && <button type="button" className="underline" onClick={() => setSettingsRevision((revision) => revision + 1)}>Reintentar</button>}</p>}
        {!ready && !settingsError && <p role="status" className="text-sm text-muted-foreground">Cargando configuración…</p>}
        {ready && !canEditWorkspace && <p className="text-sm text-muted-foreground">Solo los administradores pueden modificar estos valores.</p>}
        {ready && <fieldset className="min-w-0" disabled={!canEditWorkspace || templateSaving || regionalSaving}>{render()}</fieldset>}
      </div>
    );
  };

  const renderContent = () => {
    switch (activeSection) {
      case 'espacios-trabajo': return <WorkspaceManagementSection />;
      case 'notificaciones': return user ? <NotificationPreferencesPanel key={user.id} userId={user.id} /> : null;
      case 'auditoria': return canEditWorkspace ? renderAuditoria() : (
        <SettingsSectionHeader title="Auditoría y reportes" description="Los administradores pueden consultar los eventos de seguridad del espacio." />
      );
      case 'integraciones': return activeWorkspace?.organizationEnabled ? (
        <OrganizationAdvancedAdministration key={activeWorkspace.id} section="integraciones" />
      ) : (
        <SettingsSectionHeader title="Integraciones y API" description="Las claves de API y los webhooks se administran desde un espacio de organización habilitado." />
      );
      case 'almacenamiento': return renderAlmacenamiento();
      case 'plantillas': return renderWorkspaceSettings(renderPlantillas);
      case 'formularios': return renderFormularios();
      case 'catalogos': return user ? <CatalogSettingsPanel key={user.id} userId={user.id} /> : null;
      case 'participacion': return <div className="flex flex-col gap-6">
        <SettingsSectionHeader title="Firma y participación" description="Configura las condiciones que aceptarán los participantes de los documentos nuevos." />
        {currentWsId ? <ParticipationTermsSettingsPanel key={currentWsId} workspaceId={currentWsId} />
          : <p className="text-sm text-slate-500">Selecciona un espacio de trabajo para configurar sus términos.</p>}
      </div>;
      case 'regional': return renderWorkspaceSettings(renderRegional);
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
        <SettingsSectionHeader
          title="Almacenamiento en la nube"
          description="Conecta servicios para importar y exportar documentos."
        />

        {/* Info */}
        <div className="bg-gray-50 border border-border rounded-xl px-4 py-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            La importación y exportación desde un proveedor externo se habilitará cuando se configure su integración.
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
                  <p className="text-sm font-600 text-foreground">{integ.name}</p>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">No conectado</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{integ.desc}</p>
              <button type="button" disabled className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground">
                <Link2 size={14} />
                Conexión sin configurar
              </button>
            </div>
          ))}
        </div>

        {/* Connected accounts placeholder */}
        <div className="bg-white border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border bg-muted/30">
            <h3 className="text-sm font-600 text-foreground">Cuentas conectadas</h3>
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

  return (
    <AppLayout noPadding>
      <div className="app-page-bleed app-page-frame bg-[#F5F7FA] xl:flex xl:flex-col dark:bg-slate-950">
        <div className="workspace-layout app-page-width flex flex-col gap-4 xl:flex-1 xl:flex-row xl:gap-6">
          <ResponsiveSidebar
            label="Secciones de configuración"
            className="workspace-sidebar flex w-full shrink-0 flex-col rounded-lg border border-slate-200 bg-white md:w-60 2xl:w-64 dark:border-border dark:bg-card"
          >
            <nav className="flex flex-row gap-1 overflow-x-auto p-2 md:flex-col md:gap-0.5 md:overflow-x-visible md:px-2.5 md:pb-3 md:pt-3">
              {sidebarSections.map((section, sectionIndex) => (
                <div key={section.label} className="contents md:block">
                  <div className={`mb-1 hidden px-2 md:block ${sectionIndex > 0 ? 'md:mt-3' : ''}`}>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                      {section.label}
                    </p>
                  </div>
                  {section.items.map((item) => {
                    if (item.type === 'link') {
                      if (item.href === '/organizacion/roles' && !activeWorkspace?.organizationEnabled) return null;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className="flex h-10 flex-shrink-0 items-center gap-2.5 whitespace-nowrap rounded-md px-3 text-left text-sm font-600 text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-950 md:h-auto md:w-full md:py-2 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                        >
                          <item.icon
                            size={16}
                            className="flex-shrink-0 text-slate-400 dark:text-slate-500"
                          />
                          <span>{item.label}</span>
                        </Link>
                      );
                    }

                    const isActive = activeSection === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => setActiveSection(item.id)}
                        aria-current={isActive ? 'page' : undefined}
                        className={`flex h-10 flex-shrink-0 items-center gap-2.5 whitespace-nowrap rounded-md px-3 text-left text-sm font-600 transition-colors md:h-auto md:w-full md:py-2 ${
                          isActive
                            ? 'bg-primary/10 text-primary dark:bg-blue-950/50 dark:text-blue-300'
                            : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                        }`}
                      >
                        <item.icon
                          size={16}
                          className={`flex-shrink-0 ${isActive ? 'text-primary dark:text-blue-300' : 'text-slate-400 dark:text-slate-500'}`}
                        />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </nav>
          </ResponsiveSidebar>

          <main className="min-w-0 flex-1 dark:[&_.bg-gray-50]:bg-slate-800 dark:[&_.bg-gray-100]:bg-slate-800 dark:[&_.bg-white]:bg-slate-900 dark:[&_.border-border]:border-slate-700 [&_.rounded-xl]:rounded-lg">
            {renderContent()}
          </main>
        </div>
      </div>
    </AppLayout>
  );
}
