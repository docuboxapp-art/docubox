# Seguridad

- Todas las entidades incluyen `workspace_id` y aplican RLS.
- El `workspace_id` se verifica contra la sesion; no se confia en el frontend.
- Folio, UUID, importe, moneda, vencimiento y datos canonicos son inmutables despues de emitir.
- El portal publico usa token aleatorio de 256 bits y enmascara partes.
- El ledger y el registro de emision son append-only.
- Emision usa bloqueo de fila e idempotency key.
- `.key`, contrasenas y llaves privadas nunca se persisten.
- Storage de PDFs y evidencias debe permanecer privado con URLs firmadas temporales.

Los permisos granulares previstos son `credit_titles.view`, `create`, `edit`, `issue`, `endorse`, `register_payment`, `cancel`, `export`, `manage_templates` y `manage_portfolios`.
