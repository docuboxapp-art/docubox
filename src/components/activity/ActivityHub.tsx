'use client';
import { Suspense, type ComponentType } from 'react';
import { useSearchParams } from 'next/navigation';
import AppLayout from '@/components/AppLayout';
import type { ActivityMode } from '@/lib/activity/model';
import ActivityResourcePanel from './ActivityResourcePanel';
import ActivityTypeTabs from './ActivityTypeTabs';

export function ActivityLoading({ mode }: { mode: ActivityMode }) {
  return (
    <AppLayout noPadding>
      <div className="app-page-bleed app-page-frame bg-[#f6f8fb] dark:bg-background">
        <div className="app-page-width">
          <header className="mb-4 border-b border-slate-200/80 pb-4">
            <h1 className="text-2xl font-600 leading-tight text-slate-950">
              {mode === 'sent' ? 'Solicitudes enviadas' : 'Mis participaciones'}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {mode === 'sent'
                ? 'Monitorea los documentos, formularios y expedientes que has enviado.'
                : 'Consulta y atiende tus documentos, formularios y expedientes.'}
            </p>
          </header>
          <ActivityTypeTabs mode={mode} active="documentos" />
          <div
            role="status"
            className="flex min-h-64 items-center justify-center gap-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-500"
          >
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            Cargando documentos…
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

function Hub({ mode, documents: Documents }: { mode: ActivityMode; documents: ComponentType }) {
  const type = useSearchParams().get('tipo');
  return type === 'formularios' || type === 'expedientes' ? (
    <ActivityResourcePanel key={`${mode}:${type}`} mode={mode} kind={type} />
  ) : (
    <Documents />
  );
}
export default function ActivityHub(props: { mode: ActivityMode; documents: ComponentType }) {
  return (
    <Suspense fallback={<ActivityLoading mode={props.mode} />}>
      <Hub {...props} />
    </Suspense>
  );
}
