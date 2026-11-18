'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import CaseBrowser from '../components/CaseBrowser';

function Content() {
  const params = useSearchParams();
  const { activeWorkspace } = useWorkspace();
  return <CaseBrowser key={`${activeWorkspace?.id}:${params.toString()}`} mode="completed" />;
}
export default function CompletedCasesPage() {
  return (
    <Suspense fallback={<p className="p-8 text-sm text-slate-500">Cargando expedientes…</p>}>
      <Content />
    </Suspense>
  );
}
