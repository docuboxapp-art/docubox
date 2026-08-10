'use client';

import { FileCheck2, FileSpreadsheet, History, ListChecks } from 'lucide-react';
import { BulkSectionPage } from '../components/BulkSectionPage';

export default function BulkImportsPage() {
  return (
    <BulkSectionPage
      title="Importaciones"
      description="Prepara y valida las fuentes de datos antes de generar documentos."
      actions={[
        {
          title: 'Nueva importacion CSV o Excel',
          description: 'Carga registros, detecta encabezados y crea un mapeo reutilizable.',
          icon: FileSpreadsheet,
        },
        {
          title: 'Centro de validacion',
          description: 'Revisa correos, variables faltantes, duplicados y filas bloqueadas.',
          icon: ListChecks,
        },
        {
          title: 'Archivos validados',
          description: 'Consulta importaciones listas para asociarse a una campana.',
          icon: FileCheck2,
        },
        {
          title: 'Historial',
          description: 'Audita quien importo, valido y proceso cada archivo.',
          icon: History,
        },
      ]}
    />
  );
}
