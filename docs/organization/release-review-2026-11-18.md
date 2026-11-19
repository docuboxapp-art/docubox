# Revisión de Organización y activación de Supabase

Las once migraciones de esta activación están aplicadas y verificadas en el proyecto principal. Pasaron las regresiones transaccionales con el esquema real y la prueba de Storage privado. Esto no certifica todos los proveedores externos ni los controles globales que siguen pendientes.

## Activación y correcciones verificadas

- Se recuperó la disponibilidad del conector SQL sin cambiar plan, cómputo, propietarios, contraseñas o configuración del proyecto. No se atribuye una causa definitiva al timeout anterior ni se garantiza que no vuelva a ocurrir.
- El historial completo quedó reconciliado con los archivos locales. Una migración antigua de firma opcional también estaba pendiente y ahora respeta `requiresSignature: false`; omitir la opción mantiene la firma predeterminada.
- Se retiró la ejecución anónima de los RPC de Organización. El aprovisionamiento y los triggers quedaron fuera de los permisos del navegador, conservando los puntos de entrada autorizados.
- Las funciones compartidas de acceso nativo y de Colabora ahora excluyen miembros suspendidos o vencidos. Las organizaciones deshabilitadas quedan fuera del acceso nativo; los espacios personales y las reglas comerciales existentes conservan su comportamiento.
- Guardar un formulario en `started` o `in_progress` ya no entrega ni congela el requisito. La entrega se registra al enviarlo; las respuestas enviadas conservan su inmutabilidad. Una respuesta cancelada no se puede enviar o aprobar como entrega.
- Los disparadores de directorio, evidencias, recursos compartidos y políticas seleccionan la tabla antes de acceder a sus campos. Se corrigieron los errores reales de campo inexistente que impedían guardar evidencias y archivar políticas publicadas.
- El control de permisos de recursos se comprobó con 33 políticas restrictivas. El navegador no tiene INSERT, UPDATE ni DELETE directo sobre la raíz de tareas.
- Storage real: se cargó un PDF sintético de 5,245,668 bytes mediante autorización firmada, se descargó y comprobó su SHA-256, se rechazó la descarga anónima y se eliminó el objeto temporal.
- Auth `/health` devolvió 200 en una muestra de 918 ms; ese dato no prueba por sí solo una recuperación sostenida de todos los servicios.

Las regresiones `verify-organization-teams-roles.sql`, `verify-organization-catalogs.sql`, `verify-organization-directory-history.sql` y `verify-organization-colabora-runtime.sql` pasaron en Supabase y terminaron en ROLLBACK. La última crea dos organizaciones transitorias, prueba los alcances propio/asignado/equipo, revocaciones, transacciones de tareas y evidencias, publicación/archivo y vínculos de formularios, OTP, borrador editable, envío, aprobación y cierre de solicitud. No creó usuarios Auth ni envió correos o firmas reales. Una consulta posterior confirmó cero organizaciones de QA persistidas.

La organización existente devuelve `eligible: true`, `accessible: true`, `write_allowed: false`, `commercial_tier: standard` y `code: READ_ONLY`: su habilitación `collaboration_core` proviene de una prueba cuyo periodo terminó. Ese estado se conservó. No se extendió la prueba, otorgó acceso permanente, contrató un complemento ni cambió el plan de Supabase. Las escrituras de la regresión usaron sólo organizaciones y habilitaciones sintéticas dentro del ROLLBACK; no prueban una escritura actualmente permitida a la cuenta real.

## Correcciones adicionales

