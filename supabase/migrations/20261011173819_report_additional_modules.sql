ALTER TABLE public.report_definitions DROP CONSTRAINT report_definitions_dataset_check;
ALTER TABLE public.report_definitions ADD CONSTRAINT report_definitions_dataset_check
  CHECK (dataset IN ('documentos','plantillas','formularios','respuestas','expedientes','tareas','participantes','actividad','usuarios','contactos','certificaciones','notificaciones','colaboracion'));
