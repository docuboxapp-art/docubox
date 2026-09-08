# Fase 3.5 - Estabilizacion operativa LucIA

Fecha de auditoria: 2026-09-05
Proyecto Supabase enlazado: `kbjejiclhgjmiasauxyr`
Alcance: auditoria, recomendacion y ajuste de estado de producto. No se aplicaron migraciones, cambios RLS, permisos ni middleware.

## 1. Resumen ejecutivo

Fase 1-3 sigue compilando y conserva sus contratos de seguridad, pero Fase 3.5 no debe cerrarse todavia. Hay cuatro bloqueos operativos:

1. Notificaciones certificadas, Firmas masivas y Titulos de credito tienen rutas, menus y codigo de lectura/escritura, pero ninguna de sus 28 tablas esperadas existe en el remoto. Las UI ocultan el fallo con demos o `localStorage`.
2. El historial remoto marca como aplicadas las migraciones originales de esos modulos. No existe una migracion posterior local que explique su eliminacion. Reaplicar los archivos antiguos no ocurrira automaticamente y restaurarlos sin revision reintroduciria ACL demasiado amplias.
3. La migracion pendiente de purga corrige una divergencia real para borradores, pero esta fuera de orden y reemplaza una funcion critica completa. No debe aplicarse con `--include-all` sin endurecerla y probar el flujo de almacenamiento en staging.
4. Las cuatro tablas auxiliares estan cerradas por privilegios a `service_role`, pero permanecen en `public` sin RLS. Ademas existe un overload publico de `check_rate_limit(text,text,integer,integer,text)` que no usa `rate_limits`, sino `rate_limit_counters`, y debe auditarse aparte.

Decision de producto (Fase 3.6): mantener visibles los tres modulos del roadmap, declararlos `in_development`, conservar sus RPC con `SCHEMA_UNAVAILABLE` y separar en LucIA las preguntas de diseño de las consultas operativas. Los datos demo quedan identificados y excluidos de produccion.

Validacion ejecutada:

| Control                           | Resultado                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| `npm run type-check`              | Correcto                                                                                  |
| `npm run build`                   | Correcto, 220 rutas; advertencia no bloqueante por deprecacion de `middleware.ts`         |
| Fases 1, 2 y 3                    | 32/32 pruebas correctas                                                                   |
| Suite ampliada con papelera/purga | 54/54 pruebas correctas despues de corregir una referencia de archivo en el test          |
| Endpoints AI sin sesion           | 4/4 responden 401 `UNAUTHORIZED`                                                          |
| JWT expirado                      | 401 `TOKEN_EXPIRED`                                                                       |
| Token crudo, PII y RAG ACL        | Cubiertos y correctos en la suite automatizada                                            |
| Contrato RPC remoto               | 10/10: anon/service cerrados, authenticated habilitado, `search_path` vacio               |
| ESLint focalizado                 | 0 errores, 19 advertencias preexistentes `no-explicit-any`                                |
| `git diff --check`                | Correcto; solo avisos de conversion LF/CRLF                                               |
| Sesion real multiusuario          | Bloqueada por falta de fixtures: no hay admin, expedientes, participantes ni invitaciones |

## 2. Estado de esquemas faltantes

| Modulo                      |             Rutas | Menu/App Market                  | Frontend conectado                                                                                 | Esquema remoto                                                        | Estado real                        |
| --------------------------- | ----------------: | -------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------- |
| Notificaciones certificadas |        5 UI + API | Activable como `notifica`        | Lee/escribe `certified_notifications` y tablas `notification_*`; usa demo/local al fallar          | 0 de 8 tablas                                                         | Visible pero no operativo          |
| Firmas masivas              | 7 UI + 2 API base | Activable como `bulk-signatures` | Lista y detalle consultan campañas; creacion escribe por API; varias subsecciones son descriptivas | 0 de 9 tablas del archivo original; 0 de 6 requeridas por RPC/UI base | Prototipo visible, backend ausente |
| Titulos de credito          |      8 UI + 5 API | Activable como `credit-titles`   | Lista/detalle/creacion/verificacion; usa demos/local al fallar                                     | 0 de 11 tablas                                                        | Prototipo de alto riesgo visible   |

