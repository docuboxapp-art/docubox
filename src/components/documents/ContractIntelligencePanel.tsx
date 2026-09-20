'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, Edit3, Loader2, RefreshCw, Sparkles, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type Fact = {
  id: string;
  field_key: string;
  field_label: string | null;
  field_value: string | null;
  normalized_value: string | null;
  confidence: number | null;
  page_number: number | null;
  evidence_text: string | null;
  extraction_method: string | null;
};

type Obligation = {
  id: string;
  description: string;
  obligated_party: string | null;
  due_date: string | null;
  confidence: number | null;
  page_number: number | null;
};

type Review = {
  fact_id: string;
  review_status: 'reviewed' | 'confirmed' | 'rejected' | 'corrected';
  reviewed_value: unknown;
  reviewed_at: string;
};

type Summary = {
  contractual?: { fields?: Fact[]; obligations?: Obligation[]; latest_run?: { status?: string } | null };
  reviews?: Review[];
};

function confidenceLabel(value: number | null) {
  if (value === null || value === undefined) return 'Sin confianza';
  return `${Math.round(Number(value) * 100)}% confianza`;
}

export function ContractIntelligencePanel({ documentId, workspaceId }: { documentId: string; workspaceId: string }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{ fact: Fact; value: string } | null>(null);

  const request = useCallback(async (path: string, init?: Parameters<typeof fetch>[1]) => {
    const supabase = createClient();
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) throw new Error('La sesion expiro.');
    const response = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers || {}) },
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || payload.error || 'No se pudo completar la operacion.');
    return payload;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setSummary(
        await request(`/api/ai/document-intelligence/${documentId}?workspaceId=${encodeURIComponent(workspaceId)}`)
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar LucIA.');
    } finally {
      setLoading(false);
    }
  }, [documentId, request, workspaceId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const analyze = async () => {
    setAnalyzing(true);
    setError('');
    try {
      await request('/api/ai/document-intelligence/analyze', {
        method: 'POST',
        body: JSON.stringify({ workspaceId, documentId, analysisTypes: ['contractual'] }),
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo analizar el documento.');
    } finally {
      setAnalyzing(false);
    }
  };

  const review = async (
    fact: Fact | Obligation,
    factType: 'field' | 'obligation' | 'risk',
    reviewStatus: 'confirmed' | 'rejected' | 'corrected',
    reviewedValue?: unknown
  ) => {
    setError('');
    try {
      await request(`/api/ai/document-intelligence/${documentId}/review`, {
        method: 'POST',
        body: JSON.stringify({ workspaceId, factType, factId: fact.id, reviewStatus, reviewedValue }),
      });
      setEditing(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar la revision.');
    }
  };

  const latestReviews = useMemo(() => {
    const map = new Map<string, Review>();
    for (const item of summary?.reviews || []) if (!map.has(item.fact_id)) map.set(item.fact_id, item);
    return map;
  }, [summary?.reviews]);
  const facts = summary?.contractual?.fields || [];
  const risks = facts.filter((fact) => fact.field_key.startsWith('contract_risk_'));
  const regularFacts = facts.filter((fact) => !fact.field_key.startsWith('contract_risk_'));
  const obligations = summary?.contractual?.obligations || [];
  const hasAnalysis = Boolean(summary?.contractual?.latest_run);

  if (loading) {
    return <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" /> Cargando LucIA...</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="border-b border-border bg-white p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-blue-50 text-primary"><Sparkles size={17} /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Ficha contractual derivada</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Los datos provienen del documento y pueden requerir confirmacion. No modifican el PDF ni constituyen una opinion legal.</p>
          </div>
          <button onClick={() => void load()} className="grid h-9 w-9 place-items-center rounded-md border border-border" aria-label="Actualizar"><RefreshCw size={15} /></button>
        </div>
        <button onClick={analyze} disabled={analyzing} className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-white disabled:opacity-60">
          {analyzing ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          {hasAnalysis ? 'Actualizar analisis de esta version' : 'Analizar como contrato'}
        </button>
      </div>
      {error && <div className="m-4 flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700"><AlertTriangle size={15} className="shrink-0" />{error}</div>}
      {!hasAnalysis && !error ? (
        <div className="px-6 py-14 text-center text-sm text-muted-foreground">Aun no hay informacion contractual derivada para esta version.</div>
      ) : (
        <div className="divide-y divide-border bg-white">
          <Section title="Resumen" count={regularFacts.length}>
            {regularFacts.length ? regularFacts.map((fact) => {
              const reviewValue = latestReviews.get(fact.id);
              const value = reviewValue?.review_status === 'corrected' ? String(reviewValue.reviewed_value ?? '') : fact.field_value;
              return (
                <FactRow key={fact.id} title={fact.field_label || fact.field_key} value={value || 'No disponible'} detail={`${confidenceLabel(fact.confidence)}${fact.page_number ? ` · Pag. ${fact.page_number}` : ''}`} evidence={fact.evidence_text} status={reviewValue?.review_status} inferred={fact.extraction_method === 'llm_contractual_inference'} actions={
                  <ReviewActions onConfirm={() => void review(fact, 'field', 'confirmed')} onReject={() => void review(fact, 'field', 'rejected')} onEdit={() => setEditing({ fact, value: fact.normalized_value || fact.field_value || '' })} />
                } />
              );
            }) : <EmptyText text="No se detectaron hechos contractuales verificables." />}
          </Section>
          <Section title="Obligaciones" count={obligations.length}>
            {obligations.length ? obligations.map((item) => <FactRow key={item.id} title={item.obligated_party || 'Obligacion'} value={item.description} detail={`${confidenceLabel(item.confidence)}${item.due_date ? ` · Vence ${item.due_date}` : ''}`} status={latestReviews.get(item.id)?.review_status} actions={<ReviewActions onConfirm={() => void review(item, 'obligation', 'confirmed')} onReject={() => void review(item, 'obligation', 'rejected')} />} />) : <EmptyText text="No se detectaron obligaciones expresas." />}
          </Section>
          <Section title="Riesgos detectados" count={risks.length}>
            {risks.length ? risks.map((fact) => <FactRow key={fact.id} title={fact.field_label || 'Riesgo'} value={fact.field_value || ''} detail={`${fact.normalized_value || 'Sin severidad'} · ${confidenceLabel(fact.confidence)}`} evidence={fact.evidence_text} status={latestReviews.get(fact.id)?.review_status} inferred={fact.extraction_method === 'llm_contractual_inference'} actions={<ReviewActions onConfirm={() => void review(fact, 'risk', 'confirmed')} onReject={() => void review(fact, 'risk', 'rejected')} />} />) : <EmptyText text="No se detectaron riesgos con evidencia suficiente." />}
          </Section>
        </div>
      )}
      {editing && (
        <div className="sticky bottom-0 border-t border-border bg-white p-4 shadow-[0_-8px_20px_rgba(15,23,42,0.08)]">
          <label className="text-xs font-medium">Valor corregido
            <input autoFocus value={editing.value} onChange={(event) => setEditing({ ...editing, value: event.target.value })} className="mt-1.5 h-10 w-full rounded-md border border-border px-3 text-sm" />
          </label>
          <div className="mt-3 flex justify-end gap-2"><button onClick={() => setEditing(null)} className="h-9 rounded-md border border-border px-3 text-xs">Cancelar</button><button onClick={() => void review(editing.fact, 'field', 'corrected', editing.value)} className="h-9 rounded-md bg-primary px-3 text-xs font-medium text-white">Guardar correccion</button></div>
        </div>
      )}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return <section><div className="flex items-center justify-between bg-slate-50 px-4 py-2.5"><h3 className="text-xs font-medium text-slate-700">{title}</h3><span className="text-[11px] text-slate-500">{count}</span></div><div className="divide-y divide-slate-100">{children}</div></section>;
}

function EmptyText({ text }: { text: string }) { return <p className="px-4 py-6 text-center text-xs text-muted-foreground">{text}</p>; }

function FactRow({ title, value, detail, evidence, status, inferred, actions }: { title: string; value: string; detail: string; evidence?: string | null; status?: string; inferred?: boolean; actions: ReactNode }) {
  return <div className="px-4 py-3"><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-xs font-medium text-slate-800">{title}</p>{inferred && <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] text-amber-700">Inferencia</span>}{status && <span className="rounded border border-blue-100 bg-blue-50 px-1.5 py-0.5 text-[9px] text-blue-700">{status}</span>}</div><p className="mt-1 text-sm text-slate-700">{value}</p><p className="mt-1 text-[10px] text-slate-400">{detail}</p>{evidence && <p className="mt-2 border-l-2 border-slate-200 pl-2 text-[11px] leading-4 text-slate-500">{evidence}</p>}</div>{actions}</div></div>;
}

function ReviewActions({ onConfirm, onReject, onEdit }: { onConfirm: () => void; onReject: () => void; onEdit?: () => void }) {
  return <div className="flex shrink-0 gap-1"><button onClick={onConfirm} className="grid h-8 w-8 place-items-center rounded-md border border-border text-emerald-600 hover:bg-emerald-50" title="Confirmar"><Check size={14} /></button>{onEdit && <button onClick={onEdit} className="grid h-8 w-8 place-items-center rounded-md border border-border text-slate-500 hover:bg-slate-50" title="Corregir"><Edit3 size={14} /></button>}<button onClick={onReject} className="grid h-8 w-8 place-items-center rounded-md border border-border text-red-500 hover:bg-red-50" title="Rechazar"><X size={14} /></button></div>;
}
