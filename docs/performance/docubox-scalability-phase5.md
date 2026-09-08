# Fase 5: balanceo, concurrencia y escalabilidad

Fecha: 2026-09-08

## Resultado ejecutivo

Docubox puede ejecutarse horizontalmente en Vercel sin afinidad de sesión ni estado autoritativo
en memoria. La aplicación usa las APIs de Supabase para datos, Auth y Storage; no abre conexiones
PostgreSQL directas desde las funciones serverless y, por tanto, no mantiene un pool local que se
multiplique por instancia.

La auditoría corrigió seis problemas demostrables:

| Severidad | Hallazgo | Corrección |
| --- | --- | --- |
| Alta | El rate limit público vivía en `Map` por instancia y podía evadirse al escalar | Contador atómico distribuido en PostgreSQL, cerrado ante fallo |
| Alta | El runner criptográfico usaba un booleano y un `Map` locales | Lease durable en `platform_system_jobs` y claim serializado corto |
| Media | Invitaciones concurrentes podían llegar duplicadas | Clave idempotente estable por tipo, documento y destinatario |
| Media | El verificador hacía tres consultas y consultaba una tabla de perfil inexistente | RPC de bundle en un solo viaje, usando `user_profiles` |
| Media | Se persistían URLs firmadas de Storage por un año | Los documentos nuevos usan el endpoint autenticado `viewer-file` |
| Baja | Los buckets distribuidos vencidos no se eliminaban | Índice por expiración y limpieza oportunista acotada con `SKIP LOCKED` |

No se cambiaron interfaces, reglas de participación, resultados de firma, PAdES, TSA, NOM-151,
Legal Hold, retención ni hashes.

## Arquitectura

| Área | Clasificación | Resultado |
| --- | --- | --- |
| Vercel | Serverless distribuido | Compatible; sin balanceador externo ni afinidad requerida |
| Sesión | Cookie/JWT y política de servidor | Sin estado de sesión autoritativo en RAM |
| Datos | `supabase-js` / Data API | Sin driver PostgreSQL ni pool de aplicación |
| Coordinación | PostgreSQL | Claims y límites atómicos compartidos por todas las instancias |
| Archivos | Supabase Storage privado | Descarga interna o URL firmada de 5-10 min sólo tras autorización |
| Temporales OTS | Directorio único de `os.tmpdir()` | Efímero por invocación, `wx` y eliminación en `finally`; no autoritativo |
| Trabajos | Tablas de jobs, checkpoints y crons existentes | Base disponible para separar workers futuros sin hacerlo en esta fase |

Los `Set` de módulo restantes contienen catálogos inmutables. El cliente Supabase cacheado no
contiene estado de negocio y puede recrearse en cualquier instancia.

## PostgreSQL y Supabase

No existen `DATABASE_URL`, `pg`, Prisma, Postgres.js ni conexiones directas en runtime. Por ello:

- pool de conexión de aplicación: no aplica;
- Supavisor transaction mode: no es necesario mientras el runtime siga usando Data API;
- aumento de `max_connections`: rechazado por falta de evidencia;
- prepared statements en serverless: no aplica;
- réplica de lectura: no recomendada con el volumen observado.

Muestra alrededor de la carga controlada:

| Métrica | Antes | Después |
| --- | ---: | ---: |
| `max_connections` | 60 | 60 |
| conexiones cliente | 13 | 13 |
| activas | 1 | 1 |
| idle | 12 | 12 |
| idle in transaction | 0 | 0 |
| activas esperando | 0 | 0 |
| deadlocks | 0 | 0 |
| conflicts | 0 | 0 |

El verificador pasó de aproximadamente 5.2 transacciones PostgreSQL por solicitud en la línea base
a aproximadamente 2.0, incluyendo límite distribuido y bundle de verificación. La adquisición p95
de conexión no es observable desde la aplicación porque PostgREST administra esas conexiones; no
se inventa una cifra.

Las funciones de coordinación y rate limit usan `SECURITY DEFINER` porque escriben tablas internas;
validan el rol o delegan en una función que lo valida. El bundle de lectura usa `SECURITY INVOKER`.
Todas revocan `PUBLIC`, `anon` y `authenticated`, y conceden ejecución sólo a `service_role`. La
comprobación remota confirmó esos permisos.

## Concurrencia

Casos revisados:

| Flujo | Mecanismo |
| --- | --- |
| Verificación pública simultánea | UPSERT atómico por clave e IP; 31 llamadas dieron 30 `200` y una `429` |
| Runner de ciclo criptográfico | advisory lock sólo durante claim; lease durable de 15 min |
| Invitaciones por correo | `Idempotency-Key` estable reenviado al proveedor |
| Certificación y PAdES | compare-and-swap, leases y checkpoints existentes; sin cambio |
| OpenTimestamps | colas y claims separados existentes; temporales aislados |
| Sesiones concurrentes | comprobación normal sin bloqueo de fila; lock sólo para actividad/timeout |
| Carga y descarga | paths por workspace/documento y visor autenticado; sin archivo local compartido |

