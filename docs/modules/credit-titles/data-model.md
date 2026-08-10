# Modelo de datos

## Fase 1

- `credit_titles`: identidad comun, estado, importe, saldo, tenedor, hashes y version.
- `promissory_notes`: condiciones economicas y politicas de identidad/firma.
- `title_parties`: snapshots de suscriptor, beneficiario y aval.
- `title_registry`: snapshot inmutable de emision.
- `title_holder_history`: historial con un solo registro vigente por titulo.
- `title_events`: ledger append-only.
- `title_evidence`: referencias cifradas a evidencias.
- `title_templates`, `title_portfolios`, `portfolio_titles`: base extensible.
- `credit_title_idempotency`: control de reintentos criticos.

Los documentos y verificaciones se referencian por ID; no se duplican.
