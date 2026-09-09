# Docubox Evidence Package v2

## Alcance

Evidence Package v2 es un paquete de evidencia cerrado y versionado. El PDF final sigue siendo el documento juridico principal; el XML describe la identidad del PDF, la secuencia probatoria, los actos de firma y los artefactos de certificacion disponibles. No contiene una copia del PDF.

El namespace es `https://docubox.com.mx/schema/evidence/v2`, con `version="2.0"` y `schemaVersion="2.0"`. El XSD se distribuye en `src/lib/evidence-v2/schema/docubox-evidence-v2.xsd`; el generador ejecuta el mismo perfil estructural obligatorio antes de almacenar el XML. Un verificador externo puede validar el XSD publicado junto con el XML.

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
- PAdES, RFC 3161, OpenTimestamps y NOM-151 solo se incluyen si existen registros y artefactos reales. Sus estados `pending`, `unavailable` y `not_applicable` no se convierten en `valid`.
- Una firma autografa incluye hashes de trazo e imagen cuando fueron capturados. No se presenta como certificado X.509.

## Privacidad y almacenamiento

El paquete usa referencias internas para participantes y actores. El generador no incorpora correo, IP, GPS, tokens de sesion, contrasenas ni claves privadas. La ubicacion, IP y datos extendidos permanecen en la evidencia privada existente, accesible solo con autorizacion.

Los XML v2 se guardan en el bucket privado `evidence-v2-artifacts`, con una ruta que contiene el identificador inmutable del paquete. No se utiliza `upsert` y los clientes no tienen acceso directo al bucket: las descargas pasan por el API autorizado. La tabla `evidence_packages` bloquea la modificacion o eliminacion de paquetes cerrados; los artefactos posteriores se agregan como referencias inmutables separadas.

## Activacion

`DOCUBOX_EVIDENCE_V2_ENABLED=false` es el valor seguro inicial. El generador v2 no sustituye ni regenera XML v1. La activacion requiere que la migracion este aplicada, que el bucket privado exista y que se complete la lista operativa descrita en la guia de migracion.
