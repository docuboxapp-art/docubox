'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  DEFAULT_CONTACT_VIEW,
  loadContactView,
  saveContactColumnWidths,
  saveContactView,
  type ContactColumnId,
  type ContactColumnWidths,
  type ContactView,
} from '@/lib/contacts/view-preferences';

export function useContactView(userId?: string) {
  const [saved, setSaved] = useState<{
    userId: string;
    value?: ContactView;
    error?: boolean;
  } | null>(null);
  const [widths, setWidths] = useState<ContactColumnWidths>({});
  const [widthError, setWidthError] = useState(false);
  const latestWidths = useRef<ContactColumnWidths>({});
  const widthWrites = useRef(Promise.resolve());
  const [request, setRequest] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    loadContactView(createClient(), userId)
      .then((result) => {
        if (!live) return;
        setSaved({ userId, value: result.view });
        latestWidths.current = result.widths;
        setWidths(result.widths);
      })
      .catch(() => {
        if (live) setSaved({ userId, error: true });
      });
    return () => {
      live = false;
    };
  }, [userId, request]);

  const current = saved?.userId === userId ? saved : null;

  function persistWidths(updated: ContactColumnWidths) {
    if (!userId) return;
    const write = widthWrites.current.then(() =>
      saveContactColumnWidths(createClient(), userId, updated)
    );
    widthWrites.current = write.catch(() => {});
    void write.then(
      () => setWidthError(false),
      () => setWidthError(true)
    );
  }

  return {
    value: current?.value || DEFAULT_CONTACT_VIEW,
    ready: Boolean(current?.value),
    error: Boolean(current?.error),
    widths,
    widthError,
    resizeColumn(id: ContactColumnId, width: number) {
      if (!current?.value || latestWidths.current[id] === width) return;
      const updated = { ...latestWidths.current, [id]: width };
      latestWidths.current = updated;
      setWidths(updated);
      persistWidths(updated);
    },
    retryWidths: () => persistWidths(latestWidths.current),
    retry: () => setRequest((id) => id + 1),
    save: async (value: unknown) => {
      if (!current?.value || !userId) throw new Error('La personalización aún no está disponible.');
      const normalized = await saveContactView(createClient(), userId, value);
      setSaved({ userId, value: normalized });
    },
  };
}
