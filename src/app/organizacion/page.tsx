'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  Circle,
  Clock3,
  Mail,
  RefreshCw,
  ShieldCheck,
  Users,
  UsersRound,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { organizationSections } from '@/lib/organization/sections';
import {
  emptyOrganizationDashboard,
  loadOrganizationDashboard,
} from '@/lib/organization/dashboard';
import { useOrganizationAccess } from './_components/OrganizationAccessContext';
import OrganizationSectionIcon from './_components/OrganizationSectionIcon';

function humanDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Fecha no disponible'
    : new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

const shortcutKeys = ['members', 'teams', 'roles', 'workflows', 'resources', 'security'];

export default function OrganizationDashboardPage() {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id;
  const { canAccess } = useOrganizationAccess();
  const supabase = useMemo(() => createClient(), []);
  const [summary, setSummary] = useState(emptyOrganizationDashboard);
  const [loading, setLoading] = useState(true);
  const [incomplete, setIncomplete] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!workspaceId) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    let active = true;
    async function load() {
      await Promise.resolve();
      if (!active) return;
      setLoading(true);
      setIncomplete(false);
      try {
        const result = await loadOrganizationDashboard(
          supabase,
          workspaceId!,
          canAccess,
          controller.signal
        );
        if (!active) return;
        setSummary(result.summary);
        setIncomplete(result.incomplete);
      } catch {
        if (active) setIncomplete(true);
      } finally {
        clearTimeout(timeout);
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [workspaceId, canAccess, retry, supabase]);

  const checklist = [
    {
      label: 'Datos generales y contacto',
      done: Boolean(summary.organization?.legal_name && summary.organization?.contact_email),
      href: '/organizacion/perfil',
      permission: 'organization.read',
    },
    {
      label: 'Información fiscal',
      done: Boolean(summary.organization?.rfc),
      href: '/organizacion/perfil',
      permission: 'organization.read',
    },
    {
      label: 'Invitar al equipo',
      done: summary.members !== null && summary.members > 1,
      href: '/organizacion/miembros',
      permission: 'members.read',
    },
    {
      label: 'Definir roles y permisos',
      done: summary.customRoles !== null && summary.customRoles > 0,
      href: '/organizacion/roles',
      permission: 'roles.read',
    },
  ].filter((item) => canAccess(item.permission));
  const completed = checklist.filter((item) => item.done).length;
  const progress = checklist.length ? Math.round((completed / checklist.length) * 100) : 0;
  const shortcuts = shortcutKeys
    .map((key) => organizationSections.find((section) => section.key === key)!)
    .filter((section) => canAccess(section.permission));
  const verified = summary.organization?.kyb_status === 'verified';
  const stats = [
    {
      label: 'Miembros activos',
      value: summary.members,
      icon: Users,
      href: '/organizacion/miembros',
      permission: 'members.read',
      tone: 'blue',
      note: 'Personas con acceso a tu organización',
    },
    {
      label: 'Equipos y áreas',
      value: summary.teams,
      icon: UsersRound,
      href: '/organizacion/equipos',
      permission: 'teams.read',
      tone: 'violet',
      note: 'Estructura activa del equipo',
    },
    {
      label: 'Invitaciones pendientes',
      value: summary.pendingInvitations,
      icon: Mail,
      href: '/organizacion/miembros',
      permission: 'members.read',
      tone: 'amber',
      note: 'Invitaciones vigentes por aceptar',
    },
    {
      label: 'Verificación (KYB)',
      value: summary.organization ? (verified ? 'Verificada' : 'Pendiente') : null,
      icon: ShieldCheck,
      href: '/organizacion/perfil',
      permission: 'organization.read',
      tone: verified ? 'green' : 'slate',
      note: 'Identidad y evidencias de la organización',
    },
  ].filter((item) => canAccess(item.permission));

  return (
    <div className="organization-dashboard app-page-width" aria-busy={loading}>
      <div className="organization-dashboard-heading">
        <div>
          <h2>Panel de administración</h2>
          <p>Tu equipo, la operación y la configuración, en un solo lugar.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="organization-refresh-button"
            aria-label="Actualizar resumen"
            title="Actualizar resumen"
            disabled={loading}
            onClick={() => setRetry((value) => value + 1)}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          {canAccess('members.read') && (
            <Link
              href="/organizacion/miembros"
              prefetch={false}
              className="organization-primary-button"
            >
              <Users size={16} aria-hidden="true" />
              Gestionar miembros
            </Link>
          )}
        </div>
      </div>

      {incomplete && (
        <div className="organization-dashboard-notice" role="alert">
          <span>Algunos datos no están disponibles. Vuelve a actualizar el resumen.</span>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Reintentar
          </button>
        </div>
      )}

      <div className="organization-stat-grid">
        {stats.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            prefetch={false}
            className="organization-stat-card"
          >
            <div className="flex items-center justify-between gap-2">
              <span className={`organization-stat-icon organization-tone-${item.tone}`}>
                <item.icon size={18} aria-hidden="true" />
              </span>
              <ArrowRight size={14} className="text-muted-foreground" aria-hidden="true" />
            </div>
            <p className="organization-stat-value">{loading ? '—' : (item.value ?? '—')}</p>
            <h3>{item.label}</h3>
            <p className="organization-stat-note">{item.note}</p>
          </Link>
        ))}
      </div>

      <div className="organization-dashboard-columns">
        <div className="min-w-0 space-y-5">
          {!!shortcuts.length && (
            <section className="organization-dashboard-card">
              <div className="organization-card-heading">
                <div>
                  <h3>Accesos rápidos</h3>
                  <p>Las herramientas de tu día a día.</p>
                </div>
              </div>
              <div className="organization-shortcuts">
                {shortcuts.map((item) => (
                  <Link
                    key={item.key}
                    href={item.href}
                    prefetch={false}
                    className="organization-shortcut"
                  >
                    <span className="organization-shortcut-icon">
                      <OrganizationSectionIcon section={item.key} size={19} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="organization-shortcut-title">{item.label}</span>
                      <span className="organization-shortcut-description">{item.description}</span>
                    </span>
                    <ArrowRight
                      size={14}
                      className="shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section className="organization-dashboard-card">
            <div className="organization-card-heading">
              <div>
                <h3>Actividad reciente</h3>
                <p>Lo que ha cambiado en tu organización.</p>
              </div>
              {canAccess('audit.read') && (
                <Link href="/organizacion/auditoria" prefetch={false}>
                  Ver auditoría
                  <ArrowRight size={13} aria-hidden="true" />
                </Link>
              )}
            </div>
            {loading ? (
              <p className="organization-empty-state" role="status">
                Cargando actividad...
              </p>
            ) : summary.recentEvents?.length ? (
              <ol className="organization-activity-list">
                {summary.recentEvents.map((event) => (
                  <li key={event.id}>
                    <span className="organization-activity-icon">
                      <Activity size={15} aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p>{event.summary}</p>
                      <time dateTime={event.occurred_at}>{humanDate(event.occurred_at)}</time>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="organization-empty-state">
                <Clock3
                  size={22}
                  className="mx-auto mb-2 text-muted-foreground"
                  aria-hidden="true"
                />
                <p>
                  {summary.recentEvents === null
                    ? 'La actividad se mostrará cuando esté disponible para tu acceso.'
                    : 'Aún no hay eventos administrativos.'}
                </p>
              </div>
            )}
          </section>
        </div>

        <div className="organization-dashboard-support min-w-0">
          <section className="organization-dashboard-card">
            <div className="organization-card-heading">
              <div>
                <h3>Puesta en marcha</h3>
                <p>
                  {loading
                    ? 'Consultando configuración...'
                    : `${completed} de ${checklist.length} configuraciones listas`}
                </p>
              </div>
              <span className="organization-progress-label">{loading ? '—' : `${progress}%`}</span>
            </div>
            <div className="organization-setup-body">
              <div
                className="organization-setup-progress"
                role="progressbar"
                aria-label="Avance de configuración"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={loading ? undefined : progress}
              >
                <div style={{ width: `${loading ? 0 : progress}%` }} />
              </div>
              <ul className="organization-setup-list">
                {checklist.map((item) => (
                  <li key={item.label}>
                    <Link href={item.href} prefetch={false}>
                      <span
                        className={
                          item.done && !loading
                            ? 'organization-setup-done'
                            : 'organization-setup-pending'
                        }
                      >
                        {item.done && !loading ? (
                          <Check size={13} aria-hidden="true" />
                        ) : (
                          <Circle size={13} aria-hidden="true" />
                        )}
                      </span>
                      <span className="flex-1">{item.label}</span>
                      <ArrowRight size={13} className="text-muted-foreground" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
              {completed === checklist.length && !loading && (
                <p className="organization-setup-complete">
                  <CheckCircle2 size={14} aria-hidden="true" />
                  Configuración inicial completa
                </p>
              )}
            </div>
          </section>

          <section className="organization-dashboard-card">
            <div className="organization-card-heading">
              <div>
                <h3>Identidad organizacional</h3>
                <p>Datos del espacio de trabajo.</p>
              </div>
              <Building2 size={18} className="text-muted-foreground" aria-hidden="true" />
            </div>
            <div className="organization-identity-body">
              <dl>
                <div>
                  <dt>Razón social</dt>
                  <dd>
                    {loading ? '—' : summary.organization?.legal_name || 'Pendiente de completar'}
                  </dd>
                </div>
                <div>
                  <dt>RFC</dt>
                  <dd>{loading ? '—' : summary.organization?.rfc || 'No registrado'}</dd>
                </div>
                <div>
                  <dt>Correo de contacto</dt>
                  <dd>{loading ? '—' : summary.organization?.contact_email || 'No registrado'}</dd>
                </div>
              </dl>
              <Link
                href="/organizacion/perfil"
                prefetch={false}
                className="organization-profile-link"
              >
                {canAccess('organization.profile.update')
                  ? 'Completar o editar perfil'
                  : 'Ver perfil'}
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
              <p className="organization-identity-note">
                Los estados de verificación solo cambian cuando existe evidencia registrada.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
