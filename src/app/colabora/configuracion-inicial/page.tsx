'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  CheckCircle2,
  Clock3,
  Loader2,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useCollaboration } from '@/contexts/CollaborationContext';
import { useCollaborationApi } from '@/lib/collaboration/client';

type Member = {
  id: string;
  user_id: string;
  role: string;
  user_profiles?:
    | { full_name?: string | null; email?: string | null }
    | Array<{ full_name?: string | null; email?: string | null }>
    | null;
};

type Space = { id: string; name: string };

type SetupState = {
  primaryAdminId: string;
  backupAdminId: string;
  defaultVisibility: 'private' | 'internal' | 'shared' | 'formal';
  allowExternalComments: boolean;
  allowExternalDownloads: boolean;
  watermarkExternalFiles: boolean;
  retentionDays: number;
  defaultDueDays: number;
  defaultSlaHours: number;
  timezone: string;
  firstSpaceName: string;
  inApp: boolean;
  email: boolean;
  push: boolean;
  dailyDigest: boolean;
  criticalAlerts: boolean;
  quietHoursEnabled: boolean;
  quietFrom: string;
  quietTo: string;
};

const steps = [
  { title: 'Administradores', icon: Users },
  { title: 'Privacidad', icon: ShieldCheck },
  { title: 'Operacion', icon: Clock3 },
  { title: 'Equipo', icon: Users },
  { title: 'Notificaciones', icon: Bell },
  { title: 'Listo', icon: CheckCircle2 },
];

function profileOf(member: Member) {
  return Array.isArray(member.user_profiles) ? member.user_profiles[0] : member.user_profiles;
}

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-5 border-b border-border py-4 last:border-b-0">
      <span>
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 shrink-0 rounded border-border text-primary"
      />
    </label>
  );
}

