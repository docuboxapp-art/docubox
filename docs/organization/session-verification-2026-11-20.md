# Comprobación de Organización y Colabora con sesión real

Se comprobó localhost con la sesión del propietario de la organización. No se cambió ningún plan, suscripción ni habilitación comercial; tampoco se ejecutaron firmas, capturas biométricas o envíos de correo.

## Correcciones encontradas durante el recorrido

- Los listados de equipos y miembros fallaban con `PGRST201`: `workspace_members` tiene relaciones a los perfiles tanto por `user_id` como por `invited_by`. Se selecciona ahora la relación del integrante explícitamente. La corrección comprende estructura, listado y ficha de miembros, relaciones de catálogos, resumen y catálogo de Colabora y destinatarios de alertas.
- Se aplicó la misma selección explícita a colaboradores de tareas y miembros de espacios, que también tienen relaciones separadas para el usuario y quien lo agregó. Las nueve consultas corregidas respondieron HTTP 200 contra el esquema real. Esas comprobaciones no imprimieron perfiles ni credenciales.
- Un fallo temporal de la comprobación de acceso a Colabora se presentaba como complemento no disponible. Ahora se muestra un aviso de servicio con Reintentar, manteniendo cerrado el acceso. Se limita la espera de la petición y se ignoran resultados anteriores al cambio de organización o al desmontaje del proveedor. No se omite autenticación ni se habilitan derechos ante un fallo.
- El acceso Crear tarea del resumen respeta ahora el permiso de creación y la habilitación de escritura. Se comprobó que no aparece con la cuenta real en solo lectura.

## Recorrido real comprobado

| Operación                  | Resultado                                                                                                                                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resumen de Organización    | Datos reales de miembros, equipos y actividad disponibles.                                                                                                                                                                         |
| Crear equipo y responsable | Se creó `QA · Equipos y persistencia · 20 nov`, asignando únicamente al propietario, que ya tenía acceso.                                                                                                                          |
| Editar y recargar equipo   | Nombre, descripción editada, responsable y membresía se conservaron después de recargar.                                                                                                                                           |
| Ficha del miembro          | Equipos y roles cargaron; el equipo de QA aparece asignado y la membresía de responsable está protegida contra retiro directo.                                                                                                     |
| Rol de propietario         | El editor mantiene bloqueada su modificación.                                                                                                                                                                                      |
| Guardar rol de QA          | No ejecutado: el usuario indicó dejar pendiente esta prueba cuando la aplicación pidió confirmar identidad. No se creó ni asignó el rol preparado.                                                                                 |
| Auditoría                  | La creación y edición del equipo aparecen en el historial. La búsqueda de equipo filtró seis eventos; el CSV descargado contiene esas seis filas y quince columnas consistentes.                                                   |
| Resumen de Colabora        | Cargó en solo lectura y mostró las dos tareas existentes.                                                                                                                                                                          |
| Prioridades de tareas      | Alta y Normal devolvieron cada una la tarea correspondiente; el filtro de asignación al usuario y el detalle de tarea se abrieron. La prioridad interna `media` se presenta como Normal en el selector y Media en la ficha actual. |
| Formularios                | Consulta y filtros de búsqueda y estado disponibles. La organización no tiene formularios, por lo que no se certificó una respuesta real ni su visor.                                                                              |
| Solicitudes                | Pantalla sin errores, lista vacía y sin creación habilitada por la restricción comercial actual.                                                                                                                                   |

El equipo de QA permanece identificado para revisión del usuario; no se archivaron ni eliminaron registros existentes. El CSV y las capturas se conservaron de forma privada y no se incorporan a Git.

## Validación técnica

- Preflight de Supabase aprobado: RPC, privilegios y 33 políticas restrictivas comprobados sin modificar datos.
- Suite `test:organization:completion`: 133 pruebas aprobadas, sin fallos ni omisiones. Incluye errores 503, reintento, respuestas tardías de otro espacio, limpieza al desmontar y relaciones de perfiles ambiguas.
- Las suites de catálogo y comunicaciones aprobaron junto a las regresiones de API: 67 pruebas, con cobertura parcialmente compartida con el comando anterior; los totales no deben sumarse.
- TypeScript aprobado. El lint de los componentes de acceso y resumen no presenta errores; permanecen advertencias previas de tipos `any` en la ficha de miembro.

Las pruebas del proveedor de acceso usan un controlador mínimo de estado para ejecutar su lógica asíncrona y renderizado de servidor real del aviso. No sustituyen una prueba del planificador de React ni la disponibilidad continua de Supabase.

## Límites que siguen abiertos

Durante la sesión volvió a observarse un 503 en la comprobación de acceso. El manejo y la recuperación de la interfaz están corregidos; no se declara solucionada definitivamente la disponibilidad de Auth.

Colabora conserva la prueba vencida y el modo de solo lectura. Un recorrido nuevo de creación, envío, recepción y aprobación con esta cuenta continúa pendiente de una habilitación de escritura autorizada. No se cambió esa condición para ejecutar las pruebas.

Siguen vigentes los pendientes de controles globales y proveedores de la [revisión de entrega](release-review-2026-11-18.md): MFA/SSO, redes y sesiones por organización, integración efectiva de custodia de firma y validación de proveedores externos. Esta comprobación no certifica todos los módulos ni todos los flujos de la organización.
