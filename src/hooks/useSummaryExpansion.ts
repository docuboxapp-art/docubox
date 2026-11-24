'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';
import { useAuth } from '@/contexts/AuthContext';

const summaryChanged = 'docubox:summary-expansion-changed';

export function useSummaryExpansion(panelId: string, initiallyExpanded = false) {
  const { user } = useAuth();
  const key = user?.id ? `docubox:summary-expansion:v1:${user.id}:${panelId}` : null;
  const [temporary, setTemporary] = useState<{ key: string | null; expanded: boolean } | null>(
    null
  );

  const read = useCallback(() => {
    if (temporary && temporary.key === key) return temporary.expanded;
    if (key) {
      try {
        const stored = window.localStorage.getItem(key);
        if (stored === 'true' || stored === 'false') return stored === 'true';
      } catch {
        // Some browser contexts disable local storage.
      }
    }
    return initiallyExpanded;
  }, [key, initiallyExpanded, temporary]);

  const subscribe = useCallback(
    (listener: () => void) => {
      if (!key) return () => {};
      const onStorage = (event: StorageEvent) => {
        if (event.key === key || event.key === null) listener();
      };
      window.addEventListener('storage', onStorage);
      window.addEventListener(summaryChanged, listener);
      return () => {
        window.removeEventListener('storage', onStorage);
        window.removeEventListener(summaryChanged, listener);
      };
    },
    [key]
  );
  const expanded = useSyncExternalStore(subscribe, read, () => initiallyExpanded);

  function toggle() {
    const next = !read();
    if (key) {
      try {
        window.localStorage.setItem(key, String(next));
        setTemporary(null);
        window.dispatchEvent(new Event(summaryChanged));
        return;
      } catch {
        // Keep the current panel interactive even without local storage.
      }
    }
    setTemporary({ key, expanded: next });
  }

  return [expanded, toggle] as const;
}
