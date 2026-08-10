'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Activity, Archive, ChevronRight, Copy, Fingerprint, MoreHorizontal, Plus,
  Search, ShieldCheck, Trash2, UsersRound,
} from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import { deleteIdentityPolicy, listIdentityPolicies, saveIdentityPolicy } from '@/lib/identity/storage';
import { clonePolicyConfig, type IdentityPolicyRecord } from '@/lib/identity/schema';

const statusStyle = {
  active: { label: 'Activa', className: 'border-emerald-200 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  draft: { label: 'Borrador', className: 'border-amber-200 bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
  archived: { label: 'Archivada', className: 'border-slate-200 bg-slate-50 text-slate-600', dot: 'bg-slate-400' },
};

const assuranceLabels = { basic: 'Basico', standard: 'Estandar', enhanced: 'Reforzado', custom: 'Personalizado' };
const typeLabels = { signature: 'Firma', kyc: 'KYC', kyb: 'KYB', enrollment: 'Enrolamiento', revalidation: 'Revalidacion' };

export default function IdentityPoliciesPage() {
  const router = useRouter();
  const { activeWorkspace } = useWorkspace();
  const { user } = useAuth();
  const [policies, setPolicies] = useState<IdentityPolicyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [menu, setMenu] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [localMode, setLocalMode] = useState(false);

  const load = async () => {
    if (!activeWorkspace?.id) return;
    setLoading(true);
    const result = await listIdentityPolicies(createClient(), activeWorkspace.id);
    setPolicies(result.policies);
    setLocalMode(!result.remote);
    setLoading(false);
  };

  useEffect(() => { load(); }, [activeWorkspace?.id]);

  const filtered = useMemo(() => policies.filter((policy) => {
    const text = `${policy.name} ${policy.description} ${policy.policyType}`.toLowerCase();
    return text.includes(query.toLowerCase()) && (status === 'all' || policy.status === status);
  }), [policies, query, status]);

  const metrics = useMemo(() => ({
    active: policies.filter((item) => item.status === 'active').length,
    enhanced: policies.filter((item) => item.assuranceLevel === 'enhanced').length,
    reusable: policies.filter((item) => item.config.reuseMode !== 'never').length,
    manual: policies.filter((item) => item.config.manualReview !== 'never').length,
  }), [policies]);

  const duplicate = async (policy: IdentityPolicyRecord) => {
    if (!activeWorkspace?.id || !user?.id) return;
    const config = clonePolicyConfig(policy.config);
    config.name = `${policy.name} (copia)`;
    await saveIdentityPolicy(createClient(), activeWorkspace.id, user.id, config, { status: 'draft' });
    setNotice('Politica duplicada como borrador.');
    setMenu(null);
    load();
  };

  const archive = async (policy: IdentityPolicyRecord) => {
    if (!activeWorkspace?.id || !user?.id) return;
    await saveIdentityPolicy(createClient(), activeWorkspace.id, user.id, policy.config, { id: policy.id, status: 'archived' });
    setNotice('Politica archivada.');
    setMenu(null);
    load();
  };

  const remove = async (policy: IdentityPolicyRecord) => {
    if (!activeWorkspace?.id || !window.confirm(`Eliminar la politica "${policy.name}"?`)) return;
    await deleteIdentityPolicy(createClient(), activeWorkspace.id, policy.id);
    setPolicies((current) => current.filter((item) => item.id !== policy.id));
    setMenu(null);
  };

  return (
    <AppLayout noPadding>
      <div className="-mx-4 -my-4 min-h-[calc(100vh-4rem)] bg-[#f6f8fb] px-4 py-4 dark:bg-background sm:px-5 md:-my-6 md:py-5 lg:px-6">
        <div className="mx-auto w-full max-w-[1560px]">
          <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 dark:border-border sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-2xl font-600 text-slate-950 dark:text-foreground">Verificacion de identidad</h1>
              <p className="mt-1 max-w-3xl text-sm text-slate-500 dark:text-muted-foreground">
                Define politicas reutilizables de identidad, prueba de vida y evidencia antes de permitir una firma.
              </p>
            </div>
            <Link href="/configuracion/verificacion-identidad/nueva" className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-600 text-white shadow-sm transition hover:bg-primary/90">
              <Plus size={16} /> Nueva politica
            </Link>
          </header>

          {notice && <div className="mt-4 flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Cerrar aviso">Cerrar</button></div>}
          {localMode && <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-700">Las politicas se conservan localmente hasta aplicar la migracion de identidad en Supabase.</div>}

          <section className="mt-5 overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-border dark:bg-card">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-border">
              <div><h2 className="text-sm font-600">Panorama del espacio</h2><p className="mt-0.5 text-xs text-slate-500">Cobertura y nivel de control de las politicas actuales.</p></div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-600 text-slate-600">{policies.length} politicas</span>
            </div>
            <div className="grid grid-cols-2 divide-x divide-y divide-slate-200 dark:divide-border lg:grid-cols-4 lg:divide-y-0">
              <Metric icon={ShieldCheck} label="Activas" value={metrics.active} tone="blue" />
              <Metric icon={Fingerprint} label="Nivel reforzado" value={metrics.enhanced} tone="emerald" />
              <Metric icon={UsersRound} label="Reutilizan enrolamiento" value={metrics.reusable} tone="violet" />
              <Metric icon={Activity} label="Revision por excepcion" value={metrics.manual} tone="amber" />
            </div>
          </section>

          <section className="mt-5 overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-border dark:bg-card">
            <div className="flex flex-col gap-3 border-b border-slate-200 p-4 dark:border-border md:flex-row md:items-center md:justify-between">
              <div><h2 className="text-sm font-600">Politicas de verificacion</h2><p className="mt-0.5 text-xs text-slate-500">Cada version publicada conserva sus reglas de manera inmutable.</p></div>
              <div className="flex gap-2">
                <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 md:w-64"><Search size={15} className="text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar politica" className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></label>
                <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none">
                  <option value="all">Todos los estados</option><option value="active">Activas</option><option value="draft">Borradores</option><option value="archived">Archivadas</option>
                </select>
              </div>
            </div>

            {loading ? <div className="grid gap-3 p-4 lg:grid-cols-2"><Skeleton /><Skeleton /></div> : filtered.length === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center p-8 text-center"><ShieldCheck size={30} className="text-primary" /><h3 className="mt-3 text-sm font-600">No encontramos politicas</h3><p className="mt-1 text-sm text-slate-500">Ajusta los filtros o crea una nueva politica verificable.</p></div>
            ) : (
              <div className="grid gap-3 p-4 lg:grid-cols-2 2xl:grid-cols-3">
                {filtered.map((policy) => {
                  const style = statusStyle[policy.status];
                  return <article key={policy.id} className="relative overflow-visible rounded-lg border border-slate-200 bg-white transition hover:border-blue-200 hover:shadow-sm dark:border-border dark:bg-card">
                    <div className="flex items-start justify-between border-b border-slate-100 p-4 dark:border-border">
                      <div className="flex min-w-0 items-start gap-3"><span className="flex h-10 w-10 flex-none items-center justify-center rounded-md border border-blue-100 bg-blue-50 text-primary"><Fingerprint size={19} /></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-sm font-600 text-slate-950 dark:text-foreground">{policy.name}</h3><span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-600 ${style.className}`}><span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />{style.label}</span></div><p className="mt-1 text-xs text-slate-500">Version {policy.version} · {typeLabels[policy.policyType]}</p></div></div>
                      <button onClick={() => setMenu(menu === policy.id ? null : policy.id)} aria-label="Mas acciones" className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-50"><MoreHorizontal size={17} /></button>
                      {menu === policy.id && <div className="absolute right-3 top-12 z-20 w-44 rounded-md border border-slate-200 bg-white p-1 shadow-lg"><button onClick={() => duplicate(policy)} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs hover:bg-slate-50"><Copy size={13} /> Duplicar</button><button onClick={() => archive(policy)} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs hover:bg-slate-50"><Archive size={13} /> Archivar</button><button onClick={() => remove(policy)} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50"><Trash2 size={13} /> Eliminar</button></div>}
                    </div>
                    <div className="p-4"><p className="min-h-10 text-sm leading-5 text-slate-500">{policy.description || 'Sin descripcion.'}</p><div className="mt-4 grid grid-cols-3 divide-x divide-slate-200 rounded-md border border-slate-200"><SmallMetric value={assuranceLabels[policy.assuranceLevel]} label="nivel" /><SmallMetric value={policy.config.documents.length} label="documentos" /><SmallMetric value={policy.config.livenessMode === 'hybrid' ? 'Hibrida' : policy.config.livenessMode === 'passive' ? 'Pasiva' : policy.config.livenessMode === 'active' ? 'Activa' : 'Asistida'} label="prueba de vida" /></div></div>
                    <footer className="flex items-center justify-between border-t border-slate-100 px-4 py-3 dark:border-border"><span className="text-[11px] text-slate-400">Actualizada {new Date(policy.updatedAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}</span><button onClick={() => router.push(`/configuracion/verificacion-identidad/${policy.id}`)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 px-3 text-xs font-600 text-slate-700 hover:bg-slate-50">Configurar <ChevronRight size={13} /></button></footer>
                  </article>;
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </AppLayout>
  );
}

function Metric({ icon: Icon, label, value, tone }: { icon: typeof ShieldCheck; label: string; value: number; tone: 'blue' | 'emerald' | 'violet' | 'amber' }) {
  const tones = { blue: 'bg-blue-50 text-blue-600', emerald: 'bg-emerald-50 text-emerald-600', violet: 'bg-violet-50 text-violet-600', amber: 'bg-amber-50 text-amber-600' };
  return <div className="flex min-h-24 items-center gap-3 p-4"><span className={`flex h-9 w-9 items-center justify-center rounded-md ${tones[tone]}`}><Icon size={17} /></span><div><p className="text-xl font-600 tabular-nums">{value}</p><p className="text-xs text-slate-500">{label}</p></div></div>;
}
function SmallMetric({ value, label }: { value: string | number; label: string }) { return <div className="min-w-0 px-2 py-2.5 text-center"><p className="truncate text-xs font-600 text-slate-800 dark:text-foreground">{value}</p><p className="mt-0.5 truncate text-[10px] text-slate-400">{label}</p></div>; }
function Skeleton() { return <div className="h-64 animate-pulse rounded-lg border border-slate-200 bg-slate-50" />; }
