'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileArchive,
  FileSpreadsheet,
  Files,
  Layers3,
  Loader2,
  Package,
  Save,
  ShieldCheck,
  UploadCloud,
} from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { createClient } from '@/lib/supabase/client';
import {
  BULK_TYPE_LABELS,
  saveLocalBulkCampaign,
  type BulkCampaignDraft,
  type BulkCampaignSummary,
  type BulkCampaignType,
} from '@/lib/bulk-signatures/schema';

const initialDraft: BulkCampaignDraft = {
  name: '',
  description: '',
  ownerName: '',
  campaignType: 'multiple_documents',
  priority: 'normal',
  internalReference: '',
  expiresAt: '',
  timezone: 'America/Chihuahua',
  sourceName: '',
  recipientCount: 0,
  signatureMethod: 'autograph_otp',
  workflowType: 'parallel',
  requireIdentity: false,
  sendReminders: true,
};

const sources: Array<{
  id: BulkCampaignType;
  title: string;
  description: string;
  icon: React.ElementType;
}> = [
  {
    id: 'multiple_documents',
    title: 'Varios documentos',
    description: 'Carga archivos diferentes y asigna participantes a cada uno.',
    icon: Files,
  },
  {
    id: 'template',
    title: 'Desde plantilla',
    description: 'Combina una plantilla Docubox con registros CSV o Excel.',
    icon: FileSpreadsheet,
  },
  {
    id: 'shared_document',
    title: 'Mismo documento',
    description: 'Crea una instancia independiente para cada destinatario.',
    icon: Layers3,
  },
  {
    id: 'document_package',
    title: 'Paquete documental',
    description: 'Agrupa varios documentos para cada participante.',
    icon: Package,
  },
];

export default function NewBulkSignatureCampaignPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<BulkCampaignDraft>({
    ...initialDraft,
    ownerName: user?.user_metadata?.full_name || user?.email || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    setDraft((current) =>
      current.ownerName
        ? current
        : { ...current, ownerName: user.user_metadata?.full_name || user.email || '' }
    );
  }, [user]);

  const update = <K extends keyof BulkCampaignDraft>(key: K, value: BulkCampaignDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const canContinue =
    step === 1
      ? Boolean(draft.name.trim() && draft.expiresAt)
      : step === 2
        ? Boolean(draft.sourceName.trim() && draft.recipientCount > 0)
        : true;

  const finish = async () => {
    if (!activeWorkspace?.id) return setError('Selecciona un espacio de trabajo.');
    setSaving(true);
    setError('');
    let id = crypto.randomUUID();
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error('No hay una sesion activa.');
      const response = await fetch('/api/bulk-signatures', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ ...draft, workspaceId: activeWorkspace.id }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'No se pudo guardar en el servidor.');
      id = payload.data.id;
    } catch {
      const now = new Date().toISOString();
      const local: BulkCampaignSummary = {
        id,
        name: draft.name.trim(),
        description: draft.description.trim(),
        campaignType: draft.campaignType,
        ownerName: draft.ownerName || user?.email || 'Responsable del espacio',
        status: 'draft',
        totalItems: draft.recipientCount,
        completedItems: 0,
        pendingItems: draft.recipientCount,
        failedItems: 0,
        participantCount: draft.recipientCount,
        expiresAt: new Date(draft.expiresAt).toISOString(),
        createdAt: now,
        updatedAt: now,
      };
      saveLocalBulkCampaign(local);
    }
    router.push(`/firmas-masivas/${id}`);
  };

  return (
    <AppLayout noPadding>
      <div className="-mx-4 -my-4 min-h-[calc(100vh-4rem)] bg-[#f6f8fb] dark:bg-background md:-my-6">
        <header className="border-b border-slate-200 bg-white px-4 py-4 dark:border-border dark:bg-card sm:px-6">
          <div className="mx-auto flex max-w-[1480px] items-center gap-4">
            <button
              onClick={() => router.push('/firmas-masivas')}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-border"
            >
              <ArrowLeft size={17} />
            </button>
            <div>
              <h1 className="text-lg font-600">Nueva firma masiva</h1>
              <p className="text-xs text-slate-500">Campana guardable y recuperable</p>
            </div>
            <div className="ml-auto hidden items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 md:flex dark:border-border dark:bg-muted/30">
              {['Informacion', 'Origen', 'Configuracion', 'Revision'].map((label, index) => {
                const number = index + 1;
                return (
                  <div
                    key={label}
                    className={`flex h-9 items-center gap-2 rounded-md px-3 text-xs font-600 ${step === number ? 'bg-white text-primary shadow-sm dark:bg-card' : number < step ? 'text-emerald-700' : 'text-slate-400'}`}
                  >
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-md ${number < step ? 'bg-emerald-50' : step === number ? 'bg-blue-50' : 'bg-slate-100'}`}
                    >
                      {number < step ? <Check size={13} /> : number}
                    </span>
                    {label}
                  </div>
                );
              })}
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1180px] px-4 py-6 sm:px-6">
          <div className="mb-5 flex items-end justify-between border-b border-slate-200 pb-5 dark:border-border">
            <div>
              <span className="text-xs font-600 uppercase text-primary">Paso {step} de 4</span>
              <h2 className="mt-1 text-2xl font-600">
                {step === 1
                  ? 'Informacion general'
                  : step === 2
                    ? 'Origen de los documentos'
                    : step === 3
                      ? 'Firma, workflow e identidad'
                      : 'Revisa antes de guardar'}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {step === 1
                  ? 'Identifica la operacion y su vigencia.'
                  : step === 2
                    ? 'Define como se generaran las instancias individuales.'
                    : step === 3
                      ? 'Configura una politica comun para todos los documentos.'
                      : 'Confirma el alcance de la campana.'}
              </p>
            </div>
            <span className="text-sm font-600 text-slate-500">{step * 25}%</span>
          </div>

          {step === 1 && (
            <section className="grid gap-5 rounded-lg border border-slate-200 bg-white p-5 dark:border-border dark:bg-card md:grid-cols-2">
              <Field label="Nombre de la campana" required className="md:col-span-2">
                <input
                  value={draft.name}
                  onChange={(e) => update('name', e.target.value)}
                  placeholder="Ej. Renovacion de contratos 2026"
                  className={inputClass}
                />
              </Field>
              <Field label="Descripcion" className="md:col-span-2">
                <textarea
                  value={draft.description}
                  onChange={(e) => update('description', e.target.value)}
                  rows={3}
                  placeholder="Objetivo y alcance de la operacion"
                  className={inputClass}
                />
              </Field>
              <Field label="Responsable">
                <input
                  value={draft.ownerName}
                  onChange={(e) => update('ownerName', e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Prioridad">
                <select
                  value={draft.priority}
                  onChange={(e) =>
                    update('priority', e.target.value as BulkCampaignDraft['priority'])
                  }
                  className={inputClass}
                >
                  <option value="normal">Normal</option>
                  <option value="high">Alta</option>
                  <option value="urgent">Urgente</option>
                </select>
              </Field>
              <Field label="Referencia interna">
                <input
                  value={draft.internalReference}
                  onChange={(e) => update('internalReference', e.target.value)}
                  placeholder="RH-2026-08"
                  className={inputClass}
                />
              </Field>
              <Field label="Fecha limite" required>
                <input
                  type="datetime-local"
                  value={draft.expiresAt}
                  onChange={(e) => update('expiresAt', e.target.value)}
                  className={inputClass}
                />
              </Field>
            </section>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <section className="grid gap-3 md:grid-cols-2">
                {sources.map((source) => {
                  const Icon = source.icon;
                  const selected = draft.campaignType === source.id;
                  return (
                    <button
                      key={source.id}
                      onClick={() => update('campaignType', source.id)}
                      className={`flex items-start gap-4 rounded-lg border bg-white p-5 text-left transition dark:bg-card ${selected ? 'border-primary ring-2 ring-primary/10' : 'border-slate-200 hover:border-blue-200 dark:border-border'}`}
                    >
                      <span
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${selected ? 'bg-blue-50 text-primary' : 'bg-slate-100 text-slate-500'}`}
                      >
                        <Icon size={19} />
                      </span>
                      <span>
                        <span className="flex items-center gap-2 text-sm font-600">
                          {source.title}
                          {selected && <Check size={15} className="text-primary" />}
                        </span>
                        <span className="mt-1 block text-sm leading-5 text-slate-500">
                          {source.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </section>
              <section className="grid gap-5 rounded-lg border border-slate-200 bg-white p-5 dark:border-border dark:bg-card md:grid-cols-2">
                <Field
                  label={
                    draft.campaignType === 'template'
                      ? 'Plantilla o archivo de datos'
                      : 'Documento, ZIP o paquete'
                  }
                  required
                >
                  <label className="flex h-11 cursor-pointer items-center gap-3 rounded-md border border-dashed border-blue-300 bg-blue-50/40 px-3 text-sm text-slate-600">
                    <UploadCloud size={17} className="text-primary" />
                    <span className="truncate">
                      {draft.sourceName || 'Seleccionar archivo de origen'}
                    </span>
                    <input
                      type="file"
                      accept=".pdf,.zip,.csv,.xlsx"
                      className="hidden"
                      onChange={(e) => update('sourceName', e.target.files?.[0]?.name || '')}
                    />
                  </label>
                </Field>
                <Field label="Registros o destinatarios" required>
                  <input
                    type="number"
                    min={1}
                    max={100000}
                    value={draft.recipientCount || ''}
                    onChange={(e) => update('recipientCount', Number(e.target.value))}
                    placeholder="Ej. 250"
                    className={inputClass}
                  />
                </Field>
                <div className="md:col-span-2 flex items-start gap-3 rounded-md bg-slate-50 p-3 text-xs leading-5 text-slate-500 dark:bg-muted/30">
                  <FileArchive size={16} className="mt-0.5 shrink-0" />
                  El importador validara MIME, duplicados, correos y variables antes del
                  lanzamiento. Cada fila producira un documento normal de Docubox.
                </div>
              </section>
            </div>
          )}

          {step === 3 && (
            <section className="grid gap-5 rounded-lg border border-slate-200 bg-white p-5 dark:border-border dark:bg-card md:grid-cols-2">
              <Field label="Metodo de firma">
                <select
                  value={draft.signatureMethod}
                  onChange={(e) =>
                    update(
                      'signatureMethod',
                      e.target.value as BulkCampaignDraft['signatureMethod']
                    )
                  }
                  className={inputClass}
                >
                  <option value="autograph_otp">Firma autografa + OTP</option>
                  <option value="efirma">e.firma SAT</option>
                  <option value="click_sign">Click & Sign</option>
                  <option value="biometric">Firma con prueba de vida</option>
                </select>
              </Field>
              <Field label="Orden del workflow">
                <select
                  value={draft.workflowType}
                  onChange={(e) =>
                    update('workflowType', e.target.value as BulkCampaignDraft['workflowType'])
                  }
                  className={inputClass}
                >
                  <option value="parallel">Paralelo</option>
                  <option value="sequential">Secuencial</option>
                </select>
              </Field>
              <Toggle
                title="Verificacion de identidad"
                description="Exige la politica de identidad antes de permitir la firma."
                checked={draft.requireIdentity}
                onChange={(value) => update('requireIdentity', value)}
                icon={ShieldCheck}
              />
              <Toggle
                title="Recordatorios automaticos"
                description="Envia avisos a quienes mantengan documentos pendientes."
                checked={draft.sendReminders}
                onChange={(value) => update('sendReminders', value)}
                icon={ClockIcon}
              />
            </section>
          )}

          {step === 4 && (
            <section className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-border dark:bg-card">
              <div className="border-b border-slate-200 px-5 py-4 dark:border-border">
                <h3 className="text-sm font-600">Resumen de la campana</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Todavia se guardara como borrador; podras validar y lanzar desde el monitor.
                </p>
              </div>
              <dl className="grid gap-px bg-slate-200 sm:grid-cols-2 dark:bg-border">
                <Review label="Nombre" value={draft.name} />
                <Review label="Origen" value={BULK_TYPE_LABELS[draft.campaignType]} />
                <Review label="Archivo" value={draft.sourceName} />
                <Review label="Instancias" value={draft.recipientCount.toLocaleString('es-MX')} />
                <Review label="Firma" value={signatureLabel(draft.signatureMethod)} />
                <Review
                  label="Workflow"
                  value={draft.workflowType === 'parallel' ? 'Paralelo' : 'Secuencial'}
                />
                <Review
                  label="Identidad"
                  value={draft.requireIdentity ? 'Requerida' : 'Estandar'}
                />
                <Review
                  label="Vencimiento"
                  value={new Date(draft.expiresAt).toLocaleString('es-MX')}
                />
              </dl>
            </section>
          )}

          {error && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <footer className="mt-5 flex items-center justify-between border-t border-slate-200 pt-5 dark:border-border">
            <button
              onClick={() =>
                step === 1 ? router.push('/firmas-masivas') : setStep((value) => value - 1)
              }
              className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-600 text-slate-700 hover:bg-slate-50 dark:border-border dark:bg-card"
            >
              <ArrowLeft size={16} /> {step === 1 ? 'Cancelar' : 'Atras'}
            </button>
            {step < 4 ? (
              <button
                disabled={!canContinue}
                onClick={() => setStep((value) => value + 1)}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-600 text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Guardar y continuar <ArrowRight size={16} />
              </button>
            ) : (
              <button
                disabled={saving}
                onClick={finish}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-600 text-white disabled:opacity-60"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}{' '}
                Guardar campana
              </button>
            )}
          </footer>
        </main>
      </div>
    </AppLayout>
  );
}

const inputClass =
  'h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 dark:border-border dark:bg-background';
function Field({
  label,
  required,
  className = '',
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={className}>
      <span className="mb-1.5 block text-xs font-600 text-slate-600 dark:text-muted-foreground">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
    </label>
  );
}
function Toggle({
  title,
  description,
  checked,
  onChange,
  icon: Icon,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  icon: React.ElementType;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`flex items-start gap-3 rounded-lg border p-4 text-left ${checked ? 'border-primary bg-blue-50/50 dark:bg-blue-950/20' : 'border-slate-200 dark:border-border'}`}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-blue-50 text-primary">
        <Icon size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-600">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span>
      </span>
      <span
        className={`relative mt-1 h-5 w-9 rounded-full transition ${checked ? 'bg-primary' : 'bg-slate-200'}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${checked ? 'left-[18px]' : 'left-0.5'}`}
        />
      </span>
    </button>
  );
}
function ClockIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return <FileSpreadsheet size={size} className={className} />;
}
function Review({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white px-5 py-4 dark:bg-card">
      <dt className="text-[11px] font-600 uppercase text-slate-400">{label}</dt>
      <dd className="mt-1 text-sm font-500 text-slate-900 dark:text-foreground">
        {value || 'Sin definir'}
      </dd>
    </div>
  );
}
function signatureLabel(value: BulkCampaignDraft['signatureMethod']) {
  return {
    autograph_otp: 'Firma autografa + OTP',
    efirma: 'e.firma SAT',
    click_sign: 'Click & Sign',
    biometric: 'Firma con prueba de vida',
  }[value];
}
