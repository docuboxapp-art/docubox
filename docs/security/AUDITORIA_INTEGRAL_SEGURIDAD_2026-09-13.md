# Auditoria integral de seguridad - Docubox

Fecha: 2026-09-13
Alcance: inspeccion estatica del repositorio y configuracion versionada.
Metodo: trazabilidad de frontend, API, servicios, migraciones, RLS, Edge Functions, configuracion de Vercel/Supabase y dependencias. No se consultaron ni modificaron datos productivos. Los controles de proveedor que no quedan demostrados en el repositorio se clasifican como `UNKNOWN` o como cobertura parcial, no como implementados.

## 1. Executive summary

```text
TOTAL_LAYERS: 20
IMPLEMENTED: 1
PARTIAL: 17
MISSING: 1
UNKNOWN: 1
CRITICAL_FINDINGS: 6
HIGH_FINDINGS: 8
MEDIUM_FINDINGS: 6
LOW_FINDINGS: 2
```

Docubox ya contiene una base de seguridad considerable: aislamiento documental mediante RLS y verificadores server-side, sesiones con inactividad humana, gobierno organizacional granular, step-up para operaciones organizacionales/administrativas, cifrado envelope AES-256-GCM con KMS/HSM, PAdES/TSA/NOM-151 y bitacoras encadenadas. Sin embargo, la postura global queda limitada por rutas heredadas que usan `service_role` sin autorizacion de recurso, flujos OTP debiles, secretos TOTP reversibles, endpoints publicos de mensajeria y PII, y cargas canonicas que no pasan por el escaner disponible.

La unica capa clasificada `IMPLEMENTED` es sesiones: existe enforcement central server-side, 20 minutos de inactividad real para usuarios estandar, limites mas estrictos para perfiles privilegiados, timeout absoluto y exclusion explicita de polling/refresh como actividad. La configuracion productiva viva de Vercel, Supabase, KMS, TSA y proveedores no se puede certificar solo con el repositorio.

## 2. Matriz principal

| # | Capa | Estado | Evidencia verificable | Riesgo | Prioridad |
|---|---|---|---|---|---|
| 1 | Perimetro/DDoS | PARTIAL | `.vercel/project.json`, `vercel.json`, `src/middleware.ts`; el repositorio no demuestra reglas de origen ni estado vivo de proteccion Vercel | Bypass/configuracion externa desconocida | P2 |
| 2 | WAF | UNKNOWN | No hay reglas WAF/firewall versionadas; una configuracion administrada en Vercel podria existir fuera del repo | Payloads y scanners sin control verificable | P1 |
| 3 | Anti-Bot | MISSING | CAPTCHA esta comentado en `supabase/config.toml`; honeypots/UA no realizan enforcement server-side | Automatizacion de auth, formularios y mensajeria | P1 |
| 4 | Rate Limiting | PARTIAL | `src/lib/public-verification/gateway.ts`, `src/lib/ai/security.ts`, `src/lib/document-conversion/server.ts`; no hay cobertura central y los OTP propios carecen de limite | Abuso distribuido y consumo de terceros | P0 |
| 5 | Autenticacion | PARTIAL | Supabase Auth, WebAuthn y TOTP propios; `src/app/api/auth/**`; OTP/reset y almacenamiento TOTP tienen fallas criticas | Toma de cuenta | P0 |
| 6 | Brute Force | PARTIAL | Lockout TOTP y codigo documental; sin intentos/cooldown/rate en login OTP y password reset OTP | Guessing y credential abuse | P0 |
| 7 | Sesiones | IMPLEMENTED | `src/middleware.ts`, `src/hooks/useSessionTimeout.ts`, migraciones `20260908044044`, `20260908182213`, `20260909075009`, `20260909100000` | Riesgo residual operativo | P3 |
| 8 | Dispositivos | PARTIAL | `src/app/api/security/check-device/route.ts`, `log-access/route.ts`, tablas de sesiones/dispositivos; fingerprint debil y sin motor de riesgo | Evasion de deteccion | P2 |
| 9 | Multi-Tenant | PARTIAL | `document-access.ts`, `can_access_documento`, RLS y gobierno organizacional; existe BOLA en `advance-participation` y RLS global legacy | Tenant escape/IDOR | P0 |
| 10 | RBAC/Autorizacion | PARTIAL | `organization/server.ts`, `platform-admin/authorization.ts`, permisos granulares/RLS; cobertura no uniforme en APIs legacy | Elevacion de privilegios | P0 |
| 11 | Acceso documental | PARTIAL | `document-content-access.ts`, codigo de acceso con lockout, expiracion/revocacion/auditoria, Legal Hold; rutas legacy omiten helper canonico | Acceso o mutacion indebida | P0 |
| 12 | Step-Up | PARTIAL | Reauth organizacional y plataforma para varias operaciones; no se exige consistentemente en cuenta personal, firma, borrado o liberacion de Legal Hold | Accion critica con sesion robada | P1 |
| 13 | API Security | PARTIAL | 226 `route.ts`; auth, Zod, rate y audit existen de forma desigual; middleware delega API a cada ruta | BOLA, abuso, fuga de datos | P0 |
| 14 | Upload Security | PARTIAL | Edge `scan-and-upload`, MetaDefender en Certifica/Colabora, parser DOCX endurecido; envio/reemplazo canonico no escanea contenido | Malware almacenado/procesado | P0 |
| 15 | Processing Sandbox | PARTIAL | CloudConvert externo con timeout/rate y DOCX in-process con presupuestos ZIP/XML; aislamiento y limites del proveedor no constan en repo | Parser exploitation/DoS | P1 |
| 16 | Browser Security | PARTIAL | Solo visor recibe `Referrer-Policy`/`X-Robots-Tag`; faltan CSP, HSTS, XCTO, Permissions-Policy y frame-ancestors globales; source maps productivos activos | XSS/clickjacking/info leak | P1 |
| 17 | Criptografia | PARTIAL | AES-256-GCM envelope, DEK por version, KMS wrap, AAD, hashes y storage privado; cobertura historica y KMS/IAM productivo no verificables | Plaintext legacy/config drift | P1 |
| 18 | Firma/Evidencia | PARTIAL | PAdES-B-T, TSA primario/fallback, NOM-151, XML/Evidence Package v2 y OTS; varios caminos dependen de flags/env/proveedores vivos | Evidencia incompleta en runtime | P1 |
| 19 | Infra/Secrets/Supply Chain | PARTIAL | `.gitignore`, locks y fail-closed productivo; token SMS hardcoded, fallback TOTP, 38 advisories prod y sin CI security versionado | Compromiso de proveedor/supply chain | P0 |
| 20 | Audit/Detection/Response | PARTIAL | Multiples bitacoras append-only/hash-chain; `log-access` admite eventos no autenticados y no hay motor unificado de riesgo/incidentes demostrado | Audit poisoning/deteccion tardia | P1 |

