'use client';

import { FilePlus2 } from 'lucide-react';
import { CreditTitleSection } from '../components/CreditTitleSection';
export default function TemplatesPage() {
  return (
    <CreditTitleSection
      title="Plantillas de pagare"
      description="Conserva politicas reutilizables de texto, intereses, identidad, firma y evidencia."
      icon={FilePlus2}
      items={[
        {
          title: 'Pagare PyME',
          detail: 'Base para credito comercial entre empresas.',
          status: 'Disponible pronto',
        },
        {
          title: 'Pagare de arrendamiento',
          detail: 'Vinculacion con contrato y calendario de vencimientos.',
          status: 'Disponible pronto',
        },
        {
          title: 'Pagare automotriz',
          detail: 'Preparado para aval, referencias y documentos vinculados.',
          status: 'Disponible pronto',
        },
      ]}
    />
  );
}
