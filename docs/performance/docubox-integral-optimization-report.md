# Optimización integral de Docubox

24 de noviembre de 2026. La línea base local reproduce el árbol de trabajo al inicio de la revisión sobre `0a1b74a`, con los cambios locales del proyecto incluidos. Las muestras de producción corresponden al despliegue `7011f22`. La comparación A/B usa compilaciones de producción locales, Next.js 16.3.4, Node.js 24.21.0 y datos sintéticos. N/D indica que faltó una medición válida.

## Resultados

| Hallazgo | Evidencia | Intervención y estado |
| --- | --- | --- |
| P1. Verificación de identidad duplicada en la lectura inicial de Mi Espacio | Con metadatos, una solicitud hizo tres llamadas internas a Auth por el mismo Bearer. En el banco de pruebas hubo una cuarta llamada del Proxy. | Una verificación interna por solicitud. En la prueba de 50 clientes, el p95 total bajó de 1.533,4 a 795,0 ms y se completaron las 150 solicitudes en cada versión. Implementado y probado localmente. |
| P2. El formateo de Reportes reconstruía el formateador de fecha para cada celda | 3.000 celdas, nueve rondas alternadas en la zona horaria de Mazatlán. La mediana de CPU bajó de 406 a 16 ms. | Se reutilizan dos formateadores. Las 3.011 salidas comparadas fueron idénticas. Implementado y probado localmente. |
| P2. El listado de documentos escribía un mensaje por cada lectura correcta | El banco de pruebas registró 311 mensajes de éxito durante las pruebas de contrato y carga. | El candidato registró cero mensajes de ese tipo. Conserva eventos de error y registra lecturas lentas con la telemetría existente. Implementado y probado localmente. |
| P1. Latencia de navegación asociada a la política de sesión | El gateway observó p95 de 3.005,5 y 3.915,0 ms con 31 peticiones por franja. PostgreSQL acumuló 1.255 ejecuciones y una media de 114,58 ms en otra ventana. | Se mantiene la validación. Falta correlacionar gateway, adquisición de conexión, espera y ejecución para atribuir la demora. |
| P1. Timeouts de trabajos programados simultáneos | En 24 horas, cada despachador por minuto acumuló 109 timeouts. Durante varias franjas fallaron también trabajos de tareas y mantenimiento. | Ambos despachadores ya evitan invocaciones externas con la cola vacía. Falta medir recursos y esperas durante la degradación para decidir si el remedio pertenece a un job, al pool o al proveedor. |

Las mejoras de rendimiento y recursos se demostraron en pruebas aisladas. Falta medir su efecto en la latencia global de producción y en la factura.

## Arquitectura y cobertura

Se inventariaron 150 archivos de página de App Router y 312 archivos de manejadores, incluidas rutas públicas, dinámicas, internas y alias. El repositorio contiene 24 entradas de Edge Functions. El registro de producción devolvió 28 activas. El inventario de código orienta la priorización. La cobertura de ejecución se indica en la sección de pruebas.