## 3. Evidencia tecnica por dominio

### Perimetro, navegador y abuso

- `next.config.mjs`: headers restringidos a `/visor-documento/:path*`; no hay politica global CSP/HSTS/clickjacking y `productionBrowserSourceMaps: true`.
- `src/middleware.ts`: valida claims y politica de sesion para paginas protegidas, pero deja que cada `/api/*` implemente autenticacion y autorizacion.
- `vercel.json`: duracion de funciones y cron jobs, sin reglas WAF/firewall versionadas. La proteccion DDoS de plataforma y dominios vivos no se pueden confirmar desde Git.
- `src/lib/public-verification/gateway.ts`: bucket distribuido por IP/scope, hash de identificadores y fail-closed. `src/lib/ai/security.ts` y `src/lib/document-conversion/server.ts` poseen limitadores separados y de alcance especifico.
- `supabase/config.toml`: limites locales de Supabase Auth, CAPTCHA deshabilitado/comentado, password local minimo 6 sin requisitos. No prueba configuracion hosted.

### Autenticacion, sesiones y dispositivos

- `src/app/api/auth/check-login-options/route.ts:4`: consulta anonima con `service_role` y respuesta distinguible con existencia, estado y datos de dispositivos.
- `src/app/api/auth/send-login-otp/route.ts:121` y `password-reset-otp/route.ts:47`: generan OTP con `Math.random`; `login_otps.otp_code`/`signature_otps.otp_code` guardan el valor verificable en claro; no hay contador de intentos ni rate limit propio.
- `src/app/api/auth/verify-login-otp/route.ts:20-55`: compara codigo en claro y genera magic link administrativo. `password-reset-otp/route.ts:169-269` permite el reset administrativo tras el mismo patron.
- `src/app/api/auth/totp/setup/route.ts:17-32`: “cifra” el seed concatenando una clave con fallback estatico y Base64. `totp/verify-login/route.ts:26-38` conserva compatibilidad que permite extraer el seed del valor almacenado.
- `src/app/api/webauthn/**` y `20260519210000_webauthn_challenges.sql`: challenge con TTL, origin/RP ID esperados, contador, eliminacion y tokens QR de un uso. Queda un advisory bajo en la version instalada.
- `src/middleware.ts` + `useSessionTimeout.ts`: el servidor no registra actividad automatica; el cliente solo registra interaccion humana/navegacion. La base aplica 20 minutos estandar, 10 privilegiado y timeout absoluto.
- `src/app/api/security/check-device/route.ts`: auth y asociacion al usuario. `log-access/route.ts:128-132` consulta geolocalizacion por HTTP y el fingerprint browser/OS/tipo no constituye control de riesgo fuerte.

