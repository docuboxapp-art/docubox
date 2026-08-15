'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Building2,
  Check,
  CircleDollarSign,
  FileCheck2,
  FileText,
  Link2,
  Loader2,
  PenLine,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import type { PromissoryNoteKind, PromissoryNoteSummary } from '@/lib/credit-titles/schema';

type Draft = {
  kind: PromissoryNoteKind;
  template: string;
  subscriberName: string;
  subscriberRfc: string;
  subscriberEmail: string;
  beneficiaryName: string;
  beneficiaryRfc: string;
  beneficiaryEmail: string;
  guarantorName: string;
  amount: string;
  currency: string;
  issueDate: string;
  issuePlace: string;
  maturityDate: string;
  paymentPlace: string;
  interestMode: string;
  ordinaryRate: string;
  defaultRate: string;
  installmentCount: string;
  linkedDocument: string;
  externalReference: string;
  identityLevel: string;
  signatureMethod: string;
  requireOtp: boolean;
  requireTsa: boolean;
  requireNom151: boolean;
};

const today = new Date().toISOString().slice(0, 10);
const initialDraft: Draft = {
  kind: 'simple',
  template: '',
  subscriberName: '',
  subscriberRfc: '',
  subscriberEmail: '',
  beneficiaryName: '',
  beneficiaryRfc: '',
  beneficiaryEmail: '',
  guarantorName: '',
  amount: '',
  currency: 'MXN',
  issueDate: today,
  issuePlace: 'Mazatlan, Sinaloa',
  maturityDate: '',
  paymentPlace: 'Mazatlan, Sinaloa',
  interestMode: 'none',
  ordinaryRate: '',
  defaultRate: '',
  installmentCount: '1',
  linkedDocument: '',
  externalReference: '',
  identityLevel: 'standard',
  signatureMethod: 'autograph_otp',
  requireOtp: true,
  requireTsa: true,
  requireNom151: false,
};

const steps = [
  { label: 'Tipo', icon: FileText },
  { label: 'Partes', icon: UserRound },
  { label: 'Condiciones', icon: CircleDollarSign },
  { label: 'Vinculaciones', icon: Link2 },
  { label: 'Identidad', icon: ShieldCheck },
  { label: 'Firma', icon: PenLine },
  { label: 'Revision', icon: FileCheck2 },
];

