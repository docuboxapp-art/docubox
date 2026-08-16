'use client';

import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Clock3, Download, Loader2, ShieldAlert, UsersRound } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useCollaboration } from '@/contexts/CollaborationContext';
import { useCollaborationApi } from '@/lib/collaboration/client';
import { createClient } from '@/lib/supabase/client';
import { hasCollaborationEntitlement } from '@/lib/collaboration/domain';

type ReportRow = { metric: string; value: number };

const icons = [BarChart3, Clock3, ShieldAlert, UsersRound];

export default function CollaborationReportsPage() {
  const { activeWorkspace } = useWorkspace();
  const { access, can } = useCollaboration();
  const api = useCollaborationApi();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [generatedAt, setGeneratedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const advancedAvailable = hasCollaborationEntitlement(access, 'collaboration_analytics', {
    proFeature: true,
    minimumLevel: 'advanced',
  });

  useEffect(() => {
    if (!activeWorkspace?.id) return;
    setLoading(true);
    api<{ data: { rows: ReportRow[]; generated_at: string } }>(
      `/api/colabora/reports?workspace_id=${activeWorkspace.id}&scope=${advancedAvailable ? 'advanced' : 'basic'}`
    )
      .then((payload) => {
        setRows(payload.data.rows);
        setGeneratedAt(payload.data.generated_at);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'No se pudo generar.'))
      .finally(() => setLoading(false));
  }, [activeWorkspace?.id, advancedAvailable, api]);

  const exportCsv = async () => {
    if (!activeWorkspace?.id) return;
    setExporting(true);
    setError('');
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session?.access_token) throw new Error('Tu sesion ha expirado.');
      const response = await fetch(
        `/api/colabora/reports?workspace_id=${activeWorkspace.id}&format=csv&scope=${advancedAvailable ? 'advanced' : 'basic'}`,
        {
          headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
          cache: 'no-store',
        }
      );
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || 'No se pudo exportar.');
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `docubox-colabora-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo exportar.');
    } finally {
      setExporting(false);
    }
  };

  if (loading)
    return (
      <div className="min-h-96 grid place-items-center">
        <Loader2 className="animate-spin text-primary" />
      </div>
    );
  const max = Math.max(1, ...rows.map((item) => item.value));
  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-medium">Reportes colaborativos</h2>
            <span className="rounded border border-border bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
              {advancedAvailable ? 'ANALÍTICA PRO' : 'REPORTE BÁSICO'}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Indicadores agregados calculados dentro del alcance de tu organizacion.
          </p>
        </div>
        {can('reports.export', true) && (
          <button
            disabled={exporting}
            onClick={exportCsv}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-background px-4 text-sm disabled:opacity-60"
          >
            {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            Exportar CSV
          </button>
        )}
      </div>
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      <section className="grid overflow-hidden rounded-lg border border-border bg-background sm:grid-cols-2 xl:grid-cols-4 sm:divide-x divide-border">
        {rows.slice(0, 4).map((item, index) => {
          const Icon = icons[index] || BarChart3;
          return (
            <div
              key={item.metric}
              className={`p-5 ${index > 1 ? 'border-t border-border xl:border-t-0' : index > 0 ? 'border-t border-border sm:border-t-0' : ''}`}
            >
              <Icon size={18} className="text-primary" />
              <p className="mt-3 text-2xl font-medium tabular-nums">{item.value}</p>
              <p className="mt-1 text-sm text-muted-foreground">{item.metric}</p>
            </div>
          );
        })}
      </section>
      {!advancedAvailable && (
        <section className="rounded-lg border border-border bg-background p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-medium">Analítica avanzada y SLA</h3>
                <span className="rounded border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">PRO</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">Función no disponible en el plan actual. Contacta a tu administrador.</p>
            </div>
            {(access.canManageSubscription || access.membershipRole === 'owner' || access.permissions.includes('subscription.manage_addons')) && (
              <a href="/app-market" className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-white">Actualizar a Pro</a>
            )}
          </div>
        </section>
      )}
      <section className="overflow-hidden rounded-lg border border-border bg-background">
        <div className="border-b border-border px-5 py-4">
          <h3 className="font-medium">Carga operativa</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Ultimo calculo{' '}
            {generatedAt ? new Date(generatedAt).toLocaleString('es-MX') : 'no disponible'}.
          </p>
        </div>
        <div className="space-y-5 p-5">
          {rows.map((item) => (
            <div key={item.metric}>
              <div className="mb-2 flex justify-between text-sm">
                <span>{item.metric}</span>
                <span className="tabular-nums text-muted-foreground">{item.value}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.max(item.value ? 8 : 0, (item.value / max) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>
      <p className="text-xs text-muted-foreground">
        La exportacion queda registrada en auditoria y no amplia los permisos del usuario.
      </p>
    </div>
  );
}