| Superficie | Cadena de dependencias y trabajo relevante |
| --- | --- |
| Inicio, Mi Espacio, Mis Documentos, Compartidos conmigo, Mis Participaciones y Solicitudes | App Router → Proxy → Auth y política de sesión → proveedores de sesión, módulos y workspace → listados y widgets → Data API con el usuario. El listado inicial de documentos entrega partes progresivas por NDJSON. Los widgets ya comparten lecturas. |
| Visor, Documentos, Crear documento y conversión | API de metadatos → permisos, RLS y Legal Hold → `viewer-file` o recurso privado → Storage, descifrado y comprobación de integridad cuando corresponde → PDF.js y su worker. La carga y conversión conservan detección MIME, límites y validaciones. El código incluye previsualización progresiva y reutilización de un preprocesamiento existente. |
| Firma, QR, biometría, WebAuthn y enrolamiento | Portales y APIs de auth, firma, firma presencial, móvil, identidad, WebAuthn y verificación → autenticación del destinatario y validación de la operación → evidencia. e.firma, Nubarium, TOTP, OTP, dispositivo y mecanismos contra repetición según el flujo. |
| Plantillas, Formularios, Expedientes y portales de participación | Catálogos y publicación → política de acceso y pertenencia → invitaciones, códigos, formularios y entregas → Storage y evidencia. Se revisaron las rutas de participantes y formularios, sus procesadores de correo y las tareas de aprobación y cierre. |
| Contactos, Reportes, Perfil y Configuración | Consultas por identidad/espacio, catálogos, ajustes y permisos. Reportes combina proyecciones de orígenes por módulo con filtrado y formateo local. PDF y Excel ya importan sus librerías al exportar. |
| Notificaciones, avisos certificados y comunicaciones | Lecturas privadas en interfaz, operaciones explícitas de lectura, correo programado, trabajadores de entrega y webhooks. Reintento y deduplicación dependen del canal. El trabajo por vencimientos incluye lectura de propietario por documento. Su costo en producción quedó N/D. |
| Organización, Colabora, Tareas, Administración y plan | Autenticación → rol y ámbitos por tenant → invitaciones, equipos, automatizaciones y continuidad. La fase previa comparte verificaciones pendientes de Auth en su capa y evita iniciar efectos cancelados. Se revisaron tareas, SSO, facturación, permisos y administración separadamente. |
| Certifica, títulos de crédito, firmas masivas y verificación externa | Cadena documental y criptográfica → KMS/HSM, PAdES/CMS, TSA, NOM-151, OpenTimestamps y prueba de integridad según contrato. La finalización prioriza la transacción que satisface las garantías. Los suplementos y tareas elegibles siguen sus workers, leases y auditoría. |
| LucIA y Document Intelligence | Resolución del módulo y permisos → componente de chat diferido → APIs de IA y ámbito documental. Ingesta, extracción u OCR, búsqueda y modelo se ejecutan según el tipo de operación. Tokens, CPU y coste por respuesta en producción quedaron N/D. |
| Centro de ayuda, registro, recuperación, apps y rutas públicas/versionadas | Entradas del App Router y APIs públicas → contenido, token o condición de acceso según contrato. La búsqueda del Centro de ayuda opera sobre contenido público. Su valoración usa un rate limit distribuido y escritura de servidor. |

