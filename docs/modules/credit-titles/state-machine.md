# Maquina de estados

Transiciones principales:

```text
DRAFT -> PREPARING | AWAITING_SIGNATURE | VOIDED
PREPARING -> DRAFT | AWAITING_SIGNATURE | VOIDED
AWAITING_SIGNATURE -> SIGNED | CANCELLED | VOIDED
SIGNED -> ISSUED | VOIDED
ISSUED -> ACTIVE
ACTIVE -> PARTIALLY_PAID | OVERDUE | PAID | CANCELLED
PARTIALLY_PAID -> OVERDUE | PAID | CANCELLED
OVERDUE -> PARTIALLY_PAID | PAID | CANCELLED
PAID -> CANCELLED
```

La base de datos rechaza transiciones fuera de esta lista. Los estados complementarios `ENDORSED`, `COLLATERALIZED`, `IN_COLLECTION` y `DISPUTED` se representan como flags o eventos para no romper el estado principal.
