# Docubox Colabora - inventario de implementacion

## Segunda fase local

Los pendientes de workers, acciones masivas de tareas y exportaciones tienen implementación y pruebas aisladas. Se añadieron paginación y filtros de tareas, revalidación de permisos por acción, mutación e historial en transacción, notificación agrupada de reasignaciones y descargas CSV/PDF/XLSX. La [evidencia y los pendientes actuales](../organization/completion-second-phase.md) distinguen este código de la activación SQL y de la cobertura global que aún falta.

## Revisión funcional del 17 de noviembre de 2026

El estado siguiente distingue el código local de la activación en Supabase. La migración
`20261118005751_colabora_request_forms_and_delivery.sql` **todavía no está aplicada en el proyecto**.
El conector SQL agotó el tiempo de conexión y la CLI respondió 403 por permisos insuficientes.
Las validaciones remotas históricas documentadas más abajo no cubren esta migración.

- Formularios: bandeja propia en Colabora, búsqueda, estados, solicitudes vinculadas y acceso
  al visor de respuestas existente. Los conteos se agregan en PostgreSQL con los permisos del
  usuario; no se descargan respuestas para contarlas ni se depende del límite REST de 1,000 filas.
- Solicitudes: múltiples requisitos, formularios publicados, documentos para firma, orden inicial,
  edición de pendientes, incorporación de entregas, responsable delegado, invitaciones y renovación.
- Portal: correo con OTP, desafíos de un solo uso, límites de envío e intentos, archivos versionados,
  formularios privados y firma mediante los procesos canónicos existentes.
- Revisión: creación y decisiones en transacciones, control de versión, comentarios bloqueantes,
  revisión de archivos con análisis limpio y cierre sin omitir requisitos obligatorios.
- Salas: invitaciones con plantilla de organización, revocación al renovar, políticas de descarga,
  marca de agua y comentarios del invitado visibles para el equipo y para su propio autor.
- Equipos y permisos: referencias activas del mismo espacio, lecturas con RLS y comprobación del
  alcance del usuario antes de las mutaciones privilegiadas. No se activan planes automáticamente.
- Calendario y reportes: filtros de estado, cierre de hitos independientes, navegación a recursos y
  conteos completos. Diálogos, mensajes y controles adaptados al lenguaje visual del proyecto.

Verificación reproducible:

Resultado local: 57 pruebas automatizadas de dominio, API y PostgreSQL aislado, y 28
comprobaciones del navegador. Las 15 secciones se cargaron y se revisó el desbordamiento en
390 y 820 píxeles. ESLint y TypeScript del alcance de Colabora pasaron sin errores.

```powershell
npm install --prefix .tmp/colabora-db-qa --no-save --ignore-scripts @electric-sql/pglite@0.5.16
npm install --prefix .tmp/organization-browser-qa --no-save --ignore-scripts playwright-core@1.65.1
npm run test:colabora
npm run test:colabora:interface
```

La prueba de interfaz usa Chromium headless ya instalado en la caché de Playwright de Windows.
Las dependencias de QA permanecen fuera de las dependencias de producción. Las pruebas usan
contextos y bases aislados, destinatarios `example.invalid` y datos sintéticos. No envían correo,
no verifican biometría y no realizan firmas reales. TypeScript se comprueba con el alcance de
Colabora y sus dependencias; no se ejecutó un build global sobre los cambios previos del repositorio.

Pendiente para declarar operación completa: restablecer acceso SQL, inspeccionar el esquema real,
aplicar la migración, comprobar RLS y los triggers junto con las migraciones existentes, y recorrer
el flujo autenticado con almacenamiento, escáner y correo reales. No se desplegó esta entrega.

## Reutilizacion

| Capacidad          | Implementacion existente                                             | Decision                                                          |
| ------------------ | -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Tenant y membresia | `workspaces`, `workspace_members`, `WorkspaceContext`                | Conservar y exigir organizacion activa                            |
| Roles y permisos   | `organization_permissions`, roles y `has_organization_permission`    | Extender con permisos `collaboration.*`                           |
| Documentos         | `documentos`, visor y rutas de firma                                 | Referenciar; no duplicar archivos ni procesos de firma            |
| Tareas             | `tareas`, checklist, comentarios, adjuntos, historial y dependencias | Extender para SLA, espacios y control optimista                   |
| Expedientes        | `case_files` y sus versiones/documentos                              | Referenciar desde espacios y solicitudes                          |
| Notificaciones     | `notifications`                                                      | Conservar y emitir eventos deduplicados desde backend             |
| Auditoria          | `organization_audit_events` con cadena SHA-256                       | Conservar como registro canonico sensible                         |
| Suscripcion        | `subscriptions`, `subscription_plans`, uso y centros de costo        | Conservar plan base; agregar suscripcion de add-on y entitlements |
| Almacenamiento     | Buckets privados y URLs firmadas                                     | Reutilizar; no crear almacenamiento publico                       |

## Brechas

- Contrato de `entitlements` por organizacion y modo de solo lectura.
- Configuracion inicial e idempotencia de activacion.
- Versiones documentales generales, rondas, comentarios con audiencia y anotaciones.
- Espacios colaborativos, hitos, solicitudes y actividad operativa.
- Salas externas, invitados y sesiones separadas de miembros.
- Automatizaciones versionadas, ejecuciones idempotentes y reportes.

## Migraciones implementadas

