# Docubox Control Plane

## Alcance

El Control Plane vive en `/superadmin` y esta separado del shell y de los roles de tenant.
Su principio rector es observabilidad administrativa sin acceso implicito al contenido del cliente.

## Arquitectura

```text
Supabase Auth
  -> platform_staff
  -> get_platform_staff_access (service_role only)
  -> TOTP obligatorio
  -> prueba administrativa HttpOnly de 30 minutos
  -> authorizePlatformAction (RBAC + ABAC)
  -> Server Components / APIs backend-only
  -> tablas operativas con RLS
  -> platform_audit_events / platform_security_events append-only
```

`auth.users.is_super_admin` permanece exclusivamente como bootstrap/recovery. Los roles de
workspace, metadata de Auth y roles de organizacion no conceden acceso al Control Plane.

## Navegacion

El sitemap esta definido en `src/lib/platform-admin/navigation.ts` y cubre:

- Inicio
- Clientes
- Producto
- Finanzas
- Consumos
- Operacion
- Firma y certificacion
- Identidad
- Notificaciones
- Soporte
- Integraciones
- Seguridad
- Infraestructura
- Cumplimiento
- Analitica
- Auditoria
- Administracion

Cada entrada declara un permiso. La barra lateral y la paleta `Ctrl/Cmd + K` filtran el catalogo
con el mismo conjunto de permisos resuelto en servidor. La ruta vuelve a comprobar el permiso y
responde con `404` cuando el actor no esta autorizado.

## Autorizacion

`authorizePlatformAction(actor, permission, resource, context)` aplica:

1. concesion RBAC;
2. step-up para acciones sensibles;
3. aprobacion para acciones de four-eyes;
4. sesion de soporte activa;
5. igualdad exacta del tenant;
6. denegacion explicita de contenido documental fuera del scope excepcional.

Permisos criticos incluyen administracion de personal/roles, rotacion KMS/certificados,
reembolsos, exportaciones, eliminacion, contenido de soporte y break-glass.

## Identidad administrativa

- TOTP es obligatorio para toda identidad `platform_staff` activa.
- El enrolamiento solo se completa al verificar un codigo real.
- TOTP no puede desactivarse mientras la cuenta pertenezca al personal interno.
- La prueba administrativa es HttpOnly, SameSite Strict, ligada a usuario y `last_sign_in_at`.
- La prueba expira en 30 minutos y solo se envia a `/superadmin`.
- Passkeys se observan sin exponer credential ID ni public key en las tablas del panel.

## Modelo de datos

Base de acceso:

- `platform_staff`
- `platform_roles`
- `platform_permissions`
- `platform_role_permissions`

Controles privilegiados:

- `platform_admin_approvals`
- `platform_support_access_requests`
- `platform_privileged_access_sessions`
- `platform_audit_events`
- `platform_security_events`

Operacion:

- `platform_support_tickets`
- `platform_incidents`
- `platform_system_jobs`
- `platform_dead_letter_jobs`
- `platform_provider_registry`
- `platform_feature_flags`

Criptografia e infraestructura:

- `platform_provider_credentials_metadata`
- `platform_kms_keys_metadata`
- `platform_certificate_registry`
- `platform_trust_bundles`
- `platform_backup_runs`
- `platform_restore_tests`

Cumplimiento:

- `platform_legal_holds`
- `platform_privacy_requests`

Todas estas tablas usan RLS, revocan acceso a `anon` y `authenticated`, y se operan desde backend.
Las tablas de eventos criticos son append-only.

## Datos protegidos

El panel de documentos muestra solamente identificadores, tenant, version, estado, tamano, hash,
cifrado y version KMS. No contiene enlaces a viewer, signed URLs ni descargas.

El acceso a contenido requiere simultaneamente:

- permiso excepcional;
- ticket y motivo;
- aprobacion por otra persona;
- step-up reciente;
- sesion temporal activa;
- tenant coincidente;
- auditoria.

## Pantallas conectadas

Las siguientes vistas consumen fuentes reales del producto o del Control Plane:

- dashboard global;
- organizaciones y usuarios;
- planes, suscripciones y consumo;
- documentos y cifrado;
- PAdES, TSA y NOM-151;
- verificaciones de identidad y postura passkey;
- tickets, acceso asistido e incidencias;
- proveedores;
- security events y auditoria;
- jobs y DLQ;
- KMS/HSM y rotaciones;
- certificados y trust bundles;
- backups y restore tests;
- legal hold y solicitudes ARCO;
- equipo interno, roles, permisos, aprobaciones y feature flags.

Los modulos que aun no tienen una fuente backend verificable muestran `Sin fuente operativa
conectada`. No publican datos simulados ni estados `Operational` inferidos.

## Estados y workflows

- Jobs: `queued`, `processing`, `completed`, `retry`, `failed`, `dead_letter`.
- DLQ: `open`, `retry_requested`, `resolved`, `discarded`, `escalated`.
- Aprobacion: `requested`, `approved`, `rejected`, `executed`, `expired`, `cancelled`.
- Soporte privilegiado: `pending`, `approved`, `active`, `expired`, `revoked`.
- Incidentes: `investigating`, `identified`, `monitoring`, `resolved`.
- Privacidad: `received`, `identity_validation`, `analysis`, `approval`, `execution`, `completed`, `rejected`.

## API y acciones

Las pantallas actuales son de consulta. Cualquier accion futura debe implementarse en una API
server-side que ejecute, en este orden:

1. validar sesion;
2. resolver `platform_staff`;
3. aplicar rate limit y proteccion CSRF/same-origin;
4. ejecutar `authorizePlatformAction`;
5. comprobar step-up/aprobacion/scope;
6. ejecutar la operacion idempotente;
7. registrar auditoria before/after sanitizada;
8. devolver solo el resultado minimo.

## Verificacion

- Suite completa: `176/176 PASS`.
- Tests dirigidos Control Plane/TOTP: `21/21 PASS`.
- TypeScript: `PASS`.
- Build Next.js: `PASS`.
- ESLint dirigido a archivos modificados: `PASS`.
- ESLint global: ejecucion cancelada por tiempo excesivo sin diagnosticos emitidos; no se declara PASS.

## Limites honestos

La navegacion completa no convierte por si sola en operativas las capacidades que no tienen fuente,
proveedor, workflow o politica desplegada. Billing avanzado, malware, DLP, SSO/SAML/SCIM, DR real,
fraude, canales y exportaciones requieren integrar sus sistemas de registro reales antes de habilitar
acciones. El panel falla cerrado mientras esa evidencia no exista.
