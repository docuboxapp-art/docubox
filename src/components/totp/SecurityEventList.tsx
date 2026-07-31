'use client';

import React, { useEffect, useState } from 'react';
import { Shield, LogIn, AlertTriangle, CheckCircle, Lock, Loader2, Globe, Monitor } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

interface SecurityEvent {
  id: string;
  event_type: string;
  description: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

function getEventIcon(type: string) {
  switch (type) {
    case 'TOTP_ENABLED': return <CheckCircle size={13} className="text-green-600" />;
    case 'TOTP_DISABLED': return <AlertTriangle size={13} className="text-orange-500" />;
    case 'LOGIN_TOTP_SUCCESS': return <LogIn size={13} className="text-blue-600" />;
    case 'LOGIN_TOTP_FAILED': return <AlertTriangle size={13} className="text-red-500" />;
    case 'LOGIN_TOTP_LOCKED': return <Lock size={13} className="text-red-600" />;
    case 'TOTP_SETUP_STARTED': return <Shield size={13} className="text-primary" />;
    default: return <Shield size={13} className="text-muted-foreground" />;
  }
}

function getEventLabel(type: string) {
  switch (type) {
    case 'TOTP_ENABLED': return 'TOTP activado';
    case 'TOTP_DISABLED': return 'TOTP desactivado';
    case 'LOGIN_TOTP_SUCCESS': return 'Login con TOTP exitoso';
    case 'LOGIN_TOTP_FAILED': return 'Intento fallido de TOTP';
    case 'LOGIN_TOTP_LOCKED': return 'Cuenta bloqueada temporalmente';
    case 'TOTP_SETUP_STARTED': return 'Inicio de configuración TOTP';
    case 'TOTP_SETUP_FAILED': return 'Código incorrecto en configuración';
    default: return type.replace(/_/g, ' ');
  }
}

function getEventBadgeClass(type: string) {
  switch (type) {
    case 'TOTP_ENABLED': return 'bg-green-50 text-green-700 border-green-200';
    case 'TOTP_DISABLED': return 'bg-orange-50 text-orange-700 border-orange-200';
    case 'LOGIN_TOTP_SUCCESS': return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'LOGIN_TOTP_FAILED': case'LOGIN_TOTP_LOCKED': case'TOTP_SETUP_FAILED': return 'bg-red-50 text-red-700 border-red-200';
    default: return 'bg-gray-50 text-gray-700 border-gray-200';
  }
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString('es-MX', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function parseUserAgent(ua: string | null) {
  if (!ua) return 'Dispositivo desconocido';
  let browser = 'Navegador';
  let os = 'SO';
  if (ua.includes('Chrome') && !ua.includes('Edg')) browser = 'Chrome';
  else if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
  else if (ua.includes('Edg')) browser = 'Edge';
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac OS')) os = 'macOS';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
  else if (ua.includes('Linux')) os = 'Linux';
  return `${browser} · ${os}`;
}

export default function SecurityEventList() {
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    loadEvents();
  }, []);

  async function loadEvents() {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('auth_security_events')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);

      setEvents(data || []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 size={20} className="text-primary animate-spin" />
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <Shield size={32} className="text-muted-foreground opacity-40" />
        <p className="text-sm text-muted-foreground">No hay eventos de seguridad registrados.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {events.map((event) => (
        <div key={event.id} className="flex items-start gap-3 py-3 border-b border-border last:border-0">
          <div className="flex-shrink-0 mt-0.5">
            {getEventIcon(event.event_type)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={`inline-flex items-center gap-1 text-xs font-600 px-2 py-0.5 rounded-full border ${getEventBadgeClass(event.event_type)}`}>
                {getEventLabel(event.event_type)}
              </span>
            </div>
            {event.description && (
              <p className="text-xs text-muted-foreground mb-1">{event.description}</p>
            )}
            <div className="flex items-center gap-3 flex-wrap">
              {event.ip_address && event.ip_address !== 'unknown' && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Globe size={10} />
                  {event.ip_address}
                </span>
              )}
              {event.user_agent && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Monitor size={10} />
                  {parseUserAgent(event.user_agent)}
                </span>
              )}
              <span className="text-xs text-muted-foreground">{formatDate(event.created_at)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