1. `20260816110000_colabora_entitlements_and_access.sql`
2. `20260816120000_colabora_tasks_and_reviews.sql`
3. `20260816130000_colabora_spaces_and_requests.sql`
4. `20260816140000_colabora_external_and_automation.sql`
5. `20260816150000_colabora_request_external_access.sql`
6. `20260816160000_colabora_room_resource_order.sql`
7. `20260816170000_colabora_usage_metering.sql`
8. `20260816180000_colabora_request_file_incorporation.sql`
9. `20260816190000_colabora_automation_event_queue.sql`
10. `20260816200000_colabora_document_integration.sql`
11. `20260816210000_colabora_automation_side_effect_idempotency.sql`
12. `20260816220000_colabora_commercial_tiers.sql`
13. `20260816230000_webauthn_qr_tokens_rls.sql`
14. `20260816240000_document_dek_diagnostics_security.sql`

Todas son aditivas. No eliminan ni renombran columnas historicas.

## Rutas

- `/colabora`, `/colabora/tareas`, `/colabora/revisiones`, `/colabora/espacios`
- `/colabora/calendario`, `/colabora/actividad`, `/colabora/solicitudes`
- `/colabora/salas`, `/colabora/automatizaciones`, `/colabora/reportes`
- `/colabora/configuracion`, rutas de detalle y `/sala/[publicToken]`
- `/documentos/[documentId]/revision` y `/documentos/[documentId]/versiones`

## Seguridad

Acceso efectivo = organizacion activa + membresia activa + entitlement vigente + permiso. La misma regla se aplica en navegacion, API y RLS. Los estados suspendido, cancelado o expirado preservan evidencia y solo permiten lectura autorizada. Los tokens externos se almacenan como hash.

Las migraciones de cierre fuerzan RLS sobre `webauthn_qr_tokens`, reservan su acceso al backend con
`service_role` y restringen la vista diagnostica de DEK a procesos internos. El asesor de seguridad de
Supabase queda sin hallazgos de severidad `ERROR`; permanecen advertencias heredadas que deben
resolverse de forma incremental para no alterar funciones historicas.

## Estado funcional

- Activacion base y Pro desde App Market, configuracion inicial y acceso efectivo por tenant.
- Tareas, revisiones, versiones, espacios, calendario, actividad y solicitudes.
- Salas externas con OTP, aceptacion de terminos, permisos por recurso y Storage privado.
- Archivos de solicitudes con hash, escaneo antimalware fail-closed e incorporacion idempotente al repositorio documental.
- Automatizaciones versionadas con prueba sin efectos, cola por eventos, reintentos con backoff,
  profundidad maxima y efectos idempotentes.
- Version inicial de Colabora creada al enviar un documento cuando la organizacion tiene el
  entitlement activo; conserva hash y ruta privada sin duplicar el archivo.
- Espacios conectados con documentos, formularios, plantillas y expedientes canonicos del mismo
  tenant.
- Reportes operativos JSON/CSV y funciones Pro de negociacion, comites y cierres.
- LucIA reutilizada con control de entitlement y medicion de solicitudes de IA.
- Limites de uso aplicados en base de datos para evitar carreras y omisiones del frontend.
- Dos niveles comerciales canonicos sobre el mismo modulo: Docubox Colabora y Docubox Colabora Pro.
- Colabora Pro incluye Standard sin mantener dos suscripciones base activas; el downgrade suspende
  capacidades Pro, revoca sesiones externas y conserva sus datos historicos.
- Analitica `basic` para Standard y `advanced` para Pro, con bloqueo previo a consultas Pro.
- Comparaciones de versiones medidas de forma transaccional e idempotente desde backend.

## Dependencias operativas

| Dependencia              | Configuracion                                                                | Comportamiento sin configurar                                   |
| ------------------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Supabase                 | Aplicar migraciones en orden y conservar RLS                                 | El modulo no puede operar                                       |
| Escaner antimalware      | `METADEFENDER_API_KEY` o proveedor privado `COLABORA_MALWARE_SCAN_*`         | Los archivos no se pueden aprobar                               |
| Correo OTP               | Credenciales de Resend ya usadas por Docubox                                 | Las salas y solicitudes externas no pueden autenticar invitados |
| Storage                  | Buckets privados y service role solo en servidor                             | Las descargas protegidas fallan cerradas                        |
| Worker de automatizacion | `CRON_SECRET` y una llamada programada a `/api/colabora/automations/process` | La cola conserva ejecuciones pendientes sin procesarlas         |

## Preparacion de produccion

- MetaDefender Cloud esta conectado desde backend mediante consulta por SHA-256, carga controlada,
  polling acotado y resultado fail-closed. La clave se conserva solo en Vercel.
- `CRON_SECRET` esta configurado en produccion y `vercel.json` programa el worker diariamente, que
  es la frecuencia admitida por el plan Hobby actual. El endpoint admite mayor frecuencia al usar
  Vercel Pro o un planificador privado.
- TypeScript se valida globalmente durante el build y la cadena de dependencias queda sin
  vulnerabilidades conocidas reportadas por `npm audit`.

## Pendientes de salida controlada

- Ejecutar cargas E2E autenticadas limpia, infectada y con proveedor caido usando archivos de prueba
  aprobados para ese fin.
- Completar regresion visual y funcional en escritorio y movil.
- Ampliar exportacion a PDF/XLSX solo cuando se defina la plantilla corporativa y el volumen maximo.

## Validacion remota

- Proyecto Supabase enlazado: `kbjejiclhgjmiasauxyr`.
- Migraciones comerciales y de seguridad aplicadas en orden.
- Contratos de planes, entitlements, RLS, RPC backend-only y aislamiento de datos: aprobados.
- Pruebas unitarias de Organization, Colabora y MetaDefender: 27 de 27 aprobadas.
- Asesor de seguridad de Supabase: 0 hallazgos `ERROR`; las advertencias heredadas se mantienen en
  remediacion incremental para evitar regresiones en funciones historicas.