export default function NewPromissoryNotePage() {
  const router = useRouter();
  const { activeWorkspace } = useWorkspace();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(initialDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [contacts, setContacts] = useState<
    Array<{ id: string; name: string; email?: string; rfc?: string }>
  >([]);

  useEffect(() => {
    const load = async () => {
      const { data } = await createClient()
        .from('contacts')
        .select('id,full_name,email,rfc')
        .order('full_name')
        .limit(100);
      setContacts(
        (data || []).map((item: any) => ({
          id: item.id,
          name: item.full_name || item.email || 'Contacto',
          email: item.email,
          rfc: item.rfc,
        }))
      );
    };
    load();
  }, []);

  const canContinue = [
    Boolean(draft.kind),
    Boolean(draft.subscriberName.trim() && draft.beneficiaryName.trim()),
    Boolean(
      Number(draft.amount) > 0 && draft.issueDate && draft.maturityDate && draft.paymentPlace.trim()
    ),
    true,
    Boolean(draft.identityLevel),
    Boolean(draft.signatureMethod),
    true,
  ][step];
  const amount = Number(draft.amount || 0);
  const suggestedPolicy = amount >= 250000;

  const createDraft = async (sendToSignature: boolean) => {
    if (!activeWorkspace?.id) {
      setError('Selecciona un espacio de trabajo.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error('Debes iniciar sesion.');
      const response = await fetch('/api/credit-titles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          workspaceId: activeWorkspace.id,
          ...draft,
          amount,
          sendToSignature,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No fue posible crear el pagare.');
      router.push(`/credit-titles/promissory-notes/${result.data.id}`);
    } catch (caught) {
      const id = `local-${crypto.randomUUID()}`;
      const summary: PromissoryNoteSummary = {
        id,
        folio: `BORRADOR-${id.slice(-8).toUpperCase()}`,
        publicToken: '',
        kind: draft.kind,
        subscriberName: draft.subscriberName,
        subscriberRfc: draft.subscriberRfc,
        beneficiaryName: draft.beneficiaryName,
        currentHolderName: draft.beneficiaryName,
        amount,
        balance: amount,
        currency: draft.currency,
        maturityDate: draft.maturityDate,
        status: sendToSignature ? 'awaiting_signature' : 'draft',
        canonicalHash: '',
        updatedAt: new Date().toISOString(),
      };
      const previous = readLocal();
      localStorage.setItem(
        'docubox_credit_titles_drafts',
        JSON.stringify([summary, ...previous.filter((item) => item.id !== id)])
      );
      localStorage.setItem(
        `docubox_credit_title_detail_${id}`,
        JSON.stringify({
          ...summary,
          draft,
          events: [
            {
              eventType: 'TITLE_CREATED',
              label: 'Pagare creado como borrador',
              occurredAt: new Date().toISOString(),
            },
            ...(sendToSignature
              ? [
                  {
                    eventType: 'SIGNATURE_REQUESTED',
                    label: 'Solicitud de firma preparada',
                    occurredAt: new Date().toISOString(),
                  },
                ]
              : []),
          ],
          localError: caught instanceof Error ? caught.message : '',
        })
      );
      router.push(`/credit-titles/promissory-notes/${id}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f6f8fb] text-slate-950 dark:bg-background dark:text-foreground">
      <header className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-slate-200 bg-white px-4 dark:border-border dark:bg-card md:px-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/credit-titles/promissory-notes')}
            aria-label="Salir"
            className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-border"
          >
            <ArrowLeft size={17} />
          </button>
          <AppLogo className="[&_img]:h-auto [&_img]:w-[126px]" />
          <div className="hidden h-8 w-px bg-slate-200 md:block" />
          <div className="hidden md:block">
            <p className="text-sm font-600">Nuevo pagare electronico</p>
            <p className="text-xs text-slate-500">Registro de titulo de credito</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs font-500 text-slate-600">
            Paso {step + 1} de {steps.length}
          </p>
          <div className="mt-1.5 h-1.5 w-32 overflow-hidden rounded-full bg-slate-100 md:w-52">
            <div
              className="h-full rounded-full bg-indigo-600 transition-all"
              style={{ width: `${((step + 1) / steps.length) * 100}%` }}
            />
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1560px] md:grid-cols-[252px_minmax(0,1fr)]">
        <aside className="hidden min-h-[calc(100vh-72px)] border-r border-slate-200 bg-white p-4 dark:border-border dark:bg-card md:block">
          <p className="mb-3 px-2 text-[11px] font-600 uppercase tracking-[0.08em] text-slate-400">
            Emision
          </p>
          <ol className="space-y-1">
            {steps.map((item, index) => {
              const Icon = item.icon;
              const active = index === step;
              const done = index < step;
              return (
                <li key={item.label}>
                  <button
                    onClick={() => index < step && setStep(index)}
                    className={`flex h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm transition ${active ? 'bg-indigo-50 font-600 text-indigo-700 dark:bg-indigo-950/30' : done ? 'text-slate-700 hover:bg-slate-50 dark:text-foreground' : 'cursor-default text-slate-400'}`}
                  >
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full border text-[11px] ${done ? 'border-emerald-500 bg-emerald-500 text-white' : active ? 'border-indigo-600 bg-white text-indigo-700' : 'border-slate-200'}`}
                    >
                      {done ? <Check size={13} /> : <Icon size={13} />}
                    </span>
                    {item.label}
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>
        <main className="min-w-0 px-4 py-6 md:px-8 md:py-8 lg:px-12">
          <div className="mx-auto max-w-5xl">
            <div className="mb-6">
              <p className="text-xs font-600 text-indigo-700">{steps[step].label}</p>
              <h1 className="mt-1 text-2xl font-600">{titles[step]}</h1>
              <p className="mt-1 text-sm text-slate-500">{descriptions[step]}</p>
            </div>
            <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-border dark:bg-card md:p-6">
              {step === 0 && <TypeStep draft={draft} setDraft={setDraft} />}
              {step === 1 && <PartiesStep draft={draft} setDraft={setDraft} contacts={contacts} />}
              {step === 2 && <TermsStep draft={draft} setDraft={setDraft} />}
              {step === 3 && <LinksStep draft={draft} setDraft={setDraft} />}
              {step === 4 && (
                <IdentityStep draft={draft} setDraft={setDraft} suggested={suggestedPolicy} />
              )}
              {step === 5 && (
                <SignatureStep draft={draft} setDraft={setDraft} suggested={suggestedPolicy} />
              )}
              {step === 6 && <ReviewStep draft={draft} />}
            </section>
            {error && (
              <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </p>
            )}
            <footer className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <button
                onClick={() => setStep(Math.max(0, step - 1))}
                disabled={step === 0}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-600 text-slate-600 disabled:opacity-0 dark:border-border dark:bg-card"
              >
                <ArrowLeft size={15} /> Atras
              </button>
              {step < steps.length - 1 ? (
                <button
                  onClick={() => canContinue && setStep(step + 1)}
                  disabled={!canContinue}
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-5 text-sm font-600 text-white disabled:opacity-50"
                >
                  Guardar y continuar <ArrowRight size={15} />
                </button>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => createDraft(false)}
                    disabled={saving}
                    className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-600 text-slate-700 dark:border-border dark:bg-card"
                  >
                    Guardar borrador
                  </button>
                  <button
                    onClick={() => createDraft(true)}
                    disabled={saving}
                    className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-5 text-sm font-600 text-white disabled:opacity-60"
                  >
                    {saving ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <PenLine size={15} />
                    )}{' '}
                    Preparar firma
                  </button>
                </div>
              )}
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}

const titles = [
  'Selecciona el tipo de pagare',
  'Identifica a las partes',
  'Define las condiciones economicas',
  'Vincula antecedentes',
  'Configura la verificacion',
  'Define la politica de firma',
  'Revisa el titulo antes de continuar',
];
const descriptions = [
  'La arquitectura permite incorporar otros titulos sin alterar el registro base.',
  'El suscriptor promete el pago; el beneficiario recibe el derecho original.',
  'Estas condiciones quedaran inmovilizadas cuando el titulo sea emitido.',
  'Conserva referencias a documentos y expedientes sin duplicarlos.',
  'Reutiliza los controles de identidad ya disponibles en Docubox.',
  'La firma se ejecutara en el motor existente de documentos.',
  'Aun puedes guardar el borrador sin emitir ni generar un folio definitivo.',
];
const inputClass =
  'h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 dark:border-border dark:bg-background';

function TypeStep({ draft, setDraft }: StepProps) {
  const options: Array<[PromissoryNoteKind, string, string]> = [
    ['simple', 'Pagare simple', 'Promesa de pago con vencimiento definido.'],
    ['interest', 'Con intereses', 'Incluye tasa ordinaria o moratoria.'],
    ['guaranteed', 'Con aval', 'Incorpora una o mas personas avalistas.'],
    ['installments', 'En parcialidades', 'Calendario de pagos programados.'],
    ['series', 'Serie de pagares', 'Prepara instrumentos relacionados.'],
    ['contract', 'Asociado a contrato', 'Vincula un documento origen.'],
  ];
  return (
    <div>
      <div className="grid gap-3 md:grid-cols-2">
        {options.map(([value, label, detail]) => (
          <button
            key={value}
            onClick={() => setDraft({ ...draft, kind: value })}
            className={`flex items-start gap-3 rounded-md border p-4 text-left transition ${draft.kind === value ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/20' : 'border-slate-200 hover:border-indigo-200 dark:border-border'}`}
          >
            <span
              className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border ${draft.kind === value ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300'}`}
            >
              {draft.kind === value && <Check size={12} />}
            </span>
            <span>
              <span className="block text-sm font-600">{label}</span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">{detail}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="mt-5">
        <Label>Plantilla opcional</Label>
        <select
          value={draft.template}
          onChange={(event) => setDraft({ ...draft, template: event.target.value })}
          className={inputClass}
        >
          <option value="">Sin plantilla</option>
          <option value="pyme">Pagare PyME</option>
          <option value="commercial">Credito comercial</option>
          <option value="lease">Arrendamiento</option>
        </select>
      </div>
    </div>
  );
}
function PartiesStep({
  draft,
  setDraft,
  contacts,
}: StepProps & { contacts: Array<{ id: string; name: string; email?: string; rfc?: string }> }) {
  const apply = (role: 'subscriber' | 'beneficiary', id: string) => {
    const contact = contacts.find((item) => item.id === id);
    if (!contact) return;
    setDraft({
      ...draft,
      [`${role}Name`]: contact.name,
      [`${role}Email`]: contact.email || '',
      [`${role}Rfc`]: contact.rfc || '',
    });
  };
  return (
    <div className="space-y-6">
      <Party
        title="Suscriptor"
        icon={UserRound}
        contacts={contacts}
        onContact={(id) => apply('subscriber', id)}
        name={draft.subscriberName}
        rfc={draft.subscriberRfc}
        email={draft.subscriberEmail}
        onName={(subscriberName) => setDraft({ ...draft, subscriberName })}
        onRfc={(subscriberRfc) => setDraft({ ...draft, subscriberRfc })}
        onEmail={(subscriberEmail) => setDraft({ ...draft, subscriberEmail })}
      />
      <div className="border-t border-slate-200 dark:border-border" />
      <Party
        title="Beneficiario"
        icon={Building2}
        contacts={contacts}
        onContact={(id) => apply('beneficiary', id)}
        name={draft.beneficiaryName}
        rfc={draft.beneficiaryRfc}
        email={draft.beneficiaryEmail}
        onName={(beneficiaryName) => setDraft({ ...draft, beneficiaryName })}
        onRfc={(beneficiaryRfc) => setDraft({ ...draft, beneficiaryRfc })}
        onEmail={(beneficiaryEmail) => setDraft({ ...draft, beneficiaryEmail })}
      />
      {draft.kind === 'guaranteed' && (
        <Field
          label="Aval"
          value={draft.guarantorName}
          onChange={(guarantorName) => setDraft({ ...draft, guarantorName })}
          placeholder="Nombre o razon social"
        />
      )}
    </div>
  );
}
function Party({
  title,
  icon: Icon,
  contacts,
  onContact,
  name,
  rfc,
  email,
  onName,
  onRfc,
  onEmail,
}: {
  title: string;
  icon: React.ElementType;
  contacts: Array<{ id: string; name: string; email?: string; rfc?: string }>;
  onContact: (id: string) => void;
  name: string;
  rfc: string;
  email: string;
  onName: (value: string) => void;
  onRfc: (value: string) => void;
  onEmail: (value: string) => void;
}) {
  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <Icon size={17} className="text-indigo-700" />
        <h2 className="text-sm font-600">{title}</h2>
      </div>
      {contacts.length > 0 && (
        <div className="mb-4">
          <Label>Usar contacto existente</Label>
          <select
            defaultValue=""
            onChange={(event) => onContact(event.target.value)}
            className={inputClass}
          >
            <option value="">Capturar manualmente</option>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Nombre o razon social" value={name} onChange={onName} />
        <Field label="RFC" value={rfc} onChange={onRfc} />
        <Field label="Correo" type="email" value={email} onChange={onEmail} />
      </div>
    </div>
  );
}
function TermsStep({ draft, setDraft }: StepProps) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        <Field
          label="Importe"
          type="number"
          value={draft.amount}
          onChange={(amount) => setDraft({ ...draft, amount })}
          placeholder="0.00"
        />
        <div>
          <Label>Moneda</Label>
          <select
            value={draft.currency}
            onChange={(event) => setDraft({ ...draft, currency: event.target.value })}
            className={inputClass}
          >
            <option>MXN</option>
            <option>USD</option>
          </select>
        </div>
        <div>
          <Label>Intereses</Label>
          <select
            value={draft.interestMode}
            onChange={(event) => setDraft({ ...draft, interestMode: event.target.value })}
            className={inputClass}
          >
            <option value="none">Sin intereses</option>
            <option value="ordinary">Interes ordinario</option>
            <option value="default">Interes moratorio</option>
            <option value="both">Ambos</option>
          </select>
        </div>
      </div>
      {draft.interestMode !== 'none' && (
        <div className="grid gap-4 md:grid-cols-2">
          {['ordinary', 'both'].includes(draft.interestMode) && (
            <Field
              label="Tasa ordinaria anual (%)"
              type="number"
              value={draft.ordinaryRate}
              onChange={(ordinaryRate) => setDraft({ ...draft, ordinaryRate })}
            />
          )}
          {['default', 'both'].includes(draft.interestMode) && (
            <Field
              label="Tasa moratoria anual (%)"
              type="number"
              value={draft.defaultRate}
              onChange={(defaultRate) => setDraft({ ...draft, defaultRate })}
            />
          )}
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Field
          label="Fecha de suscripcion"
          type="date"
          value={draft.issueDate}
          onChange={(issueDate) => setDraft({ ...draft, issueDate })}
        />
        <Field
          label="Lugar de suscripcion"
          value={draft.issuePlace}
          onChange={(issuePlace) => setDraft({ ...draft, issuePlace })}
        />
        <Field
          label="Fecha de vencimiento"
          type="date"
          value={draft.maturityDate}
          onChange={(maturityDate) => setDraft({ ...draft, maturityDate })}
        />
        <Field
          label="Lugar de pago"
          value={draft.paymentPlace}
          onChange={(paymentPlace) => setDraft({ ...draft, paymentPlace })}
        />
      </div>
      {draft.kind === 'installments' && (
        <Field
          label="Numero de parcialidades"
          type="number"
          value={draft.installmentCount}
          onChange={(installmentCount) => setDraft({ ...draft, installmentCount })}
        />
      )}
    </div>
  );
}
function LinksStep({ draft, setDraft }: StepProps) {
  return (
    <div className="space-y-5">
      <div className="rounded-md border border-blue-100 bg-blue-50 p-4 text-xs leading-5 text-slate-600">
        <div className="flex gap-3">
          <Link2 size={17} className="mt-0.5 text-primary" />
          <p>
            Las vinculaciones conservan referencias a documentos, expedientes u operaciones
            existentes. No crean copias.
          </p>
        </div>
      </div>
      <Field
        label="ID de documento o expediente"
        value={draft.linkedDocument}
        onChange={(linkedDocument) => setDraft({ ...draft, linkedDocument })}
        placeholder="Ej. DOC-2026-000184 o EXP-2026-018"
      />
      <Field
        label="Referencia externa"
        value={draft.externalReference}
        onChange={(externalReference) => setDraft({ ...draft, externalReference })}
        placeholder="Contrato, credito u operacion relacionada"
      />
    </div>
  );
}
function IdentityStep({ draft, setDraft, suggested }: StepProps & { suggested: boolean }) {
  const options = [
    ['basic', 'Basico', 'Correo y control de sesion.'],
    ['standard', 'Estandar', 'Correo, OTP, dispositivo e identidad declarada.'],
    ['high', 'Alto', 'Identidad documental, prueba de vida y e.firma.'],
    ['custom', 'Personalizado', 'Politica configurable por participante.'],
  ];
  return (
    <div>
      <div className="grid gap-3 md:grid-cols-2">
        {options.map(([value, label, detail]) => (
          <button
            key={value}
            onClick={() => setDraft({ ...draft, identityLevel: value })}
            className={`rounded-md border p-4 text-left ${draft.identityLevel === value ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 dark:border-border'}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-600">{label}</span>
              {suggested && value === 'high' && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-600 text-amber-700">
                  Recomendado
                </span>
              )}
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
function SignatureStep({ draft, setDraft, suggested }: StepProps & { suggested: boolean }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2">
        {[
          ['efirma', 'e.firma SAT', 'Certificado y llave usados solo en memoria.'],
          [
            'advanced',
            'Firma electronica avanzada',
            'Politica reforzada con identidad y evidencia.',
          ],
          ['autograph_otp', 'Firma autografa + OTP', 'Trazo, correo, dispositivo y autenticacion.'],
          ['click_otp', 'Click & Sign + OTP', 'Aceptacion expresa con evidencia digital.'],
        ].map(([value, label, detail]) => (
          <button
            key={value}
            onClick={() => setDraft({ ...draft, signatureMethod: value })}
            className={`rounded-md border p-4 text-left ${draft.signatureMethod === value ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 dark:border-border'}`}
          >
            <p className="text-sm font-600">{label}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Toggle
          label="OTP"
          checked={draft.requireOtp}
          onChange={(requireOtp) => setDraft({ ...draft, requireOtp })}
        />
        <Toggle
          label="TSA RFC 3161"
          checked={draft.requireTsa}
          onChange={(requireTsa) => setDraft({ ...draft, requireTsa })}
        />
        <Toggle
          label="NOM-151"
          checked={draft.requireNom151}
          onChange={(requireNom151) => setDraft({ ...draft, requireNom151 })}
        />
      </div>
      {suggested && (
        <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">
          <BadgeCheck size={17} className="mt-0.5" />
          Por el importe, se recomienda identidad alta, e.firma, OTP, TSA y NOM-151. Esta
          recomendacion no sustituye una politica legal aprobada.
        </div>
      )}
    </div>
  );
}
function ReviewStep({ draft }: { draft: Draft }) {
  return (
    <div className="space-y-5">
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex gap-3">
          <ShieldCheck size={19} className="mt-0.5 text-emerald-700" />
          <div>
            <p className="text-sm font-600 text-emerald-950">Registro preparado</p>
            <p className="mt-1 text-xs leading-5 text-emerald-800">
              El borrador conservara datos estructurados. El folio definitivo, canonical hash y
              registro inmutable se generan solo durante la emision transaccional.
            </p>
          </div>
        </div>
      </div>
      <dl className="grid gap-3 md:grid-cols-2">
        <Summary label="Tipo" value={draft.kind} />
        <Summary
          label="Importe"
          value={`${Number(draft.amount).toLocaleString('es-MX')} ${draft.currency}`}
        />
        <Summary
          label="Suscriptor"
          value={`${draft.subscriberName} · ${draft.subscriberRfc || 'RFC pendiente'}`}
        />
        <Summary
          label="Beneficiario"
          value={`${draft.beneficiaryName} · ${draft.beneficiaryRfc || 'RFC pendiente'}`}
        />
        <Summary label="Vencimiento" value={draft.maturityDate} />
        <Summary
          label="Firma"
          value={`${draft.signatureMethod} · identidad ${draft.identityLevel}`}
        />
        <Summary
          label="Evidencia"
          value={`${draft.requireOtp ? 'OTP · ' : ''}${draft.requireTsa ? 'TSA · ' : ''}${draft.requireNom151 ? 'NOM-151' : 'sin NOM-151'}`}
        />
        <Summary
          label="Vinculacion"
          value={draft.linkedDocument || draft.externalReference || 'Sin referencias'}
        />
      </dl>
    </div>
  );
}
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 rounded-md border border-slate-200 p-3 text-sm font-500 dark:border-border">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-primary"
      />
      {label}
    </label>
  );
}
function Field({
  label,
  value,
  onChange,
  placeholder = '',
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={inputClass}
      />
    </div>
  );
}
function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1.5 block text-xs font-500 text-slate-600 dark:text-muted-foreground">
      {children}
    </label>
  );
}
function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 p-3 dark:bg-background">
      <dt className="text-[11px] font-600 uppercase tracking-[0.06em] text-slate-400">{label}</dt>
      <dd className="mt-1 text-sm font-600">{value}</dd>
    </div>
  );
}
type StepProps = { draft: Draft; setDraft: (value: Draft) => void };
function readLocal(): PromissoryNoteSummary[] {
  try {
    return JSON.parse(localStorage.getItem('docubox_credit_titles_drafts') || '[]');
  } catch {
    return [];
  }
}
