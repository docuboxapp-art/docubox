'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import {
  loadCaseView,
  normalizeCaseView,
  saveCaseView,
  type CaseViewPreferences,
} from '@/lib/case-files/view-preferences';

const defaults = normalizeCaseView(null);
export function useCaseView(workspaceId?: string) {
  const { user } = useAuth();
  const key = `${user?.id}:${workspaceId}`;
  const [state, setState] = useState<{ key: string; value: CaseViewPreferences; error: string }>({
    key: '',
    value: defaults,
    error: '',
  });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!user?.id || !workspaceId) return;
    let live = true;
    loadCaseView(createClient(), user.id, workspaceId)
      .then((value) => {
        if (live) setState({ key, value, error: '' });
      })
      .catch(() => {
        if (live)
          setState({
            key,
            value: defaults,
            error: 'No se pudo cargar la personalización de la vista.',
          });
      });
    return () => {
      live = false;
    };
  }, [user?.id, workspaceId, key, retry]);
  return {
    value: state.key === key ? state.value : defaults,
    ready: state.key === key && !state.error,
    error: state.key === key ? state.error : '',
    retry: () => setRetry((v) => v + 1),
    save: async (value: CaseViewPreferences) => {
      if (!user?.id || !workspaceId || state.key !== key || state.error)
        throw new Error('Espera a que cargue la personalización de la vista.');
      const saved = await saveCaseView(createClient(), user.id, workspaceId, value);
      setState({ key, value: saved, error: '' });
    },
  };
}
