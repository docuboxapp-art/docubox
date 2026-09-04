# Core Superadmin Docubox

## A. Inventario de rutas

| Modulo                  | Ruta                             | Fuente principal                                 |
| ----------------------- | -------------------------------- | ------------------------------------------------ |
| Dashboard               | `/admin`                         | agregados de plataforma                          |
| Organizaciones          | `/admin/organizations`           | `workspaces`, membresias, suscripciones          |
| Organizacion            | `/admin/organizations/[id]`      | metadata tenant, consumo, billing, auditoria     |
| Usuarios                | `/admin/users`                   | `user_profiles`, Auth server-side, membresias    |
| Usuario                 | `/admin/users/[id]`              | perfil, sesiones, postura MFA/passkey, auditoria |
| Planes                  | `/admin/plans`                   | planes y versiones comerciales                   |
| Suscripciones           | `/admin/subscriptions`           | suscripciones y proveedor de pago                |
| Consumos                | `/admin/usage`                   | ledger de uso                                    |
| Finanzas                | `/admin/finance`                 | suscripciones y transacciones                    |
| Transacciones           | `/admin/finance/transactions`    | transacciones de pago                            |
| Facturacion             | `/admin/finance/invoices`        | facturas                                         |
| Conciliacion            | `/admin/finance/reconciliation`  | conciliaciones                                   |
| Reembolsos              | `/admin/finance/refunds`         | solicitudes y aprobaciones                       |
| Creditos                | `/admin/finance/credits`         | creditos y ajustes                               |
| Documentos              | `/admin/documents`               | metadata documental; sin contenido               |
| Almacenamiento          | `/admin/storage`                 | metadata Storage y cifrado                       |
| Workflows               | `/admin/workflows`               | ejecuciones de workflow                          |
| Jobs                    | `/admin/jobs`                    | `platform_system_jobs`                           |
| Cola de errores         | `/admin/dlq`                     | `platform_dead_letter_jobs`                      |
| Firmas                  | `/admin/signatures`              | evidencias y certificaciones                     |
| e.firma SAT             | `/admin/signatures/efirma`       | evidencia publica/sanitizada                     |
| Firma autografa         | `/admin/signatures/autograph`    | metadata de participacion                        |
| PAdES                   | `/admin/signatures/pades`        | `document_certifications`                        |
| TSA                     | `/admin/signatures/tsa`          | `timestamp_records`                              |
| NOM-151                 | `/admin/signatures/nom151`       | constancias persistidas                          |
| Integridad              | `/admin/integrity`               | hashes, versiones y objetos                      |
| Verificaciones          | `/admin/identity`                | sesiones de verificacion                         |
| OCR                     | `/admin/identity/ocr`            | checks sanitizados                               |
| Prueba de vida          | `/admin/identity/liveness`       | resultado; sin imagen biometrica                 |
| MFA                     | `/admin/identity/mfa`            | postura agregada                                 |
| Passkeys                | `/admin/identity/passkeys`       | metadata WebAuthn sin claves                     |
| Email                   | `/admin/notifications/email`     | entregas email                                   |
| SMS                     | `/admin/notifications/sms`       | entregas SMS                                     |
| WhatsApp                | `/admin/notifications/whatsapp`  | entregas WhatsApp                                |
| Plantillas              | `/admin/notifications/templates` | plantillas versionadas                           |
| Tickets                 | `/admin/support/tickets`         | `platform_support_tickets`                       |
| Diagnostico             | `/admin/support/diagnostics`     | correlacion de metadata                          |
| Acceso asistido         | `/admin/support/access`          | solicitudes y sesiones privilegiadas             |
| Incidencias             | `/admin/incidents`               | `platform_incidents`                             |
| Proveedores             | `/admin/providers`               | `platform_provider_registry`                     |
| API                     | `/admin/api`                     | clientes y uso API                               |
| Webhooks                | `/admin/webhooks`                | entregas y reintentos                            |
| Logs                    | `/admin/integration-logs`        | eventos sanitizados                              |
| Security Center         | `/admin/security`                | eventos, riesgos y alertas                       |
| Eventos                 | `/admin/security/events`         | security events append-only                      |
| Sesiones                | `/admin/security/sessions`       | sesiones revocables                              |
| Riesgo                  | `/admin/security/risk`           | senales y score                                  |
| KMS/HSM                 | `/admin/security/kms`            | metadata KMS no secreta                          |
| Cifrado                 | `/admin/security/encryption`     | cobertura de cifrado                             |
| Alertas                 | `/admin/alerts`                  | alertas unificadas                               |
| Estado del sistema      | `/admin/system`                  | health checks persistidos                        |
| Servicios               | `/admin/system/services`         | proveedores y dependencias                       |
| Jobs de infraestructura | `/admin/system/jobs`             | jobs backend                                     |
| DLQ de infraestructura  | `/admin/system/dlq`              | dead letters                                     |
| Backups                 | `/admin/system/backups`          | backup runs                                      |
| Migraciones             | `/admin/system/migrations`       | historial de migraciones                         |
| Auditoria               | `/admin/audit`                   | `platform_audit_events`                          |
| Equipo interno          | `/admin/staff`                   | `platform_staff`                                 |
| Roles y permisos        | `/admin/roles`                   | RBAC interno                                     |
| Aprobaciones            | `/admin/approvals`               | four-eyes approvals                              |
| Configuracion           | `/admin/settings`                | configuracion versionada no secreta              |

