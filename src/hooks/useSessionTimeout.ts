'use client';

import { useEffect, useRef, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';

// ─── Constants ────────────────────────────────────────────────────────────────
const INACTIVITY_TIMEOUT_MS = 20 * 60 * 1000;       // 20 minutes
const WARNING_BEFORE_MS = 2 * 60 * 1000;             // warn 2 min before → at 18 min
const DEBOUNCE_MS = 1_000;                            // 1 second debounce
const RETRY_INTERVAL_MS = 10_000;                    // retry every 10 s when signing
const BROADCAST_CHANNEL_NAME = 'docubox-session';

// ─── Activity events to track ─────────────────────────────────────────────────
const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  'mousemove',
  'keydown',
  'click',
  'scroll',
  'touchstart',
];

// ─── Types ────────────────────────────────────────────────────────────────────
export interface SessionTimeoutOptions {
  /** Called when the warning modal should be shown (2 min remaining) */
  onShowWarning: () => void;
  /** Called to hide the warning modal (user clicked "Continuar") */
  onHideWarning: () => void;
  /** Returns true if a signing operation is currently in progress */
  getIsSigningInProgress: () => boolean;
  /** Called right before sign-out so the parent can clean up state */
  onBeforeSignOut?: () => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useSessionTimeout(
  isAuthenticated: boolean,
  options: SessionTimeoutOptions
) {
  const { onShowWarning, onHideWarning, getIsSigningInProgress, onBeforeSignOut } = options;

  // Refs so callbacks always see the latest values without re-registering effects
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const warningShownRef = useRef(false);
  const signedOutRef = useRef(false);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const clearAllTimers = useCallback(() => {
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    inactivityTimerRef.current = null;
    warningTimerRef.current = null;
    retryTimerRef.current = null;
    debounceTimerRef.current = null;
  }, []);

  /** Log a session timeout event to auth_security_events via a lightweight fetch */
  const logSecurityEvent = useCallback(async (
    userId: string,
    eventType: 'session_timeout_inactivity' | 'session_timeout_absolute'
  ) => {
    try {
      // We use the public anon client; the row-level security allows service_role inserts.
      // For client-side logging we call a small internal API endpoint to avoid exposing
      // service-role key on the browser.
      await fetch('/api/security/log-session-timeout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          eventType,
          userAgent: navigator.userAgent,
          // ip_address is resolved server-side from x-forwarded-for
        }),
      });
    } catch {
      // non-blocking
    }
  }, []);

  /** Perform the actual sign-out: log event, broadcast, redirect */
  const executeSignOut = useCallback(async (reason: 'inactivity' | 'absolute') => {
    if (signedOutRef.current) return;
    signedOutRef.current = true;

    clearAllTimers();
    onHideWarning();
    onBeforeSignOut?.();

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (user?.id) {
      await logSecurityEvent(
        user.id,
        reason === 'inactivity' ? 'session_timeout_inactivity' : 'session_timeout_absolute'
      );
    }

    // Broadcast to other tabs
    try {
      channelRef.current?.postMessage({ type: 'SIGN_OUT', reason });
    } catch { /* ignore */ }

    await supabase.auth.signOut();
    window.location.href = '/login';
  }, [clearAllTimers, onHideWarning, onBeforeSignOut, logSecurityEvent]);

  /** Try to sign out; if signing is in progress, retry every 10 s */
  const trySignOut = useCallback((reason: 'inactivity' | 'absolute') => {
    if (getIsSigningInProgress()) {
      retryTimerRef.current = setTimeout(() => trySignOut(reason), RETRY_INTERVAL_MS);
      return;
    }
    executeSignOut(reason);
  }, [getIsSigningInProgress, executeSignOut]);

  /** (Re)start the inactivity countdown from zero */
  const resetTimers = useCallback(() => {
    if (!isAuthenticated || signedOutRef.current) return;

    clearAllTimers();
    warningShownRef.current = false;
    onHideWarning();

    // Show warning at 18 minutes
    warningTimerRef.current = setTimeout(() => {
      warningShownRef.current = true;
      onShowWarning();
    }, INACTIVITY_TIMEOUT_MS - WARNING_BEFORE_MS);

    // Sign out at 20 minutes
    inactivityTimerRef.current = setTimeout(() => {
      trySignOut('inactivity');
    }, INACTIVITY_TIMEOUT_MS);
  }, [isAuthenticated, clearAllTimers, onHideWarning, onShowWarning, trySignOut]);

  // ── Activity listener with debounce ────────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated) return;

    signedOutRef.current = false;
    resetTimers();

    const handleActivity = () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        resetTimers();
      }, DEBOUNCE_MS);
    };

    ACTIVITY_EVENTS.forEach((evt) =>
      window.addEventListener(evt, handleActivity, { passive: true })
    );

    return () => {
      ACTIVITY_EVENTS.forEach((evt) =>
        window.removeEventListener(evt, handleActivity)
      );
      clearAllTimers();
    };
  }, [isAuthenticated, resetTimers, clearAllTimers]);

  // ── BroadcastChannel: listen for sign-out from other tabs ─────────────────
  useEffect(() => {
    if (!isAuthenticated || typeof BroadcastChannel === 'undefined') return;

    const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    channelRef.current = channel;

    channel.onmessage = (event) => {
      if (event.data?.type === 'SIGN_OUT') {
        // Another tab signed out — follow suit without re-broadcasting
        if (signedOutRef.current) return;
        signedOutRef.current = true;
        clearAllTimers();
        onHideWarning();
        onBeforeSignOut?.();
        const supabase = createClient();
        supabase.auth.signOut().finally(() => {
          window.location.href = '/login';
        });
      }
    };

    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [isAuthenticated, clearAllTimers, onHideWarning, onBeforeSignOut]);

  // ── Public API ─────────────────────────────────────────────────────────────
  /** Call this when the user clicks "Continuar sesión" in the warning modal */
  const continueSession = useCallback(() => {
    resetTimers();
  }, [resetTimers]);

  /** Call this when the user clicks "Cerrar sesión ahora" in the warning modal */
  const signOutNow = useCallback(() => {
    trySignOut('inactivity');
  }, [trySignOut]);

  return { continueSession, signOutNow };
}