Las migraciones `20260808010000`, `20260808020000` y `20260808030000` figuran aplicadas en `supabase_migrations.schema_migrations` y conservan 30, 57 y 39 sentencias respectivamente. Sus archivos locales existen. No se encontro un `DROP TABLE` posterior en las migraciones locales, por lo que hay deriva entre historial y esquema fisico. Las sentencias remotas son recuperables para comparacion; no es necesario inventar el esquema.

No conviene crear un esquema minimo read-only: las pantallas principales exponen botones de creacion/publicacion y las API contienen escrituras. Un subconjunto read-only mantendria una experiencia parcialmente falsa y no resolveria las transacciones de dominio.

## 3. Recomendacion para Notificaciones certificadas

Recomendacion actualizada: **C en desarrollo controlado, seguida de D con endurecimiento cuando el esquema funcional sea aprobado**.

- Mantener visible el modulo con estado "En construccion". Mantener la RPC con `SCHEMA_UNAVAILABLE` para no fingir evidencia operativa.
- Reconstruir una nueva migracion de restauracion comparando el archivo local con las sentencias almacenadas en remoto; no reparar el historial ni volver a marcar la migracion antigua.
- Antes de restaurar, sustituir las politicas `FOR ALL TO authenticated` basadas solo en membresia. Actualmente cualquier miembro del workspace podria escribir todas las filas del modulo.
- Conservar token hash, expiracion y revocacion: este modulo ya persiste `token_hash` y resuelve el token crudo solo en memoria.
- Eliminar el fallback de datos demo en ambientes no locales o mostrar un estado explicito de modulo no disponible.

No se recomienda A como esquema minimo porque publicar, destinatarios, canales, eventos y tokens forman una sola operacion coherente.

## 4. Recomendacion para Firmas masivas

Recomendacion actualizada: **C + E; despues D por etapas**.

- Mantener activacion y navegacion con estado visible "En construccion". La referencia local solo puede mostrarse como "Datos de ejemplo" fuera de produccion.
- Cerrar primero el modelo funcional de permisos: crear, lanzar, pausar, descargar, cerrar y firmar no pueden depender solo de pertenecer al workspace.
- Separar restauracion en: catalogos/configuracion read-only, campañas e items, importaciones, y finalmente sesiones/ejecucion. Cada etapa debe tener RLS por capacidad y API de dominio.
- No aplicar la migracion antigua tal cual: crea politicas `FOR ALL TO authenticated` para miembros, incompatibles con el objetivo de seguridad empresarial.
- Mantener `get_lucia_batch_signature_context` con `SCHEMA_UNAVAILABLE` hasta que exista una fuente autorizada real.

## 5. Recomendacion para Titulos de credito

Recomendacion actualizada: **C + E**.

- Mantener visible el modulo como parte del roadmap, sin presentar demos como datos reales. La verificacion publica no debe habilitarse hasta completar el rediseno de identidad.
- Redisenar identidad publica antes de restaurar tablas. El esquema y API actuales guardan y consultan `public_token` crudo; contradice la politica de tokens por hash de Fase 1.
- Definir roles juridicos y ACL por operacion: creador, suscriptor, beneficiario, tenedor actual, aval, custodio y auditor no son equivalentes a miembro de workspace.
- Separar datos publicamente verificables del registro interno. La verificacion debe recibir token opaco, comparar hash, validar expiracion/revocacion/alcance y devolver solo folio, estado, hash canonico y evidencia publica minima.
- Revisar snapshots: el API actual construye objetos que pueden contener RFC y correo. LucIA no debe recibirlos salvo intent sensible autorizado.

No se recomienda restaurar `20260808020000_credit_titles.sql` sin este rediseno.

## 6. Analisis de migracion pendiente

