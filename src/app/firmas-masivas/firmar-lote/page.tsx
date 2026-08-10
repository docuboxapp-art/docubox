'use client';

import { FileCheck2, KeyRound, PenTool, ShieldCheck } from 'lucide-react';
import { BulkSectionPage } from '../components/BulkSectionPage';

export default function BulkSigningPage() {
  return (
    <BulkSectionPage
      title="Firma por lote"
      description="Autoriza una sesion y firma cada documento de forma criptograficamente independiente."
      actions={[
        {
          title: 'Documentos listos para firma',
          description: 'Revisa contenido, hash y participantes antes de autorizar.',
          icon: FileCheck2,
          status: 'Revision requerida',
        },
        {
          title: 'Nueva sesion de firma',
          description: 'Crea una autorizacion temporal para los documentos seleccionados.',
          icon: PenTool,
        },
        {
          title: 'Autorizar con e.firma',
          description: 'La llave y contrasena se usan temporalmente y nunca se almacenan.',
          icon: KeyRound,
        },
        {
          title: 'Historial de sesiones',
          description: 'Consulta resultados individuales, excepciones y evidencia.',
          icon: ShieldCheck,
        },
      ]}
    />
  );
}
