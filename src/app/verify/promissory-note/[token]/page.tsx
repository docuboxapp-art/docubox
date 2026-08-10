'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { BadgeCheck, CalendarDays, CircleDollarSign, FileCheck2, Fingerprint, Landmark, Loader2, Search, ShieldCheck } from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';
import { DEMO_PROMISSORY_NOTES, formatMoney, STATUS_META } from '@/lib/credit-titles/schema';

type Verification = { folio: string; uuid: string; status: string; amount: number; balance: number; currency: string; issuedAt?: string; maturityDate: string; canonicalHash: string; documentHash?: string; integrity: boolean; parties: Array<{ role: string; displayName: string; taxId?: string }>; timestampStatus: string; nom151Status: string; registeredAt?: string };

export default function VerifyPromissoryNotePage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Verification | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const response = await fetch(`/api/credit-titles/verify/${encodeURIComponent(token)}`);
      if (response.ok) { const result = await response.json(); if (!cancelled) setData(result.data); }
      else {
        const demo = DEMO_PROMISSORY_NOTES.find((item) => item.publicToken === token && !['draft','preparing','awaiting_signature','signed'].includes(item.status));
        if (demo && !cancelled) setData({ folio: demo.folio, uuid: demo.id, status: demo.status, amount: demo.amount, balance: demo.balance, currency: demo.currency, issuedAt: demo.issuedAt, maturityDate: demo.maturityDate, canonicalHash: demo.canonicalHash, documentHash: demo.canonicalHash, integrity: Boolean(demo.canonicalHash), parties: [{ role: 'subscriber', displayName: maskName(demo.subscriberName), taxId: maskTaxId(demo.subscriberRfc) }, { role: 'beneficiary', displayName: maskName(demo.beneficiaryName) }], timestampStatus: 'sandbox', nom151Status: 'not_configured', registeredAt: demo.issuedAt });
        else if (!cancelled) { const result = await response.json().catch(() => ({})); setError(result.error || 'No se encontro un pagare verificable.'); }
      }
      if (!cancelled) setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [token]);

  return <div className="min-h-screen bg-[#f6f8fb] text-slate-950 dark:bg-background dark:text-foreground"><header className="border-b border-slate-200 bg-white dark:border-border dark:bg-card"><div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6"><AppLogo className="w-[128px]" /><span className="inline-flex items-center gap-2 text-xs font-600 text-slate-500"><ShieldCheck size={15} /> Verificacion publica</span></div></header><main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
    {loading ? <div className="flex min-h-[55vh] items-center justify-center"><Loader2 size={28} className="animate-spin text-primary" /></div> : error ? <section className="rounded-lg border border-slate-200 bg-white p-8 text-center dark:border-border dark:bg-card"><Search size={30} className="mx-auto text-slate-400" /><h1 className="mt-4 text-xl font-600">No fue posible verificar el pagare</h1><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500">{error} Revisa el QR o solicita al emisor un acceso vigente.</p></section> : data && <>
      <section className={`overflow-hidden rounded-lg border bg-white dark:bg-card ${data.integrity ? 'border-emerald-200 dark:border-emerald-900' : 'border-amber-200 dark:border-amber-900'}`}><div className={`border-b px-5 py-5 ${data.integrity ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20' : 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20'}`}><div className="flex items-start gap-4"><span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${data.integrity ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{data.integrity ? <BadgeCheck size={25} /> : <ShieldCheck size={24} />}</span><div><p className="text-xs font-600 uppercase tracking-[0.08em] text-slate-500">Resultado de verificacion</p><h1 className="mt-1 text-2xl font-600">{data.integrity ? 'Pagare verificado' : 'Registro localizado'}</h1><p className="mt-1 text-sm text-slate-600">La consulta corresponde al registro electronico unico conservado por Docubox.</p></div></div></div><div className="p-5 sm:p-6"><div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4"><Value icon={Landmark} label="Folio" value={data.folio} /><Value icon={CircleDollarSign} label="Importe" value={formatMoney(data.amount, data.currency)} /><Value icon={CalendarDays} label="Emision" value={data.issuedAt ? formatDate(data.issuedAt) : 'Pendiente'} /><Value icon={CalendarDays} label="Vencimiento" value={formatDate(data.maturityDate)} /></div><div className="mt-6 border-t border-slate-200 pt-5 dark:border-border"><dl className="grid gap-4 sm:grid-cols-2"><Definition label="Estado" value={(STATUS_META as any)[data.status]?.label || data.status} /><Definition label="Saldo registrado" value={formatMoney(data.balance, data.currency)} /><Definition label="UUID del titulo" value={data.uuid} mono /><Definition label="Registro" value={data.registeredAt ? formatDateTime(data.registeredAt) : 'Pendiente'} /></dl></div></div></section>
      <div className="mt-4 grid gap-4 lg:grid-cols-2"><section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-border dark:bg-card"><div className="flex items-center gap-2"><Fingerprint size={17} className="text-indigo-700" /><h2 className="text-sm font-600">Integridad criptografica</h2></div><dl className="mt-4 space-y-4"><Definition label="Hash canonico SHA-256" value={data.canonicalHash || 'No disponible'} mono /><Definition label="Hash de la representacion" value={data.documentHash || 'No disponible'} mono /><div className="grid grid-cols-2 gap-3"><Status label="TSA RFC 3161" value={data.timestampStatus} /><Status label="NOM-151" value={data.nom151Status} /></div></dl></section><section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-border dark:bg-card"><div className="flex items-center gap-2"><FileCheck2 size={17} className="text-indigo-700" /><h2 className="text-sm font-600">Partes publicas</h2></div><p className="mt-1 text-xs leading-5 text-slate-500">Los datos se muestran enmascarados para proteger la privacidad.</p><div className="mt-4 divide-y divide-slate-200 dark:divide-border">{data.parties.map((party, index) => <div key={`${party.role}-${index}`} className="py-3 first:pt-0 last:pb-0"><p className="text-[11px] font-600 uppercase tracking-[0.06em] text-slate-400">{roleLabel(party.role)}</p><p className="mt-1 text-sm font-600">{party.displayName}</p>{party.taxId && <p className="mt-0.5 text-xs text-slate-500">{party.taxId}</p>}</div>)}</div></section></div>
      <p className="mt-6 text-center text-xs leading-5 text-slate-500">Esta pantalla verifica integridad y estado registral. No sustituye la revision juridica del instrumento ni exhibe informacion privada.</p>
    </>}
  </main></div>;
}

