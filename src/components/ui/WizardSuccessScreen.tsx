'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';

interface WizardSuccessScreenProps {
  title: string;
  description: string;
  destination: string;
  destinationLabel: string;
}

export default function WizardSuccessScreen({
  title,
  description,
  destination,
  destinationLabel,
}: WizardSuccessScreenProps) {
  const router = useRouter();
  const [countdown, setCountdown] = useState(3);

  useEffect(() => {
    const interval = window.setInterval(
      () => setCountdown((seconds) => Math.max(0, seconds - 1)),
      1000
    );
    const redirect = window.setTimeout(() => router.replace(destination), 3000);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(redirect);
    };
  }, [destination, router]);

  return (
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center bg-slate-100 p-4"
      role="status"
      aria-live="polite"
    >
      <div className="flex w-full max-w-lg flex-col items-center rounded-lg border border-slate-200 bg-white px-8 py-10 text-center shadow-[0_18px_50px_rgba(15,23,42,0.12)]">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
          <Check size={32} strokeWidth={2.5} className="text-emerald-600" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-semibold text-slate-950">{title}</h1>
        <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">{description}</p>
        <div className="mt-7 flex w-full items-center justify-between gap-4 border-t border-slate-200 pt-5">
          <p className="text-left text-xs text-slate-500">
            Irás a {destinationLabel} en{' '}
            <span className="font-semibold text-emerald-600">{countdown}</span> segundo
            {countdown !== 1 ? 's' : ''}.
          </p>
          <button
            type="button"
            onClick={() => router.replace(destination)}
            className="flex h-9 shrink-0 items-center rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
          >
            Ir ahora
          </button>
        </div>
      </div>
    </div>
  );
}