`/superadmin/*` se conserva como compatibilidad y redirige a la ruta canonica equivalente.

## B. Inventario de pantallas

Cada listado comparte: encabezado, filtros, busqueda, orden, paginacion, loading, empty state,
error state y correlation ID. Los detalles usan tabs y drawers unicamente cuando la fuente existe.

| Pantalla      | Tabs o secciones                                                                            | Detalle protegido           |
| ------------- | ------------------------------------------------------------------------------------------- | --------------------------- |
| Organizacion  | Resumen, Usuarios, Plan, Consumo, Seguridad, Integraciones, Facturacion, Auditoria, Soporte | contenido documental        |
| Usuario       | Perfil, Seguridad, Sesiones, Dispositivos, Actividad, Soporte                               | secretos MFA/passkey/tokens |
| Documento     | Metadata, Versiones, Seguridad, Firma, Evidencias, Auditoria                                | PDF y anexos                |
| Proveedor     | Configuracion, Estado, Consumo, Costos, Logs, Webhooks, Incidencias                         | credenciales completas      |
| Ticket        | Resumen, Conversacion, Organizacion, Usuario, Diagnostico, Eventos, Notas                   | payload sensible sin scope  |
| Plan          | General, Limites, Entitlements, Add-ons, Historial                                          | cambios retroactivos        |
| Configuracion | General, Seguridad, Documentos, Firma, Comunicaciones, Proveedores                          | secretos                    |

## C. Matriz pantalla/accion/control

