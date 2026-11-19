# Primera fase de alcances de Organización y Colabora

> Actualización: las migraciones se aplicaron y la regresión transaccional en Supabase pasó. El estado actual y los límites se detallan en [la revisión de activación](./release-review-2026-11-18.md).

Estado: implementación local y pruebas aisladas terminadas. Activación y validación en Supabase pendientes. Esta fase no cierra todos los pendientes de los dos módulos.

Actualización posterior: la [segunda fase](./completion-second-phase.md) conecta workers, bajas, mutaciones atómicas de tareas, acciones masivas y exportaciones. Sus resultados y pendientes sustituyen los puntos correspondientes de este inventario histórico.

## Comportamiento implementado

- El editor de roles permite Toda la organización, Solo equipo, Elementos propios, Elementos asignados, Unidades seleccionadas y Personalizado. Los dos últimos tienen selección de unidades activas; Personalizado permite combinar unidades, autor y asignación.
- Los roles se suman por permiso. Tener lectura para toda la organización no amplía una edición limitada a elementos propios. Un rol amplio sigue otorgando su alcance aunque otro sea limitado.
- Los permisos administrativos requieren alcance de organización. El formulario deshabilita su selección en roles limitados, la API la rechaza y la función de permisos deja de conceder privilegios administrativos desde configuraciones limitadas heredadas.
- Las nuevas políticas restrictivas se intersectan con las políticas existentes de pertenencia, producto y audiencia; no sustituyen las reglas de comentarios privados o formales.
- Se limita la lectura de tareas y detalles, versiones, revisiones, comentarios, espacios, hitos, actividad, solicitudes y entregas, salas, automatizaciones, negociaciones, comités y cierres. Las consultas de totales y paginación conservan RLS.
- Las API comprueban el permiso concreto y el recurso con el JWT del actor antes de las escrituras privilegiadas. La creación comprueba asignación, unidad, espacio padre y referencias de documentos o formularios. Las asignaciones de tareas a terceros requieren también `tasks.assign`.
- Los catálogos de fuentes se consultan con RLS y se filtran adicionalmente por los permisos de recursos del actor. Un destinatario de formulario no recibe por ello acceso a las respuestas de otros destinatarios.
- Las rutas antiguas de tareas comprueban los mismos alcances de la acción. El DML directo de tareas raíz se revoca para `authenticated`; los controles existentes de estados terminales, autoría y auditoría se conservan.
- Los miembros suspendidos o vencidos, roles archivados y unidades ajenas o inactivas no amplían acceso. La asociación por correo usa la identidad confirmada de Auth, no los datos editables del perfil.
- La falta del evaluador SQL produce un error de disponibilidad y no una concesión amplia. El guardado de roles limitados y las lecturas de Colabora de miembros sin rol propietario/administrador requieren la versión de políticas instalada. Los controles de escritura también fallan si faltan sus funciones.

## Evidencia local

| Comprobación                                                   | Resultado                                                                             |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Regresión combinada de Organización, Colabora y tareas         | 171 pruebas aprobadas                                                                 |
| Subconjunto de alcances                                        | 31 pruebas aprobadas: 21 de PostgreSQL aislado, 6 de API y 4 de esquema de validación |
| Navegador de Organización                                      | 23 comprobaciones con componentes reales y persistencia sintética                     |
| Navegador de Colabora                                          | 28 comprobaciones con componentes reales y persistencia sintética                     |
| Teléfono y tablet                                              | Editor de unidades y criterios personalizado utilizable, sin desbordamiento           |
| TypeScript de Organización, Colabora y rutas nativas de tareas | Sin errores                                                                           |
| ESLint del ámbito modificado                                   | Sin errores; 5 advertencias heredadas de tipos dinámicos del editor                   |

Las pruebas usan PostgreSQL aislado con PGlite y fronteras de autenticación/proveedores simuladas. No equivalen a la sesión real del usuario ni a una auditoría de producción. Las pruebas SQL incluyen un listado de 500 tareas sintéticas con conteos y paginación; su tiempo local no mide la capacidad del proyecto Supabase.

No se enviaron correos reales, ejecutaron firmas, modificaron planes, desplegaron cambios ni alteraron registros de producción en esta fase.

## Migraciones y activación pendientes

1. Recuperar acceso SQL al proyecto Supabase `kbjejiclhgjmiasauxyr`. El plano de control respondió `ACTIVE_HEALTHY`, pero SQL y asesores agotaron el tiempo de conexión. La CLI tampoco tenía privilegios de consulta; no se eludió esa restricción.
2. Inspeccionar el esquema real y las concesiones de roles base, y reconciliar el historial antes de aplicar cambios. No conceder permisos generales para compensar un rol limitado.
3. Revisar y aplicar primero `20261118161912_colabora_request_forms_and_delivery.sql`, pendiente de la entrega anterior, y después `20261118161923_organization_scoped_resource_access.sql`.
4. Verificar la versión de políticas con un JWT de miembro activo, las concesiones de funciones y tablas, las políticas existentes y los asesores de seguridad. Las migraciones deben preceder al despliegue del código que las requiere.
5. Probar con dos organizaciones reales, roles propios/asignados/equipo/unidades, miembro suspendido, caducidad y permisos distintos de lectura/escritura. Comprobar también los flujos personales de tareas.
6. Medir los planes y la latencia del listado y de sus totales en el proyecto actual antes de habilitarlo ampliamente. El evaluador de contexto realiza consultas por recurso; no se aumentó el plan de cómputo.

## Trabajo que continúa pendiente

- Extender y verificar los alcances en todas las operaciones nativas de documentos, formularios y expedientes fuera de Colabora. Las comprobaciones de fuentes de Colabora no sustituyen ese trabajo transversal.
- Revalidar los alcances del actor en workers de automatización y continuidad. Sus ejecuciones privilegiadas no quedan cubiertas por el guard de las API con JWT.
- Integrar comprobación y escritura en las mismas transacciones para cubrir cambios concurrentes de roles o asignaciones; el guard de API y algunas escrituras actuales son operaciones separadas.
- Revisar las políticas permisivas antiguas de edición de detalles de tareas: pueden imponer restricciones adicionales de creador o asignado aunque el alcance de equipo autorice una acción. Las nuevas políticas restrictivas no amplían esas concesiones.
- Aplicar y comprobar de extremo a extremo las políticas globales de redes de confianza, MFA, SSO y sesiones.
- Verificar los permisos de certificados contra KMS/HSM y los proveedores reales de directorio, correo, escaneo y facturación.
- Completar las vistas y acciones masivas avanzadas y las exportaciones PDF/XLSX de Colabora.

## Reproducción

Con las dependencias del repositorio instaladas, PGlite se mantiene fuera de las dependencias del producto:

```powershell
npm install --prefix .tmp/colabora-db-qa --no-save --ignore-scripts @electric-sql/pglite@0.5.16
npm run test:organization:scopes
npm run test:colabora
node scripts/qa/test-organization-interface.mjs
npm run test:colabora:interface
```

Los dos recorridos de interfaz usan `playwright-core` en `.tmp/organization-browser-qa` y Chromium headless de la caché de Playwright de Windows, como las comprobaciones previas de estos módulos. No llaman al Supabase real.
