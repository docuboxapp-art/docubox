# Validación final de autenticación y preparación para producción

**Corte:** 15 de octubre de 2026, 02:22 UTC. **Conclusión:** `PRODUCTION_READY=NO`. Las correcciones locales reducen llamadas duplicadas y distinguen fallos técnicos de sesión inválida, pero las pruebas integrales obligatorias con Supabase Auth/PostgreSQL reales y dos tenants de prueba **no pudieron ejecutarse en un entorno aislado**. Tampoco existe una medición posterior al despliegue, porque no se desplegó. Las capturas nuevas del panel muestran servicios no saludables; la API administrativa pasó de `RESTARTING` a `ACTIVE_HEALTHY` entre 02:17 y 02:20 UTC y mantuvo `ACTIVE_HEALTHY` a las 02:22 UTC, sin confirmar recuperación de las rutas afectadas.

## Entorno, método y alcance

Se trabajó en `C:\Proyectos\docubox`. Se conservó el árbol local con cambios previos; no se hizo commit, push, despliegue, migración, cambio de plan, revocación de sesiones ni operación criptográfica. La configuración local existente apunta al proyecto de Supabase productivo. No había ramas de desarrollo de Supabase (`list_branches` devolvió `[]`), ni Supabase CLI/Docker en Windows o WSL, ni servicios locales escuchando en 54321/54322. El único proyecto accesible por el conector fue el productivo. Por tanto, usar `localhost:4028` con una sesión real habría tocado Auth y datos de producción: se limitó la prueba HTTP a solicitudes **sin autenticación**, sin mutaciones de datos. Una consulta de metadatos de RLS de solo lectura terminó por timeout y no se repitió.

Las pruebas existentes son útiles para verificar decisiones y límites de código, pero muchas son pruebas estáticas o de fallos simulados. **No sustituyen** a iniciar sesión, refrescar, revocar y cruzar usuarios en Auth/PostgreSQL auténticos. En particular, no se usaron credenciales del propietario ni se alteraron sesiones reales.

## Resultados de las fases 1 y 2

| Escenario obligatorio | Resultado y evidencia | Estado |
| --- | --- | --- |
| Login correcto e incorrecto contra Auth | Las pruebas locales cubren timeout y clasificación de credencial inválida frente a 5xx; falta cuenta de prueba aislada. | Pendiente real |
| Sesión expirada | Middleware y pruebas de política conservan separación entre expiración confirmada y fallo temporal; falta esperar/vencer una sesión real aislada. | Pendiente real |
| Refresh válido e inválido | Prueba de deadline de refresh pasó; no se ejercitó GoTrue real. | Pendiente real |
| Refresh concurrente en varias pestañas | Hay deduplicación en memoria de política por sesión, no coordinación comprobada de refresh entre pestañas/instancias. | Pendiente real, riesgo alto |
| Revocación de sesión | La RPC SQL versionada consulta `auth.sessions`; no pudo comprobarse revocación real ni acceso residual con JWT aún vigente. | Pendiente real, riesgo alto |
| Cierre local y global | Se observan `signOut({ scope: 'local' })` en expiración y `signOut()` manual global en AuthContext; no se verificaron efectos entre dispositivos. | Pendiente real |
| Cambio de contraseña | Sin usuario de prueba ni flujo de recuperación aislado. | Pendiente real |
| MFA | Rutas TOTP y pruebas de 401/503 existen; WebAuthn está implementado. No se probó alta, challenge, sesión AAL ni recuperación con Auth real. | Pendiente real, obligatorio según configuración efectiva |
| HTTP 503/504 y recuperación | 47 pruebas locales cubren tiempos límite, 401/503, conservación de sesión y reintento; 5xx reales observados en Supabase, pero no se inyectaron fallos y recuperación en entorno aislado. | Parcial |
| Redirecciones infinitas | Solicitudes locales sin sesión devolvieron un único 307 hacia `/login` para `/inicio`, `/mi-espacio` y el visor; no se recorrió el ciclo completo con sesión expirada. | Parcial |
| Cookies tras refresh/fallo | Prueba `NextResponse` confirma reenvío de cookie renovada y el código conserva cookies en 503; falta comprobar atributos y carrera de cookies reales en navegador. | Parcial |
| Operaciones protegidas cuando no se verifica autorización | Sin sesión, GET de documento y POST de firma devolvieron 401; código y pruebas locales confirman 503 sin abrir acceso ante Auth temporalmente indisponible. Falta inyección real de 503/504 con sesión existente. | Parcial, falla cerrada observada sin sesión |
| Acceso a documentos de otro usuario/tenant y participación | 49 pruebas de contratos de acceso, custodia y firma pasaron; la consulta RLS de solo metadatos a PostgreSQL falló por timeout. Sin dos identidades y dos tenants aislados no se demuestra aislamiento efectivo. | Pendiente real, riesgo crítico de validación |
| Evidencias y visor | El visor usa autorización propia después de consultar con service role; el helper común y la firma requieren identidad y acceso documentales. No se probaron descargas/firmas/evidencias cruzadas con datos reales aislados. | Pendiente real, riesgo crítico de validación |

