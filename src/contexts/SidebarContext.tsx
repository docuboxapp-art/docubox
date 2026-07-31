'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';

interface SidebarContextValue {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

const SidebarContext = createContext<SidebarContextValue>({
  sidebarOpen: false,
  setSidebarOpen: () => {},
  sidebarCollapsed: false,
  setSidebarCollapsed: () => {},
});

const STORAGE_KEY = 'docubox-nav-mode';
const COLLAPSED_KEY = 'docubox-sidebar-collapsed';

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpenState] = useState<boolean>(false);
  const [sidebarCollapsed, setSidebarCollapsedState] = useState<boolean>(false);
  const supabaseRef = useRef(createClient());
  const supabaseLoaded = useRef(false);

  // On mount: restore from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      setSidebarOpenState(stored === 'sidebar');
    }

    const storedCollapsed = localStorage.getItem(COLLAPSED_KEY);
    if (storedCollapsed !== null) {
      setSidebarCollapsedState(storedCollapsed === 'true');
    }

    if (supabaseLoaded.current) return;
    supabaseLoaded.current = true;

    let cancelled = false;
    async function loadPreference() {
      const { data: { user } } = await supabaseRef.current.auth.getUser();
      if (!user || cancelled) return;
      const { data } = await supabaseRef.current
        .from('user_profiles')
        .select('nav_mode')
        .eq('id', user.id)
        .single();
      if (!cancelled && data?.nav_mode) {
        const isOpen = data.nav_mode === 'sidebar';
        setSidebarOpenState(isOpen);
        localStorage.setItem(STORAGE_KEY, data.nav_mode);
      }
    }
    loadPreference();
    return () => { cancelled = true; };
  }, []);

  const setSidebarOpen = useCallback(async (open: boolean) => {
    setSidebarOpenState(open);
    const mode = open ? 'sidebar' : 'topbar';
    localStorage.setItem(STORAGE_KEY, mode);
    const { data: { user } } = await supabaseRef.current.auth.getUser();
    if (!user) return;
    await supabaseRef.current
      .from('user_profiles')
      .update({ nav_mode: mode })
      .eq('id', user.id);
  }, []);

  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    setSidebarCollapsedState(collapsed);
    localStorage.setItem(COLLAPSED_KEY, String(collapsed));
  }, []);

  return (
    <SidebarContext.Provider value={{ sidebarOpen, setSidebarOpen, sidebarCollapsed, setSidebarCollapsed }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  return useContext(SidebarContext);
}
