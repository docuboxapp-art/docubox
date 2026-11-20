'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
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
  error: string;
  refresh: () => Promise<void>;
  can: (permission?: string, write?: boolean) => boolean;
}

const CollaborationContext = createContext<CollaborationContextValue>({
  access: unavailableCollaborationAccess,
  settings: null,
  loading: true,
  error: '',
  refresh: async () => {},
  can: () => false,
});

export function CollaborationProvider({ children }: { children: ReactNode }) {
  const { activeWorkspace, loading: workspaceLoading } = useWorkspace();
  const workspaceId = activeWorkspace?.id;
  const workspaceType = activeWorkspace?.workspaceType;
  const [access, setAccess] = useState(unavailableCollaborationAccess);
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const accessAttempt = useRef(0);
  const supabase = useMemo(() => createClient(), []);

  const refresh = useCallback(async () => {
    const attempt = ++accessAttempt.current;
    const current = () => attempt === accessAttempt.current;
    setError('');
    if (workspaceLoading) {
      setAccess(unavailableCollaborationAccess);
      setSettings(null);
      setLoading(true);
      return;
    }
    if (!workspaceId || workspaceType !== 'business') {
      setAccess({ ...unavailableCollaborationAccess, code: 'ORGANIZATION_REQUIRED' });
      setSettings(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!current()) return;
      if (!token) throw new Error('missing_session');
      const response = await fetch(`/api/colabora/access?workspace_id=${workspaceId}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(30_000),
      });
      const payload = await response.json();
      if (
        !response.ok ||
        !payload?.access ||
        typeof payload.access.eligible !== 'boolean' ||
        typeof payload.access.accessible !== 'boolean' ||
        typeof payload.access.writeAllowed !== 'boolean'
      )
        throw new Error('access_unavailable');
      if (!current()) return;
      setAccess(payload.access);
      setSettings(payload.settings || null);
    } catch {
      if (!current()) return;
      setAccess(unavailableCollaborationAccess);
      setSettings(null);
      setError('No se pudo comprobar el acceso a Colabora. Intenta nuevamente.');
    } finally {
      if (current()) setLoading(false);
    }
  }, [workspaceId, workspaceType, workspaceLoading, supabase]);

  const invalidateAccess = useCallback(() => {
    accessAttempt.current++;
  }, []);

  useEffect(() => {
    let mounted = true;
    void Promise.resolve().then(() => {
      if (mounted) void refresh();
    });
    return () => {
      mounted = false;
      invalidateAccess();
    };
  }, [refresh, invalidateAccess]);

  const value = useMemo(
    () => ({
      access,
      settings,
      loading,
      error,
      refresh,
      can: (permission?: string, write = false) => canUseCollaboration(access, permission, write),
    }),
    [access, loading, error, refresh, settings]
  );

  return <CollaborationContext.Provider value={value}>{children}</CollaborationContext.Provider>;
}

export const useCollaboration = () => useContext(CollaborationContext);