### Tenant, RBAC y documento

- `src/lib/security/document-access.ts:27-143`: bearer auth, owner, membership activa/no expirada, permiso explicito y participacion; `requireEdit` y `ownerOrAdminOnly`.
- `src/lib/security/document-content-access.ts`: agrega el codigo de visualizacion y auditoria. `unlock_document_view_access` aplica hash, sesion, expiracion y bloqueo por intentos.
- `src/app/api/documentos/advance-participation/route.ts:41-121`: autentica al actor, pero lee y actualiza cualquier `documentoId` con `service_role` sin ownership, membership, permiso ni participacion. Es BOLA confirmada.
- `src/app/api/documentos/buscar-participante/route.ts:9-51`: endpoint anonimo con `service_role` que busca por email, telefono, RFC, CURP o nombre y devuelve PII.
- `20260507100000_fix_document_viewer_access.sql` y `20260904170000_lucia_phase1_security.sql`: RLS documental por propietario/participante y `can_access_documento` con grants restringidos.
- `20260326040000_etiquetas_table.sql`, `20260326050000_rol_table.sql`, `20260326220000_roles_documento_table.sql`: `FOR ALL TO authenticated USING (true) WITH CHECK (true)`; no se encontro migracion posterior que retire esas policies.
- `src/lib/organization/server.ts` y `20260815120000_organization_governance_foundation.sql`: permisos granulares, roles, membresias activas, RLS y step-up con token opaco SHA-256/scoped/10 minutos.
- `src/lib/platform-admin/access.ts` y `platform-admin/authorization.ts`: RBAC/ABAC, passkey para super admin, step-up y support session scoped para contenido de clientes.
- `20260815220000_organization_continuity_hardening.sql` y `20260816010000_organization_invitation_lifecycle.sql`: lifecycle invited/accepted/active/suspended/revoked, revocacion de membership/credenciales de aplicacion y preservacion de autoria, firmas y auditoria. No revoca la cuenta personal ni borra historia.

### Upload, conversion, datos y evidencia

- `supabase/functions/scan-and-upload/index.ts`: magic bytes, saneamiento PDF, MetaDefender y fail-closed. No se encontro invocacion desde el envio canonico.
- `src/app/api/documentos/enviar/route.ts` y `[documentId]/replace-file/route.ts`: tamano, hash, cifrado y storage, pero sin magic bytes, AV/CDR o macro detection antes de persistir.
- `src/app/api/certifica/cases/[id]/upload/route.ts`: MetaDefender fail-closed en produccion. Colabora guarda `malware_scan_status=pending` y su incorporacion SQL exige `clean`.
- `src/app/api/plantillas/import-docx/route.ts` y `src/lib/template-import/docx/parser.ts`: 15 MiB, firma ZIP, max 2048 entries, 50 MiB descomprimidos, limites por entry/XML/imagenes/HTML, rutas inseguras, CRC32 y protocolos externos seguros. No hay AV/CDR/macro scan y el parser corre dentro de la funcion Next.js.
- `src/app/api/document-conversion/jobs/route.ts`: bearer auth, extension/tamano, limite distribuido y token de job. `cloudconvert-provider.ts` procesa externamente; sandbox/CPU/memoria/retencion del proveedor son `UNKNOWN` desde repo.
- `src/lib/crypto/document-encryption/**`: AES-256-GCM, DEK por version, KMS wrap, AAD, SHA plaintext/ciphertext, buffer zeroing y storage `payload.enc`. `config.ts` exige cifrado en produccion y falla cerrado si KMS no esta listo.
- `src/lib/certification/**`, `src/lib/evidence-v2/**`, `src/app/api/documentos/[documentId]/viewer-file/route.ts`: verifica estado PAdES-B-T, certificado, timestamp, integridad y coincidencia path/hash antes de servir el final. Flags/proveedores productivos no son demostrables estaticamente.

### Secretos, dependencias y auditoria

