'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import dynamic from 'next/dynamic';
import { useParams, usePathname } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { useAppModules } from '@/contexts/AppModulesContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  isLuciaAvailable,
  resolveLuciaCapability,
  type LuciaModuleCapability,
} from '@/lib/ai/moduleCapabilities';

const LucIAChat = dynamic(() => import('@/components/LucIAChat'), { ssr: false });

type LuciaAssistantContextValue = {
  capability: LuciaModuleCapability;
  openAssistant: () => void;
  closeAssistant: () => void;
  isOpen: boolean;
  available: boolean;
};

const LuciaAssistantContext = createContext<LuciaAssistantContextValue | null>(null);
const subscribeToHydration = () => () => undefined;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function LuciaAssistantProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/';
  const params = useParams<Record<string, string | string[]>>();
  const { user } = useAuth();
  const { isModuleActive, loading: modulesLoading } = useAppModules();
  const mounted = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false
  );
  const [openRoute, setOpenRoute] = useState<string | null>(null);
  const capability = useMemo(() => resolveLuciaCapability(pathname), [pathname]);
  const moduleEnabled =
    capability.accessMode !== 'authenticated' || (!modulesLoading && isModuleActive('lucia'));
  const available =
    isLuciaAvailable(capability) &&
    moduleEnabled &&
    (capability.accessMode !== 'authenticated' || Boolean(user));
  const isOpen = openRoute === pathname;

  const openAssistant = useCallback(() => {
    if (available) setOpenRoute(pathname);
  }, [available, pathname]);
  const closeAssistant = useCallback(() => setOpenRoute(null), []);

  const publicToken =
    capability.accessMode === 'public_token'
      ? firstParam(params?.token) || firstParam(params?.publicToken)
      : undefined;

  const value = useMemo(
    () => ({ capability, openAssistant, closeAssistant, isOpen, available }),
    [capability, openAssistant, closeAssistant, isOpen, available]
  );

  return (
    <LuciaAssistantContext.Provider value={value}>
      {children}
      {mounted && available && capability.assistantPlacement === 'floating' && !isOpen && (
        <button
          type="button"
          onClick={openAssistant}
          className="fixed bottom-5 right-5 z-40 flex h-11 w-11 items-center justify-center rounded-lg border border-primary/20 bg-primary text-primary-foreground shadow-lg transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          aria-label="Abrir LucIA"
          title="Abrir LucIA"
        >
          <Sparkles className="h-5 w-5" />
        </button>
      )}
      {mounted && available && isOpen && capability.assistantPlacement !== 'none' && (
        <LucIAChat
          isOpen={isOpen}
          onClose={closeAssistant}
          mode={capability.accessMode === 'public_token' ? 'public-token' : 'authenticated'}
          publicToken={publicToken}
        />
      )}
    </LuciaAssistantContext.Provider>
  );
}

export function useLuciaAssistant() {
  const context = useContext(LuciaAssistantContext);
  if (!context) throw new Error('useLuciaAssistant must be used inside LuciaAssistantProvider');
  return context;
}
