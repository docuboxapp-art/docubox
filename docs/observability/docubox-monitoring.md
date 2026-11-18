# Observabilidad operativa de Docubox

Actualizado el 14 de octubre de 2026 (America/Mazatlan). Esta guía describe la instrumentación **local, sin desplegar**, los sistemas nativos que ya existen y el procedimiento de respuesta. No autoriza cambios de plan, migraciones productivas ni pruebas de carga.

## Diagnóstico verificado

| Componente | Evidencia actual | Consecuencia |
| --- | --- | --- |
| Supabase | Organización **Free**, proyecto `kbjejiclhgjmiasauxyr` en `us-east-1`, cómputo Nano según [auditoría de capacidad](../performance/docubox-supabase-capacidad-2026-10-14.md). El estado general `ACTIVE_HEALTHY` coexistió con Auth 504 y consultas administrativas que terminaron por timeout. | El estado administrativo no sustituye mediciones de Auth, PostgREST y PostgreSQL por separado. |
| Logs Supabase | `query_logs` permite consultar `edge_logs` por intervalo y ruta. En 00:00–01:00 UTC del 15 de octubre, `/auth/v1/token` tuvo **29 respuestas 5xx de 32**, y `enforce_docubox_session_policy` **13 de 26**; su p95 de tiempo de origen fue ~5.17 s y ~90.06 s, respectivamente. | Hay una degradación real; esta ventana **no** es línea base sana. `response.origin_time` es tiempo observado en gateway, no tiempo SQL puro. |
| Base de datos | Una lectura de `cron.job` y una consulta `SELECT 1` fallaron con `Connection terminated due to connection timeout`. | No se pudo verificar el estado real de cron, conexiones, bloqueos o contenido de `platform_incidents`. No se aplicó ninguna migración. |
| Vercel | Equipo `docubox` en **Hobby**; proyecto `docubox`. Runtime Errors agrupó `AbortError`, `AuthRetryableFetchError`, `PGRST002` y timeouts de funciones por ruta y despliegue. **Observability Plus no está habilitado**. | Aprovechar Logs/Errors nativos. Custom Metrics y análisis detallado de latencia por ruta no están disponibles aquí sin habilitar un producto de pago. |
| Retención | [Vercel Runtime Logs](https://vercel.com/docs/logs/runtime): Hobby **1 hora**; [Observability Plus](https://vercel.com/docs/observability/observability-plus) indica 12 horas de Observability básica en Hobby. Supabase Free conserva menos histórico que Pro; la retención exacta efectiva del proyecto no quedó expuesta por el conector y se debe confirmar en el panel antes de depender de ella. | Guardar únicamente resúmenes de incidentes, no copias extensas de logs. Consultar intervalos estrechos. |
| Integraciones | La API de Vercel respondió 404 al listar Drains y 403 al listar configuraciones de integraciones. No se confirma ningún destino de telemetría de terceros. | No se instaló ni contrató proveedor nuevo. Las limitaciones de acceso se deben verificar con un propietario del equipo si se quieren drenes o alertas nativas. |

La [página de estado general de Supabase](https://status.supabase.com/) puede figurar operativa aunque un proyecto específico esté degradado. Supabase describe los errores de conexión administrativa por timeout como síntomas frecuentes de una base sobrecargada, pero **no identifica con ello la causa exacta de cada 504**; véase su [guía de diagnóstico](https://supabase.com/docs/guides/troubleshooting/failed-to-run-sql-query-connection-terminated-due-to-connection-timeout).

### Inventario reutilizado

- `src/middleware.ts` ya expone `Server-Timing` con duración de middleware, claims y política de sesión. Ante fallos transitorios conserva cookies y devuelve 503; una sesión confirmadamente inválida sigue el flujo 401/redirección. La instrumentación nueva añade una línea estructurada **solo ante fallo, invalidez, expiración o lentitud >= 3 s**.
- `src/app/sign-up-login-screen/components/LoginForm.tsx` registra inicio exitoso y credenciales incorrectas mediante `/api/security/log-access`. Esa ruta escribe en `access_logs` y necesita Supabase; **no es** un indicador fiable de fallos técnicos durante una caída de la base. No se amplió con nuevos datos personales.
- `login_activity_log`, `auth_security_events` y `platform_incidents` ya existen en migraciones. `platform_incidents` se lee desde el panel administrativo; no se creó otra tabla ni se asumió que su historial real estuviera disponible mientras PostgreSQL no responde.
- Vercel tiene cinco cron diarios en `vercel.json` (02:00, 03:00, 04:20, 05:17 y 04:17 UTC). Las migraciones de `pg_cron` incluyen `form-launch-dispatch` cada minuto, tareas cada 30 minutos y una tarea de salud a los :15. La migración del 14 de octubre escalona cinco tareas a los minutos 1–5 y 31–35. **Son frecuencias declaradas en código, no una lectura de trabajos activos**; consultar `cron.job` cuando la base vuelva.
- Hay `Server-Timing` adicional en `/api/auth/totp/check`, `/api/documentos/list-metadata` y `/api/documentos/mis-participaciones`. Vercel Logs/Errors y Supabase API Gateway cubren el resto de rutas críticas sin instrumentar una segunda vez el mismo flujo.

## Arquitectura implementada localmente

1. **Fuente nativa**: Vercel Runtime Logs/Errors para Middleware, rutas y despliegues; Supabase `edge_logs`, Auth/PostgREST/PostgreSQL y panel Infrastructure para proveedor y capacidad. No hay cron nuevo, petición de sondeo en el camino del usuario, tabla nueva ni escritura de telemetría a PostgreSQL.
2. **Eventos seguros**: `src/lib/observability/events.ts` normaliza rutas dinámicas y acepta solo códigos conocidos, estado HTTP propio y upstream, duraciones, servicio, resultado, correlación aleatoria, IDs de solicitud del proveedor y SHA de despliegue. Descarta URL, query string, mensajes de excepción, correo, IP, tokens, cookies, contraseña y contenido documental. `src/instrumentation.ts` usa el hook `onRequestError` de Next.js para excepciones **no manejadas**; respuestas 503 manejadas las registra el middleware. Ningún evento hace llamadas de red.
3. **Correlación**: las respuestas protegidas del middleware incluyen `X-Docubox-Correlation-Id`, un UUID generado para la solicitud. El evento del middleware incluye ese ID y hasta cuatro IDs de respuesta de Supabase (`x-request-id`, `sb-request-id` o `cf-ray`) cuando el proveedor los entrega. Los logs de Vercel agrupan además por solicitud y despliegue. No se usa ID de usuario ni de documento.
4. **Evaluación local**: `scripts/observability/evaluate-window.mjs` recibe resúmenes **anónimos** de una ventana de hasta una hora, calcula tasas y conserva un estado mínimo de incidentes durante 30 días. No consulta proveedores ni envía notificaciones por sí mismo. El archivo de estado debe permanecer en un almacenamiento privado del operador.

La cobertura es deliberadamente distinta por capa: `/auth/v1/token` de Supabase da intentos y fallos técnicos de autenticación; `access_logs` distingue credenciales rechazadas e inicios exitosos cuando la base está disponible; middleware registra sesión inválida, expiración y sesión temporalmente no verificable. No se debe llamar “credencial incorrecta” a un 5xx o a `AuthRetryableFetchError`.

## Métricas y alertas

Para cada ruta o servicio crítico, registrar cantidad de solicitudes, 2xx/4xx/5xx, tasa 5xx, p50/p95/p99 del tiempo **upstream**, ID de despliegue y ventana UTC. Segmentar por `/auth/v1/token`, JWKS, `enforce_docubox_session_policy`, documentos, visor, firmas y evidencias. No juntar p95 de varios estados para inferir duración SQL. El panel Infrastructure de Supabase es la fuente para CPU, RAM, swap, I/O y conexiones; `pg_stat_activity`, `pg_locks`, `pg_stat_statements` y `cron.job` son diagnósticos puntuales cuando PostgreSQL esté disponible, no sondeos periódicos. `pg_stat_statements` ofrece media y máximo, no p95 SQL exacto.

Los umbrales del evaluador son **provisionales** hasta reunir una línea base de al menos 24 horas estables con tráfico comparable. Para investigación manual se recomiendan ventanas de 15 minutos; el monitor programado usa ventanas de 30 minutos para reducir consultas. La muestra degradada de arriba no debe usarse como línea base sana.

| Señal | Advertencia | Crítico | Control contra ruido |
| --- | --- | --- | --- |
| 5xx o fallo de red por servicio/ruta | >=5 y tasa >=5%, o 2 ventanas totalmente fallidas | >=10 y tasa >=20%, o 3 ventanas totalmente fallidas | Un 5xx aislado no alerta. |
| Latencia p95 | >=20 muestras y p95 >= máximo(3 s, 2× línea base sana); sin base, 8 s | >=20 muestras y p95 >= máximo(8 s, 3× base); sin base, 15 s | Reportar p50 y p99, pero no alertar con muestras insuficientes. |
| Conexión PostgreSQL | >=3 timeouts por ventana | >=10 | Contar `08006`/timeouts de conexión, sin extraer SQL o parámetros. |
| Consultas canceladas | >=3 eventos `57014` | >=10 | Separar de errores de credenciales. |
| Cambio de despliegue | tasa 5xx +5 puntos y >=2×, o p95 >=1.5×, con >=20 solicitudes antes y después | Verificar manualmente antes de atribuir causalidad | Correlación temporal, no prueba causal. |
| Datos de monitoreo ausentes | 2 ventanas consecutivas incompletas | Evaluación operativa | Nunca marcar un incidente como resuelto por falta de datos. |

El evaluador agrupa por servicio/señal, evita avisos idénticos durante **60 minutos**, notifica al escalar severidad y solo declara recuperación tras **dos ventanas completas** consecutivas bajo umbral. El estado conserva primera/última detección, severidad y resolución; elimina incidentes resueltos después de 30 días. No guarda eventos individuales ni PII. El ejecutor es la automatización activa de este chat «Alertas de disponibilidad de Docubox»: cada 30 minutos realiza una sola comprobación de salud de Auth y revisa los errores agrupados de Vercel; consulta logs agregados de Supabase solo ante anomalía o incidente abierto. Guarda el estado local en `docs/observability/monitor-state.json`, excluido de Git, y solo avisa aquí si abre, escala o resuelve un incidente, o si hay una brecha de observación. El evaluador no envía correo ni usa el sistema de notificaciones transaccionales de Docubox, que depende de la misma base que puede estar caída. El monitor depende de que el host local de Codex esté disponible; no equivale a un servicio de monitoreo independiente con garantía de continuidad.

## Consultas de diagnóstico con bajo impacto

En Supabase Logs, usar una ventana explícita de 15–60 minutos y rutas concretas. El conector `query_logs` usa SQL de ClickHouse sobre `logs`, no el SQL de PostgreSQL:

```sql
select
  log_attributes['request.path'] as path,
  count() as requests,
  countIf(toUInt16OrNull(log_attributes['response.status_code']) >= 500) as http_5xx,
  quantile(0.5)(toFloat64OrNull(log_attributes['response.origin_time'])) as p50_ms,
  quantile(0.95)(toFloat64OrNull(log_attributes['response.origin_time'])) as p95_ms,
  quantile(0.99)(toFloat64OrNull(log_attributes['response.origin_time'])) as p99_ms
from logs
where source = 'edge_logs'
  and log_attributes['request.path'] in (
    '/auth/v1/token',
    '/auth/v1/.well-known/jwks.json',
    '/rest/v1/rpc/enforce_docubox_session_policy'
  )
group by path
order by path
limit 10;
```

Para distinguir 503, 504, 520 y 522, añadir `log_attributes['response.status_code']` al `select` y `group by`. Evitar `request.url`, `request.search`, headers de autorización, IP o cuerpos. Supabase advierte que consultar logs repetidamente vuelve a escanear datos; reservarlo para incidentes y comparaciones, no para un sondeo continuo ([uso de Logs Query](https://supabase.com/docs/guides/platform/manage-your-usage/logs-query)).

Cuando la base responda, inspeccionar una vez la configuración real de tareas y presión sin leer textos de consulta ni datos de usuario:

```sql
select jobname, schedule, active from cron.job order by jobname limit 30;
select state, wait_event_type, count(*) from pg_stat_activity
 where datname = current_database() group by state, wait_event_type;
select count(*) as locks_waiting from pg_locks where not granted;
```

En Vercel, abrir **Project → Logs / Runtime Errors**, filtrar por producción, ruta, nivel y despliegue; los errores agrupados ya incluyen `AbortError`, `AuthRetryableFetchError` y `PGRST002`. No usar capturas de usuario ni URLs con tokens como evidencia de monitoreo.

### Ejecución del evaluador

Crear un archivo local privado con el siguiente formato; `requests` y `statuses` deben proceder de **la misma ventana**, y `p50/p95/p99` deben calcularse sobre esas mismas solicitudes:

```json
{
  "windowStart": "2026-10-15T00:00:00Z",
  "windowEnd": "2026-10-15T00:15:00Z",
  "complete": true,
  "deployment": "abcdef1234567890",
  "series": [
    {
      "key": "auth_token",
      "requests": 31,
      "statuses": { "200": 3, "504": 28 },
      "p50Ms": 5050,
      "p95Ms": 5200,
      "p99Ms": 5400,
      "latencySamples": 31
    }
  ],
  "postgres": { "connectionTimeouts": 0, "statementTimeouts": 0, "lockWaits": 0 }
}
```

Ejecutar `node scripts/observability/evaluate-window.mjs --input <archivo-privado.json> --state <estado-privado.json>`. El resultado JSON contiene indicadores, hallazgos y avisos; el estado usa escritura temporal y reemplazo para no truncarse. `complete: false` impide cerrar incidentes cuando falló una consulta a proveedor. Incluir una serie con ceros para indicar que se observó una ruta sin tráfico; omitirla significa **sin cobertura**, no recuperación.

## Comparación antes/después de una corrección

1. Congelar el ID de despliegue, hora UTC, plan, región y estado de Auth/base. Tomar por lo menos 24 horas PRE y 24 horas POST a horas y volúmenes comparables; no mezclar despliegues ni muestras con cantidad insuficiente.
2. Registrar por ruta: solicitudes, tasa 5xx, p50/p95/p99 upstream, errores `PGRST002`/`57014`/`08006`, fallos de sesión, p95 de middleware, CPU/swap/I/O/conexiones y ejecuciones de cron. Separar inicio de sesión de credenciales rechazadas y de token refresh fallido.
3. Para `/inicio`, `/mi-espacio`, documentos, visor, PDF, firmas y evidencias, repetir navegaciones controladas en LOCAL o entorno aislado. Medir `Server-Timing`, primer contenido útil y respuesta de backend; no hacer carga contra producción.
4. Declarar mejora solo si hay reducción sostenida de errores y p95 con tráfico comparable y **sin** regresión de seguridad o disponibilidad. Una ventana tranquila o ausencia de logs no prueba resolución. Continuar observación al menos 24 horas tras la corrección.

## Guía de respuesta a incidentes

1. **Detectar y clasificar.** Anotar UTC, despliegue, ruta normalizada y código. 400/401 por credenciales o sesión inválida se investigan aparte de 503/504/520/522. Evitar reintentos masivos desde el cliente.
2. **Aislar capa.** Comparar Vercel Runtime Errors con Auth `/health`, Auth `/token`, JWKS y la RPC de sesión en Supabase. El estado general de la plataforma no excluye un fallo del proyecto.
3. **Diagnosticar sin agravar.** Consultar una ventana pequeña de logs. Si PostgreSQL acepta conexión, revisar CPU, swap, I/O, conexiones, locks y cron; no ejecutar `EXPLAIN ANALYZE`, migraciones o pruebas de carga durante saturación. Los errores de esquema `PGRST002` y `57014` requieren correlación temporal, no solo aumentar timeouts.
4. **Mitigar.** Mantener el fallo cerrado para rutas protegidas y conservar cookies en fallos temporales. No desactivar RLS, política de sesión, MFA ni firmas. Cambios de capacidad y migraciones productivas requieren decisión separada del propietario.
5. **Recuperar y documentar.** Verificar dos ventanas completas sanas y luego 24 horas de estabilidad comparable. Usar `platform_incidents` del entorno administrativo cuando la base esté disponible o el estado privado del evaluador; registrar inicio, impacto, mitigación, resolución y evidencia, sin PII.

## Pruebas locales y activación pendiente

Pruebas ejecutables: `node --test tests/observability-events.test.mjs tests/observability-window.test.mjs tests/session-recovery.test.mjs`, `npm run type-check` y lint de los archivos modificados. Los casos sintéticos cubren Auth 504, conexión fallida, p95 lento, deduplicación, datos faltantes, recuperación de dos ventanas y normalización de rutas; `session-recovery` verifica que 503 conserve el flujo de reintento y 401 vaya al login. No se generaron incidentes artificiales en producción.

Checklist para producción, **sin ejecutarlo en esta tarea**:

- [ ] Revisar diffs y privacidad; desplegar código solo bajo una autorización de despliegue posterior.
- [ ] Confirmar retención y límites efectivos en Vercel y Supabase; decidir quién puede ver Logs/Errors y el estado privado de incidentes.
- [ ] Medir 24 horas sanas y ajustar umbrales por tráfico real. Mantener los umbrales absolutos como provisionales hasta entonces.
- [ ] Confirmar que la automatización local sigue activa en el host de Codex y que el destinatario de alertas es este chat. Para continuidad independiente del host local, decidir posteriormente un ejecutor aprobado; no sondear Logs Explorer continuamente.
- [ ] Verificar `cron.job` real, CPU, memoria, I/O y conexiones cuando PostgreSQL vuelva. La migración de política de sesión pendiente se evalúa por separado; no se aplicó aquí.
- [ ] Validar en un entorno aislado 503, 504, timeout, consulta lenta, recuperación, deduplicación y conservación de sesión; después comparar PRE/POST por 24 horas.
- [ ] Rotar la contraseña que apareció visible en una captura anterior del usuario cuando Auth esté disponible; no incluirla en tickets ni telemetría.

**Costos:** no se añadió dependencia, proveedor ni recurso de pago. La observación nativa está limitada por Vercel Hobby y Supabase Free. Observability Plus, log drains o cómputo Small/Pro son opciones futuras **no habilitadas**; sus precios y permisos deben verificarse al decidirlos. La recomendación de capacidad diferida está documentada en la [auditoría de Supabase](../performance/docubox-supabase-capacidad-2026-10-14.md).
