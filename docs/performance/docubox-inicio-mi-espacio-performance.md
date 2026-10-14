# Rendimiento de Inicio y Mi Espacio — 14 de octubre de 2026

## Resultado y alcance

Se corrigieron dos fuentes comprobables de solicitudes redundantes sin cambiar la interfaz ni las decisiones de autorización. La mejora determinista es de **dos solicitudes de aplicación a una** para obtener documentos y metadatos iniciales de Mi Espacio: `read-bootstrap` ahora transmite carpetas y etiquetas como una tercera parte opcional. La consulta de disponibilidad de formularios publicados de Inicio se comparte mientras está en vuelo. Las preferencias de columnas de las secciones ocultas dejan de solicitarse al abrir Mi Espacio.

**No se pudo demostrar una reducción estable del tiempo percibido**. Supabase/Auth/PostgREST mostró latencias y errores intermitentes durante las medidas: validaciones de política de sesión de 9 a 27 segundos, `PGRST002` de caché de esquema y una consulta de documentos que acabó en `57014` (`statement timeout`). La consulta equivalente con RLS activo devolvió 22 filas en 88.354 ms de ejecución de PostgreSQL, de modo que atribuir los 93 segundos observados al plan SQL o al cambio de la interfaz sería incorrecto. No se modificaron RLS, índices ni política de sesión sin evidencia de un plan deficiente o de equivalencia semántica.

## Ruta crítica observada

```text
/inicio
  navegación → middleware (getClaims → enforce_docubox_session_policy)
             → HTML/JS y AuthContext + WorkspaceContext
             → perfil/subscripción del dashboard (opcional)
             → en paralelo: documentos propios + participaciones
             → los cuatro widgets documentales publican el resultado conjunto
             → bitácora/otros widgets realizan sus lecturas independientes

/mis-documentos, sección «Mi espacio»
  navegación → middleware (getClaims → enforce_docubox_session_policy)
             → HTML/JS y AuthContext
             → getSession para el token del cliente
             → /api/documentos/read-bootstrap?metadata=1
                ├── listar: getUser → documentos con RLS → Legal Hold/origen de formulario
                ├── mis-participaciones: autorización y consulta propia
                └── list-metadata: getUser → carpetas/etiquetas
             → primeros documentos propios al recibir su parte del stream
             → mezcla de participaciones al recibir su parte
             → carpetas/etiquetas sin bloquear los primeros documentos
```

Los componentes `EstadoDocumentosWidget`, `EstadoParticipacionesWidget`, `SugeridosParaTiWidget` y `DocumentosSinRevisionWidget` usan los mismos dos conjuntos de datos. Ya existía una única lectura por conjunto y una espera conjunta (`Promise.all`); por eso, el conjunto más lento retrasa los cuatro widgets. Publicar resultados incompletos produciría contadores y sugerencias temporalmente incorrectos, así que no se cambió esa regla. `ActivityAuditLog` tiene una lectura separada porque muestra datos distintos. La consulta de `form_templates` de Inicio determina la disponibilidad de la acción de lanzar formularios; ahora se deduplica solo mientras está pendiente, sin caché de permisos ni cambio del refresco por foco.

En Mi Espacio, `listar` selecciona campos de lista y resúmenes necesarios para las acciones de ciclo de vida; no descarga PDF, XML, evidencia, certificados ni auditoría completa. Su consulta actual **no aplica paginación explícita**. La muestra observada fue de 22 documentos y el plan usó el índice existente `idx_documentos_owner_active_updated_at`; añadir `LIMIT` sin paginar también filtros y contadores cambiaría el comportamiento. Queda como trabajo pendiente si el volumen real crece y se prueba que domina la latencia.

## Medición PRE/POST y límites

Se inspeccionaron navegación, registros del servidor, `Server-Timing`, respuestas de aplicación y consultas PostgreSQL. Se intentaron cinco recargas frías previas, pero varias trazas se interrumpieron por timeouts/HMR; no constituyen cinco muestras válidas. El servicio siguió intermitente después del cambio, por lo que tampoco se obtuvo la serie exigida de cinco frías y diez calientes **por ruta y versión**. No se calculan p50/p95 ni porcentajes de mejora con una muestra inválida.

| Señal | Antes | Después | Interpretación |
| --- | ---: | ---: | --- |
| Solicitudes iniciales para listas + carpetas/etiquetas en Mi Espacio | 2 rutas (`read-bootstrap`, `list-metadata`) | 1 ruta (`read-bootstrap?metadata=1`) | Reducción estructural verificable; las tres partes siguen autorizadas. |
| Lecturas de preferencias de ancho en secciones ocultas | Hasta 4 adicionales observadas | Solo se inicia la sección activa | Reducción estructural; no se cuantificó una serie de navegación estable. |
| Inicio, ejemplo de TTFB y evento `load` | 4,855 ms / 6,826 ms | No comparable | La misma sesión previa mostró widgets a 11,794 ms y otra carga a 28,649 ms bajo degradación. |
| Mi Espacio, ejemplo de `read-bootstrap` | 18,710 ms | 8,800 ms en una ejecución posterior | No es una comparación causal: la latencia de Supabase cambió entre muestras. En el POST, middleware 283 ms y aplicación 6,400 ms. |
| Mi Espacio, recarga autenticada posterior | No comparable | 22 filas visibles alrededor de 20 s después de recargar | Confirma que el objetivo perceptible sigue incumplido pese a la reducción de rutas. |
| Plan de `documentos` con rol `authenticated` y RLS | 22 filas; planificación 112.226 ms; ejecución 88.354 ms | Sin cambio SQL | `Index Scan`, sin evidencia de falta de índice para este caso. |
| Política de sesión en `pg_stat_statements` | 2,137 llamadas; media 346.9 ms; máximo 6,839.3 ms en PostgreSQL | Sin cambio | El tiempo extremo de middleware incluye otras fases de gateway/red/reintentos; no equivale al tiempo SQL. |

