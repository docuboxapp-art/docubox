'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export type ModuleId = 'formularios' | 'plantillas' | 'firmado-prueba-vida' | 'expedientes' | 'lucia';

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
    description: 'Crea formularios dinámicos para recolectar información de clientes o empleados y generar documentos automáticamente a partir de las respuestas.',
    category: 'Herramienta popular',
    href: '/formularios',
  },
  {
    id: 'plantillas',
    name: 'Plantillas',
    description: 'Accede a una biblioteca de documentos pre-redactados y guarda tus propios modelos para agilizar la creación de contratos y acuerdos recurrentes.',
    category: 'Herramienta popular',
    href: '/plantillas',
  },
  {
    id: 'firmado-prueba-vida',
    name: 'Firmado con prueba de vida',
    description: 'Añade una capa extra de seguridad a tus firmas solicitando verificación biométrica facial (prueba de vida) al momento de firmar.',
    category: 'Herramienta popular',
    href: '/documents-dashboard',
  },
  {
    id: 'expedientes',
    name: 'Expedientes',
    description: 'Crea expedientes con documentación adicional y gestión de flujos de trabajo para organizar mejor tus procesos legales.',
    category: 'Herramienta popular',
    href: '/documents-dashboard',
  },
  {
    id: 'lucia',
    name: 'LucIA',
    description: 'Tu asistente legal inteligente. Obtén respuestas instantáneas sobre tus documentos, ayuda con redacción y análisis legal impulsado por IA.',
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

  const isModuleActive = useCallback(
    (id: ModuleId) => activeModuleId === id,
    [activeModuleId]
  );

  return (
    <AppModulesContext.Provider value={{ activeModuleId, setActiveModule, isModuleActive, loading }}>
      {children}
    </AppModulesContext.Provider>
  );
}

export function useAppModules() {
  return useContext(AppModulesContext);
}
