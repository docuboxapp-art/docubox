'use client';

import React from 'react';
import AppLayout from '@/components/AppLayout';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Circle, ClipboardList, PenTool, ScanFace, FolderOpen, Sparkles, Store } from 'lucide-react';
import { useAppModules, ALL_MODULES, type ModuleId } from '@/contexts/AppModulesContext';

const moduleIcons: Record<ModuleId, React.ReactNode> = {
  formularios: <ClipboardList size={28} className="text-violet-500" />,
  plantillas: <PenTool size={28} className="text-blue-500" />,
  'firmado-prueba-vida': <ScanFace size={28} className="text-indigo-500" />,
  expedientes: <FolderOpen size={28} className="text-orange-500" />,
  lucia: <Sparkles size={28} className="text-pink-500" />,
};

const moduleBg: Record<ModuleId, string> = {
  formularios: 'bg-violet-50 dark:bg-violet-950/30',
  plantillas: 'bg-blue-50 dark:bg-blue-950/30',
  'firmado-prueba-vida': 'bg-indigo-50 dark:bg-indigo-950/30',
  expedientes: 'bg-orange-50 dark:bg-orange-950/30',
  lucia: 'bg-pink-50 dark:bg-pink-950/30',
};

export default function AppMarketPage() {
  const { activeModuleId, setActiveModule, isModuleActive } = useAppModules();

  const installedModules = ALL_MODULES.filter((m) => isModuleActive(m.id));
  const availableModules = ALL_MODULES.filter((m) => !isModuleActive(m.id));

  const handleToggle = (id: ModuleId) => {
    if (isModuleActive(id)) {
      // Deselect
      setActiveModule(null);
    } else {
      // Select this one (replaces any previous)
      setActiveModule(id);
    }
  };

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Store size={24} className="text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-700 text-foreground">App Market</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Gestiona las funcionalidades de tu espacio de trabajo.
              </p>
            </div>
          </div>
          <Link
            href="/documents-dashboard"
            className="flex items-center gap-2 text-sm font-500 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft size={16} />
            Volver al Dashboard
          </Link>
        </div>

        {/* Free plan notice */}
        <div className="mb-8 p-4 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Store size={16} className="text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <p className="text-sm font-600 text-amber-800 dark:text-amber-300">Plan Gratuito — 1 módulo activo</p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5 leading-relaxed">
              Con el plan gratuito puedes tener <strong>un solo módulo activo</strong> a la vez. Selecciona el que más necesites; aparecerá en tu menú lateral y barra superior. Para activar múltiples módulos, actualiza tu plan.
            </p>
          </div>
        </div>

        {/* Available modules */}
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-5">
            <Circle size={16} className="text-muted-foreground" />
            <h2 className="text-base font-600 text-foreground">Explora más productos</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {availableModules.map((module) => {
              const isSelected = isModuleActive(module.id);
              return (
                <div
                  key={module.id}
                  className={`relative rounded-xl border transition-all duration-200 overflow-hidden ${
                    isSelected
                      ? 'border-primary shadow-md ring-2 ring-primary/20'
                      : 'border-border hover:border-primary/40 hover:shadow-sm'
                  } bg-background`}
                >
                  <div className="p-5">
                    <div className={`w-12 h-12 rounded-xl ${moduleBg[module.id]} flex items-center justify-center mb-4`}>
                      {moduleIcons[module.id]}
                    </div>
                    <h3 className="text-base font-600 text-foreground mb-1">{module.name}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed mb-3">{module.description}</p>
                    <span className="inline-flex items-center gap-1 text-[11px] font-500 text-muted-foreground">
                      <Store size={11} />
                      {module.category}
                    </span>
                  </div>
                  <div className="border-t border-border px-5 py-3 flex items-center justify-between bg-muted/20">
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Store size={12} />
                      Disponible
                    </span>
                    <button
                      onClick={() => handleToggle(module.id)}
                      className="text-sm font-600 text-primary hover:text-primary/80 transition-colors"
                    >
                      Habilitar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {availableModules.length === 0 && (
            <div className="text-center py-10 text-muted-foreground text-sm">
              Todos los módulos están instalados.
            </div>
          )}
        </div>

        {/* Installed modules */}
        {installedModules.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-5">
              <CheckCircle2 size={16} className="text-green-500" />
              <h2 className="text-base font-600 text-foreground">Productos instalados</h2>
            </div>

            <div className="space-y-3">
              {installedModules.map((module) => (
                <div
                  key={module.id}
                  className="flex items-center gap-4 p-4 rounded-xl border border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/20"
                >
                  <div className={`w-10 h-10 rounded-xl ${moduleBg[module.id]} flex items-center justify-center flex-shrink-0`}>
                    {moduleIcons[module.id]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-600 text-foreground">{module.name}</h3>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 text-[11px] font-600">
                        Instalado
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{module.description}</p>
                  </div>
                  <div className="flex items-center gap-4 flex-shrink-0">
                    <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 font-500">
                      <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                      Activo
                    </span>
                    <button
                      onClick={() => handleToggle(module.id)}
                      className="text-sm font-600 text-destructive hover:text-destructive/80 transition-colors"
                    >
                      Deshabilitar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