**Smoke HTTP local sin cookie** (una solicitud por ruta, sin carga): `/login` 200 en 55 ms; `/inicio` 307 en 16 ms; `/mi-espacio` 307 en 8 ms; `/visor-documento/<id-de-prueba>` 307 en 8 ms; `/api/documentos/obtener` 401 en 106 ms; POST `/api/firma/completion` 401, `Cache-Control: private, no-store, max-age=0`, sin `Set-Cookie`. Son tiempos de la máquina local y acceso no autenticado; **no miden latencia de login, SQL, carga de documentos ni primer contenido útil**.

## Defectos concretos corregidos localmente

1. `requireDocumentAccess` agrupaba `getUser` 5xx/timeout y JWT inválido bajo 401. Ahora solo un rechazo definitivo conserva 401; fallo técnico devuelve 503 y no concede acceso. Esto afecta los endpoints sensibles que reutilizan el helper.
2. El visor `/api/documentos/obtener` también convertía un fallo de Auth en 401. Ahora una indisponibilidad o excepción en la verificación produce 503, mientras token rechazado o ausencia de sesión produce 401. Ningún caso entrega el documento sin usuario verificado.
3. `/api/firma/completion` llamaba a `getUser` dos veces por solicitud (preverificación y `requireDocumentAccess`). Ahora `requireDocumentIdentity` verifica con Auth **antes** de analizar el cuerpo y transmite esa identidad validada al helper de autorización documental, que comprueba que corresponda al mismo Bearer. Se elimina la segunda llamada sin mover la autenticación detrás del análisis del cuerpo ni de las RPC privilegiadas. Se actualizó la prueba de orden de autorización. No se modificó código criptográfico de firma.

**Verificación:** 47/47 pruebas del conjunto de estabilización y 49/49 pruebas focalizadas de acceso/custodia/firma pasaron. `npm run type-check` y ESLint dirigido sin la regla de formato pasaron; `git diff --check` pasó. ESLint completo dirigido con Prettier aún marca 64 problemas de formato en líneas preexistentes de estos archivos; no se reformató masivamente para evitar diffs ajenos. Las pruebas de 49 casos incluyen aserciones de código/migración, no una base real. No hay prueba de que los tres cambios locales estén desplegados.

## Rendimiento y concurrencia

La eliminación de la prevalidación en `/api/firma/completion` reduce de **dos a una** las llamadas `getUser` de ese flujo por lectura de código. Los tests de middleware mantienen una sola llamada `getClaims` por solicitud, y solo un reintento de política si `PGRST002` llega pronto. Esas son propiedades verificadas del código, **no una reducción medida de p95**. La muestra previa de `/mis-documentos` de ~17 s para 22 documentos y las colas de Auth/PostgREST pertenecen a producción antes de estos cambios; no existe serie POST comparable. No se midió navegación autenticada por `/inicio`, `/mi-espacio` ni visor, ni refresh simultáneo. El proveedor aún registra 5xx; véase [expediente para Supabase](supabase-support-case.md).

