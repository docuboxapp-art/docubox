# Docubox — resolución de infraestructura y criterios de liberación

**Preparado:** 15 de octubre de 2026, 04:25 UTC. **Corte de evidencia:** informes existentes hasta ~02:30 UTC; no se hicieron nuevas consultas a producción para este plan. **Decisión:** `PRODUCTION_READY=NO`. Este documento no autoriza cambios de plan, SQL, despliegue ni modificaciones externas.

Documentos base: [RCA](docubox-stabilization-rca.md), [validación de Auth](docubox-auth-validation-report.md), [expediente para soporte en inglés](supabase-support-case-final-en.md), [monitoreo](docubox-monitoring.md) y [auditoría previa de capacidad](../performance/docubox-supabase-capacidad-2026-10-14.md). Las ventanas históricas parcialmente solapadas no se suman.

## Decisiones con la evidencia actual

| Pregunta | Respuesta operativa |
| --- | --- |
| ¿Qué está fallando? | En el incidente, `/auth/v1/token` y la RPC PostgREST `enforce_docubox_session_policy` entregaron 5xx y grandes esperas; hubo JWKS 504, `PGRST002`, cancelaciones `57014` y timeouts de conexión. En Docubox se tradujo en login y navegación lentos o imposibles. Las llamadas/reintentos redundantes del código local amplificaban el impacto, pero no explican por sí solos los 5xx del proveedor. |
| ¿Qué está confirmado? | Auth token 21/23 y RPC 13/14 respuestas 5xx entre 00:45–01:30 UTC del 15/10; otra ventana 01:30–02:00 tuvo token 6/6 5xx, JWKS 1/1 y RPC 1/1 504. Hay 85 `connect timeout` del pooler en una ventana histórica, `PGRST002` y `57014`. El estado administrativo `RESTARTING` se observó a las 02:17:41 UTC; `ACTIVE_HEALTHY` después no prueba recuperación funcional. |
| ¿Qué no está demostrado? | No se ha establecido si el detonante fue agotamiento de presupuesto de E/S, swapping activo, cola del pool, reinicio de servicio, recarga de caché, un problema de plataforma o una combinación. Tampoco se ha medido recuperación con dos ventanas completas y tráfico comparable. |
| ¿Qué capacidad necesita? | Nano carece de margen demostrado para este patrón de carga; **no hay medida suficiente para fijar un tamaño definitivo**. Micro y Small son escenarios de prueba, no remedios garantizados. Small es el candidato de evaluación si Supabase confirma presión de RAM/E/S o una prueba aislada muestra que Micro no cumple los objetivos; la decisión económica y operativa queda pendiente. |
| ¿Qué hacer antes de desplegar? | Obtener explicación/mitigación verificable del proveedor, respaldo restaurable, entorno aislado con Auth/Postgres reales y dos tenants, pruebas E2E de seguridad/sesiones, observación externa independiente y plan de rollback ensayado. |

## Evidencia exacta que falta para cerrar la causa

