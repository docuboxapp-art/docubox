'use client';

import { BellRing, Gauge, KeyRound, ShieldCheck } from 'lucide-react';
import { BulkSectionPage } from '../components/BulkSectionPage';

export default function BulkSettingsPage() {
  return (
    <BulkSectionPage
      title="Configuracion"
      description="Limites, seguridad y politicas predeterminadas para operaciones masivas."
      actions={[
        {
          title: 'Procesamiento por lotes',
          description: 'Tamano predeterminado: 50 documentos. Maximo configurable: 500.',
          icon: Gauge,
        },
        {
          title: 'Permisos y acciones sensibles',
          description: 'Controla crear, lanzar, pausar, descargar, cerrar y firmar por lote.',
          icon: ShieldCheck,
        },
        {
          title: 'Metodos de firma',
          description: 'Define metodos permitidos sin almacenar secretos de e.firma.',
          icon: KeyRound,
        },
        {
          title: 'Notificaciones y webhooks',
          description: 'Configura recordatorios, eventos y reintentos de entrega.',
          icon: BellRing,
        },
      ]}
    />
  );
}
