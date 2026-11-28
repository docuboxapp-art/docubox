'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { updateNotifications } from '@/lib/notifications/client';
import { subscribeToNotificationChanges } from '@/lib/notifications/realtime';
import { createClient } from '@/lib/supabase/client';
import { profilePrivacy } from './client';
import type { ContactRequestInbox } from './model';

const contactRequestEvents = ['contact.request.received', 'contact.request.approved'];
type ContactRequestNotice = { id: string; event_type: string; entity_id: string };

export function useContactRequests({
  enabled = true,
  watch = false,
  userId,
}: { enabled?: boolean; watch?: boolean; userId?: string } = {}) {
  const [data, setData] = useState<ContactRequestInbox | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [noticeState, setNoticeState] = useState<{
    userId: string;
    rows: ContactRequestNotice[];
  }>();
  const reading = useRef(new Set<string>());
  const notices = noticeState?.userId === userId ? noticeState?.rows : undefined;
  const reload = useCallback(() => setRevision((current) => current + 1), []);
  const shouldPoll =
    watch || Boolean(userId) || Boolean(data?.sent.some(({ status }) => status === 'pending'));

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    profilePrivacy<ContactRequestInbox>('requests_v2', {}, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setData(value);
        setError('');
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(
          cause instanceof Error ? cause.message : 'No se pudieron consultar las solicitudes.'
        );
      });
    return () => controller.abort();
  }, [enabled, revision]);

  useEffect(() => {
    if (!enabled || !userId) return;
    const controller = new AbortController();
    void (async () => {
      const { data: rows, error: loadError } = await createClient()
        .from('notifications')
        .select('id,event_type,entity_id')
        .eq('user_id', userId)
        .eq('status', 'unread')
        .in('event_type', contactRequestEvents)
        .abortSignal(controller.signal);
      if (!loadError && !controller.signal.aborted) setNoticeState({ userId, rows: rows ?? [] });
    })();
    return () => controller.abort();
  }, [enabled, userId, revision]);

  useEffect(() => {
    if (!enabled || !userId) return;
    return subscribeToNotificationChanges(createClient(), userId, {
      onChange: ({ new: notice }) => {
        if ('event_type' in notice && contactRequestEvents.includes(String(notice.event_type)))
          reload();
      },
      onSubscribed: reload,
    });
  }, [enabled, userId, reload]);

  useEffect(() => {
    if (!watch || !userId || !data || error || !notices?.length) return;
    const visible = new Set([
      ...data.received.map(({ id }) => id),
      ...data.sent.filter(({ status }) => status === 'approved').map(({ id }) => id),
    ]);
    const ids = notices
      .filter(({ id, entity_id }) => visible.has(entity_id) && !reading.current.has(id))
      .map(({ id }) => id);
    if (!ids.length) return;
    ids.forEach((id) => reading.current.add(id));
    void updateNotifications('read', ids)
      .then(({ updated }) => {
        const readIds = new Set(updated);
        setNoticeState((current) =>
          current?.userId === userId
            ? { userId, rows: current.rows.filter(({ id }) => !readIds.has(id)) }
            : current
        );
      })
      .catch(() => {
        /* The next refresh can retry without blocking the request list. */
      })
      .finally(() => ids.forEach((id) => reading.current.delete(id)));
  }, [watch, userId, data, error, notices]);

  useEffect(() => {
    if (!enabled) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') reload();
    };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    const timer = shouldPoll ? window.setInterval(refreshWhenVisible, 30_000) : undefined;
    return () => {
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.clearInterval(timer);
    };
  }, [enabled, reload, shouldPoll]);

  const acceptedUnread =
    notices?.filter(({ event_type }) => event_type === 'contact.request.approved').length ?? 0;
  return { data, error, reload, acceptedUnread };
}