| Hipótesis | Indicio disponible | Evidencia faltante y criterio de confirmación |
| --- | --- | --- |
| Presupuesto de Disk I/O agotado | Captura Observability de 24 h con “Disk I/O 100 %”; tooltip a **15/10 00:25:47 UTC** con IOWait **41.09 %** de CPU total **45.88 %**. La tarjeta del proyecto da 6 % de espacio ocupado, que es otra métrica. | Supabase debe confirmar qué define esa tarjeta concreta, el instante en que el crédito/balance llegó a cero y las series **por minuto** de IOPS, MB/s, latencia/cola y throttling por dispositivo para 14/10 20:00–21:00 y 15/10 00:00–02:30 UTC. El 100 % agregado no prueba que cada 5xx coincidiera con throttling. |
| Swapping u OOM | Máximos de siete días muestran swap; a 00:25:47 UTC memoria **comprometida** 1.41 GB sobre CommitLimit 1.2 GB. | RAM residente/disponible, swap usado y tasa de entrada/salida, page faults, OOM kills, reinicios de procesos y marcas UTC por minuto. `Committed_AS` no es RAM física ni prueba de OOM. IOWait incluye disco/red y no identifica swap por sí solo. |
| Pool/conexiones | 85 `connect timeout` entre 01:00–02:00 UTC en una ventana histórica; instantáneas posteriores de 22/60 y 7 conexiones sin locks de aplicación. | Modo y ruta efectivos de cada servicio (Supavisor/PgBouncer/directo), tamaños, límites, conexiones cliente/backend, cola, espera, rechazos, `connect_timeout` y reservas de Auth/PostgREST por minuto. Un timeout de conexión confirma fallo transitorio, **no** que se alcanzó `max_connections`. La documentación actual describe PgBouncer dedicado como opción de planes pagos; pedir aclarar el origen de los logs etiquetados PgBouncer en este proyecto Free. |
| Reinicio/caída de servicios | Panel Unhealthy en Database, Auth, PostgREST y Storage; API administrativa `RESTARTING` 02:17:41 → `ACTIVE_HEALTHY` ~02:19:52 y 02:22:07 UTC. | Línea temporal interna: quién/qué inició la transición, procesos reiniciados, crash/OOM/maintenance/deploy, duración, resultados de health checks por servicio y por qué panel/API discrepaban. No inferir restablecimiento de Auth a partir del estado administrativo. |
| PostgREST/cache de esquema | `PGRST002` y cargas de caché canceladas por `57014`; una consulta representativa de documentos con RLS tardó ~88 ms, frente a esperas upstream mucho mayores. | Trazas por solicitud desde gateway → PostgREST → pool → PostgreSQL con fase de espera, `wait_event`, notificaciones que dispararon recarga de caché y latencia/errores de catálogo. Determinar si 5xx de Auth comparten el mismo cuello de botella. |
| Auth 504/520 | Token 5xx en dos ventanas; JWKS 504; `origin_time` de gateway de hasta ~340 s en ejemplos. | Trazas GoTrue/gateway con ID correlacionable, fase del error, timeout configurado, dependencia de PostgreSQL/pool, diferencia entre tiempo del gateway y del cliente. Los campos de ID exportados en ocho eventos estaban vacíos; soporte debe indicar fuente alternativa. |

La serie `pg_stat_statements` de 20 filas **no** cierra estas brechas: falta `stats_reset`, las tres consultas más costosas mostradas eran de metadatos de Studio y no de Docubox, y su tiempo acumulado no representa p95 del incidente. Logs Query **94.314/100 GB** es cuota de lectura de logs, distinta del I/O de PostgreSQL; la captura indica cuota no excedida. No usarlo como explicación de Auth 5xx.

## Capacidad: Nano, Micro y Small

