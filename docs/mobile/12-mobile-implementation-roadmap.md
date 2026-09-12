# Roadmap de implementacion Mobile

## Gate 0: contratos y seguridad

Duracion orientativa: 2-3 semanas.

- Crear repositorio Mobile y pipeline EAS separados, sin mover la web.
- Extraer paquete versionado de contratos isomorficos.
- Definir DTO de documento con `allowedActions` calculado server-side.
- Normalizar Bearer en endpoints MVP.
- Introducir cursores, idempotency keys y errores tipados.
- Cerrar/adjudicar hallazgos RLS y crear pruebas cross-tenant negativas.
- Definir bundle ID/package name, URL schemes y universal/app links.
- Confirmar archivos de fuente y maestro vectorial de marca.

Exit: contratos versionados, threat model aprobado y ninguna llave privilegiada en configuracion Mobile.

## Gate 1: spikes tecnicos

Duracion orientativa: 1-2 semanas, paralela parcialmente.

- Visor PDF: Range, rendimiento, 100+ paginas, seleccion, busqueda y cleanup.
- Firma: canvas/rotacion/coordenadas, Click & Sign y e.firma efimera.
- Auth: refresh/background/revocacion/TOTP/deep link.
- LucIA: streaming, cancelacion, citas y retrieval multi-documento autorizado.

Exit: decisiones ADR con pruebas en dispositivo real iOS/Android.

## Fase 1A: foundation

Duracion orientativa: 2-3 semanas.

- Expo Router, temas/tokens, componentes base, telemetria y manejo de errores.
- Auth, workspace, app lifecycle y SecureStore.
- Cliente API tipado y TanStack Query.
- Navegacion y deep link guard.

## Fase 1B: documentos read-first

Duracion orientativa: 3-4 semanas.

- Inicio, documentos, busqueda/filtros, detalle y participaciones.
- Visor, metadata, participantes, actividad, evidencia y descargas.
- Papelera/restauracion.
- Carga PDF/Office y conversion job.

## Fase 1C: firma

Duracion orientativa: 3-4 semanas.

- Paso de terminos/campos/firma basado en estados backend.
- Autografa, Click & Sign y e.firma conforme al spike.
- OTP/step-up, idempotencia, evidencia y salida segura.
- Pruebas de rotacion, reintento, revocacion y doble tap.

## Fase 1D: LucIA

Duracion orientativa: 3-4 semanas.

- Conversacion global y contextual.
- Resultados documentales con citas y CTA.
- Resumen/partes/fechas/montos/obligaciones con feature rollout.
- Busqueda multi-documento solo tras retrieval DB-side autorizado.

## Fase 1E: hardening y beta

Duracion orientativa: 2-3 semanas.

- QA accesibilidad, rendimiento, redes lentas y dispositivos reales.
- Pentest de auth/IDOR/deep links/storage local/LucIA tenant isolation.
- Politicas de privacidad, telemetry redaction y app store disclosures.
- Beta interna, rollout gradual y kill switches server-side.

## Dependencias

| Dependencia | Owner sugerido | Gate |
|---|---|---|
| API contracts + Bearer | Backend | 0 |
| RLS/security review | Security/DBA | 0 |
| Marca vectorial/font licenses | Brand/Product | 0 |
| PDF SDK decision | Mobile/Legal | 1 |
| e.firma mobile threat model | Security/Legal | 1 |
| EAS/Apple/Google credentials | Platform/Product | 1A |
| LucIA evaluation dataset | AI/Product/Legal | 1D |

## Estrategia de rollout

Feature flags server-side por capacidad, no solo por version de app. Primero read-only interno, luego carga, firma por metodo, LucIA contextual y finalmente multi-documento. Cada gate debe poder deshabilitarse sin publicar un binario nuevo.

Source files: arquitectura auditada y flags existentes en `src/lib/ai/documentIntelligenceFeature.ts`.  
Confidence: MEDIUM; estimaciones requieren equipo/capacidad definidos.