El despliegue activo declara Vercel `iad1` y el proyecto Supabase declara `us-east-1`. Las regiones efectivas de ejecución de cada proveedor de criptografía, identidad, correo y LLM quedaron N/D. También quedaron N/D las tasas de cold start, concurrencia por instancia y utilización facturada de Fluid Compute. La consulta de métricas de Vercel devolvió `INVALID_ARGUMENT`. El workspace carece de una credencial configurada compatible con la consulta documentada de Metrics API de Supabase. [Métricas de Supabase](https://supabase.com/docs/guides/observability/metrics) · [Métricas y registros de Vercel](https://vercel.com/docs/logs/runtime)

## Sesión, PostgreSQL y capacidad

Se revisaron las fases [7](docubox-phase7-performance-hardening.md) y [8](docubox-phase8-session-policy-audit.md), la [estabilización reciente](../observability/organization-colabora-stability-2026-11-20.md) y la [investigación de Auth/PostgREST](../observability/docubox-stabilization-rca.md). Las mediciones anteriores se usaron para elegir qué comprobar. Se leyó la migración vigente de sesión, incluidas la lectura normal, actualización explícita de actividad, revalidación de expiración bajo lock y escritura auditable.

- El Proxy verifica claims y luego ejecuta `enforce_docubox_session_policy(false)`. Un `PGRST002` rápido admite un reintento acotado. Las denegaciones y los fallos de proveedor tienen caminos separados. La renovación continúa propagando cookies. El control de sesión, MFA, límites de inactividad, expiración absoluta, revocación y alcance del dispositivo conservan su política vigente.
- Los handlers con Bearer comprueban la identidad y consultan con el cliente autenticado. La lectura de metadatos limita explícitamente las carpetas al usuario. Los access tokens del navegador y los selectores de workspace siguen sujetos a los controles de servidor. `getSession()` obtiene material de sesión para el cliente. La política y los permisos del servidor siguen siendo la autoridad.
- La revisión conservó la deduplicación ya existente en widgets y Organización, el streaming de documentos, el backoff de sesión, el rate limit distribuido, la idempotencia y los leases. En el banco HTTP, las 305 lecturas por versión registraron cero llamadas de actualización de actividad. El cambio local no afecta la ruta que registra interacción humana.

### Lectura actual de producción

| Fuente | Ventana o momento UTC | Evidencia |
| --- | --- | --- |
| `pg_stat_activity` | 24 nov, 15:16:38 | 10 conexiones de cliente de un máximo de 60. Cero clientes activos adicionales, cero transacciones de cliente ociosas y cero esperas por locks en esa instantánea. La adquisición/espera del pool y la presión sostenida quedaron N/D. |
| `pg_stat_statements` | Reinicio 07:40:22, lectura 15:17:30 | Política de sesión 1.255 llamadas / 143,80 s acumulados / media 114,58 ms / máximo 3.169,3 ms. Documentos 629 / 51,19 s / media 81,38 ms. Membresías 268 / 4,42 s / media 16,50 ms. Notificaciones 372 / 3,21 s / media 8,62 ms. Bloques leídos por la categoría sesión en el período, 23. |
| Agregación adicional de SQL | Segunda lectura del mismo período acumulado | Despacho de expedientes 470 ejecuciones, 70,03 s de ejecución acumulada. Catálogo/metadata 3.979, 116,84 s. La categoría residual incluye SQL de aplicación y del servicio. No se utilizó texto SQL ni parámetros en el informe. |
| Gateway de Supabase | Consulta 14:18–15:18. Filas observadas en 14:30–14:45 y 14:45–15:00 | Política de sesión 62 respuestas y 0 HTTP 5xx. p50 789 y 490 ms por franja. p95 3.005,5 y 3.915,0 ms. Máximo 5.003 ms. Documentos, 14 respuestas y máximo 7.829 ms. Auth token, una muestra de 495 ms. JWKS, 8 muestras. |
| Tamaño e I/O de PostgreSQL | 15:17:31 | Tamaño de la base 242.527.379 bytes. `mobile_upload_sessions` 44.818.432 bytes y `id_capture_logs` 39.886.848 bytes, incluidos sus objetos asociados. Contadores de I/O disponibles. `track_io_timing=off`. IOPS, I/O wait, memoria comprometida, swap y CPU actuales quedaron N/D. |
| Asesores de Supabase | Lectura de la revisión | Sugerencias en cinco familias, claves foráneas, inicialización de RLS, índices sin uso observado, políticas permisivas múltiples e índices duplicados. Los contadores carecen de una comprobación de plan y escrituras que justifique cambios masivos. |

Los tiempos del gateway incluyen trabajo fuera del ejecutor SQL. Las dos fuentes cubren poblaciones diferentes. La diferencia entre sus cifras carece de precisión para estimar el pool o la red. El estado del proyecto figuró como `ACTIVE_HEALTHY` y coexistió con latencia alta en el tramo medido. La muestra no reproduce la serie de CPU, memoria y swap de la auditoría anterior.

### Consultas, datos y RLS

- Se revisaron proyecciones y paginación en listados de documentos, informes, contactos, expedientes, formularios, actividad y membresías. En los listados revisados existe enriquecimiento por lotes. En el cron de vencimientos persiste una lectura de perfil por documento. Antes de modificarla se necesita el volumen real y la política de frescura del destinatario.
- El recorrido de documentos propio filtra por propietario, conserva la consulta de Legal Hold y mantiene la semántica de papelera y retención. El camino de participaciones conserva el cliente con token y su filtro posterior. Se contrastaron las migraciones y las pruebas de RLS con los handlers. No se cambiaron políticas, índices, grants, buckets ni consultas de acceso.
- Las políticas redundantes aparentes y los índices con uso bajo requieren plan bajo rol, sesgo de cardinalidad e impacto en escrituras. El análisis de índices contrastó el asesor y los catálogos. `EXPLAIN (ANALYZE, BUFFERS)` con roles y carga representativa de producción, bloat medido y antigüedad efectiva del autovacuum quedaron N/D. Los mayores tamaños observados no justifican por sí solos archivar, borrar ni segmentar datos de identidad, evidencia o retención.
- Caché pública se reserva a contenido público. La nueva reutilización de Auth está acotada a una solicitud. La reutilización de formateadores solo contiene opciones de idioma y fechas. Las respuestas del listado mantienen `private, no-store`. El control de acceso no depende de resultados cacheados.

## Tareas programadas y trabajo diferido

`pg_cron` registró los siguientes trabajos activos. Duración es tiempo transcurrido de las ejecuciones observadas en las últimas 24 horas, incluida espera. CPU, picos de memoria, conexiones por job, llamadas externas efectivas, IOPS y número de documentos procesados quedaron N/D.

| Trabajo | Horario UTC | Ejecuciones / fallos | Segundos acumulados / máximo | Clase |
| --- | --- | ---: | ---: | --- |
| Invitaciones de expediente | Cada minuto | 1.401 / 109 | 5.750,18 / 619,90 | ASYNC_SAFE |
| Lanzamiento de formularios | Cada minuto | 1.401 / 109 | 4.531,52 / 517,41 | ASYNC_SAFE |
| Reconciliación de tareas | Minutos 1 y 31 | 47 / 4 | 359,18 / 180,71 | BACKGROUND_MAINTENANCE |
| Tareas extendidas | 2 y 32 | 47 / 4 | 191,70 / 76,28 | ASYNC_SAFE |
| Seguimiento de firmas de formularios | 3 y 33 | 47 / 4 | 298,24 / 193,15 | ASYNC_SAFE |
| Reglas personalizadas de tareas | 4 y 34 | 47 / 4 | 827,29 / 674,05 | ASYNC_SAFE |
| Señales de riesgo | 5 y 35 | 47 / 4 | 688,19 / 459,62 | DERIVED_REGENERABLE |
| Salud de tareas | Minuto 15 de cada hora | 23 / 1 | 168,26 / 45,07 | BACKGROUND_MAINTENANCE |
| Limpieza del rate limit | Minuto 30 de cada hora | 23 / 2 | 223,65 / 178,59 | BACKGROUND_MAINTENANCE |
| Reenvolver DEK | 03:00 | 1 / 0 | 0,04 / 0,04 | BACKGROUND_MAINTENANCE |
| Revocar claves huérfanas | Domingo 04:00 | 0 / 0 | N/D | BACKGROUND_MAINTENANCE |
| Rotar clave maestra | Día 1 de enero, abril, julio y octubre a las 02:00 | 0 / 0 | N/D | BACKGROUND_MAINTENANCE |

La concentración de timeouts en los despachadores entre 05:00 y 07:59 UTC fue simultánea. A las 06:00 ambos terminaron 33 veces por timeout y ninguna vez con éxito. La correlación justifica revisar capacidad y esperas compartidas. La causalidad permanece sin establecer. El guard de cola vacía para formularios ya está en el cron vigente y el de expedientes está en `dispatch_due_invitations`. Se conservaron frecuencia, elegibilidad, recuperación de claims y vigencias.

| Vercel o ruta de worker | Horario UTC o disparador | Clase y control existente |
| --- | --- | --- |
| Vencimientos y control de expedientes | 02:00 | ASYNC_SAFE. Lecturas acotadas por vencimiento y estado. Función de Vercel llama también al control de fecha de expedientes. |
| Automatizaciones de Colabora | 03:00 | ASYNC_SAFE. Evento y cola con reclamación, reintento y recuperación. |
| Continuidad de Organización | 03:30 | BACKGROUND_MAINTENANCE. Ejecución interna autenticada, por ámbito. |
| Purga documental | 04:20 | BACKGROUND_MAINTENANCE. Disposición, retención y Legal Hold conservan autoridad antes de borrar. |
| Finalización de evidencia | 04:17 | ASYNC_SAFE para la ejecución del worker durable. Las evidencias requeridas preservan estado pendiente hasta completarse. |
| Actualización de blockchain/OpenTimestamps | 05:17 y workers de sello/actualización | ASYNC_SAFE para suplementos; DERIVED_REGENERABLE para presentación. La huella y los requisitos de finalización siguen en su camino crítico. |
| Envíos y webhooks de Organización, Colabora, notificaciones y formularios | Evento o cola | ASYNC_SAFE donde existe persistencia y lease. Se mantuvieron idempotencia, reintentos, orden y entregas externas. |
| Autorización, firma, verificación de archivos y evidencia obligatoria | Petición interactiva | SYNCHRONOUS_CRITICAL. Deben satisfacer su contrato antes de devolver éxito. |

## Cambios implementados y verificación

1. **Identidad en el bootstrap de documentos.** [read-bootstrap](../../src/app/api/documentos/read-bootstrap/route.ts) abre un contexto asíncrono privado para el mismo Bearer. [bootstrap-auth.server.ts](../../src/lib/documents/bootstrap-auth.server.ts) comparte la promesa solo dentro de ese contexto. Propios, participaciones y metadatos ejecutan sus controles y queries habituales. En llamadas directas, cada handler realiza su propia verificación. Se usa un plazo máximo de 20 s o de 18 s al incluir metadatos, el menor plazo ya utilizado por los handlers participantes. Los fallos se propagan y el siguiente request vuelve a verificar. La prueba regresiva usa tokens sintéticos, solicitudes simultáneas del mismo token y de distinto token, invocación directa y recuperación de error. Es una deduplicación de la verificación de identidad en una sola operación. La política del Proxy y las decisiones por recurso conservan sus comprobaciones.
2. **Fechas en Reportes.** [engine.ts](../../src/lib/reporting/engine.ts) reutiliza un formateador UTC para fecha de calendario y otro de fecha y hora local para instantes. Conserva el locale `es-MX`, las reglas de fechas inválidas y el texto que consumen tabla y exportación. Prueba de 3.000 celdas por ronda, nueve rondas alternadas con el mismo corpus. Mediana transcurrida 414,6 → 15,0 ms y CPU 406 → 16 ms. Coinciden las 3.011 salidas, incluidas fechas inválidas, vacíos e instantes con offset. RAM nativa de Intl y latencia de navegación quedaron N/D.
3. **Telemetría de lectura.** [listar](../../src/app/api/documentos/listar/route.ts) reemplaza el registro sistemático de éxito por un evento estructurado solo para lecturas por encima de 1 s. La respuesta directa ofrece `X-Docubox-Owner-Timing` con `owner_auth`, `owner_data` y `owner_format`. El primer tramo cubre la verificación de identidad. El segundo incluye las consultas y el transporte de Data API. El tercero incluye transformaciones y serialización. El Proxy ya expone sus propios datos en `Server-Timing`. Los fallos de carga y enriquecimiento registran código normalizado. La auditoría documental y los registros obligatorios no dependen de estos mensajes de diagnóstico.

### Comparación HTTP de las compilaciones locales

El banco opera en loopback. Usa Next.js compilado y un sustituto controlado de Auth, PostgREST y la política. Auth tiene cuatro plazas simultáneas y agrega 22 ms de servicio a cada llamada. Los tokens son emitidos para el escenario local. El primer dato útil es la parte NDJSON de documentos propios recibida completa. La medición termina al consumir la respuesta. Se utilizaron los mismos escenarios y escalones por versión.

| Clientes | Muestras por versión | Primer dato p95 antes → después | Total p50 antes → después | Total p95 antes → después | Solicitudes/s antes → después |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 40 | 93,8 → 91,5 ms | 91,0 → 67,1 ms | 96,1 → 92,8 ms | 11,5 → 14,1 |
| 10 | 40 | 321,1 → 179,4 ms | 231,7 → 145,8 ms | 322,3 → 180,5 ms | 30,5 → 55,7 |
| 25 | 75 | 775,7 → 408,7 ms | 507,9 → 319,5 ms | 776,5 → 410,0 ms | 31,6 → 61,0 |
| 50 | 150 | 1.508,8 → 794,6 ms | 1.002,6 → 623,4 ms | 1.533,4 → 795,0 ms | 31,8 → 61,6 |

El p99 total de 50 clientes fue de 1.574,2 → 817,6 ms. Las 305 solicitudes de carga por versión entregaron las tres partes esperadas con HTTP 200. En la tanda de 50 clientes hubo 600 → 300 llamadas a Auth, 150 → 150 verificaciones de política y 600 → 600 lecturas de Data API. Tres llamadas directas a los endpoints ejecutaron seis llamadas a Auth en ambas versiones. El resultado de carga depende de la cola y latencia del sustituto. Tiempo a saturación de la infraestructura real, RSS de las funciones y p95 del navegador autenticado en producción quedaron N/D.

Se verificaron por HTTP propietario, participante y usuario externo con datos sintéticos. El externo recibió listados vacíos frente al documento de otro titular en la misma prueba. Los casos sin identidad, revocado y expirado devolvieron 401. Una indisponibilidad de política devolvió 503. Un fallo de Auth después del Proxy produjo 503 en las partes del stream. Las comprobaciones de RLS y permisos del repositorio se ejecutaron también sobre sus fixtures SQL. La matriz con sesiones reales de lector adicional, miembros limitados y revocación de Storage entre tenants sigue pendiente. Las pruebas sintéticas no autorizan acceso a registros de producción.

### Interfaz, archivos y criptografía

El primer paso de Crear documento se comparó en Chrome en 1.440 × 900 y 390 × 844. Coincidieron los hashes de las capturas y del texto visible. El JavaScript recibido suma 619.080 y 619.069 bytes con gzip calculado localmente. La variación carece de importancia. En la compilación experimental, mover un import de PDF no redujo su presencia transitiva en el bundle inicial. Se retiró el cambio. Los tamaños de scripts iniciales declarados por las compilaciones de Inicio, Mi Espacio y Reportes también se mantuvieron dentro de la variación de compresión, alrededor de 403, 438 y 395 kB gzip decimales, respectivamente.

Se revisó el recorrido de `viewer-file`, Storage, descifrado, hash, PDF.js, cancelación de render y liberación de recursos. Los archivos del visor, módulos criptográficos, proxy y asistente de creación coinciden con la línea base local. Se conservaron los bytes, contratos de firma, cadena de evidencia, verificación de integridad y requisitos de PAdES, KMS/HSM, TSA, NOM-151 y OpenTimestamps. Se ejecutaron las pruebas locales de contratos y evidencia. Las que requieren OpenSSL, pyHanko o proveedores externos se informan con el resultado que emitió la suite. Egreso durante visualización, primera página de un PDF real, uso de memoria en archivos grandes y validación con un proveedor productivo quedaron N/D.

### Ejecución y criterios de regresión

| Comprobación | Resultado |
| --- | --- |
| TypeScript | Aprobado. |
| ESLint en archivos modificados | 0 errores. 16 advertencias preexistentes en `mis-participaciones`. |
| Pruebas específicas | 60 aprobadas, 0 omitidas. Incluye política de sesión, kiosco, reintentos, Reportes y tres controles de la verificación compartida. |
| Suite Node general A/B | Línea base 1.656 aprobadas, 48 fallidas, 13 omitidas. Candidato 1.660 aprobadas, 47 fallidas, 13 omitidas. Ningún nombre de prueba fallida aparece por primera vez. El caso intermitente de manipulación de evidencia usa una sustitución que puede dejar el carácter original intacto. Se mantiene el estado de fallo para la suite general. |
| Build de producción | Aprobado con variables sintéticas, sin proveedor externo. Las advertencias de CSS del Centro de ayuda ya estaban en la línea base. |
| Regresión funcional y visual | HTTP con datos sintéticos y comparación visual para los tamaños indicados. La aprobación global de todos los flujos requeriría sesiones de prueba y proveedores equivalentes. |

Los controles de regresión ejecutables incluyen `tests/document-bootstrap-auth.test.mjs`, `tests/performance-regression.test.mjs`, `tests/reporting-module.test.mjs` y las pruebas de sesión. El objetivo del bootstrap es una verificación del handler con Bearer, una política en el Proxy y tres partes completas cuando se solicitan metadatos. Cada llamada directa conserva su comprobación. Para repetir la comparación local de carga se conservan los artefactos sintéticos en `.tmp/integral-perf-baseline-20261124/` y `.tmp/integral-perf-candidate-20261124/` y el ejecutor `.tmp/integral-perf-http.mjs`. Las mediciones se hicieron con servidores compilados y puertos de loopback 49447–49449. Los datos y las métricas de prueba quedan fuera del repo.

Los objetivos operativos propuestos en el encargo siguen como referencia. Comparar ventanas con volumen, entorno, ruta, rol y tamaño equivalentes. Medir contenido útil cerca de 1 s y p95 de API cerca de 1 s. Para Proxy priorizar 250 ms en p95 cuando lo permita el proveedor. Para un PDF típico medir primera página cerca de 1,5 s. El monitor actual conserva su criterio de ventanas adyacentes y muestras suficientes. Los marcadores existentes y los tramos nuevos permiten distinguir validación, política, datos y serialización. Mantener vigentes los presupuestos de solicitudes del [análisis previo](docubox-phase8-request-budget.md) y medir junto con éxito, permisos, ancho de banda y latencia.

## Eficiencia de infraestructura y pendientes

- **Auth y escalabilidad.** Por cada 1.000 lecturas iniciales con metadatos se evitan 2.000 llamadas internas de verificación según el contrato probado. El bootstrap común evita una por operación. El número de funciones de Vercel y la política de sesión no cambian por esta intervención. Los ahorros en facturación están N/D. Traducir a costo requiere invocaciones, CPU activa, memoria aprovisionada, egress y volumen de rutas de una ventana equivalente. [Medición y precios de funciones](https://vercel.com/docs/functions/usage-and-pricing)
- **Capacidad Supabase y cron.** Correlacionar las franjas con timeout con CPU, swap, IOPS y espera de conexiones en el informe de infraestructura. Medir PostgREST, SQL y el volumen de trabajos procesados por separado. La evidencia disponible justifica investigar la presión compartida. Aún falta una medición que justifique cambiar cómputo, pool o frecuencias.
- **Validación de constancia de expediente.** La comprobación inicial encontró que `validate-case-file` faltaba en el registro. La intervención posterior de Supabase activó el verificador con el control descrito en la sección siguiente.
- **Verificación global.** La suite general conserva 47 fallos preexistentes en el candidato y pruebas omitidas. Priorizar resolverlos antes de marcar una aceptación integral. La medición con membresías reales, auditoría y criptografía administrada requiere un entorno aislado equivalente. La comprobación de producción fue de solo lectura y no incluyó carga.

## Intervención posterior en Supabase

| Cambio | Estado verificado |
| --- | --- |
| [Preparación de privacidad del perfil](../../supabase/migrations/20261124162838_prepare_profile_privacy.sql) | Aplicada en el proyecto vinculado. Cinco tablas privadas con RLS. Los roles de navegador carecen de acceso al esquema. La preparación conserva la escritura de contactos y la lectura de perfiles que utiliza la versión publicada. |
| [Preparación de clasificaciones personales](../../supabase/migrations/20261124162840_prepare_personal_classification_catalog.sql) y [preferencias personales](../../supabase/migrations/20261124212938_activate_personal_catalog_preferences.sql) | Aplicadas. Las preferencias de visibilidad, las etiquetas de contactos y los catálogos personales de expedientes usan las políticas por cuenta. |
| [Verificador de constancias](../../supabase/functions/validate-case-file/index.ts) | Activo como versión 1 y `verify_jwt=true`. La consulta usa el token del usuario y las políticas de membresía activa de expediente y de constancia. Se comprobó HTTP 204 para preflight y 401 para una solicitud sin JWT. |

La migración de [privacidad del perfil](../../supabase/migrations/20261126074211_activate_profile_privacy_and_communication.sql) se aplicó en producción junto con la versión de la aplicación que tramita el consentimiento de contactos. Se verificaron la lectura y el guardado de preferencias y el acceso exclusivo del servidor a la función. La [activación de grupos, tipos y etiquetas](../../supabase/migrations/20261126060339_activate_scoped_document_catalog.sql) se aplicó en producción y limita las consultas de catálogo de versiones anteriores a las opciones predeterminadas cuando usan credenciales de servicio.

La [pantalla de validación](../../src/app/validar-expediente/%5Bid%5D/page.tsx) quedó conectada al token de sesión en el código local. La prueba positiva de constancia usó datos sintéticos con RLS, pues la base activa carecía de constancias de cierre en la comprobación. Pasaron nueve pruebas enfocadas de privacidad, catálogo, verificación, perfiles de configuración, reportes y grupos. TypeScript y la comprobación de Deno también aprobaron.

## Estado de la optimización de aplicación

```text
GLOBAL_PERFORMANCE=UNVERIFIED
RESOURCE_EFFICIENCY=IMPROVED
PROCESS_EFFICIENCY=IMPROVED
INFRASTRUCTURE_STATUS=UNVERIFIED
DATABASE_STATUS=DEGRADED
SESSION_POLICY_STATUS=DEGRADED
SCALABILITY_STATUS=PARTIAL
SECURITY_REGRESSION=UNVERIFIED
CROSS_TENANT_DATA_LEAK=UNVERIFIED
RLS_SEMANTICS_UNCHANGED=true
CRYPTOGRAPHIC_SEMANTICS_UNCHANGED=true
BUSINESS_PROCESS_REGRESSION=UNVERIFIED
VISUAL_REGRESSION=UNVERIFIED
TYPECHECK=PASS
TEST_SUITE=FAIL
PRODUCTION_BUILD=PASS
DEPLOYMENT_STATUS=NOT_DEPLOYED
```

Las mejoras de recursos y procesos corresponden a las mediciones locales. Los estados de base y sesión describen la degradación observada en las ventanas indicadas. Los flags de RLS y criptografía se refieren al alcance de las optimizaciones de aplicación y a la comparación con su línea base. La versión optimizada está preparada y probada localmente. Su medición de latencia y costes en producción depende de la próxima publicación. La sección de Supabase registra las preparaciones y la función desplegadas en la intervención posterior.
