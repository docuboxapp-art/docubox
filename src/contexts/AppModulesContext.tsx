'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { FREE_PLAN_MODULE_LIMIT, toggleFreePlanModule } from '@/lib/app-market/module-selection';

export { FREE_PLAN_MODULE_LIMIT } from '@/lib/app-market/module-selection';

export type ModuleId =
  | 'formularios'
  | 'plantillas'
  | 'firmado-prueba-vida'
  | 'expedientes'
  | 'notifica'
  | 'credit-titles'
  | 'bulk-signatures'
  | 'certifica'
  | 'lucia';

export interface AppModule {
  id: ModuleId;
  name: string;
  description: string;
  category: string;
  href: string;
}

export const ALL_MODULES: AppModule[] = [
  {
    id: 'formularios',
    name: 'Formularios',
    description:
      'Crea formularios dinámicos para recopilar información y generar documentos automáticamente a partir de las respuestas.',
    category: 'Herramienta popular',
    href: '/formularios',
  },
  {
    id: 'plantillas',
    name: 'Plantillas',
    description:
      'Accede a una biblioteca de documentos y guarda tus propios modelos para agilizar contratos y acuerdos recurrentes.',
    category: 'Herramienta popular',
    href: '/plantillas',
  },
  {
    id: 'firmado-prueba-vida',
    name: 'Firmado con prueba de vida',
    description:
      'Añade una capa adicional de seguridad con verificación biométrica facial al momento de firmar.',
    category: 'Herramienta popular',
    href: '/configuracion/verificacion-identidad',
  },
  {
    id: 'expedientes',
    name: 'Expedientes',
    description:
      'Organiza documentos, formularios, identidad, hitos y firmas dentro de expedientes digitales verificables.',
    category: 'Herramienta popular',
    href: '/expedientes',
  },
  {
    id: 'notifica',
    name: 'Docubox Notifica',
    description:
      'Pon documentos a disposicion mediante enlaces seguros y conserva acuses, respuestas y evidencia verificable de cada comunicacion.',
    category: 'Gestion documental',
    href: '/notificaciones',
  },
  {
    id: 'credit-titles',
    name: 'Titulos de Credito',
    description:
      'Crea, emite, custodia y verifica pagares electronicos como registros digitales unicos con firma y evidencia trazable.',
    category: 'Legal y financiero',
    href: '/credit-titles',
  },
  {
    id: 'bulk-signatures',
    name: 'Firmas Masivas',
    description:
      'Genera, envia y supervisa cientos de documentos con firma y evidencia individual desde una sola campana.',
    category: 'Productividad',
    href: '/firmas-masivas',
  },
  {
    id: 'certifica',
    name: 'Docubox Certifica',
    description:
      'Certifica integridad, existencia, conservacion y evidencia sin alterar el documento original.',
    category: 'Seguridad y cumplimiento',
    href: '/certificaciones',
  },
  {
    id: 'lucia',
    name: 'LucIA',
    description:
      'Tu asistente legal inteligente para consultar documentos, apoyar la redacción y agilizar el análisis de información.',
    category: 'IA Generativa',
    href: '/inicio',
  },
];

interface AppModulesContextValue {
  activeModuleId: ModuleId | null;
  activeModuleIds: ModuleId[];
  setActiveModule: (id: ModuleId | null) => Promise<boolean>;
  isModuleActive: (id: ModuleId) => boolean;
  loading: boolean;
}

const AppModulesContext = createContext<AppModulesContextValue>({
  activeModuleId: null,
  activeModuleIds: [],
  setActiveModule: async () => false,
  isModuleActive: () => false,
  loading: false,
});

export function AppModulesProvider({ children }: { children: React.ReactNode }) {
  const [activeModuleIds, setActiveModuleIds] = useState<ModuleId[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const supabase = useMemo(() => createClient(), []);

  // Load preference from Supabase when user is available
  useEffect(() => {
    const loadPreference = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('user_module_preferences')
          .select('active_module_id,active_module_ids')
          .eq('user_id', userId)
          .maybeSingle();

        if (error) {
          console.warn('Error loading module preference:', error.message);
        } else {
          const storedIds = Array.isArray(data?.active_module_ids)
            ? data.active_module_ids.filter((id): id is ModuleId =>
                ALL_MODULES.some((module) => module.id === id)
              )
            : [];
          const legacyId = ALL_MODULES.some((module) => module.id === data?.active_module_id)
            ? (data?.active_module_id as ModuleId)
            : null;
          setActiveModuleIds(
            storedIds.length > 0
              ? storedIds.slice(0, FREE_PLAN_MODULE_LIMIT)
              : legacyId
                ? [legacyId]
                : []
          );
        }
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    };

    const timer = window.setTimeout(() => {
      if (!userId) {
        setActiveModuleIds([]);
        setLoading(false);
        return;
      }
      void loadPreference();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [supabase, userId]);

  const setActiveModule = useCallback(
    async (id: ModuleId | null) => {
      const previousIds = activeModuleIds;
      const selection = toggleFreePlanModule(previousIds, id);
      if (!selection.accepted) return false;
      const nextIds = selection.nextIds;

      setActiveModuleIds(nextIds);

      if (!userId) return true;

      try {
        const { error } = await supabase.from('user_module_preferences').upsert(
          {
            user_id: userId,
            active_module_id: nextIds[0] || null,
            active_module_ids: nextIds,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );

        if (error) {
          console.warn('Error saving module preference:', error.message);
          setActiveModuleIds(previousIds);
          return false;
        }
      } catch {
        setActiveModuleIds(previousIds);
        return false;
      }
      return true;
    },
    [activeModuleIds, supabase, userId]
  );

  const activeModuleId = activeModuleIds[0] || null;
  const isModuleActive = useCallback(
    (id: ModuleId) => activeModuleIds.includes(id),
    [activeModuleIds]
  );

  return (
    <AppModulesContext.Provider
      value={{ activeModuleId, activeModuleIds, setActiveModule, isModuleActive, loading }}
    >
      {children}
    </AppModulesContext.Provider>
  );
}

export function useAppModules() {
  return useContext(AppModulesContext);
}