Las capturas aportadas al cierre muestran Database, PostgREST, Auth y Storage **Unhealthy**, indicador Disk I/O al **100 %** en la vista de 24 horas y fallo por timeout de la consulta “Peak connections”. Según la [definición del presupuesto de E/S de Supabase](https://supabase.com/docs/guides/platform/compute-and-disk), ese 100 % puede indicar presupuesto de ráfaga agotado; falta confirmar que la tarjeta use exactamente esa definición. La tarjeta instantánea muestra CPU **96 %**, pero la vista de 24 horas CPU **19 %**: son escalas y momentos distintos. La API administrativa pasó de `RESTARTING` a `ACTIVE_HEALTHY` y mantuvo ese valor en una tercera lectura a las 02:22 UTC; no se conoce el origen de la transición ni se verificó recuperación de Auth o PostgREST. La captura organizacional muestra Logs Query **94.314/100 GB**, una métrica de lectura de logs distinta de la E/S de PostgreSQL y sin restricción de cuota aplicada aún según la [documentación vigente](https://supabase.com/docs/guides/platform/manage-your-usage/logs-query). Ninguno de esos indicadores por sí solo demuestra que Nano sea la causa raíz; véase el [expediente](supabase-support-case.md).

Una captura adicional de Database a las **00:25:47 UTC** muestra memoria comprometida **1.41 GB / límite 1.2 GB** e **IOWait 41.09 %** dentro de CPU total **45.88 %**. La memoria comprometida no equivale a RAM física consumida; el IOWait tampoco identifica por sí solo el dispositivo o la causa. El reporte de 20 consultas pegado después está dominado en tiempo acumulado por tres consultas de metadatos de Studio (**85.86 % del porcentaje mostrado**, cuatro llamadas en total), no por una consulta documental identificada. Sin `stats_reset` ni correlación por minuto, esos datos fortalecen el riesgo operativo de E/S/memoria, pero no validan Auth, RLS o una mejora de rendimiento de Docubox. El [expediente](supabase-support-case.md) detalla los tiempos y preguntas para soporte.

## Riesgos y criterios de liberación

| Criterio | Estado al corte |
| --- | --- |
| Flujos integrales de Auth y sesiones exitosos con GoTrue/PostgreSQL reales | **No**; falta entorno aislado y cuentas de prueba. |
| Sin acceso entre tenants/usuarios y permisos de firma/evidencia respetados | **No demostrado**; tests estáticos pasan, RLS real sin verificar. |
| Revocación, refresh concurrente y MFA | **No demostrados**. |
| Sin regresiones críticas en checks locales | **Sí en alcance local**; no equivale a aceptación E2E. |
| Errores de infraestructura investigados | **Parcial**; panel no saludable y transición `RESTARTING` → `ACTIVE_HEALTHY` observados, expediente actualizado, causa de 5xx y recuperación pendiente del proveedor y de dos ventanas completas. |
| Rollback documentado | **Sí**, procedimiento abajo; no probado. |
| Monitoreo independiente del equipo local | **No**; la automatización actual depende del host de Codex. |

### Checklist previo a un futuro despliegue

- [ ] Proveer entorno aislado con Supabase Auth/PostgreSQL real y esquema equivalente, dos tenants, propietario, participante, tercero sin acceso, usuario MFA y sesiones de prueba. No copiar datos ni secretos productivos.
- [ ] Aplicar **solo en ese entorno** las migraciones pendientes; verificar RLS efectivo con identidades reales, `auth.sessions`, revocación, expiración y pool bajo tráfico controlado.
- [ ] Ejecutar la matriz completa de arriba en navegador y API, incluidas dos pestañas con refresh simultáneo, cookies, logout local/global, cambio de contraseña, MFA y recuperación de 503/504. Para visor, firma y evidencia, probar lectura/escritura permitida y denegación cruzada; verificar que el service role nunca sustituya autorización del usuario.
- [ ] Medir p50/p95/p99 y volumen de Auth, middleware, política, páginas y consultas en una línea base sana. Comparar 24 h PRE/POST con despliegue y tráfico equivalentes; no inferir mejora de una ventana degradada.
- [ ] Obtener respuesta de Supabase sobre los 5xx y métricas de pool/capacidad por minuto. No cambiar de plan sin decisión separada del propietario.
- [ ] Confirmar el motivo y resultado del estado `RESTARTING`, el estado real de los servicios y el significado de “No backups” antes de considerar cualquier intervención en producción.
- [ ] Revisar diff, secretos, RLS, configuración de MFA, cookies y pruebas de compilación. Decidir un ejecutor de monitoreo independiente del equipo local, con alerta y control de acceso apropiados.
- [ ] Identificar una versión previa **validada** y compatibilidad con el esquema antes de autorizar despliegue; documentar responsables, ventana y gatillos de rollback.

### Procedimiento de rollback para un despliegue futuro

1. Antes de promover código, registrar el deployment ID, SHA, versión de migraciones y métricas base. El despliegue productivo observado al corte es `dpl_HpFndij8qMDWJho7yFji4bVwX82W` (`ba1ee5e4adf983a37801ffbbb105efd930753542`), **no declarado sano**. Elegir otro candidato solo tras comprobar seguridad, compatibilidad y comportamiento.
2. Si tras activar la versión futura aumentan 5xx, p95 o fallos de sesión, o aparece acceso cruzado, detener promoción y volver en Vercel a la versión compatible previamente verificada. Confirmar `/login`, rutas protegidas, visor, firma y Auth 401/503; seguir observando. No hacer rollback ciego a un despliegue que ya presentaba el incidente.
3. La migración local `20261015003200_avoid_session_expiry_lock_queues.sql` **no está aplicada en producción**. Si se aprobara después, preparar y ensayar reversión o restauración de base en aislado antes de aplicarla; un rollback de código no revierte SQL ni sesiones. Cualquier intervención productiva requerirá autorización aparte.

**Recomendación:** mantener la versión local como candidata de corrección, sin declararla lista para producción. Los bloqueos principales son Auth/RLS/MFA/refresh/revocación sin validación real aislada, 5xx del proveedor sin causa confirmada, ausencia de métricas POST y monitor aún dependiente del equipo local.
