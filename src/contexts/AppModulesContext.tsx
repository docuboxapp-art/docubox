'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export type ModuleId =
  | 'formularios'
  | 'plantillas'
  | 'firmado-prueba-vida'
  | 'expedientes'
  | 'notifica'
  | 'credit-titles'
  | 'bulk-signatures'
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
    id: 'lucia',
    name: 'LucIA',
    description:
      'Tu asistente legal inteligente para consultar documentos, apoyar la redacción y agilizar el análisis de información.',
    category: 'IA Generativa',
    href: '/documents-dashboard',
  },
];

interface AppModulesContextValue {
  activeModuleId: ModuleId | null;
  setActiveModule: (id: ModuleId | null) => void;
  isModuleActive: (id: ModuleId) => boolean;
  loading: boolean;
}

const AppModulesContext = createContext<AppModulesContextValue>({
  activeModuleId: null,
  setActiveModule: () => {},
  isModuleActive: () => false,
  loading: false,
});

export function AppModulesProvider({ children }: { children: React.ReactNode }) {
  const [activeModuleId, setActiveModuleId] = useState<ModuleId | null>(null);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const supabase = createClient();

  // Load preference from Supabase when user is available
  useEffect(() => {
    if (!user) {
      setActiveModuleId(null);
      setLoading(false);
      return;
    }

    const loadPreference = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('user_module_preferences')
          .select('active_module_id')
          .eq('user_id', user.id)
          .maybeSingle();

        if (error) {
          console.log('Error loading module preference:', error.message);
        } else if (data?.active_module_id) {
          setActiveModuleId(data.active_module_id as ModuleId);
        } else {
          setActiveModuleId(null);
        }
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    };

    loadPreference();
  }, [user?.id]);

  const setActiveModule = useCallback(
    async (id: ModuleId | null) => {
      // Optimistic update
      setActiveModuleId(id);

      if (!user) return;

      try {
        const { error } = await supabase
          .from('user_module_preferences')
          .upsert(
            { user_id: user.id, active_module_id: id, updated_at: new Date().toISOString() },
            { onConflict: 'user_id' }
          );

        if (error) {
          console.log('Error saving module preference:', error.message);
        }
      } catch {
        // silent
      }
    },
    [user?.id]
  );

  const isModuleActive = useCallback((id: ModuleId) => activeModuleId === id, [activeModuleId]);

  return (
    <AppModulesContext.Provider
      value={{ activeModuleId, setActiveModule, isModuleActive, loading }}
    >
      {children}
    </AppModulesContext.Provider>
  );
}

export function useAppModules() {
  return useContext(AppModulesContext);
}