Valores publicados por [Supabase Compute and Disk](https://supabase.com/docs/guides/platform/compute-and-disk), verificados al preparar este plan. Son **mínimos de rendimiento del tamaño de cómputo**, sujetos también al tipo/tamaño y aprovisionamiento del disco; CPU sigue compartida hasta Medium.

| Tamaño | RAM | E/S sostenida mínima | Ráfaga máxima indicada | Evaluación para Docubox |
| --- | ---: | ---: | ---: | --- |
| Nano (actual, Free) | Hasta 0.5 GB | 250 IOPS, 5 MB/s | 11,800 IOPS, 261 MB/s | La evidencia de esperas, memoria comprometida y Disk I/O agregado exige investigar su margen. No confundir “0/60 conexiones” en una captura con capacidad libre durante el incidente. |
| Micro (pago) | 1 GB | 500 IOPS, 11 MB/s | 11,800 IOPS, 261 MB/s | Duplica RAM/E/S base frente a Nano, pero conserva presupuesto de ráfaga; no hay prueba de que baste para picos sostenidos o swapping. |
| Small (pago) | 2 GB | 1,000 IOPS, 22 MB/s | 11,800 IOPS, 261 MB/s | Cuadruplica RAM/E/S base frente a Nano y es candidato prudente **para evaluación**, no garantía contra 5xx de plataforma, pool o diseño. |

Los tres tamaños pueden agotar su presupuesto de ráfaga. El rendimiento efectivo es el menor entre límite de cómputo y disco aprovisionado; una ampliación de cómputo **no cambia** por sí sola tipo o tamaño de disco. No modificar pool, `statement_timeout` ni capacidad a ciegas. Decidir tamaño solo después de que soporte aporte métricas correlacionadas, el entorno aislado permita carga controlada y se definan p95/p99, tasa 5xx y margen de RAM/E/S aceptables. Si el problema es una recarga de caché, un reinicio de proveedor o una cola mal configurada, más RAM puede no resolverlo. La decisión anterior del propietario de **documentar y diferir el cambio de plan** sigue vigente.

## Procedimiento de ampliación preparado, **no autorizado ni ejecutado**

1. **Puerta previa.** Exigir conclusión provisional del proveedor y sus métricas; acordar objetivo, tamaño candidato, costo vigente en Dashboard, responsable, ventana UTC y criterio de abortar. Registrar plan/tamaño, pool efectivo, disco, PostgreSQL, configuración Auth/RLS/MFA, IDs de despliegue y línea base PRE. Un cambio de cómputo puede interrumpir el proyecto: Supabase dice que normalmente dura menos de 2 minutos, pero puede tardar más. Planear indisponibilidad de Auth, PostgREST y Storage, bloquear acciones de firma durante ella y avisar por canales operativos aprobados.
2. **Respaldo verificable antes del cambio.** Resolver el “No backups” del panel con soporte. En Free, preparar una exportación lógica **autorizada y de baja carga** de roles, esquema y datos conforme a la [guía oficial](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore); incluir particularidades de `auth`/`storage`, migraciones y claves de cifrado que la restauración requiera. Respaldar **objetos binarios de Storage por separado**: los respaldos de base incluyen metadatos, no los archivos. Guardar cifrado fuera del repositorio, anotar alcance, hora UTC, checksums, responsable y RPO. Ensayar restauración en proyecto aislado, comparar conteos y hashes/muestras no sensibles, probar login/lectura/descarga y medir RTO. Sin restauración demostrada, **no ampliar**.
3. **Ventana de cambio.** Detener escrituras/firmas de forma coordinada y registrar el último estado; confirmar respaldo fresco y canal con soporte. Solo con autorización específica, cambiar **una variable por vez**: si la organización debe pasar a Pro, hacerlo y confirmar facturación/respaldos; después cambiar Nano al tamaño aprobado. No mezclar con migraciones, cambios de pool, versión Postgres o despliegue de código. Registrar tiempos de inicio/fin y estados por servicio.
4. **Validación inmediata.** En Auth: health y login de cuentas de prueba, refresh, rechazo de credenciales incorrectas. En PostgREST: lectura y escritura controladas bajo RLS, RPC de política y códigos 401/503. En Docubox: `/inicio`, `/mi-espacio`, visor, descarga, firma y evidencias con cuentas autorizadas y denegadas. Verificar Storage, colas, cron, errores `PGRST002`/`57014`, conexión/pool, RAM/swap, IOWait/IOPS y p50/p95/p99. Mantener vigilancia externa, exigir dos ventanas completas de 30 minutos sanas y seguimiento de al menos 24 h con volumen comparable. No atribuir mejora a tráfico ausente.
5. **Fallo o falta de mejora.** Congelar nuevos cambios y abrir/escalar soporte con UTC y métricas. Una reversión de tamaño puede implicar **otra interrupción** y no sustituye restauración. Si el proyecto sigue funcional, decidir con soporte si volver al tamaño previo es seguro; si hay pérdida/corrupción, restaurar el respaldo probado según RPO/RTO acordados, incluyendo Storage y claves/configuración faltantes. No borrar ni sobrescribir producción sin plan de datos confirmado. Validar de nuevo Auth/RLS/visor/firma y reconciliar escrituras del intervalo. Documentar causa y resultado antes de reabrir tráfico.

Las [copias diarias en Pro](https://supabase.com/docs/guides/platform/backups) pueden tardar en aparecer y su existencia no reemplaza un respaldo restaurado y probado antes del cambio. Una restauración del proveedor también puede dejar el proyecto inaccesible durante el proceso.

## Pruebas integrales pendientes para Auth y middleware

El [reporte de validación](docubox-auth-validation-report.md) documenta 47/47 pruebas locales de estabilización y 49/49 pruebas focalizadas de acceso, custodia y firma. Son controles útiles, **no pruebas reales completas de GoTrue/PostgreSQL/RLS**. Se necesita proyecto aislado, esquema equivalente, dos tenants y usuarios de prueba sin datos ni sesiones reales.

| Bloque | Prueba y salida exigida |
| --- | --- |
| Ciclo de sesión | Login válido/inválido, expiración, refresh válido/inválido, dos pestañas refrescando a la vez, cookies y redirecciones; demostrar una sola sesión coherente y ausencia de bucles o pérdida de sesiones válidas. |
| Revocación y credenciales | Revocación efectiva con JWT todavía no expirado, logout local/global entre dispositivos, cambio/restablecimiento de contraseña y reautorización de rutas sensibles. |
| MFA | Confirmar configuración efectiva; si aplica, alta/challenge TOTP y WebAuthn, AAL y recuperación, con fallos cerrados. La existencia de código no valida el flujo. |
| Fallos temporales | Inyectar 503/504 y recuperación **solo en aislado**; las rutas protegidas deben negar acceso mientras no puedan verificar autorización, conservar cookies ante fallos técnicos y no tratar 5xx como credenciales inválidas. Medir reintentos y concurrencia. |
| Aislamiento | Matriz propietario/participante/tercero entre dos tenants para listar, obtener, visor, evidencia y firma; comprobar RLS efectivo y que service role no eluda la autorización del usuario. |
| Rendimiento | Medir p50/p95/p99, volumen de llamadas Auth/RPC, duplicados y primer contenido útil al navegar `/inicio` → `/mi-espacio` → visor. Comparar en entorno estable y después de cualquier cambio con misma carga. |

## Responsabilidad: código frente a Supabase

| Puede cerrarse en código/entorno aislado | Requiere Supabase o decisión operativa externa |
| --- | --- |
| Revisar diff local, ejecutar tests, verificar 401/503 y ausencia de bypass, instrumentar métricas sanitizadas, ensayar cookies/refresh/MFA/tenant en proyecto de prueba, identificar despliegue compatible y plan de rollback. | Trazas internas de gateway/GoTrue/PostgREST/pool, series de I/O/swap/reinicios por minuto, aclaración de health y backups, configuración productiva del pool y causa de 504/520. |
| Crear/ensayar runbook y respaldos en un destino aislado **cuando se autorice**; preparar monitor externo independiente del equipo local. | Autorizar/exportar respaldo productivo, obtener proyecto aislado o rama, cambiar plan/tamaño, restaurar producción y decidir respuesta del proveedor. |

## Checklist de prioridad para el siguiente despliegue

**P0 — bloqueo actual**

- [ ] Enviar el [caso en inglés](supabase-support-case-final-en.md) por el canal de soporte disponible y obtener número de caso, dueño y plazo de respuesta; no enviar secretos ni cuerpos de solicitudes.
- [ ] Obtener de Supabase cronología causal y series por minuto de I/O, memoria/swap/OOM, pool/conexiones y reinicios, correlacionadas con 5xx de Auth/PostgREST.
- [ ] Aclarar “No backups”; producir y **restaurar en aislado** un respaldo apropiado, incluidos objetos Storage y configuración necesaria, antes de cualquier cambio de cómputo.
- [ ] Proveer proyecto aislado y ejecutar matriz E2E completa de Auth, revocación, MFA aplicable y aislamiento de dos tenants; corregir cualquier acceso cruzado antes de liberar.
- [ ] Mantener `PRODUCTION_READY=NO` mientras haya 5xx recurrentes, salud sin verificar, pruebas críticas pendientes o respaldo no restaurable.

**P1 — aceptación de una mitigación y preparación de código**

- [ ] Definir con soporte si el cuello es recursos, pool, recarga de caché o plataforma; decidir Micro/Small solo con evidencia y autorización separada.
- [ ] Demostrar **dos ventanas UTC adyacentes de 30 minutos completas** bajo umbral y sin falso cierre por datos ausentes; después reunir al menos 24 h de estabilidad con tráfico comparable y sin `PGRST002`/timeouts recurrentes.
- [ ] Colocar el monitor en ejecutor independiente del equipo local, con estado privado persistente y aviso verificable; documentar responsable y prueba de alerta sin tocar producción.
- [ ] Revisar compatibilidad de migraciones no aplicadas, diff/secretos/RLS y rollback de código **y** datos; elegir un despliegue previo realmente validado, no solo el último SHA observado.

**P2 — decisión de liberación futura**

- [ ] Con la infraestructura estable, repetir build, type-check, tests y E2E contra aislado; registrar baseline de Auth/RPC/navegación y duplicados.
- [ ] Solicitar autorización de despliegue por separado; promover una sola versión, vigilar 24 h PRE/POST por SHA y UTC, y revertir ante acceso cruzado, fallos de sesión, 5xx o p95 fuera del umbral acordado.

**Definición de estabilidad:** fuentes completas de Auth, JWKS, RPC, Vercel y capacidad; dos ventanas completas adyacentes sin incidente; 24 h posteriores con volumen comparable y sin recurrencia de 5xx/`PGRST002`/`57014`/timeouts de conexión, con p95/p99 y uso de RAM/swap/I/O dentro de umbrales acordados; causa o mitigación documentada por Supabase; restauración probada; monitor independiente activo. Esto **no** reemplaza la puerta de seguridad E2E para aprobar código.
