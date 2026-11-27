'use client';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import {
  loadCaseView,
  normalizeCaseView,
  saveCaseColumnWidths,
  saveCaseView,
  type CaseColumnWidths,
  type CaseViewPreferences,
} from '@/lib/case-files/view-preferences';

const defaults = {
  key: '',
  value: normalizeCaseView(null),
  widths: {} as CaseColumnWidths,
  error: '',
  widthError: false,
};

export function useCaseView(workspaceId?: string) {
  const { user } = useAuth();
  const userId = user?.id;
  const key = `${userId}:${workspaceId}`;
  const [state, setState] = useState(defaults);
  const [retry, setRetry] = useState(0);
  const latestWidths = useRef({ key: '', widths: defaults.widths });
  const widthWrites = useRef(Promise.resolve());

  useEffect(() => {
    if (!userId || !workspaceId) return;
    let live = true;
    loadCaseView(createClient(), userId, workspaceId)
      .then(({ view, widths }) => {
        if (!live) return;
        latestWidths.current = { key, widths };
        setState({ ...defaults, key, value: view, widths });
      })
      .catch(() => {
        if (live)
          setState({
            ...defaults,
            key,
            error: 'No se pudo cargar la personalización de la vista.',
          });
      });
    return () => {
      live = false;
    };
  }, [userId, workspaceId, key, retry]);

  const current = state.key === key ? state : defaults;
  const ready = state.key === key && !state.error;

  function persistWidths(widths: CaseColumnWidths) {
    if (!ready || !userId || !workspaceId) return;
    const write = widthWrites.current.then(() =>
      saveCaseColumnWidths(createClient(), userId, workspaceId, widths)
    );
    widthWrites.current = write.catch(() => {});
    const finish = (widthError: boolean) =>
      setState((previous) => (previous.key === key ? { ...previous, widthError } : previous));
    void write.then(
      () => finish(false),
      () => finish(true)
    );
  }

  return {
    value: current.value,
    widths: current.widths,
    widthError: current.widthError,
    ready,
    error: current.error,
    retry: () => setRetry((v) => v + 1),
    retryWidths: () => persistWidths(latestWidths.current.widths),
    resizeColumn: (id: string, width: number) => {
      const saved = latestWidths.current;
      if (!ready || saved.key !== key || saved.widths[id] === width) return;
      const widths = { ...saved.widths, [id]: width };
      latestWidths.current = { key, widths };
      setState((previous) => (previous.key === key ? { ...previous, widths } : previous));
      persistWidths(widths);
    },
    save: async (value: CaseViewPreferences) => {
      if (!userId || !workspaceId || !ready)
        throw new Error('Espera a que cargue la personalización de la vista.');
      const saved = await saveCaseView(createClient(), userId, workspaceId, value);
      setState((previous) => (previous.key === key ? { ...previous, value: saved } : previous));
    },
  };
}
