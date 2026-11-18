# Revisión de Organización y preparación de publicación

Esta revisión no certifica que toda Organización esté operativa en producción. Se separa el código comprobado de las migraciones, políticas globales y proveedores que requieren verificación real.

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

| Sección                | Código y conexiones revisados                                        | Límite de verificación                                                      |
| ---------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Resumen                | Navegación, indicadores, permisos y manejo de fuentes no disponibles | Datos reales bloqueados por conexión SQL                                    |
| Perfil                 | Edición y persistencia de datos organizacionales                     | Requiere recorrido autenticado real                                         |
| Miembros               | Invitación, detalle, equipos y roles                                 | Correo y aceptación real pendientes                                         |
| Equipos y áreas        | Miembros, responsable, suplente y guardado atómico                   | Validación remota de las migraciones pendientes                             |
| Roles y permisos       | Permisos por acción, ámbitos y editor de unidades                    | Alcance transversal fuera de Colabora pendiente                             |
| Directorio             | Ficha, evidencia privada, versionado e historial                     | Storage real y base remota pendientes                                       |
| Facultades             | Formularios, relaciones, vigencias y editor                          | Ejecución efectiva en todas las operaciones legales pendiente               |
| Flujos de aprobación   | Edición, versiones y worker con revalidación                         | Migraciones y ejecución real pendientes                                     |
| Políticas de firma     | Configuración versionada y relaciones                                | Cobertura transversal y proveedores pendientes                              |
| Plantillas y recursos  | Catálogo y vínculos canónicos                                        | Prueba autenticada del catálogo real pendiente                              |
| Continuidad            | Solicitud, sucesión, ejecución y cron conectados                     | No se ejecutó una baja o transferencia real                                 |
| Seguridad              | Ajustes, sesiones, redes, SSO y alertas revisados                    | MFA, SSO, redes y sesiones por organización aún requieren aplicación global |
| Certificados           | Inventario y permisos editables/revocables                           | Vinculación de esos permisos a KMS/HSM y validación real pendientes         |
| Integraciones          | Configuración, controles y estados reales                            | SSO, directorio y otros proveedores reales pendientes                       |
| Marca y comunicaciones | Plantillas, remitentes, dominios y comprobación DNS                  | Entrega real de esta versión pendiente                                      |
| Plan y consumo         | Suscripción, historial y centros de costo                            | No se simula facturación fiscal ni se cambió de plan                        |
| Auditoría              | Consulta, exportación, registros de mutación y permisos              | Verificación remota de integridad y permisos pendiente                      |

Las pruebas de interfaz recorren las secciones y pestañas con componentes reales y un servidor sintético. Eso no equivale a aprobar cada operación real o proveedor.

## Validación de la entrega

- Compilación de producción con Next.js 16.3.4 y TypeScript aprobada; entrada Proxy comprobada sin las advertencias anteriores del runtime Edge.
- 24 recorridos de interfaz de Organización y 33 de Colabora aprobados con componentes reales y servidor sintético, incluyendo teléfono y tablet, persistencia al recargar, permisos y descarte de cambios.
- La regresión final aprobó 394 pruebas, sin fallos ni omisiones, e incluye las pruebas reales de funciones y políticas PostgreSQL sobre PGlite, controles de API, sesión, tareas, formularios, expedientes y archivos sintéticos. No sustituye las pruebas con las políticas, usuarios y proveedores de producción.
- El control de Chrome pudo leer la consola con la sesión del usuario, pero dos intentos de interacción fallaron con `failed to activate captured window`. No se confirmó ninguna mutación real mediante ese navegador.

## Supabase y orden de salida

El plano de control devuelve `ACTIVE_HEALTHY`, pero la consulta SQL mínima y la lectura del historial de migraciones agotaron la conexión. La CLI de Supabase devuelve 403 por privilegios insuficientes. La consulta agregada de logs no devolvió muestras y no demuestra recuperación. Se solicitó al usuario comprobar `select 1;` desde el editor SQL con la cuenta propietaria.

Antes de publicar en producción se debe inspeccionar y reconciliar el esquema y el historial real. No hay autorización técnica suficiente para afirmar que las migraciones se aplicaron ni se intentó cambiar propietarios o evadir permisos.

Migraciones de las fases actuales aún pendientes:

1. `20261118005751_colabora_request_forms_and_delivery.sql`
2. `20261118041214_organization_scoped_resource_access.sql`
3. `20261118054913_organization_worker_permissions_and_task_details.sql`
4. `20261118055514_colabora_atomic_task_actions.sql`
5. `20261118063411_organization_permission_query_optimization.sql`
6. `20261118063916_organization_directory_upload_finalize.sql`

Las migraciones anteriores de Organización documentadas como aplicadas deben contrastarse con el historial remoto; no se deben repetir a ciegas. Después de aplicar las pendientes deben ejecutarse preflight, asesores, pruebas con dos organizaciones, revocaciones y pruebas autenticadas antes de promover a producción.

El repositorio de destino es `docuboxapp-art/docubox`. El proyecto Vercel verificado es `prj_2E9JRCVA7inQNrmIu0CMFrdS7qFS`, equipo `team_Jvt8154WQvK84uEw7xGyRVhP`. La rama de preparación es `codex/organization-colabora-release-20261118`. Mientras la base siga sin verificar, la publicación debe permanecer en Preview.

El estado privado del monitor, `.env*`, credenciales, capturas y bases temporales de pruebas no forman parte del commit.
