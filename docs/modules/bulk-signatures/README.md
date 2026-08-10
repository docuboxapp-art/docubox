# Firmas Masivas

Firmas Masivas es una capa de orquestacion sobre el motor documental y de firma existente de Docubox. Una campana agrupa operaciones, pero cada elemento conserva un `document_id`, participantes, workflow, firma, evidencia, hash y constancia independientes.

## Implementado

- Producto seleccionable en App Market.
- Navegacion condicional en barra superior y menu lateral.
- Dashboard de campanas con KPIs, busqueda, estados y progreso.
- Wizard de cuatro pasos para crear campanas.
- Monitor operativo con documentos, participantes, incidencias, evidencia y reportes.
- Vistas para importaciones, firma por lote, plantillas y configuracion.
- APIs autenticadas para listar, crear, consultar y actualizar campanas.
- Modelo SQL con RLS, indices, idempotencia, jobs, incidencias, manifest y sesiones de firma por lote.
- Contingencia local para revisar la experiencia antes de aplicar la migracion.

## Reutilizacion del motor Docubox

El modulo no firma ni genera evidencia por cuenta propia. Los workers de ejecucion deben crear o relacionar un registro en `documentos` por cada `bulk_campaign_item` y delegar el resto del ciclo a las APIs y servicios existentes.

## Activacion de backend

Aplicar `supabase/migrations/20260808030000_bulk_signatures.sql` en el proyecto Supabase. Hasta entonces, la interfaz usa datos locales de referencia y permite guardar borradores en el navegador.

## Siguiente fase tecnica

Conectar un worker asincrono a `bulk_campaign_jobs` para consumir lotes, crear documentos mediante el servicio actual, registrar el `document_id` y avanzar cada elemento de forma idempotente. Los errores deben crear una incidencia recuperable sin modificar los demas elementos.
