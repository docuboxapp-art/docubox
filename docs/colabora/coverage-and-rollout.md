# Docubox Colabora - cobertura y salida controlada

> Actualización del 17 de noviembre de 2026: las nuevas conexiones de formularios y solicitudes
> están implementadas y verificadas localmente. Su migración está pendiente por falta de acceso
> SQL operativo a Supabase; no se deben considerar habilitadas ni verificadas en producción.
> Consulta el inventario para el alcance, las pruebas reproducibles y los pendientes remotos.

## Cobertura de pantallas

La especificacion enumera `COL-00` a `COL-18`: son 19 experiencias funcionales. Los 20 puntos del documento son criterios de aceptacion, no 20 rutas independientes.

| ID      | Clasificacion  | Experiencia                | Ruta o integracion                                                          | Estado                                           |
| ------- | -------------- | -------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------ |
| COL-00  | COMPARTIDA     | Activacion y configuracion | `/app-market`, `/colabora/configuracion-inicial`, `/colabora/configuracion` | Implementada                                     |
| COL-01  | COLABORA       | Centro de trabajo          | `/colabora`                                                                 | Implementada                                     |
| COL-02  | COLABORA       | Bandeja de tareas          | `/colabora/tareas`                                                          | Implementada; faltan vistas masivas avanzadas    |
| COL-03  | COLABORA       | Detalle de tarea           | `/colabora/tareas/:id`                                                      | Implementada                                     |
| COL-04  | COLABORA       | Bandeja de revisiones      | `/colabora/revisiones`                                                      | Implementada                                     |
| COL-05  | COLABORA       | Estudio de revision        | `/documentos/:id/revision`                                                  | Implementada                                     |
| COL-06  | COLABORA       | Versiones                  | `/documentos/:id/versiones`                                                 | Implementada; comparacion medida e idempotente   |
| COL-07  | COLABORA       | Espacios                   | `/colabora/espacios`                                                        | Implementada                                     |
| COL-08  | COLABORA       | Detalle de espacio         | `/colabora/espacios/:id`                                                    | Implementada con recursos canonicos              |
| COL-09  | COLABORA       | Calendario                 | `/colabora/calendario`                                                      | Implementada                                     |
| COL-10  | COLABORA       | Actividad                  | `/colabora/actividad`                                                       | Implementada                                     |
| COL-11  | COLABORA       | Solicitudes                | `/colabora/solicitudes`                                                     | Implementada                                     |
| COL-12  | COLABORA       | Detalle de solicitud       | `/colabora/solicitudes/:id`, `/solicitud/:token`                            | Implementada                                     |
| COL-13  | COLABORA PRO   | Salas externas             | `/colabora/salas`, `/colabora/salas/:id`                                    | Implementada con bloqueo previo a datos          |
| COL-14  | COLABORA PRO   | Portal externo             | `/sala/:token`                                                              | Implementada                                     |
| COL-15  | COLABORA PRO   | Automatizaciones           | `/colabora/automatizaciones`, detalle y worker interno                      | Implementada con cola, reintentos e idempotencia |
| COL-15P | COLABORA PRO   | Flujos avanzados           | Recursos Pro bajo `/colabora`                                               | Implementada                                     |
| COL-16  | MIXTA          | Reportes                   | `/colabora/reportes`                                                        | Basico Standard; SLA y salas solo Pro            |
| COL-17  | COLABORA PRO   | Funciones Pro              | negociaciones, comites y cierres bajo `/colabora`                           | Implementada con `PRO_PLAN_REQUIRED`              |
| COL-18  | COLABORA PRO   | LucIA                      | asistente global existente con gating de Colabora                           | Integrada, sin asistente duplicado               |

## Orden de salida recomendado

La [segunda fase de implementación](../organization/completion-second-phase.md) añade tareas paginadas, acciones masivas, revalidación de workers y exportaciones CSV/PDF/XLSX. Las nuevas migraciones todavía no están activadas en Supabase.

La primera fase de alcances de roles ya tiene código y pruebas aisladas, pero sigue pendiente su activación SQL. Consultar [cobertura, evidencia y pendientes](../organization/resource-scopes-first-phase.md) antes de desplegar. Las migraciones nuevas deben aplicarse y comprobarse antes que el código que depende de ellas.

1. Mantener las migraciones aplicadas en Supabase y ejecutar los contratos SQL en cada nueva entrega.
2. Mantener el worker diario de Vercel Cron y, antes de habilitar automatizaciones sensibles al
   tiempo, migrar a Vercel Pro o conectar un planificador privado con mayor frecuencia.
3. Ejecutar la prueba E2E del escaner MetaDefender con archivos controlados: limpio, infectado,
   alterado y proveedor caido.
4. Validar dos tenants, un miembro suspendido y un add-on vencido en solo lectura.
5. Ejecutar los recorridos E2E de tareas, revision, solicitud externa, sala y automatizacion.
6. Activar primero para una organizacion piloto con limites conservadores.
7. Observar errores, latencia, uso y auditoria antes de habilitar Colabora Pro.

## Funciones que deben permanecer deshabilitadas hasta configurar infraestructura

- Aprobacion de archivos externos si el escaner no responde.
- Automatizaciones no incluidas en la lista permitida del backend.
- Acciones legales o de firma iniciadas por LucIA.
- Declaraciones de operacion productiva si una migracion futura o sus politicas RLS no han sido probadas.

## Rollback no destructivo

- Desactivar los entitlements de Colabora o marcar la suscripcion como suspendida.
- Conservar tablas, archivos, auditoria y evidencia en modo de solo lectura.
- Pausar automatizaciones y revocar sesiones externas activas.
- No eliminar migraciones, registros historicos ni referencias canonicas a documentos.