export default function CollaborationSetupPage() {
  const router = useRouter();
  const api = useCollaborationApi();
  const { activeWorkspace } = useWorkspace();
  const { settings, access, can, refresh } = useCollaboration();
  const [step, setStep] = useState(0);
  const [members, setMembers] = useState<Member[]>([]);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [state, setState] = useState<SetupState>({
    primaryAdminId: '',
    backupAdminId: '',
    defaultVisibility: 'internal',
    allowExternalComments: false,
    allowExternalDownloads: false,
    watermarkExternalFiles: true,
    retentionDays: 2555,
    defaultDueDays: 5,
    defaultSlaHours: 72,
    timezone: 'America/Mexico_City',
    firstSpaceName: '',
    inApp: true,
    email: true,
    push: false,
    dailyDigest: false,
    criticalAlerts: true,
    quietHoursEnabled: false,
    quietFrom: '20:00',
    quietTo: '08:00',
  });

  const update = <K extends keyof SetupState>(key: K, value: SetupState[K]) => {
    setState((current) => ({ ...current, [key]: value }));
  };

  const load = useCallback(async () => {
    if (!activeWorkspace?.id) return;
    setLoading(true);
    setError('');
    try {
      const [overview, spaceList] = await Promise.all([
        api<{ data: { members: Member[] } }>(
          `/api/colabora/overview?workspace_id=${activeWorkspace.id}`
        ),
        api<{ data: Space[] }>(`/api/colabora/resources/spaces?workspace_id=${activeWorkspace.id}`),
      ]);
      const memberRows = overview.data.members || [];
      setMembers(memberRows);
      setSpaces(spaceList.data || []);
      setState((current) => ({
        ...current,
        primaryAdminId: String(
          settings?.primary_admin_member_id ||
            current.primaryAdminId ||
            memberRows.find((member) => member.role === 'owner')?.id ||
            memberRows[0]?.id ||
            ''
        ),
        backupAdminId: String(settings?.backup_admin_member_id || current.backupAdminId || ''),
        defaultVisibility:
          (settings?.default_comment_visibility as SetupState['defaultVisibility']) ||
          current.defaultVisibility,
        allowExternalComments: Boolean(
          settings?.allow_external_comments ?? current.allowExternalComments
        ),
        allowExternalDownloads: Boolean(
          settings?.allow_external_downloads ?? current.allowExternalDownloads
        ),
        watermarkExternalFiles: Boolean(
          settings?.watermark_external_files ?? current.watermarkExternalFiles
        ),
        retentionDays: Number(settings?.retention_days || current.retentionDays),
        defaultDueDays: Number(settings?.default_due_days || current.defaultDueDays),
        defaultSlaHours: Number(settings?.default_sla_hours || current.defaultSlaHours),
        timezone: String(settings?.timezone || current.timezone),
      }));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'No se pudo cargar la configuracion inicial.'
      );
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace?.id, api, settings]);

  useEffect(() => {
    load();
  }, [load]);

  const writable = can('collaboration.manage_settings', true);
  const trialDays = access.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(access.trialEndsAt).getTime() - Date.now()) / 86400000))
    : null;
  const enabledFeatures = useMemo(
    () =>
      Object.entries(access.entitlements)
        .filter(([, entitlement]) =>
          ['trialing', 'active', 'past_due'].includes(entitlement.status || '')
        )
        .map(([key]) => key.replace('collaboration_', '').replaceAll('_', ' ')),
    [access.entitlements]
  );

  const complete = async () => {
    if (!activeWorkspace?.id || !writable) return;
    setSaving(true);
    setError('');
    try {
      const requestedSpace = state.firstSpaceName.trim();
      if (
        requestedSpace &&
        !spaces.some((space) => space.name.trim().toLowerCase() === requestedSpace.toLowerCase())
      ) {
        await api('/api/colabora/resources/spaces', {
          method: 'POST',
          body: JSON.stringify({
            workspace_id: activeWorkspace.id,
            name: requestedSpace,
            description: 'Primer espacio configurado durante la activacion de Colabora.',
            space_type: 'project',
            confidentiality: 'internal',
          }),
        });
      }
      await api('/api/colabora/access', {
        method: 'POST',
        body: JSON.stringify({
          workspace_id: activeWorkspace.id,
          action: 'update_settings',
          settings: {
            status: 'configured',
            primary_admin_member_id: state.primaryAdminId || null,
            backup_admin_member_id: state.backupAdminId || null,
            default_comment_visibility: state.defaultVisibility,
            allow_external_comments: state.allowExternalComments,
            allow_external_downloads: state.allowExternalDownloads,
            watermark_external_files: state.watermarkExternalFiles,
            default_due_days: state.defaultDueDays,
            default_sla_hours: state.defaultSlaHours,
            retention_days: state.retentionDays,
            timezone: state.timezone,
            notification_preferences: {
              in_app: state.inApp,
              email: state.email,
              push: state.push,
              daily_digest: state.dailyDigest,
              critical_alerts: state.criticalAlerts,
            },
            quiet_hours: state.quietHoursEnabled
              ? {
                  enabled: true,
                  from: state.quietFrom,
                  to: state.quietTo,
                  timezone: state.timezone,
                }
              : { enabled: false },
            onboarding_completed_at: new Date().toISOString(),
          },
        }),
      });
      await refresh();
      router.push('/colabora');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo finalizar la configuracion.');
    } finally {
      setSaving(false);
    }
  };

  if (loading)
    return (
      <div className="grid min-h-[520px] place-items-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={18} className="animate-spin" /> Preparando Colabora...
        </div>
      </div>
    );
  if (!writable)
    return (
      <div className="mx-auto max-w-xl rounded-lg border border-border bg-background p-7">
        <ShieldCheck className="text-primary" />
        <h2 className="mt-4 text-xl font-medium">Configuracion reservada</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Un propietario o administrador con permiso de configuracion debe completar este proceso.
        </p>
        <Link
          href="/colabora"
          className="mt-5 inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium"
        >
          Volver al centro de trabajo
        </Link>
      </div>
    );

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-primary">
          Configuracion inicial
        </p>
        <h2 className="mt-1 text-2xl font-medium text-foreground">
          Prepara Colabora para {activeWorkspace?.name}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Paso {step + 1} de {steps.length}
        </p>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <div className="grid grid-cols-3 border-b border-border bg-muted/30 sm:grid-cols-6">
          {steps.map((item, index) => (
            <button
              key={item.title}
              type="button"
              onClick={() => index <= step && setStep(index)}
              className={`flex min-h-16 items-center justify-center gap-2 border-b-2 px-2 text-xs sm:text-sm ${index === step ? 'border-primary bg-primary/5 font-medium text-primary' : index < step ? 'border-transparent text-foreground' : 'border-transparent text-muted-foreground'}`}
            >
              <item.icon size={16} />
              <span className="hidden md:inline">{item.title}</span>
            </button>
          ))}
        </div>
        <div className="min-h-[430px] p-5 sm:p-7">
          {step === 0 && (
            <div className="mx-auto max-w-3xl">
              <h3 className="text-lg font-medium">Responsables de Colabora</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Designa quien administrara la operacion y quien cubrira sus ausencias.
              </p>
              <div className="mt-6 grid gap-5 sm:grid-cols-2">
                <label className="text-sm font-medium">
                  Responsable principal
                  <select
                    value={state.primaryAdminId}
                    onChange={(event) => update('primaryAdminId', event.target.value)}
                    className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                  >
                    <option value="">Seleccionar</option>
                    {members.map((member) => {
                      const profile = profileOf(member);
                      return (
                        <option key={member.id} value={member.id}>
                          {profile?.full_name || profile?.email || member.user_id} - {member.role}
                        </option>
                      );
                    })}
                  </select>
                </label>
                <label className="text-sm font-medium">
                  Responsable suplente
                  <select
                    value={state.backupAdminId}
                    onChange={(event) => update('backupAdminId', event.target.value)}
                    className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                  >
                    <option value="">Sin suplente</option>
                    {members
                      .filter((member) => member.id !== state.primaryAdminId)
                      .map((member) => {
                        const profile = profileOf(member);
                        return (
                          <option key={member.id} value={member.id}>
                            {profile?.full_name || profile?.email || member.user_id} - {member.role}
                          </option>
                        );
                      })}
                  </select>
                </label>
              </div>
              <div className="mt-6 rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                {members.length} miembro{members.length === 1 ? '' : 's'} activo
                {members.length === 1 ? '' : 's'} disponible{members.length === 1 ? '' : 's'} en la
                organizacion.
              </div>
            </div>
          )}
          {step === 1 && (
            <div className="mx-auto max-w-3xl">
              <h3 className="text-lg font-medium">Privacidad por defecto</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Estos valores pueden endurecerse en cada espacio o sala.
              </p>
              <label className="mt-6 block text-sm font-medium">
                Visibilidad de comentarios
                <select
                  value={state.defaultVisibility}
                  onChange={(event) =>
                    update(
                      'defaultVisibility',
                      event.target.value as SetupState['defaultVisibility']
                    )
                  }
                  className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                >
                  <option value="private">Privada</option>
                  <option value="internal">Interna</option>
                  <option value="shared">Compartida</option>
                  <option value="formal">Formal</option>
                </select>
              </label>
              <div className="mt-4 rounded-md border border-border px-4">
                <Toggle
                  checked={state.allowExternalComments}
                  onChange={(value) => update('allowExternalComments', value)}
                  label="Comentarios externos"
                  description="Permite comentarios de invitados cuando una sala tambien lo autorice."
                />
                <Toggle
                  checked={state.allowExternalDownloads}
                  onChange={(value) => update('allowExternalDownloads', value)}
                  label="Descargas externas"
                  description="Permite descargar recursos compartidos en salas autorizadas."
                />
                <Toggle
                  checked={state.watermarkExternalFiles}
                  onChange={(value) => update('watermarkExternalFiles', value)}
                  label="Marca de agua"
                  description="Identifica archivos consultados por invitados externos."
                />
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="mx-auto max-w-3xl">
              <h3 className="text-lg font-medium">Reglas operativas</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Define tiempos base para tareas, revisiones y conservacion.
              </p>
              <div className="mt-6 grid gap-5 sm:grid-cols-2">
                <label className="text-sm font-medium">
                  Vencimiento predeterminado (dias)
                  <input
                    type="number"
                    min="1"
                    max="365"
                    value={state.defaultDueDays}
                    onChange={(event) => update('defaultDueDays', Number(event.target.value))}
                    className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                  />
                </label>
                <label className="text-sm font-medium">
                  SLA predeterminado (horas)
                  <input
                    type="number"
                    min="1"
                    max="8760"
                    value={state.defaultSlaHours}
                    onChange={(event) => update('defaultSlaHours', Number(event.target.value))}
                    className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                  />
                </label>
                <label className="text-sm font-medium">
                  Retencion de actividad (dias)
                  <input
                    type="number"
                    min="30"
                    max="36500"
                    value={state.retentionDays}
                    onChange={(event) => update('retentionDays', Number(event.target.value))}
                    className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                  />
                </label>
                <label className="text-sm font-medium">
                  Zona horaria
                  <input
                    value={state.timezone}
                    onChange={(event) => update('timezone', event.target.value)}
                    className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                  />
                </label>
              </div>
            </div>
          )}
          {step === 3 && (
            <div className="mx-auto max-w-3xl">
              <h3 className="text-lg font-medium">Primer espacio de trabajo</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Puedes comenzar con un proyecto, cliente, contrato u operacion.
              </p>
              <label className="mt-6 block text-sm font-medium">
                Nombre del primer espacio (opcional)
                <input
                  value={state.firstSpaceName}
                  onChange={(event) => update('firstSpaceName', event.target.value)}
                  placeholder="Ej. Contrato marco 2026"
                  className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                />
              </label>
              <div className="mt-5 rounded-md border border-border bg-muted/30 p-4">
                <p className="text-sm font-medium">Acceso inicial</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  El espacio se crea con visibilidad interna. Sus miembros y permisos se administran
                  despues desde el propio espacio.
                </p>
                {spaces.length > 0 && (
                  <p className="mt-3 text-xs text-primary">
                    Tu organizacion ya tiene {spaces.length} espacio{spaces.length === 1 ? '' : 's'}
                    .
                  </p>
                )}
              </div>
            </div>
          )}
          {step === 4 && (
            <div className="mx-auto max-w-3xl">
              <h3 className="text-lg font-medium">Canales y horarios</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Configura como recibira el equipo los avisos de Colabora.
              </p>
              <div className="mt-5 rounded-md border border-border px-4">
                <Toggle
                  checked={state.inApp}
                  onChange={(value) => update('inApp', value)}
                  label="Notificaciones en Docubox"
                  description="Muestra avisos dentro de la plataforma."
                />
                <Toggle
                  checked={state.email}
                  onChange={(value) => update('email', value)}
                  label="Correo electronico"
                  description="Envia asignaciones y cambios relevantes."
                />
                <Toggle
                  checked={state.push}
                  onChange={(value) => update('push', value)}
                  label="Notificaciones push"
                  description="Activa avisos en dispositivos compatibles."
                />
                <Toggle
                  checked={state.dailyDigest}
                  onChange={(value) => update('dailyDigest', value)}
                  label="Resumen diario"
                  description="Agrupa actividad no urgente en un resumen."
                />
                <Toggle
                  checked={state.criticalAlerts}
                  onChange={(value) => update('criticalAlerts', value)}
                  label="Alertas criticas"
                  description="Avisa vencimientos, bloqueos y fallos relevantes."
                />
                <Toggle
                  checked={state.quietHoursEnabled}
                  onChange={(value) => update('quietHoursEnabled', value)}
                  label="Horario de silencio"
                  description="Pospone avisos no criticos fuera del horario laboral."
                />
              </div>
              {state.quietHoursEnabled && (
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <label className="text-sm font-medium">
                    Desde
                    <input
                      type="time"
                      value={state.quietFrom}
                      onChange={(event) => update('quietFrom', event.target.value)}
                      className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                    />
                  </label>
                  <label className="text-sm font-medium">
                    Hasta
                    <input
                      type="time"
                      value={state.quietTo}
                      onChange={(event) => update('quietTo', event.target.value)}
                      className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                    />
                  </label>
                </div>
              )}
            </div>
          )}
          {step === 5 && (
            <div className="mx-auto max-w-3xl">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                <Check size={24} />
              </div>
              <h3 className="mt-5 text-xl font-medium">Colabora esta listo para configurarse</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Revisa el alcance y finaliza para abrir el centro de trabajo.
              </p>
              <div className="mt-6 grid gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-3">
                <div className="bg-background p-4">
                  <p className="text-xs text-muted-foreground">Miembros con acceso</p>
                  <p className="mt-1 text-2xl font-medium">{members.length}</p>
                </div>
                <div className="bg-background p-4">
                  <p className="text-xs text-muted-foreground">Funciones habilitadas</p>
                  <p className="mt-1 text-2xl font-medium">{enabledFeatures.length}</p>
                </div>
                <div className="bg-background p-4">
                  <p className="text-xs text-muted-foreground">Periodo</p>
                  <p className="mt-1 text-lg font-medium">
                    {trialDays == null ? access.subscriptionStatus : `${trialDays} dias de prueba`}
                  </p>
                </div>
              </div>
              <div className="mt-5 rounded-md border border-border p-4">
                <p className="text-sm font-medium">Primeras acciones</p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full bg-muted px-3 py-1.5">Crear una tarea</span>
                  <span className="rounded-full bg-muted px-3 py-1.5">Iniciar una revision</span>
                  <span className="rounded-full bg-muted px-3 py-1.5">Invitar al equipo</span>
                  {state.firstSpaceName.trim() && (
                    <span className="rounded-full bg-primary/10 px-3 py-1.5 text-primary">
                      Crear {state.firstSpaceName.trim()}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <div>{error && <p className="text-sm text-red-600">{error}</p>}</div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={step === 0 || saving}
              onClick={() => setStep((current) => Math.max(0, current - 1))}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-sm disabled:opacity-40"
            >
              <ArrowLeft size={15} /> Atras
            </button>
            {step < steps.length - 1 ? (
              <button
                type="button"
                onClick={() => setStep((current) => Math.min(steps.length - 1, current + 1))}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white"
              >
                Continuar <ArrowRight size={15} />
              </button>
            ) : (
              <button
                type="button"
                onClick={complete}
                disabled={saving}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white disabled:opacity-60"
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}{' '}
                Finalizar configuracion
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
