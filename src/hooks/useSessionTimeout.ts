'use client';

import { useCallback, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { redirectExpiredAccountSession } from '@/lib/security/session-expiry-navigation';

const WARNING_BEFORE_MS = 2 * 60 * 1000;
const ACTIVITY_DEBOUNCE_MS = 1_000;
const ACTIVITY_SYNC_MIN_INTERVAL_MS = 30_000;
const POLICY_RETRY_DELAYS_MS = [15_000, 30_000, 60_000] as const;
const BROADCAST_CHANNEL_NAME = 'docubox-session';
const SIGN_OUT_FALLBACK_MS = 2_000;

const SESSION_BOOTSTRAP_PATHS = [
  '/login',
  '/auth/',
  '/register-device',
  '/formulario-publico/',
  '/validar-formulario/',
];

// Deliberately excludes mousemove, scroll, polling and background work.
const HUMAN_ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'popstate'] as const;

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
  if (typeof error.status === 'number' && error.status >= 500) return false;
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
  warningVisible?: boolean;
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
      typeof policy.inactivity_timeout_seconds === 'number' ? policy.inactivity_timeout_seconds : 0,
    last_user_activity_at:
      typeof policy.last_user_activity_at === 'string' ? policy.last_user_activity_at : null,
    inactivity_expires_at:
      typeof policy.inactivity_expires_at === 'string' ? policy.inactivity_expires_at : null,
    absolute_expires_at:
      typeof policy.absolute_expires_at === 'string' ? policy.absolute_expires_at : null,
  };
}

