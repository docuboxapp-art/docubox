import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface MetricCardProps {
  label: string;
  value: string | number;
  subValue?: string;
  trend?: { value: string; direction: 'up' | 'down' | 'neutral'; positive?: boolean };
  icon: React.ReactNode;
  iconBg?: string;
  alert?: boolean;
  warning?: boolean;
  hero?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export default function MetricCard({
  label,
  value,
  subValue,
  trend,
  icon,
  iconBg = 'bg-primary/10',
  alert = false,
  warning = false,
  hero = false,
  className = '',
  children,
}: MetricCardProps) {
  const cardBg = alert
    ? 'bg-red-50 border-red-200'
    : warning
    ? 'bg-amber-50 border-amber-200' :'bg-white border-border';

  return (
    <div
      className={`rounded-xl border shadow-card p-4 flex flex-col gap-3 transition-shadow duration-200 hover:shadow-card-hover ${cardBg} ${className}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${iconBg}`}>
          {icon}
        </div>
        {trend && (
          <div
            className={`flex items-center gap-1 text-xs font-600 ${
              trend.direction === 'up' && trend.positive !== false ?'text-emerald-600'
                : trend.direction === 'down'&& trend.positive === false ?'text-emerald-600'
                : trend.direction === 'up'&& trend.positive === false ?'text-red-600'
                : trend.direction === 'down'&& trend.positive !== false ?'text-red-600' :'text-muted-foreground'
            }`}
          >
            {trend.direction === 'up' ? (
              <TrendingUp size={13} />
            ) : trend.direction === 'down' ? (
              <TrendingDown size={13} />
            ) : (
              <Minus size={13} />
            )}
            {trend.value}
          </div>
        )}
      </div>
      <div>
        <p className={`text-[11px] font-600 uppercase tracking-wide mb-1 ${alert ? 'text-red-600' : warning ? 'text-amber-700' : 'text-muted-foreground'}`}>
          {label}
        </p>
        <p className={`tabular-nums font-700 leading-none ${hero ? 'text-4xl text-primary' : 'text-2xl text-foreground'}`}>
          {value}
        </p>
        {subValue && (
          <p className="text-xs text-muted-foreground mt-1">{subValue}</p>
        )}
      </div>
      {children}
    </div>
  );
}