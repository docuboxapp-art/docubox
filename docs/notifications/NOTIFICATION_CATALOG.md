# Catálogo operativo de notificaciones

## `signature.requested`

```yaml
category: SIGNATURE
severity: warning
recipient_policy: participante_habilitado
channels: [in_app, email]
title: Tienes un documento pendiente de firma
cta: Revisar y firmar
deduplication: signature.requested:{documentId}:{participantId}
conditions: El turno del participante es visible y no está en estado terminal.
```

## `workflow.step_available`

```yaml
category: WORKFLOW
severity: warning
recipient_policy: participante_del_paso_actual
channels: [in_app, email]
title: Es tu turno de participar en un documento
cta: Revisar y participar
deduplication: workflow.step_available:{documentId}:{participantId}
conditions: No avisa a participantes de pasos secuenciales futuros.
```

## `document.completed`

```yaml
category: DOCUMENT
severity: success
recipient_policy: propietario_y_participantes
channels: [in_app, email]
title: Documento completado
cta: Ver documento
deduplication: document.completed:{documentId}:{recipientId}
conditions: El correo certificado solo sale con PAdES-B-T y NOM-151 verificados cuando la política lo exige.
```

## `document.expiring`

```yaml
category: REMINDER
severity: warning
recipient_policy: propietario_y_participantes_pendientes
channels: [in_app, email]
title: Solicitud próxima a vencer
cta: Revisar documento
deduplication: document.expiring:{documentId}:{reminderWindow}:{recipientId}
conditions: Máximo tres recordatorios; se cancelan al finalizar, rechazar o cancelar.
```

## `retention.legal_hold_applied`

```yaml
category: RETENTION
severity: warning
recipient_policy: propietario_y_administradores_autorizados
channels: [in_app, email]
title: Documento bajo retención legal
cta: Ver retención
deduplication: retention.legal_hold_applied:{documentId}:{holdId}:{recipientId}
conditions: No promete fecha de purga ni revela evidencia sensible.
```

## `security.new_device`

```yaml
category: SECURITY
severity: critical
recipient_policy: titular_de_la_cuenta
channels: [in_app, email]
title: Nuevo acceso desde un dispositivo
cta: Revisar seguridad
deduplication: security.new_device:{userId}:{deviceFingerprint}
conditions: No se puede silenciar; no expone tokens ni datos de sesión.
```

## `organization.member_invited`

```yaml
category: ORGANIZATION
severity: info
recipient_policy: invitado_registrado
channels: [in_app, email]
title: Invitación a una organización
cta: Ver invitación
deduplication: organization.member_invited:{invitationId}:{recipientId}
conditions: El correo contiene un enlace de invitación de duración limitada, no una sesión.
```

## `billing.payment_failed`

```yaml
category: BILLING
severity: warning
recipient_policy: billing_admin
channels: [in_app, email]
title: No fue posible procesar un pago
cta: Revisar facturación
deduplication: billing.payment_failed:{transactionId}:{recipientId}
conditions: Nunca incluye datos completos de tarjeta, cuenta o proveedor.
```

## Política transversal

- El actor no recibe una notificación de su propia acción salvo confirmaciones útiles.
- Metadatos: sin contraseñas, OTP, llaves privadas, certificados privados, tokens, API keys, DEK/KEK ni URLs firmadas persistentes.
- `SECURITY` crítica se entrega aunque una preferencia normal esté desactivada.
- El feed operativo no es evidencia jurídica; para avisos certificados se usa Docubox Notifica y su cadena de evidencia propia.
- Los canales SMS, WhatsApp, push y webhook están modelados, pero no se activan sin proveedor, política y consentimiento correspondientes.