export function useSessionTimeout(isAuthenticated: boolean, options: SessionTimeoutOptions) {
  const pathname = usePathname();
  const isSessionBootstrapPath = SESSION_BOOTSTRAP_PATHS.some((path) =>
    path.endsWith('/')
      ? pathname.startsWith(path)
      : pathname === path || pathname.startsWith(`${path}/`)
  );
  const sessionPolicyEnabled = isAuthenticated && !isSessionBootstrapPath;
  const { onShowWarning, onHideWarning, onBeforeSignOut, warningVisible } = options;
  const warningVisibleRef = useRef(false);
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activityDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const policyRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const policyRetryAttemptRef = useRef(0);
  const activitySyncInFlightRef = useRef(false);
  const lastActivitySyncAttemptRef = useRef(0);
  const verifyExpiryRef = useRef<() => void>(() => undefined);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const signedOutRef = useRef(false);
  const previousPathnameRef = useRef<string | null>(null);

  useEffect(() => {
    warningVisibleRef.current = !!warningVisible;
    if (warningVisible && activityDebounceRef.current) {
      clearTimeout(activityDebounceRef.current);
      activityDebounceRef.current = null;
    }
  }, [warningVisible]);

  const clearTimers = useCallback(() => {
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    if (activityDebounceRef.current) clearTimeout(activityDebounceRef.current);
    if (policyRetryTimerRef.current) clearTimeout(policyRetryTimerRef.current);
    inactivityTimerRef.current = null;
    warningTimerRef.current = null;
    activityDebounceRef.current = null;
    policyRetryTimerRef.current = null;
  }, []);

  const executeSignOut = useCallback(
    async (reason: SessionExpiryReason) => {
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
        redirectExpiredAccountSession(window.location);
      }
    },
    [clearTimers, onBeforeSignOut, onHideWarning]
  );

  const scheduleTimers = useCallback(
    (policy: SessionPolicy) => {
      const inactivityExpiry = Date.parse(policy.inactivity_expires_at || '');
      const absoluteExpiry = Date.parse(policy.absolute_expires_at || '');
      const now = Date.now();

      if (!Number.isFinite(inactivityExpiry) || !Number.isFinite(absoluteExpiry)) return;

      clearTimers();
      if (!warningVisibleRef.current) onHideWarning();

      const expiresAt = Math.min(inactivityExpiry, absoluteExpiry);
      const remainingMs = expiresAt - now;

      if (remainingMs <= 0) {
        // Local clock or another tab can be ahead of the server's activity row.
        // Confirm expiry with the mandatory server policy before clearing cookies.
        inactivityTimerRef.current = setTimeout(() => verifyExpiryRef.current(), 30_000);
        return;
      }

      const warningDelay = Math.max(0, remainingMs - WARNING_BEFORE_MS);
      warningTimerRef.current = setTimeout(onShowWarning, warningDelay);
      inactivityTimerRef.current = setTimeout(() => {
        verifyExpiryRef.current();
      }, remainingMs);
    },
    [clearTimers, onHideWarning, onShowWarning]
  );

  const schedulePolicyRetry = useCallback(() => {
    if (policyRetryTimerRef.current || !sessionPolicyEnabled || signedOutRef.current) return;
    const delay =
      POLICY_RETRY_DELAYS_MS[
        Math.min(policyRetryAttemptRef.current, POLICY_RETRY_DELAYS_MS.length - 1)
      ];
    policyRetryAttemptRef.current += 1;
    policyRetryTimerRef.current = setTimeout(() => {
      policyRetryTimerRef.current = null;
      verifyExpiryRef.current();
    }, delay);
  }, [sessionPolicyEnabled]);

  const synchronizePolicy = useCallback(
    async (recordUserActivity: boolean) => {
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
        });
        schedulePolicyRetry();
        return false;
      }

      const policy = parsePolicy(data);
      if (!policy) {
        console.warn(
          '[session-policy] Client policy response was invalid; preserving local session.'
        );
        schedulePolicyRetry();
        return false;
      }

      if (!policy.active) {
        if (policy.reason === 'POLICY_BUSY') {
          // A concurrent session update is not evidence that the session expired.
          schedulePolicyRetry();
          return false;
        }
        if (
          policy.reason !== 'ABSOLUTE_TIMEOUT' &&
          policy.reason !== 'INACTIVITY_TIMEOUT' &&
          policy.reason !== 'UNAUTHENTICATED' &&
          policy.reason !== 'INVALID_SESSION' &&
          policy.reason !== 'SESSION_NOT_FOUND'
        ) {
          schedulePolicyRetry();
          return false;
        }
        await executeSignOut(policy.reason === 'ABSOLUTE_TIMEOUT' ? 'absolute' : 'inactivity');
        return false;
      }

      policyRetryAttemptRef.current = 0;
      scheduleTimers(policy);
      return true;
    },
    [executeSignOut, schedulePolicyRetry, scheduleTimers, sessionPolicyEnabled]
  );

  useEffect(() => {
    verifyExpiryRef.current = () => {
      void synchronizePolicy(false);
    };
    return () => {
      verifyExpiryRef.current = () => undefined;
    };
  }, [synchronizePolicy]);

  const recordHumanActivity = useCallback(() => {
    // Interacting with the warning (including its preference form) must not
    // dismiss it before the user explicitly continues, saves, or signs out.
    if (!sessionPolicyEnabled || signedOutRef.current || warningVisibleRef.current) return;
    if (
      activitySyncInFlightRef.current ||
      Date.now() - lastActivitySyncAttemptRef.current < ACTIVITY_SYNC_MIN_INTERVAL_MS
    )
      return;
    if (activityDebounceRef.current) clearTimeout(activityDebounceRef.current);
    activityDebounceRef.current = setTimeout(() => {
      if (
        activitySyncInFlightRef.current ||
        Date.now() - lastActivitySyncAttemptRef.current < ACTIVITY_SYNC_MIN_INTERVAL_MS
      )
        return;
      lastActivitySyncAttemptRef.current = Date.now();
      activitySyncInFlightRef.current = true;
      void synchronizePolicy(true).finally(() => {
        activitySyncInFlightRef.current = false;
      });
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
      createClient()
        .auth.signOut({ scope: 'local' })
        .finally(() => redirectExpiredAccountSession(window.location));
    };

    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [clearTimers, onBeforeSignOut, onHideWarning, sessionPolicyEnabled]);

  const continueSession = useCallback(async () => {
    const continued = await synchronizePolicy(true);
    if (continued) onHideWarning();
    return continued;
  }, [onHideWarning, synchronizePolicy]);

  const signOutNow = useCallback(async () => {
    await executeSignOut('inactivity');
  }, [executeSignOut]);

  return { continueSession, signOutNow };
}