- La entrada de sesión se migró de `src/middleware.ts` a `src/proxy.ts`, siguiendo la documentación instalada de Next.js 16.3.4. Se conservaron matcher, validaciones, manejo de cookies, rutas públicas, kiosco y métricas. Pasaron 93 comprobaciones de esos contratos y flujos relacionados.
- Se optimizó el catálogo de permisos con una consulta relacional. Los permisos amplios usan un conjunto de espacios calculado una vez por consulta sobre filas sin referencias a padres. Las referencias padre y los roles limitados conservan su comprobación completa; se verificó un padre de otro espacio y los detalles quedaron excluidos.
- La evidencia del directorio mantiene su límite de 15 MB mediante carga directa firmada al almacenamiento privado. Preparación y confirmación usan JSON pequeño; el archivo no atraviesa el cuerpo de una función de Vercel. El servidor comprueba usuario, organización, vencimiento, tamaño, contenido y SHA-256 antes de crear el registro.
- Confirmar una evidencia crea su versión y auditoría en una transacción. Repetir la confirmación no crea duplicados. La carga no convierte un documento en verificado; conserva `pending`.
- La ruta multipart anterior conserva compatibilidad para archivos pequeños y usa la misma transacción, verificación de contenido y comprobación de disponibilidad. La interfaz utiliza la carga directa para evitar el límite de cuerpo de Vercel. Una respuesta RPC perdida no provoca el borrado de un archivo posiblemente confirmado; los objetos privados sin confirmación requieren una futura política de limpieza.
- Se añadió la ejecución diaria de `/api/organizacion/continuity/process` al cron existente de Vercel. La cadencia diaria conserva el plan actual y puede introducir demora hasta el siguiente lote; no se presenta como ejecución exacta al minuto.
- Las variables requeridas para la custodia de credenciales y el cron existen en Production. La clave de custodia también existe en Preview. No se imprimieron valores ni se cambiaron planes.
- Se preparó `scripts/qa/verify-organization-release.sql`, que comprueba metadatos, RLS, privilegios, triggers y funciones sin modificar registros.

## Revisión de las 17 secciones

| Sección                | Código y conexiones revisados                                                   | Límite de verificación                                                      |
| ---------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Resumen                | Navegación, indicadores, permisos y manejo de fuentes no disponibles            | Recorrido real con sesión del usuario pendiente                             |
| Perfil                 | Edición y persistencia de datos organizacionales                                | Requiere recorrido autenticado real                                         |
| Miembros               | Invitación, detalle, equipos y roles                                            | Correo y aceptación real pendientes                                         |
| Equipos y áreas        | Miembros, responsable, suplente y guardado atómico; regresión SQL real aprobada | Recorrido autenticado en pantalla pendiente                                 |
| Roles y permisos       | Permisos por acción, ámbitos y editor de unidades                               | Alcance transversal fuera de Colabora pendiente                             |
| Directorio             | Ficha, evidencia privada, versionado e historial; SQL y Storage real probados   | Recorrido autenticado completo de la API pendiente                          |
| Facultades             | Formularios, relaciones, vigencias y editor                                     | Ejecución efectiva en todas las operaciones legales pendiente               |
| Flujos de aprobación   | Edición, versiones y worker con revalidación                                    | Recorrido completo del workflow real pendiente                              |
| Políticas de firma     | Configuración versionada, relaciones, publicación, archivo e inmutabilidad      | Cobertura transversal y proveedores pendientes                              |
| Plantillas y recursos  | Catálogo y vínculos canónicos                                                   | Prueba autenticada del catálogo real pendiente                              |
| Continuidad            | Solicitud, sucesión, ejecución y cron conectados                                | No se ejecutó una baja o transferencia real                                 |
| Seguridad              | Permisos RPC, membresías vigentes y aislamiento comprobados                     | MFA, SSO, redes y sesiones por organización aún requieren aplicación global |
| Certificados           | Inventario y permisos editables/revocables                                      | Vinculación de esos permisos a KMS/HSM y validación real pendientes         |
| Integraciones          | Configuración, controles y estados reales                                       | SSO, directorio y otros proveedores reales pendientes                       |
| Marca y comunicaciones | Plantillas, remitentes, dominios y comprobación DNS                             | Entrega real de esta versión pendiente                                      |
| Plan y consumo         | Suscripción, historial y centros de costo                                       | No se simula facturación fiscal ni se cambió de plan                        |
| Auditoría              | Consulta, exportación, registros de mutación y permisos                         | Verificación remota de integridad y permisos pendiente                      |

