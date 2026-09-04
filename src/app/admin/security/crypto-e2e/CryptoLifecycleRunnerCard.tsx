'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  PlayCircle,
  ShieldCheck,
  XCircle,
} from 'lucide-react';

type RunnerResult = {
  status?: string;
  code?: string;
  runId?: string;
  startedAt?: string;
  completedAt?: string;
  document?: { finalEncrypted?: boolean };
  pades?: { status?: string };
  nom151?: { status?: string; productionTrusted?: boolean };
  constancias?: Array<unknown>;
  failClosed?: boolean;
  failureCode?: string;
};

type RowState = 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_RUN';
type Row = { label: string; state: RowState; detail?: string };

const RESULT_LABELS = [
  'DOCUMENT ENCRYPTION BASE',
  'PADES PRODUCTION E2E',
  'TSA RFC3161 PRODUCTION E2E',
  'NOM151 CRYPTOGRAPHIC VALID',
  'NOM151 PRODUCTION_TRUSTED',
  'CONSTANCIAS E2E',
  'FULL CRYPTOGRAPHIC LIFECYCLE',
  'FAIL-CLOSED',
] as const;

function rows(result: RunnerResult): Row[] {
  const lifecycleStarted = Boolean(result.runId || result.startedAt || result.status);
  if (!lifecycleStarted) {
    return RESULT_LABELS.map((label) => ({ label, state: 'NOT_RUN' }));
  }

  const pass = result.status === 'PRODUCTION_VERIFIED';
  return [
    { label: 'DOCUMENT ENCRYPTION BASE', state: result.document?.finalEncrypted ? 'PASS' : 'FAIL' },
    { label: 'PADES PRODUCTION E2E', state: result.pades?.status === 'verified' ? 'PASS' : 'FAIL' },
    {
      label: 'TSA RFC3161 PRODUCTION E2E',
      state: result.pades?.status === 'verified' ? 'PASS' : 'FAIL',
    },
    {
      label: 'NOM151 CRYPTOGRAPHIC VALID',
      state: result.nom151?.status === 'verified' ? 'PASS' : 'FAIL',
    },
    {
      label: 'NOM151 PRODUCTION_TRUSTED',
      state: result.nom151?.productionTrusted ? 'PASS' : 'BLOCKED',
    },
    { label: 'CONSTANCIAS E2E', state: result.constancias?.length ? 'PASS' : 'FAIL' },
    { label: 'FULL CRYPTOGRAPHIC LIFECYCLE', state: pass ? 'PASS' : 'FAIL' },
    { label: 'FAIL-CLOSED', state: result.failClosed ? 'PASS' : 'FAIL' },
  ];
}

function StatusIcon({ state }: { state: Row['state'] }) {
  if (state === 'PASS')
    return <CheckCircle2 size={17} className="text-emerald-600" aria-hidden="true" />;
  if (state === 'BLOCKED')
    return <Clock3 size={17} className="text-amber-500" aria-hidden="true" />;
  if (state === 'NOT_RUN')
    return <Clock3 size={17} className="text-muted-foreground" aria-hidden="true" />;
  return <XCircle size={17} className="text-red-600" aria-hidden="true" />;
}

function resultSummary(result: RunnerResult) {
  if (result.status === 'PRODUCTION_VERIFIED') {
    return { label: 'PASS', className: 'bg-emerald-50 text-emerald-700' };
  }
  if (!result.runId && !result.startedAt && !result.status) {
    return { label: 'NOT RUN', className: 'bg-slate-100 text-slate-600' };
  }
  return { label: 'FAIL', className: 'bg-red-50 text-red-700' };
}

export default function CryptoLifecycleRunnerCard() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunnerResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function execute() {
    if (running) return;
    const confirmed = window.confirm(
      'Se generará exclusivamente un documento técnico artificial y se utilizarán los proveedores criptográficos configurados en producción.'
    );
    if (!confirmed) return;
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const response = await fetch('/api/internal/security/crypto-lifecycle-e2e', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        cache: 'no-store',
      });
      const payload = (await response.json()) as RunnerResult;
      if (!response.ok) {
        setResult(payload);
        setError(
          payload.failureCode ||
            payload.code ||
            (response.status === 403 ? 'OPERATOR_NOT_AUTHORIZED' : 'E2E_RUN_FAILED')
        );
        return;
      }
      setResult(payload);
    } catch {
      setError('E2E_RUN_UNAVAILABLE');
    } finally {
      setRunning(false);
    }
  }

  const resultRows = result ? rows(result) : [];
  const summary = result ? resultSummary(result) : null;

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-background shadow-sm">
      <div className="flex items-start gap-4 border-b border-border p-5 sm:p-6">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
          <ShieldCheck size={23} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-medium text-foreground">Runner de ciclo criptográfico</h2>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Runner habilitado
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Ejecuta una prueba productiva controlada de PAdES, TSA, NOM-151 y constancias utilizando
            un documento artificial.
          </p>
        </div>
      </div>

      <div className="space-y-4 p-5 sm:p-6">
        <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-900">
          La ejecución ocurre exclusivamente en backend. No se envían proveedores, llaves, archivos
          ni credenciales desde esta pantalla.
        </div>
        <button
          type="button"
          onClick={execute}
          disabled={running}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {running ? (
            <Loader2 size={17} className="animate-spin" aria-hidden="true" />
          ) : (
            <PlayCircle size={17} aria-hidden="true" />
          )}
          {running ? 'Ejecutando...' : 'Ejecutar validación E2E'}
        </button>

        {error && (
          <div
            className="flex items-start gap-3 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800"
            role="alert"
          >
            <AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>La ejecución no se completó: {error}</span>
          </div>
        )}

        {result && (
          <div className="border-t border-border pt-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium text-foreground">Resultado sanitizado</h3>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${summary?.className}`}
              >
                {summary?.label}
              </span>
            </div>
            <div className="divide-y divide-border rounded-md border border-border">
              {resultRows.map((item) => (
                <div key={item.label} className="flex items-center gap-3 px-4 py-3">
                  <StatusIcon state={item.state} />
                  <span className="flex-1 text-sm text-foreground">{item.label}</span>
                  <span
                    className={`text-xs font-medium ${item.state === 'PASS' ? 'text-emerald-700' : item.state === 'BLOCKED' ? 'text-amber-700' : item.state === 'NOT_RUN' ? 'text-muted-foreground' : 'text-red-700'}`}
                  >
                    {item.state}
                  </span>
                </div>
              ))}
            </div>
            <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">RUN ID</dt>
                <dd className="mt-1 break-all font-mono text-foreground">
                  {result.runId || 'No disponible'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">TIMESTAMP</dt>
                <dd className="mt-1 text-foreground">
                  {result.completedAt || result.startedAt || 'No disponible'}
                </dd>
              </div>
            </dl>
          </div>
        )}
      </div>
    </section>
  );
}