function Value({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) { return <div><span className="flex h-9 w-9 items-center justify-center rounded-md bg-indigo-50 text-indigo-700"><Icon size={17} /></span><p className="mt-3 text-[11px] font-600 uppercase tracking-[0.06em] text-slate-400">{label}</p><p className="mt-1 text-sm font-600">{value}</p></div>; }
function Definition({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) { return <div><dt className="text-[11px] font-600 uppercase tracking-[0.06em] text-slate-400">{label}</dt><dd className={`mt-1 break-all text-sm ${mono ? 'font-mono text-xs leading-5' : 'font-500'}`}>{value}</dd></div>; }
function Status({ label, value }: { label: string; value: string }) { const valid = value === 'valid'; return <div className="rounded-md bg-slate-50 p-3 dark:bg-background"><p className="text-[11px] text-slate-500">{label}</p><p className={`mt-1 text-xs font-600 ${valid ? 'text-emerald-700' : 'text-amber-700'}`}>{valid ? 'Valido' : value === 'sandbox' ? 'Entorno de pruebas' : 'No configurado'}</p></div>; }
function maskName(value: string) { return value.split(/\s+/).filter(Boolean).map((part) => `${part[0]}${'*'.repeat(Math.min(5, Math.max(1, part.length - 1)))}`).join(' '); }
function maskTaxId(value: string) { return value.length > 6 ? `${value.slice(0,3)}${'*'.repeat(value.length - 6)}${value.slice(-3)}` : value; }
function roleLabel(value: string) { return ({ subscriber: 'Suscriptor', beneficiary: 'Beneficiario', guarantor: 'Aval', holder: 'Tenedor' } as Record<string,string>)[value] || value; }
function formatDate(value: string) { return new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' }); }
function formatDateTime(value: string) { return new Date(value).toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' }); }