- `src/lib/smsNotifications.ts:1-3`: token/proyecto de proveedor tienen fallback hardcoded; el token se envia como query parameter (`:71-75`) y aparece en historia Git. Debe rotarse, no solo eliminarse del HEAD.
- `src/app/api/notifications/sms/route.ts`, `send-direct-invite/route.ts` y `trigger-invite/route.ts`: rutas sin autenticacion/autorizacion/rate limit que disparan SMS o email; una ruta GET usa destinatario de prueba hardcoded.
- `src/app/api/security/log-access/route.ts:184-274`: acepta anonimamente `userId`, email, resultado de login y fingerprint suministrados por cliente y escribe con `service_role`; permite envenenar auditoria.
- `npm audit --omit=dev`: 38 nodos vulnerables (0 critical, 2 high, 35 moderate, 1 low). High: `@tiptap/core` XSS/ReDoS y `fast-uri` host confusion/SSRF; low directo: `@simplewebauthn/server` trust anchors. Hay lockfiles, pero no `.github`/Dependabot/SAST/secret scanning versionados.
- Bitacoras encadenadas/append-only: migraciones `20260330080100`, `20260330080200`, `20260808120000`, `20260816080000`, `20260831195059`, `20260902000000`, `20260903184030`, `20260909110000`. Existen varios modelos de evento y no se encontro correlacion/alerta/incidente unificados.

## 4. Matriz por perfil

| Control | Personal | Owner | Admin | Colaborador | Super Admin |
|---|---|---|---|---|---|
| Password/Auth | Supabase + flujos OTP debiles | Igual | Igual | Igual | Plataforma exige controles adicionales |
| MFA TOTP | Disponible, seed inseguro | Disponible, no obligatorio global | Disponible, no obligatorio global | Disponible | Passkey requerido en control plane; TOTP flags |
| Passkey/WebAuthn | IMPLEMENTED opcional | Opcional | Opcional | Opcional | Requerido por politica de plataforma |
| Sesion/idle | 20 min | 20 min | 20 min | 20 min; membership revocable | 10 min privilegiado + absoluto |
| Dispositivos | Registro/alerta parcial | Parcial | Parcial | Parcial | Step-up/control plane |
| Tenant/RLS | Workspace personal + owner | Owner + permisos | Membership + permisos | Membership activa/roles | Acceso cliente solo con support scope |
| Step-Up | Escaso/inconsistente | Amplio en gobierno org | Amplio en gobierno org | Segun operacion | Passkey/approval en acciones definidas |
| Auditoria | Documental/auth fragmentada | Organizacion hash-chain | Organizacion hash-chain | Acciones historicas preservadas | Platform audit/security events |
| Offboarding | No aplica a cuenta propia | Ejecuta | Ejecuta con permiso | Suspende/revoca acceso org sin borrar historia | Gobernanza separada |

## 5. Endpoint security matrix

| Endpoint/grupo | Auth | Tenant/recurso | Permission | Rate | Validation | Audit | Resultado |
|---|---|---|---|---|---|---|---|
| `/api/auth/check-login-options` | No | No | No | No | Email basico | No | CRITICAL: enumeracion/metadata |
| `/api/auth/send-login-otp`, `/verify-login-otp` | Pre-auth | Usuario por email | No | No | Debil | Parcial | CRITICAL: OTP/guessing |
| `/api/auth/password-reset-otp` | Pre-auth | Usuario por email | No | No | Debil | Parcial | CRITICAL: recovery |
| `/api/auth/totp/*` | Mixto | Usuario | Parcial | Lockout en verify | TOTP | Si | CRITICAL: seed reversible |
| `/api/documentos/enviar` | Bearer | Membership solicitada | Owner/member | No global | Parcial | Si | PARTIAL: falta malware |
| `/api/documentos/[id]/viewer-file` | Bearer | Helper canonico | Acceso contenido/codigo | Codigo con lockout | Variant/hash | Si | Fuerte |
| `/api/documentos/[id]/evidence/package` | Bearer | Helper canonico | Acceso contenido | No | Nombre seguro | Evidencia | Fuerte |
| `/api/documentos/[id]/legal-hold` | Bearer | Owner/admin | Owner/admin | No | Accion tipada | Si | PARTIAL: release sin step-up |
| `/api/documentos/advance-participation` | Bearer | No | No | No | ID presente | Si, posterior | CRITICAL: BOLA |
| `/api/documentos/buscar-participante` | No | No | No | No | Query minima | No | CRITICAL: PII |
| `/api/firma/finalize-evidence` | Bearer | Helper canonico | Acceso documento | No | IDs | Evidencia | Adecuado/partial runtime |
| `/api/firma/mobile-signature/*` | Capability/Bearer | Documento/sesion | Un uso/expiry | Parcial | Size/geo/hash | Si | Adecuado |
| `/api/notifications/sms`, `send-direct-invite`, `trigger-invite` | No | No | No | No | Parcial | No | CRITICAL: abuso externo |
| `/api/plantillas/import-docx` | Bearer | Contexto publicacion | Membership | No global | ZIP/parser robusto | Si | PARTIAL: sin AV/sandbox |
| `/api/document-conversion/jobs` | Bearer | Usuario | Usuario | Si | Extension/tamano/token | Parcial | Adecuado, proveedor UNKNOWN |
| `/api/admin/cleanup-documentos` | Secreto >=32 | Global | Secreto interno | No | Parcial | No evidente | Protegido, rotacion externa UNKNOWN |
| `/api/public/colabora/.../upload` | Capability + sesion OTP | Workspace/request/item | Estado/expiry | No | MIME/tamano | Si | PARTIAL; incorporacion exige scan clean |

