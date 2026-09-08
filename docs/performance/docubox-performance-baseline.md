# Baseline de rendimiento de Docubox

Fecha de captura: 2026-09-08

Commit: `389ccef75ca789270ccd8932700394079f81adf5`

Entornos: build local de producción, Vercel producción y Supabase producción.

## Alcance y método

- `next build --webpack` para compilación y manifiestos de chunks.
- Manifiestos `page_client-reference-manifest.js` para JavaScript por ruta. Los tamaños son bytes
  sin comprimir y contienen chunks compartidos; sirven para comparar el mismo build antes/después.
- Tres solicitudes HTTP sin sesión por ruta al alias productivo. Se usa mediana como p50 local del
  cliente de prueba; no reemplaza RUM ni una prueba desde la misma región de Vercel.
- Runtime Errors de Vercel para los últimos siete días.
- Supabase Advisors, `pg_stat_user_tables` y `pg_stat_statements` en producción.
- Inspección estática de componentes, consultas y rutas críticas.

## Build y JavaScript

| Métrica | PRE |
| --- | ---: |
| Compilación optimizada | 25.2 s |
| Páginas generadas | 224 |
| Archivos TSX | 239 |
| Componentes con `use client` | 194 (81.2%) |
| Llamadas exactas `.select('*')` | 166 |

| Ruta | Chunks JS | JS sin comprimir | Clasificación |
| --- | ---: | ---: | --- |
| `/inicio` | 13 | 933.0 KiB | HEAVY |
| `/mis-documentos` | 12 | 1082.7 KiB | EXCESSIVE |
| `/mis-participaciones` | 11 | 910.9 KiB | HEAVY |
| `/mis-solicitudes` | 12 | 920.8 KiB | HEAVY |
| `/plantillas` | 11 | 863.2 KiB | HEAVY |
| `/formularios` | 11 | 867.9 KiB | HEAVY |
| `/expedientes` | 12 | 872.3 KiB | HEAVY |
| `/mis-tareas` | 13 | 926.3 KiB | HEAVY |
| `/contactos` | 11 | 902.2 KiB | HEAVY |
| `/reportes` | 12 | 1289.4 KiB | EXCESSIVE |
| `/firmar-documento/[id]` | 9 | 803.2 KiB | HEAVY |
| `/visor-documento/[id]` | 14 | 1076.7 KiB | EXCESSIVE |

## Middleware y autenticación

El middleware ejecuta secuencialmente `supabase.auth.getUser()` y
`enforce_docubox_session_policy()` para tráfico autenticado. Una solicitud sin indicio de sesión
también llega a `getUser()` salvo que coincida con un prefijo público.

Vercel, últimos siete días:

| Evento | Ocurrencias | Usuarios | Ruta |
| --- | ---: | ---: | --- |
| Sin respuesta inicial en 25 s | 18 | 2 | `/middleware` |
| `refresh_token_not_found` | 8 | 3 | `/middleware` |

`pg_stat_statements` para la política de sesión:

| Llamadas | Media | Máxima | Tiempo total |
| ---: | ---: | ---: | ---: |
| 23 | 470.74 ms | 2338.08 ms | 10827.08 ms |

## TTFB HTTP sin sesión

Estas rutas protegidas responden con redirect y no miden el render autenticado.

| Ruta | p50 | máximo | respuesta |
| --- | ---: | ---: | --- |
| `/login` | 612 ms | 2134 ms | 200 |
| `/inicio` | 423 ms | 585 ms | 307 |
| `/mis-documentos` | 285 ms | 520 ms | 307 |
| `/mis-participaciones` | 267 ms | 350 ms | 307 |
| `/mis-solicitudes` | 299 ms | 353 ms | 307 |
| `/plantillas` | 300 ms | 306 ms | 307 |
| `/formularios` | 302 ms | 311 ms | 307 |
| `/expedientes` | 280 ms | 294 ms | 307 |
| `/mis-tareas` | 300 ms | 330 ms | 307 |
| `/contactos` | 309 ms | 329 ms | 307 |
| `/reportes` | 310 ms | 336 ms | 307 |
| `/api/documentos/mis-participaciones` | 409 ms | 1331 ms | 401 |

## Supabase y consultas

Snapshot exacto: 35 documentos, 4 perfiles, 4 membresías y 0 plantillas. Las estadísticas de
tablas habían sido reiniciadas o no analizadas (`n_live_tup=0`), por lo que no se usan para inferir
cardinalidad.

Advisors de rendimiento:

| Finding | Cantidad |
| --- | ---: |
| Foreign keys sin índice de cobertura | 401 |
| `auth_rls_initplan` | 142 |
| Índices sin uso observado | 492 |
| Políticas permisivas múltiples | 52 |
| Índices duplicados | 1 |

Hallazgo crítico: `/api/documentos/mis-participaciones` consulta todos los documentos no
eliminados con `service_role`, recupera JSON de participantes/campos y filtra al usuario en Node.
Después realiza consultas secuenciales de visibilidad y perfiles. Con la cardinalidad actual la
consulta registrada promedia 98.05 ms, pero su costo y payload crecen con todos los tenants.

## Métricas no disponibles en PRE

- LCP, INP y CLS autenticados: no existe una serie RUM accesible en el proyecto.
- TTFB autenticado y requests por navegación: requieren una sesión de prueba instrumentada.
- Payload autenticado por listado: no se capturó contenido privado en esta auditoría.
- p95/p99 de APIs: el volumen observado no es suficiente para percentiles representativos.

Estos campos permanecerán como `N/D` en la comparación si no existe una medición equivalente y
reproducible después de los cambios.

## Presupuesto objetivo

- Middleware normal: menos de 100 ms y sin dependencia remota cuando no existe sesión.
- TTFB de navegación común: menos de 800 ms.
- API común p95: menos de 1 s, salvo operaciones pesadas documentadas.
- LCP menor de 2.5 s, INP menor de 200 ms y CLS menor de 0.1 cuando exista RUM.