Los registros agregados de Supabase de las últimas 24 horas (ventana que **mezcla PRE y POST**, por lo que no es un benchmark de la corrección) muestran 1,025 respuestas 200 de `/rest/v1/rpc/enforce_docubox_session_policy`: p50 de 128 ms, p95 de **6,703 ms**, máximo de 49,499 ms de tiempo upstream. En 332 respuestas 200 de `/rest/v1/documentos` con filtro `owner_id`, el p95 upstream fue **15,729 ms**, máximo de 113,891 ms; agrupa distintas lecturas del mismo recurso y no representa exclusivamente Mi Espacio. Hubo además respuestas 500/503/504. En la misma ventana, PostgREST registró 325 menciones de caché de esquema y 26 de `statement timeout`; PostgreSQL registró 49 menciones de `statement timeout`. Estas cifras sitúan la cola larga en la frontera Auth/PostgREST/BD y confirman que el problema no está limitado a la hidratación de React.

También hubo una carga previa de Mi Espacio con TTFB de 12,425 ms, evento `load` a 15,192 ms y documentos a más de 83 s; sus marcas se mezclaron con recargas/HMR y **no** se usan como línea base. Una carga local posterior con backend recuperado mostró TTFB 1,311 ms, `load` 3,807 ms, propios 5,928 ms y lista mezclada 6,316 ms; tampoco demuestra el efecto del cambio, pues la carga del servicio era distinta. Una solicitud POST del middleware aún tardó 9,483 ms, de los cuales 9,451 ms fueron `session_policy_ms`. La medida de 20 s se tomó con reloj externo a la página y es aproximada. La meta de primer contenido <1 s, lista <1.5 s y p95 <250 ms no está alcanzada ni demostrada.

No hay medición PRE/POST reproducible del tamaño JS, hidratación ni perfil de React bajo carga estable. Las rutas siguen siendo páginas cliente por sus interacciones, y la compilación de producción terminó correctamente. No se introdujeron importaciones de PDF.js, OCR, biometría o editores en estas rutas. No se afirma mejora de bundle sin tamaños comparables.

## Seguridad y consultas

- `read-bootstrap` conserva el `Bearer` obligatorio. Cada handler delegado conserva su autenticación y sus condiciones originales; `listar` usa el JWT en un cliente anon con RLS y filtro `owner_id`, `mis-participaciones` mantiene su frontera propia y `list-metadata` valida `getUser` y filtra carpetas por propietario. La parte de metadatos es optativa para conservar los demás consumidores del endpoint.
- El middleware sigue ejecutando `getClaims` y `enforce_docubox_session_policy` antes de páginas protegidas. No se cacheó una decisión de sesión, permiso, Legal Hold o acceso entre solicitudes.
- `EXPLAIN (ANALYZE, BUFFERS)` se ejecutó bajo `SET LOCAL ROLE authenticated` dentro de una transacción terminada con `ROLLBACK`; RLS permaneció activo. Se observó un `Index Scan` sobre documentos del propietario. No se creó índice ni se modificó función/política RLS.
- La ruta `listar` realiza consultas complementarias para resúmenes de Legal Hold y descripción de origen de formulario, paralelas **después** de conocer los IDs. Son una dependencia real, no un waterfall accidental que se pueda eliminar sin cambiar la respuesta. La consulta de carpetas y etiquetas ya era paralela entre sí.
- Las medidas de `getClaims`, `getUser`, `getSession` y la RPC provienen de `Server-Timing` y trazas parciales; el total por navegación completa no se pudo contar con fidelidad durante los errores del gateway. No se presenta un conteo supuesto.

## Verificación

- `npm run type-check`: aprobado.
- `npm run build`: aprobado con Next.js 16.3.4; advertencia previa del convenio `middleware` deprecado.
- Pruebas dirigidas de Inicio, Mi Espacio, documentos, Auth, sesión y aislamiento entre tenants: 54/54 aprobadas.
- Suite ampliada con prueba de viewer: 62/63; una aserción de formato del riel (`w-full max-w-[56px]`) falla en un archivo del viewer no modificado. No se alteró su diseño para satisfacer una aserción ajena a este trabajo.
- ESLint de archivos editados: las nuevas líneas del stream se formatearon; los archivos grandes conservan errores `prettier/prettier` preexistentes en líneas no modificadas y advertencias de `any`. No se reformatearon páginas enteras para evitar un diff visual masivo.

El bloqueo restante para una comparación estadística válida es la variabilidad de la validación de sesión y del gateway de datos, no un índice faltante demostrado en la consulta de 22 documentos. Para cerrar el objetivo perceptible hacen falta trazas completas repetibles del entorno servido y revisar la causa operativa de esas demoras de Auth/PostgREST antes de atribuir nuevos cambios al frontend.
