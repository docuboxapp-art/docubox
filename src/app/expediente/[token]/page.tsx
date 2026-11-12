import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Info, ShieldCheck } from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';
import { createServiceClient } from '@/lib/supabase/server';
import { hashInvitationToken } from '@/lib/case-files/invitations';
import type { CasePortal } from '@/lib/case-files/portal';
import ParticipantWorkspace from './ParticipantWorkspace';
import CaseEntryGate from './CaseEntryGate';
import { getCaseEntryState } from '@/lib/case-files/entry.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata: Metadata = {
  title: 'Invitación a expediente · Docubox',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default async function ExpedienteInvitacionPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!/^[a-f0-9]{64}$/.test(token)) notFound();
  let entry;
  try {
    entry = await getCaseEntryState(hashInvitationToken(token));
  } catch (cause) {
    const message =
      cause instanceof Error
        ? cause.message
        : String((cause as { message?: unknown })?.message || '');
    if (/\bCASE_(PORTAL_INVALID|PORTAL_SCOPE|INVITATION_NOT_ACTIVE)\b/.test(message)) notFound();
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <section role="alert" className="max-w-md rounded-lg border border-slate-200 bg-white p-6">
          <h1 className="text-lg font-semibold">No se pudo comprobar el acceso</h1>
          <p className="mt-2 text-sm text-slate-500">
            La conexión no está disponible en este momento. Tu invitación se conserva.
          </p>
          <a
            href={`/expediente/${token}`}
            className="mt-5 inline-flex rounded-lg bg-primary px-4 py-2 text-sm text-white"
          >
            Volver a intentar
          </a>
        </section>
      </main>
    );
  }
  if (entry && !entry.ready) return <CaseEntryGate token={token} initial={entry} />;
  if (!entry) notFound();
  const response = await createServiceClient().rpc('case_invitation_portal', {
    p_hash: hashInvitationToken(token),
  });
  if (response.error)
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <section role="alert" className="max-w-md rounded-lg border border-slate-200 bg-white p-6">
          <h1 className="text-lg font-semibold">No se pudo consultar el expediente</h1>
          <p className="mt-2 text-sm text-slate-500">
            Vuelve a cargar esta página en unos momentos. Tu invitación se conserva.
          </p>
        </section>
      </main>
    );
  if (!response.data) notFound();
  const portal = response.data as CasePortal;
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white px-6 py-5">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <AppLogo />
          <span className="flex items-center gap-2 text-xs text-slate-500">
            <ShieldCheck size={15} />
            Portal de expediente · Enlace personal
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-5 px-4 py-8 sm:px-6">
        <ParticipantWorkspace key={token} token={token} initial={portal} />
        <section className="flex gap-3 rounded-lg border border-blue-100 bg-blue-50/60 p-4">
          <Info size={18} className="mt-0.5 shrink-0 text-primary" />
          <p className="text-sm leading-relaxed text-slate-600">
            Este enlace es personal y no debe compartirse. Entregar información no sustituye las
            verificaciones, revisiones o firmas del expediente.
          </p>
        </section>
        <p className="text-center text-xs text-slate-400">
          Invitación vigente hasta{' '}
          {new Date(portal.expiresAt).toLocaleString('es-MX', {
            timeZone: 'UTC',
            dateStyle: 'medium',
            timeStyle: 'short',
          })}{' '}
          UTC.
        </p>
      </main>
    </div>
  );
}
