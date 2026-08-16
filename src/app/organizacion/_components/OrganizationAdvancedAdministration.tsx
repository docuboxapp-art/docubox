'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, BadgeCheck, BellRing, Building2, Check, CheckCircle2,
  CircleAlert, Clipboard, CloudCog, Code2, Copy, CreditCard, Database, FileKey2,
  Eye, EyeOff, Fingerprint, Globe2, KeyRound, Laptop, Link2, Loader2, LockKeyhole, Mail,
  Network, Palette, Plus, ReceiptText, RefreshCw, Save, ScrollText, Send,
  ServerCog, ShieldCheck, Smartphone, Trash2, Users, Webhook, X,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';

export type AdvancedSection = 'seguridad' | 'certificados' | 'integraciones' | 'marca-comunicaciones' | 'plan-consumo' | 'auditoria';
type Row = Record<string, any>;
type SensitiveAction = {
  action: 'save_security_settings' | 'save_network' | 'save_alert' | 'revoke_session' | 'create_certificate' | 'integration_request';
  scope: 'security.manage' | 'certificates.manage' | 'integrations.manage';
  payload: Row;
  success: string;
  endpoint?: string;
  method?: 'POST' | 'PATCH';
  revealSecret?: boolean;
};

const sectionMeta: Record<AdvancedSection, { title: string; description: string; icon: typeof ShieldCheck }> = {
  seguridad: { title: 'Seguridad', description: 'Acceso, sesiones, restricciones y alertas de la organización.', icon: ShieldCheck },
  certificados: { title: 'Certificados e infraestructura', description: 'Metadatos públicos, vigencias y estado criptográfico verificable.', icon: ScrollText },
  integraciones: { title: 'Integraciones y API', description: 'Aplicaciones, credenciales y webhooks autorizados.', icon: Network },
  'marca-comunicaciones': { title: 'Marca y comunicaciones', description: 'Identidad visual, remitentes y mensajes organizacionales.', icon: Palette },
  'plan-consumo': { title: 'Plan, consumo y centros de costo', description: 'Uso auditable, límites y distribución económica.', icon: ReceiptText },
  auditoria: { title: 'Auditoría organizacional', description: 'Eventos administrativos y de seguridad sin capacidad de edición.', icon: Activity },
};

const permissionFor: Record<AdvancedSection, { read: string; manage?: string }> = {
  seguridad: { read: 'security.read', manage: 'security.manage' },
  certificados: { read: 'certificates.read', manage: 'certificates.manage' },
  integraciones: { read: 'integrations.read', manage: 'integrations.manage' },
  'marca-comunicaciones': { read: 'branding.read', manage: 'branding.manage' },
  'plan-consumo': { read: 'billing.read', manage: 'billing.manage' },
  auditoria: { read: 'audit.read' },
};

const signatureMethods = [
  ['totp', 'TOTP'], ['webauthn', 'Passkey / WebAuthn'], ['otp_email', 'OTP por correo'],
] as const;
const apiScopes = ['documents.read', 'documents.write', 'signatures.read', 'signatures.write', 'forms.read', 'cases.read', 'identity.read', 'webhooks.manage'];
const webhookEvents = ['document.created', 'document.sent', 'document.viewed', 'document.rejected', 'document.cancelled', 'document.completed', 'signature.started', 'signature.completed', 'identity.completed', 'identity.review_required', 'case.opened', 'case.closed', 'certificate.expiring', 'member.invited', 'member.activated', 'member.suspended'];

function formatDate(value?: string | null, dateOnly = false) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('es-MX', dateOnly ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}

function humanize(value?: string | null) {
  const labels: Record<string, string> = {
    active: 'Activo', valid: 'Válido', pending: 'Pendiente', connected: 'Conectado',
    sandbox: 'Sandbox', production: 'Producción', degraded: 'Degradado', disabled: 'Deshabilitado',
    revoked: 'Revocado', expired: 'Vencido', expiring: 'Próximo a vencer', invalid: 'Inválido',
    failed: 'Fallido', delivered: 'Entregado', normal: 'Normal', stale: 'Sin actividad',
    success: 'Correcto', denied: 'Denegado', partial: 'Parcial', verified: 'Verificado',
    metadata_only: 'Solo metadatos', local_temporary: 'Local temporal', not_configured: 'No configurado',
  };
  return labels[value || ''] || value?.replaceAll('_', ' ') || 'Sin estado';
}

