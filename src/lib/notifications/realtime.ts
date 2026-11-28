import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
  SupabaseClient,
} from '@supabase/supabase-js';

type NotificationChange = RealtimePostgresChangesPayload<Record<string, unknown>>;
type Observer = {
  onChange: (change: NotificationChange) => void;
  onSubscribed?: () => void;
};
type Subscription = {
  channel: RealtimeChannel;
  observers: Set<Observer>;
  subscribed: boolean;
};

// A browser client can mount several views for the same user. Share only the
// transport. Each view still reads its own data through the authenticated client.
const subscriptions = new WeakMap<SupabaseClient, Map<string, Subscription>>();
let nextChannel = 0;

export function subscribeToNotificationChanges(
  client: SupabaseClient,
  userId: string,
  observer: Observer
) {
  let byUser = subscriptions.get(client);
  if (!byUser) {
    byUser = new Map();
    subscriptions.set(client, byUser);
  }

  let subscription = byUser.get(userId);
  if (subscription) {
    const current = subscription;
    current.observers.add(observer);
    if (current.subscribed && observer.onSubscribed) {
      queueMicrotask(() => {
        if (current.subscribed && current.observers.has(observer)) observer.onSubscribed?.();
      });
    }
  } else {
    // A replacement must not reuse a topic while the SDK is still leaving it.
    const channel = client.channel(`notification-changes-${++nextChannel}`);
    const current = { channel, observers: new Set([observer]), subscribed: false };
    subscription = current;
    byUser.set(userId, current);
    channel
      .on<NotificationChange['new']>(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (change) => {
          for (const item of current.observers) item.onChange(change);
        }
      )
      .subscribe((status) => {
        current.subscribed = status === 'SUBSCRIBED';
        if (current.subscribed) {
          for (const item of current.observers) item.onSubscribed?.();
        }
      });
  }

  const current = subscription;
  return () => {
    if (!current.observers.delete(observer) || current.observers.size) return;
    byUser.delete(userId);
    void client.removeChannel(current.channel);
  };
}

export function createNotificationRefresh(
  read: (signal: AbortSignal, lifetime: AbortSignal) => Promise<void>
) {
  const controller = new AbortController();
  let running = false;
  let pending = false;

  async function drain() {
    do {
      pending = false;
      const request = new AbortController();
      const abortRequest = () => request.abort();
      const timer = setTimeout(abortRequest, 30_000);
      controller.signal.addEventListener('abort', abortRequest, { once: true });
      try {
        await read(request.signal, controller.signal);
      } catch {
        // Consumers handle their own read errors. A failed read must not strand
        // a later invalidation or prevent the next refresh.
      } finally {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', abortRequest);
      }
    } while (pending && !controller.signal.aborted);
    running = false;
  }

  return {
    request() {
      if (controller.signal.aborted) return;
      if (running) {
        pending = true;
        return;
      }
      running = true;
      void drain();
    },
    dispose() {
      controller.abort();
    },
  };
}
