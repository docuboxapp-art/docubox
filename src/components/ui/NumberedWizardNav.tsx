'use client';

import { CheckCircle2 } from 'lucide-react';

export interface NumberedWizardStep {
  id: number;
  label: string;
}

interface NumberedWizardNavProps {
  steps: readonly NumberedWizardStep[];
  currentStep: number;
  onStepSelect?: (step: number) => void;
  className?: string;
}

export function NumberedWizardNav({
  steps,
  currentStep,
  onStepSelect,
  className = '',
}: NumberedWizardNavProps) {
  return (
    <nav
      aria-label="Progreso"
      className={`flex min-w-max items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 ${className}`}
    >
      {steps.map((step, index) => {
        const isActive = step.id === currentStep;
        const isCompleted = step.id < currentStep;
        const canSelect = isCompleted && Boolean(onStepSelect);

        return (
          <div key={step.id} className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => canSelect && onStepSelect?.(step.id)}
              disabled={!canSelect}
              aria-current={isActive ? 'step' : undefined}
              className={`flex h-8 items-center gap-2 rounded-md px-2.5 text-xs font-600 transition-colors sm:px-3 ${
                isActive
                  ? 'bg-white text-primary shadow-[0_1px_3px_rgba(15,23,42,0.12)]'
                  : isCompleted
                    ? 'cursor-pointer text-slate-700 hover:bg-white hover:text-primary'
                    : 'cursor-default text-slate-400'
              }`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-600 ${
                  isActive
                    ? 'bg-primary text-white'
                    : isCompleted
                      ? 'bg-primary/10 text-primary'
                      : 'bg-slate-200/70 text-slate-500'
                }`}
              >
                {isCompleted ? <CheckCircle2 size={13} /> : step.id}
              </span>
              <span>{step.label}</span>
            </button>
            {index < steps.length - 1 && (
              <div className={`h-px w-3 ${isCompleted ? 'bg-primary/50' : 'bg-slate-200'}`} />
            )}
          </div>
        );
      })}
    </nav>
  );
}
