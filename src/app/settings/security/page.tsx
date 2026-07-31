'use client';

import React, { useState, useEffect, useCallback } from 'react';
import AppLayout from '@/components/AppLayout';
import { Shield, Smartphone, CheckCircle, AlertCircle, Loader2, Activity, ShieldCheck, ShieldOff, Clock } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import TotpSetupModal from '@/components/totp/TotpSetupModal';
import TotpCodeInput from '@/components/totp/TotpCodeInput';
import SecurityEventList from '@/components/totp/SecurityEventList';

interface TotpStatus {
  isEnabled: boolean;
  confirmedAt: string | null;
  lastUsedAt: string | null;
}

export default function SecuritySettingsPage() {
  const [totpStatus, setTotpStatus] = useState<TotpStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [showDisableModal, setShowDisableModal] = useState(false);
  const [disableCode, setDisableCode] = useState('');
  const [disableLoading, setDisableLoading] = useState(false);
  const [disableError, setDisableError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const supabase = createClient();

  const loadTotpStatus = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('user_totp_settings')
        .select('is_enabled, confirmed_at, last_used_at')
        .eq('user_id', user.id)
        .maybeSingle();

      setTotpStatus({
        isEnabled: data?.is_enabled ?? false,
        confirmedAt: data?.confirmed_at ?? null,
        lastUsedAt: data?.last_used_at ?? null,
      });
    } catch {
      setTotpStatus({ isEnabled: false, confirmedAt: null, lastUsedAt: null });
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    loadTotpStatus();
  }, [loadTotpStatus]);

  const handleDisable = async () => {
    if (disableCode.length !== 6) {
      setDisableError('Ingresa los 6 dígitos del código');
      return;
    }
    setDisableLoading(true);
    setDisableError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setDisableError('Sesión no válida');
        return;
      }

      const res = await fetch('/api/auth/totp/disable', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ code: disableCode }),
      });

      const data = await res.json();
      if (!res.ok) {
        setDisableError(data.error || 'Código incorrecto');
        return;
      }

      setShowDisableModal(false);
      setDisableCode('');
      setSuccessMsg('App autenticadora desactivada correctamente.');
      await loadTotpStatus();
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch {
      setDisableError('Error de conexión. Intenta nuevamente.');
    } finally {
      setDisableLoading(false);
    }
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto py-6 px-4 flex flex-col gap-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Shield size={24} className="text-primary" />
            Seguridad de cuenta
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Administra los métodos de seguridad para proteger tu acceso y tus documentos.
          </p>
        </div>

        {/* Success message */}
        {successMsg && (
          <div className="flex items-center gap-2 px-4 py-3 bg-green-50 border border-green-200 rounded-xl">
            <CheckCircle size={15} className="text-green-600 flex-shrink-0" />
            <p className="text-sm text-green-700">{successMsg}</p>
          </div>
        )}

        {/* TOTP Card */}
        <div className="bg-white border border-border rounded-xl p-6 flex flex-col gap-5">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Smartphone size={20} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-base font-700 text-foreground">App autenticadora</h2>
                {loading ? (
                  <Loader2 size={14} className="text-primary animate-spin" />
                ) : totpStatus?.isEnabled ? (
                  <span className="flex items-center gap-1 text-xs font-600 px-2.5 py-1 rounded-full bg-green-100 text-green-700 border border-green-200">
                    <ShieldCheck size={11} />
                    Activa
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs font-600 px-2.5 py-1 rounded-full bg-gray-100 text-gray-500 border border-gray-200">
                    <ShieldOff size={11} />
                    No configurada
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Usa una app como Google Authenticator o Microsoft Authenticator para generar códigos de acceso seguros.
              </p>

              {totpStatus?.isEnabled && (
                <div className="flex flex-col gap-1 mt-3">
                  {totpStatus.confirmedAt && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <CheckCircle size={11} className="text-green-500" />
                      Activada el {formatDate(totpStatus.confirmedAt)}
                    </p>
                  )}
                  {totpStatus.lastUsedAt && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock size={11} />
                      Último uso: {formatDate(totpStatus.lastUsedAt)}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-3">
            {!totpStatus?.isEnabled ? (
              <button
                onClick={() => setShowSetupModal(true)}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-600 hover:bg-primary/90 transition-colors disabled:opacity-60"
              >
                <Smartphone size={15} />
                Configurar app autenticadora
              </button>
            ) : (
              <button
                onClick={() => { setShowDisableModal(true); setDisableCode(''); setDisableError(null); }}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2.5 border border-red-200 text-red-600 rounded-xl text-sm font-600 hover:bg-red-50 transition-colors disabled:opacity-60"
              >
                <ShieldOff size={15} />
                Desactivar
              </button>
            )}
          </div>
        </div>

        {/* Security Events */}
        <div className="bg-white border border-border rounded-xl p-6 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Activity size={16} className="text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-700 text-foreground">Eventos de seguridad</h2>
              <p className="text-xs text-muted-foreground">Historial de actividad de autenticación</p>
            </div>
          </div>
          <SecurityEventList />
        </div>
      </div>

      {/* Setup Modal */}
      {showSetupModal && (
        <TotpSetupModal
          onClose={() => setShowSetupModal(false)}
          onSuccess={async () => {
            setShowSetupModal(false);
            setSuccessMsg('App autenticadora activada correctamente.');
            await loadTotpStatus();
            setTimeout(() => setSuccessMsg(null), 4000);
          }}
        />
      )}

      {/* Disable Modal */}
      {showDisableModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-5">
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-3">
                <ShieldOff size={22} className="text-red-600" />
              </div>
              <h3 className="text-base font-700 text-foreground mb-1">Desactivar app autenticadora</h3>
              <p className="text-sm text-muted-foreground">
                Ingresa el código de 6 dígitos de tu app autenticadora para confirmar la desactivación.
              </p>
            </div>

            <TotpCodeInput
              value={disableCode}
              onChange={setDisableCode}
              error={!!disableError}
              loading={disableLoading}
              autoFocus
            />

            {disableError && (
              <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl">
                <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-700">{disableError}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setShowDisableModal(false)}
                disabled={disableLoading}
                className="flex-1 py-2.5 border border-border rounded-xl text-sm font-600 text-foreground hover:bg-gray-50 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleDisable}
                disabled={disableLoading || disableCode.length !== 6}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-red-600 text-white rounded-xl text-sm font-700 hover:bg-red-700 disabled:opacity-60 transition-all"
              >
                {disableLoading ? <Loader2 size={15} className="animate-spin" /> : <ShieldOff size={15} />}
                Desactivar
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
