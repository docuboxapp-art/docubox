'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  BadgeCheck,
  CalendarDays,
  CircleDollarSign,
  Copy,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  Fingerprint,
  History,
  Landmark,
  Link2,
  PenLine,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { createClient } from '@/lib/supabase/client';
import {
  DEMO_PROMISSORY_NOTES,
  formatMoney,
  mapPromissoryNoteRow,
  type PromissoryNoteSummary,
} from '@/lib/credit-titles/schema';
import { CreditTitlesWorkspace, PromissoryNoteStatusBadge } from '../../components/CreditTitlesUI';

type Detail = PromissoryNoteSummary & {
  raw?: any;
  events: Array<{ eventType: string; label: string; occurredAt: string; eventHash?: string }>;
  localError?: string;
};

export default function PromissoryNoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('summary');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (id.startsWith('local-')) {
        const local = readLocalDetail(id);
        if (!cancelled) {
          setDetail(local);
          setLoading(false);
        }
        return;
      }
      const {
        data: { session },
      } = await createClient().auth.getSession();
      if (session) {
        const response = await fetch(`/api/credit-titles/${id}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (response.ok) {
          const result = await response.json();
          if (!cancelled) {
            setDetail(mapDetail(result.data));
            setLoading(false);
          }
          return;
        }
      }
      const demo = DEMO_PROMISSORY_NOTES.find((item) => item.id === id) || DEMO_PROMISSORY_NOTES[0];
      if (!cancelled) {
        setDetail(demoDetail(demo));
        setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const parties = useMemo(() => detail?.raw?.title_parties || [], [detail]);
  if (loading)
    return (
      <AppLayout noPadding>
        <CreditTitlesWorkspace>
          <div className="flex min-h-[60vh] items-center justify-center">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
          </div>
        </CreditTitlesWorkspace>
      </AppLayout>
    );
  if (!detail)
    return (
      <AppLayout noPadding>
        <CreditTitlesWorkspace>
          <div className="rounded-lg border border-slate-200 bg-white p-10 text-center">
            <p className="text-sm font-600">No se encontro el pagare.</p>
          </div>
        </CreditTitlesWorkspace>
      </AppLayout>
    );

  return (
    <AppLayout noPadding>
      <CreditTitlesWorkspace>
        <header className="mb-5 border-b border-slate-200 pb-5 dark:border-border">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <button
                onClick={() => router.push('/credit-titles/promissory-notes')}
                aria-label="Regresar"
                className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-border dark:bg-card"
              >
                <ArrowLeft size={17} />
              </button>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-2xl font-600">{detail.folio}</h1>
                  <PromissoryNoteStatusBadge status={detail.status} />
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  Pagare electronico · UUID {detail.raw?.internal_uuid || detail.id}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => navigator.clipboard.writeText(detail.folio)}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-600 text-slate-600 dark:border-border dark:bg-card"
              >
                <Copy size={15} /> Copiar folio
              </button>
              {detail.publicToken && (
                <button
                  onClick={() =>
                    window.open(`/verify/promissory-note/${detail.publicToken}`, '_blank')
                  }
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-600 text-slate-600 dark:border-border dark:bg-card"
                >
                  <ExternalLink size={15} /> Verificar
                </button>
              )}
              <button
                disabled={
                  !['issued', 'active', 'partially_paid', 'overdue', 'paid', 'cancelled'].includes(
                    detail.status
                  )
                }
                className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-600 text-white disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Download size={15} /> Descargar
              </button>
            </div>
          </div>
        </header>

        {detail.localError && (
          <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
            Borrador local: la migracion del modulo aun no esta aplicada en Supabase. El trabajo se
            conservo en este navegador.
          </div>
        )}

        <section className="grid overflow-hidden rounded-lg border border-slate-200 bg-white sm:grid-cols-2 xl:grid-cols-4 dark:border-border dark:bg-card">
          <SummaryMetric
            icon={CircleDollarSign}
            label="Valor nominal"
            value={formatMoney(detail.amount, detail.currency)}
          />
          <SummaryMetric
            icon={Landmark}
            label="Saldo actual"
            value={formatMoney(detail.balance, detail.currency)}
          />
          <SummaryMetric
            icon={CalendarDays}
            label="Emision"
            value={detail.issuedAt ? formatDate(detail.issuedAt) : 'Pendiente'}
          />
          <SummaryMetric
            icon={CalendarDays}
            label="Vencimiento"
            value={formatDate(detail.maturityDate)}
          />
        </section>

        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-border dark:bg-card">
          <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 px-3 dark:border-border">
            {[
              ['summary', 'Resumen'],
              ['document', 'Documento'],
              ['parties', 'Participantes'],
              ['evidence', 'Evidencias'],
              ['history', 'Historial'],
            ].map(([value, label]) => (
              <button
                key={value}
                onClick={() => setTab(value)}
                className={`relative h-11 shrink-0 px-3 text-sm after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 ${tab === value ? 'font-600 text-primary after:bg-primary' : 'text-slate-500 after:bg-transparent'}`}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="p-4 md:p-5">
            {tab === 'summary' && <SummaryTab detail={detail} parties={parties} />}
            {tab === 'document' && <DocumentTab detail={detail} />}
            {tab === 'parties' && <PartiesTab detail={detail} parties={parties} />}
            {tab === 'evidence' && <EvidenceTab detail={detail} />}
            {tab === 'history' && <HistoryTab detail={detail} />}
          </div>
        </div>
      </CreditTitlesWorkspace>
    </AppLayout>
  );
}

function SummaryTab({ detail, parties }: { detail: Detail; parties: any[] }) {
  const subscriber = parties.find((item) => item.role === 'subscriber');
  const beneficiary = parties.find((item) => item.role === 'beneficiary');
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
      <div className="space-y-5">
        <Section title="Partes y tenencia" icon={UserRound}>
          <dl className="grid gap-4 md:grid-cols-3">
            <Definition
              label="Suscriptor"
              value={subscriber?.display_name || detail.subscriberName}
            />
            <Definition
              label="Beneficiario original"
              value={beneficiary?.display_name || detail.beneficiaryName}
            />
            <Definition label="Tenedor actual" value={detail.currentHolderName} />
          </dl>
        </Section>
        <Section title="Condiciones esenciales" icon={FileCheck2}>
          <dl className="grid gap-4 md:grid-cols-3">
            <Definition
              label="Tipo"
              value={detail.raw?.promissory_notes?.note_kind || detail.kind}
            />
            <Definition
              label="Lugar de pago"
              value={detail.raw?.promissory_notes?.payment_place || 'Segun instrumento'}
            />
            <Definition
              label="Intereses"
              value={detail.raw?.promissory_notes?.interest_mode || 'Sin intereses'}
            />
            <Definition
              label="Fecha de suscripcion"
              value={detail.raw?.promissory_notes?.issue_date || 'Pendiente'}
            />
            <Definition label="Vencimiento" value={detail.maturityDate} />
            <Definition label="Version" value={String(detail.raw?.version || 1)} />
          </dl>
        </Section>
      </div>
      <aside className="space-y-4">
        <div className="rounded-lg border border-slate-200 p-4 dark:border-border">
          <div className="flex items-center gap-2">
            <ShieldCheck size={17} className="text-emerald-600" />
            <h2 className="text-sm font-600">Control del registro</h2>
          </div>
          <div className="mt-4 space-y-3">
            <Control label="Identidad del titulo" ok={Boolean(detail.id)} />
            <Control label="Tenencia registrada" ok={Boolean(detail.currentHolderName)} />
            <Control label="Cadena canonica" ok={Boolean(detail.canonicalHash)} />
            <Control label="Representacion PDF" ok={Boolean(detail.raw?.document_hash)} />
          </div>
        </div>
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-900 dark:bg-indigo-950/20">
          <p className="text-sm font-600 text-indigo-950 dark:text-indigo-200">
            Siguiente actuacion
          </p>
          <p className="mt-1 text-xs leading-5 text-indigo-800 dark:text-indigo-300">
            {detail.status === 'draft'
              ? 'Completa la preparacion y solicita las firmas obligatorias.'
              : detail.status === 'awaiting_signature'
                ? 'Espera o gestiona las firmas pendientes desde el motor documental.'
                : 'Consulta evidencias, pagos y vigencia antes de realizar una operacion.'}
          </p>
        </div>
      </aside>
    </div>
  );
}
function DocumentTab({ detail }: { detail: Detail }) {
  const ready = Boolean(detail.raw?.document_hash || detail.canonicalHash);
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-h-[420px] items-center justify-center rounded-md border border-slate-200 bg-[#f3f4f6] p-8 dark:border-border dark:bg-muted/30">
        <div className="w-full max-w-2xl rounded-sm bg-white p-8 shadow-sm">
          <p className="text-center text-xl font-700 tracking-[0.12em]">PAGARE</p>
          <p className="mt-2 text-center text-xs text-slate-500">
            Representacion del registro electronico {detail.folio}
          </p>
          <div className="mt-8 border-y border-slate-200 py-6 text-sm leading-7 text-slate-700">
            Debo y pagare incondicionalmente a la orden de <strong>{detail.beneficiaryName}</strong>{' '}
            la cantidad de <strong>{formatMoney(detail.amount, detail.currency)}</strong>, con
            vencimiento el <strong>{formatDate(detail.maturityDate)}</strong>, conforme a las
            condiciones registradas en Docubox.
          </div>
          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            <div>
              <p className="text-xs text-slate-400">SUSCRIPTOR</p>
              <p className="mt-2 border-t border-slate-400 pt-2 text-sm font-600">
                {detail.subscriberName}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400">VERIFICACION</p>
              <p className="mt-2 break-all text-[10px] text-slate-500">
                SHA-256 {detail.canonicalHash || 'Pendiente de emision'}
              </p>
            </div>
          </div>
        </div>
      </div>
      <div className="rounded-md border border-slate-200 p-4 dark:border-border">
        <h2 className="text-sm font-600">Representacion PDF</h2>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          El PDF no sustituye al registro unico. Refleja sus datos esenciales, firmas, QR y huellas
          de integridad.
        </p>
        <button
          disabled={!ready}
          className="mt-5 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-600 text-white disabled:opacity-45"
        >
          <Download size={15} /> Descargar PDF
        </button>
      </div>
    </div>
  );
}
function PartiesTab({ detail, parties }: { detail: Detail; parties: any[] }) {
  const values = parties.length
    ? parties
    : [
        { role: 'subscriber', display_name: detail.subscriberName },
        { role: 'beneficiary', display_name: detail.beneficiaryName },
      ];
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {values.map((party, index) => (
        <div
          key={party.id || index}
          className="rounded-md border border-slate-200 p-4 dark:border-border"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-indigo-50 text-indigo-700">
              <UserRound size={18} />
            </span>
            <div>
              <p className="text-xs font-600 uppercase tracking-[0.06em] text-slate-400">
                {roleLabel(party.role)}
              </p>
              <p className="mt-1 text-sm font-600">{party.display_name}</p>
            </div>
          </div>
          <p className="mt-4 text-xs text-slate-500">
            {party.email || party.tax_id_masked || 'Identificacion en el registro protegido'}
          </p>
        </div>
      ))}
    </div>
  );
}
function EvidenceTab({ detail }: { detail: Detail }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Evidence
        icon={Fingerprint}
        title="Datos canonicos"
        value={detail.canonicalHash || 'Pendiente de emision'}
        ok={Boolean(detail.canonicalHash)}
      />
      <Evidence
        icon={FileText}
        title="Documento PDF"
        value={detail.raw?.document_hash || 'Pendiente de generacion'}
        ok={Boolean(detail.raw?.document_hash)}
      />
      <Evidence
        icon={BadgeCheck}
        title="Sello de tiempo"
        value={detail.raw?.title_registry?.[0]?.timestamp_status || 'No configurado'}
        ok={detail.raw?.title_registry?.[0]?.timestamp_status === 'valid'}
      />
      <Evidence
        icon={ShieldCheck}
        title="NOM-151"
        value={detail.raw?.title_registry?.[0]?.nom151_status || 'No configurado'}
        ok={detail.raw?.title_registry?.[0]?.nom151_status === 'valid'}
      />
    </div>
  );
}
function HistoryTab({ detail }: { detail: Detail }) {
  return (
    <div className="relative ml-2 border-l border-slate-200 pl-6 dark:border-border">
      {detail.events.map((event, index) => (
        <div key={`${event.eventType}-${index}`} className="relative pb-7 last:pb-0">
          <span className="absolute -left-[29px] top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-indigo-600 ring-1 ring-indigo-200" />
          <p className="text-sm font-600">{event.label || eventLabel(event.eventType)}</p>
          <p className="mt-1 text-xs text-slate-500">{formatDateTime(event.occurredAt)}</p>
          {event.eventHash && (
            <p className="mt-1 break-all font-mono text-[10px] text-slate-400">{event.eventHash}</p>
          )}
        </div>
      ))}
    </div>
  );
}
function SummaryMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3 border-t border-slate-200 px-4 py-4 first:border-t-0 sm:border-l sm:border-t-0 sm:first:border-l-0 dark:border-border">
      <span className="flex h-9 w-9 items-center justify-center rounded-md bg-indigo-50 text-indigo-700">
        <Icon size={17} />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="mt-1 truncate text-sm font-600">{value}</p>
      </div>
    </div>
  );
}
function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 dark:border-border">
      <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-border">
        <Icon size={16} className="text-indigo-700" />
        <h2 className="text-sm font-600">{title}</h2>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}
function Definition({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-600 uppercase tracking-[0.06em] text-slate-400">{label}</dt>
      <dd className="mt-1 text-sm font-500">{value}</dd>
    </div>
  );
}
function Control({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-slate-600">{label}</span>
      <span className={ok ? 'font-600 text-emerald-700' : 'font-600 text-amber-700'}>
        {ok ? 'Registrado' : 'Pendiente'}
      </span>
    </div>
  );
}
function Evidence({
  icon: Icon,
  title,
  value,
  ok,
}: {
  icon: React.ElementType;
  title: string;
  value: string;
  ok: boolean;
}) {
  return (
    <div className="rounded-md border border-slate-200 p-4 dark:border-border">
      <div className="flex items-center gap-3">
        <span
          className={`flex h-9 w-9 items-center justify-center rounded-md ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
        >
          <Icon size={17} />
        </span>
        <div>
          <p className="text-sm font-600">{title}</p>
          <p className={`mt-0.5 text-xs ${ok ? 'text-emerald-700' : 'text-slate-500'}`}>
            {ok ? 'Verificable' : 'Pendiente'}
          </p>
        </div>
      </div>
      <p className="mt-3 break-all font-mono text-[10px] leading-5 text-slate-500">{value}</p>
    </div>
  );
}
function mapDetail(row: any): Detail {
  const summary = mapPromissoryNoteRow(row);
  return {
    ...summary,
    raw: row,
    events: (row.title_events || []).map((event: any) => ({
      eventType: event.event_type,
      label: eventLabel(event.event_type),
      occurredAt: event.occurred_at,
      eventHash: event.event_hash,
    })),
  };
}
function demoDetail(summary: PromissoryNoteSummary): Detail {
  return {
    ...summary,
    raw: {
      internal_uuid: summary.id,
      version: 1,
      promissory_notes: {
        note_kind: summary.kind,
        issue_date: summary.issuedAt?.slice(0, 10),
        payment_place: 'Mazatlan, Sinaloa',
        interest_mode: summary.kind === 'interest' ? 'ordinary' : 'none',
      },
    },
    events: [
      {
        eventType: 'TITLE_CREATED',
        label: 'Pagare creado',
        occurredAt: '2026-08-07T18:04:00.000Z',
      },
      {
        eventType: 'IDENTITY_VERIFIED',
        label: 'Identidad verificada',
        occurredAt: '2026-08-07T18:18:00.000Z',
      },
      {
        eventType: 'TITLE_SIGNED',
        label: 'Pagare firmado',
        occurredAt: '2026-08-07T18:29:00.000Z',
      },
      {
        eventType: 'TITLE_ISSUED',
        label: 'Titulo emitido y registrado',
        occurredAt: summary.issuedAt || '2026-08-07T18:32:00.000Z',
      },
    ],
  };
}
function readLocalDetail(id: string): Detail | null {
  try {
    return JSON.parse(localStorage.getItem(`docubox_credit_title_detail_${id}`) || 'null');
  } catch {
    return null;
  }
}
function eventLabel(value: string) {
  return (
    (
      {
        TITLE_CREATED: 'Pagare creado',
        SIGNATURE_REQUESTED: 'Firma solicitada',
        IDENTITY_VERIFIED: 'Identidad verificada',
        TITLE_SIGNED: 'Pagare firmado',
        TITLE_ISSUED: 'Titulo emitido y registrado',
        PAYMENT_REGISTERED: 'Pago registrado',
        TITLE_OVERDUE: 'Titulo vencido',
        TITLE_PAID: 'Pagare liquidado',
        TITLE_CANCELLED: 'Pagare cancelado',
      } as Record<string, string>
    )[value] || value
  );
}
function roleLabel(value: string) {
  return (
    (
      {
        subscriber: 'Suscriptor',
        beneficiary: 'Beneficiario',
        guarantor: 'Aval',
        holder: 'Tenedor actual',
      } as Record<string, string>
    )[value] || value
  );
}
function formatDate(value: string) {
  if (!value) return 'Sin fecha';
  return new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
function formatDateTime(value: string) {
  return new Date(value).toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