Archivo: `supabase/migrations/20260904180000_allow_draft_purge_during_recovery.sql`.

Modifica unicamente `public.purge_document_bundle(uuid,uuid)` y sus `GRANT`. Mantiene como bloqueos Legal Hold y retencion activa; exige que el documento este en Papelera y que Storage ya se haya eliminado. El cambio funcional permite purgar antes de `restore_until` solo cuando `estado` identifica un borrador/preparacion. Los documentos no borrador conservan la ventana obligatoria.

Impacto:

- Documentos/Papelera: alinea PostgreSQL con `lifecycle-policy.ts`, donde los borradores conservan 30 dias para restaurar pero el owner puede purgarlos antes.
- Legal Hold: no se relaja.
- Retencion: no se relaja.
- Recuperacion: solo se vuelve opcional para borradores.
- Purga: reemplaza la funcion completa que elimina Storage primero y despues relaciones/documento mediante RPC.

Riesgo principal: el remoto aun tiene la regla anterior. La aplicacion puede considerar elegible un borrador, borrar sus objetos de Storage y luego recibir `document_purge_recovery_period` desde la RPC. Eso puede dejar el documento y tombstone sin archivo. La correccion es necesaria, pero no debe desplegarse en su forma actual sin control.

Recomendacion: **conservar y aplicar despues de una revision corta, no descartar**. Antes:

1. Renombrar/recrear la migracion con una version posterior a `20260905070112`; no usar `db push --include-all` para insertar historia fuera de orden.
2. Endurecer a `SET search_path = ''` y calificar todas las funciones/tablas/tipos. `service_role` debe seguir siendo el unico ejecutor.
3. Corregir la prueba que aun referencia `20260904064609...`, archivo inexistente.
4. Agregar prueba de integracion en staging para borrador, no borrador, Legal Hold, retencion activa, tombstone invalido, Storage fallido e idempotencia.
5. Evaluar invertir/compensar el orden Storage-RPC para evitar perdida parcial; como minimo, no marcar `STORAGE_REMOVED` hasta confirmar todos los objetos y registrar recuperacion operacional.

Resultado del dry-run: fallo esperado `LegacyDbPushMissingRemoteError`; la unica migracion local pendiente es `20260904180000` y esta situada antes de la ultima remota.

## 7. Analisis de RLS en tablas auxiliares

Estado remoto comun: owner `postgres`, RLS deshabilitado, sin politicas, sin `SELECT/INSERT/UPDATE/DELETE` para `anon` o `authenticated`, acceso total para `service_role`.

| Tabla           | Proposito                                             | Exposicion actual                                    | Recomendacion                                                                                  |
| --------------- | ----------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `rate_limits`   | Contador IP + endpoint por ventana y bloqueo temporal | Solo `postgres/service_role`; RPC inet solo service  | Mover a `private`; RLS como defensa adicional si permanece en `public`; sin politicas cliente  |
| `ip_blocklist`  | Bloqueos IP temporales/permanentes y motivo           | Solo `postgres/service_role`; check solo service     | Mover a `private`; conservar gestion backend; auditar accesos administrativos por API separada |
| `auth_attempts` | Bitacora de intentos por identificador/IP y resultado | Solo `postgres/service_role`; contiene dato sensible | Prioridad alta para `private`; retencion/borrado programado; nunca lectura cliente             |
| `auth_lockouts` | Estado y escalamiento de bloqueo por identificador    | Solo `postgres/service_role`                         | Mover a `private`; solo backend; RLS sin politicas si temporalmente queda en `public`          |

Habilitar RLS sin politicas no rompe al `service_role` porque bypassa RLS, pero puede afectar tareas ejecutadas bajo otro rol. Por eso debe confirmarse primero el inventario de jobs, Edge Functions y conexiones directas. La politica objetivo no es crear `USING (true)`, sino revocar cliente, habilitar RLS como defensa y mantener cero politicas de cliente.

