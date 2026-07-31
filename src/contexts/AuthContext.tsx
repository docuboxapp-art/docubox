'use client';

import { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { createClient } from '../lib/supabase/client';
import { useSessionTimeout } from '../hooks/useSessionTimeout';

const AuthContext = createContext<any>({});

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

// ─── Session Timeout Warning Modal ───────────────────────────────────────────
function SessionTimeoutModal({
  visible,
  onContinue,
  onSignOut,
}: {
  visible: boolean;
  onContinue: () => void;
  onSignOut: () => void;
}) {
  const [remaining, setRemaining] = useState(120); // 2 minutes in seconds

  useEffect(() => {
    if (!visible) {
      setRemaining(120);
      return;
    }
    setRemaining(120);
    const interval = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [visible]);

  if (!visible) return null;

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-timeout-title"
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 flex flex-col gap-4">
        {/* Icon */}
        <div className="flex items-center justify-center w-14 h-14 rounded-full bg-amber-100 mx-auto">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="w-7 h-7 text-amber-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
            />
          </svg>
        </div>

        {/* Title */}
        <div className="text-center">
          <h2
            id="session-timeout-title"
            className="text-lg font-700 text-foreground"
          >
            ¿Sigues ahí?
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Tu sesión cerrará por inactividad en
          </p>
          <p className="text-3xl font-700 text-amber-500 mt-1 tabular-nums">
            {mins}:{secs.toString().padStart(2, '0')}
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 mt-2">
          <button
            onClick={onContinue}
            className="w-full py-2.5 rounded-xl bg-primary text-white text-sm font-600 hover:bg-primary/90 transition-colors"
          >
            Continuar sesión
          </button>
          <button
            onClick={onSignOut}
            className="w-full py-2.5 rounded-xl border border-border text-sm font-500 text-muted-foreground hover:bg-muted/50 transition-colors"
          >
            Cerrar sesión ahora
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Provider ─────────────────────────────────────────────────────────────────
export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<any>(null);
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [emailVerified, setEmailVerified] = useState<boolean | null>(null);

  // Session timeout modal state
  const [showTimeoutWarning, setShowTimeoutWarning] = useState(false);

  // Global flag: is a document signing operation in progress?
  // This is set/cleared by firmar-documento/[id]/page.tsx via context
  const isSigningInProgressRef = useRef(false);
  const [isSigningInProgress, setIsSigningInProgress] = useState(false);

  const supabase = createClient();

  const fetchEmailVerified = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('email_verified')
        .eq('id', userId)
        .single();
      if (error) {
        setEmailVerified(false);
        return;
      }
      setEmailVerified(data?.email_verified === true);
    } catch {
      setEmailVerified(false);
    }
  };

  // ── Set session start cookie on successful login ──────────────────────────
  const setSessionStartCookie = useCallback(() => {
    // We call a lightweight API endpoint that sets the httpOnly cookie server-side
    fetch('/api/auth/set-session-start', { method: 'POST' }).catch(() => {/* non-blocking */});
  }, []);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user?.id) {
        fetchEmailVerified(session.user.id);
      } else {
        setEmailVerified(null);
      }
      setLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user?.id) {
        fetchEmailVerified(session.user.id);
        // Set the session start cookie on every new sign-in
        if (_event === 'SIGNED_IN') {
          setSessionStartCookie();
        }
      } else {
        setEmailVerified(null);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // ── useSessionTimeout integration ─────────────────────────────────────────
  const getIsSigningInProgress = useCallback(() => isSigningInProgressRef.current, []);

  const { continueSession, signOutNow } = useSessionTimeout(!!user, {
    onShowWarning: () => setShowTimeoutWarning(true),
    onHideWarning: () => setShowTimeoutWarning(false),
    getIsSigningInProgress,
    onBeforeSignOut: () => {
      setShowTimeoutWarning(false);
    },
  });

  // ── Signing progress setter (called by firmar-documento page) ─────────────
  const setSigningInProgress = useCallback((value: boolean) => {
    isSigningInProgressRef.current = value;
    setIsSigningInProgress(value);
  }, []);

  // ── Auth methods ──────────────────────────────────────────────────────────

  const refreshEmailVerified = async () => {
    if (user?.id) {
      await fetchEmailVerified(user.id);
    }
  };

  const signUp = async (email: string, password: string, metadata = {}) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: (metadata as any)?.fullName || '',
          avatar_url: (metadata as any)?.avatarUrl || ''
        },
        emailRedirectTo: `${window.location.origin}/auth/callback`
      }
    });
    if (error) throw error;
    return data;
  };

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    if (error) throw error;
    return data;
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    window.location.href = '/sign-up-login-screen';
  };

  const getCurrentUser = async () => {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) throw error;
    return user;
  };

  const isEmailVerified = () => {
    return emailVerified === true;
  };

  const getUserProfile = async () => {
    if (!user) return null;
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', user.id)
      .single();
    if (error) throw error;
    return data;
  };

  const value = {
    user,
    session,
    loading,
    emailVerified,
    refreshEmailVerified,
    signUp,
    signIn,
    signOut,
    getCurrentUser,
    isEmailVerified,
    getUserProfile,
    // Signing progress — exposed so firmar-documento can set it
    isSigningInProgress,
    setSigningInProgress,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
      <SessionTimeoutModal
        visible={showTimeoutWarning}
        onContinue={continueSession}
        onSignOut={signOutNow}
      />
    </AuthContext.Provider>
  );
};
