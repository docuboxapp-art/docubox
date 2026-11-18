# Administración de organización: implementación y validación

Fecha de revisión: 17 de noviembre de 2026. Ámbito: `/organizacion`, sus rutas API y las conexiones administrativas existentes. No se realizó despliegue, commit, push, cambio de plan ni firma real.

## Cambios entregados

- Navegación por grupos y búsqueda; se conservan las 17 secciones, sus accesos y las variantes de teléfono, tablet y modo oscuro.
- Encabezados, acciones, tarjetas, campos, modales y tablas con estilos compartidos del proyecto. Las tablas móviles conservan columnas legibles mediante desplazamiento horizontal.
- Equipos, responsables, suplentes, membresías y roles guardados mediante operaciones atómicas; permisos activos y pertenencia al espacio comprobados en servidor.
- Editor reutilizable para directorio, facultades, políticas en borrador, recursos, centros de costo, comunicaciones, dominios, redes, alertas, certificados e integraciones. Los registros publicados conservan su flujo de nuevas versiones.
- Validación estricta de campos y relaciones de la misma organización; confirmación de identidad para operaciones sensibles; auditoría en la misma transacción del catálogo. Las ediciones con una versión anterior reciben un conflicto y no sobrescriben cambios recientes.
- Revocación de permisos individuales o de equipo para certificados, con auditoría y confirmación. El inventario conserva sus estados reales; editar metadatos no convierte un certificado en válido.
- Historial documental del directorio paginado, con RLS y permisos de directorio y documentos. Los resultados pertenecen al espacio y a la persona solicitados.
- Historial real de suscripción vinculado por `subscription_id`; no se presentan registros simulados como facturas o pagos.
- Marca y plantilla activa `organization.invitation` aplicadas a invitaciones de miembros, con variables escapadas, enlace de acción y remitente de un dominio verificado.
- Preparación y comprobación DNS: un dominio solo se verifica cuando coinciden la prueba de propiedad de la organización y la validación del proveedor de correo.
- Reglas de alertas conectadas al sistema de notificaciones para acceso inusual, múltiples intentos TOTP fallidos, cambios de roles, cambios de certificados y exportaciones de auditoría de al menos 100 registros. Las reglas deshabilitadas no generan entregas. Se conserva la política obligatoria de notificaciones de seguridad existente.
- Configuración de la clave de custodia de secretos de webhooks en local y en Vercel (Production, Preview y Development), sin reemplazar una variable existente. Se confirmó que no había webhooks cifrados antes de crearla. Los archivos temporales con el secreto fueron eliminados. Vercel la incorporará a despliegues posteriores.
- Errores de validación, duplicados y relaciones inválidas devuelven estados accionables sin exponer detalles privados del proveedor.

## Evidencia

| Comprobación | Resultado y alcance |
|---|---|
| Pruebas de API, autenticación, catálogos, comunicaciones, entrega de webhooks, navegación, gobernanza y continuidad | 62 aprobadas; proveedores y destinatarios simulados |
| Interfaz de componentes reales | 20 comprobaciones aprobadas; navegador aislado con datos sintéticos |
| Las 17 secciones y sus pestañas | Cargan sin errores JavaScript; teléfono y tablet sin desbordamiento de la página |
| Guardar y recargar | Equipos, roles, asignaciones, directorio, centros, comunicaciones y permisos de certificados conservan cambios en el servidor de pruebas de interfaz |
| Cancelar, Escape, X y clic fuera del editor | Descartan cambios sin guardar; recargar conserva el valor anterior |
| SQL real de catálogos | Crear, editar, revocar, auditar y rechazar vínculos o actores inválidos; todo dentro de una transacción revertida |
| SQL real del historial documental | Documento sintético visible para el propietario autorizado; espacio ajeno, persona ajena y no miembro sin resultados; transacción revertida |
| TypeScript del módulo y rutas de acceso modificadas | Sin errores |
| ESLint del ámbito modificado | Sin errores; 69 advertencias existentes, principalmente tipos dinámicos y código legado sin uso |
| Asesores de seguridad Supabase | 6 avisos antes y después; ningún aviso nuevo |
| HTTP local sin sesión | `/organizacion` redirige a `/login`; el catálogo devuelve JSON 401 |

La revisión de interfaz aislada no equivale a una sesión real del usuario contra el servidor de producción. No se enviaron invitaciones ni alertas a buzones reales durante esta validación. Tampoco se ejecutaron firmas, revocaciones de sesiones, transferencias de propiedad o webhooks contra destinos externos.

Comandos reproducibles:

```powershell
node --test tests/organization-api-flows.test.mjs tests/organization-auth-boundaries.test.mjs tests/organization-catalog-api.test.mjs tests/organization-communications.test.mjs tests/organization-webhook-delivery.test.mjs src/lib/organization/navigation.test.ts src/lib/organization/governance.test.ts src/lib/organization/continuity.test.ts src/lib/organization/webhook-security.test.ts
node scripts/qa/test-organization-interface.mjs
```

Pruebas SQL: `scripts/qa/verify-organization-catalogs.sql` y `scripts/qa/verify-organization-directory-history.sql`. Ambas terminan en `ROLLBACK`.

## Límites pendientes para considerar todo el entorno cerrado

- La verificación con sesión real de organización y los proveedores externos sigue pendiente. SSO requiere un proveedor operativo; certificados requieren custodia y evidencias reales; facturación fiscal requiere su proveedor. No se alteraron estos estados para aparentar activación.
- Las redes de confianza se administran y validan como configuración, pero esta entrega no implementa una restricción global de red sobre todas las rutas y consultas directas de la aplicación.
- La asignación de roles y permisos está conectada. La primera fase de alcances de Colabora y tareas ya tiene implementación y pruebas aisladas; su migración y validación real siguen pendientes. La cobertura transversal de toda la aplicación continúa abierta. Véase [la evidencia y los límites de esta fase](./resource-scopes-first-phase.md).
- Los permisos del inventario de certificados se guardan y revocan. La aplicación de esos permisos a cada proveedor KMS/HSM y a una firma real no se validó ni se presenta como completada.
- Las opciones de seguridad organizacional conservan su configuración; no se certifica aquí la aplicación transversal de cada política de MFA, SSO o duración de sesiones fuera de las comprobaciones existentes.

Por estos límites, no se declara el proyecto completo al 100 % ni una prueba integral real de los proveedores.
