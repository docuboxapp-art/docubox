'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface Workspace {
  id: string;
  name: string;
  workspaceType: 'personal' | 'business';
  ownerId: string;
  logoUrl?: string | null;
  description?: string | null;
  role: 'owner' | 'admin' | 'member';
  membershipStatus: 'invited' | 'active' | 'suspended' | 'blocked' | 'offboarded';
  organizationEnabled: boolean;
  collaborationEnabled: boolean;
}

interface WorkspaceContextValue {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  loading: boolean;
  setActiveWorkspace: (workspace: Workspace) => void;
  refreshWorkspaces: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue>({
  workspaces: [],
  activeWorkspace: null,
  loading: true,
  setActiveWorkspace: () => {},
  refreshWorkspaces: async () => {},
});

export const useWorkspace = () => useContext(WorkspaceContext);

const ACTIVE_WORKSPACE_KEY = 'docubox_active_workspace_id';

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspaceState] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const fetchWorkspaces = useCallback(async () => {
    if (!user) {
      setWorkspaces([]);
      setActiveWorkspaceState(null);
      setLoading(false);
      return;
    }

    try {
      let { data, error } = await supabase
        .from('workspace_members')
        .select(`
          role,
          status,
          workspaces (
            id,
            name,
            workspace_type,
            owner_id,
            logo_url,
            description,
            organization_enabled
          )
        `)
        .eq('user_id', user.id)
        .eq('status', 'active');

      // Keep existing accounts operational when the frontend is deployed just
      // before the organization migration reaches the database.
      const workspaceQueryError = error?.message || '';
      if (['organization_enabled', 'status'].some((column) => workspaceQueryError.includes(column))) {
        const fallback = await supabase
          .from('workspace_members')
          .select(`
            role,
            workspaces (
              id,
              name,
              workspace_type,
              owner_id,
              logo_url,
              description
            )
          `)
          .eq('user_id', user.id);
        data = fallback.data as typeof data;
        error = fallback.error;
      }

      if (error) {
        console.log('Workspace fetch error:', error.message);
        setLoading(false);
        return;
      }

      let mapped: Workspace[] = (data || [])
        .filter((row: any) => row.workspaces)
        .map((row: any) => ({
          id: row.workspaces.id,
          name: row.workspaces.name,
          workspaceType: row.workspaces.workspace_type as 'personal' | 'business',
          ownerId: row.workspaces.owner_id,
          logoUrl: row.workspaces.logo_url,
          description: row.workspaces.description,
          role: row.role as 'owner' | 'admin' | 'member',
          membershipStatus: (row.status || 'active') as Workspace['membershipStatus'],
          organizationEnabled: row.workspaces.organization_enabled == null
            ? row.workspaces.workspace_type === 'business'
            : Boolean(row.workspaces.organization_enabled),
          collaborationEnabled: false,
        }));

      const businessWorkspaceIds = mapped
        .filter((workspace) => workspace.workspaceType === 'business')
        .map((workspace) => workspace.id);
      if (businessWorkspaceIds.length) {
        const entitlementResult = await supabase
          .from('organization_entitlements')
          .select('workspace_id,status,ends_at')
          .in('workspace_id', businessWorkspaceIds)
          .eq('entitlement_key', 'collaboration_core')
          .in('status', ['trialing', 'active', 'past_due']);
        if (!entitlementResult.error) {
          const enabledIds = new Set(
            (entitlementResult.data || [])
              .filter((item) => !item.ends_at || new Date(item.ends_at).getTime() > Date.now())
              .map((item) => item.workspace_id)
          );
          mapped = mapped.map((workspace) => ({
            ...workspace,
            collaborationEnabled: enabledIds.has(workspace.id),
          }));
        }
      }

      // Sort: personal first, then business
      mapped.sort((a, b) => {
        if (a.workspaceType === 'personal') return -1;
        if (b.workspaceType === 'personal') return 1;
        return a.name.localeCompare(b.name);
      });

      setWorkspaces(mapped);

      // Restore previously selected workspace or default to personal
      const savedId = typeof window !== 'undefined'
        ? localStorage.getItem(ACTIVE_WORKSPACE_KEY)
        : null;

      const savedWorkspace = savedId ? mapped.find((w) => w.id === savedId) : null;
      const personalWorkspace = mapped.find((w) => w.workspaceType === 'personal');
      const businessWorkspace = mapped.find((w) => w.workspaceType === 'business');
      const isBusinessAccount = user.user_metadata?.account_type === 'empresarial';
      const compatibleSavedWorkspace = isBusinessAccount
        ? savedWorkspace?.workspaceType === 'business' ? savedWorkspace : null
        : savedWorkspace;

      setActiveWorkspaceState(
        compatibleSavedWorkspace ||
        (isBusinessAccount ? businessWorkspace : personalWorkspace) ||
        mapped[0] ||
        null
      );
    } catch (err) {
      console.log('Workspace context error:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  const setActiveWorkspace = useCallback((workspace: Workspace) => {
    setActiveWorkspaceState(workspace);
    if (typeof window !== 'undefined') {
      localStorage.setItem(ACTIVE_WORKSPACE_KEY, workspace.id);
    }
  }, []);

  return (
    <WorkspaceContext.Provider
      value={{
        workspaces,
        activeWorkspace,
        loading,
        setActiveWorkspace,
        refreshWorkspaces: fetchWorkspaces,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}
