'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import AppLayout from '@/components/AppLayout';
import {
  Gift,
  Plus,
  LayoutGrid,
  Sliders,
  PlusCircle,
  FileText,
  Zap,
  GripVertical,
  X,
  PlusSquare,
  Check,
  ChevronRight,
} from 'lucide-react';
import VerificationProgressBar from './components/VerificationProgressBar';
import ActivityAuditLog from '@/app/mis-documentos/components/ActivityAuditLog';
import EstadoDocumentosWidget from './components/EstadoDocumentosWidget';
import EstadoParticipacionesWidget from './components/EstadoParticipacionesWidget';
import SugeridosParaTiWidget from './components/SugeridosParaTiWidget';
import DocumentosSinRevisionWidget from './components/DocumentosSinRevisionWidget';
import { createClient } from '@/lib/supabase/client';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DashboardMetrics {
  docsUsed: number;
  docsTotal: number;
  planName: string;
}

interface WidgetDef {
  id: string;
  label: string;
  column: 'left' | 'right';
  order: number;
}

const DEFAULT_WIDGETS: WidgetDef[] = [
  { id: 'estado_documentos', label: 'Estado de los documentos', column: 'left', order: 0 },
  { id: 'estado_participaciones', label: 'Estado de participaciones', column: 'left', order: 1 },
  { id: 'sugeridos', label: 'Sugeridos para ti', column: 'left', order: 2 },
  { id: 'sin_revision', label: 'Documentos sin revisión', column: 'left', order: 3 },
  { id: 'bitacora', label: 'Bitácora de Actividad y Auditoría', column: 'left', order: 4 },
  { id: 'docs', label: 'Documentos Disponibles', column: 'right', order: 0 },
  { id: 'plan', label: 'Plan', column: 'right', order: 1 },
  { id: 'quickactions', label: 'Acciones Rápidas', column: 'right', order: 2 },
];

// ── Donut chart ───────────────────────────────────────────────────────────────

