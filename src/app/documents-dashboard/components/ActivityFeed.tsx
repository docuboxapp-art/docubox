'use client';

import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Upload,
  Send,
  AlertTriangle,
  Clock,
  Shield,
  FileText,
  Eye,
  UserCheck,
  RefreshCw,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface ActivityItem {
  id: string;
  accion: string;
  documento_nombre: string | null;
  created_at: string;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Ahora mismo';
  if (mins < 60) return `Hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'Ayer';
  return `Hace ${days} días`;
}

function getConfig(accion: string): { icon: React.ReactNode; iconBg: string } {
  const a = accion.toLowerCase();
  if (
    a.includes('firma') &&
    (a.includes('complet') || a.includes('exitosa') || a.includes('aprobad'))
  ) {
    return {
      icon: <CheckCircle2 size={14} className="text-emerald-600" />,
      iconBg: 'bg-emerald-50',
    };
  }
  if (a.includes('rechaz') || a.includes('fallid') || a.includes('denegad')) {
    return { icon: <XCircle size={14} className="text-red-600" />, iconBg: 'bg-red-50' };
  }
  if (a.includes('subid') || a.includes('cread') || a.includes('upload')) {
    return { icon: <Upload size={14} className="text-blue-600" />, iconBg: 'bg-blue-50' };
  }
  if (a.includes('enviad') || a.includes('invitac') || a.includes('notificac')) {
    return { icon: <Send size={14} className="text-primary" />, iconBg: 'bg-primary/10' };
  }
  if (a.includes('vencid') || a.includes('vencimiento') || a.includes('expir')) {
    return { icon: <Clock size={14} className="text-orange-500" />, iconBg: 'bg-orange-50' };
  }
  if (a.includes('alerta') || a.includes('advertencia')) {
    return { icon: <AlertTriangle size={14} className="text-amber-600" />, iconBg: 'bg-amber-50' };
  }
  if (a.includes('nom151') || a.includes('blockchain') || a.includes('sellad')) {
    return { icon: <Shield size={14} className="text-teal-600" />, iconBg: 'bg-teal-50' };
  }
  if (a.includes('participante') || a.includes('firmante')) {
    return { icon: <UserCheck size={14} className="text-violet-600" />, iconBg: 'bg-violet-50' };
  }
  if (a.includes('abierto') || a.includes('visto') || a.includes('descarg')) {
    return { icon: <Eye size={14} className="text-slate-600" />, iconBg: 'bg-slate-100' };
  }
  if (a.includes('inici') || a.includes('otp') || a.includes('verific')) {
    return { icon: <RefreshCw size={14} className="text-amber-600" />, iconBg: 'bg-amber-50' };
  }
  return { icon: <FileText size={14} className="text-gray-500" />, iconBg: 'bg-gray-100' };
}

export default function ActivityFeed() {
  const { user } = useAuth();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const supabase = createClient();

    async function fetchActivity() {
      setLoading(true);
      const { data } = await supabase
        .from('audit_trail')
        .select('id, accion, documento_nombre, created_at')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(8);
      setItems(data ?? []);
      setLoading(false);
    }

    fetchActivity();
  }, [user]);

  return (
    <div className="bg-white rounded-xl border border-border shadow-card">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <h2 className="text-[13px] font-700 text-slate-900">Actividad reciente</h2>
        <span className="text-xs text-muted-foreground bg-gray-100 px-2 py-0.5 rounded-full">
          {items.length} eventos
        </span>
      </div>

      {loading ? (
        <div className="px-5 py-8 flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="px-5 py-10 flex flex-col items-center justify-center text-center">
          <FileText size={28} className="text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">Sin actividad reciente.</p>
          <p className="text-xs text-muted-foreground/70 mt-0.5">
            Las acciones sobre documentos aparecerán aquí.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {items.map((item) => {
            const config = getConfig(item.accion);
            return (
              <div
                key={item.id}
                className="px-5 py-3.5 hover:bg-muted/30 transition-colors duration-100"
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${config.iconBg}`}
                  >
                    {config.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-600 text-foreground">{item.accion}</p>
                    {item.documento_nombre && (
                      <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed line-clamp-1">
                        {item.documento_nombre}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                      {timeAgo(item.created_at)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="px-5 py-3 border-t border-border">
          <a
            href="/mis-documentos"
            className="w-full block text-center text-xs text-muted-foreground hover:text-foreground transition-colors font-500"
          >
            Ver bitácora completa →
          </a>
        </div>
      )}
    </div>
  );
}
