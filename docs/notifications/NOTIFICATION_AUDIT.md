# Auditoría de notificaciones Docubox

Fecha: 2026-09-03

## Resumen ejecutivo

Docubox tenía dos sistemas que no debían mezclarse: el feed operativo personal (`notifications`) y Docubox Notifica, diseñado para comunicaciones certificadas con evidencia, acuses y cadena de eventos. El primero se usaba desde flujos de documentos, organización, expiraciones y algunas pantallas; el segundo conserva su propio modelo legal. Esta implementación mantiene esa separación y fortalece el feed operativo.

El núcleo operativo ahora usa `emitDomainEvent()` para persistir una notificación, resolver preferencias, deduplicar por destinatario, registrar el evento de notificación y crear su ledger de entrega. Las notificaciones certificadas siguen en `certified_notifications` y no son sustituidas por la campana.

## Arquitectura encontrada

| Componente              | Estado antes                                                                         | Estado actual                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Feed in-app             | Tabla mínima con `user_id`, tipo y leído                                             | Evento, categoría, severidad, deep link, actor, estado, archivo y expiración             |
| Escrituras en navegador | Componentes podían insertar, modificar y borrar sus propias filas                    | El navegador solo lee sus filas; las mutaciones pasan por API autenticada                |
| Deduplicación           | Solo automatizaciones Colabora y algunos correos                                     | Clave de idempotencia por destinatario en el servicio central                            |
| Preferencias            | No normalizadas para el feed                                                         | `notification_preferences` por usuario y categoría                                       |
| Entrega                 | Correos directos desde varios flujos; un ledger específico para documento completado | Ledger general de canales, más el ledger verificado ya existente de documento completado |
| Auditoría               | Mezclada con auditorías del dominio                                                  | `notification_event_log` append-only, separada de la auditoría del documento             |
| Legal/certificada       | `certified_notifications` independiente                                              | Se conserva independiente y no se usa para alertas ordinarias                            |

## Procesos inspeccionados

| Área                 | Eventos hallados                                                         | Estado                                  |
| -------------------- | ------------------------------------------------------------------------ | --------------------------------------- |
| Autenticación        | OTP, TOTP, passkey, login, nuevo dispositivo, recuperación               | PARTIAL                                 |
| Organizaciones       | invitación, reenvío, revocación, aceptación, cambio de miembro           | IMPLEMENTED / PARTIAL                   |
| Documentos           | envío, participación, rechazo, cancelación, expiración, papelera y purga | IMPLEMENTED / PARTIAL                   |
| Firma/workflow       | turno disponible, firma, aprobación, rechazo, finalización               | IMPLEMENTED / PARTIAL                   |
| Certificación        | PAdES, TSA, NOM-151, constancias y verificación                          | PARTIAL                                 |
| Retención            | Legal Hold, papelera, restauración, purga                                | PARTIAL                                 |
| Seguridad            | nuevo dispositivo, sesiones, MFA, passkeys, cambios sensibles            | PARTIAL                                 |
| Organización técnica | webhooks, API keys, proveedor, billing y consumo                         | MISSING / PARTIAL                       |
| Docubox Notifica     | publicación, acceso, acuse, respuesta y constancias                      | IMPLEMENTED como sistema legal separado |

## Hallazgos y correcciones aplicadas

1. **SECURITY_RISK**: el feed permitía inserción, actualización y eliminación directas desde el cliente. Ahora solo permite lectura propia por RLS; el servidor hace las mutaciones auditables.
2. **SECURITY_RISK**: `/api/security/check-device` aceptaba un `userId` de cliente sin comprobar la sesión. Ahora exige un bearer token válido, liga el usuario de la solicitud a la sesión y resuelve correo/nombre en backend.
3. **DUPLICATED**: la campana y la página tenían mutaciones SQL duplicadas. Ambas usan ahora `PATCH /api/notifications`.
4. **PARTIAL**: algunas notificaciones de documentos carecían de enlace correcto. El servicio persiste `action_url` y `action_label`; las invitaciones y los turnos de workflow ya lo usan.
5. **DUPLICATED**: las automatizaciones Colabora insertaban directamente en la tabla. Pasaron a `emitDomainEvent()`.
6. **PARTIAL**: correos de invitación, participación, expiración y finalización se generan todavía en servicios de email heredados. El evento in-app ya está centralizado; la migración progresiva de esos envíos al dispatcher se conserva como trabajo explícito para evitar duplicar correos ya en producción.

