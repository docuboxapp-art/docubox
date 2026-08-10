# Riesgos de seguridad

## Escala

- **Critico:** puede producir certificaciones falsas, exposicion de PII o compromiso de llave.
- **Alto:** rompe aislamiento, integridad o recuperacion bajo condiciones realistas.
- **Medio:** debilita trazabilidad, disponibilidad o claridad operativa.

## Registro de riesgos

| ID | Severidad | Riesgo | Evidencia exacta | Tratamiento propuesto |
|---|---|---|---|---|
| CR-01 | Critico | Lectura anonima de tablas de identidad en remoto | Conteos REST anonimos positivos en `enrollment_tokens`, `enrollment_results`, `curp_validations`, `serial_validations`, `nubarium_ocr_logs`, `face_comparison_logs`, `mobile_upload_sessions` | Aplicar primero `20260808115900_emergency_public_policy_lockdown.sql`; verificar conteo cero |
| CR-02 | Critico | Flujo visual afirma PAdES/TSA sin firma criptografica | `supabase/functions/seal-pdf/index.ts:462-467` fija `cryptoSignatureApplied = false`, mientras `:187-215` imprime PAdES/DigiCert | No presentar como PAdES; conservar solo como constancia visual de compatibilidad |
| CR-03 | Critico | Llave institucional de software sin passphrase | `vps/signer/cert_loader.py:42-44` carga PEM con `key_passphrase=None` | Sustituir por firma remota OpenBao/HSM; bloquear produccion |
| CR-04 | Critico | Recomendacion de PKCS#12 en Supabase Vault y contrasena fija | `generate_p12.sh:32-47` | Retirar del proceso productivo; documentar solo entorno desechable |
| CR-05 | Critico | PAdES no verificado independientemente | `signPdfWithPades()` confia en `status` y `byte_range_valid` del gateway | Verificador separado de CMS, ByteRange, cadena y timestamp |
| CR-06 | Critico | Timestamp no verificado localmente | `requestVerifiedTimestamp()` confia en banderas del gateway | Parsear/validar TSR, imprint, nonce, policy, firma, EKU y cadena |
| CR-07 | Critico | No existe version inmutable universal | `document_version: 1` fijo en `engine.ts:259,279` | Snapshot versionado y bloqueo real antes de hash |
| CR-08 | Alto | Autorizacion owner-only, RBAC tenant incompleto | `engine.ts:255`, `getCertificationSummary():233` | Politica compartida de permisos por tenant/documento |
| CR-09 | Alto | El token del gateway criptografico es opcional | `adapters.ts:20-23` | Exigir autenticacion mutua o token obligatorio; allowlist de red |
| CR-10 | Alto | Firmador VPS tiene service-role de Supabase | `vps/signer/pades_core.py:38-64` | Separar firma de persistencia; credencial de minimo privilegio o ninguna DB |
| CR-11 | Alto | Estados y auditoria no atomicos | `engine.ts:159-169` hace update e insert separados | RPC transaccional de transicion/checkpoint |
| CR-12 | Alto | Reintentos colisionan con artefactos parciales | `uploadArtifact()` usa `upsert:false`; rutas estables por certificacion | Staging por intento y commit final |
| CR-13 | Alto | Modelos `documents` y `documentos` divergentes | Motor nuevo usa `documentos`; `sign-pdf-vps`/NOM-151 usan `documents` | Adaptador de compatibilidad y fuente autoritativa unica |
| CR-14 | Alto | Politicas/motor local no desplegados | REST remoto devuelve esquema ausente para tablas nuevas | Pipeline de migracion autenticado y verificacion post-deploy |
| CR-15 | Alto | Material publico de llaves originalmente abierto | `certification_public_keys_read USING (true)` en migracion 20260805 | Exponer solo endpoint/proyeccion publica minima; no tabla completa |
| CR-16 | Alto | Posible fuga de detalle del proveedor | `gatewayRequest()` propaga `payload.error` | Mapear errores a codigos sanitizados; detalle solo en logs protegidos |
| CR-17 | Medio | Fingerprint de certificado calculado sobre PEM textual | `adapters.ts` usa `sha256Hex(certificatePem)` | Parsear X.509 y hashear DER canonical |
| CR-18 | Medio | Contrato ambiguo digest vs mensaje | KMS recibe `message_type: DIGEST`, pero Node verifica `canonicalBytes` | Definir si RSA-PSS firma digest precomputado o mensaje; test de interoperabilidad |
| CR-19 | Medio | Procesamiento sincrono expuesto a timeout | POST API ejecuta todo el motor en la solicitud | Cola durable + worker + polling/status |
| CR-20 | Medio | Logs de acceso sin contexto tecnico completo | `certification_access_logs` carece de correlation/attempt/provider | Extender observabilidad sin PII cruda |

## Comprobaciones solicitadas

### Llaves privadas en repositorio

- No se encontraron archivos fisicos `.key`, `.pem`, `.p12` o `.pfx`.
- `vps/certs/` esta ignorado.
- Si existen en historial Git remoto, esta inspeccion de working tree no los detecta; se requiere escaneo de historial antes de produccion.

### Llaves privadas en Supabase

- No se encontro codigo que persista una llave privada mediante el motor nuevo.
- `cryptographic_keys` almacena `public_key_pem` y `certificate_pem`, no private key.
- `generate_p12.sh` recomienda guardar un PKCS#12 en Supabase Vault. Esa recomendacion debe considerarse no aprobada para produccion.
- No fue posible auditar el contenido de Supabase Vault sin acceso administrativo; queda como comprobacion pendiente.

### Storage publico

- Los buckets remotos enumerados estaban marcados privados.
- Los buckets de certificacion aun no existen remotamente.
- La migracion propuesta los crea privados.

### Secretos frontend

- Las variables criptograficas nuevas no usan prefijo `NEXT_PUBLIC_`.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`, sitio, analitica y publishable key son deliberadamente publicas.
- El token del gateway debe permanecer exclusivamente backend.

### Acceso backend, tenant y RBAC

- Las APIs usan bearer auth y service client despues de autenticar.
- La autorizacion actual es insuficiente para roles de workspace.
- Las Edge Functions endurecidas usan comprobacion de acceso documental, pero su despliegue esta pendiente.

## Reglas de confianza por entorno

| Entorno | Llave permitida | Certificado | Estado UI maximo |
|---|---|---|---|
| Development | OpenBao o software aislado | CA interna development | Desarrollo operativo |
| Staging | OpenBao/HSM de staging | CA interna staging | Desarrollo operativo |
| Production | KMS/HSM con control operativo | Cadena aprobada de produccion | Produccion operativa |

Una llave PEM local, certificado autofirmado, token opcional, TSA no verificada o PAdES sin verificador independiente impiden el estado `Produccion operativa`.

## Controles obligatorios antes de habilitar

1. Escaneo de secretos en working tree e historial Git.
2. Inventario y rotacion de credenciales existentes.
3. Acceso privado o mTLS a gateways.
4. AppRole/workload identity para OpenBao.
5. RLS probada con usuarios de dos tenants.
6. Storage write-once y versionado.
7. Auditoria de quien inicia, reintenta, descarga y verifica.
8. Error sanitizado al frontend.
9. Alertas por certificado proximo a vencer y proveedor degradado.
10. Runbook de revocacion y recuperacion.

