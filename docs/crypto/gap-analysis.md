# Analisis de brechas

Fecha de corte: 2026-08-17

## Resumen ejecutivo

Docubox ya dispone de modelos, Storage privado, cadenas canonicas, un generador de constancia, un gateway PAdES y un producto comercial de certificacion. No debe reconstruirse esa base. Las brechas para produccion se concentran en identidad exacta de version, orquestacion durable, verificacion criptografica independiente, custodia de llaves y eliminacion de afirmaciones tecnicas no demostradas.

## CertificationOrchestrator

| Responsabilidad | Estado actual | Brecha concreta |
|---|---|---|
| Confirmar conclusion | `createCertification()` exige `documentos.estado = completado` | No consolida firmas, participantes, jobs y bloqueos pendientes |
| Obtener version definitiva | Existe `document_versions` | `engine.ts:259,279` fija version 1; `document_certifications` no tiene FK a `document_versions` |
| Bloquear modificaciones | Trigger bloquea versiones congeladas | El motor no congela/reclama la fila exacta ni inmoviliza el objeto Storage antes del hash |
| Hash previo | `sha256Hex()` | Falta comparar BD, bytes descargados y version Storage en un mismo checkpoint |
| Recuperar evidencia | Lee fuentes existentes | Falta normalizador versionado y mapa de procedencia completo |
| Cadenas canonicas | Implementadas en `src/lib/certification` | `src/lib/certifica/stableStringify()` duplica y no acredita RFC 8785 |
| Constancia tecnica | Implementada con `pdf-lib` | Debe recibir solo resultados verificados, no banderas declarativas |
| Firma de cadenas | Gateway KMS + verificacion RSA-PSS | Contrato `DIGEST` frente a verificacion de mensaje ambiguo |
| Timestamp | Gateway TSA | No se parsea/valida localmente ASN.1/CMS, imprint, nonce, EKU, policy ni cadena |
| PAdES | Gateway y pyHanko heredado | No existe verificador independiente obligatorio tras la firma |
| Hash final | Implementado | Falta bind a `document_version_id` y objeto Storage inmutable |
| Persistencia | Varias tablas y buckets privados | No hay commit atomico entre BD y Storage ni reconciliador |
| Auditoria | Transiciones y eventos | Escrituras de estado/evento no son atomicas; el append de Certifica tiene carrera |
| Estado final | `COMPLETED`/`validated` | Existen dos semanticas de estado que pueden confundirse |

## Versionado e inmutabilidad

`document_versions` cubre la estructura requerida y debe extenderse, no recrearse. Brechas:

- Su `status` no incluye explicitamente `certified`; puede representarse con metadata a corto plazo, pero conviene un estado compatible o una tabla de cierre.
- La politica de lectura depende de Colabora, por lo que usuarios con derecho a certificar pero sin el addon pueden no leer la version.
- `document_certifications.document_version` es un entero sin FK.
- `certification_cases.source_document_id` enlaza `documentos`, pero no `document_versions`.
- No hay constraint que garantice coincidencia entre `workspace_id`, `document_id` y la version vinculada.
- Storage no tiene una regla central de write-once por version cerrada.

## Idempotencia, concurrencia y recuperacion

- El motor tecnico consulta por documento/version antes de insertar; necesita claim atomico por `tenant_id + document_version_id + idempotency_key`.
- `uploadArtifact()` usa rutas deterministas y `upsert:false`; un fallo despues del upload puede bloquear el reintento.
- `CertificationOrchestrator` corre dentro de una solicitud HTTP y puede exceder limites de Vercel.
- `appendCertificationEvent()` consulta la ultima secuencia y despues inserta (`src/lib/certifica/server.ts:43-73`); dos escritores pueden calcular la misma secuencia.
- `submit/route.ts` realiza manifiesto, proveedor, evidencia, enlace, estado y evento en operaciones separadas (`:43-88`).
- No existen lease, checkpoint por etapa, outbox ni reconciliador de objetos.

Se requiere una saga durable con RPCs transaccionales cortas y proveedores idempotentes.

## KMS y certificados

