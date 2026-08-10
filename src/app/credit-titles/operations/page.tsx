'use client';

import { SlidersHorizontal } from 'lucide-react';
import { CreditTitleSection } from '../components/CreditTitleSection';
export default function OperationsPage() {
  return (
    <CreditTitleSection
      title="Operaciones"
      description="Consulta pagos, vencimientos, cancelaciones y actos que modifican el ciclo de vida."
      icon={SlidersHorizontal}
      items={[
        {
          title: 'Pagos y liquidaciones',
          detail: 'Registro de saldo anterior, importe y saldo nuevo con control de idempotencia.',
          status: 'Fase 2',
        },
        {
          title: 'Endosos y tenencia',
          detail: 'Transferencias atomicas con version esperada y un solo tenedor actual.',
          status: 'Fase 3',
        },
        {
          title: 'Avales',
          detail: 'Garantias totales o parciales vinculadas a identidad y firma.',
          status: 'Fase 5',
        },
      ]}
    />
  );
}
