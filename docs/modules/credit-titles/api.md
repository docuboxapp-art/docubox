# API

## Implementada en Fase 1

- `GET /api/credit-titles?workspaceId=...`
- `POST /api/credit-titles`
- `GET /api/credit-titles/:id`
- `POST /api/credit-titles/:id/issue`
- `GET /api/credit-titles/verify/:public_token`

La emision exige `Idempotency-Key`. El servicio llama `issue_promissory_note`, que bloquea la fila, valida estado y membresia, fija folio y hash, crea el registro y agrega evidencia en una sola transaccion.

## Planeada

- `POST /api/v1/promissory-notes/:id/send`
- `POST /api/v1/promissory-notes/:id/payments`
- `POST /api/v1/promissory-notes/:id/endorsements`
- `POST /api/v1/promissory-notes/:id/cancel`
- `GET /api/v1/promissory-notes/:id/events`
