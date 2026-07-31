'use client';

import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,  } from 'recharts';

// Backend integration: fetch from /api/analytics/firma-volume?range=30d
const firmaData = [
  { fecha: '20 Feb', efirma: 8, autografa: 5, total: 13 },
  { fecha: '22 Feb', efirma: 12, autografa: 7, total: 19 },
  { fecha: '24 Feb', efirma: 9, autografa: 4, total: 13 },
  { fecha: '26 Feb', efirma: 15, autografa: 9, total: 24 },
  { fecha: '28 Feb', efirma: 11, autografa: 6, total: 17 },
  { fecha: '02 Mar', efirma: 18, autografa: 11, total: 29 },
  { fecha: '04 Mar', efirma: 7, autografa: 3, total: 10 },
  { fecha: '06 Mar', efirma: 22, autografa: 14, total: 36 },
  { fecha: '08 Mar', efirma: 19, autografa: 10, total: 29 },
  { fecha: '10 Mar', efirma: 25, autografa: 16, total: 41 },
  { fecha: '12 Mar', efirma: 14, autografa: 8, total: 22 },
  { fecha: '14 Mar', efirma: 28, autografa: 18, total: 46 },
  { fecha: '16 Mar', efirma: 21, autografa: 12, total: 33 },
  { fecha: '18 Mar', efirma: 16, autografa: 9, total: 25 },
  { fecha: '20 Mar', efirma: 31, autografa: 20, total: 51 },
  { fecha: '21 Mar', efirma: 24, autografa: 15, total: 39 },
];

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white border border-border rounded-xl shadow-dropdown p-3 min-w-[160px]">
        <p className="text-xs font-600 text-foreground mb-2">{label}</p>
        {payload.map((entry) => (
          <div key={`tooltip-${entry.name}`} className="flex items-center justify-between gap-4 mb-1">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
              <span className="text-xs text-muted-foreground">{entry.name}</span>
            </div>
            <span className="text-xs font-600 text-foreground tabular-nums">{entry.value}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

export default function FirmaVolumeChart() {
  return (
    <div className="bg-white rounded-xl border border-border shadow-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-600 text-foreground">Volumen de Firmas</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Últimos 30 días — e.firma vs Autógrafa</p>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-1.5 rounded-full bg-primary" />
            e.firma SAT
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-1.5 rounded-full" style={{ backgroundColor: 'hsl(199, 89%, 48%)' }} />
            Autógrafa
          </div>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={firmaData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="gradEfirma" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(213, 73%, 26%)" stopOpacity={0.18} />
              <stop offset="95%" stopColor="hsl(213, 73%, 26%)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradAutografa" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(199, 89%, 48%)" stopOpacity={0.15} />
              <stop offset="95%" stopColor="hsl(199, 89%, 48%)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(214, 20%, 92%)" vertical={false} />
          <XAxis
            dataKey="fecha"
            tick={{ fontSize: 10, fill: 'hsl(215, 16%, 55%)' }}
            axisLine={false}
            tickLine={false}
            interval={2}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'hsl(215, 16%, 55%)' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="efirma"
            name="e.firma SAT"
            stroke="hsl(213, 73%, 26%)"
            strokeWidth={2}
            fill="url(#gradEfirma)"
          />
          <Area
            type="monotone"
            dataKey="autografa"
            name="Autógrafa"
            stroke="hsl(199, 89%, 48%)"
            strokeWidth={2}
            fill="url(#gradAutografa)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}