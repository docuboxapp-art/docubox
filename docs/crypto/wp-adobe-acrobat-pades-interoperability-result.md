# WP Adobe Acrobat PAdES Interoperability

Fecha de ejecucion: 2026-09-01

## Resultado

`ADOBE ACROBAT PADES-B-T INTEROPERABILITY VERIFIED`

Artefacto verificado:

`output/pdf/acrobat-interoperability-pades-bt.pdf`

SHA-256:

`3fab22849f44fe31253880c882f5e5df140e1760ccbd014d4cb1a000b782b35c`

## Causas

Se encontraron dos incompatibilidades independientes en el generador existente:

1. `ByteRange` contenia tres nombres PDF con prefijo `/` en lugar de cuatro numeros directos. El verificador interno eliminaba silenciosamente ese prefijo antes de convertir los valores a numero. Acrobat llegaba al campo de firma y producia `Expected a number object`.
2. El CMS usaba `ETSI.CAdES.detached`, pero `SignerInfo.signedAttrs` estaba ausente. La firma CMS directa era aceptada por OpenSSL y pdfsig, pero no constituia la base CAdES-B-B requerida por ese SubFilter. Acrobat devolvia estado de firma invalida.

No se modificaron Google Cloud HSM, la llave, el certificado X.509, FreeTSA, el router TSA ni NOM-151.

## Objeto PDF afectado

El campo `Signature1` referencia un widget invisible valido:

- `/FT /Sig`
- `/Subtype /Widget`
- `/Rect [ 0 0 0 0 ]`
- `/P` referencia una pagina existente
- `/V` referencia el diccionario de firma

Diccionario final:

```text
/Type /Sig
/Filter /Adobe.PPKLite
/SubFilter /ETSI.CAdES.detached
/ByteRange [ 0  0000001625  0000025627  0000000919 ]
/Contents <...>
```

## ByteRange antes y despues

Antes:

```text
/ByteRange [ 0 /0000035311 /0000059313 /0000001377 ]
```

Los tres valores con `/` eran objetos `Name`, no objetos `Number`.

Despues:

```text
/ByteRange [ 0  0000001625  0000025627  0000000919 ]
```

El generador sustituye el `/` del placeholder por whitespace del mismo ancho. Asi conserva todos los offsets y emite numeros directos. El parser interno ahora rechaza cualquier token que no cumpla `^[0-9]+$`.

Validacion final:

- cuatro numeros directos: PASS
- inicio del segundo rango igual al byte posterior a `>` de Contents: PASS
- segundo rango dentro del archivo: PASS
- fin del segundo rango igual al tamano del archivo: PASS

## COS, xref y revisiones

- `/Rect`, `/BBox` y `/MediaBox`: arrays numericos validos
- `/Length`: valores numericos validos
- xref offsets: validos
- `startxref`: uno y valido
- `/Prev`: ausente
- object generations: validas
- object streams: deshabilitados para el PDF firmado

El artefacto no usa una cadena de actualizaciones incrementales. El B-B se genera con una reserva fija de Contents; B-T sustituye unicamente bytes dentro de esa reserva excluida por ByteRange. No cambia offsets, xref ni trailer.

## Contents y CMS

- reserva hexadecimal: 24,000 caracteres
- longitud hexadecimal par: PASS
- delimitadores `<` y `>`: PASS
- CMS DER real: obtenido por longitud ASN.1, sin eliminar ceros validos
- padding restante: ceros dentro de la reserva

El CMS final contiene los atributos firmados CAdES-B-B:

- `contentType` - `1.2.840.113549.1.9.3`
- `messageDigest` - `1.2.840.113549.1.9.4`
- `signingTime` - `1.2.840.113549.1.9.5`
- `SigningCertificateV2` - `1.2.840.113549.1.9.16.2.47`

`SigningCertificateV2` contiene SHA-256 del certificado X.509 exacto usado por el firmante. La llave HSM firma la codificacion DER de `signedAttrs`; la llave privada no sale del HSM.

## SignatureTimeStamp RFC 3161

El `SignerInfo` correcto contiene en `unsignedAttrs`:

`id-aa-signatureTimeStampToken = 1.2.840.113549.1.9.16.2.14`

Evidencia final:

- proveedor: FreeTSA
- policy OID: `1.2.3.4.1`
- `genTime`: `2026-09-01T23:25:27.000Z`
- `SHA-256(signatureValue) == messageImprint`: PASS
- CMS del TimeStampToken: PASS
- certificado y cadena FreeTSA contra el trust bundle versionado: PASS

El imprint no usa hash del PDF, ByteRange ni CMS completo.

## Validadores

### qpdf 12.4.1

`qpdf --check`: PASS. Sin errores de sintaxis ni codificacion de streams.

### pdfinfo

PDF 1.7, una pagina, AcroForm presente, no cifrado y parseable.

### pdfsig

- `Signature Field Name: Signature1`
- `Signing Hash Algorithm: SHA-256`
- `Signature Type: ETSI.CAdES.detached`
- `Total document signed`
- `Signature Validation: Signature is Valid`
- `Certificate issuer is unknown`

El warning de NSS local no afecto el parseo ni la validacion de la firma. La CA privada no esta instalada en el almacen de confianza de pdfsig.

### OpenSSL

- CMS detached del documento: PASS
- contenido recuperado igual a los rangos firmados: PASS
- CMS y cadena del TimeStampToken FreeTSA: PASS
- alteracion de un byte: FAIL, esperado

### Adobe Acrobat DC

La validacion se ejecuto contra el motor instalado de Acrobat mediante `AcroExch.PDDoc` y su API JavaScript:

- apertura del PDDoc: PASS
- acceso a `Signature1`: PASS
- acceso a `signatureInfo`: PASS
- `signatureValidate = 3`
- `docValidity = kDSSigValTrue`
- `idPrivValidity = kIdUntrustedRoot`
- handler: `Adobe.PPKLite`
- SubFilter: `ETSI.CAdES.detached`
- digest: `SHA256`
- revisiones: `1/1`
- error `Expected a number object`: no reproducido

Adobe documenta el estado `3` como firma del documento valida cuya identidad no pudo verificarse. Es el resultado esperado para el certificado privado actual. No se agrego confianza artificial ni se cambio el certificado.

`dateTrusted=false` se conserva porque el trust store local de Acrobat no confia automaticamente en las raices privadas. Esto es independiente de la presencia y validez criptografica del SignatureTimeStamp RFC 3161.

## Regresion

- pruebas PAdES: 6/6 PASS
- suite completa: 196/196 PASS
- typecheck: PASS
- lint dirigido del motor y runner: PASS
- lint funcional del test PAdES, sin la regla de formato historica del archivo: PASS
- build: PASS
- qpdf: PASS
- pdfsig: PASS
- OpenSSL CMS: PASS
- OpenSSL RFC 3161: PASS
- tamper test: PASS

## Archivos

- `src/lib/certification/pades.ts`
- `tests/pades-provider.test.mjs`
- `scripts/test-adobe-acrobat-pades-interoperability.ts`
- `output/pdf/acrobat-interoperability-pades-bt.pdf`
- `docs/crypto/wp-adobe-acrobat-pades-interoperability-result.md`
