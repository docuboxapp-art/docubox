# WP PDF Font Embedding - Acrobat Appearance Integrity

Fecha de ejecución: 2026-09-01

## Alcance

La corrección se limita a la generación visual previa a PAdES. No se modificaron Google Cloud HSM, `KeyManagementProvider`, X.509, CMS, ByteRange, PAdES-B-B, PAdES-B-T, TSA ni NOM-151.

Pipeline validado:

```text
PDF visual con fuentes embebidas
-> auditoría de fuentes
-> PAdES-B-B
-> PAdES-B-T
-> verificación interna e independiente
```

## Causa

El renderizador visual server-side `src/lib/signatures/pdf-stamp.ts` y los elementos visibles de certificación en `src/lib/certification/pdf.ts` utilizaban las fuentes base Type 1 de `pdf-lib`:

- `Helvetica`
- `Helvetica-Bold`
- `Courier`

Esas fuentes llegaban al PDF como referencias no embebidas. El archivo dependía de sustitución por parte del visor y Acrobat emitía el código 2013: el aspecto del texto podía cambiar silenciosamente.

No se dependía de una fuente web concreta. El problema era precisamente el uso de las fuentes estándar PDF sin archivo de fuente incrustado.

## Solución

Se añadió un cargador server-side único en `src/lib/pdf/embedded-fonts.ts` que registra `@pdf-lib/fontkit` y carga explícitamente:

- Inter Regular 400
- Inter Bold 700
- Roboto Mono Regular 400

Los binarios viven en `infra/pdf/fonts`, están versionados junto con sus licencias SIL Open Font License 1.1 y se incluyen en el file tracing de Next.js/Vercel. No se consulta Google Fonts, el sistema operativo ni las fuentes instaladas en el host.

Cada fuente se guarda como subconjunto CID TrueType, con `ToUnicode`, antes de preparar el placeholder PAdES. El documento no se modifica después de PAdES-B-B/PAdES-B-T.

## pdffonts antes

| Etapa | Fuente | Tipo | Embedded | Subset | Unicode |
| --- | --- | --- | --- | --- | --- |
| Visual | Helvetica | Type 1 | no | no | no |
| Visual | Helvetica-Bold | Type 1 | no | no | no |
| PAdES-B-B | Helvetica / Helvetica-Bold / Courier | Type 1 | no | no | no |
| PAdES-B-T | Helvetica / Helvetica-Bold / Courier | Type 1 | no | no | no |

## pdffonts después

Los tres artefactos auditados muestran la misma matriz:

| Etapa | Fuente | Tipo | Embedded | Subset | Unicode |
| --- | --- | --- | --- | --- | --- |
| Visual | DBXREG+Inter-Regular | CID TrueType | yes | yes | yes |
| Visual | DBXBOL+Inter-Bold | CID TrueType | yes | yes | yes |
| PAdES-B-B | DBXREG+Inter-Regular | CID TrueType | yes | yes | yes |
| PAdES-B-B | DBXBOL+Inter-Bold | CID TrueType | yes | yes | yes |
| PAdES-B-T | DBXREG+Inter-Regular | CID TrueType | yes | yes | yes |
| PAdES-B-T | DBXBOL+Inter-Bold | CID TrueType | yes | yes | yes |

Resultado: `ALL REQUIRED FONTS EMBEDDED`.

## Validación independiente

- `qpdf --check` en visual, B-B y B-T: PASS; sin errores de sintaxis ni codificación de streams.
- `pdfsig`: `Signature1`, SHA-256, `ETSI.CAdES.detached`, documento completo y `Signature is Valid`.
- `pdfsig` mantiene `Certificate issuer is unknown` porque la CA privada no está instalada en el NSS local; esto no invalida la firma criptográfica.
- OpenSSL `cms -verify -binary -noverify`: PASS.
- Atributos CMS: `contentType`, `messageDigest`, `signingTime`, `SigningCertificateV2` y `id-aa-signatureTimeStampToken`: presentes.
- Verificación PAdES interna: PASS.
- Verificación independiente Docubox: PASS.
- Alteración de un byte: rechazada, PASS.
- Render Poppler a 144 DPI: sin sustituciones visibles, recortes, superposiciones ni glifos faltantes.

Artefacto PAdES-B-T:

`output/pdf/acrobat-font-embedded-pades-bt.pdf`

SHA-256:

`3b96472ba45f59926ce15fed6a506ac9c1b1210f8be7a12e2a606af17e442262`

## Prueba automática

`tests/pdf-font-embedding.test.mjs` genera e inspecciona un PDF con texto Unicode. Exige para cada fuente:

- `embedded=true`
- `subset=true`
- `unicode=true`

Si una fuente no está embebida, el validador lanza exactamente `PDF_FONT_NOT_EMBEDDED`.

## Regresión

- prueba de fuentes: 1/1 PASS
- pruebas dirigidas PAdES, firma visual y fuentes: 20/20 PASS
- suite completa: 200/200 PASS
- type-check: PASS
- lint dirigido: PASS
- build de producción: PASS
- `git diff --check`: PASS

El build conserva dos warnings preexistentes de Next.js sobre la convención `middleware` y una API de Node detectada en un import de Edge Runtime. No corresponden al generador PDF ni afectan el artefacto validado.

## Acrobat

El documento abre correctamente mediante el motor `AcroExch.PDDoc`. La validación manual del panel **Informe de integridad del aspecto** debe confirmar que el código 2013 ya no aparece. No se alteraron preferencias ni almacenes de confianza de Acrobat para ocultar advertencias.

Estado de cierre automatizado:

`PDF FONT EMBEDDING AND PADES-B-T AUTOMATED VERIFICATION PASSED`

Estado de la comprobación visual específica de Acrobat:

`ADOBE ACROBAT APPEARANCE REPORT MANUAL CONFIRMATION PENDING`
