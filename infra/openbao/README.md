# OpenBao Transit for Docubox development

This directory is a persistent, local-only development baseline for the
`OpenBaoTransitProvider`. It is not a production HSM and its keys have the
`software` protection level.

## Bootstrap

1. Start the service with `docker compose -f infra/openbao/docker-compose.yml up -d`.
2. Initialize and unseal OpenBao with the `bao` CLI. Store recovery and unseal
   material in an infrastructure secret manager, never in this repository.
3. Enable Transit and create two non-exportable RSA keys:

   ```sh
   bao secrets enable transit
   bao write -f transit/keys/docubox-development-document type=rsa-3072 exportable=false
   bao write -f transit/keys/docubox-development-evidence type=rsa-3072 exportable=false
   ```

4. Load `policies/docubox-certification.hcl`, create a dedicated AppRole, and
   assign only that runtime policy. Keep the generated Role ID and Secret ID in
   backend-only deployment secrets.
5. Configure the backend with `OPENBAO_ADDR`, `OPENBAO_TRANSIT_MOUNT`,
   `OPENBAO_TRANSIT_DOCUMENT_KEY`, `OPENBAO_TRANSIT_EVIDENCE_KEY`,
   `OPENBAO_ROLE_ID`, and `OPENBAO_SECRET_ID`. Do not expose any of them with a
   `NEXT_PUBLIC_` prefix.

The compose listener is bound to `127.0.0.1`. A remote environment must use
TLS, restricted networking, persistent storage, monitored UTC/NTP time, and
short-lived workload authentication. Rotation is performed with
`bao transit rotate` and is observed through the returned key version.