| Modulo         | Pantalla      | Accion                | Permiso                   | Riesgo | Reauth         | Aprobacion        | Audit event                      |
| -------------- | ------------- | --------------------- | ------------------------- | ------ | -------------- | ----------------- | -------------------------------- |
| Organizaciones | listado       | leer metadata         | `organization.read`       | 0      | no             | no                | lectura sensible opcional        |
| Organizaciones | detalle       | suspender             | `organization.suspend`    | 2      | si             | por politica      | `ORGANIZATION_SUSPENDED`         |
| Organizaciones | detalle       | reactivar             | `organization.update`     | 2      | si             | no                | `ORGANIZATION_REACTIVATED`       |
| Usuarios       | detalle       | bloquear              | `user.block`              | 2      | si             | no                | `USER_BLOCKED`                   |
| Usuarios       | detalle       | revocar sesiones      | `user.sessions.revoke`    | 2      | si             | no                | `USER_SESSION_REVOKED`           |
| Planes         | detalle       | publicar version      | `plan.manage`             | 2      | si             | por politica      | `PLAN_VERSION_PUBLISHED`         |
| Suscripciones  | detalle       | cambiar plan          | `subscription.manage`     | 2      | si             | segun precio      | `PLAN_CHANGED`                   |
| Finanzas       | reembolso     | solicitar             | `billing.refund.request`  | 2      | si             | no                | `REFUND_REQUESTED`               |
| Finanzas       | aprobaciones  | aprobar               | `billing.refund.approve`  | 3      | si             | four-eyes         | `REFUND_APPROVED`                |
| Documentos     | diagnostico   | verificar integridad  | `document.integrity.read` | 0      | no             | no                | `DOCUMENT_INTEGRITY_CHECKED`     |
| Soporte        | acceso        | solicitar scope       | `support.access.request`  | 3      | si             | si                | `PRIVILEGED_ACCESS_REQUESTED`    |
| Soporte        | acceso        | aprobar               | `support.access.approve`  | 3      | si             | four-eyes         | `PRIVILEGED_ACCESS_APPROVED`     |
| Soporte        | sesion        | leer contenido        | `support.content.read`    | 3      | si             | si                | `PRIVILEGED_CONTENT_ACCESSED`    |
| Proveedores    | configuracion | reemplazar referencia | `provider.manage`         | 3      | si             | proveedor critico | `PROVIDER_CONFIGURATION_CHANGED` |
| API            | cliente       | revocar               | `api.revoke`              | 2      | si             | no                | `API_KEY_REVOKED`                |
| Webhooks       | entrega       | reintentar            | `webhook.retry`           | 2      | si             | no                | `WEBHOOK_RETRIED`                |
| Seguridad      | sesiones      | revocar               | `security.session.revoke` | 2      | si             | no                | `SECURITY_SESSION_REVOKED`       |
| KMS            | rotacion      | solicitar             | `kms.rotate`              | 3      | passkey + TOTP | si                | `KMS_ROTATION_REQUESTED`         |
| Jobs           | detalle       | reintentar            | `job.retry`               | 2      | si             | no                | `JOB_RETRY_REQUESTED`            |
| Staff          | detalle       | cambiar rol           | `staff.manage`            | 3      | passkey + TOTP | rol privilegiado  | `ROLE_CHANGED`                   |
| Roles          | detalle       | cambiar permiso       | `role.manage`             | 3      | passkey + TOTP | si                | `PERMISSION_CHANGED`             |

## D. Matriz de roles y permisos

Leyenda: `R` lectura, `M` administracion, `A` aprobacion, `-` denegado.

| Rol                 | Clientes | Billing | Operacion | Soporte | Seguridad | KMS | Staff/Roles | Auditoria    |
| ------------------- | -------- | ------- | --------- | ------- | --------- | --- | ----------- | ------------ |
| DOCUBOX_SUPER_ADMIN | M        | M/A     | M         | M/A     | M         | M/A | M/A         | R            |
| PLATFORM_ADMIN      | M        | M       | M         | M       | R         | R   | R           | R            |
| OPERATIONS_MANAGER  | R        | R       | M         | R       | R         | R   | -           | R            |
| SUPPORT_MANAGER     | R        | -       | R         | M/A     | R         | -   | -           | R            |
| SUPPORT_AGENT       | R        | -       | R         | M       | -         | -   | -           | R acotada    |
| TECH_SUPPORT        | R        | -       | R         | M       | R         | R   | -           | R            |
| FINANCE_MANAGER     | R        | M/A     | -         | R       | -         | -   | -           | R financiera |
| BILLING_AGENT       | R        | M       | -         | R       | -         | -   | -           | R financiera |
| SECURITY_ADMIN      | R        | -       | R         | A       | M         | M/A | R           | R            |
| SECURITY_AUDITOR    | R        | -       | R         | -       | R         | R   | -           | R            |
| COMPLIANCE_ADMIN    | R        | -       | R         | R       | R         | R   | -           | R            |
| DEVELOPER_ADMIN     | R        | -       | R         | R       | R         | -   | -           | R tecnica    |
| READ_ONLY_AUDITOR   | R        | R       | R         | R       | R         | R   | R           | R            |

Los grants concretos viven en `platform_role_permissions`; esta tabla no sustituye la fuente de
verdad ejecutable.

