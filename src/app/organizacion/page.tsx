'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Activity, ArrowRight, Building2, CheckCircle2, CircleAlert, Clock3, ShieldCheck, Users, UsersRound } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/contexts/WorkspaceContext';

type Summary = {
  members: number;
  teams: number;
  pendingInvitations: number;
  recentEvents: Array<{ id: string; summary: string; event_type: string; occurred_at: string }>;
  organization: { legal_name: string | null; rfc: string | null; contact_email: string | null; verification_status: string | null; kyb_status: string | null } | null;
};

const emptySummary: Summary = { members: 0, teams: 0, pendingInvitations: 0, recentEvents: [], organization: null };

function humanDate(value: string) {
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export default function OrganizationDashboardPage() {
  const { activeWorkspace } = useWorkspace();
  const [summary, setSummary] = useState(emptySummary);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeWorkspace?.id) return;
    const supabase = createClient();
    const load = async () => {
      setLoading(true);
      const [workspaceResult, membersResult, teamsResult, invitationsResult, auditResult] = await Promise.all([
        supabase.from('workspaces').select('legal_name,rfc,contact_email,verification_status,kyb_status').eq('id', activeWorkspace.id).maybeSingle(),
        supabase.from('workspace_members').select('id', { count: 'exact', head: true }).eq('workspace_id', activeWorkspace.id).eq('status', 'active'),
        supabase.from('organization_units').select('id', { count: 'exact', head: true }).eq('workspace_id', activeWorkspace.id).eq('status', 'active'),
        supabase.from('organization_invitations').select('id', { count: 'exact', head: true }).eq('workspace_id', activeWorkspace.id).eq('status', 'pending'),
        supabase.from('organization_audit_events').select('id,summary,event_type,occurred_at').eq('workspace_id', activeWorkspace.id).order('occurred_at', { ascending: false }).limit(5),
      ]);
      setSummary({ organization: workspaceResult.data, members: membersResult.count ?? 0, teams: teamsResult.count ?? 0, pendingInvitations: invitationsResult.count ?? 0, recentEvents: auditResult.data ?? [] });
      setLoading(false);
    };
    load();
  }, [activeWorkspace?.id]);

  const checklist = [
    { label: 'Completar datos generales y contacto', done: Boolean(summary.organization?.legal_name && summary.organization?.contact_email), href: '/organizacion/perfil' },
    { label: 'Registrar datos fiscales', done: Boolean(summary.organization?.rfc), href: '/organizacion/perfil' },
    { label: 'Invitar al equipo', done: summary.members > 1, href: '/organizacion/miembros' },
    { label: 'Definir roles y permisos', done: summary.members > 0, href: '/organizacion/roles' },
  ];
  const completed = checklist.filter((item) => item.done).length;

  return (
    <div className="max-w-[1500px] mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div><h2 className="text-xl font-medium text-foreground">Resumen</h2><p className="mt-1 text-sm text-muted-foreground">Gobierno, acceso y operación del espacio empresarial.</p></div>
        <Link href="/organizacion/miembros" className="inline-flex h-10 items-center justify-center gap-2 px-4 rounded-md bg-primary text-white text-sm font-medium"><Users size={16} /> Gestionar miembros</Link>
      </div>

      <section className="bg-background border border-border rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3"><div><h3 className="font-medium text-foreground">Puesta en marcha</h3><p className="text-sm text-muted-foreground mt-0.5">{completed} de {checklist.length} tareas completadas</p></div><span className="text-sm font-medium text-primary">{Math.round((completed / checklist.length) * 100)}%</span></div>
        <div className="h-1 bg-muted"><div className="h-full bg-primary" style={{ width: `${(completed / checklist.length) * 100}%` }} /></div>
        <div className="divide-y divide-border">{checklist.map((item) => <Link key={item.label} href={item.href} className="flex items-center gap-3 px-5 py-3.5 hover:bg-muted/50 transition-colors">{item.done ? <CheckCircle2 size={18} className="text-emerald-600" /> : <CircleAlert size={18} className="text-amber-500" />}<span className="text-sm text-foreground flex-1">{item.label}</span><ArrowRight size={15} className="text-muted-foreground" /></Link>)}</div>
      </section>

      <section className="grid sm:grid-cols-2 xl:grid-cols-4 bg-background border border-border rounded-lg overflow-hidden divide-y sm:divide-y-0 sm:divide-x divide-border">
        {[
          { label: 'Miembros activos', value: summary.members, icon: Users, href: '/organizacion/miembros' },
          { label: 'Equipos y áreas', value: summary.teams, icon: UsersRound, href: '/organizacion/equipos' },
          { label: 'Invitaciones pendientes', value: summary.pendingInvitations, icon: Clock3, href: '/organizacion/miembros' },
          { label: 'Estado KYB', value: summary.organization?.kyb_status === 'verified' ? 'Verificado' : 'Pendiente', icon: ShieldCheck, href: '/organizacion/perfil' },
        ].map((item) => <Link key={item.label} href={item.href} className="p-5 hover:bg-muted/40 transition-colors min-h-28"><item.icon size={18} className="text-primary" /><p className="mt-3 text-2xl font-medium text-foreground tabular-nums">{loading ? '—' : item.value}</p><p className="mt-1 text-sm text-muted-foreground">{item.label}</p></Link>)}
      </section>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_360px] gap-5">
        <section className="bg-background border border-border rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between"><div><h3 className="font-medium text-foreground">Actividad reciente</h3><p className="mt-0.5 text-sm text-muted-foreground">Eventos administrativos de la organización.</p></div><Link href="/organizacion/auditoria" className="text-sm text-primary font-medium">Ver auditoría</Link></div>
          {summary.recentEvents.length ? <div className="divide-y divide-border">{summary.recentEvents.map((event) => <div key={event.id} className="px-5 py-3.5 flex gap-3"><Activity size={16} className="mt-0.5 text-muted-foreground shrink-0" /><div><p className="text-sm text-foreground">{event.summary}</p><p className="mt-0.5 text-xs text-muted-foreground">{humanDate(event.occurred_at)}</p></div></div>)}</div> : <div className="px-5 py-12 text-center text-sm text-muted-foreground">Aún no hay eventos administrativos.</div>}
        </section>
        <section className="bg-background border border-border rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-border"><h3 className="font-medium text-foreground">Identidad organizacional</h3></div>
          <div className="p-5 space-y-4"><div className="flex items-start gap-3"><Building2 size={18} className="text-primary mt-0.5" /><div><p className="text-xs uppercase text-muted-foreground">Razón social</p><p className="text-sm text-foreground mt-1">{summary.organization?.legal_name || 'Pendiente de completar'}</p></div></div><div><p className="text-xs uppercase text-muted-foreground">RFC</p><p className="text-sm text-foreground mt-1">{summary.organization?.rfc || 'No registrado'}</p></div><div className="pt-3 border-t border-border"><p className="text-xs text-muted-foreground">Los estados de verificación solo cambian cuando existe evidencia registrada.</p></div></div>
        </section>
      </div>
    </div>
  );
}