## 6. Gaps

### P0 - Critical

**GAP SEC-001:** PII lookup anonimo. **CURRENT_STATE:** `buscar-participante` usa `service_role` sin auth. **RISK:** fuga masiva/enumeracion. **AFFECTED_COMPONENT:** participantes. **RECOMMENDED_FIX:** exigir bearer, tenant y permiso; respuesta minima. **COMPLEXITY:** M. **DEPENDENCIES:** helper documental/organizacion. **UI:** no. **DB:** no.

**GAP SEC-002:** OTP de login/reset no resistente a ataque. **CURRENT_STATE:** `Math.random`, valor en claro, sin intentos/cooldown/rate; login genera magic link admin. **RISK:** account takeover. **AFFECTED_COMPONENT:** auth/recovery. **RECOMMENDED_FIX:** CSPRNG, hash/HMAC, consumo atomico, intentos, cooldown, rate IP+cuenta y respuesta uniforme. **COMPLEXITY:** M. **DEPENDENCIES:** rate limiter/audit. **UI:** no obligatoria. **DB:** si, compatible.

**GAP SEC-003:** TOTP seed reversible. **CURRENT_STATE:** Base64 con fallback estatico y compatibilidad permisiva. **RISK:** bypass MFA si DB/log se filtra. **AFFECTED_COMPONENT:** MFA. **RECOMMENDED_FIX:** cifrado autenticado con KMS/envelope, rotacion/re-enrollment y eliminar fallback. **COMPLEXITY:** H. **DEPENDENCIES:** KMS y plan de migracion. **UI:** posiblemente. **DB:** si, compatible.

**GAP SEC-004:** BOLA en avance de participantes. **CURRENT_STATE:** cualquier usuario autenticado puede mutar un documento conocido. **RISK:** alterar workflow, notificar terceros y afectar evidencia. **AFFECTED_COMPONENT:** documentos/firma. **RECOMMENDED_FIX:** `requireDocumentAccess(...,{requireEdit:true})`, validar transicion e idempotencia. **COMPLEXITY:** L. **DEPENDENCIES:** helper existente. **UI:** no. **DB:** no.

**GAP SEC-005:** mensajeria publica y secreto SMS embebido. **CURRENT_STATE:** endpoints anonimos disparan email/SMS; token fallback versionado y enviado en URL. **RISK:** fraude, costo, spam y compromiso proveedor. **AFFECTED_COMPONENT:** notificaciones. **RECOMMENDED_FIX:** retirar test route, auth/tenant/permission/rate/idempotency; rotar secreto y purgar historia segun procedimiento. **COMPLEXITY:** M. **DEPENDENCIES:** proveedor/secret store. **UI:** no. **DB:** posible idempotency/audit.

**GAP SEC-006:** escaner no integrado al flujo canonico. **CURRENT_STATE:** scanner existe, pero enviar/reemplazar persisten sin magic bytes/AV. **RISK:** malware y archivos poliglota en storage/procesamiento. **AFFECTED_COMPONENT:** documentos/uploads. **RECOMMENDED_FIX:** pipeline cuarentena-scan-clean antes de incorporacion, reutilizando MetaDefender/Edge. **COMPLEXITY:** H. **DEPENDENCIES:** storage, jobs, estados. **UI:** no obligatoria. **DB:** si, estados compatibles.

### P1 - High

