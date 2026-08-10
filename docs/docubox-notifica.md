# Docubox Notifica

## Alcance implementado

Docubox Notifica modela comunicaciones certificadas alrededor de un documento canonico. Los mensajes por correo, SMS o WhatsApp son avisos; no son copias independientes del documento.

Flujo base:

1. Seleccionar un documento existente.
2. Capturar un snapshot con identificador, version, metadatos y SHA-256.
3. Clasificar la comunicacion y registrar al destinatario.
4. Configurar canales, autenticacion y actuacion esperada.
5. Crear un borrador multi-tenant.
6. Poner el documento a disposicion con un token CSPRNG. Solo se persiste SHA-256(token).
7. Registrar acceso y actuaciones en una cadena append-only.

## Componentes reutilizados

- `documentos`: objeto documental principal y fuente del SHA-256.
- `workspaces` y `workspace_members`: aislamiento multi-tenant.
- Supabase Auth: validacion de JWT para operaciones internas.
- Supabase RLS: autorizacion por membresia del espacio.
- App Market, `AppModulesContext`, `TopNav` y `Sidebar`: activacion y navegacion del modulo.
- Visor, motor de identidad, OTP, certificacion, NOM-151, TSA y QR: se mantienen como servicios centrales; Notifica debe integrarlos mediante adapters, no duplicarlos.

## Componentes nuevos

- Dominio de estados operativos y niveles de evidencia E0-E6.
- Wizard de nueva notificacion.
- Dashboard, detalle, centro de constancias y auditoria.
- Acceso publico por token seguro para comunicaciones sin OTP.
- Tablas `certified_notifications` y `notification_*`.
- Bitacora hash append-only por notificacion.

## Controles de seguridad

- El token de acceso se genera con `crypto.randomBytes(32)` y nunca se almacena en claro.
- El documento, snapshot y hash no pueden cambiar despues de salir de borrador.
- Los eventos de evidencia no admiten `UPDATE` ni `DELETE`.
- Las tablas internas usan RLS por `workspace_members`.
- El acceso publico se resuelve en servidor con service role y una comparacion por hash.
- Una ruta que requiere OTP no libera metadatos documentales antes de verificarlo.

## Integraciones pendientes de configuracion

La aplicacion no debe simular entrega, identidad o certificacion. Antes de produccion se deben conectar adapters reales para:

- Resend y webhooks de entrega/rebote.
- SMS y WhatsApp con callbacks firmados e idempotentes.
- OTP para el portal de destinatario.
- URLs temporales del documento privado en Storage.
- Generacion de constancias PDF, QR publico, TSA RFC 3161 y NOM-151.
- Workers de expiracion, reintentos y reconciliacion de estados.

La migracion base esta en `supabase/migrations/20260808010000_docubox_notifica.sql`.
