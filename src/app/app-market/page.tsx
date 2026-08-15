'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Check,
  ClipboardList,
  ExternalLink,
  FileStack,
  Files,
  FolderKanban,
  Grid2X2,
  PackageCheck,
  LayoutTemplate,
  Landmark,
  MailCheck,
  ScanFace,
  Search,
  Sparkles,
  Store,
} from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { ALL_MODULES, type ModuleId, useAppModules } from '@/contexts/AppModulesContext';

type FilterId = 'todos' | 'productividad' | 'seguridad' | 'ia';

const filters: Array<{ id: FilterId; label: string }> = [
  { id: 'todos', label: 'Todos' },
  { id: 'productividad', label: 'Productividad' },
  { id: 'seguridad', label: 'Seguridad' },
  { id: 'ia', label: 'Inteligencia artificial' },
];

const modulePresentation: Record<
  ModuleId,
  {
    icon: React.ElementType;
    category: Exclude<FilterId, 'todos'>;
    categoryLabel: string;
    iconClass: string;
    surfaceClass: string;
  }
> = {
  formularios: {
    icon: ClipboardList,
    category: 'productividad',
    categoryLabel: 'Productividad',
    iconClass: 'text-violet-600',
    surfaceClass: 'border-violet-200 bg-violet-50',
  },
  plantillas: {
    icon: LayoutTemplate,
    category: 'productividad',
    categoryLabel: 'Productividad',
    iconClass: 'text-blue-600',
    surfaceClass: 'border-blue-200 bg-blue-50',
  },
  'firmado-prueba-vida': {
    icon: ScanFace,
    category: 'seguridad',
    categoryLabel: 'Seguridad e identidad',
    iconClass: 'text-emerald-600',
    surfaceClass: 'border-emerald-200 bg-emerald-50',
  },
  expedientes: {
    icon: FolderKanban,
    category: 'productividad',
    categoryLabel: 'Gestión documental',
    iconClass: 'text-amber-600',
    surfaceClass: 'border-amber-200 bg-amber-50',
  },
  notifica: {
    icon: MailCheck,
    category: 'productividad',
    categoryLabel: 'Comunicacion certificada',
    iconClass: 'text-cyan-700',
    surfaceClass: 'border-cyan-200 bg-cyan-50',
  },
  'credit-titles': {
    icon: Landmark,
    category: 'productividad',
    categoryLabel: 'Legal y financiero',
    iconClass: 'text-indigo-700',
    surfaceClass: 'border-indigo-200 bg-indigo-50',
  },
  'bulk-signatures': {
    icon: Files,
    category: 'productividad',
    categoryLabel: 'Productividad documental',
    iconClass: 'text-blue-700',
    surfaceClass: 'border-blue-200 bg-blue-50',
  },
  lucia: {
    icon: Sparkles,
    category: 'ia',
    categoryLabel: 'Inteligencia artificial',
    iconClass: 'text-rose-600',
    surfaceClass: 'border-rose-200 bg-rose-50',
  },
};

