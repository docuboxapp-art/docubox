'use client';

import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * useDocumentRealtime
 *
 * Subscribes to Supabase Realtime changes on:
 *  - `documentos`  (where owner_id = userId)
 *  - `participantes` (where user_id = userId)
 *
 * Calls `onRefresh` whenever any relevant row changes so the caller
 * can re-fetch its data without a full page reload.
 *
 * @param userId  - The authenticated user's UUID (pass null/undefined to skip)
 * @param onRefresh - Callback invoked on any relevant DB change
 * @param channelSuffix - Optional suffix to make the channel name unique per component
 */
export function useDocumentRealtime(
  userId: string | null | undefined,
  onRefresh: () => void,
  channelSuffix = 'default',
) {
  // Keep a stable ref so the subscription closure always calls the latest version
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    if (!userId) return;

    const supabase = createClient();
    const channelName = `doc-realtime-${userId}-${channelSuffix}`;

    const channel = supabase
      .channel(channelName)
      // Changes to documents owned by the user
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'documentos',
          filter: `owner_id=eq.${userId}`,
        },
        () => onRefreshRef.current(),
      )
      // Changes to participantes rows belonging to the user
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'participantes',
          filter: `user_id=eq.${userId}`,
        },
        () => onRefreshRef.current(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, channelSuffix]);
}
