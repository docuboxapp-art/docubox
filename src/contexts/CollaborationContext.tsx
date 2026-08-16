'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import {
  canUseCollaboration,
  unavailableCollaborationAccess,
  type CollaborationAccess,
} from '@/lib/collaboration/domain';

interface CollaborationContextValue {
  access: CollaborationAccess;
  settings: Record<string, unknown> | null;
  loading: boolean;
  refresh: () => Promise<void>;
  can: (permission?: string, write?: boolean) => boolean;
}

const CollaborationContext = createContext<CollaborationContextValue>({
  access: unavailableCollaborationAccess,
  settings: null,
  loading: true,
  refresh: async () => {},
  can: () => false,
});

export function CollaborationProvider({ children }: { children: React.ReactNode }) {
  const { activeWorkspace } = useWorkspace();
  const [access, setAccess] = useState(unavailableCollaborationAccess);
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = useMemo(() => createClient(), []);

  const refresh = useCallback(async () => {
    if (!activeWorkspace?.id || activeWorkspace.workspaceType !== 'business') {
      setAccess({ ...unavailableCollaborationAccess, code: 'ORGANIZATION_REQUIRED' });
      setSettings(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('missing_session');
      const response = await fetch(`/api/colabora/access?workspace_id=${activeWorkspace.id}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'access_unavailable');
      setAccess(payload.access);
      setSettings(payload.settings || null);
    } catch {
      setAccess(unavailableCollaborationAccess);
      setSettings(null);
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace?.id, activeWorkspace?.workspaceType, supabase]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(() => ({
    access,
    settings,
    loading,
    refresh,
    can: (permission?: string, write = false) => canUseCollaboration(access, permission, write),
  }), [access, loading, refresh, settings]);

  return <CollaborationContext.Provider value={value}>{children}</CollaborationContext.Provider>;
}

export const useCollaboration = () => useContext(CollaborationContext);

