# Arquitectura

## Componentes existentes reutilizados

- `AuthContext` y Supabase Auth para sesion.
- `WorkspaceContext` y `workspace_members` para aislamiento tenant.
- `contacts` para seleccionar partes sin duplicarlas.
- `documentos`, `/crear-documento` y `/firmar-documento` como motores documentales y de firma.
- Motor de certificacion para SHA-256, TSA, NOM-151, constancias y verificacion.
- Sistema de notificaciones para invitaciones y vencimientos.

## Limites del modulo

`credit_titles` conserva identidad, estado, saldo, tenedor y referencias. `promissory_notes` conserva terminos propios del pagare. `title_registry` fija el snapshot emitido. `title_events` conserva evidencia encadenada.

Las escrituras criticas pasan por API o funciones SQL con service role. El navegador tiene lectura RLS del nucleo y no puede emitir ni alterar el ledger directamente.

## Gaps deliberados

- El motor financiero complejo no forma parte de Fase 1.
- Endosos, pagos, avales y carga masiva se habilitan por fases.
- TSA, NOM-151 y KMS nunca se simulan como validos. En desarrollo se etiquetan `sandbox` o `not_configured`.