function Status({ value }: { value?: string | null }) {
  const good = ['active', 'valid', 'connected', 'delivered', 'normal', 'success', 'verified'].includes(value || '');
  const warning = ['pending', 'sandbox', 'expiring', 'stale', 'partial', 'degraded'].includes(value || '');
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${good ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300' : warning ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300' : 'border-border bg-muted text-muted-foreground'}`}><span className={`h-1.5 w-1.5 rounded-full ${good ? 'bg-emerald-500' : warning ? 'bg-amber-500' : 'bg-muted-foreground'}`} />{humanize(value)}</span>;
}

function Header({ section, actions }: { section: AdvancedSection; actions?: React.ReactNode }) {
  const meta = sectionMeta[section];
  return <div className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-2xl font-medium text-foreground">{meta.title}</h2><p className="mt-1 text-sm text-muted-foreground">{meta.description}</p></div>{actions}</div>;
}

function Tabs({ items, value, onChange }: { items: [string, string][]; value: string; onChange: (value: string) => void }) {
  return <div className="flex gap-1 overflow-x-auto border-b border-border" role="tablist">{items.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={value === key} onClick={() => onChange(key)} className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm transition-colors ${value === key ? 'border-primary text-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{label}</button>)}</div>;
}

function Empty({ icon: Icon, title, text }: { icon: typeof ShieldCheck; title: string; text: string }) {
  return <div className="px-5 py-14 text-center"><Icon size={28} className="mx-auto text-muted-foreground" /><p className="mt-3 text-sm font-medium text-foreground">{title}</p><p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{text}</p></div>;
}

function Notice({ error, success }: { error: string; success: string }) {
  return <>{error && <div role="alert" className="flex gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"><CircleAlert size={17} className="shrink-0" />{error}</div>}{success && <div className="flex gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"><Check size={17} className="shrink-0" />{success}</div>}</>;
}

function Toggle({ checked, disabled, onChange, title, description }: { checked: boolean; disabled?: boolean; onChange: (value: boolean) => void; title: string; description?: string }) {
  return <label className="flex cursor-pointer items-start gap-3 px-5 py-4"><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="peer sr-only" /><span className="mt-0.5 flex h-5 w-9 shrink-0 rounded-full bg-muted p-0.5 transition peer-checked:bg-primary peer-disabled:opacity-50"><span className={`h-4 w-4 rounded-full bg-white shadow-sm transition ${checked ? 'translate-x-4' : ''}`} /></span><span><span className="block text-sm font-medium text-foreground">{title}</span>{description && <span className="mt-0.5 block text-sm text-muted-foreground">{description}</span>}</span></label>;
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true"><div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg border border-border bg-background shadow-xl"><div className="sticky top-0 z-10 flex items-center border-b border-border bg-background px-5 py-4"><h3 className="flex-1 text-lg font-medium">{title}</h3><button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-muted" aria-label="Cerrar"><X size={18} /></button></div>{children}</div></div>;
}

export default function OrganizationAdvancedAdministration({ section }: { section: AdvancedSection }) {
  const supabase = useMemo(() => createClient(), []);
  const { activeWorkspace } = useWorkspace();
  const { user, session } = useAuth();
  const [permissions, setPermissions] = useState<string[]>([]);
  const [tab, setTab] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [workspace, setWorkspace] = useState<Row>({});
  const [rows, setRows] = useState<Row[]>([]);
  const [extra, setExtra] = useState<Row[]>([]);
  const [third, setThird] = useState<Row[]>([]);
  const [addonSubscriptions, setAddonSubscriptions] = useState<Row[]>([]);
  const [overview, setOverview] = useState<Row>({});
  const [modal, setModal] = useState('');
  const [form, setForm] = useState<Row>({});
  const [revealedSecret, setRevealedSecret] = useState('');
  const [selectedAudit, setSelectedAudit] = useState<Row | null>(null);
  const [auditQuery, setAuditQuery] = useState('');
  const [pendingSensitiveAction, setPendingSensitiveAction] = useState<SensitiveAction | null>(
    null
  );
  const [reauthPassword, setReauthPassword] = useState('');
  const [reauthError, setReauthError] = useState('');
  const [showReauthPassword, setShowReauthPassword] = useState(false);
  const elevated = activeWorkspace?.role === 'owner' || activeWorkspace?.role === 'admin';
  const access = permissionFor[section];
  const canRead = elevated || permissions.includes(access.read);
  const canManage = Boolean(access.manage && (elevated || permissions.includes(access.manage)));

  const api = useCallback(
    async (path: string, init?: RequestInit) => {
      const response = await fetch(path, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || ''}`,
          ...(init?.headers || {}),
        },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const failure: any = new Error(payload.error || 'No se pudo completar la operación.');
        failure.code = payload.code;
        throw failure;
      }
      return payload;
    },
    [session?.access_token]
  );

  const load = useCallback(async () => {
    if (!activeWorkspace?.id) return;
    setLoading(true);
    setError('');
    const id = activeWorkspace.id;
    try {
      const permissionResult = await supabase.rpc('get_my_organization_permissions', { ws_id: id });
      const keys = (permissionResult.data || []).map((item: Row) => item.permission_key);
      setPermissions(keys);
      if (!elevated && !keys.includes(permissionFor[section].read)) {
        setRows([]);
        setExtra([]);
        return;
      }

      if (section === 'seguridad') {
        const [ws, sessions, networks, alerts, integrations] = await Promise.all([
          supabase.from('workspaces').select('id,security_settings').eq('id', id).single(),
          supabase.rpc('get_organization_security_sessions', { ws_id: id }),
          supabase
            .from('organization_trusted_networks')
            .select('*')
            .eq('workspace_id', id)
            .order('created_at', { ascending: false }),
          supabase
            .from('organization_security_alert_rules')
            .select('*')
            .eq('workspace_id', id)
            .order('display_name'),
          supabase
            .from('organization_integrations')
            .select('*')
            .eq('workspace_id', id)
            .in('integration_type', ['sso', 'scim'])
            .order('display_name'),
        ]);
        if (ws.error) throw ws.error;
        setWorkspace(ws.data || {});
        setRows(sessions.data || []);
        setExtra(networks.data || []);
        setThird(alerts.data || []);
        setOverview({ integrations: integrations.data || [] });
      } else if (section === 'certificados') {
        const [certificates, cryptoOverview, permissionsResult] = await Promise.all([
          supabase
            .from('organization_certificates')
            .select('*')
            .eq('workspace_id', id)
            .order('created_at', { ascending: false }),
          supabase.rpc('get_organization_crypto_overview', { ws_id: id }),
          supabase
            .from('organization_certificate_permissions')
            .select('*')
            .eq('workspace_id', id)
            .order('created_at', { ascending: false }),
        ]);
        if (certificates.error) throw certificates.error;
        setRows(certificates.data || []);
        setExtra(permissionsResult.data || []);
        setOverview(cryptoOverview.data || {});
      } else if (section === 'integraciones') {
        const [integrations, keys, webhooks, deliveries] = await Promise.all([
          supabase
            .from('organization_integrations')
            .select('*')
            .eq('workspace_id', id)
            .order('display_name'),
          api(`/api/organizacion/api-keys?workspace_id=${encodeURIComponent(id)}`),
          api(`/api/organizacion/webhooks?workspace_id=${encodeURIComponent(id)}`),
          supabase
            .from('organization_webhook_deliveries')
            .select('*')
            .eq('workspace_id', id)
            .order('created_at', { ascending: false })
            .limit(100),
        ]);
        if (integrations.error) throw integrations.error;
        setRows(integrations.data || []);
        setExtra(keys.data || []);
        setThird(webhooks.data || []);
        setOverview({ deliveries: deliveries.data || [] });
      } else if (section === 'marca-comunicaciones') {
        const [ws, templates, domains] = await Promise.all([
          supabase.from('workspaces').select('id,name,branding_settings').eq('id', id).single(),
          supabase
            .from('organization_communication_templates')
            .select('*')
            .eq('workspace_id', id)
            .order('updated_at', { ascending: false }),
          supabase
            .from('organization_sender_domains')
            .select('*')
            .eq('workspace_id', id)
            .order('created_at', { ascending: false }),
        ]);
        if (ws.error) throw ws.error;
        setWorkspace(ws.data || {});
        setRows(templates.data || []);
        setExtra(domains.data || []);
      } else if (section === 'plan-consumo') {
        const [subscription, usage, centers, addons] = await Promise.all([
          supabase
            .from('subscriptions')
            .select('*,subscription_plans(name,slug,documents_included,features)')
            .eq('workspace_id', id)
            .maybeSingle(),
          supabase
            .from('organization_usage_ledger')
            .select('*')
            .eq('workspace_id', id)
            .order('occurred_at', { ascending: false })
            .limit(500),
          supabase
            .from('organization_cost_centers')
            .select('*')
            .eq('workspace_id', id)
            .order('code'),
          supabase
            .from('organization_addon_subscriptions')
            .select('*,addon_products(name,product_key)')
            .eq('workspace_id', id)
            .order('created_at', { ascending: false }),
        ]);
        if (subscription.error) throw subscription.error;
        if (addons.error) throw addons.error;
        setWorkspace(subscription.data || {});
        setRows(usage.data || []);
        setExtra(centers.data || []);
        setAddonSubscriptions(addons.data || []);
      } else {
        const result = await supabase
          .from('organization_audit_events')
          .select('*')
          .eq('workspace_id', id)
          .order('occurred_at', { ascending: false })
          .limit(500);
        if (result.error) throw result.error;
        setRows(result.data || []);
      }
    } catch (cause: any) {
      setError(cause?.message || 'No se pudo cargar la información.');
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace?.id, api, elevated, section, supabase]);

  useEffect(() => {
    setTab('');
    setModal('');
    setRevealedSecret('');
    load();
  }, [load]);

  const audit = async (
    eventType: string,
    resourceType: string,
    resourceId: string | null,
    summary: string,
    payload: Row = {}
  ) => {
    if (!activeWorkspace?.id || !user?.id) return;
    await supabase
      .from('organization_audit_events')
      .insert({
        workspace_id: activeWorkspace.id,
        actor_user_id: user.id,
        event_type: eventType,
        resource_type: resourceType,
        resource_id: resourceId,
        summary,
        payload,
        module: section,
      });
  };

  const finish = async (message: string) => {
    setSuccess(message);
    setModal('');
    setForm({});
    await load();
  };
  const fail = (cause: any) => setError(cause?.message || 'No se pudo completar la operación.');

  const requestSensitiveAction = (pending: SensitiveAction) => {
    setModal('');
    setPendingSensitiveAction(pending);
    setReauthPassword('');
    setReauthError('');
    setShowReauthPassword(false);
  };

  const confirmSensitiveAction = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeWorkspace?.id || !pendingSensitiveAction || !reauthPassword) return;
    setSaving(true);
    setReauthError('');
    setError('');
    setSuccess('');
    try {
      const confirmation = await api('/api/organizacion/reauthenticate', {
        method: 'POST',
        body: JSON.stringify({
          workspace_id: activeWorkspace.id,
          password: reauthPassword,
          scopes: [pendingSensitiveAction.scope],
        }),
      });
      const result = await api(pendingSensitiveAction.endpoint || '/api/organizacion/security', {
        method: pendingSensitiveAction.method || 'POST',
        headers: { 'X-Organization-Reauth': confirmation.token },
        body: JSON.stringify(
          pendingSensitiveAction.endpoint
            ? { workspace_id: activeWorkspace.id, ...pendingSensitiveAction.payload }
            : {
                workspace_id: activeWorkspace.id,
                action: pendingSensitiveAction.action,
                ...pendingSensitiveAction.payload,
              }
        ),
      });
      const message = pendingSensitiveAction.success;
      setPendingSensitiveAction(null);
      setReauthPassword('');
      setForm({});
      setSuccess(message);
      if (result.secret) {
        setRevealedSecret(result.secret);
        setModal('secret');
      }
      await load();
    } catch (cause: any) {
      setReauthError(cause?.message || 'No se pudo confirmar tu identidad.');
    } finally {
      setSaving(false);
    }
  };

  const saveWorkspaceSettings = async (
    column: 'security_settings' | 'branding_settings',
    value: Row
  ) => {
    if (!activeWorkspace?.id || !canManage) return;
    if (column === 'security_settings') {
      requestSensitiveAction({
        action: 'save_security_settings',
        scope: 'security.manage',
        payload: { settings: value },
        success: 'Política de seguridad guardada.',
      });
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await api('/api/organizacion/branding', {
        method: 'POST',
        body: JSON.stringify({
          workspace_id: activeWorkspace.id,
          action: 'save_settings',
          settings: value,
        }),
      });
      setSuccess('Configuración guardada.');
    } catch (cause) {
      fail(cause);
    } finally {
      setSaving(false);
    }
  };

  const submitSecurityResource = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeWorkspace?.id || !user?.id || !canManage) return;
    if (modal === 'network') {
      requestSensitiveAction({
        action: 'save_network',
        scope: 'security.manage',
        payload: {
          network: {
            name: String(form.name || '').trim(),
            network_cidr: String(form.network_cidr || '').trim(),
            mode: form.mode || 'allow',
          },
        },
        success: 'Red registrada.',
      });
    } else {
      requestSensitiveAction({
        action: 'save_alert',
        scope: 'security.manage',
        payload: {
          rule: {
            event_key: form.event_key,
            display_name: form.display_name,
            severity: form.severity || 'warning',
            channels: form.channels || ['in_app'],
            recipients: String(form.recipients || '')
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean),
          },
        },
        success: 'Regla de alerta guardada.',
      });
    }
  };

  const revokeSession = async (sessionId: string) => {
    if (!activeWorkspace?.id || !canManage || !confirm('¿Revocar esta sesión?')) return;
    requestSensitiveAction({
      action: 'revoke_session',
      scope: 'security.manage',
      payload: { session_id: sessionId },
      success: 'Sesión revocada.',
    });
  };

  const submitCertificate = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeWorkspace?.id || !user?.id || !canManage) return;
    requestSensitiveAction({
      action: 'create_certificate',
      scope: 'certificates.manage',
      payload: { certificate: form },
      success: 'Certificado registrado como pendiente de validación.',
    });
  };

  const submitBrandResource = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeWorkspace?.id || !user?.id || !canManage) return;
    setSaving(true);
    setError('');
    try {
      if (modal === 'template') {
        const key = String(form.template_key || '')
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9._-]/g, '_');
        await api('/api/organizacion/branding', {
          method: 'POST',
          body: JSON.stringify({
            workspace_id: activeWorkspace.id,
            action: 'create_template',
            template: {
              template_key: key,
              name: form.name,
              subject: form.subject,
              body_text: form.body_text,
            },
          }),
        });
        await finish('Plantilla creada.');
      } else {
        const domain = String(form.domain || '')
          .trim()
          .toLowerCase()
          .replace(/^https?:\/\//, '')
          .split('/')[0];
        await api('/api/organizacion/branding', {
          method: 'POST',
          body: JSON.stringify({
            workspace_id: activeWorkspace.id,
            action: 'create_domain',
            domain: {
              domain,
              sender_name: form.sender_name || null,
              sender_email: form.sender_email || null,
              reply_to: form.reply_to || null,
            },
          }),
        });
        await finish('Dominio registrado como pendiente de verificación DNS.');
      }
    } catch (cause) {
      fail(cause);
    } finally {
      setSaving(false);
    }
  };

  const submitIntegrationSecret = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeWorkspace?.id || !canManage) return;
    const endpoint =
      modal === 'api-key' ? '/api/organizacion/api-keys' : '/api/organizacion/webhooks';
    const payload =
      modal === 'api-key'
        ? {
            name: form.name,
            environment: form.environment || 'sandbox',
            scopes: form.scopes || [],
            expires_at: form.expires_at || null,
          }
        : {
            name: form.name,
            endpoint_url: form.endpoint_url,
            environment: form.environment || 'sandbox',
            event_types: form.event_types || [],
          };
    requestSensitiveAction({
      action: 'integration_request',
      scope: 'integrations.manage',
      endpoint,
      method: 'POST',
      payload,
      revealSecret: true,
      success: modal === 'api-key' ? 'API key creada.' : 'Webhook creado.',
    });
  };

  const actOnSecret = async (kind: 'api-key' | 'webhook', id: string, action: string) => {
    if (!activeWorkspace?.id || !canManage) return;
    if (
      (action === 'revoke' || action === 'rotate') &&
      !confirm(`¿Confirmas ${action === 'revoke' ? 'la revocación' : 'la rotación'}?`)
    )
      return;
    requestSensitiveAction({
      action: 'integration_request',
      scope: 'integrations.manage',
      endpoint: kind === 'api-key' ? '/api/organizacion/api-keys' : '/api/organizacion/webhooks',
      method: 'PATCH',
      payload: { id, action },
      revealSecret: action === 'rotate',
      success: 'Cambio aplicado.',
    });
  };

  const submitCostCenter = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeWorkspace?.id || !canManage) return;
    setSaving(true);
    setError('');
    try {
      await api('/api/organizacion/billing', {
        method: 'POST',
        body: JSON.stringify({
          workspace_id: activeWorkspace.id,
          action: 'create_cost_center',
          cost_center: {
            code: String(form.code || '')
              .trim()
              .toUpperCase(),
            name: form.name,
            description: form.description || null,
            budget: form.budget ? Number(form.budget) : null,
            currency: form.currency || 'MXN',
            alert_threshold_percent: Number(form.alert_threshold_percent || 80),
          },
        }),
      });
      await finish('Centro de costo creado.');
    } catch (cause) {
      fail(cause);
    } finally {
      setSaving(false);
    }
  };

  const downloadAudit = async () => {
    if (!activeWorkspace?.id) return;
    setSaving(true);
    setError('');
    try {
      const params = new URLSearchParams({ workspace_id: activeWorkspace.id, format: 'csv' });
      if (auditQuery.trim()) params.set('q', auditQuery.trim());
      const response = await fetch(`/api/organizacion/audit-export?${params}`, {
        headers: { Authorization: `Bearer ${session?.access_token || ''}` },
        cache: 'no-store',
      });
      const payload = response.ok ? await response.blob() : await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'No se pudo exportar la auditoría.');
      const objectUrl = URL.createObjectURL(payload as Blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `docubox-auditoria-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
      setSuccess('Exportación generada.');
    } catch (cause) {
      fail(cause);
    } finally {
      setSaving(false);
    }
  };

  if (!loading && !canRead)
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-border bg-background px-6 py-14 text-center">
        <LockKeyhole size={30} className="mx-auto text-muted-foreground" />
        <h2 className="mt-3 text-lg font-medium">Acceso restringido</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Tu rol no incluye acceso a esta sección.
        </p>
      </div>
    );

  const sensitiveModal = pendingSensitiveAction ? (
    <div
      className="fixed inset-0 z-[140] grid place-items-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sensitive-action-title"
    >
      <form
        onSubmit={confirmSensitiveAction}
        className="w-full max-w-md overflow-hidden rounded-lg border border-border bg-background shadow-2xl"
      >
        <div className="flex items-start gap-3 border-b border-border p-5">
          <span className="grid h-10 w-10 place-items-center rounded-md bg-primary/10 text-primary">
            <LockKeyhole size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 id="sensitive-action-title" className="font-medium">
              Confirmar operación sensible
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Vuelve a confirmar tu identidad antes de cambiar la seguridad de la organización.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPendingSensitiveAction(null)}
            className="grid h-9 w-9 place-items-center rounded-md hover:bg-muted"
            aria-label="Cerrar"
          >
            <X size={17} />
          </button>
        </div>
        <div className="space-y-4 p-5">
          {reauthError && (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
            >
              {reauthError}
            </div>
          )}
          <label className="block text-sm font-medium">
            Contraseña
            <span className="relative mt-1.5 block">
              <input
                autoFocus
                required
                type={showReauthPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={reauthPassword}
                onChange={(event) => setReauthPassword(event.target.value)}
                className="h-11 w-full rounded-md border border-border bg-background px-3 pr-11 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
              <button
                type="button"
                onClick={() => setShowReauthPassword((value) => !value)}
                className="absolute right-1 top-1 grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-muted"
                aria-label={showReauthPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {showReauthPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </span>
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-border bg-muted/20 p-4">
          <button
            type="button"
            onClick={() => setPendingSensitiveAction(null)}
            className="h-10 rounded-md border border-border bg-background px-4 text-sm"
          >
            Cancelar
          </button>
          <button
            disabled={saving || !reauthPassword}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving && <Loader2 size={15} className="animate-spin" />} Confirmar y continuar
          </button>
        </div>
      </form>
    </div>
  ) : null;
  const common = (
    <>
      <Notice error={error} success={success} />
      {sensitiveModal}
      {loading && (
        <div className="flex min-h-56 items-center justify-center gap-2 rounded-lg border border-border bg-background text-sm text-muted-foreground">
          <Loader2 size={17} className="animate-spin" /> Cargando información...
        </div>
      )}
    </>
  );

  if (section === 'seguridad') {
    const currentTab = tab || 'access';
    const settings = workspace.security_settings || {};
    const updateSettings = (key: string, value: unknown) =>
      setWorkspace((current) => ({
        ...current,
        security_settings: { ...(current.security_settings || {}), [key]: value },
      }));
    return (
      <div className="mx-auto max-w-[1400px] space-y-5">
        <Header
          section={section}
          actions={
            canManage && currentTab === 'access' ? (
              <button
                onClick={() => saveWorkspaceSettings('security_settings', settings)}
                disabled={saving}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white"
              >
                <Save size={16} /> Guardar política
              </button>
            ) : null
          }
        />
        <Tabs
          value={currentTab}
          onChange={setTab}
          items={[
            ['access', 'Acceso y autenticación'],
            ['sessions', 'Sesiones y dispositivos'],
            ['restrictions', 'Restricciones'],
            ['sso', 'SSO y aprovisionamiento'],
            ['alerts', 'Alertas'],
          ]}
        />
        {common}
        {!loading && currentTab === 'access' && (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
            <section className="overflow-hidden rounded-lg border border-border bg-background divide-y divide-border">
              <Toggle
                checked={Boolean(settings.require_mfa)}
                disabled={!canManage}
                onChange={(value) => updateSettings('require_mfa', value)}
                title="MFA obligatorio"
                description="Aplica el segundo factor a miembros con alcance operativo."
              />
              <Toggle
                checked={Boolean(settings.critical_reauthentication)}
                disabled={!canManage}
                onChange={(value) => updateSettings('critical_reauthentication', value)}
                title="Reautenticación en acciones críticas"
              />
              <Toggle
                checked={Boolean(settings.limit_concurrent_sessions)}
                disabled={!canManage}
                onChange={(value) => updateSettings('limit_concurrent_sessions', value)}
                title="Controlar sesiones simultáneas"
              />
              <div className="grid gap-4 p-5 sm:grid-cols-2">
                <label className="text-sm">
                  Duración máxima de sesión (horas)
                  <input
                    type="number"
                    min="1"
                    max="168"
                    disabled={!canManage}
                    value={settings.session_max_hours || 12}
                    onChange={(e) => updateSettings('session_max_hours', Number(e.target.value))}
                    className="mt-1.5 h-10 w-full rounded-md border border-border bg-background px-3"
                  />
                </label>
                <label className="text-sm">
                  Sesiones simultáneas
                  <input
                    type="number"
                    min="1"
                    max="20"
                    disabled={!canManage}
                    value={settings.max_concurrent_sessions || 3}
                    onChange={(e) =>
                      updateSettings('max_concurrent_sessions', Number(e.target.value))
                    }
                    className="mt-1.5 h-10 w-full rounded-md border border-border bg-background px-3"
                  />
                </label>
              </div>
              <div className="p-5">
                <p className="text-sm font-medium">Métodos permitidos</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {signatureMethods.map(([key, label]) => {
                    const selected = (
                      settings.allowed_methods || ['totp', 'webauthn', 'otp_email']
                    ).includes(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        disabled={!canManage}
                        onClick={() =>
                          updateSettings(
                            'allowed_methods',
                            selected
                              ? (settings.allowed_methods || []).filter(
                                  (item: string) => item !== key
                                )
                              : [...(settings.allowed_methods || []), key]
                          )
                        }
                        className={`rounded-md border px-3 py-2 text-sm ${selected ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground'}`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>
            <aside className="rounded-lg border border-border bg-background p-5">
              <Fingerprint size={21} className="text-primary" />
              <h3 className="mt-3 font-medium">Cobertura actual</h3>
              <div className="mt-4 space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">MFA</span>
                  <Status value={settings.require_mfa ? 'active' : 'not_configured'} />
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Reautenticación</span>
                  <Status
                    value={settings.critical_reauthentication ? 'active' : 'not_configured'}
                  />
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Métodos</span>
                  <span>{(settings.allowed_methods || []).length}</span>
                </div>
              </div>
            </aside>
          </div>
        )}
        {!loading && currentTab === 'sessions' && (
          <section className="overflow-hidden rounded-lg border border-border bg-background">
            <div className="flex items-center border-b border-border px-5 py-4">
              <h3 className="flex-1 font-medium">Sesiones de miembros</h3>
              <button
                onClick={load}
                className="grid h-9 w-9 place-items-center rounded-md border border-border"
                aria-label="Actualizar"
              >
                <RefreshCw size={15} />
              </button>
            </div>
            {rows.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-5 py-3 text-left font-medium">Usuario y dispositivo</th>
                      <th className="px-4 py-3 text-left font-medium">Ubicación</th>
                      <th className="px-4 py-3 text-left font-medium">Última actividad</th>
                      <th className="px-4 py-3 text-left font-medium">Riesgo</th>
                      <th className="px-5 py-3 text-right font-medium">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((item) => (
                      <tr key={item.session_id}>
                        <td className="px-5 py-4">
                          <p className="font-medium">{item.full_name}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {item.device_name || 'Navegador web'} ·{' '}
                            {[item.browser, item.os].filter(Boolean).join(' / ') || 'Sin detalle'}
                          </p>
                        </td>
                        <td className="px-4 py-4">
                          <p>{item.location || 'No disponible'}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.ip_address || 'IP no registrada'}
                          </p>
                        </td>
                        <td className="px-4 py-4">{formatDate(item.last_active_at)}</td>
                        <td className="px-4 py-4">
                          <Status value={item.risk_level} />
                        </td>
                        <td className="px-5 py-4 text-right">
                          {canManage && (
                            <button
                              onClick={() => revokeSession(item.session_id)}
                              className="text-sm text-red-600"
                            >
                              Revocar
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                icon={Laptop}
                title="Sin sesiones registradas"
                text="No hay sesiones organizacionales activas en el inventario."
              />
            )}
          </section>
        )}
        {!loading && currentTab === 'restrictions' && (
          <div className="space-y-5">
            <div className="flex justify-end">
              {canManage && (
                <button
                  onClick={() => {
                    setForm({ mode: 'allow' });
                    setModal('network');
                  }}
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white"
                >
                  <Plus size={16} /> Agregar red
                </button>
              )}
            </div>
            <section className="overflow-hidden rounded-lg border border-border bg-background">
              <div className="divide-y divide-border">
                {extra.length ? (
                  extra.map((item) => (
                    <div key={item.id} className="flex items-center gap-4 px-5 py-4">
                      <Globe2 size={18} className="text-primary" />
                      <div className="flex-1">
                        <p className="font-medium">{item.name}</p>
                        <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                          {item.network_cidr}
                        </p>
                      </div>
                      <Status value={item.status} />
                      <span className="text-sm capitalize text-muted-foreground">
                        {item.mode === 'allow' ? 'Permitida' : 'Bloqueada'}
                      </span>
                    </div>
                  ))
                ) : (
                  <Empty
                    icon={Globe2}
                    title="Sin redes configuradas"
                    text="El acceso se evalúa sin restricciones de red adicionales."
                  />
                )}
              </div>
            </section>
          </div>
        )}
        {!loading && currentTab === 'sso' && (
          <div className="grid gap-5 lg:grid-cols-2">
            <section className="rounded-lg border border-border bg-background p-5">
              <CloudCog size={22} className="text-primary" />
              <h3 className="mt-3 font-medium">Inicio de sesión empresarial</h3>
              <div className="mt-4 space-y-3">
                {(overview.integrations || []).length ? (
                  overview.integrations.map((item: Row) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 rounded-md border border-border p-3"
                    >
                      <div className="flex-1">
                        <p className="text-sm font-medium">{item.display_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.integration_type.toUpperCase()}
                        </p>
                      </div>
                      <Status value={item.status} />
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No hay un proveedor SSO o SCIM conectado.
                  </p>
                )}
              </div>
            </section>
            <section className="overflow-hidden rounded-lg border border-border bg-background divide-y divide-border">
              <Toggle
                checked={Boolean(settings.sso_enforced)}
                disabled={!canManage}
                onChange={(value) => updateSettings('sso_enforced', value)}
                title="Exigir SSO"
                description="Solo puede guardarse con proveedor operativo y acceso de emergencia."
              />
              <Toggle
                checked={Boolean(settings.emergency_access)}
                disabled={!canManage}
                onChange={(value) => updateSettings('emergency_access', value)}
                title="Acceso de emergencia"
              />
              <div className="p-5">
                <button
                  disabled={!canManage}
                  onClick={() => saveWorkspaceSettings('security_settings', settings)}
                  className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-white disabled:opacity-50"
                >
                  Guardar configuración
                </button>
              </div>
            </section>
          </div>
        )}
        {!loading && currentTab === 'alerts' && (
          <div className="space-y-5">
            <div className="flex justify-end">
              {canManage && (
                <button
                  onClick={() => {
                    setForm({ severity: 'warning', channels: ['in_app'] });
                    setModal('alert');
                  }}
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white"
                >
                  <Plus size={16} /> Nueva alerta
                </button>
              )}
            </div>
            <section className="overflow-hidden rounded-lg border border-border bg-background">
              <div className="divide-y divide-border">
                {third.length ? (
                  third.map((item) => (
                    <div key={item.id} className="flex items-center gap-4 px-5 py-4">
                      <BellRing size={18} className="text-primary" />
                      <div className="flex-1">
                        <p className="font-medium">{item.display_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.event_key} · {(item.channels || []).join(', ')}
                        </p>
                      </div>
                      <Status value={item.enabled ? 'active' : 'disabled'} />
                      <span className="text-sm capitalize text-muted-foreground">
                        {humanize(item.severity)}
                      </span>
                    </div>
                  ))
                ) : (
                  <Empty
                    icon={BellRing}
                    title="Sin reglas de alerta"
                    text="No hay destinatarios organizacionales configurados."
                  />
                )}
              </div>
            </section>
          </div>
        )}
        {(modal === 'network' || modal === 'alert') && (
          <Modal
            title={modal === 'network' ? 'Agregar red' : 'Nueva regla de alerta'}
            onClose={() => setModal('')}
          >
            <form onSubmit={submitSecurityResource} className="space-y-4 p-5">
              {modal === 'network' ? (
                <>
                  <label className="block text-sm">
                    Nombre
                    <input
                      required
                      value={form.name || ''}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="mt-1.5 h-10 w-full rounded-md border border-border px-3"
                    />
                  </label>
                  <label className="block text-sm">
                    Red CIDR
                    <input
                      required
                      placeholder="203.0.113.0/24"
                      value={form.network_cidr || ''}
                      onChange={(e) => setForm({ ...form, network_cidr: e.target.value })}
                      className="mt-1.5 h-10 w-full rounded-md border border-border px-3 font-mono"
                    />
                  </label>
                  <label className="block text-sm">
                    Regla
                    <select
                      value={form.mode || 'allow'}
                      onChange={(e) => setForm({ ...form, mode: e.target.value })}
                      className="mt-1.5 h-10 w-full rounded-md border border-border bg-background px-3"
                    >
                      <option value="allow">Permitir</option>
                      <option value="block">Bloquear</option>
                    </select>
                  </label>
                </>
              ) : (
                <>
                  <label className="block text-sm">
                    Nombre
                    <input
                      required
                      value={form.display_name || ''}
                      onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                      className="mt-1.5 h-10 w-full rounded-md border border-border px-3"
                    />
                  </label>
                  <label className="block text-sm">
                    Evento
                    <select
                      required
                      value={form.event_key || ''}
                      onChange={(e) => setForm({ ...form, event_key: e.target.value })}
                      className="mt-1.5 h-10 w-full rounded-md border border-border bg-background px-3"
                    >
                      <option value="">Seleccionar</option>
                      <option value="auth.anomaly">Acceso anómalo</option>
                      <option value="auth.multiple_failures">Múltiples fallos</option>
                      <option value="privilege.escalation">Escalamiento de privilegios</option>
                      <option value="download.bulk">Descarga masiva</option>
                      <option value="certificate.changed">Cambio de certificado</option>
                    </select>
                  </label>
                  <label className="block text-sm">
                    Destinatarios
                    <input
                      placeholder="seguridad@empresa.com"
                      value={form.recipients || ''}
                      onChange={(e) => setForm({ ...form, recipients: e.target.value })}
                      className="mt-1.5 h-10 w-full rounded-md border border-border px-3"
                    />
                  </label>
                </>
              )}
              <button
                disabled={saving}
                className="h-10 w-full rounded-md bg-primary text-sm font-medium text-white"
              >
                Guardar
              </button>
            </form>
          </Modal>
        )}
      </div>
    );
  }

  if (section === 'certificados') {
    const currentTab = tab || 'certificates';
    return (
      <div className="mx-auto max-w-[1400px] space-y-5">
        <Header
          section={section}
          actions={
            canManage && currentTab === 'certificates' ? (
              <button
                onClick={() => {
                  setForm({
                    certificate_type: 'institutional',
                    custody_type: 'metadata_only',
                    environment: 'sandbox',
                  });
                  setModal('certificate');
                }}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white"
              >
                <Plus size={16} /> Registrar certificado
              </button>
            ) : null
          }
        />
        <Tabs
          value={currentTab}
          onChange={setTab}
          items={[
            ['certificates', 'Certificados'],
            ['services', 'Servicios de sellado'],
            ['history', 'Historial de uso'],
            ['alerts', 'Alertas'],
          ]}
        />
        {common}
        {!loading && currentTab === 'certificates' && (
          <section className="overflow-hidden rounded-lg border border-border bg-background">
            {rows.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-5 py-3 text-left font-medium">Certificado</th>
                      <th className="px-4 py-3 text-left font-medium">Custodia</th>
                      <th className="px-4 py-3 text-left font-medium">Vigencia</th>
                      <th className="px-4 py-3 text-left font-medium">Ambiente</th>
                      <th className="px-5 py-3 text-left font-medium">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((item) => (
                      <tr key={item.id}>
                        <td className="px-5 py-4">
                          <p className="font-medium">{item.alias || item.subject_name}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {item.subject_name} · {item.rfc || 'RFC no registrado'}
                          </p>
                          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                            Serie {item.serial_number || '—'}
                          </p>
                        </td>
                        <td className="px-4 py-4">
                          <p>{humanize(item.custody_type)}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.provider_name || 'Sin proveedor'}
                          </p>
                        </td>
                        <td className="px-4 py-4">
                          <p>{formatDate(item.valid_until, true)}</p>
                          <p className="text-xs text-muted-foreground">
                            Desde {formatDate(item.valid_from, true)}
                          </p>
                        </td>
                        <td className="px-4 py-4 capitalize">{humanize(item.environment)}</td>
                        <td className="px-5 py-4">
                          <Status value={item.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                icon={ScrollText}
                title="Sin certificados registrados"
                text="Registra únicamente metadatos públicos o referencias opacas a la custodia."
              />
            )}
          </section>
        )}
        {!loading && currentTab === 'services' && (
          <div className="grid gap-5 md:grid-cols-3">
            <section className="rounded-lg border border-border bg-background p-5">
              <FileKey2 size={20} className="text-primary" />
              <h3 className="mt-3 font-medium">Certificados válidos</h3>
              <p className="mt-2 text-3xl font-medium">{overview.valid_certificates || 0}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                de {overview.certificate_count || 0} registrados
              </p>
            </section>
            <section className="rounded-lg border border-border bg-background p-5">
              <BadgeCheck size={20} className="text-emerald-600" />
              <h3 className="mt-3 font-medium">Certificaciones completadas</h3>
              <p className="mt-2 text-3xl font-medium">{overview.certifications_completed || 0}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Última {formatDate(overview.last_certification_at)}
              </p>
            </section>
            <section className="rounded-lg border border-border bg-background p-5">
              <ServerCog size={20} className="text-amber-600" />
              <h3 className="mt-3 font-medium">Estado operativo</h3>
              <div className="mt-3">
                <Status
                  value={
                    (overview.valid_certificates || 0) > 0 &&
                    (overview.certifications_completed || 0) > 0
                      ? 'active'
                      : 'not_configured'
                  }
                />
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                Solo refleja ejecuciones criptográficas verificadas.
              </p>
            </section>
          </div>
        )}
        {!loading && currentTab === 'history' && (
          <section className="overflow-hidden rounded-lg border border-border bg-background">
            <div className="grid grid-cols-3 divide-x divide-border">
              <div className="p-5">
                <p className="text-sm text-muted-foreground">Completadas</p>
                <p className="mt-2 text-2xl font-medium">
                  {overview.certifications_completed || 0}
                </p>
              </div>
              <div className="p-5">
                <p className="text-sm text-muted-foreground">Fallidas</p>
                <p className="mt-2 text-2xl font-medium">{overview.certifications_failed || 0}</p>
              </div>
              <div className="p-5">
                <p className="text-sm text-muted-foreground">Última operación</p>
                <p className="mt-2 text-sm font-medium">
                  {formatDate(overview.last_certification_at)}
                </p>
              </div>
            </div>
          </section>
        )}
        {!loading && currentTab === 'alerts' && (
          <section className="overflow-hidden rounded-lg border border-border bg-background">
            {rows.filter(
              (item) =>
                item.status === 'expiring' ||
                item.status === 'expired' ||
                (item.valid_until &&
                  new Date(item.valid_until) <= new Date(Date.now() + 45 * 86400000))
            ).length ? (
              <div className="divide-y divide-border">
                {rows
                  .filter(
                    (item) =>
                      item.status === 'expiring' ||
                      item.status === 'expired' ||
                      (item.valid_until &&
                        new Date(item.valid_until) <= new Date(Date.now() + 45 * 86400000))
                  )
                  .map((item) => (
                    <div key={item.id} className="flex items-center gap-4 px-5 py-4">
                      <AlertTriangle size={18} className="text-amber-600" />
                      <div className="flex-1">
                        <p className="font-medium">{item.alias || item.subject_name}</p>
                        <p className="text-sm text-muted-foreground">
                          Vigencia hasta {formatDate(item.valid_until, true)}
                        </p>
                      </div>
                      <Status value={item.status} />
                    </div>
                  ))}
              </div>
            ) : (
              <Empty
                icon={CheckCircle2}
                title="Sin alertas de vigencia"
                text="No hay certificados próximos a vencer en el inventario."
              />
            )}
          </section>
        )}
        {modal === 'certificate' && (
          <Modal title="Registrar certificado" onClose={() => setModal('')}>
            <form onSubmit={submitCertificate} className="grid gap-4 p-5 sm:grid-cols-2">
              <label className="text-sm sm:col-span-2">
                Alias
                <input
                  required
                  value={form.alias || ''}
                  onChange={(e) => setForm({ ...form, alias: e.target.value })}
                  className="mt-1.5 h-10 w-full rounded-md border border-border px-3"
                />
              </label>
              <label className="text-sm sm:col-span-2">
                Titular
                <input
                  required
                  value={form.subject_name || ''}
                  onChange={(e) => setForm({ ...form, subject_name: e.target.value })}
                  className="mt-1.5 h-10 w-full rounded-md border border-border px-3"
                />
              </label>
              <label className="text-sm">
                RFC
                <input
                  value={form.rfc || ''}
                  onChange={(e) => setForm({ ...form, rfc: e.target.value.toUpperCase() })}
                  className="mt-1.5 h-10 w-full rounded-md border border-border px-3 uppercase"
                />
              </label>
              <label className="text-sm">
                Número de serie
                <input
                  value={form.serial_number || ''}
                  onChange={(e) => setForm({ ...form, serial_number: e.target.value })}
                  className="mt-1.5 h-10 w-full rounded-md border border-border px-3"
                />
              </label>
              <label className="text-sm">
                Válido desde
                <input
                  type="date"
                  value={form.valid_from || ''}
                  onChange={(e) => setForm({ ...form, valid_from: e.target.value })}
                  className="mt-1.5 h-10 w-full rounded-md border border-border px-3"
                />
              </label>
              <label className="text-sm">
                Válido hasta
                <input
                  type="date"
                  value={form.valid_until || ''}
                  onChange={(e) => setForm({ ...form, valid_until: e.target.value })}
                  className="mt-1.5 h-10 w-full rounded-md border border-border px-3"
                />
              </label>
              <label className="text-sm">
                Custodia
                <select
                  value={form.custody_type || 'metadata_only'}
                  onChange={(e) => setForm({ ...form, custody_type: e.target.value })}
                  className="mt-1.5 h-10 w-full rounded-md border border-border bg-background px-3"
                >
                  <option value="metadata_only">Solo metadatos</option>
                  <option value="kms">KMS</option>
                  <option value="hsm">HSM</option>
                  <option value="external">Externa</option>
                </select>
              </label>
              <label className="text-sm">
                Ambiente
                <select
                  value={form.environment || 'sandbox'}
                  onChange={(e) => setForm({ ...form, environment: e.target.value })}
                  className="mt-1.5 h-10 w-full rounded-md border border-border bg-background px-3"
                >
                  <option value="sandbox">Sandbox</option>
                  <option value="production">Producción</option>
                </select>
              </label>
              <label className="text-sm sm:col-span-2">
                Referencia de llave
                <input
                  value={form.key_reference || ''}
                  onChange={(e) => setForm({ ...form, key_reference: e.target.value })}
                  placeholder="Referencia opaca KMS/HSM"
                  className="mt-1.5 h-10 w-full rounded-md border border-border px-3"
                />
              </label>
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 sm:col-span-2">
                No adjuntes llaves privadas ni contraseñas. El registro permanecerá pendiente hasta
                completar una validación criptográfica.
              </div>
              <button
                disabled={saving}
                className="h-10 rounded-md bg-primary text-sm font-medium text-white sm:col-span-2"
              >
                Registrar
              </button>
            </form>
          </Modal>
        )}
      </div>
    );
  }

  if (section === 'integraciones') {
    const currentTab = tab || 'installed';
    const openCreate = () => {
      setRevealedSecret('');
      setForm({ environment: 'sandbox', scopes: [], event_types: [] });
      setModal(currentTab === 'api' ? 'api-key' : 'webhook');
    };
    return (
      <div className="mx-auto max-w-[1400px] space-y-5">
        <Header
          section={section}
          actions={
            canManage && ['api', 'webhooks'].includes(currentTab) ? (
              <button
                onClick={openCreate}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white"
              >
                <Plus size={16} /> {currentTab === 'api' ? 'Crear API key' : 'Crear webhook'}
              </button>
            ) : null
          }
        />
        <Tabs
          value={currentTab}
          onChange={setTab}
          items={[
            ['installed', 'Integraciones instaladas'],
            ['api', 'API keys'],
            ['webhooks', 'Webhooks'],
            ['technical', 'Cuentas técnicas'],
            ['deliveries', 'Logs de entrega'],
          ]}
        />
        {common}
        {!loading && currentTab === 'installed' && (
          <section className="overflow-hidden rounded-lg border border-border bg-background">
            {rows.length ? (
              <div className="divide-y divide-border">
                {rows.map((item) => (
                  <div key={item.id} className="flex items-center gap-4 px-5 py-4">
                    <div className="grid h-10 w-10 place-items-center rounded-md bg-primary/10 text-primary">
                      <Link2 size={18} />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium">{item.display_name}</p>
                      <p className="text-sm text-muted-foreground">
                        {item.provider_key} · {humanize(item.environment)}
                      </p>
                    </div>
                    <Status value={item.status} />
                  </div>
                ))}
              </div>
            ) : (
              <Empty
                icon={CloudCog}
                title="Sin integraciones instaladas"
                text="No hay proveedores conectados a esta organización."
              />
            )}
          </section>
        )}
        {!loading && currentTab === 'api' && (
          <section className="overflow-hidden rounded-lg border border-border bg-background">
            {extra.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-5 py-3 text-left font-medium">Credencial</th>
                      <th className="px-4 py-3 text-left font-medium">Alcances</th>
                      <th className="px-4 py-3 text-left font-medium">Uso</th>
                      <th className="px-4 py-3 text-left font-medium">Estado</th>
                      <th className="px-5 py-3 text-right font-medium">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {extra.map((item) => (
                      <tr key={item.id}>
                        <td className="px-5 py-4">
                          <p className="font-medium">{item.name}</p>
                          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                            {item.key_prefix}••••••••
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {humanize(item.environment)} · Creada {formatDate(item.created_at)}
                          </p>
                        </td>
                        <td className="px-4 py-4">
                          <span className="text-xs text-muted-foreground">
                            {(item.scopes || []).join(', ')}
                          </span>
                        </td>
                        <td className="px-4 py-4">{formatDate(item.last_used_at)}</td>
                        <td className="px-4 py-4">
                          <Status value={item.status} />
                        </td>
                        <td className="px-5 py-4 text-right">
                          {canManage && item.status === 'active' && (
                            <div className="inline-flex gap-3">
                              <button
                                onClick={() => actOnSecret('api-key', item.id, 'rotate')}
                                className="text-primary"
                              >
                                Rotar
                              </button>
                              <button
                                onClick={() => actOnSecret('api-key', item.id, 'revoke')}
                                className="text-red-600"
                              >
                                Revocar
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                icon={KeyRound}
                title="Sin API keys"
                text="No hay credenciales activas para esta organización."
              />
            )}
          </section>
        )}
        {!loading && currentTab === 'webhooks' && (
          <section className="overflow-hidden rounded-lg border border-border bg-background">
            {third.length ? (
              <div className="divide-y divide-border">
                {third.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"
                  >
                    <div className="grid h-10 w-10 place-items-center rounded-md bg-primary/10 text-primary">
                      <Webhook size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{item.name}</p>
                      <p className="truncate text-sm text-muted-foreground">{item.endpoint_url}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {(item.event_types || []).length} eventos · {humanize(item.environment)}
                      </p>
                    </div>
                    <Status value={item.status} />
                    {canManage && item.status !== 'revoked' && (
                      <div className="inline-flex gap-3 text-sm">
                        <button
                          onClick={() =>
                            actOnSecret(
                              'webhook',
                              item.id,
                              item.status === 'active' ? 'disable' : 'enable'
                            )
                          }
                          className="text-primary"
                        >
                          {item.status === 'active' ? 'Deshabilitar' : 'Habilitar'}
                        </button>
                        <button
                          onClick={() => actOnSecret('webhook', item.id, 'rotate')}
                          className="text-primary"
                        >
                          Rotar
                        </button>
                        <button
                          onClick={() => actOnSecret('webhook', item.id, 'revoke')}
                          className="text-red-600"
                        >
                          Revocar
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <Empty
                icon={Webhook}
                title="Sin webhooks"
                text="No hay endpoints de entrega configurados."
              />
            )}
          </section>
        )}
        {!loading && currentTab === 'technical' && (
          <section className="rounded-lg border border-border bg-background p-5">
            <div className="flex items-start gap-4">
              <ServerCog size={22} className="mt-0.5 text-primary" />
              <div>
                <h3 className="font-medium">Cuentas técnicas</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Las API keys activas representan accesos técnicos limitados por alcance y
                  ambiente.
                </p>
                <div className="mt-4 flex gap-6 text-sm">
                  <span>
                    <strong>{extra.filter((item) => item.status === 'active').length}</strong>{' '}
                    activas
                  </span>
                  <span>
                    <strong>
                      {
                        extra.filter(
                          (item) => item.environment === 'production' && item.status === 'active'
                        ).length
                      }
                    </strong>{' '}
                    de producción
                  </span>
                </div>
              </div>
            </div>
          </section>
        )}
        {!loading && currentTab === 'deliveries' && (
          <section className="overflow-hidden rounded-lg border border-border bg-background">
            {(overview.deliveries || []).length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-5 py-3 text-left font-medium">Evento</th>
                      <th className="px-4 py-3 text-left font-medium">Intento</th>
                      <th className="px-4 py-3 text-left font-medium">Respuesta</th>
                      <th className="px-4 py-3 text-left font-medium">Fecha</th>
                      <th className="px-5 py-3 text-left font-medium">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {overview.deliveries.map((item: Row) => (
                      <tr key={item.id}>
                        <td className="px-5 py-4">{item.event_type}</td>
                        <td className="px-4 py-4">{item.attempt_number}</td>
                        <td className="px-4 py-4">
                          {item.response_status || item.error_code || '—'}
                        </td>
                        <td className="px-4 py-4">{formatDate(item.created_at)}</td>
                        <td className="px-5 py-4">
                          <Status value={item.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                icon={Send}
                title="Sin entregas"
                text="Aún no existen intentos de entrega de webhooks."
              />
            )}
          </section>
        )}
        {(modal === 'api-key' || modal === 'webhook') && (
          <Modal
            title={modal === 'api-key' ? 'Crear API key' : 'Crear webhook'}
            onClose={() => {
              setModal('');
              setRevealedSecret('');
            }}
          >
            <form onSubmit={submitIntegrationSecret} className="space-y-4 p-5">
              {revealedSecret ? (
                <div>
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
                    <p className="text-sm font-medium text-amber-900">Se mostrará una sola vez</p>
                    <div className="mt-3 flex gap-2">
                      <code className="min-w-0 flex-1 break-all rounded-md bg-background p-3 text-xs text-foreground">
                        {revealedSecret}
                      </code>
                      <button
                        type="button"
                        onClick={() => navigator.clipboard.writeText(revealedSecret)}
                        className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-border bg-background"
                        aria-label="Copiar"
                      >
                        <Copy size={16} />
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setModal('');
                      setRevealedSecret('');
                    }}
                    className="mt-4 h-10 w-full rounded-md bg-primary text-sm font-medium text-white"
                  >
                    Cerrar
                  </button>
                </div>
              ) : (
                <>
                  <label className="block text-sm">
                    Nombre
                    <input
                      required
                      value={form.name || ''}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="mt-1.5 h-10 w-full rounded-md border border-border px-3"
                    />
                  </label>
                  {modal === 'webhook' && (
                    <label className="block text-sm">
                      URL HTTPS
                      <input
                        type="url"
                        required
                        placeholder="https://api.empresa.com/docubox"
                        value={form.endpoint_url || ''}
                        onChange={(e) => setForm({ ...form, endpoint_url: e.target.value })}
                        className="mt-1.5 h-10 w-full rounded-md border border-border px-3"
                      />
                    </label>
                  )}
                  <label className="block text-sm">
                    Ambiente
                    <select
                      value={form.environment || 'sandbox'}
                      onChange={(e) => setForm({ ...form, environment: e.target.value })}
                      className="mt-1.5 h-10 w-full rounded-md border border-border bg-background px-3"
                    >
                      <option value="sandbox">Sandbox</option>
                      <option value="production">Producción</option>
                    </select>
                  </label>
                  <div>
                    <p className="text-sm">{modal === 'api-key' ? 'Alcances' : 'Eventos'}</p>
                    <div className="mt-2 grid max-h-52 gap-2 overflow-y-auto sm:grid-cols-2">
                      {(modal === 'api-key' ? apiScopes : webhookEvents).map((item) => {
                        const key = modal === 'api-key' ? 'scopes' : 'event_types';
                        const values = form[key] || [];
                        return (
                          <label
                            key={item}
                            className="flex items-center gap-2 rounded-md border border-border p-2.5 text-xs"
                          >
                            <input
                              type="checkbox"
                              checked={values.includes(item)}
                              onChange={(e) =>
                                setForm({
                                  ...form,
                                  [key]: e.target.checked
                                    ? [...values, item]
                                    : values.filter((value: string) => value !== item),
                                })
                              }
                            />
                            {item}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                  <button
                    disabled={saving}
                    className="h-10 w-full rounded-md bg-primary text-sm font-medium text-white"
                  >
                    Crear
                  </button>
                </>
              )}
            </form>
          </Modal>
        )}
        {modal === 'secret' && (
          <Modal
            title="Nuevo secreto"
            onClose={() => {
              setModal('');
              setRevealedSecret('');
            }}
          >
            <div className="p-5">
              <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-medium text-amber-900">Se mostrará una sola vez</p>
                <code className="mt-3 block break-all rounded-md bg-background p-3 text-xs">
                  {revealedSecret}
                </code>
                <button
                  onClick={() => navigator.clipboard.writeText(revealedSecret)}
                  className="mt-3 inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm"
                >
                  <Copy size={15} /> Copiar
                </button>
              </div>
            </div>
          </Modal>
        )}
      </div>
    );
  }

  if (section === 'marca-comunicaciones') {
    const currentTab = tab || 'identity';
    const branding = workspace.branding_settings || {};
    const setBrand = (key: string, value: unknown) =>
      setWorkspace((current) => ({
        ...current,
        branding_settings: { ...(current.branding_settings || {}), [key]: value },
      }));
    return (
      <div className="mx-auto max-w-[1400px] space-y-5">
        <Header
          section={section}
          actions={
            canManage && ['identity', 'signing'].includes(currentTab) ? (
              <button
                onClick={() => saveWorkspaceSettings('branding_settings', branding)}
                disabled={saving}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white"
              >
                <Save size={16} /> Guardar
              </button>
            ) : canManage && currentTab === 'templates' ? (
              <button
                onClick={() => {
                  setForm({});
                  setModal('template');
                }}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white"
              >
                <Plus size={16} /> Nueva plantilla
              </button>
            ) : canManage && currentTab === 'domains' ? (
              <button
                onClick={() => {
                  setForm({});
                  setModal('domain');
                }}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white"
              >
                <Plus size={16} /> Agregar dominio
              </button>
            ) : null
          }
        />
        <Tabs
          value={currentTab}
          onChange={setTab}
          items={[
            ['identity', 'Identidad visual'],
            ['signing', 'Experiencia de firma'],
            ['templates', 'Plantillas de comunicación'],
            ['domains', 'Dominios y remitentes'],
          ]}
        />
        {common}
        {!loading && currentTab === 'identity' && (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
            <section className="grid gap-4 rounded-lg border border-border bg-background p-5 sm:grid-cols-2">
              <label className="text-sm">
                Color principal
                <div className="mt-1.5 flex gap-2">
                  <input
                    type="color"
                    disabled={!canManage}
                    value={branding.primary_color || '#1E6BFF'}
                    onChange={(e) => setBrand('primary_color', e.target.value)}
                    className="h-10 w-14 rounded-md border border-border bg-background p-1"
                  />
                  <input
                    value={branding.primary_color || '#1E6BFF'}
                    onChange={(e) => setBrand('primary_color', e.target.value)}
                    className="h-10 flex-1 rounded-md border border-border px-3 uppercase"
                  />
                </div>
              </label>
              <label className="text-sm">
                Color secundario
                <div className="mt-1.5 flex gap-2">
                  <input
                    type="color"
                    disabled={!canManage}
                    value={branding.secondary_color || '#18181B'}
                    onChange={(e) => setBrand('secondary_color', e.target.value)}
                    className="h-10 w-14 rounded-md border border-border bg-background p-1"
                  />
                  <input
                    value={branding.secondary_color || '#18181B'}
                    onChange={(e) => setBrand('secondary_color', e.target.value)}
                    className="h-10 flex-1 rounded-md border border-border px-3 uppercase"
                  />
                </div>
              </label>
              <label className="text-sm sm:col-span-2">
                Logotipo claro
                <input
                  value={branding.logo_light_url || ''}
                  onChange={(e) => setBrand('logo_light_url', e.target.value)}
                  className="mt-1.5 h-10 w-full rounded-md border border-border px-3"
                  placeholder="URL privada o pública autorizada"
                />
              </label>
              <label className="text-sm sm:col-span-2">
                Logotipo oscuro
                <input
                  value={branding.logo_dark_url || ''}
                  onChange={(e) => setBrand('logo_dark_url', e.target.value)}
                  className="mt-1.5 h-10 w-full rounded-md border border-border px-3"
                />
              </label>
              <label className="text-sm sm:col-span-2">
                Isotipo
                <input
                  value={branding.isotype_url || ''}
                  onChange={(e) => setBrand('isotype_url', e.target.value)}
                  className="mt-1.5 h-10 w-full rounded-md border border-border px-3"
                />
              </label>
            </section>
            <aside className="rounded-lg border border-border bg-background p-5">
              <p className="text-sm font-medium">Vista previa</p>
              <div
                className="mt-4 rounded-md border border-border p-6"
                style={{ borderTopColor: branding.primary_color || '#1E6BFF', borderTopWidth: 4 }}
              >
                {branding.logo_light_url ? (
                  <img
                    src={branding.logo_light_url}
                    alt="Logotipo de la organización"
                    className="h-10 max-w-[220px] object-contain object-left"
                  />
                ) : (
                  <div className="text-xl font-medium">
                    {workspace.name || activeWorkspace?.name}
                  </div>
                )}
                <p className="mt-5 text-lg font-medium">Documento listo para firma</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Experiencia con identidad de la organización y atribución Docubox.
                </p>
                <button
                  className="mt-5 h-10 rounded-md px-4 text-sm font-medium text-white"
                  style={{ backgroundColor: branding.primary_color || '#1E6BFF' }}
                >
                  Continuar
                </button>
              </div>
            </aside>
          </div>
        )}
        {!loading && currentTab === 'signing' && (
          <section className="grid gap-4 rounded-lg border border-border bg-background p-5 sm:grid-cols-2">
            <label className="text-sm">
              Nombre visible del remitente
              <input
                disabled={!canManage}
                value={branding.sender_display_name || ''}
                onChange={(e) => setBrand('sender_display_name', e.target.value)}
                className="mt-1.5 h-10 w-full rounded-md border border-border px-3"
              />
            </label>
            <label className="text-sm">
              Correo de soporte
              <input
                type="email"
                disabled={!canManage}
                value={branding.support_email || ''}
                onChange={(e) => setBrand('support_email', e.target.value)}
                className="mt-1.5 h-10 w-full rounded-md border border-border px-3"
              />
            </label>
            <label className="text-sm sm:col-span-2">
              Texto de bienvenida
              <textarea
                disabled={!canManage}
                value={branding.welcome_text || ''}
                onChange={(e) => setBrand('welcome_text', e.target.value)}
                className="mt-1.5 min-h-24 w-full rounded-md border border-border p-3"
              />
            </label>
            <Toggle
              checked={branding.cobranding !== false}
              disabled={!canManage}
              onChange={(value) => setBrand('cobranding', value)}
              title="Co-branding con Docubox"
            />
          </section>
        )}
        {!loading && currentTab === 'templates' && (
          <section className="overflow-hidden rounded-lg border border-border bg-background">
            {rows.length ? (
              <div className="divide-y divide-border">
                {rows.map((item) => (
                  <div key={item.id} className="flex items-center gap-4 px-5 py-4">
                    <Mail size={18} className="text-primary" />
                    <div className="flex-1">
                      <p className="font-medium">{item.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {item.subject} · versión {item.legal_version}
                      </p>
                    </div>
                    <Status value={item.status} />
                  </div>
                ))}
              </div>
            ) : (
              <Empty
                icon={Mail}
                title="Sin plantillas"
                text="No hay comunicaciones personalizadas para esta organización."
              />
            )}
          </section>
        )}
        {!loading && currentTab === 'domains' && (
          <section className="overflow-hidden rounded-lg border border-border bg-background">
            {extra.length ? (
              <div className="divide-y divide-border">
                {extra.map((item) => (
                  <div key={item.id} className="flex items-center gap-4 px-5 py-4">
                    <Globe2 size={18} className="text-primary" />
                    <div className="flex-1">
                      <p className="font-medium">{item.domain}</p>
                      <p className="text-sm text-muted-foreground">
                        {item.sender_email || 'Remitente pendiente'} · Reply-to{' '}
                        {item.reply_to || 'no configurado'}
                      </p>
                    </div>
                    <Status value={item.dns_status} />
                  </div>
                ))}
              </div>
            ) : (
              <Empty
                icon={Globe2}
                title="Sin dominios"
                text="No hay dominios remitentes registrados."
              />
            )}
          </section>
        )}
        {(modal === 'template' || modal === 'domain') && (
          <Modal
            title={modal === 'template' ? 'Nueva plantilla' : 'Agregar dominio'}
            onClose={() => setModal('')}
          >
            <form onSubmit={submitBrandResource} className="space-y-4 p-5">
              {modal === 'template' ? (
                <>
                  <label className="block text-sm">
                    Nombre
                    <input
                      required
                      value={form.name || ''}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="mt-1.5 h-10 w-full rounded-md border border-border px-3"
                    />
                  </label>
                  <label className="block text-sm">
                    Clave
                    <input
                      required
                      placeholder="signature.invitation"
                      value={form.template_key || ''}
                      onChange={(e) => setForm({ ...form, template_key: e.target.value })}
                      className="mt-1.5 h-10 w-full rounded-md border border-border px-3 font-mono"
                    />
                  </label>
                  <label className="block text-sm">
                    Asunto
                    <input
                      required
                      value={form.subject || ''}
                      onChange={(e) => setForm({ ...form, subject: e.target.value })}
                      className="mt-1.5 h-10 w-full rounded-md border border-border px-3"
                    />
                  </label>
                  <label className="block text-sm">
                    Contenido
                    <textarea
                      required
                      value={form.body_text || ''}
                      onChange={(e) => setForm({ ...form, body_text: e.target.value })}
                      className="mt-1.5 min-h-36 w-full rounded-md border border-border p-3"
                    />
                  </label>
                </>
              ) : (
                <>
                  <label className="block text-sm">
                    Dominio
                    <input
                      required
                      placeholder="empresa.com"
                      value={form.domain || ''}
                      onChange={(e) => setForm({ ...form, domain: e.target.value })}
                      className="mt-1.5 h-10 w-full rounded-md border border-border px-3"
                    />
                  </label>
                  <label className="block text-sm">
                    Nombre del remitente
                    <input
                      value={form.sender_name || ''}
                      onChange={(e) => setForm({ ...form, sender_name: e.target.value })}
                      className="mt-1.5 h-10 w-full rounded-md border border-border px-3"
                    />
                  </label>
                  <label className="block text-sm">
                    Correo remitente
                    <input
                      type="email"
                      value={form.sender_email || ''}
                      onChange={(e) => setForm({ ...form, sender_email: e.target.value })}
                      className="mt-1.5 h-10 w-full rounded-md border border-border px-3"
                    />
                  </label>
                  <label className="block text-sm">
                    Reply-to
                    <input
                      type="email"
                      value={form.reply_to || ''}
                      onChange={(e) => setForm({ ...form, reply_to: e.target.value })}
                      className="mt-1.5 h-10 w-full rounded-md border border-border px-3"
                    />
                  </label>
                </>
              )}
              <button
                disabled={saving}
                className="h-10 w-full rounded-md bg-primary text-sm font-medium text-white"
              >
                Guardar
              </button>
            </form>
          </Modal>
        )}
      </div>
    );
  }

  if (section === 'plan-consumo') {
    const currentTab = tab || 'summary';
    const plan = Array.isArray(workspace.subscription_plans)
      ? workspace.subscription_plans[0]
      : workspace.subscription_plans;
    const totals = rows.reduce<Record<string, number>>((sum, item) => {
      sum[item.metric_key] = (sum[item.metric_key] || 0) + Number(item.quantity || 0);
      return sum;
    }, {});
    return (
      <div className="mx-auto max-w-[1400px] space-y-5">
        <Header
          section={section}
          actions={
            canManage && currentTab === 'centers' ? (
              <button
                onClick={() => {
                  setForm({ currency: 'MXN', alert_threshold_percent: 80 });
                  setModal('cost-center');
                }}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white"
              >
                <Plus size={16} /> Nuevo centro
              </button>
            ) : null
          }
        />
        <Tabs
          value={currentTab}
          onChange={setTab}
          items={[
            ['summary', 'Resumen del plan'],
            ['usage', 'Consumo'],
            ['centers', 'Centros de costo'],
            ['billing', 'Facturas y pagos'],
            ['limits', 'Límites y alertas'],
          ]}
        />
        {common}
        {!loading && currentTab === 'summary' && (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <section className="rounded-lg border border-border bg-background p-5">
              <CreditCard size={20} className="text-primary" />
              <p className="mt-3 text-sm text-muted-foreground">Plan actual</p>
              <p className="mt-1 text-2xl font-medium">{plan?.name || 'Sin plan'}</p>
              <Status value={workspace.status || 'pending'} />
            </section>
            <section className="rounded-lg border border-border bg-background p-5">
              <CloudCog size={20} className="text-primary" />
              <p className="mt-3 text-sm text-muted-foreground">Complementos</p>
              <p className="mt-1 text-2xl font-medium">
                {addonSubscriptions.filter((item) => ['trialing', 'active'].includes(item.status)).length}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {addonSubscriptions.map((item) => {
                  const product = Array.isArray(item.addon_products)
                    ? item.addon_products[0]
                    : item.addon_products;
                  return product?.name;
                }).filter(Boolean).join(', ') || 'Sin complementos activos'}
              </p>
            </section>
            <section className="rounded-lg border border-border bg-background p-5">
              <FileKey2 size={20} className="text-primary" />
              <p className="mt-3 text-sm text-muted-foreground">Documentos</p>
              <p className="mt-1 text-2xl font-medium">
                {workspace.documents_used || 0} /{' '}
                {workspace.documents_limit || plan?.documents_included || '—'}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Periodo hasta {formatDate(workspace.current_period_end, true)}
              </p>
            </section>
            <section className="rounded-lg border border-border bg-background p-5">
              <Building2 size={20} className="text-primary" />
              <p className="mt-3 text-sm text-muted-foreground">Centros de costo</p>
              <p className="mt-1 text-2xl font-medium">
                {extra.filter((item) => item.status === 'active').length}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">{extra.length} registrados</p>
            </section>
          </div>
        )}
        {!loading && currentTab === 'usage' && (
          <div className="space-y-5">
            <section className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
              {Object.entries(totals)
                .slice(0, 8)
                .map(([key, value]) => (
                  <div key={key} className="bg-background p-5">
                    <p className="text-sm text-muted-foreground">{humanize(key)}</p>
                    <p className="mt-2 text-2xl font-medium">{value}</p>
                  </div>
                ))}
              {!Object.keys(totals).length && (
                <div className="col-span-full bg-background">
                  <Empty
                    icon={Database}
                    title="Sin movimientos"
                    text="No hay consumo adicional registrado en el periodo."
                  />
                </div>
              )}
            </section>
            {rows.length > 0 && (
              <section className="overflow-hidden rounded-lg border border-border bg-background">
                <div className="divide-y divide-border">
                  {rows.slice(0, 100).map((item) => (
                    <div key={item.id} className="flex items-center px-5 py-3.5 text-sm">
                      <span className="flex-1">{humanize(item.metric_key)}</span>
                      <span className="mr-8 font-medium">
                        {item.quantity} {item.unit}
                      </span>
                      <span className="text-muted-foreground">{formatDate(item.occurred_at)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
        {!loading && currentTab === 'centers' && (
          <section className="overflow-hidden rounded-lg border border-border bg-background">
            {extra.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-5 py-3 text-left font-medium">Centro</th>
                      <th className="px-4 py-3 text-left font-medium">Presupuesto</th>
                      <th className="px-4 py-3 text-left font-medium">Alerta</th>
                      <th className="px-5 py-3 text-left font-medium">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {extra.map((item) => (
                      <tr key={item.id}>
                        <td className="px-5 py-4">
                          <p className="font-medium">
                            {item.code} · {item.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {item.description || 'Sin descripción'}
                          </p>
                        </td>
                        <td className="px-4 py-4">
                          {item.budget
                            ? new Intl.NumberFormat('es-MX', {
                                style: 'currency',
                                currency: item.currency || 'MXN',
                              }).format(item.budget)
                            : 'Sin límite'}
                        </td>
                        <td className="px-4 py-4">{item.alert_threshold_percent}%</td>
                        <td className="px-5 py-4">
                          <Status value={item.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                icon={Building2}
                title="Sin centros de costo"
                text="No hay distribución presupuestal configurada."
              />
            )}
          </section>
        )}
        {!loading && currentTab === 'billing' && (
          <section className="rounded-lg border border-border bg-background">
            <Empty
              icon={CreditCard}
              title="Módulo económico no conectado"
              text="Las facturas y métodos de pago aparecerán cuando el proveedor económico esté configurado."
            />
          </section>
        )}
        {!loading && currentTab === 'limits' && (
          <section className="rounded-lg border border-border bg-background p-5">
            <h3 className="font-medium">Límites vigentes</h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="rounded-md border border-border p-4">
                <p className="text-sm text-muted-foreground">Documentos incluidos</p>
                <p className="mt-1 text-xl font-medium">
                  {workspace.documents_limit || plan?.documents_included || '—'}
                </p>
              </div>
              <div className="rounded-md border border-border p-4">
                <p className="text-sm text-muted-foreground">Centros con presupuesto</p>
                <p className="mt-1 text-xl font-medium">
                  {extra.filter((item) => item.budget).length}
                </p>
              </div>
            </div>
          </section>
        )}
        {modal === 'cost-center' && (
          <Modal title="Nuevo centro de costo" onClose={() => setModal('')}>
            <form onSubmit={submitCostCenter} className="grid gap-4 p-5 sm:grid-cols-2">
              <label className="text-sm">
                Código
                <input
                  required
                  value={form.code || ''}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  className="mt-1.5 h-10 w-full rounded-md border border-border px-3 uppercase"
                />
              </label>
              <label className="text-sm">
                Nombre
                <input
                  required
                  value={form.name || ''}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="mt-1.5 h-10 w-full rounded-md border border-border px-3"
                />
              </label>
              <label className="text-sm sm:col-span-2">
                Descripción
                <input
                  value={form.description || ''}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="mt-1.5 h-10 w-full rounded-md border border-border px-3"
                />
              </label>
              <label className="text-sm">
                Presupuesto
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.budget || ''}
                  onChange={(e) => setForm({ ...form, budget: e.target.value })}
                  className="mt-1.5 h-10 w-full rounded-md border border-border px-3"
                />
              </label>
              <label className="text-sm">
                Alerta al porcentaje
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={form.alert_threshold_percent || 80}
                  onChange={(e) => setForm({ ...form, alert_threshold_percent: e.target.value })}
                  className="mt-1.5 h-10 w-full rounded-md border border-border px-3"
                />
              </label>
              <button
                disabled={saving}
                className="h-10 rounded-md bg-primary text-sm font-medium text-white sm:col-span-2"
              >
                Crear centro
              </button>
            </form>
          </Modal>
        )}
      </div>
    );
  }

  const filteredAudit = rows.filter(
    (item) =>
      !auditQuery ||
      [
        item.summary,
        item.event_type,
        item.resource_type,
        item.correlation_id,
        item.actor_user_id,
      ].some((value) =>
        String(value || '')
          .toLowerCase()
          .includes(auditQuery.toLowerCase())
      )
  );
  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <Header section="auditoria" />
      <Notice error={error} success={success} />
      <div className="flex gap-3">
        <label className="relative flex-1">
          <Clipboard size={16} className="absolute left-3 top-3 text-muted-foreground" />
          <input
            value={auditQuery}
            onChange={(e) => setAuditQuery(e.target.value)}
            placeholder="Buscar por evento, recurso o correlation ID"
            className="h-10 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm"
          />
        </label>
        <button
          onClick={downloadAudit}
          disabled={saving}
          className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm disabled:opacity-50"
        >
          <Save size={15} /> Exportar CSV
        </button>
        <button
          onClick={load}
          className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm"
        >
          <RefreshCw size={15} /> Actualizar
        </button>
      </div>
      {loading ? (
        common
      ) : (
        <section className="overflow-hidden rounded-lg border border-border bg-background">
          {filteredAudit.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-5 py-3 text-left font-medium">Fecha y actor</th>
                    <th className="px-4 py-3 text-left font-medium">Acción</th>
                    <th className="px-4 py-3 text-left font-medium">Recurso</th>
                    <th className="px-4 py-3 text-left font-medium">Resultado</th>
                    <th className="px-5 py-3 text-left font-medium">Correlation ID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredAudit.map((item) => (
                    <tr
                      key={item.id}
                      onClick={() => setSelectedAudit(item)}
                      className="cursor-pointer hover:bg-muted/40"
                    >
                      <td className="px-5 py-4">
                        <p>{formatDate(item.occurred_at)}</p>
                        <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                          {String(item.actor_user_id || 'system').slice(0, 12)}
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        <p className="font-medium">{item.summary}</p>
                        <p className="text-xs text-muted-foreground">{item.event_type}</p>
                      </td>
                      <td className="px-4 py-4">{item.resource_type}</td>
                      <td className="px-4 py-4">
                        <Status value={item.outcome} />
                      </td>
                      <td className="px-5 py-4 font-mono text-xs text-muted-foreground">
                        {String(item.correlation_id || '').slice(0, 18)}…
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              icon={Activity}
              title="Sin resultados"
              text="No hay eventos que coincidan con los filtros."
            />
          )}
        </section>
      )}
      {selectedAudit && (
        <Modal title="Detalle de auditoría" onClose={() => setSelectedAudit(null)}>
          <div className="space-y-5 p-5">
            <div>
              <p className="text-xs uppercase text-muted-foreground">Evento</p>
              <p className="mt-1 font-medium">{selectedAudit.summary}</p>
              <p className="text-sm text-muted-foreground">{selectedAudit.event_type}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase text-muted-foreground">Resultado</p>
                <div className="mt-1">
                  <Status value={selectedAudit.outcome} />
                </div>
              </div>
              <div>
                <p className="text-xs uppercase text-muted-foreground">Severidad</p>
                <p className="mt-1 capitalize">{humanize(selectedAudit.severity)}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-muted-foreground">Origen</p>
                <p className="mt-1 capitalize">{selectedAudit.origin}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-muted-foreground">Fecha</p>
                <p className="mt-1">{formatDate(selectedAudit.occurred_at)}</p>
              </div>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Correlation ID</p>
              <code className="mt-1 block break-all rounded-md bg-muted p-3 text-xs">
                {selectedAudit.correlation_id}
              </code>
            </div>
            {Object.keys(selectedAudit.payload || {}).length > 0 && (
              <div>
                <p className="text-xs uppercase text-muted-foreground">Contexto</p>
                <pre className="mt-1 max-h-56 overflow-auto rounded-md bg-muted p-3 text-xs">
                  {JSON.stringify(selectedAudit.payload, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