function DonutChart({ used, total }: { used: number; total: number }) {
  const radius = 40;
  const stroke = 8;
  const normalizedRadius = radius - stroke / 2;
  const circumference = 2 * Math.PI * normalizedRadius;
  const remaining = total - used;
  const progress = total > 0 ? (remaining / total) * circumference : circumference;

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-28 h-28 flex items-center justify-center">
        <svg width="112" height="112" viewBox="0 0 96 96" className="-rotate-90">
          <circle
            cx="48"
            cy="48"
            r={normalizedRadius}
            fill="none"
            stroke="#edf2f7"
            strokeWidth={stroke}
          />
          <circle
            cx="48"
            cy="48"
            r={normalizedRadius}
            fill="none"
            stroke="hsl(221.2, 83.2%, 53.3%)"
            strokeWidth={stroke}
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={circumference - progress}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-800 text-slate-950 tabular-nums">{remaining}</span>
          <span className="text-[10px] text-slate-500 font-600">Restantes</span>
        </div>
      </div>
      <p className="text-xs text-slate-500 mt-3 text-center">
        Has usado {used} de {total} documentos.
      </p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DocumentsDashboardPage() {
  const supabase = createClient();

  const [greeting, setGreeting] = useState('');
  const [userName, setUserName] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    docsUsed: 0,
    docsTotal: 2,
    planName: 'Plan Gratuito',
  });
  const [loadingData, setLoadingData] = useState(true);

  // Personalizar mode
  const [customizing, setCustomizing] = useState(false);
  const [widgets, setWidgets] = useState<WidgetDef[]>(DEFAULT_WIDGETS);
  const [removedWidgets, setRemovedWidgets] = useState<WidgetDef[]>([]);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [savingLayout, setSavingLayout] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  useEffect(() => {
    const hour = new Date().getHours();
    setGreeting(hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches');
    loadDashboardData();
  }, []);

  async function loadDashboardData() {
    setLoadingData(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoadingData(false);
        return;
      }

      setUserId(user.id);

      // Load user profile for name
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('full_name, dashboard_layout')
        .eq('id', user.id)
        .single();

      if (profile?.full_name) {
        // Show only first name
        const firstName = profile.full_name.trim().split(' ')[0];
        setUserName(firstName);
      }

      // Load saved layout
      if (profile?.dashboard_layout) {
        try {
          const saved = profile.dashboard_layout as { widgets: WidgetDef[]; removed: WidgetDef[] };
          if (saved.widgets && Array.isArray(saved.widgets)) {
            // Filter out removed old widgets, keep only valid ones
            const validIds = [
              'estado_documentos',
              'estado_participaciones',
              'sugeridos',
              'sin_revision',
              'bitacora',
              'docs',
              'plan',
              'quickactions',
            ];
            let mergedWidgets = saved.widgets.filter((w) => validIds.includes(w.id));
            // Ensure new widgets are present
            const hasEstadoDocs = mergedWidgets.some((w) => w.id === 'estado_documentos');
            const hasEstadoPart = mergedWidgets.some((w) => w.id === 'estado_participaciones');
            const hasSugeridos = mergedWidgets.some((w) => w.id === 'sugeridos');
            const hasSinRevision = mergedWidgets.some((w) => w.id === 'sin_revision');
            const hasBitacora = mergedWidgets.some((w) => w.id === 'bitacora');
            if (!hasEstadoDocs)
              mergedWidgets = [
                ...mergedWidgets,
                {
                  id: 'estado_documentos',
                  label: 'Estado de los documentos',
                  column: 'left' as const,
                  order: mergedWidgets.filter((w) => w.column === 'left').length,
                },
              ];
            if (!hasEstadoPart)
              mergedWidgets = [
                ...mergedWidgets,
                {
                  id: 'estado_participaciones',
                  label: 'Estado de participaciones',
                  column: 'left' as const,
                  order: mergedWidgets.filter((w) => w.column === 'left').length,
                },
              ];
            if (!hasSugeridos)
              mergedWidgets = [
                ...mergedWidgets,
                {
                  id: 'sugeridos',
                  label: 'Sugeridos para ti',
                  column: 'left' as const,
                  order: mergedWidgets.filter((w) => w.column === 'left').length,
                },
              ];
            if (!hasSinRevision)
              mergedWidgets = [
                ...mergedWidgets,
                {
                  id: 'sin_revision',
                  label: 'Documentos sin revisión',
                  column: 'left' as const,
                  order: mergedWidgets.filter((w) => w.column === 'left').length,
                },
              ];
            if (!hasBitacora)
              mergedWidgets = [
                ...mergedWidgets,
                {
                  id: 'bitacora',
                  label: 'Bitácora de Actividad y Auditoría',
                  column: 'left' as const,
                  order: mergedWidgets.filter((w) => w.column === 'left').length,
                },
              ];
            setWidgets(mergedWidgets);
          }
          if (saved.removed && Array.isArray(saved.removed)) {
            // Filter removed list to only valid widget ids
            const validIds = [
              'estado_documentos',
              'estado_participaciones',
              'sugeridos',
              'sin_revision',
              'bitacora',
              'docs',
              'plan',
              'quickactions',
            ];
            setRemovedWidgets(saved.removed.filter((w) => validIds.includes(w.id)));
          }
        } catch {
          // use defaults
        }
      }

      // Load subscription
      const { data: sub } = await supabase
        .from('subscriptions')
        .select('documents_used, documents_limit, plan_id, subscription_plans(name)')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .single();

      const planData = sub?.subscription_plans as { name?: string } | null;

      setMetrics({
        docsUsed: sub?.documents_used ?? 0,
        docsTotal: sub?.documents_limit ?? 2,
        planName: planData?.name ?? 'Plan Gratuito',
      });
    } catch {
      // silent
    } finally {
      setLoadingData(false);
    }
  }

  // ── Layout persistence ─────────────────────────────────────────────────────

  const saveLayout = useCallback(
    async (newWidgets: WidgetDef[], newRemoved: WidgetDef[]) => {
      if (!userId) return;
      setSavingLayout(true);
      try {
        await supabase
          .from('user_profiles')
          .update({ dashboard_layout: { widgets: newWidgets, removed: newRemoved } })
          .eq('id', userId);
      } catch {
        // silent
      } finally {
        setSavingLayout(false);
      }
    },
    [userId, supabase]
  );

  // ── Personalizar actions ───────────────────────────────────────────────────

  function removeWidget(id: string) {
    const widget = widgets.find((w) => w.id === id);
    if (!widget) return;
    const newWidgets = widgets.filter((w) => w.id !== id);
    const newRemoved = [...removedWidgets, widget];
    setWidgets(newWidgets);
    setRemovedWidgets(newRemoved);
    saveLayout(newWidgets, newRemoved);
  }

  function addWidget(id: string) {
    const widget = removedWidgets.find((w) => w.id === id);
    if (!widget) return;
    const newRemoved = removedWidgets.filter((w) => w.id !== id);
    // Add to end of its original column
    const colWidgets = widgets.filter((w) => w.column === widget.column);
    const newWidget = { ...widget, order: colWidgets.length };
    const newWidgets = [...widgets, newWidget];
    setWidgets(newWidgets);
    setRemovedWidgets(newRemoved);
    saveLayout(newWidgets, newRemoved);
  }

  function moveWidget(id: string, direction: 'up' | 'down' | 'left' | 'right') {
    const idx = widgets.findIndex((w) => w.id === id);
    if (idx === -1) return;
    const widget = widgets[idx];
    const newWidgets = [...widgets];

    if (direction === 'left' || direction === 'right') {
      const newCol = direction === 'left' ? 'left' : 'right';
      if (widget.column === newCol) return;
      const colWidgets = newWidgets.filter((w) => w.column === newCol);
      newWidgets[idx] = { ...widget, column: newCol, order: colWidgets.length };
    } else {
      // up/down within same column
      const colWidgets = newWidgets
        .filter((w) => w.column === widget.column)
        .sort((a, b) => a.order - b.order);
      const colIdx = colWidgets.findIndex((w) => w.id === id);
      const swapIdx = direction === 'up' ? colIdx - 1 : colIdx + 1;
      if (swapIdx < 0 || swapIdx >= colWidgets.length) return;
      const swapWidget = colWidgets[swapIdx];
      // Swap orders
      newWidgets = newWidgets.map((w) => {
        if (w.id === id) return { ...w, order: swapWidget.order };
        if (w.id === swapWidget.id) return { ...w, order: widget.order };
        return w;
      });
    }
    setWidgets(newWidgets);
    setDraggedId(null);
    saveLayout(newWidgets, removedWidgets);
  }

  function handleDragStart(id: string) {
    setDraggedId(id);
  }

  function handleDrop(targetId: string) {
    if (!draggedId || draggedId === targetId) {
      setDraggedId(null);
      return;
    }
    const fromIdx = widgets.findIndex((w) => w.id === draggedId);
    const toIdx = widgets.findIndex((w) => w.id === targetId);
    if (fromIdx === -1 || toIdx === -1) {
      setDraggedId(null);
      return;
    }

    const newWidgets = [...widgets];
    const fromWidget = newWidgets[fromIdx];
    const toWidget = newWidgets[toIdx];
    // Swap column and order
    newWidgets[fromIdx] = { ...fromWidget, column: toWidget.column, order: toWidget.order };
    newWidgets[toIdx] = { ...toWidget, column: fromWidget.column, order: fromWidget.order };
    setWidgets(newWidgets);
    setDraggedId(null);
    saveLayout(newWidgets, removedWidgets);
  }

  function cancelCustomize() {
    setCustomizing(false);
    setShowAddPanel(false);
  }

  // ── Widget rendering ───────────────────────────────────────────────────────

  const quickActions = [
    {
      icon: <PlusCircle size={18} className="text-primary" />,
      label: 'Cargar Documento',
      sub: 'Inicia un nuevo flujo',
      href: '/crear-documento',
    },
    {
      icon: <FileText size={18} className="text-primary" />,
      label: 'Crear desde Plantilla',
      sub: 'Usa un formato predefinido',
      href: '/mis-documentos',
    },
  ];

  function renderWidget(w: WidgetDef) {
    const wrapClass = `relative ${customizing ? 'ring-2 ring-primary/30 rounded-xl' : ''}`;

    const CustomizeOverlay = () =>
      customizing ? (
        <div className="absolute top-1.5 right-1.5 flex items-center gap-1 z-10">
          <button
            onClick={() => moveWidget(w.id, 'up')}
            title="Mover arriba"
            className="w-6 h-6 bg-white border border-border rounded flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/40 text-xs"
          >
            ↑
          </button>
          <button
            onClick={() => moveWidget(w.id, 'down')}
            title="Mover abajo"
            className="w-6 h-6 bg-white border border-border rounded flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/40 text-xs"
          >
            ↓
          </button>
          <button
            onClick={() => moveWidget(w.id, w.column === 'left' ? 'right' : 'left')}
            title={w.column === 'left' ? 'Mover a columna 30%' : 'Mover a columna 70%'}
            className="w-6 h-6 bg-white border border-border rounded flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/40 text-xs"
          >
            {w.column === 'left' ? '→' : '←'}
          </button>
          <button
            onClick={() => removeWidget(w.id)}
            title="Eliminar widget"
            className="w-6 h-6 bg-red-50 border border-red-200 rounded flex items-center justify-center text-red-500 hover:bg-red-100"
          >
            <X size={10} />
          </button>
          <div
            draggable
            onDragStart={() => handleDragStart(w.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(w.id)}
            className="w-6 h-6 bg-white border border-border rounded flex items-center justify-center text-muted-foreground cursor-grab active:cursor-grabbing"
          >
            <GripVertical size={10} />
          </div>
        </div>
      ) : null;

    switch (w.id) {
      case 'docs':
        return (
          <div
            key={w.id}
            className={`${wrapClass} w-full`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(w.id)}
          >
            <CustomizeOverlay />
            <div className="bg-white rounded-2xl border border-slate-200 shadow-[0_18px_45px_-35px_rgba(15,23,42,0.65)] transition-all duration-200 p-5 flex flex-col">
              <h3 className="text-sm font-800 text-slate-950 mb-4">Documentos Disponibles</h3>
              <div className="flex-1 flex flex-col items-center justify-center">
                <DonutChart used={metrics.docsUsed} total={metrics.docsTotal} />
              </div>
              <button className="w-full mt-4 px-4 py-2.5 border border-slate-300 bg-white text-slate-950 text-sm font-800 rounded-xl hover:border-primary/40 hover:bg-primary/5 transition-all duration-150">
                Comprar más
              </button>
            </div>
          </div>
        );

      case 'plan':
        return (
          <div
            key={w.id}
            className={`${wrapClass} w-full`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(w.id)}
          >
            <CustomizeOverlay />
            <div className="bg-white border border-emerald-200 rounded-2xl p-5 shadow-[0_18px_45px_-35px_rgba(15,23,42,0.65)] transition-all duration-200 flex flex-col items-center justify-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
                <Gift size={20} className="text-green-600" />
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-1.5 mb-0.5">
                  <span className="text-sm font-700 text-green-800">{metrics.planName}</span>
                  <span className="text-[10px] font-700 bg-green-200 text-green-800 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                    FREE
                  </span>
                </div>
                <p className="text-xs text-green-700">
                  <strong>{metrics.docsTotal}</strong> docs disponibles
                </p>
              </div>
              <button className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-700 rounded-xl transition-all duration-150 w-full justify-center shadow-[0_10px_25px_-15px_rgba(16,185,129,0.9)]">
                <Zap size={12} />
                Mejorar Plan
              </button>
            </div>
          </div>
        );

      case 'quickactions':
        return (
          <div
            key={w.id}
            className={`${wrapClass} w-full`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(w.id)}
          >
            <CustomizeOverlay />
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-[0_18px_45px_-35px_rgba(15,23,42,0.65)] transition-all duration-200 flex flex-col [&>h3:first-child]:hidden">
              <h3 className="text-sm font-800 text-slate-950 mb-3">Acciones Rápidas</h3>
              <h3 className="text-sm font-700 text-white mb-3">Acciones Rápidas</h3>
              <div className="space-y-2 flex-1">
                {quickActions.map((action) => (
                  <Link
                    key={action.label}
                    href={action.href}
                    className="flex items-center gap-3 border border-slate-200 hover:border-primary/30 hover:bg-primary/5 rounded-xl px-3 py-3 transition-all duration-150 group"
                  >
                    <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                      {action.icon}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-800 text-slate-900 leading-tight">
                        {action.label}
                      </p>
                      <p className="text-[10px] text-slate-500 leading-tight mt-0.5">
                        {action.sub}
                      </p>
                    </div>
                    <ChevronRight
                      size={15}
                      className="ml-auto text-slate-400 group-hover:text-primary"
                    />
                  </Link>
                ))}
              </div>
            </div>
          </div>
        );

      case 'estado_documentos':
        return (
          <div
            key={w.id}
            className={wrapClass}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(w.id)}
          >
            <CustomizeOverlay />
            <EstadoDocumentosWidget />
          </div>
        );

      case 'estado_participaciones':
        return (
          <div
            key={w.id}
            className={wrapClass}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(w.id)}
          >
            <CustomizeOverlay />
            <EstadoParticipacionesWidget />
          </div>
        );

      case 'sugeridos':
        return (
          <div
            key={w.id}
            className={wrapClass}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(w.id)}
          >
            <CustomizeOverlay />
            <SugeridosParaTiWidget />
          </div>
        );

      case 'sin_revision':
        return (
          <div
            key={w.id}
            className={wrapClass}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(w.id)}
          >
            <CustomizeOverlay />
            <DocumentosSinRevisionWidget />
          </div>
        );

      case 'bitacora':
        return (
          <div
            key={w.id}
            className={wrapClass}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(w.id)}
          >
            <CustomizeOverlay />
            <ActivityAuditLog />
          </div>
        );

      default:
        return null;
    }
  }

  const leftWidgets = widgets.filter((w) => w.column === 'left').sort((a, b) => a.order - b.order);

  const rightWidgets = widgets
    .filter((w) => w.column === 'right')
    .sort((a, b) => a.order - b.order);

  return (
    <AppLayout topBanner={<VerificationProgressBar />}>
      {/* Main content grid — 70% left / 30% right */}
      <div className="-mx-4 -my-4 min-h-[calc(100vh-8rem)] bg-[#f8fafc] px-4 py-5 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 xl:-mx-10 xl:px-10 md:-my-6 md:py-6">
        <div className="mx-auto grid w-full max-w-[1680px] grid-cols-1 gap-6 xl:grid-cols-[minmax(0,7fr)_minmax(360px,3fr)]">
          {/* ── Left column (70%) ── */}
          <div className="space-y-5 min-w-0">
            {/* Greeting + actions */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <p className="text-lg text-slate-500">{greeting},</p>
                <h1 className="mt-1 text-4xl font-800 text-slate-950 flex items-center gap-2 tracking-normal">
                  {loadingData ? (
                    <span className="inline-block w-32 h-9 bg-slate-200 rounded animate-pulse" />
                  ) : (
                    userName || 'Usuario'
                  )}
                </h1>
                <p className="text-sm text-slate-500 mt-2">
                  Panel principal de tu espacio de trabajo
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href="/crear-documento"
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-primary text-white text-sm font-700 rounded-xl hover:bg-primary-700 active:bg-primary-800 transition-all duration-150 shadow-[0_12px_24px_-18px_rgba(37,99,235,0.8)]"
                >
                  <Plus size={15} />
                  Crear Documento
                </Link>
                <button className="flex items-center gap-1.5 px-3 py-2.5 border border-slate-200 rounded-xl bg-white text-sm font-600 text-slate-700 hover:bg-primary/5 hover:text-primary hover:border-primary/30 transition-all duration-150">
                  <LayoutGrid size={14} />
                  Apps
                </button>
                <button
                  onClick={() => {
                    if (customizing) {
                      cancelCustomize();
                    } else {
                      setCustomizing(true);
                    }
                  }}
                  className={`flex items-center gap-1.5 px-3 py-2.5 border rounded-xl text-sm font-600 transition-all duration-150 ${
                    customizing
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-primary/5 hover:text-primary hover:border-primary/30'
                  }`}
                >
                  {customizing ? <Check size={14} /> : <Sliders size={14} />}
                  {customizing ? 'Listo' : 'Personalizar'}
                </button>
                {customizing && (
                  <button
                    onClick={() => setShowAddPanel((v) => !v)}
                    className="flex items-center gap-1.5 px-3 py-2.5 border border-emerald-200 bg-emerald-50 text-emerald-700 rounded-xl text-sm font-700 hover:bg-emerald-100 transition-all duration-150"
                  >
                    <PlusSquare size={14} />
                    Añadir widget
                  </button>
                )}
              </div>
            </div>

            {/* Add widget panel */}
            {customizing && showAddPanel && (
              <div className="bg-white border border-border rounded-xl p-4 shadow-card">
                <h3 className="text-sm font-700 text-foreground mb-3">Widgets eliminados</h3>
                {removedWidgets.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No hay widgets eliminados.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {removedWidgets.map((w) => (
                      <button
                        key={w.id}
                        onClick={() => addWidget(w.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/5 border border-primary/20 text-primary text-xs font-500 rounded-lg hover:bg-primary/10 transition-all"
                      >
                        <PlusCircle size={12} />
                        {w.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Left column widgets */}
            {leftWidgets.map((w) => renderWidget(w))}
          </div>

          {/* ── Right column (30%) ── */}
          <div className="flex flex-col gap-4 w-full min-w-0">
            {rightWidgets.map((w) => renderWidget(w))}
          </div>
        </div>
      </div>

      {/* Saving indicator */}
      {savingLayout && (
        <div className="fixed bottom-4 right-4 bg-gray-800 text-white text-xs px-3 py-2 rounded-lg shadow-lg flex items-center gap-2 z-50">
          <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          Guardando diseño...
        </div>
      )}
    </AppLayout>
  );
}