## Eventos por estado

| Evento                             | Estado      | Observación                                                                     |
| ---------------------------------- | ----------- | ------------------------------------------------------------------------------- |
| `signature.requested`              | IMPLEMENTED | In-app, deep link y deduplicación por participante                              |
| `workflow.step_available`          | IMPLEMENTED | No avisa a pasos futuros de flujos secuenciales                                 |
| `document.participation_rejected`  | PARTIAL     | In-app y correo heredado; falta clave estable en todos los caminos              |
| `document.completed`               | PARTIAL     | Ledger de correo PAdES-B-T/NOM-151 verificado; falta proyección in-app uniforme |
| `document.expiring`                | PARTIAL     | In-app/email existen; requiere política de máximo de recordatorios              |
| `document.expired`                 | PARTIAL     | In-app/email existen; requiere deduplicación de job por ventana                 |
| `retention.legal_hold_applied`     | MISSING     | Debe integrarse con el endpoint de Legal Hold                                   |
| `retention.purge_completed`        | PARTIAL     | Auditoría/tombstone existente; falta feed por propietario                       |
| `certification.completed`          | PARTIAL     | Evidencia disponible; falta proyección humana para propietario                  |
| `certification.failed`             | PARTIAL     | Se conserva en diagnóstico/logs; falta política de destinatario                 |
| `security.new_device`              | IMPLEMENTED | In-app crítico, correo existente y deduplicación por fingerprint                |
| `security.password_changed`        | MISSING     | Debe salir del flujo de cambio de contraseña                                    |
| `security.mfa_changed`             | MISSING     | Debe salir de setup/disable TOTP y WebAuthn                                     |
| `organization.member_invited`      | IMPLEMENTED | In-app para usuario registrado y correo transaccional                           |
| `organization.member_joined`       | PARTIAL     | Existe notificación en aceptación; falta proyección para administradores        |
| `organization.member_role_changed` | PARTIAL     | Auditoría existe; falta feed para miembro afectado                              |
| `billing.payment_failed`           | MISSING     | Sin integración de billing operativo verificable                                |
| `usage.limit_reached`              | MISSING     | Debe integrarse cuando el medidor de consumo emita el umbral                    |
| `integration.webhook_failed`       | MISSING     | Debe ser alerta interna, no campana de todos los usuarios                       |
| `system.provider_degraded`         | MISSING     | Debe alimentar control plane, no el feed personal por defecto                   |

## Diseño de seguridad y multi-tenancy

- Las consultas de la campana usan RLS `auth.uid() = user_id`.
- `notifications` no concede `INSERT`, `UPDATE` ni `DELETE` a `authenticated`; solo backend con service role.
- La API de estado vuelve a validar la sesión y limita toda mutación a `user_id` de esa sesión.
- `workspace_id` se persiste cuando el contexto lo provee; para documentos, el servicio lo resuelve desde el documento para conservar el aislamiento tenant.
- La metadata se sanitiza y descarta claves de secretos, tokens, OTP, material criptográfico y API keys.
- `notification_event_log` es append-only. El historial no sustituye las evidencias de firma ni las constancias certificadas.

## Riesgos y trabajo de integración pendiente

Los eventos enumerados como `MISSING` no deben inventarse en UI. Requieren conectarse al resultado de dominio real: cambio de contraseña, configuraciones MFA/WebAuthn, Legal Hold, medidores billing/uso y health de proveedores. Los fallos del proveedor de correo no revierten la operación de negocio: el ledger de documento completado ya cumple esa regla y el ledger general deja preparada la misma separación.

## Archivos principales modificados

- `src/lib/notifications/service.ts`
- `src/lib/notifications/policy.ts`
- `src/lib/notificationsInApp.server.ts`
- `src/app/api/notifications/route.ts`
- `src/app/api/notifications/self/route.ts`
- `src/app/api/security/check-device/route.ts`
- `src/app/notifications/page.tsx`
- `src/components/TopNav.tsx`
- `supabase/migrations/20260903184030_notification_event_core.sql`
