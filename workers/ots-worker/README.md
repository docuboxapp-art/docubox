# OpenTimestamps worker

Este contenedor reutiliza el mismo contrato HTTP del provider que ejecuta Vercel. Aloja el cliente
oficial `opentimestamps-client`, expone únicamente operaciones autenticadas y dispara las rutas de
negocio de Docubox; no contiene lógica de documentos, estados ni acceso directo a Supabase.

## Construcción

```bash
docker build -f workers/ots-worker/Dockerfile -t docubox-ots-worker .
```

## Configuración

- `OTS_WORKER_SECRET`: secreto compartido con Docubox.
- `DOCUBOX_APP_URL`: URL de la aplicación que recibe los triggers protegidos.
- `OPENTIMESTAMPS_CALENDARS`: allowlist separada por comas.
- `OPENTIMESTAMPS_TIMEOUT_MS`: timeout por operación.
- `OTS_STAMP_INTERVAL_SECONDS`: mínimo 60; predeterminado 300.
- `OTS_UPGRADE_INTERVAL_SECONDS`: mínimo 1800; predeterminado 3600.
- `BITCOIN_RPC_URL`: opcional; sólo para verificación real mediante Bitcoin Core sin wallet.

En Hostinger, configure `OPENTIMESTAMPS_WORKER_URL` en Docubox con la URL privada de este
contenedor y `OPENTIMESTAMPS_PROVIDER=HTTP`. Sustituir Vercel Cron por el scheduler del contenedor
no cambia el manifiesto, los repositorios, los estados ni los servicios TypeScript.
