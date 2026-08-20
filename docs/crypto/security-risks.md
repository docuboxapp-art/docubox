# Riesgos de seguridad

Fecha de corte: 2026-08-17

## Escala

- **Critico**: permite certificacion falsa, compromiso de llave, alteracion no detectada o cruce de tenant.
- **Alto**: rompe trazabilidad, recuperacion o minimo privilegio bajo condiciones realistas.
- **Medio**: debilita interoperabilidad, disponibilidad u operacion segura.

## Registro

| ID | Severidad | Riesgo | Evidencia exacta | Tratamiento |
|---|---|---|---|---|
| CR-01 | Critico | Certificacion no enlazada a version exacta | `document_certifications` carece de FK a `document_versions`; `engine.ts:259,279` usa version 1 | Agregar `document_version_id`, backfill y constraint |
| CR-02 | Critico | Salida visual afirma PAdES/TSA sin criptografia | `seal-pdf/index.ts:462` fija `cryptoSignatureApplied=false`; `:187-215` imprime PAdES/DigiCert | Prohibir afirmacion y separar constancia visual |
| CR-03 | Critico | PAdES se confia al mismo proveedor | `adapters.ts:146-157` acepta banderas y PDF | Verificador independiente de bytes, CMS y confianza |
| CR-04 | Critico | Timestamp se confia al mismo proveedor | `adapters.ts:99-144` acepta booleanos del gateway | Parser/verificador RFC 3161 independiente |
| CR-05 | Critico | Llave institucional PEM sin passphrase | `vps/signer/cert_loader.py:43-44` | Firma remota KMS/OpenBao; retirar PEM de produccion |
| CR-06 | Critico | Estado comercial puede equivaler produccion a validez | `domain.ts:106` deriva `legal_validity` del modo | Exigir `document_certification` y reporte valido |
| CR-07 | Alto | Contrato KMS digest/mensaje ambiguo | `message_type: DIGEST` en `adapters.ts:60`; verificacion sobre bytes canonicos | Especificar contrato y fixtures interoperables |
| CR-08 | Alto | Token de gateway opcional | `gatewayRequest()` agrega Authorization solo si existe env | Exigir workload identity, mTLS o token obligatorio |
| CR-09 | Alto | Fingerprint X.509 no canonico | `adapters.ts:94` hashea texto PEM | Parsear certificado y hashear DER |
| CR-10 | Alto | Firmador VPS posee credencial Supabase privilegiada | `vps/signer/pades_core.py:29-64` | Separar firma y persistencia; credencial minima o ninguna |
| CR-11 | Alto | Evento Certifica susceptible a carrera | `server.ts:43-73` lee max y despues inserta | RPC append atomico bajo lock/advisory lock |
| CR-12 | Alto | Saga no atomica | `submit/route.ts:43-88` y `engine.ts:151-169` escriben por pasos | Checkpoints/RPC/outbox/reconciliador |
| CR-13 | Alto | Reintento colisiona con artefactos | `uploadArtifact()` usa `upsert:false` y rutas estables | Staging por `attempt_id` y commit de referencias |
| CR-14 | Alto | Version cerrada no inmoviliza Storage | Trigger protege fila, no objeto | Politica write-once, ETag/version y hash en claim |
| CR-15 | Alto | Acceso a version acoplado a addon Colabora | Politica `document_versions_read` exige `collaboration_advanced_reviews` | Politica por permiso documental/certificador |
| CR-16 | Alto | Edge Functions sin enforcement JWT de plataforma | 24 funciones remotas muestran `verify_jwt=false` | Verificar contrato propio o habilitar JWT por funcion |
| CR-17 | Alto | Funciones DB privilegiadas expuestas | Advisor: funciones `SECURITY DEFINER` ejecutables por anon/auth | Revocar EXECUTE, wrappers minimos y pruebas |
| CR-18 | Alto | `search_path` mutable en funciones de seguridad | Advisor incluye acceso/verificacion/auditoria | `SET search_path` fijo y referencias calificadas |
| CR-19 | Alto | Analisis de firma por regex | `analyze/route.ts:24-25` | No usar como validacion; ejecutar verificador real |
| CR-20 | Alto | Portal comercial no verifica bytes | `public/certifica/[token]/route.ts:20` compara campos DB | Descargar, re-hashear y validar artefactos |
| CR-21 | Medio | Politica publica sobre tabla completa de llaves | `cryptographic_keys` tiene `public SELECT` | Vista publica minima y confirmar metadata no sensible |
| CR-22 | Medio | Multiples modelos de documento/auditoria/NOM-151 | Tablas historicas coexistentes | Adaptadores y fuente autoritativa, sin borrado |
| CR-23 | Medio | Procesamiento sincrono expuesto a timeout | `maxDuration=60` en submit y motor en request | Enqueue + worker durable |
| CR-24 | Medio | Error de proveedor puede filtrar detalle | Adaptadores propagan errores del payload | Codigos sanitizados; detalle cifrado/restringido |
| CR-25 | Medio | e.firma cruza backend/gateway en memoria | `sign-efirma/index.ts:108-114` envia key cifrada y password | TLS/mTLS, no logs, cero retencion y pruebas de borrado |

## Supabase Advisor

Hallazgos remotos al corte:

- 65 advertencias de funciones con `search_path` mutable.
- Funciones `SECURITY DEFINER` ejecutables por `anon` y `authenticated`, incluidas funciones documentales y de verificacion.
- Politicas permisivas multiples en tablas documentales relacionadas.
- Seis tablas con RLS habilitado pero sin policy, a revisar segun su intencion backend-only.
- Proteccion contra contrasenas filtradas no habilitada.

Referencias: [search_path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [anon SECURITY DEFINER](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated SECURITY DEFINER](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [politicas multiples](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies).

## Comprobaciones de secretos y llaves

### Repositorio

- No se localizaron archivos `.key`, `.p12`, `.pfx` o PEM privados en el working tree.
- `vps/certs/` esta excluido por diseño.
- Falta escaneo del historial Git y del registro de artefactos CI.

### Supabase

- `cryptographic_keys` solo contiene material publico, certificado, cadena y attestation.
- No existe evidencia de llave privada en las tablas auditadas.
- Los buckets de certificacion son privados.
- No se audito el contenido de Vault/Secrets; debe hacerse con inventario de nombres, no exponiendo valores.

### Frontend

- No se encontraron variables criptograficas con prefijo `NEXT_PUBLIC_`.
- La anon key de Supabase y tokens publicables no se consideran secretos.
- KMS/TSA/PAdES/PSC/service-role deben permanecer exclusivamente backend.

## Reglas de confianza

| Entorno | Llave/certificado permitidos | Estado UI maximo |
|---|---|---|
| Development | OpenBao o software aislado + CA interna | Desarrollo operativo |
| Staging | KMS/OpenBao staging + CA interna | Desarrollo operativo |
| Production | KMS/HSM no exportable + cadena aprobada | Produccion operativa |

Cualquier PEM local, CA autofirmada, token opcional, verificacion delegada o timestamp no validado impide `Produccion operativa`.

## Controles obligatorios antes de produccion

1. FK a version inmutable y Storage write-once.
2. KMS/HSM no exportable con minimo privilegio.
3. Verificador independiente PAdES/RFC 3161.
4. RLS/RBAC probado con dos tenants.
5. Contratos de autenticacion para todas las Edge Functions.
6. Correccion de funciones privilegiadas y `search_path`.
7. Saga durable, idempotencia y recuperacion.
8. Escaneo de secretos en historial y CI.
9. Errores/logs redaccionados.
10. Runbooks de rotacion, revocacion, expiracion y desastre.