Las pruebas de interfaz recorren las secciones y pestañas con componentes reales y un servidor sintético. Eso no equivale a aprobar cada operación real o proveedor.

## Validación de la entrega

- Compilación de producción con Next.js 16.3.4 y TypeScript aprobada; entrada Proxy comprobada sin las advertencias anteriores del runtime Edge.
- 26 recorridos de interfaz de Organización y 33 de Colabora aprobados con componentes reales y servidor sintético, incluyendo teléfono y tablet, persistencia al recargar, permisos y descarte de cambios.
- La regresión final aprobó 427 pruebas, sin fallos ni omisiones, e incluye las pruebas reales de funciones y políticas PostgreSQL sobre PGlite, controles de API, sesión, tareas, formularios, expedientes y archivos sintéticos. No sustituye las pruebas con las políticas, usuarios y proveedores de producción.
- El control de Chrome pudo leer la consola con la sesión del usuario, pero dos intentos de interacción fallaron con `failed to activate captured window`. No se confirmó ninguna mutación real mediante ese navegador.

## Historial aplicado y salida

El conector SQL respondió y permitió inspeccionar el esquema, revisar el historial y aplicar las migraciones. No fue necesario usar la CLI que antes devolvía 403 ni elevar privilegios. Las marcas locales se alinearon con las versiones registradas por Supabase; no se editaron manualmente filas del historial.

Migraciones aplicadas y confirmadas en el historial:

1. `20261118161912_colabora_request_forms_and_delivery.sql`
2. `20261118161923_organization_scoped_resource_access.sql`
3. `20261118161926_organization_worker_permissions_and_task_details.sql`
4. `20261118161934_colabora_atomic_task_actions.sql`
5. `20261118161937_organization_permission_query_optimization.sql`
6. `20261118161939_organization_directory_upload_finalize.sql`
7. `20261118162322_organization_rpc_privilege_hardening.sql`
8. `20261119225746_organization_active_membership_boundaries.sql`
9. `20261119230102_optional_form_signature.sql`
10. `20261119230641_colabora_form_draft_receipt_boundary.sql`
11. `20261119231100_organization_polymorphic_trigger_boundaries.sql`

El preflight con aserciones pasó y el comando focalizado de cierre aprobó 102 pruebas. Se conservó fuera del directorio de migraciones una copia histórica del arreglo de expiración, cuyo contenido ya estaba aplicado como `20261117195719`; así no puede ejecutarse dos veces por una marca distinta. El cron escalonado se alineó con su versión real `20261014164210`.

Los asesores mantuvieron seis categorías: 69 tablas con RLS sin políticas (incluye la tabla de vínculos de formulario deliberadamente exclusiva de servidor), 31 funciones sin search_path fijo, tres extensiones en public, 41 funciones definer accesibles a anon, 104 a authenticated y protección de contraseñas filtradas desactivada. Son avisos del proyecto completo y no equivalen todos a fallos explotables. Los RPC organizacionales tienen cero accesos anónimos. Las reglas de servidor no se abrieron para eliminar avisos. Referencias: [RLS sin políticas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [search_path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [definer anónimo](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).

El repositorio de destino es `docuboxapp-art/docubox`. El proyecto Vercel verificado es `prj_2E9JRCVA7inQNrmIu0CMFrdS7qFS`, equipo `team_Jvt8154WQvK84uEw7xGyRVhP`. La rama de preparación es `codex/organization-colabora-release-20261118`. La disponibilidad de SQL ya no bloquea la publicación; las limitaciones de seguridad transversal y proveedores anteriores siguen abiertas y deben conservarse visibles en la revisión.

El estado privado del monitor, `.env*`, credenciales, capturas y bases temporales de pruebas no forman parte del commit.
