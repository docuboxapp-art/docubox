'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Building2,
  CheckCircle,
  CheckCircle2,
  Clock,
  Edit3,
  FileText,
  Link2,
  Loader2,
  Lock,
  Mail,
  RefreshCw,
  User,
  UserPlus,
  X,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { createClient } from '@/lib/supabase/client';

type WorkspaceDocument = {
  id: string;
  estado?: string;
  status?: string;
  owner_id?: string;
};

type WorkspaceMember = {
  id: string;
  user_id: string;
  role: string;
  email?: string;
  nombre?: string;
  avatarUrl?: string | null;
};

type WorkspaceInvitation = {
  id: string;
  workspace_id: string;
  workspace_name: string;
  owner_name: string;
  owner_email: string;
  invited_at: string;
};

function SectionHeader() {
  return (
    <header className="border-b border-slate-200/80 pb-4 dark:border-slate-700">
      <h1 className="text-2xl font-700 text-slate-950 dark:text-white">Espacios de trabajo</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Gestiona tus espacios personales y de empresa.
      </p>
    </header>
  );
}

export function WorkspaceManagementSection() {
  const { user } = useAuth();
  const { workspaces, activeWorkspace, refreshWorkspaces, setActiveWorkspace } = useWorkspace();
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [workspaceDocuments, setWorkspaceDocuments] = useState<WorkspaceDocument[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'spaces' | 'join'>('spaces');
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [invitationsLoading, setInvitationsLoading] = useState(false);
  const [acceptingInvitationId, setAcceptingInvitationId] = useState<string | null>(null);
  const [invitationError, setInvitationError] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [joinSuccess, setJoinSuccess] = useState('');

  const currentWorkspaceId = selectedWorkspaceId || activeWorkspace?.id || null;
  const currentWorkspace = workspaces.find((workspace) => workspace.id === currentWorkspaceId);

  const loadWorkspaceDocuments = useCallback(async (workspaceId: string) => {
    if (!user) return;
    setDocumentsLoading(true);
    try {
      const supabase = createClient();
      const [{ data: legacyDocuments }, { data: documents }] = await Promise.all([
        supabase
          .from('documentos')
          .select('id, estado, owner_id')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false })
          .limit(100),
        supabase
          .from('documents')
          .select('id, status, owner_id')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false })
          .limit(100),
      ]);

      const combined = [...(legacyDocuments || []), ...(documents || [])].filter(
        (document, index, items) => items.findIndex((item) => item.id === document.id) === index
      );
      setWorkspaceDocuments(combined);
    } catch {
      setWorkspaceDocuments([]);
    } finally {
      setDocumentsLoading(false);
    }
  }, [user]);

  const loadWorkspaceMembers = useCallback(async (workspaceId: string) => {
    if (!user) return;
    setMembersLoading(true);
    try {
      const supabase = createClient();
      const { data: members } = await supabase
        .from('workspace_members')
        .select('id, user_id, role')
        .eq('workspace_id', workspaceId);

      if (!members?.length) {
        setWorkspaceMembers([]);
        return;
      }

      const userIds = members.map((member) => member.user_id);
      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('id, nombre, apellido_paterno, correo, avatar_url')
        .in('id', userIds);
      setWorkspaceMembers(
        members.map((member) => {
          const profile = profiles?.find((item) => item.id === member.user_id);
          return {
            id: member.id,
            user_id: member.user_id,
            role: member.role,
            email: profile?.correo || '',
            nombre: profile
              ? `${profile.nombre || ''} ${profile.apellido_paterno || ''}`.trim()
              : '',
            avatarUrl: profile?.avatar_url || null,
          };
        })
      );
    } catch {
      setWorkspaceMembers([]);
    } finally {
      setMembersLoading(false);
    }
  }, [user]);

  const loadInvitations = useCallback(async () => {
    if (!user) return;
    setInvitationsLoading(true);
    setInvitationError('');
    try {
      const supabase = createClient();
      const { data: pendingInvitations } = await supabase
        .from('workspace_members')
        .select('id, workspace_id, created_at')
        .eq('user_id', user.id)
        .eq('role', 'invited');

      if (!pendingInvitations?.length) {
        setInvitations([]);
        return;
      }

      const workspaceIds = pendingInvitations.map((invitation) => invitation.workspace_id);
      const { data: invitationWorkspaces } = await supabase
        .from('workspaces')
        .select('id, name, owner_id')
        .in('id', workspaceIds);
      const ownerIds = (invitationWorkspaces || []).map((workspace) => workspace.owner_id).filter(Boolean);
      const { data: ownerProfiles } = ownerIds.length
        ? await supabase
            .from('user_profiles')
            .select('id, nombre, apellido_paterno, correo')
            .in('id', ownerIds)
        : { data: [] };

      setInvitations(
        pendingInvitations.map((invitation) => {
          const workspace = invitationWorkspaces?.find(
            (item) => item.id === invitation.workspace_id
          );
          const owner = ownerProfiles?.find((item) => item.id === workspace?.owner_id);
          return {
            id: invitation.id,
            workspace_id: invitation.workspace_id,
            workspace_name: workspace?.name || 'Espacio desconocido',
            owner_name: owner
              ? `${owner.nombre || ''} ${owner.apellido_paterno || ''}`.trim()
              : '',
            owner_email: owner?.correo || '',
            invited_at: invitation.created_at,
          };
        })
      );
    } catch {
      setInvitations([]);
      setInvitationError('No fue posible cargar las invitaciones.');
    } finally {
      setInvitationsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!currentWorkspaceId) {
      setWorkspaceDocuments([]);
      setWorkspaceMembers([]);
      return;
    }
    void loadWorkspaceDocuments(currentWorkspaceId);
    void loadWorkspaceMembers(currentWorkspaceId);
  }, [currentWorkspaceId, loadWorkspaceDocuments, loadWorkspaceMembers]);

  useEffect(() => {
    if (activeTab === 'join') void loadInvitations();
  }, [activeTab, loadInvitations]);

  const handleAcceptInvitation = async (invitation: WorkspaceInvitation) => {
    setAcceptingInvitationId(invitation.id);
    setInvitationError('');
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('workspace_members')
        .update({ role: 'member' })
        .eq('id', invitation.id);
      if (error) throw error;
      await refreshWorkspaces();
      setInvitations((current) => current.filter((item) => item.id !== invitation.id));
    } catch (error) {
      setInvitationError(error instanceof Error ? error.message : 'Error al aceptar la invitación.');
    } finally {
      setAcceptingInvitationId(null);
    }
  };

  const handleJoinWorkspace = async () => {
    if (!user || !joinCode.trim()) return;
    setJoinLoading(true);
    setJoinError('');
    setJoinSuccess('');
    try {
      const supabase = createClient();
      const search = joinCode.trim();
      const { data: matches } = await supabase
        .from('workspaces')
        .select('id, name, workspace_type')
        .or(`invite_code.eq.${search},name.ilike.${search}`);
      const workspace = matches?.[0];
      if (!workspace) {
        setJoinError('No se encontró ningún espacio de trabajo con ese código o nombre.');
        return;
      }
      if (workspace.workspace_type === 'personal') {
        setJoinError('No puedes unirte a un espacio de trabajo personal.');
        return;
      }
      const { data: membership } = await supabase
        .from('workspace_members')
        .select('id')
        .eq('workspace_id', workspace.id)
        .eq('user_id', user.id)
        .maybeSingle();
      if (membership) {
        setJoinError('Ya eres miembro de este espacio de trabajo.');
        return;
      }
      const { error } = await supabase
        .from('workspace_members')
        .insert({ workspace_id: workspace.id, user_id: user.id, role: 'member' });
      if (error) throw error;
      setJoinSuccess(`Te has unido a "${workspace.name}" exitosamente.`);
      setJoinCode('');
      await refreshWorkspaces();
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : 'Error al unirse al espacio de trabajo.');
    } finally {
      setJoinLoading(false);
    }
  };

  const documentCounts = useMemo(() => {
    const count = (states: string[]) =>
      workspaceDocuments.filter((document) => states.includes(document.estado || document.status || ''))
        .length;
    return {
      total: workspaceDocuments.length,
      own: workspaceDocuments.filter((document) => document.owner_id === user?.id).length,
      participant: workspaceDocuments.filter(
        (document) => Boolean(document.owner_id) && document.owner_id !== user?.id
      ).length,
      completed: count(['completado', 'completed']),
      inProgress: count(['en_proceso', 'pendiente', 'en proceso', 'in_progress']),
      drafts: count(['borrador', 'draft']),
      expired: count(['vencido', 'expired', 'expirado']),
      rejected: count(['rechazado', 'rejected', 'cancelado', 'cancelled']),
    };
  }, [workspaceDocuments]);

  const otherMembers = workspaceMembers.filter((member) => member.user_id !== user?.id);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader />

      <div className="flex gap-1 border-b border-border">
        <button
          type="button"
          onClick={() => setActiveTab('spaces')}
          className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-600 transition-all ${activeTab === 'spaces' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          <Building2 size={15} />
          Mis espacios de trabajo
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('join')}
          className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-600 transition-all ${activeTab === 'join' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          <UserPlus size={15} />
          Unirse a un espacio
          {invitations.length > 0 && (
            <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-700 text-white">
              {invitations.length}
            </span>
          )}
        </button>
      </div>

      {activeTab === 'spaces' ? (
        <>
          <section className="flex flex-col gap-4 rounded-xl border border-border bg-white p-5">
            <h2 className="flex items-center gap-2 text-sm font-700 text-primary">
              <Building2 size={15} />
              Mis espacios de trabajo
            </h2>
            {workspaces.length ? (
              <div className="flex flex-wrap gap-2">
                {workspaces.map((workspace) => {
                  const selected = workspace.id === currentWorkspaceId;
                  const isOwner = workspace.ownerId === user?.id;
                  return (
                    <button
                      key={workspace.id}
                      type="button"
                      onClick={() => {
                        setSelectedWorkspaceId(workspace.id);
                        setActiveWorkspace(workspace);
                      }}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-all ${selected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100">
                        <Building2 size={15} className={selected ? 'text-primary' : 'text-muted-foreground'} />
                      </div>
                      <div className="min-w-0 flex-1 text-left">
                        <p className="truncate text-sm font-600 text-foreground">{workspace.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {workspace.workspaceType === 'personal' ? 'Personal' : 'Empresarial'}
                        </p>
                        <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                          {isOwner ? <Lock size={9} /> : <Link2 size={9} className="text-blue-400" />}
                          {isOwner ? 'Propietario' : 'Compartido'}
                        </p>
                      </div>
                      {selected && <CheckCircle size={16} className="shrink-0 text-primary" />}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No tienes espacios de trabajo disponibles.</p>
            )}
          </section>

          {currentWorkspaceId && (
            <section className="flex flex-col gap-4 rounded-xl border border-border bg-white p-5">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                  <Activity size={15} className="text-primary" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-700 text-primary">
                    Estadísticas del espacio{currentWorkspace ? `: ${currentWorkspace.name}` : ''}
                  </h2>
                  <p className="text-xs text-muted-foreground">Documentos por estado en este espacio</p>
                </div>
                {documentsLoading && <Loader2 size={14} className="ml-auto animate-spin text-primary" />}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  { label: 'Documentos del espacio', value: documentCounts.total, icon: FileText, tone: 'blue' },
                  { label: 'Documentos propios', value: documentCounts.own, icon: User, tone: 'indigo' },
                  { label: 'De otros participantes', value: documentCounts.participant, icon: UserPlus, tone: 'purple' },
                ].map(({ label, value, icon: Icon, tone }) => (
                  <div key={label} className={`rounded-xl border p-4 ${statCardClasses[tone]}`}>
                    <div className="mb-1 flex items-center gap-2">
                      <Icon size={16} />
                      <span className="text-xs font-600 uppercase tracking-wide">{label}</span>
                    </div>
                    <span className="text-2xl font-700">{value}</span>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                {[
                  { label: 'Completados', value: documentCounts.completed, icon: CheckCircle, tone: 'green' },
                  { label: 'En progreso', value: documentCounts.inProgress, icon: Clock, tone: 'yellow' },
                  { label: 'Vencidos', value: documentCounts.expired, icon: AlertCircle, tone: 'red' },
                  { label: 'Rechazados', value: documentCounts.rejected, icon: X, tone: 'orange' },
                  { label: 'Borradores', value: documentCounts.drafts, icon: Edit3, tone: 'gray' },
                ].map(({ label, value, icon: Icon, tone }) => (
                  <div key={label} className={`rounded-xl border p-4 ${statCardClasses[tone]}`}>
                    <div className="mb-1 flex items-center gap-2">
                      <Icon size={16} />
                      <span className="text-xs font-600 uppercase tracking-wide">{label}</span>
                    </div>
                    <span className="text-2xl font-700">{value}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {currentWorkspaceId && (
            <section className="flex flex-col gap-3 rounded-xl border border-border bg-white p-5">
              <h2 className="flex items-center gap-2 text-sm font-700 text-primary">
                <UserPlus size={15} />
                Compartido con
                {membersLoading && <Loader2 size={12} className="animate-spin text-primary" />}
              </h2>
              {!membersLoading && otherMembers.length === 0 ? (
                <div className="flex items-center gap-2 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-3">
                  <Lock size={14} className="shrink-0 text-gray-400" />
                  <p className="text-sm text-muted-foreground">
                    Este espacio de trabajo no está compartido con otros usuarios.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {otherMembers.map((member) => (
                    <div key={member.id} className="flex items-center gap-3 rounded-lg border border-border bg-gray-50 px-3 py-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10">
                        {member.avatarUrl ? (
                          <img src={member.avatarUrl} alt={member.nombre || member.email || ''} className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-xs font-700 text-primary">{(member.nombre || member.email || '?').charAt(0).toUpperCase()}</span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        {member.nombre && <p className="truncate text-sm font-600 text-foreground">{member.nombre}</p>}
                        <p className="truncate text-xs text-muted-foreground">{member.email || member.user_id}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-500 ${member.role === 'owner' ? 'bg-emerald-100 text-emerald-700' : member.role === 'admin' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                        {member.role === 'owner' ? 'Propietario' : member.role === 'admin' ? 'Admin' : 'Miembro'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      ) : (
        <>
          <section className="flex flex-col gap-4 rounded-xl border border-border bg-white p-5">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-700 text-primary"><UserPlus size={15} /> Unirse a un espacio de trabajo</h2>
              <p className="mt-1 text-xs text-muted-foreground">Ingresa el código de invitación o el nombre del espacio al que deseas unirte.</p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                type="text"
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && void handleJoinWorkspace()}
                placeholder="Ej. EMPRESA-2024 o nombre del espacio"
                className="flex-1 rounded-lg border border-border bg-white px-3 py-2.5 text-sm text-foreground placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <button type="button" onClick={() => void handleJoinWorkspace()} disabled={joinLoading || !joinCode.trim()} className="flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-600 text-white transition-colors hover:bg-primary/90 disabled:opacity-60">
                {joinLoading ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />} Unirse
              </button>
            </div>
            {joinError && <Feedback message={joinError} tone="error" />}
            {joinSuccess && <Feedback message={joinSuccess} tone="success" />}
          </section>

          <section className="flex flex-col gap-4 rounded-xl border border-border bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-700 text-primary"><Mail size={15} /> Invitaciones recibidas</h2>
                <p className="mt-1 text-xs text-muted-foreground">Invitaciones de propietarios de otros espacios de trabajo.</p>
              </div>
              <button type="button" onClick={() => void loadInvitations()} disabled={invitationsLoading} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-500 text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-50">
                <RefreshCw size={12} className={invitationsLoading ? 'animate-spin' : ''} /> Actualizar
              </button>
            </div>
            {invitationError && <Feedback message={invitationError} tone="error" />}
            {!invitationsLoading && invitations.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-8">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100"><Mail size={20} className="text-gray-400" /></div>
                <p className="text-center text-sm text-muted-foreground">No tienes invitaciones pendientes.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {invitations.map((invitation) => (
                  <div key={invitation.id} className="flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10"><Building2 size={18} className="text-primary" /></div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-600 text-foreground">{invitation.workspace_name}</p>
                      <p className="truncate text-xs text-muted-foreground">Invitado por: {invitation.owner_name || invitation.owner_email || 'Propietario'}</p>
                    </div>
                    <button type="button" onClick={() => void handleAcceptInvitation(invitation)} disabled={acceptingInvitationId === invitation.id} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-600 text-white transition-colors hover:bg-primary/90 disabled:opacity-60">
                      {acceptingInvitationId === invitation.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Aceptar invitación
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

const statCardClasses: Record<string, string> = {
  blue: 'border-blue-100 bg-blue-50 text-blue-700',
  indigo: 'border-indigo-100 bg-indigo-50 text-indigo-700',
  purple: 'border-purple-100 bg-purple-50 text-purple-700',
  green: 'border-green-100 bg-green-50 text-green-700',
  yellow: 'border-yellow-100 bg-yellow-50 text-yellow-700',
  red: 'border-red-100 bg-red-50 text-red-700',
  orange: 'border-orange-100 bg-orange-50 text-orange-700',
  gray: 'border-gray-200 bg-gray-50 text-gray-700',
};

function Feedback({ message, tone }: { message: string; tone: 'error' | 'success' }) {
  const isError = tone === 'error';
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${isError ? 'border-red-200 bg-red-50 text-red-700' : 'border-green-200 bg-green-50 text-green-700'}`}>
      {isError ? <AlertCircle size={14} /> : <CheckCircle size={14} />}
      {message}
    </div>
  );
}