La limpieza de rate limits procesa como máximo 256 filas vencidas, toma filas con
`FOR UPDATE SKIP LOCKED` y sólo se activa para 1 de cada 256 hashes uniformes. Una prueba sembró un
bucket vencido y confirmó su eliminación sin afectar la solicitud válida.

## Prueba de carga

Objetivo: endpoint público de verificación completada, de sólo lectura y sin proveedores externos.
Runtime: build Next.js de producción local en puerto aislado. Se calentó antes de medir.

| Concurrencia | p50 | p95 | p99 | Throughput | Respuestas |
| ---: | ---: | ---: | ---: | ---: | --- |
| 1 | 501.3 ms | 501.3 ms | 501.3 ms | 1.99 req/s | 1 `200` |
| 10 | 696.5 ms | 756.7 ms | 756.7 ms | 13.04 req/s | 10 `200` |
| 25 | 588.5 ms | 686.2 ms | 696.0 ms | 35.64 req/s | 25 `200` |
| 50 | 754.0 ms | 829.4 ms | 860.1 ms | 57.39 req/s | 50 `200` |

Proceso Node después de la carga: 156.3 MB de working set, 163.3 MB privados y 308 handles. No
hubo crecimiento de conexiones PostgreSQL, espera ni deadlock. El CPU acumulado del proceso fue
7.11 s. En la matriz hubo 0 respuestas `500`, `502`, `503` o `504`; la prueba separada del límite
produjo 30 `200` y una `429`. La ruta medida no descarga objetos, por lo que latencia Storage no
aplica; la latencia DB está incluida en la respuesta y PostgREST no expone adquisición individual.

Como señal direccional en el mismo servidor de desarrollo, dos corridas PRE a concurrencia 50
tuvieron p50 de 4.14-4.49 s y throughput de 9.97-11.22 req/s. Dos corridas POST tuvieron p50 de
1.15-2.77 s y throughput de 16.96-39.82 req/s. El entorno de desarrollo fue variable; la tabla de
producción local es la referencia reproducible y no se presenta un porcentaje engañoso.

No se lanzó carga contra Vercel: el proyecto está en Hobby y la política vigente de Vercel sólo
permite load testing en Enterprise con coordinación previa. Tampoco se probaron cargas destructivas,
firmas reales, TSA, NOM-151, correos o IA con costo. Esos flujos se validaron mediante sus suites de
idempotencia, autorización, aislamiento, leases, fail-closed y evidencia, no generando artefactos
productivos para simular carga.

## Storage y residuos

El código dejó de generar URLs firmadas de un año. Persisten 16 registros históricos con URLs
firmadas ya emitidas; todos corresponden a archivos legacy sin metadatos de cifrado. No se
reescribieron automáticamente porque el visor cifrado los rechazaría de forma cerrada y produciría
una regresión funcional. Los tokens existentes expirarán según su emisión; para revocación inmediata
se requiere una migración controlada de objetos o rotación de secreto, fuera de esta fase.

## Réplicas y workers

No se creó réplica: no hay saturación, espera ni volumen que la justifique. Incluso si se añade en
el futuro, autenticación, autorización, estado posterior a firma, Legal Hold y evidencia vigente
deben continuar en el primario.

Firma, PAdES, TSA, NOM-151 y finalización permanecen síncronos y fail-closed. La arquitectura ya
cuenta con jobs, leases, checkpoints, idempotencia y dead-letter para separar trabajo pesado más
adelante sin cambiar el contrato de negocio en esta fase.

## Validación

- Build Next.js de producción: PASS, 224 rutas.
- TypeScript: PASS.
- ESLint focalizado: 0 errores; 54 warnings preexistentes en rutas heredadas.
- Pruebas focalizadas: 34 PASS.
- Suite completa: 385 pruebas, 372 PASS, 10 omitidas y 3 fallos preexistentes no relacionados.
- Supabase: tres migraciones aplicadas y alineadas con el historial remoto.
- Advisors: ningún hallazgo nuevo atribuible a las funciones de esta fase.

Fallos preexistentes de suite: capability LucIA para `/firma-movil/sample-resource`, prueba antigua
del redirect de notificaciones y aserción antigua de TOTP que espera `service.auth.getUser`.

`ARQUITECTURA_DISTRIBUIDA_COMPATIBLE=true`

`ESTADO_LOCAL_AUTORITATIVO=NONE`

`STATELESS_APP_LAYER=true`

`DATABASE_CONNECTION_POOLING=VERIFIED`

`CONNECTION_STORM_RISK=CONTROLLED`

`STORAGE_SCALABILITY=VERIFIED`

`CROSS_TENANT_CACHE_RISK=NONE`

`RACE_CONDITIONS_CRITICAL=NONE`

`LOAD_BALANCING_ARCHITECTURE=VERIFIED`

`POOL_POSTGRESQL_SERVERLESS=N/A_DATA_API`

`RLS_SEMANTICS_UNCHANGED=true`

`TENANT_ISOLATION_REGRESSION=NONE`

`BUSINESS_PROCESS_REGRESSION=NONE`

`CRYPTOGRAPHIC_SEMANTICS_UNCHANGED=true`

`CRITICAL_CONCURRENCY_FINDINGS=NONE`
