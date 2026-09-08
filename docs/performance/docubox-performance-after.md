# Rendimiento de Docubox después de la optimización

Fecha: 2026-09-08

Alcance: P0 a P4, con cambios pequeños y verificables.

## Resultado ejecutivo

La fase corrigió los dos riesgos con mayor impacto observado: el trabajo remoto redundante del
middleware y el bloqueo por sesión que serializaba solicitudes autenticadas concurrentes. También
eliminó una consulta global multi-tenant, paralelizó dos listados independientes, redujo JavaScript
inicial de `/mis-documentos` y cambió la vista previa de ajustes para rasterizar solo la página PDF
visible.

No se modificaron interfaces, textos, rutas visibles, permisos, reglas de participación, Legal
Hold, retención, firmas ni resultados criptográficos.

## P0: middleware, autenticación y sesiones

- Una solicitud sin cookie o Bearer ya no crea cliente Supabase ni ejecuta una llamada remota.
- El tráfico autenticado ejecuta una sola RPC de política; se eliminó el `getUser()` remoto
  redundante del middleware.
- Cookies obviamente malformadas se limpian localmente. Refresh tokens inválidos, JWT inválidos y
  el rol anónimo resultante se tratan como sesión inválida, sin retry ni error 503 engañoso.
- El cierre local posterior a un timeout se programa fuera de la respuesta con `waitUntil`.
- Assets, imágenes, fuentes, mapas y JavaScript quedaron fuera del matcher.
- La política de sesión normal dejó de tomar `FOR UPDATE`; el bloqueo solo se usa al registrar
  actividad humana o al confirmar un timeout frente a una actualización concurrente.
- Se añadió `Server-Timing: middleware;dur=...` y alerta local para ejecuciones superiores a 1 s,
  sin tokens ni PII.

Los límites siguen siendo 15 minutos de inactividad y 8 horas absolutos para usuario ordinario,
10 minutos y 4 horas para sesión privilegiada.

## P1: Supabase, RLS y listados

- `/api/documentos/listar` reutiliza el cliente autenticado para consultar con RLS y mantiene el
  filtro explícito por propietario.
- `/api/documentos/mis-participaciones` consulta con el cliente autenticado. RLS elimina documentos
  inaccesibles antes de transferir JSON de participantes o campos.
- Se retiró la segunda consulta a `document_user_visibility`; la función RLS existente
  `can_access_documento(id)` ya aplica esa misma exclusión.
- Los listados propio y de participaciones ahora comienzan con `Promise.all`.
- `owner_manage_documentos` conserva el predicado de propietario y usa `(SELECT auth.uid())`.
- Se eliminó únicamente `idx_plantillas_status`, duplicado exacto de
  `idx_plantillas_estado` después del cambio de nombre de columna.

### Verificación de Supabase

- Proyecto: `databox`, estado `ACTIVE_HEALTHY`.
- Política remota: `ALL`, rol `authenticated`, mismo predicado de propietario en `USING` y
  `WITH CHECK`.
- Índices remotos equivalentes: permanece `idx_plantillas_estado`; el duplicado ya no existe.
- Advisor `auth_rls_initplan`: 142 PRE, 141 POST.
- Advisor de índices duplicados: 1 PRE, 0 POST.
- Plan de control: `InitPlan` presente; ejecución observada 28.449 ms. Esta ejecución no se compara
  porcentualmente con PRE porque ocurrió con caché y condiciones distintas.

## P2: Next.js y React

- El modal de personalización de `/mis-documentos` se carga al abrirse.
- Tipos y configuración predeterminada se separaron en un módulo ligero.
- El modal se monta por apertura y ya no necesita copiar propiedades mediante un efecto, evitando
  un render adicional.
- LucIA ya estaba correctamente diferida y solo se monta al abrirse; se conservó.
- `pdf.js` ya se carga únicamente en rutas documentales; no se movió al layout global.

| Ruta | JS PRE | JS POST | Cambio |
| --- | ---: | ---: | ---: |
| `/mis-documentos` | 1082.7 KiB, 12 chunks | 1071.1 KiB, 11 chunks | -11.6 KiB, -1 chunk |
| Rutas restantes auditadas | sin cambio | sin cambio | 0 |

Las cifras son bytes sin comprimir de los mismos manifiestos de webpack. Los módulos aún son
pesados; no se realizó una división masiva de componentes cliente sin evidencia RUM.

## P3: PDF, Storage y procesos pesados

- `StepAjustes` antes rasterizaba hasta 50 páginas PDF secuencialmente a escala 1.5 antes de
  terminar la carga.
- Ahora rasteriza la primera página y cada página siguiente solo al navegar hacia ella, con la
  misma escala 1.5 y JPEG 0.85.
- Las imágenes ya generadas se conservan durante el paso y el documento PDF se destruye al cambiar
  de archivo o desmontar el componente.
