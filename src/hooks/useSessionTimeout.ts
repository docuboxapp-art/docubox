'use client';

import { useCallback, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

const WARNING_BEFORE_MS = 2 * 60 * 1000;
const ACTIVITY_DEBOUNCE_MS = 1_000;
const BROADCAST_CHANNEL_NAME = 'docubox-session';
const SIGN_OUT_FALLBACK_MS = 2_000;

const SESSION_BOOTSTRAP_PATHS = ['/login', '/auth/', '/register-device'];

// Deliberately excludes mousemove, scroll, polling and background work.
const HUMAN_ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  'pointerdown',
  'keydown',
  'touchstart',
  'popstate',
];

type SessionExpiryReason = 'inactivity' | 'absolute';

type SessionPolicy = {
  active: boolean;
  reason: string | null;
  inactivity_timeout_seconds: number;
  last_user_activity_at: string | null;
  inactivity_expires_at: string | null;
  absolute_expires_at: string | null;
};

type SessionPolicyError = {
  code?: string;
  message?: string;
  status?: number;
};

const INVALID_SESSION_ERROR_CODES = new Set(['refresh_token_not_found', 'bad_jwt', 'PGRST301']);

function isExplicitlyInvalidSession(error: SessionPolicyError) {
  if (error.code && INVALID_SESSION_ERROR_CODES.has(error.code)) return true;

  const message = error.message?.toLowerCase() || '';
  return (
    error.status === 401 ||
    message.includes('invalid refresh token') ||
    message.includes('refresh token not found') ||
    message.includes('jwt expired') ||
    message.includes('invalid jwt')
  );
}

export interface SessionTimeoutOptions {
  onShowWarning: () => void;
  onHideWarning: () => void;
  onBeforeSignOut?: () => void;
}

function parsePolicy(value: unknown): SessionPolicy | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== 'object') return null;

  const policy = row as Partial<SessionPolicy>;
  if (typeof policy.active !== 'boolean') return null;

  return {
    active: policy.active,
    reason: typeof policy.reason === 'string' ? policy.reason : null,
    inactivity_timeout_seconds:
      typeof policy.inactivity_timeout_seconds === 'number'
        ? policy.inactivity_timeout_seconds
        : 0,
    last_user_activity_at:
      typeof policy.last_user_activity_at === 'string'
        ? policy.last_user_activity_at
        : null,
    inactivity_expires_at:
      typeof policy.inactivity_expires_at === 'string'
        ? policy.inactivity_expires_at
        : null,
    absolute_expires_at:
      typeof policy.absolute_expires_at === 'string'
        ? policy.absolute_expires_at
        : null,
  };
}

