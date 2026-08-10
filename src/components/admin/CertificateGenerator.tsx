'use client';

import { ShieldCheck } from 'lucide-react';

export default function CertificateGenerator() {
  return (
    <section className="w-full max-w-xl rounded-lg border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <ShieldCheck size={20} aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-foreground">Proveedor criptografico administrado</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            La generacion local de certificados esta deshabilitada. Las llaves de firma deben crearse y
            permanecer dentro del proveedor KMS/HSM configurado para Docubox.
          </p>
        </div>
      </div>
    </section>
  );
}