Hallazgo adyacente: hay dos overloads `check_rate_limit`. El overload inet es solo service. El overload `check_rate_limit(text,text,integer,integer,text)` tiene `EXECUTE` para PUBLIC, anon y authenticated y escribe `rate_limit_counters`. Debe revisarse en una correccion independiente; no cambia la conclusion sobre `rate_limits`.

## 8. Fixtures ACL requeridos

El remoto actual no basta para una prueba real completa: 3 owners, 0 admins, 1 miembro regular, 11 documentos activos en un solo workspace, 0 expedientes, 0 participantes de expediente y 0 invitaciones de expediente.

Crear en staging un workspace `lucia-acl-e2e` con usuarios Auth reales, contrasenas unicas de QA y MFA donde aplique:

| Fixture                             | Recurso/relacion                                                | Resultado esperado                                                       |
| ----------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Owner                               | `workspace_members.role=owner`                                  | Ve todos los recursos autorizados del tenant, no otros tenants           |
| Admin                               | Rol admin real                                                  | Ve gestion segun permisos, no obtiene privilegios de owner               |
| Miembro con permiso                 | Rol + `organization_member_roles`                               | Ve solo secciones/recursos concedidos                                    |
| Miembro sin permiso                 | Membresia activa sin grant                                      | Recibe denegacion no enumerable                                          |
| Participante expediente             | `case_file_participants.user_id` activo                         | Ve solo su expediente y fuentes permitidas                               |
| Externo                             | Usuario Auth sin membresia/participacion                        | No ve workspace ni existencia del recurso                                |
| Invitado por token                  | Participante sin `user_id` + `case_file_invitations.token_hash` | Solo portal determinista; LucIA autenticada no hereda el token           |
| Documento autorizado                | Documento del workspace + ACL/participacion explicita           | RAG limitado a su ID                                                     |
| Documento no autorizado             | Documento de segundo workspace                                  | Nunca aparece en contexto, fuentes ni conteos                            |
| Expediente autorizado/no autorizado | Dos casos equivalentes en tenants distintos                     | Misma forma de error para no encontrado/no autorizado cuando corresponda |

Reglas de fixture: tokens crudos solo en memoria de prueba; persistir SHA-256; fechas vigentes y expiradas; revocacion; datos sinteticos; IDs registrados en un manifiesto de QA; teardown idempotente. No usar claims JWT fabricados como sustituto: iniciar sesion por Supabase Auth y llamar UI/API con el access token emitido.

## 9. Checklist interactivo con sesion real

El checklist ejecutable esta en `docs/lucia-phase3.5-interactive-checklist.md`. Cubre las 24 rutas solicitadas y, para cada una, datos reales, ausencia, permiso, inexistencia, sensibilidad, RAG, estado e historial.

Criterio de aprobacion: 192 casos clasificados; ningun fallo alto; ningun token/PII/secreto; evidencia valida en toda afirmacion factual; `allowed_document_ids` respetado; cero escrituras desde LucIA.

## 10. Validadores publicos: recomendacion

Estado actual:

- Las paginas Next `/validar-formulario/[id]` y `/validar-expediente/[id]` no estan en las listas publicas del middleware, por lo que exigen sesion al navegar por Docubox.
- Sus Edge Functions tienen `verify_jwt=false`, usan `service_role` y aceptan el UUID crudo del recurso. Por tanto, el backend de verificacion si es invocable directamente sin sesion y puede enumerarse si un UUID se filtra.
- `validate-case-file` devuelve titulo, tipo y folio; `validate-form-document` devuelve nombre, folio, estado, IDs y hash. No hay token, expiracion, revocacion ni scope.
- LucIA ya esta deshabilitada para estas rutas y debe permanecer asi.

Recomendacion: **Opcion C como arquitectura objetivo; Opcion A de forma inmediata hasta implementarla**.

Arquitectura objetivo deterministic-only:

