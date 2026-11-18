# Organización: equipos, miembros, roles y permisos

Validación: 17 de noviembre de 2026.

## Cambios

- Equipos y sus membresías se guardan juntos, en una transacción con RLS y auditoría. Los selectores vacíos se normalizan; responsable y suplente quedan incluidos como miembros.
- Roles y permisos se guardan juntos. La selección de UUID del catálogo se convierte correctamente a las claves que recibe la función de permisos existente.
- El listado de miembros usa una API autorizada y limitada al espacio empresarial. Las invitaciones no exponen tokens ni secretos.
- Asignar equipos y roles desde el detalle del miembro conserva la relación con la estructura. Los responsables no se pueden retirar de sus equipos sin reasignar primero esa responsabilidad.
- Los roles archivados no conceden permisos ni se pueden asignar nuevamente. Se mantiene la protección del propietario.
- Las fallas temporales de Auth o de comprobación de permisos conservan el estado 503. Las modificaciones sensibles mantienen la confirmación de identidad y comprueban los permisos correspondientes.
- La consola conserva sus secciones y controles; incorpora estilos compartidos para tarjetas, navegación, formularios, foco, móvil y modo oscuro. Cambiar de organización desmonta el contenido anterior antes de mostrar datos del nuevo espacio.

## Ejemplos persistidos

En el espacio empresarial existente se crearon:

- Área **Operaciones · Ejemplo**, con los equipos **Legal · Ejemplo**, **Administración · Ejemplo** y **Compras · Ejemplo**.
- Centro de costo **Operación · Ejemplo** (`EJ-OP`).
- Roles **Gestión de equipos · Ejemplo** y **Consulta organizacional · Ejemplo**, con permisos de organización definidos y sin asignaciones a usuarios.

El propietario existente es responsable y miembro de los cuatro ejemplos de estructura. No se crearon cuentas ficticias ni se enviaron invitaciones. El generador es optativo e idempotente y no sobrescribe ejemplos ya editados.

## Evidencia y límites

- **37 pruebas automatizadas aprobadas**: API, autenticación, confirmación de identidad, navegación, gobierno organizacional, continuidad y seguridad de webhooks.
- **Prueba SQL real aprobada**, con `SET LOCAL ROLE authenticated`, aislamiento por organización y `ROLLBACK`: creación, asignación de equipos y roles, permisos efectivos, prohibición de escritura para lectores, roles archivados, rechazo de ciclos y referencias ajenas y protección del propietario. No se modifican sesiones ni se conservan miembros temporales.
- **7 comprobaciones de navegador aprobadas** sobre los componentes reales con API y contextos sintéticos: creación y recarga de equipos; creación y persistencia de permisos del rol; asignación de equipos y roles al miembro; consulta sin edición; enlaces del listado; ausencia de desbordamiento horizontal a 390, 820 y 1440 px. Sin errores JavaScript. Las capturas se inspeccionaron.
- TypeScript del módulo de organización: aprobado. ESLint: sin errores; quedan advertencias de tipos dinámicos y código heredado.
- Las cuatro migraciones de organización están aplicadas y sus versiones locales coinciden con Supabase. Los conteos de avisos de seguridad de Supabase no aumentaron.
- La prueba de navegador es **aislada**, no una sesión real del usuario: no certifica entrega de correos ni autenticación interactiva con proveedores externos. Las reglas de datos y permisos sí se comprobaron en la base real.
- Dos comprobaciones textuales de la batería previa ya fallaban antes del cambio: anchura de la barra lateral del perfil personal y una expectativa del testigo electrónico. No se cuentan entre las 37 pruebas aprobadas del alcance actual.

## Repetir las pruebas

```powershell
node --test tests/organization-api-flows.test.mjs tests/organization-auth-boundaries.test.mjs src/lib/organization/navigation.test.ts src/lib/organization/governance.test.ts src/lib/organization/continuity.test.ts src/lib/organization/webhook-security.test.ts
npm install --prefix .tmp/organization-browser-qa --no-save --no-package-lock --ignore-scripts playwright-core
node scripts/qa/test-organization-interface.mjs
```

La prueba de interfaz requiere un Chromium headless compatible. Genera resultados y capturas en `.tmp/organization-interface/`.

La regresión de datos está en `scripts/qa/verify-organization-teams-roles.sql` y revierte todos sus cambios. El generador de ejemplos está en `scripts/qa/seed-organization-examples.sql`; requiere configurar expresamente `docubox.example_workspace` con el UUID del espacio empresarial objetivo.