export function useSessionTimeout(
  isAuthenticated: boolean,
  options: SessionTimeoutOptions
) {
  const pathname = usePathname();
  const isSessionBootstrapPath = SESSION_BOOTSTRAP_PATHS.some((path) =>
    path.endsWith('/') ? pathname.startsWith(path) : pathname === path || pathname.startsWith(`${path}/`)
  );
  const sessionPolicyEnabled = isAuthenticated && !isSessionBootstrapPath;
  const { onShowWarning, onHideWarning, onBeforeSignOut } = options;
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activityDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const signedOutRef = useRef(false);
  const previousPathnameRef = useRef<string | null>(null);

  const clearTimers = useCallback(() => {
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    if (activityDebounceRef.current) clearTimeout(activityDebounceRef.current);
    inactivityTimerRef.current = null;
    warningTimerRef.current = null;
    activityDebounceRef.current = null;
  }, []);

  const executeSignOut = useCallback(async (reason: SessionExpiryReason) => {
    if (signedOutRef.current) return;
    signedOutRef.current = true;
    clearTimers();
    onHideWarning();
    onBeforeSignOut?.();

    try {
      channelRef.current?.postMessage({ type: 'SIGN_OUT', reason });
    } catch {
      // A closed BroadcastChannel must not prevent local sign-out.
    }

    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    try {
      const signOut = createClient().auth.signOut({ scope: 'local' });
      const fallback = new Promise<void>((resolve) => {
        fallbackTimer = setTimeout(resolve, SIGN_OUT_FALLBACK_MS);
      });
      await Promise.race([signOut.then(() => undefined).catch(() => undefined), fallback]);
    } finally {
      if (fallbackTimer) clearTimeout(fallbackTimer);
      window.location.assign('/login?reason=session-expired');
    }
  }, [clearTimers, onBeforeSignOut, onHideWarning]);

  const scheduleTimers = useCallback((policy: SessionPolicy) => {
    const inactivityExpiry = Date.parse(policy.inactivity_expires_at || '');
    const absoluteExpiry = Date.parse(policy.absolute_expires_at || '');
    const now = Date.now();

    if (!Number.isFinite(inactivityExpiry) || !Number.isFinite(absoluteExpiry)) return;

    clearTimers();
    onHideWarning();

    const expiresAt = Math.min(inactivityExpiry, absoluteExpiry);
    const reason: SessionExpiryReason = absoluteExpiry <= inactivityExpiry ? 'absolute' : 'inactivity';
    const remainingMs = expiresAt - now;

    if (remainingMs <= 0) {
      void executeSignOut(reason);
      return;
    }

    const warningDelay = Math.max(0, remainingMs - WARNING_BEFORE_MS);
    warningTimerRef.current = setTimeout(onShowWarning, warningDelay);
    inactivityTimerRef.current = setTimeout(() => {
      void executeSignOut(reason);
    }, remainingMs);
  }, [clearTimers, executeSignOut, onHideWarning, onShowWarning]);

  const synchronizePolicy = useCallback(async (recordUserActivity: boolean) => {
    if (!sessionPolicyEnabled || signedOutRef.current) return;

    const { data, error } = await createClient().rpc('enforce_docubox_session_policy', {
      p_record_user_activity: recordUserActivity,
    });

    if (error) {
      if (isExplicitlyInvalidSession(error)) {
        await executeSignOut('inactivity');
        return false;
      }

      // A transient outage or a server-side policy issue is not proof that the
      // browser session is invalid. Preserve the existing deadline and retry on
      // the next explicit interaction instead of unexpectedly signing the user out.
      console.warn('[session-policy] Client validation unavailable; preserving local session.', {
        code: error.code,
        message: error.message,
      });
      return false;
    }

    const policy = parsePolicy(data);
    if (!policy) {
      console.warn('[session-policy] Client policy response was invalid; preserving local session.');
      return false;
    }

    if (!policy.active) {
      await executeSignOut(policy.reason === 'ABSOLUTE_TIMEOUT' ? 'absolute' : 'inactivity');
      return false;
    }

    scheduleTimers(policy);
    return true;
  }, [executeSignOut, scheduleTimers, sessionPolicyEnabled]);

  const recordHumanActivity = useCallback(() => {
    if (!sessionPolicyEnabled || signedOutRef.current) return;
    if (activityDebounceRef.current) clearTimeout(activityDebounceRef.current);
    activityDebounceRef.current = setTimeout(() => {
      void synchronizePolicy(true);
    }, ACTIVITY_DEBOUNCE_MS);
  }, [sessionPolicyEnabled, synchronizePolicy]);

  useEffect(() => {
    if (!sessionPolicyEnabled) {
      clearTimers();
      previousPathnameRef.current = null;
      return;
    }

    signedOutRef.current = false;
    void synchronizePolicy(false);

    const handleActivity = () => recordHumanActivity();
    HUMAN_ACTIVITY_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, handleActivity, { passive: true });
    });

    return () => {
      HUMAN_ACTIVITY_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, handleActivity);
      });
      clearTimers();
    };
  }, [clearTimers, recordHumanActivity, sessionPolicyEnabled, synchronizePolicy]);

  useEffect(() => {
    if (!sessionPolicyEnabled) return;
    if (previousPathnameRef.current === null) {
      previousPathnameRef.current = pathname;
      return;
    }
    if (previousPathnameRef.current !== pathname) {
      previousPathnameRef.current = pathname;
      recordHumanActivity();
    }
  }, [pathname, recordHumanActivity, sessionPolicyEnabled]);

  useEffect(() => {
    if (!sessionPolicyEnabled || typeof BroadcastChannel === 'undefined') return;

    const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    channelRef.current = channel;
    channel.onmessage = (event) => {
      if (event.data?.type !== 'SIGN_OUT' || signedOutRef.current) return;
      signedOutRef.current = true;
      clearTimers();
      onHideWarning();
      onBeforeSignOut?.();
      createClient().auth.signOut({ scope: 'local' }).finally(() => window.location.assign('/login?reason=session-expired'));
    };

    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [clearTimers, onBeforeSignOut, onHideWarning, sessionPolicyEnabled]);

  const continueSession = useCallback(async () => {
    return synchronizePolicy(true);
  }, [synchronizePolicy]);

  const signOutNow = useCallback(async () => {
    await executeSignOut('inactivity');
  }, [executeSignOut]);

  return { continueSession, signOutNow };
}
