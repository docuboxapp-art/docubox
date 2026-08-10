'use client';

import { Settings2 } from 'lucide-react';
import { CreditTitleSection } from '../components/CreditTitleSection';
export default function SettingsPage() {
  return (
    <CreditTitleSection
      title="Configuracion"
      description="Define politicas de folio, identidad, firma, evidencia y permisos por espacio de trabajo."
      icon={Settings2}
      items={[
        {
          title: 'Politicas de identidad y firma',
          detail: 'Niveles recomendados por importe y participante.',
          status: 'Preparado',
        },
        {
          title: 'Servicios criptograficos',
          detail:
            'TSA, NOM-151 y KMS se marcan validos solo cuando la infraestructura real responde.',
          status: 'Preparado',
        },
        {
          title: 'Permisos y feature flags',
          detail: 'Activacion progresiva para emision, carteras y endosos.',
          status: 'Preparado',
        },
      ]}
    />
  );
}