**GAP SEC-007:** auditoria envenenable. **CURRENT_STATE:** `log-access` confia identidad/resultado del cliente anonimo. **RISK:** evidencia falsa y ruido de deteccion. **COMPONENT:** access logs. **FIX:** derivar actor/resultados server-side y firmar/correlacionar eventos. **COMPLEXITY:** M. **DEPENDENCIES:** audit normalization. **UI:** no. **DB:** posible.

**GAP SEC-008:** password/verification no garantizados server-side. **CURRENT_STATE:** registro admin solo exige presencia; config local minimo 6 y confirmacion deshabilitada. **RISK:** credenciales debiles/cuentas no verificadas. **COMPONENT:** signup/reset. **FIX:** politica comun server-side y verificar hosted config. **COMPLEXITY:** L-M. **DEPENDENCIES:** Supabase Auth. **UI:** no obligatoria. **DB:** no.

**GAP SEC-009:** RLS legacy permite administrar catalogos globales. **CURRENT_STATE:** tres tablas usan `FOR ALL authenticated true`. **RISK:** corrupcion transversal. **COMPONENT:** etiquetas/roles. **FIX:** reemplazar con owner/tenant/admin policies tras inventario de uso. **COMPLEXITY:** M. **DEPENDENCIES:** modelo de ownership. **UI:** no. **DB:** migracion.

**GAP SEC-010:** anti-bot/WAF/rate de auth sin evidencia. **CURRENT_STATE:** CAPTCHA deshabilitado y WAF live desconocido. **RISK:** stuffing/scanning/DoS logico. **COMPONENT:** auth/public. **FIX:** controles de plataforma y limiter distribuido central con privacidad. **COMPLEXITY:** M. **DEPENDENCIES:** Vercel/Supabase. **UI:** challenge solo por riesgo. **DB:** posible.

**GAP SEC-011:** seguridad API inconsistente. **CURRENT_STATE:** auth, schema, permission, rate y audit varian por ruta. **RISK:** nuevos BOLA/leaks. **COMPONENT:** `src/app/api/**`. **FIX:** guardas reutilizables y pruebas contractuales por clase de endpoint. **COMPLEXITY:** H. **DEPENDENCIES:** inventario/SEC-004. **UI:** no. **DB:** no.

**GAP SEC-012:** step-up incompleto. **CURRENT_STATE:** fuerte en org/plataforma, ausente en varias acciones personales/documentales. **RISK:** abuso de sesion robada. **COMPONENT:** cuenta, firma, borrado, Legal Hold. **FIX:** matriz de acciones sensibles y token scoped existente. **COMPLEXITY:** M. **DEPENDENCIES:** MFA seguro. **UI:** si, acotada. **DB:** posiblemente no.

**GAP SEC-013:** headers de navegador incompletos. **CURRENT_STATE:** solo visor; source maps productivos. **RISK:** XSS/clickjacking/info disclosure. **COMPONENT:** Next/Vercel. **FIX:** CSP progresiva con nonce/report-only, HSTS, nosniff, frame-ancestors, permissions policy y source maps privados. **COMPLEXITY:** M. **DEPENDENCIES:** inventario scripts. **UI:** no. **DB:** no.

**GAP SEC-014:** supply chain sin gate. **CURRENT_STATE:** 38 advisories prod, 2 high; no CI security. **RISK:** XSS/SSRF/regresiones. **COMPONENT:** dependencies/deploy. **FIX:** upgrades focalizados, audit/SAST/secrets en CI y proteccion de rama. **COMPLEXITY:** M. **DEPENDENCIES:** pruebas. **UI:** no. **DB:** no.

### P2 - Medium

**GAP SEC-015:** device risk debil. **CURRENT_STATE:** fingerprint auxiliar y geolocalizacion HTTP; sin score/revocacion automatica. **RISK:** poca deteccion de sesion anomala. **FIX:** HTTPS, senales server-side, alertas y reglas graduales. **COMPLEXITY:** M. **UI:** posible. **DB:** posible.

**GAP SEC-016:** aislamiento de procesamiento incompleto. **CURRENT_STATE:** DOCX in-process endurecido; limites/retencion del proveedor externo no verificables. **RISK:** parser/resource abuse y datos temporales. **FIX:** documentar SLA, timeout/memoria/retencion; worker aislado si el riesgo lo exige. **COMPLEXITY:** H. **UI:** no. **DB:** no obligatoria.

