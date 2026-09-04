import { LockKeyhole } from 'lucide-react';

type LegalHoldBadgeProps = {
  className?: string;
};

export function LegalHoldBadge({ className = '' }: LegalHoldBadgeProps) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-700 text-amber-800 ${className}`}
      title="Este documento está protegido mediante Legal Hold. No puede moverse a Papelera ni eliminarse mientras el bloqueo permanezca activo."
    >
      <LockKeyhole size={11} aria-hidden="true" />
      Legal Hold
    </span>
  );
}