- El adaptador moderno evita llaves privadas en Next.js y verifica RSA-PSS.
- El token de gateway es opcional.
- No existe `crypto_provider_configurations`; `psc_providers` no modela KMS/PAdES/TSA por tenant.
- `cryptographic_keys` es reutilizable para material publico y attestation.
- La huella de certificado se calcula sobre texto PEM (`adapters.ts:94`), no sobre DER.
- El VPS usa RSA-2048, certificado autofirmado y PEM sin passphrase; solo puede considerarse desarrollo.
- El firmador posee credencial Supabase de alto privilegio.

## PAdES

- `signPdfWithPades()` acepta `status`, `byte_range_valid` y un PDF Base64 del mismo gateway.
- No valida localmente ByteRange, digest CMS, certificado, EKU, cadena, timestamp ni perfil B-T.
- `seal-pdf` declara en codigo que no aplica PKCS#7/PAdES, pero su documento visible afirma PAdES, DigiCert RFC 3161 y Docubox CA.
- `sign-pdf-vps` usa pyHanko, pero la llave local y el acoplamiento a Supabase impiden considerarlo arquitectura objetivo.
- El analizador de Certifica solo reconoce marcadores PDF por regex; no es verificacion.

## RFC 3161 y NOM-151

- El motor confia en `token_signature_valid` y `tsa_certificate_valid` devueltos por el proveedor.
- Falta verificar token, `messageImprint`, nonce, policy OID, EKU `timeStamping`, cadena, vigencia y revocacion con un componente independiente.
- `timestamp_records` ya puede conservar artefactos; no hace falta otra tabla.
- NOM-151 y RFC 3161 deben seguir como productos/evidencias distintas.
- Coexisten `nom151_constancias` y `nom151_constancias_doc`; requieren adaptador y estrategia de retiro gradual.

## Docubox Certifica

El modulo comercial es util como capa de venta, autorizacion, declaracion, PSC y custodia. No debe marcar criptografia valida por si solo.

- `integrity` puede terminar `validated` con hash y manifiesto, sin sello institucional.
- `HttpPscCertificationProvider` verifica campos, no firmas ni artefactos.
- `legal_validity` se deriva de `provider_mode === production`, no del reporte criptografico.
- La consulta publica compara dos hashes almacenados, no re-hashea el archivo.
- El sandbox esta correctamente marcado no valido; debe conservarse asi.
- `existing_document_certification_id` es el punto de integracion correcto con el motor tecnico.

## Multi-tenant, RLS y funciones

- Las tablas criticas tienen RLS y politicas de lectura por documento/workspace.
- `document_versions` esta acoplada al entitlement de Colabora.
- `cryptographic_keys` expone material publico mediante politica `public SELECT`; debe confirmarse que la tabla nunca reciba metadata sensible y preferirse una vista publica minima.
- Las 24 Edge Functions tienen `verify_jwt=false`; algunas validan JWT o token interno manualmente, pero no existe garantia uniforme.
- Los asesores de Supabase reportan 65 funciones con `search_path` mutable y funciones `SECURITY DEFINER` ejecutables por `anon`/`authenticated`, incluidas funciones de acceso y verificacion documental.
- Hay politicas permisivas multiples en tablas relacionadas con documentos y sellos.

Referencias de remediacion: [search_path mutable](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [SECURITY DEFINER anon](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [SECURITY DEFINER authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [politicas permisivas multiples](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies).

## Observabilidad

Existen `correlation_id`, transiciones, accesos, eventos de caso y transacciones de proveedor. Faltan:

- `attempt_id`, etapa actual, lease y numero de intento;
- duracion y resultado por llamada externa;
- version del proveedor/verificador;
- clasificacion reintentable/no reintentable;
- health checks persistidos para KMS/TSA/PAdES;
- alertas de certificado/TSA/proveedor;
- redaccion central y trazas sin secretos.

## Veredicto

El sistema es una base avanzada de desarrollo, no una infraestructura certificadora productiva. La activacion debe permanecer fail-closed hasta que una version inmutable, una firma PAdES y una estampa RFC 3161 sean verificadas de manera independiente y asociadas por FK a los artefactos exactos.
