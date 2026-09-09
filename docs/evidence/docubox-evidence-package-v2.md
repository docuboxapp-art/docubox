# Docubox Evidence Package v2

## Alcance

Evidence Package v2 es un paquete de evidencia cerrado y versionado. El PDF final sigue siendo el documento juridico principal; el XML describe la identidad del PDF, la secuencia probatoria, los actos de firma y los artefactos de certificacion disponibles. No contiene una copia del PDF.

El namespace es `https://docubox.com.mx/schema/evidence/v2`, con `version="2.0"` y `schemaVersion="2.0"`. El XSD se distribuye en `src/lib/evidence-v2/schema/docubox-evidence-v2.xsd`. El generador lo valida con libxml2/WASM antes de almacenar el XML; una validacion estructural defensiva adicional rechaza DTD y entidades.

## Canonicalizacion e integridad

Los objetos internos se canonicalizan con RFC 8785, Unicode NFC y UTF-8. Ninguna fecha local ni formato regional participa en los digests.

La cadena usa el algoritmo `docubox-evidence-chain-v1`:

```text
genesis = SHA-256(JCS({ schema, document_id, document_version_id }))
event_hash = SHA-256(JCS(event))
chained_hash = SHA-256(UTF8("docubox-evidence-chain-v1\\0") || hex(previous_hash) || hex(event_hash))
root_hash = ultimo chained_hash, o genesis si no hay eventos
```

`EvidencePackageDigest` es SHA-256 del nucleo semantico `docubox-evidence-root-v1`. `HashXML` es SHA-256 del XML renderizado con el contenido de `HashXML` vacio; por ello protege cada bloque, incluida una firma Docubox adjunta, sin una dependencia circular.

## Mecanismos reales y estados

- SHA-256, la cadena de evidencia y el digest XML se generan localmente y son verificables.
- La firma Docubox usa una firma asimetrica ya existente de KMS/HSM cuando `DOCUBOX_EVIDENCE_V2_KMS_SIGNING_ENABLED=true` y la comprobacion del proveedor es satisfactoria. Nunca se usa HMAC como evidencia publica v2.
- XMLDSig no se declara ni se simula en v2.
- PAdES, RFC 3161, OpenTimestamps y NOM-151 solo se incluyen si existen registros y artefactos reales. El verificador vuelve a validar cada artefacto con su motor correspondiente; sus estados `pending`, `unavailable` y `not_applicable` nunca se convierten en `valid`.
- Una firma autografa incluye hashes de trazo e imagen cuando fueron capturados. Ambos archivos se anexan al ZIP y se comparan con las huellas inmutables del XML. No se presenta como certificado X.509.
- Una e.firma SAT genera un paquete privado `docubox-efirma-evidence-bundle-v1` con el payload firmado, la firma, el certificado publico y el resultado de validacion ocurrido al firmar. El verificador comprueba nuevamente hashes, vigencia del certificado y firma RSA. El paquete nunca contiene la clave privada ni su contrasena.

## Privacidad y almacenamiento

El paquete usa referencias internas para participantes y actores. El generador no incorpora correo, IP, GPS, tokens de sesion, contrasenas ni claves privadas. La ubicacion, IP y datos extendidos permanecen en la evidencia privada existente, accesible solo con autorizacion.

Los XML v2 se guardan en el bucket privado `evidence-v2-artifacts`, con una ruta que contiene el identificador inmutable del paquete. No se utiliza `upsert` y los clientes no tienen acceso directo al bucket: las descargas pasan por el API autorizado. La tabla `evidence_packages` bloquea la modificacion o eliminacion de paquetes cerrados; los artefactos posteriores se agregan como referencias inmutables separadas.

Los metadatos administrativos se entregan, cuando se solicitan, como un Management Snapshot independiente con `affectsDocumentIntegrity=false`. No se insertan en el XML cerrado y modificarlos no cambia ningun digest probatorio.

## Cierre y verificacion

El flujo `seal-signatures` genera v2 automaticamente despues de verificar PAdES-B-T, emitir y verificar NOM-151 y crear el registro OpenTimestamps. La operacion es idempotente por documento/version; una repeticion sincroniza referencias de artefactos sin reemplazar el XML.

La descarga autorizada ofrece el XML o un ZIP con `evidence.xml`, `manifest.json`, PDF final y todos los artefactos referenciados. Si falta un archivo declarado, la descarga falla de forma explicita en vez de producir un paquete incompleto. El verificador reutilizable recibe PDF + XML + artefactos, recalcula SHA-256, valida XSD, cadena, RootHash, firma KMS, PAdES, e.firma y huellas del manifiesto. Tambien acepta la carga independiente de un ZIP o de PDF + XML para verificacion fuera de la cuenta.

El endpoint publico por token opaco vuelve a leer el PDF/XML privados y publica solamente folio, hashes, estados, cantidades y metadatos no sensibles. No concede acceso a archivos, rutas de Storage, nombres de participantes, correos, IP ni geolocalizacion. La pantalla publica usa el mismo resultado del verificador reutilizable y presenta cada mecanismo por separado.

## Activacion

`DOCUBOX_EVIDENCE_V2_ENABLED=false` es el valor seguro inicial. `DOCUBOX_EVIDENCE_V2_KMS_SIGNING_ENABLED=false` mantiene separada la activacion del sello asimetrico. El generador v2 no sustituye ni regenera XML v1. La activacion requiere que ambas migraciones v2 esten aplicadas, que el bucket privado exista, que `sign-efirma` este desplegada y que se complete la lista operativa descrita en la guia de migracion.
