# Titulos de Credito Digitales

Modulo extensible de Docubox cuyo primer instrumento es el Pagare Electronico.

## Regla de producto

El registro electronico es la fuente de verdad. El PDF es una representacion verificable del registro y nunca su unica existencia.

## Fase 1

- Alta como modulo activable en App Market.
- Dashboard y listado de pagares.
- Wizard de siete pasos.
- Registro estructurado por workspace.
- Maquina de estados protegida en base de datos.
- Emision transaccional e idempotente.
- Ledger de eventos append-only.
- Ficha del titulo y portal publico por token aleatorio.
- Base para carteras, plantillas y operaciones posteriores.

## Reutilizacion

El modulo consume autenticacion, workspaces, contactos, documentos, firma, identidad, certificacion, almacenamiento y notificaciones existentes. No mantiene un segundo motor de firma ni almacena llaves privadas.

## Rutas

- `/credit-titles`
- `/credit-titles/promissory-notes`
- `/credit-titles/promissory-notes/new`
- `/credit-titles/promissory-notes/[id]`
- `/verify/promissory-note/[public_token]`