1. URL con token opaco CSPRNG, no UUID del documento/respuesta/expediente.
2. Persistir solo `SHA-256(token)` con `resource_type`, `resource_id`, `scope`, `expires_at`, `revoked_at`, `max_uses` opcional y auditoria minima.
3. Resolver en una RPC/Edge Function de verificacion dedicada con comparacion del hash y respuesta uniforme para invalido, expirado, revocado o inexistente.
4. Mostrar solo validez, folio publico, tipo generico, hash/algoritmo, sello/fecha y emisor verificable. Omitir titulo interno, nombre del formulario si es sensible, participantes, workspace, rutas y IDs internos.
5. Aplicar rate limit por token hash + IP, `Cache-Control: no-store` para respuestas sensibles y telemetria sin IP cruda de larga duracion.
6. No llamar OpenAI, RAG ni LucIA. El resultado debe derivarse deterministamente de evidencia persistida.

No modificar middleware hasta que el contrato de token, la minimizacion y las pruebas anti-enumeracion esten listos.

## 11. Riesgos pendientes

| Severidad | Riesgo                                                               | Tratamiento                                                                                  |
| --------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Critica   | Edge validators con `verify_jwt=false`, service role y UUID crudo    | Mantener paginas autenticadas y cerrar/transformar Edge endpoints antes de hacerlas publicas |
| Alta      | Purga de borrador puede eliminar Storage y fallar despues en DB      | Priorizar migracion corregida + prueba de integracion/compensacion                           |
| Alta      | Tres modulos aparentan operar con demos pese a tablas ausentes       | Ocultar activacion o mostrar indisponibilidad explicita                                      |
| Alta      | Token publico crudo en Titulos de credito                            | Rediseno por hash antes de restaurar                                                         |
| Alta      | ACL antiguas de Notifica/Bulk permiten escritura a cualquier miembro | No restaurar sin capacidades/roles                                                           |
| Media     | Tablas auth/rate limit en `public` sin RLS                           | Mover a `private` o habilitar RLS sin politicas tras inventario de callers                   |
| Media     | Overload publico de `check_rate_limit` SECURITY DEFINER              | Auditar parametros, abuso de cardinalidad y revocar/reemplazar si no es intencional          |
| Media     | Sin fixtures reales de admin, expediente, participante y externo     | Crear tenant y usuarios QA en staging                                                        |
| Baja      | Advisor mantiene hallazgos legacy de search path/RPC                 | Triage separado por exposicion y criticidad                                                  |

## 12. Decisiones que requiere el propietario del producto

1. Notifica certificada, Firmas masivas y Titulos de credito permanecen visibles por decision de producto; cualquier ocultamiento posterior requiere instruccion explicita.
2. Confirmar alcance MVP de Firmas masivas y permisos por accion antes de crear tablas.
3. Aprobar el rediseno juridico/ACL/token de Titulos de credito antes de restaurar su esquema operativo.
4. Aprobar el comportamiento de borradores: ventana restaurable de 30 dias, con purga manual anticipada por owner y sin Legal Hold/retencion.
5. Elegir si los validadores seran publicos deterministic-only por token opaco. Hasta entonces deben seguir autenticados y los Edge endpoints deben cerrarse.
6. Autorizar un entorno/tenant de staging y siete cuentas Auth de QA para fixtures reales.
7. Autorizar una fase de hardening para mover tablas auxiliares a `private` y corregir el overload publico de rate limit.

## 13. Proximo paso recomendado para Fase 4

No iniciar inteligencia documental avanzada aun. Ejecutar primero un sprint corto de cierre 3.5:

1. Corregir y desplegar la migracion de purga en staging con pruebas de Storage + DB.
2. Crear fixtures ACL reales y completar el checklist de 192 casos.
3. Mantener visibles los modulos en construccion, etiquetarlos y excluir demos de produccion.
4. Implementar validadores deterministic-only por token hash, sin LucIA.
5. Resolver una sola vertical de esquema: Notifica certificada, con ACL por capacidad y pruebas RLS.

Fase 4 puede comenzar cuando no existan fallos criticos/altos, el checklist este firmado y toda fuente que LucIA consulte tenga esquema real, ACL probada y evidencia minima estable.
