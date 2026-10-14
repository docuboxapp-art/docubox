# Latencia operativa de Supabase y recomendación de capacidad — 14 de octubre de 2026

## Decisión

**No cambiar el plan ni el tamaño de la base por ahora.** El propietario pidió documentar la recomendación y diferir el cambio. Esta investigación fue de solo lectura: no se modificaron producción, RLS, política de sesión, índices, tiempos límite ni código.

La recomendación para cuando se autorice es pasar la organización de Free a Pro y esta base de Nano a Small (2 GB de RAM). Para el único proyecto observado, el estimado es **US$30/mes** antes de impuestos y posibles excedentes: US$25 de Pro + aproximadamente US$15 de Small - US$10 de crédito mensual de cómputo. La facturación de cómputo es por hora. Supabase indica que un cambio de tamaño suele causar menos de dos minutos de interrupción, aunque puede tardar más. **No es una corrección garantizada**: hay que medir el resultado y seguir investigando si persisten los errores.

Fuentes: [Compute and Disk](https://supabase.com/docs/guides/platform/compute-and-disk), [Manage Compute usage](https://supabase.com/docs/guides/platform/manage-your-usage/compute).

## Evidencia y diagnóstico

### Reproducción en `/mis-documentos` (14 de octubre, 20:35 UTC)

Con una sesión iniciada por el propietario en `localhost:4028`, se reinició el servidor local `next start` para asegurar que usara la compilación vigente. La lista mostró **22 documentos unos 17 segundos después** de recargar la ruta. El reinicio no resolvió la demora. En la misma navegación, los logs del gateway de Supabase registraron dos llamadas exitosas a la política de sesión de **3,101 y 3,525 ms**, dos lecturas de preferencias de **2,991 y 3,151 ms**, una lectura de miembros de **3,710 ms** y dos lecturas de documentos de **3,776 y 3,917 ms**. Son tiempos de servicio upstream, no duración de SQL aislada. La página pudo quedarse antes en el mensaje «No fue posible verificar la sesión» al agotarse la verificación, lo que ubica parte de la espera antes de la lista misma.

La muestra de los 30 minutos previos tuvo 14 respuestas 200 de `/rest/v1/documentos`: mediana upstream **3,659 ms**, p95 empírico **12,372 ms** y máximo **12,754 ms**. Consultas sencillas de preferencias y la RPC de sesión también tuvieron colas de varios segundos. A las 20:32–20:33 UTC hubo un `57014 statement timeout`, errores PostgREST «Thread killed by timeout manager» y dos inicios de cron agotados; una consulta de inspección de solo lectura también perdió la conexión por timeout. La lentitud afecta a varias superficies de Supabase, no solo a la consulta de documentos.

Se descartó una transacción abierta persistente en la instantánea posterior: la única transacción «idle in transaction» observada llevaba **0.2 segundos**. Ningún cron de duración relevante se solapó con la navegación de 20:35; el único trabajo cada minuto normalmente terminó en menos de 0.3 segundos durante esa ventana. Un `EXPLAIN ANALYZE` representativo de documentos bajo RLS midió aproximadamente **88 ms** (véase abajo), por lo que no hay evidencia para añadir un índice o reescribir esa consulta como solución principal. La capacidad Nano sigue siendo la hipótesis operativa más fuerte, pero la atribución precisa de cada pausa exige métricas de CPU, memoria, I/O y pool correlacionadas por minuto. Se mantiene la decisión del propietario de **no cambiar de plan todavía**.

Proyecto `kbjejiclhgjmiasauxyr` (`databox`), región `us-east-1`, PostgreSQL 17.6.1.084. La [vista de infraestructura](https://supabase.com/dashboard/project/kbjejiclhgjmiasauxyr/settings/infrastructure) muestra organización Free y cómputo t4g.nano (hasta 0.5 GB de RAM); en la ventana del 7 al 14 de octubre registró picos de **98 % de cómputo, 98 % de CPU y 92 % de I/O de disco**. La [observabilidad de base de datos](https://supabase.com/dashboard/project/kbjejiclhgjmiasauxyr/observability/database) mostró uso considerable de swap y ráfagas de espera por I/O. Son señales de presión de capacidad, pero los máximos de siete días **no se correlacionaron minuto a minuto** con cada error. El proyecto aparecía `ACTIVE_HEALTHY` al consultarlo; ese estado puntual no elimina la degradación intermitente. Supabase explica que el [swap alto afecta al rendimiento](https://supabase.com/docs/guides/troubleshooting/memory-and-swap-usage-explained-aPNgm0).

| Señal, últimas 24 horas salvo indicación | Medida | Interpretación |
| --- | ---: | --- |
| `enforce_docubox_session_policy`, respuestas 200 del gateway | 1,025; p50 upstream 128 ms; **p95 upstream 6,703 ms**; máximo 49,499 ms | Cola larga real fuera de la consulta SQL individual. La ventana mezcla estados previos y posteriores de otros cambios. |
| `/rest/v1/documentos` con filtro `owner_id`, respuestas 200 | 332; **p95 upstream 15,729 ms**; máximo 113,891 ms | Incluye varios tipos de lectura del recurso. La consulta representativa con RLS devolvió 22 filas en aproximadamente 88 ms de ejecución SQL. |
| `pg_stat_statements` de la RPC de política | 2,151 llamadas; media SQL 346.9 ms; máximo registrado 6,839.3 ms | La extensión no proporciona p95; las consultas canceladas pueden no quedar reflejadas en el máximo. |
| PostgREST `PGRST002` | 164 menciones | Fallo de conexión/consulta de caché de esquema; hubo ráfagas a las 20:00 UTC del día 13 y a las 16:00 y 18:00 UTC del día 14. |
| Consultas de caché de esquema completadas | 31; mediana 4,785.9 ms; **p95 empírico 19,162.5 ms**; máximo 47,306.8 ms | Muestra pequeña y sesgada a las completadas; cinco consultas de catálogo se cancelaron por `57014`. |
| PgBouncer | 85 `connect timeout` entre 01:00 y 02:00 UTC | Evidencia de indisponibilidad transitoria al conectar con PostgreSQL; no prueba agotamiento de `max_connections`. |
| Auth gateway | 532 JWKS 504; 50 token 504; 9 user 504 | Los fallos de Auth coinciden principalmente con el periodo nocturno de problemas de conexión. |

`PGRST002` significa que PostgREST no pudo consultar la base para cargar su caché de esquema; es un 503 según la [referencia oficial](https://supabase.com/docs/guides/api/rest/postgrest-error-codes). Cinco mensajes detallados indican `57014 statement timeout` durante esa carga. Los esquemas configurados `public` y `graphql_public` existen, de modo que la causa alternativa de esquema ausente descrita por [Supabase](https://supabase.com/docs/guides/troubleshooting/postgrest-error-pgrst002-could-not-query-the-database-for-the-schema-cache-c396e9) no aplica aquí. Se observaron notificaciones de recarga de caché cerca de las ráfagas; no se identificó al emisor de todas ellas. La carga abarca 341 relaciones, 435 relaciones entre tablas y 178 funciones. La **falla inmediata demostrada** es la consulta/carga de caché que agota su tiempo o pierde conexión; la **contribución exacta** de CPU, swap, I/O, pool y tamaño de esquema a cada ocurrencia requiere trazas correlacionadas. No conviene atribuir cada `PGRST002` exclusivamente al tamaño Nano.

Los `57014` afectaron también siete RPC de política de sesión, dos lecturas de documentos y consultas simples de exportador, cron y otros servicios. El rol `authenticator` y el rol `authenticated` tienen `statement_timeout=8s` y `lock_timeout=8s`; `anon` tiene 3 s. El valor global de base de 120 s **no** es el límite efectivo de esas solicitudes Data API. El plan de una lectura de documentos bajo RLS usó el índice existente y ejecutó en unos 88 ms para 22 filas. Algunas cancelaciones de la RPC se produjeron al leer `user_profiles` o incluso en una asignación PL/pgSQL, lo que es compatible con una pausa operativa amplia; no demuestra por sí solo que esos pasos sean intrínsecamente costosos. Subir `statement_timeout` sin resolver la espera no es la primera medida adecuada. Véase [Timeouts](https://supabase.com/docs/guides/database/postgres/timeouts).

En una instantánea hubo 22 conexiones de un máximo de 60, sin transacciones abiertas o locks de aplicación sin conceder; `pg_stat_database` no mostró deadlocks ni conflictos. Esto **no** prueba ausencia histórica de presión: los 85 `connect timeout` nocturnos sí demuestran problemas transitorios de conexión, pero no saturación del límite de conexiones. Las esperas por lock halladas en logs fueron de Realtime y autovacuum, no de las rutas de aplicación examinadas.

Las Functions de Vercel observadas usan `iad1` y Supabase está en `us-east-1`. No se verificó por separado la región efectiva de cada invocación del middleware. No hay evidencia de que la distancia regional explique colas de 6 a 15 segundos. El tiempo `x_envoy_upstream_service_time` incluye más que SQL y **no permite** aislar un p95 exclusivo de PostgREST ni el tiempo de red; para separarlos se necesitan trazas del mismo `request-id` en gateway, PostgREST y PostgreSQL. La RPC individual en estado sano mostró lecturas de milisegundos en `auth.sessions`, `auth.users`, `platform_staff`, `platform_roles`, `docubox_session_activity` y `user_profiles`; esa instantánea no representa el p95 durante el incidente.

El middleware puede repetir una llamada transitoria hasta tres veces, con esperas de 350 y 1,200 ms y límite global de 20 s; también existen reintentos de recuperación en la página. Esto amplifica la espera durante fallos persistentes de PostgREST/Auth. Es un **factor secundario** frente a la indisponibilidad del backend. Antes de reducirlos habría que probar que no se pierde resiliencia ante fallos breves; no se cambió su comportamiento en esta investigación.

## Plan de verificación si se autoriza la ampliación

1. Registrar 24 horas previas de CPU, swap, I/O, conexiones, `PGRST002`, `57014`, 500/503/504 y p50/p95/máximo de RPC y documentos. Separar por hora y correlacionar con recargas de esquema y cron.
2. Confirmar costo, disponibilidad y ventana de mantenimiento con el propietario. Cambiar a Pro + Small solo tras autorización explícita; conservar las configuraciones de RLS y la Data API.
3. Repetir **cinco navegaciones frías y diez calientes por ruta** (`/inicio` y `/mi-espacio`), con middleware, `auth_claims`, política de sesión, Data API, primer contenido útil, primeros documentos, p50, p95, máximo y tasa de errores. Comparar ventanas equivalentes de producción, sin mezclar PRE y POST.
4. Exigir desaparición de `PGRST002` y timeouts recurrentes, menor p95 upstream y menor cola larga percibida. Si persisten, correlacionar trazas por solicitud y revisar qué provoca las recargas de caché y los intentos de conexión fallidos antes de otras modificaciones.

## Resultado solicitado

```text
MAIN_BOTTLENECK=Inestabilidad intermitente en Supabase Auth/PostgREST/PostgreSQL; presion de capacidad en Nano y recarga costosa de schema cache, con contribucion causal exacta pendiente de trazas correlacionadas
SESSION_POLICY_SQL_P95=NO_DISPONIBLE (pg_stat_statements solo da media y maximo; media 346.9 ms, maximo 6839.3 ms)
SESSION_POLICY_UPSTREAM_P95=6703 ms (1025 respuestas 200, ventana mixta de 24 h)
POSTGREST_P95=NO_AISLADO; schema cache completada p95 19162.5 ms (31 muestras); documentos upstream p95 15729 ms (332 respuestas 200)
PGRST002_ROOT_CAUSE=Fallo al consultar/cargar schema cache de PostgreSQL; cinco cargas canceladas por 57014; esquema ausente descartado; factor de recursos exacto no probado por evento
STATEMENT_TIMEOUT_ROOT_CAUSE=Limite efectivo de 8 s en roles Data API bajo esperas operativas intermitentes; afecta RPC, catalogo de schema cache y algunas lecturas de documentos, sin plan caro demostrado en la muestra
LOCK_CONTENTION=NO (en rutas examinadas e instantanea; historial completo no disponible)
CONNECTION_PRESSURE=YES (85 fallos transitorios de conexion PgBouncer; agotamiento de max_connections no demostrado)
REGION_LATENCY_MATERIAL=NO (Functions iad1 y Supabase us-east-1; middleware no medido individualmente)
RETRY_AMPLIFICATION=YES (reintentos del middleware y recuperacion en pagina; efecto preciso no cuantificado)
INICIO_PERFORMANCE=SIMILAR (sin intervencion operativa; no hay nueva serie controlada)
MI_ESPACIO_PERFORMANCE=SIMILAR (sin intervencion operativa; no hay nueva serie controlada)
SECURITY_REGRESSION=NONE (sin cambios en seguridad ni produccion)
```

`SIMILAR` expresa ausencia de una mejora demostrada, **no** una medición PRE/POST válida. El objetivo de rendimiento y desaparición de errores queda abierto mientras se difiere el cambio de capacidad y la posterior comprobación.
