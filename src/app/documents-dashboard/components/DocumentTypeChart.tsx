'use client';

import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

// Backend integration: fetch from /api/analytics/document-types
const typeData = [
  { tipo: 'Contratos', count: 87, color: 'hsl(213, 73%, 30%)' },
  { tipo: 'Pagarés', count: 54, color: 'hsl(199, 89%, 48%)' },
  { tipo: 'Poderes', count: 41, color: 'hsl(142, 71%, 45%)' },
  { tipo: 'Facturas', count: 63, color: 'hsl(38, 92%, 50%)' },
  { tipo: 'Actas', count: 29, color: 'hsl(270, 60%, 55%)' },
  { tipo: 'Otros', count: 22, color: 'hsl(215, 16%, 65%)' },
];

const CustomTooltip = ({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { tipo: string; count: number } }>;
}) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white border border-border rounded-xl shadow-dropdown p-3">
        <p className="text-xs font-600 text-foreground">{payload[0].payload.tipo}</p>
        <p className="text-sm font-700 text-primary tabular-nums mt-0.5">
          {payload[0].payload.count} docs
        </p>
      </div>
    );
  }
  return null;
};

export default function DocumentTypeChart() {
  return (
    <div className="bg-white rounded-xl border border-border shadow-card p-5 h-full">
      <div className="mb-4">
        <h2 className="text-[13px] font-700 text-slate-900">Por tipo de documento</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Distribución del mes actual</p>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={typeData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(214, 20%, 92%)"
            horizontal
            vertical={false}
          />
          <XAxis
            dataKey="tipo"
            tick={{ fontSize: 10, fill: 'hsl(215, 16%, 55%)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'hsl(215, 16%, 55%)' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            {typeData.map((entry) => (
              <Cell key={`cell-${entry.tipo}`} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