- Los Object URL revisados cuentan con liberación; se mantuvieron los workers de `pdf.js`.
- No se cambió upload a Storage directo porque requeriría una decisión de arquitectura y una nueva
  validación integral de autorización, antivirus, hash y auditoría.

Clasificación de procesos:

| Clase | Procesos | Decisión |
| --- | --- | --- |
| A, síncrona crítica | firma, PAdES, TSA, NOM-151, hashes, evidencia | Sin cambios |
| B, asíncrona segura | notificaciones y tareas ya desacopladas cuando aplica | Sin cambio semántico |
| C, derivada | rasterización de páginas de vista previa | Bajo demanda |

## P4: caché, observabilidad y carga

| Clase | Datos | Estrategia |
| --- | --- | --- |
| `NO_CACHE` | sesión, permisos, listados privados, Legal Hold, firma y estados críticos | `private, no-store` tras validar sesión |
| `PRIVATE_USER_CACHE` | preferencias visuales locales | comportamiento existente, aislado por usuario |
| `PRIVATE_WORKSPACE_CACHE` | datos de workspace | no se añadió caché compartida |
| `PUBLIC_CACHE` | assets inmutables administrados por Next/Vercel | caché de plataforma existente |

Medición Vercel POST, cinco solicitudes por ruta después de una solicitud de calentamiento:

| Ruta | p50 POST | máximo POST | respuesta |
| --- | ---: | ---: | ---: |
| `/login` | 208.4 ms | 376.6 ms | 200 |
| `/inicio` | 96.3 ms | 99.3 ms | 307 |
| `/mis-documentos` | 106.3 ms | 139.3 ms | 307 |
| `/mis-participaciones` | 93.3 ms | 102.3 ms | 307 |
| `/mis-solicitudes` | 97.8 ms | 107.9 ms | 307 |
| `/plantillas` | 93.0 ms | 97.2 ms | 307 |
| `/formularios` | 91.9 ms | 99.2 ms | 307 |
| `/expedientes` | 99.0 ms | 103.0 ms | 307 |
| `/mis-tareas` | 97.4 ms | 125.4 ms | 307 |
| `/contactos` | 89.8 ms | 96.7 ms | 307 |
| `/reportes` | 91.9 ms | 93.4 ms | 307 |
| `/api/documentos/mis-participaciones` | 175.2 ms | 202.7 ms | 401 |

Todas reportaron `middleware;dur=0.1` ms en la última muestra. Una cookie malformada respondió 307
a `/login`, eliminó la cookie y registró 1.0 ms de middleware.

Prueba local de producción, 200 solicitudes por ruta, concurrencia 20:

| Ruta | p50 | p95 | p99 | Errores |
| --- | ---: | ---: | ---: | ---: |
| `/inicio` | 109.8 ms | 193.2 ms | 289.1 ms | 0 |
| `/mis-documentos` | 108.2 ms | 184.4 ms | 189.4 ms | 0 |
| `/api/documentos/mis-participaciones` | 115.9 ms | 200.1 ms | 205.8 ms | 0 |

La prueba usa solicitudes sin sesión y redirects manuales; valida el camino rápido y no sustituye
una prueba de carga autenticada ni RUM.

## Índices

| Clasificación | Elementos | Acción |
| --- | --- | --- |
| KEEP | `idx_plantillas_estado`, GIN de participantes e índices de rutas activas | Conservar |
| REVIEW | 401 FK sin cobertura y 490 índices sin uso observado | Revisar con tráfico y planes reales |
| SAFE_TO_REMOVE_CANDIDATE | `idx_plantillas_status` | Eliminado tras comprobar equivalencia exacta |

No se crearon 401 índices ni se eliminaron masivamente índices sin uso.

## Validación

- 36 pruebas focalizadas de sesión, rendimiento, documentos, participación, visibilidad, papelera y
  Legal Hold: PASS. Otras 24 pruebas de hash, blockchain, ciclo criptográfico y fuentes PDF: PASS.
- TypeScript: PASS.
- ESLint de archivos nuevos y endpoints modificados: PASS.
- Build Next.js, 224 páginas, compilación final 42 s: PASS.
- Carga local, 600 solicitudes: PASS, 0 errores.
- La pantalla de login local carga sin errores de consola. Se corrigió la advertencia de calidad 85
  de los logotipos.
- Los efectos preexistentes de `StepAjustes` siguen generando findings
  `react-hooks/set-state-in-effect` al ejecutar lint aislado; no fueron introducidos por la
  optimización y no se hizo un refactor funcional para ocultarlos.
- El lint global agotó más de seis minutos y varios gigabytes sin completar; el lint focalizado de
  todos los archivos modificados terminó sin errores al excluir únicamente el finding preexistente
  anterior.

`SECURITY_REGRESSION=NONE`

`RLS_SEMANTICS_UNCHANGED=true`

`BUSINESS_PROCESS_REGRESSION=NONE`

`VISUAL_REGRESSION=NONE`

`CRYPTOGRAPHIC_SEMANTICS_UNCHANGED=true`
