import React from 'react';
import MetricCard from '@/components/ui/MetricCard';
import {
  FileText,
  CheckCircle2,
  Clock,
  AlertTriangle,
  PenTool,
  XCircle,
} from 'lucide-react';

// Grid plan: 6 cards → grid-cols-3 2xl:grid-cols-6
// Row 1: hero (spans 2 cols) + 2 regular = 4 cols used on lg
// Row 2: 3 regular cards
// On 2xl: all 6 in one row, hero spans 2

export default function MetricsBentoGrid() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-6 2xl:grid-cols-6 gap-4 2xl:gap-5">
      {/* Hero card — spans 2 cols */}
      <div className="col-span-2 md:col-span-2 xl:col-span-2 2xl:col-span-2">
        <MetricCard
          label="Documentos Pendientes"
          value="23"
          subValue="7 requieren acción inmediata"
          trend={{ value: '+4 hoy', direction: 'up', positive: false }}
          icon={<FileText size={18} className="text-primary" />}
          iconBg="bg-primary/10"
          hero
          className="h-full"
        >
          <div className="flex gap-2 mt-1">
            <div className="flex-1 bg-amber-100 rounded-lg px-3 py-2 text-center">
              <p className="text-lg font-700 text-amber-700 tabular-nums">14</p>
              <p className="text-[10px] text-amber-600 font-500">Secuencial</p>
            </div>
            <div className="flex-1 bg-blue-50 rounded-lg px-3 py-2 text-center">
              <p className="text-lg font-700 text-blue-700 tabular-nums">9</p>
              <p className="text-[10px] text-blue-600 font-500">Paralelo</p>
            </div>
          </div>
        </MetricCard>
      </div>

      {/* Tasa de completitud */}
      <MetricCard
        label="Tasa de Completitud"
        value="78.4%"
        subValue="vs 71.2% el mes pasado"
        trend={{ value: '+7.2%', direction: 'up', positive: true }}
        icon={<CheckCircle2 size={18} className="text-emerald-600" />}
        iconBg="bg-emerald-50"
      />

      {/* Tiempo promedio */}
      <MetricCard
        label="Tiempo Prom. de Firma"
        value="4.2h"
        subValue="Meta: ≤ 6h por flujo"
        trend={{ value: '-1.1h', direction: 'down', positive: true }}
        icon={<Clock size={18} className="text-blue-600" />}
        iconBg="bg-blue-50"
      />

      {/* Certificados por vencer — alert */}
      <MetricCard
        label="Certificados por Vencer"
        value="5"
        subValue="En los próximos 30 días"
        trend={{ value: 'Revisar', direction: 'neutral' }}
        icon={<AlertTriangle size={18} className="text-amber-600" />}
        iconBg="bg-amber-50"
        warning
      />

      {/* Firmas este mes */}
      <MetricCard
        label="Firmas Este Mes"
        value="341"
        subValue="Límite del plan: 500"
        trend={{ value: '+22 hoy', direction: 'up', positive: true }}
        icon={<PenTool size={18} className="text-purple-600" />}
        iconBg="bg-purple-50"
      />

      {/* Rechazados — alert */}
      <div className="col-span-2 md:col-span-1 xl:col-span-1 2xl:col-span-1">
        <MetricCard
          label="Documentos Rechazados"
          value="8"
          subValue="3 pendientes de reenvío"
          trend={{ value: '+3 esta semana', direction: 'up', positive: false }}
          icon={<XCircle size={18} className="text-red-600" />}
          iconBg="bg-red-50"
          alert
          className="h-full"
        />
      </div>
    </div>
  );
}