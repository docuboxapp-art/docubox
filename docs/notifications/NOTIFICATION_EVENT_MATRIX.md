# Matriz de eventos y notificaciones

| Evento                                   | Módulo          | Destinatario                |   In-app |          Email | Prioridad | CTA                  |   Recordatorio | Auditable | Estado       |
| ---------------------------------------- | --------------- | --------------------------- | -------: | -------------: | --------- | -------------------- | -------------: | --------: | ------------ |
| `account.email_verified`                 | Cuenta          | Titular                     |       Sí |             No | P3        | Perfil               |             No |        Sí | PARTIAL      |
| `account.password_changed`               | Cuenta          | Titular                     |       Sí |             Sí | P0        | Seguridad            |             No |        Sí | MISSING      |
| `security.new_device`                    | Seguridad       | Titular                     |       Sí |             Sí | P0        | Revisar seguridad    |             No |        Sí | IMPLEMENTED  |
| `security.suspicious_login`              | Seguridad       | Titular                     |       Sí |             Sí | P0        | Revisar seguridad    |             No |        Sí | MISSING      |
| `security.mfa_changed`                   | Seguridad       | Titular                     |       Sí |             Sí | P0        | Seguridad            |             No |        Sí | MISSING      |
| `security.passkey_changed`               | Seguridad       | Titular                     |       Sí |             Sí | P0        | Seguridad            |             No |        Sí | MISSING      |
| `organization.member_invited`            | Organización    | Invitado registrado         |       Sí |             Sí | P1        | Ver invitación       |         7 días |        Sí | IMPLEMENTED  |
| `organization.member_invitation_revoked` | Organización    | Invitado                    |       Sí |             No | P2        | Organización         |             No |        Sí | IMPLEMENTED  |
| `organization.member_joined`             | Organización    | Administradores             |       Sí |             No | P2        | Miembros             |             No |        Sí | PARTIAL      |
| `organization.member_role_changed`       | Organización    | Miembro afectado            |       Sí |             Sí | P1        | Organización         |             No |        Sí | PARTIAL      |
| `document.created`                       | Documentos      | Creador                     |       No |             No | P4        | —                    |             No |        Sí | NOT_REQUIRED |
| `document.processing_failed`             | Documentos      | Creador                     |       Sí |       Opcional | P1        | Ver documento        |             No |        Sí | MISSING      |
| `document.sent`                          | Documentos      | Creador                     |       Sí |             No | P2        | Ver documento        |             No |        Sí | IMPLEMENTED  |
| `document.viewed`                        | Documentos      | Creador                     | Opcional |             No | P3        | Ver actividad        |             No |        Sí | PARTIAL      |
| `document.completed`                     | Documentos      | Propietario y participantes |       Sí |             Sí | P2        | Ver documento        |             No |        Sí | PARTIAL      |
| `document.cancelled`                     | Documentos      | Propietario/participantes   |       Sí |             Sí | P1        | Ver documento        |             No |        Sí | PARTIAL      |
| `document.expiring`                      | Documentos      | Pendientes/propietario      |       Sí |             Sí | P1        | Revisar documento    |         Máx. 3 |        Sí | PARTIAL      |
| `document.expired`                       | Documentos      | Propietario/participantes   |       Sí |             Sí | P2        | Ver documento        |             No |        Sí | PARTIAL      |
| `document.trashed`                       | Retención       | Propietario                 |       Sí |             No | P3        | Papelera             | Antes de purga |        Sí | PARTIAL      |
| `document.restored`                      | Retención       | Propietario                 |       Sí |             No | P2        | Ver documento        |             No |        Sí | PARTIAL      |
| `retention.purge_upcoming`               | Retención       | Propietario                 |       Sí |       Opcional | P1        | Papelera             |       7/1 días |        Sí | MISSING      |
| `retention.purged`                       | Retención       | Propietario                 |       Sí |             No | P2        | Historial            |             No |        Sí | PARTIAL      |
| `retention.legal_hold_applied`           | Retención       | Propietario/admin           |       Sí |             Sí | P1        | Ver retención        |             No |        Sí | MISSING      |
| `signature.requested`                    | Firma           | Participante habilitado     |       Sí |             Sí | P1        | Revisar y firmar     |       Política |        Sí | IMPLEMENTED  |
| `signature.completed`                    | Firma           | Propietario                 |       Sí |             Sí | P2        | Ver documento        |             No |        Sí | PARTIAL      |
| `signature.rejected`                     | Firma           | Propietario/participantes   |       Sí |             Sí | P1        | Ver documento        |             No |        Sí | PARTIAL      |
| `workflow.started`                       | Workflow        | Creador                     | Opcional |             No | P3        | Ver documento        |             No |        Sí | PARTIAL      |
| `workflow.step_available`                | Workflow        | Participante actual         |       Sí |             Sí | P1        | Revisar y participar |       Política |        Sí | IMPLEMENTED  |
| `workflow.completed`                     | Workflow        | Creador                     |       Sí |       Opcional | P2        | Ver documento        |             No |        Sí | PARTIAL      |
| `workflow.failed`                        | Workflow        | Creador/operación           |       Sí |       Opcional | P1        | Diagnóstico          |             No |        Sí | MISSING      |
| `certification.completed`                | Certificación   | Propietario                 |       Sí |             Sí | P2        | Ver evidencia        |             No |        Sí | PARTIAL      |
| `certification.failed`                   | Certificación   | Propietario/operación       |       Sí |       Opcional | P1        | Ver evidencia        |             No |        Sí | PARTIAL      |
| `nom151.issued`                          | Certificación   | Propietario                 |       Sí |             Sí | P2        | Ver constancia       |             No |        Sí | MISSING      |
| `nom151.failed`                          | Certificación   | Operación/propietario       |       Sí |       Opcional | P1        | Ver evidencia        |             No |        Sí | PARTIAL      |
| `billing.payment_failed`                 | Billing         | Billing admin               |       Sí |             Sí | P1        | Facturación          |       Política |        Sí | MISSING      |
| `billing.invoice_issued`                 | Billing         | Billing admin               |       Sí |             Sí | P2        | Ver factura          |             No |        Sí | MISSING      |
| `usage.threshold_reached`                | Consumo         | Owner/admin                 |       Sí |             Sí | P1        | Ver consumo          |      80/90/100 |        Sí | MISSING      |
| `integration.webhook_failed`             | Integraciones   | Operación                   |       No | Alerta interna | P1        | Logs                 |      Reintento |        Sí | MISSING      |
| `system.provider_degraded`               | Infraestructura | Operación                   |       No | Alerta interna | P0        | Incidente            |       Política |        Sí | MISSING      |
| `certified_notification.created`         | Notifica        | Emisor                      |       Sí |             No | P2        | Ver notificación     |             No |        Sí | IMPLEMENTED  |

P0: crítica, P1: acción requerida, P2: transaccional, P3: informativa, P4: no notificar.
