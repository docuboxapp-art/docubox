'use client';

import { BriefcaseBusiness } from 'lucide-react';
import { CreditTitleSection } from '../components/CreditTitleSection';
export default function PortfoliosPage() {
  return (
    <CreditTitleSection
      title="Carteras"
      description="Agrupa pagares para controlar valor nominal, saldo, vencimiento y tenencia."
      icon={BriefcaseBusiness}
      items={[
        {
          title: 'Carteras por moneda y propietario',
          detail:
            'El modelo soporta etiquetas, propietario y relacion muchos a muchos con titulos.',
          status: 'Fase 4',
        },
        {
          title: 'Operaciones masivas',
          detail: 'Preparado para importacion, endosos y reportes sin emitir automaticamente.',
          status: 'Fase 4',
        },
      ]}
    />
  );
}
