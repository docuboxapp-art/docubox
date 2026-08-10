'use client';

import { Copy, FilePlus2, Layers3, Package } from 'lucide-react';
import { BulkSectionPage } from '../components/BulkSectionPage';

export default function BulkTemplatesPage() {
  return (
    <BulkSectionPage
      title="Plantillas de campana"
      description="Reutiliza configuraciones sin copiar el motor de plantillas documentales."
      actions={[
        {
          title: 'Crear plantilla de campana',
          description: 'Guarda origen, participantes, workflow, identidad y notificaciones.',
          icon: FilePlus2,
        },
        {
          title: 'Documento compartido',
          description: 'Configuracion para crear una instancia individual por destinatario.',
          icon: Layers3,
        },
        {
          title: 'Paquete documental',
          description: 'Agrupa documentos y define el orden de firma del paquete.',
          icon: Package,
        },
        {
          title: 'Duplicar campana anterior',
          description: 'Copia la configuracion, nunca los documentos ni su evidencia.',
          icon: Copy,
        },
      ]}
    />
  );
}
