-- Update document DOC-2026-W6F99B to 'completado'
UPDATE public.documentos
SET
  estado = 'completado',
  fecha_completado = COALESCE(fecha_completado, NOW())
WHERE id = '2f9b7a41-0a77-4e52-81b5-10e13bc49d5c';
