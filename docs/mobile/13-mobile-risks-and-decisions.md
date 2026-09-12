# Riesgos y decisiones

## Registro de decisiones

| ID | Decision | Estado | Razon | Source files | Confidence |
|---|---|---|---|---|---|
| ADR-M01 | React Native + Expo + TS + Expo Router | RECOMMENDED | afinidad tecnica y deep links/rutas nativas | `package.json`, `src/app` | HIGH |
| ADR-M02 | One backend, multiple clients | REQUIRED | evita duplicar permisos/crypto/datos | `src/app/api`, `src/lib`, `supabase` | HIGH |
| ADR-M03 | Repo Mobile separado inicialmente | RECOMMENDED | reduce riesgo sobre raiz web/Vercel y desacopla releases | estructura actual, `.vercel/project.json` | HIGH |
| ADR-M04 | Contratos privados versionados | REQUIRED | evita drift sin compartir Node/DOM | schemas/tipos dispersos | HIGH |
| ADR-M05 | Route Handlers como BFF movil | RECOMMENDED | centraliza auth y privileged services | `src/app/api`, `src/lib/supabase/server.ts` | HIGH |
| ADR-M06 | SecureStore para sesion; no AsyncStorage secreto | REQUIRED | Keychain/Keystore | auth actual + docs Expo | HIGH |
| ADR-M07 | LucIA con authorized retrieval antes del LLM | REQUIRED | aislamiento tenant/documento | `src/lib/ai/luciaAuthorization.ts` | HIGH |
| ADR-M08 | No cache permanente de PDF descifrado | REQUIRED | reduce fuga local | `src/lib/crypto/document-encryption` | HIGH |
| ADR-M09 | Lucide React Native como iconografia principal | RECOMMENDED | Lucide domina web | `package.json`, usos en `src` | HIGH |

## Riesgos tecnicos

| Riesgo | Prob. | Impacto | Mitigacion | Bloquea MVP |
|---|---|---|---|---|
| APIs mezclan cookies/Bearer y DTO web | HIGH | HIGH | API inventory, contracts, auth tests | YES |
| Visor PDF nativo no cubre seleccion/licencia/rendimiento | MEDIUM | HIGH | spike comparativo en dispositivos | YES |
| Firma autografa cambia geometria al rotar | MEDIUM | HIGH | puntos normalizados + golden tests | YES para autografa |
| e.firma maneja archivos/password sensibles | HIGH | HIGH | threat model, memoria efimera, cero persistencia | YES para e.firma |
| Conversion Office depende de cuota/proveedor | MEDIUM | MEDIUM | estados/retry-after, no retries agresivos | NO, con UX |
| Contratos/document status historicos inconsistentes | HIGH | MEDIUM | enums canonicos + adapters server-side | YES |
| Repo separado deriva visual/domain | MEDIUM | MEDIUM | package versionado + visual regression | NO |
| Push introduce otro canal sensible | MEDIUM | MEDIUM | postergar proveedor, payload minimo | NO |

## Riesgos de seguridad

| Riesgo | Impacto | Mitigacion | Estado |
|---|---|---|---|
| IDOR/cross-tenant por documentId | CRITICAL | reautorizar cada request, negative tests | OPEN GATE |
| LucIA recupera documentos fuera del alcance | CRITICAL | retrieval DB-side autorizado, evidence IDs | OPEN GATE |
| Service Role/KMS en bundle | CRITICAL | CI secret scan y arquitectura server-only | PREVENTED BY DESIGN |
| Sesion/token en storage o logs inseguros | HIGH | SecureStore + redaction + short-lived access | OPEN GATE |
| PDF descifrado queda en cache/share | HIGH | TTL/cleanup/excluir backup/consentimiento | OPEN GATE |
| Mutacion o firma repetida | HIGH | idempotency key + expected version | OPEN GATE |
| Cuatro tablas de seguridad sin RLS | HIGH defense-in-depth | habilitar RLS y probar grants/funciones | OPEN GATE |
| Deep link replay/token leak | HIGH | one-time tokens, expiracion y universal links | OPEN GATE |

## Inconsistencias a no perpetuar

- Sidebars/rutas estaticas web no son fuente canonica de IA.
- Multiples librerias de toast y estilos de botones no forman un sistema movil.
- Radius grandes y override de 8px del rail son excepciones, no tokens.
- `app_logo.png` no corresponde a la marca canonica observada.
- Aliases de estados no deben filtrarse al cliente como taxonomia nueva.

## What Codex needs before starting Mobile implementation

1. Bundle ID iOS y package name Android definitivos.
2. Acceso/aprobacion de cuentas Apple Developer, Google Play y EAS; no se necesitan secretos en el prompt.
3. Archivo maestro vectorial y licencia/archivos de Google Sans aprobados por marca.
4. Decision legal/producto sobre descarga explicita, share sheet, screenshots y retencion local.
5. Aprobacion del alcance de firmas del MVP: autografa, Click & Sign y e.firma pueden liberarse por etapas.
6. Decision del SDK/estrategia PDF despues del spike y revision de licencia.
7. Owner para cerrar hallazgos RLS y aprobar threat model.
8. Dataset de evaluacion LucIA desidentificado y criterios de calidad/alucinacion.

No hace falta pedir decisiones sobre stack, backend, paleta, logo canonico, navegacion base ni principio de autorizacion: el repositorio ya permite resolverlas.

