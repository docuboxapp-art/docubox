'use client';

import { useEffect, useRef } from 'react';
import {
  ClipboardCheck,
  FileText,
  Layers3,
  Pencil,
  Plus,
  RotateCcw,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { CaseTemplate } from '@/lib/case-files/schema';
import { itemKindLabel, type CaseTemplateDraft } from '@/lib/case-files/template-builder';

interface CaseTemplatePreviewProps {
  template: CaseTemplate;
  draft: CaseTemplateDraft | null;
  savedStatus?: 'draft' | 'active' | 'paused' | 'archived';
  onClose: () => void;
  onAction: () => void;
}

export default function CaseTemplatePreview({
  template,
  draft,
  savedStatus,
  onClose,
  onAction,
}: CaseTemplatePreviewProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      previous?.focus();
    };
  }, []);

  const items = draft?.sections.flatMap((section) => section.items) || [];
  const requirementCount = draft ? items.length : template.requirements.length;
  const documentCount = draft
    ? items.filter((item) => item.kind !== 'form').length
    : template.requirements.length;
  const formCount = draft ? items.filter((item) => item.kind === 'form').length : 0;
  const actionLabel =
    savedStatus === 'archived'
      ? 'Restaurar tipo'
      : savedStatus === 'draft'
        ? 'Continuar diseño'
        : savedStatus
          ? 'Editar tipo'
          : 'Usar como base';

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/50 p-3 sm:p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="case-template-preview-title"
        aria-describedby="case-template-preview-description"
        className={`flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-border dark:bg-card ${draft?.appearance.width === 'wide' ? 'max-w-5xl' : 'max-w-3xl'}`}
      >
        <header
          className={`flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-border sm:px-6 ${draft?.appearance.headerAlignment === 'center' ? 'text-center' : ''}`}
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-primary">
                Vista previa del expediente
              </span>
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-primary">
                {template.type}
              </span>
              {savedStatus && (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${savedStatus === 'draft' || savedStatus === 'paused' ? 'bg-amber-50 text-amber-700' : savedStatus === 'archived' ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-700'}`}
                >
                  {savedStatus === 'draft'
                    ? 'Borrador'
                    : savedStatus === 'paused'
                      ? 'Pausado'
                      : savedStatus === 'archived'
                        ? 'Archivado'
                        : 'Publicado'}
                </span>
              )}
              {draft && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  {draft.personality === 'individual'
                    ? 'Persona física'
                    : draft.personality === 'company'
                      ? 'Persona moral'
                      : 'Personas físicas y morales'}
                </span>
              )}
            </div>
            <h2
              id="case-template-preview-title"
              className="mt-2 text-lg font-semibold text-slate-950 dark:text-foreground sm:text-xl"
            >
              {draft?.appearance.headerText || template.name}
            </h2>
            <p
              id="case-template-preview-description"
              className="mt-1 text-sm leading-5 text-slate-500"
            >
              {draft?.appearance.headerDescription || template.description || 'Sin descripción.'}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Cerrar vista previa"
            className="shrink-0 rounded-md p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-primary dark:hover:bg-muted"
          >
            <X size={18} />
          </button>
        </header>

        <div
          className="min-h-0 space-y-5 overflow-y-auto px-5 py-5 sm:px-6"
          style={draft ? { backgroundColor: draft.appearance.backgroundColor } : undefined}
        >
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <SummaryTile icon={ClipboardCheck} value={requirementCount} label="Requisitos" />
            <SummaryTile icon={FileText} value={documentCount} label="Documentos" />
            <SummaryTile icon={Layers3} value={formCount} label="Formularios" />
          </div>
          {draft ? (
            <>
              {draft.sections.map((section, index) => (
                <section
                  key={section.id}
                  className="overflow-hidden rounded-lg border border-slate-200 dark:border-border"
                >
                  <div
                    className={`flex items-start gap-3 border-b border-slate-100 bg-slate-50 px-4 ${draft.appearance.compactSpacing ? 'py-2' : 'py-3'} dark:border-border dark:bg-muted/40`}
                  >
                    {draft.appearance.showSectionNumbers && (
                      <span
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold text-white"
                        style={{ backgroundColor: draft.appearance.accentColor }}
                      >
                        {index + 1}
                      </span>
                    )}
                    <div>
                      <h3 className="text-sm font-semibold">{section.title}</h3>
                      {draft.appearance.showSectionDescriptions && section.description && (
                        <p className="mt-0.5 text-xs text-slate-500">{section.description}</p>
                      )}
                      {draft.experience.expireSections && section.dueInDays && (
                        <p className="mt-1 text-xs text-amber-700">
                          Vence a los {section.dueInDays} días desde apertura
                        </p>
                      )}
                    </div>
                  </div>
                  {section.items.length ? (
                    <ul className="divide-y divide-slate-100 dark:divide-border">
                      {section.items.map((item) => (
                        <li
                          key={item.id}
                          className={`px-4 ${draft.appearance.compactSpacing ? 'py-2' : 'py-3'}`}
                        >
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-sm font-medium">{item.title}</span>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-muted dark:text-muted-foreground">
                              {itemKindLabel[item.kind]}
                            </span>
                            <span
                              className={`text-[11px] ${item.required ? 'text-primary' : 'text-slate-400'}`}
                            >
                              {item.conditional
                                ? 'Condicional'
                                : item.required
                                  ? 'Obligatorio'
                                  : 'Opcional'}
                            </span>
                            {item.appliesTo !== 'both' && (
                              <span className="text-[11px] text-slate-500">
                                {item.appliesTo === 'individual'
                                  ? 'Persona física'
                                  : 'Persona moral'}
                              </span>
                            )}
                            {item.customizableAtLaunch && (
                              <span className="text-[11px] text-slate-500">Ajustable por caso</span>
                            )}
                            {draft.experience.expireElements && item.dueInDays && (
                              <span className="text-[11px] text-amber-700">
                                Vence a los {item.dueInDays} días
                              </span>
                            )}
                          </div>
                          {item.description && (
                            <p className="mt-1 text-xs leading-5 text-slate-500">
                              {item.description}
                            </p>
                          )}
                          {item.conditional && item.condition && (
                            <p className="mt-1 text-xs text-amber-700">
                              Aplica cuando: {item.condition}
                            </p>
                          )}
                          {item.sourceName && (
                            <p className="mt-1 text-xs text-slate-500">
                              Vinculado a: {item.sourceName}
                            </p>
                          )}
                          {item.kind !== 'form' && (
                            <p className="mt-1 text-xs text-slate-500">
                              {item.allowedFormats.join(', ')} · hasta {item.maxSizeMb} MB
                              {item.validityDays ? ` · vigencia de ${item.validityDays} días` : ''}
                              {item.requiresReview ? ' · revisión manual' : ''}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="px-4 py-5 text-sm text-slate-400">
                      Esta sección aún no tiene requisitos.
                    </p>
                  )}
                </section>
              ))}
              <section className="rounded-lg border border-slate-200 p-4 dark:border-border">
                <h3 className="text-sm font-semibold">
                  Verificaciones de identidad y cumplimiento
                </h3>
                {draft.verifications.length ? (
                  <ul className="mt-3 space-y-2">
                    {draft.verifications.map((item) => (
                      <li key={item.id} className="text-xs text-slate-600">
                        <span className="font-medium text-slate-900 dark:text-foreground">
                          {item.title}
                        </span>{' '}
                        · {item.subject} · {item.timing}
                        {item.required ? ' · Resultado requerido' : ''}
                        {draft.experience.expireElements && item.dueInDays
                          ? ` · vence a los ${item.dueInDays} días`
                          : ''}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">Sin verificaciones configuradas.</p>
                )}
              </section>
              <section className="rounded-lg border border-slate-200 p-4 dark:border-border">
                <h3 className="text-sm font-semibold">Etapas</h3>
                {draft.stages.length ? (
                  <ol className="mt-3 space-y-2">
                    {draft.stages.map((item, index) => (
                      <li key={item.id} className="text-xs text-slate-600">
                        {index + 1}.{' '}
                        <span className="font-medium text-slate-900 dark:text-foreground">
                          {item.title}
                        </span>
                        {item.conditional ? ' · Condicional' : ''}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">Sin etapas configuradas.</p>
                )}
              </section>
              {draft.experience.signAtClosure && (
                <section className="rounded-lg border border-slate-200 p-4 dark:border-border">
                  <h3 className="text-sm font-semibold">Firma de cierre del expediente</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {draft.experience.expireElements && draft.experience.signatureDueDays
                      ? `Vence a los ${draft.experience.signatureDueDays} días desde la apertura.`
                      : 'Sin vencimiento específico.'}
                  </p>
                </section>
              )}
              {draft.appearance.showFooter && (
                <p className="text-center text-xs text-slate-500">{draft.appearance.footerText}</p>
              )}
            </>
          ) : (
            <>
              <section>
                <h3 className="text-sm font-semibold">Requisitos documentales</h3>
                <ul className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 dark:divide-border dark:border-border">
                  {template.requirements.map((requirement) => (
                    <li key={requirement.name} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{requirement.name}</span>
                        <span className="text-xs text-slate-500">
                          {requirement.required ? 'Obligatorio' : 'Opcional'}
                        </span>
                      </div>
                      {requirement.description && (
                        <p className="mt-1 text-xs text-slate-500">{requirement.description}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
              {template.identityMethods.length > 0 && (
                <section className="rounded-lg border border-slate-200 p-4 dark:border-border">
                  <h3 className="text-sm font-semibold">Verificaciones de identidad</h3>
                  <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-muted-foreground">
                    {template.identityMethods.join(' · ')}
                  </p>
                </section>
              )}
              {template.milestones.length > 0 && (
                <section className="rounded-lg border border-slate-200 p-4 dark:border-border">
                  <h3 className="text-sm font-semibold">Etapas</h3>
                  <ol className="mt-2 space-y-1.5 text-xs text-slate-600 dark:text-muted-foreground">
                    {template.milestones.map((milestone, index) => (
                      <li key={milestone.title}>
                        {index + 1}. {milestone.title}
                      </li>
                    ))}
                  </ol>
                </section>
              )}
            </>
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3 dark:border-border dark:bg-card sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-border dark:text-foreground"
          >
            Cerrar
          </button>
          <button
            type="button"
            onClick={onAction}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {savedStatus === 'archived' ? (
              <RotateCcw size={15} />
            ) : savedStatus ? (
              <Pencil size={15} />
            ) : (
              <Plus size={15} />
            )}
            {actionLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}

function SummaryTile({
  icon: Icon,
  value,
  label,
}: {
  icon: LucideIcon;
  value: number;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-border dark:bg-muted/40">
      <span className="hidden rounded-md bg-blue-50 p-1.5 text-primary sm:inline-flex">
        <Icon size={15} />
      </span>
      <span>
        <strong className="block text-sm font-semibold tabular-nums">{value}</strong>
        <span className="text-[11px] text-slate-500">{label}</span>
      </span>
    </div>
  );
}