**GAP SEC-017:** estado productivo criptografico/evidencia no demostrable. **CURRENT_STATE:** codigo fail-closed y completo, pero flags, IAM, claves, TSA/NOM-151 y migracion legacy son externos. **RISK:** indisponibilidad/cobertura parcial. **FIX:** runbook y attestation automatizada read-only por ambiente. **COMPLEXITY:** M. **UI:** no. **DB:** no.

**GAP SEC-018:** deteccion fragmentada. **CURRENT_STATE:** bitacoras fuertes por dominio sin correlacion/risk/incident engine unico. **RISK:** eventos criticos no alertados. **FIX:** normalizar envelope y correlacion antes de crear alert engine. **COMPLEXITY:** H. **UI:** posterior. **DB:** si, aditiva.

**GAP SEC-019:** configuracion viva no atestada. **CURRENT_STATE:** repo no demuestra WAF, env scopes, IAM, dominios ni settings hosted. **RISK:** drift. **FIX:** inventario read-only y policy-as-code donde sea viable. **COMPLEXITY:** M. **UI:** no. **DB:** no.

**GAP SEC-020:** exposicion publica heterogenea. **CURRENT_STATE:** Edge Functions `verify_jwt=false` mezclan capacidades publicas y verificaciones con `service_role`; CORS amplio en verificadores. **RISK:** metadata leakage/abuso. **FIX:** clasificar capability/public/internal, minimizar respuestas y aplicar quotas. **COMPLEXITY:** M. **UI:** no. **DB:** no.

### P3 - Hardening

**GAP SEC-021:** advisory WebAuthn bajo. **CURRENT_STATE:** `@simplewebauthn/server 13.3.0`. **RISK:** validacion de trust anchors en registro. **FIX:** upgrade focalizado a version corregida y pruebas. **COMPLEXITY:** L. **UI/DB:** no.

**GAP SEC-022:** documentacion/config local puede inducir conclusiones productivas falsas. **CURRENT_STATE:** `supabase/config.toml` y auditoria historica de cifrado no reflejan necesariamente hosted/current. **RISK:** operacion incorrecta. **FIX:** etiquetar alcance/fecha y generar evidencia de ambiente separada. **COMPLEXITY:** L. **UI/DB:** no.

## 7. Quick wins recomendados

1. Proteger o retirar `buscar-participante`, `advance-participation` y las tres rutas publicas de mensajeria reutilizando helpers existentes.
2. Rotar inmediatamente el token SMS y eliminar fallbacks de secretos; la limpieza de historia debe seguir el procedimiento del proveedor/Git.
3. Aplicar el limiter distribuido existente a login OTP, reset OTP, codigo documental, invitaciones y endpoints publicos costosos.
4. Cambiar OTP a CSPRNG + hash + consumo atomico + intentos, sin cambio visual obligatorio.
5. Desactivar source maps publicos y desplegar primero CSP report-only/headers globales compatibles.
6. Corregir las tres policies `FOR ALL authenticated` despues de confirmar ownership esperado.
7. Agregar gates CI de `npm audit`, secret scanning y pruebas de autorizacion; no requiere redisenar producto.

## 8. Componentes que deben preservarse

- Envelope encryption AES-256-GCM, DEK por version, AAD, hashes plaintext/ciphertext, KMS/HSM, zeroing y storage privado.
- Verificacion PAdES-B-T, TSA primario/fallback, validacion de certificado/timestamp/path/hash y fail-closed productivo.
- NOM-151, Evidence Package/XML v2, OpenTimestamps, versionado, hash chains y artefactos existentes.
- `requireDocumentAccess`, `requireDocumentContentAccess`, bloqueo de codigo documental y auditoria de vista.
- Politica de 20 minutos de inactividad humana, timeout privilegiado/absoluto y exclusion de polling/refresh.
- Gobierno organizacional granular, lifecycle/offboarding y preservacion historica de acciones.
- Visor, workflows, participantes, documentos existentes y compatibilidad legacy durante cualquier migracion.

## 9. Duplicidades y dependencias

No se confirmaron dos motores completos equivalentes. Si existen implementaciones paralelas por dominio: tres limitadores (`server_rate_limit`, AI buckets y conversion), varias bitacoras con envelopes distintos y guardas de autorizacion canonicas coexistiendo con rutas legacy ad hoc. Deben converger por adaptadores; no sustituirse de golpe.