## E. State machines

```text
Organization: ACTIVE -> SUSPENDED -> ACTIVE
              TRIAL -> ACTIVE | CANCELLED
              PAST_DUE -> ACTIVE | SUSPENDED
              CANCELLED -> PENDING_DELETION

User: PENDING_VERIFICATION -> ACTIVE
      ACTIVE -> LOCKED | SUSPENDED | DISABLED
      LOCKED -> ACTIVE
      SUSPENDED -> ACTIVE | DISABLED

Ticket: OPEN -> IN_PROGRESS -> WAITING_CUSTOMER -> IN_PROGRESS
        IN_PROGRESS -> ESCALATED | RESOLVED
        RESOLVED -> CLOSED

Privileged access: REQUESTED -> APPROVED | REJECTED | CANCELLED
                   APPROVED -> ACTIVE | EXPIRED | REVOKED
                   ACTIVE -> EXPIRED | REVOKED

Approval: REQUESTED -> APPROVED | REJECTED | EXPIRED | CANCELLED
          APPROVED -> EXECUTED | EXPIRED | CANCELLED

Job: QUEUED -> RUNNING -> COMPLETED
     RUNNING -> RETRYING | FAILED
     RETRYING -> RUNNING | DEAD_LETTER
```

## F. Modelo de auditoria

Eventos append-only con actor, rol, tenant, accion, recurso, before/after sanitizado, motivo,
ticket, aprobacion, IP, user agent, request/correlation ID, resultado y timestamp. Las APIs escriben
el evento dentro de la misma operacion logica; un fallo de auditoria bloquea acciones nivel 2/3.

## G. Acceso privilegiado

```text
ticket + motivo + scopes + tenant + duracion
  -> solicitud
  -> aprobador diferente
  -> passkey/TOTP reciente
  -> sesion <= 4 horas
  -> banner persistente
  -> verificacion de scope por accion
  -> auditoria
  -> expiracion/revocacion
```

Un rol administrativo nunca concede `document.content.read` sin esta sesion.

## H. Modelo de alertas

Categorias: SECURITY, BILLING, PROVIDER, CERTIFICATE, SYSTEM, STORAGE, ENCRYPTION, INTEGRITY,
JOB y SUPPORT. Severidad: INFO, WARNING, HIGH, CRITICAL. Estado: OPEN, ACKNOWLEDGED,
INVESTIGATING, RESOLVED. Toda transicion exige actor, motivo y auditoria.

## I. Dependencias

- Supabase Auth y Postgres/RLS.
- Storage privado y metadata de cifrado.
- Proveedores de billing existentes.
- KMS/HSM, X.509, PAdES, TSA y NOM-151 existentes, solo lectura desde Control Plane.
- Fuentes de notificaciones, API/webhooks, jobs y observabilidad.
- TOTP y WebAuthn existentes para step-up.
- Variables server-side; nunca `service_role` ni secretos en cliente.

## J. Plan por fases

| Fase    | Salida verificable                                        |
| ------- | --------------------------------------------------------- |
| CORE-01 | identidad staff, TOTP/passkey policy, RBAC/ABAC, `/admin` |
| CORE-02 | organizaciones/usuarios y acciones seguras                |
| CORE-03 | auditoria transversal append-only                         |
| CORE-04 | planes, suscripciones y uso                               |
| CORE-05 | finanzas y four-eyes en reembolsos                        |
| CORE-06 | soporte, accesos e incidencias                            |
| CORE-07 | metadata documental, storage, workflows y jobs            |
| CORE-08 | PAdES, TSA, NOM-151 e integridad sin contenido            |
| CORE-09 | proveedores, API, webhooks y logs sanitizados             |
| CORE-10 | Security Center, sesiones, KMS y cifrado                  |
| CORE-11 | health, jobs, DLQ, backups y migraciones                  |
| CORE-12 | aprobaciones y sesiones privilegiadas completas           |
| CORE-13 | dashboard, busqueda global y alertas                      |

Cada fase exige typecheck, lint dirigido, pruebas positivas/negativas, build y verificacion de RLS.
