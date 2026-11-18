'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import { loadCaseFolders, saveCaseFolders, type CaseFolder } from '@/lib/case-files/folders';

export function useCaseFolders(workspaceId?: string) {
  const { user } = useAuth();
  const [state, setState] = useState<{ key: string; folders: CaseFolder[]; error: string }>({
    key: '',
    folders: [],
    error: '',
  });
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const key = `${user?.id}:${workspaceId}`;
  useEffect(() => {
    if (!user?.id || !workspaceId) return;
    let live = true;
    loadCaseFolders(createClient(), user.id, workspaceId)
      .then((folders) => {
        if (live) setState({ key, folders, error: '' });
      })
      .catch(() => {
        if (live) setState({ key, folders: [], error: 'No se pudieron cargar tus carpetas.' });
      });
    return () => {
      live = false;
    };
  }, [user?.id, workspaceId, key, retry]);
  return {
    folders: state.key === key ? state.folders : [],
    ready: state.key === key && !state.error,
    error: state.key === key ? state.error : '',
    retry: () => setRetry((v) => v + 1),
    busy,
    save: async (folders: CaseFolder[]) => {
      if (!user?.id || !workspaceId || state.key !== key || state.error)
        throw new Error('Espera a que carguen tus carpetas.');
      setBusy(true);
      try {
        const saved = await saveCaseFolders(createClient(), user.id, workspaceId, folders);
        setState({ key, folders: saved, error: '' });
      } finally {
        setBusy(false);
      }
    },
  };
}