```text
SEC-005 secretos/mensajeria -> SEC-010 rate/anti-bot -> SEC-018 correlacion/alertas
SEC-011 inventario API -> SEC-004 BOLA + SEC-001 PII -> pruebas de autorizacion tenant
SEC-002 OTP -> SEC-003 MFA/KMS -> SEC-012 step-up consistente
SEC-006 cuarentena/scanner -> SEC-016 procesamiento aislado
SEC-007 audit confiable -> SEC-018 envelope normalizado -> Risk/Alert/Incident Engine
SEC-019 attestation de ambientes -> cierre operativo de capas 1, 2, 17 y 18
```

## 10. Orden de implementacion propuesto

| Cambio | Alcance | Dependencias | Riesgo de regresion |
|---|---|---|---|
| SECURITY-01 | Contener PII, BOLA y mensajeria publica; rotar secreto | Helpers existentes | Bajo-medio |
| SECURITY-02 | Endurecer login/reset OTP y rate limits | Audit + bucket distribuido | Medio |
| SECURITY-03 | Migrar TOTP a KMS/envelope y definir re-enrollment | KMS operativo | Alto |
| SECURITY-04 | Integrar cuarentena/AV al envio y reemplazo | Storage/jobs | Alto |
| SECURITY-05 | Corregir RLS legacy y ampliar pruebas tenant/BOLA | Matriz ownership | Medio-alto |
| SECURITY-06 | Normalizar guardas API, schemas, audit e idempotency | SECURITY-01/05 | Medio |
| SECURITY-07 | Headers browser/CSP progresiva y source maps privados | Inventario scripts | Medio |
| SECURITY-08 | Actualizar dependencias y activar CI security | Suite de pruebas | Medio |
| SECURITY-09 | Completar step-up por matriz de riesgo | MFA seguro | Medio |
| SECURITY-10 | Normalizar eventos y crear deteccion/alertas | Audit confiable | Alto |
| SECURITY-11 | Atestar WAF/env/IAM/proveedores por ambiente | Acceso operativo read-only | Bajo |

## Limitaciones y trazabilidad

- La auditoria no valida el estado vivo de Vercel Firewall, variables por scope, Supabase hosted Auth/RLS aplicado, IAM de GCP, buckets, certificados, TSA/NOM-151, rotacion de secretos ni logs productivos.
- El conteo de rutas (`226`) es inventario estatico; la matriz prioriza endpoints sensibles y hallazgos confirmados, no sustituye pruebas dinamicas de cada ruta.
- No se considero seguridad cualquier boton oculto o validacion exclusivamente frontend.
- No se ejecutaron cambios, migraciones, despliegues, commits ni pruebas mutantes. `npm audit --omit=dev` fue una inspeccion read-only.

STATUS: SECURITY_AUDIT_COMPLETED

CODE_MODIFIED: NO
DATABASE_MODIFIED: NO
MIGRATIONS_CREATED: NO
DEPENDENCIES_ADDED: NO
UI_MODIFIED: NO
DEPLOYMENT_PERFORMED: NO

TOTAL_SECURITY_LAYERS: 20

IMPLEMENTED: 1
PARTIAL: 17
MISSING: 1
UNKNOWN: 1

CRITICAL_GAPS: 6
HIGH_GAPS: 8
MEDIUM_GAPS: 6
LOW_GAPS: 2

TOP_5_SECURITY_PRIORITIES:
1. Cerrar PII anonima, BOLA documental y endpoints publicos de mensajeria; rotar el secreto SMS.
2. Reconstruir login/reset OTP con CSPRNG, hash, consumo atomico, intentos y rate limiting.
3. Migrar los seeds TOTP reversibles a cifrado autenticado con KMS y eliminar fallbacks.
4. Integrar cuarentena, magic bytes y malware scanning al envio/reemplazo canonico.
5. Corregir RLS legacy y estandarizar autorizacion tenant/resource en todas las APIs.

EXISTING_SECURITY_COMPONENTS_TO_PRESERVE:
- Sesiones por actividad humana; helpers de acceso documental; AES-256-GCM/KMS/HSM; PAdES/TSA/NOM-151; Evidence Package/XML v2; RLS/gobierno organizacional; bitacoras encadenadas.

DUPLICATE_IMPLEMENTATIONS_FOUND:
- No hay dos motores completos confirmados; existen limitadores, bitacoras y guardas paralelos por dominio que requieren convergencia controlada.

RECOMMENDED_FIRST_IMPLEMENTATION_PHASE:
- SECURITY-01: contencion inmediata, sin redisenar UI ni criptografia, de PII/BOLA/mensajeria y rotacion de secretos; despues SECURITY-02 para OTP/rate limiting.

READY_FOR_SECURITY_IMPLEMENTATION_PLAN:
YES