export default function AppMarketPage() {
  const { activeModuleId, setActiveModule, isModuleActive, loading } = useAppModules();
  const [filter, setFilter] = useState<FilterId>('todos');
  const [updatingModule, setUpdatingModule] = useState<ModuleId | null>(null);

  const activeModule = ALL_MODULES.find((module) => module.id === activeModuleId) ?? null;
  const ActiveModuleIcon = activeModule ? modulePresentation[activeModule.id].icon : null;

  const visibleModules = useMemo(() => {
    return ALL_MODULES.filter((module) => {
      const presentation = modulePresentation[module.id];
      const matchesFilter = filter === 'todos' || presentation.category === filter;

      return !isModuleActive(module.id) && matchesFilter;
    });
  }, [filter, isModuleActive]);

  const handleToggle = async (id: ModuleId) => {
    setUpdatingModule(id);
    await Promise.resolve(setActiveModule(isModuleActive(id) ? null : id));
    window.setTimeout(() => setUpdatingModule(null), 250);
  };

  return (
    <AppLayout noPadding>
      <div className="-mx-4 -my-4 min-h-[calc(100vh-4rem)] bg-[#f6f8fb] px-4 py-4 dark:bg-background sm:px-5 md:-my-6 md:py-5 lg:px-6">
        <div className="mx-auto w-full max-w-[1560px]">
          <header className="border-b border-slate-200 pb-5">
            <div>
              <h1 className="text-2xl font-600 text-slate-950 dark:text-foreground">App Market</h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-muted-foreground">
                Personaliza tu espacio de trabajo con herramientas de Docubox.
              </p>
            </div>
          </header>

          <section className="mt-5 overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-border dark:bg-card">
            <div className="grid gap-0 lg:grid-cols-[1fr_auto]">
              <div className="flex items-start gap-4 p-5 sm:items-center">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-blue-50 text-primary dark:bg-primary/10">
                  <Store size={20} />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-600 text-slate-950 dark:text-foreground">
                      Plan gratuito
                    </h2>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-600 text-slate-600 dark:bg-muted dark:text-muted-foreground">
                      1 módulo incluido
                    </span>
                  </div>
                  <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500 dark:text-muted-foreground">
                    Puedes mantener un módulo activo a la vez. Al activar uno nuevo, reemplazará al
                    módulo actual en tu navegación.
                  </p>
                </div>
              </div>
              <div className="flex items-center border-t border-slate-200 px-5 py-4 dark:border-border lg:border-l lg:border-t-0">
                <Link
                  href="/facturacion"
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-600 text-white shadow-sm transition-colors hover:bg-primary/90 lg:w-auto"
                >
                  Ver planes
                  <ArrowRight size={16} />
                </Link>
              </div>
            </div>
          </section>

          <div className="mt-6 grid items-start gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(280px,3fr)]">
            <section className="order-2 overflow-hidden rounded-lg border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-border dark:bg-card lg:sticky lg:top-[5.25rem] lg:col-start-2 lg:row-start-1">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-600 text-slate-950 dark:text-foreground">
                    Productos instalados
                  </h2>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-600 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                    <PackageCheck size={12} />
                    {activeModule ? 1 : 0} de 1 módulo activo
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-slate-500 dark:text-muted-foreground">
                  Aplicaciones activas en tu espacio de trabajo.
                </p>
              </div>

              {activeModule && ActiveModuleIcon ? (
                <div className="mt-4 flex flex-col gap-4 border-t border-slate-200 pt-4 dark:border-border">
                  <div className="flex min-w-0 items-start gap-3">
                    <div
                      className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md border ${modulePresentation[activeModule.id].surfaceClass}`}
                    >
                      <ActiveModuleIcon
                        size={22}
                        className={modulePresentation[activeModule.id].iconClass}
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-600 text-slate-950 dark:text-foreground">
                          {activeModule.name}
                        </h3>
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-600 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                          Instalado
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm leading-5 text-slate-500 dark:text-muted-foreground">
                        {activeModule.description}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 dark:border-border">
                    <span className="inline-flex items-center gap-2 text-sm font-500 text-emerald-700 dark:text-emerald-300">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      Activo
                    </span>
                    <Link
                      href={activeModule.href}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-500 text-slate-600 transition-colors hover:bg-white hover:text-slate-950 dark:text-muted-foreground dark:hover:bg-muted"
                    >
                      Abrir
                      <ExternalLink size={13} />
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleToggle(activeModule.id)}
                      disabled={updatingModule === activeModule.id}
                      className="h-8 rounded-md px-2 text-sm font-500 text-red-600 transition-colors hover:bg-red-50 disabled:cursor-wait disabled:opacity-60 dark:hover:bg-red-950/30"
                    >
                      {updatingModule === activeModule.id ? 'Guardando...' : 'Deshabilitar'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 flex min-h-28 items-start border-t border-slate-200 pt-5 text-sm leading-6 text-slate-500 dark:border-border dark:text-muted-foreground">
                  No tienes productos instalados. Activa uno desde el catálogo.
                </div>
              )}
            </section>

            <section className="order-1 min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-border dark:bg-card lg:col-start-1 lg:row-start-1">
              <div>
                <div>
                  <h2 className="text-base font-600 text-slate-950 dark:text-foreground">
                    Explorar productos
                  </h2>
                  <p className="mt-0.5 text-sm text-slate-500 dark:text-muted-foreground">
                    Extensiones diseñadas para tus procesos documentales.
                  </p>
                </div>
              </div>

              <div className="mt-4 flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-border">
                {filters.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setFilter(item.id)}
                    className={`relative h-10 flex-shrink-0 px-3 text-sm transition-colors after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 ${
                      filter === item.id
                        ? 'font-600 text-primary after:bg-primary'
                        : 'font-500 text-slate-500 after:bg-transparent hover:text-slate-900 dark:text-muted-foreground dark:hover:text-foreground'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {loading ? (
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {[0, 1, 2].map((item) => (
                    <div
                      key={item}
                      className="h-64 animate-pulse rounded-lg border border-slate-200 bg-white dark:border-border dark:bg-card"
                    />
                  ))}
                </div>
              ) : visibleModules.length > 0 ? (
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {visibleModules.map((module) => {
                    const presentation = modulePresentation[module.id];
                    const ModuleIcon = presentation.icon;
                    const active = isModuleActive(module.id);
                    const updating = updatingModule === module.id;

                    return (
                      <article
                        key={module.id}
                        className={`group flex min-h-[260px] flex-col overflow-hidden rounded-lg border bg-white transition-[border-color,box-shadow] dark:bg-card ${
                          active
                            ? 'border-primary/50 shadow-[0_0_0_2px_rgba(30, 107, 255,0.08)] dark:border-primary/60'
                            : 'border-slate-200 hover:border-slate-300 hover:shadow-sm dark:border-border'
                        }`}
                      >
                        <div className="flex flex-1 flex-col p-5">
                          <div className="flex items-start justify-between gap-4">
                            <div
                              className={`flex h-11 w-11 items-center justify-center rounded-md border ${presentation.surfaceClass}`}
                            >
                              <ModuleIcon size={22} className={presentation.iconClass} />
                            </div>
                            {active && (
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-600 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                                <Check size={12} />
                                Activo
                              </span>
                            )}
                          </div>

                          <div className="mt-4 flex items-center gap-2 text-[11px] font-600 uppercase tracking-[0.08em] text-slate-400">
                            <Grid2X2 size={12} />
                            {presentation.categoryLabel}
                          </div>
                          <h3 className="mt-2 text-lg font-600 text-slate-950 dark:text-foreground">
                            {module.name}
                          </h3>
                          <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-500 dark:text-muted-foreground">
                            {module.description}
                          </p>
                        </div>

                        <div className="flex min-h-14 items-center justify-between gap-3 border-t border-slate-200 px-5 py-3 dark:border-border">
                          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-muted-foreground">
                            {active ? <PackageCheck size={14} /> : <FileStack size={14} />}
                            {active ? 'Instalado en tu espacio' : 'Disponible'}
                          </span>
                          <div className="flex items-center gap-2">
                            {active && (
                              <Link
                                href={module.href}
                                className="inline-flex h-8 items-center justify-center rounded-md px-2.5 text-xs font-600 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950 dark:text-muted-foreground dark:hover:bg-muted"
                              >
                                Abrir
                              </Link>
                            )}
                            <button
                              type="button"
                              onClick={() => handleToggle(module.id)}
                              disabled={updating}
                              className={`inline-flex h-8 items-center justify-center rounded-md px-3 text-xs font-600 transition-colors disabled:cursor-wait disabled:opacity-60 ${
                                active
                                  ? 'border border-slate-200 bg-white text-slate-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:border-border dark:bg-card dark:text-muted-foreground'
                                  : 'bg-primary text-white hover:bg-primary/90'
                              }`}
                            >
                              {updating ? 'Guardando...' : active ? 'Desactivar' : 'Activar'}
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-4 flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-6 text-center dark:border-border dark:bg-card">
                  <Search size={24} className="text-slate-400" />
                  <h3 className="mt-3 text-sm font-600 text-slate-900 dark:text-foreground">
                    No encontramos aplicaciones
                  </h3>
                  <p className="mt-1 text-sm text-slate-500 dark:text-muted-foreground">
                    Prueba con otra búsqueda o selecciona una categoría diferente.
                  </p>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
