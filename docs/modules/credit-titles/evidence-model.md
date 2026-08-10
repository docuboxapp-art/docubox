# Modelo de evidencia

Cada evento registra:

- ID y secuencia dentro del titulo.
- Tipo de evento y actor.
- Fecha UTC.
- Hash del payload canonico.
- Hash del evento anterior.
- Hash del evento actual.
- IP, user agent y metadatos cuando aplican.

Formula:

```text
payload_hash = SHA256(canonical_event_payload)
event_hash = SHA256(previous_event_hash + payload_hash)
```

El primer evento usa `GENESIS`. Las correcciones se agregan como eventos nuevos. Nunca se sobrescribe historia.

Eventos iniciales: `TITLE_CREATED`, `SIGNATURE_REQUESTED`, `IDENTITY_VERIFIED`, `TITLE_SIGNED`, `TITLE_ISSUED`, `DOCUMENT_VIEWED`, `DOCUMENT_DOWNLOADED` y `VERIFICATION_PERFORMED`.
