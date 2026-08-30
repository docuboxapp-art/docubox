# Runner E2E del ciclo criptográfico

## Estado

`IMPLEMENTED_PENDING_PRODUCTION_E2E`

La ruta temporal backend-only está implementada en:

`src/app/api/internal/security/crypto-lifecycle-e2e/route.ts`

La consola administrativa temporal que sirve como disparador autenticado es:

`/admin/security/crypto-e2e`

Permanece deshabilitada por defecto con:

`CRYPTO_LIFECYCLE_E2E_ENABLED=false`

La implementación no modifica los motores AES-256-GCM, KMS, X.509, CMS,
PAdES, TSA, NOM-151 ni el esquema de cifrado documental.

## Controles

- Solo acepta `POST`.
- Requiere `Origin` y `Referer` del mismo origen permitido.
- Requiere una sesión Bearer válida.
- Requiere el indicador persistido `auth.users.is_super_admin=true`, resuelto
  exclusivamente en backend mediante `public.is_internal_super_admin`, una
  función ejecutable sólo por `service_role`. Los roles de tenant, propietarios
  de workspace, emails y metadatos editables no autorizan el runner.
- La pertenencia activa a un workspace se usa únicamente para aislar y auditar
  el artefacto E2E; no concede privilegios internos.
- Rechaza cuerpos con parámetros; el documento, workspace y proveedores se
  resuelven en servidor.
- Rechaza una segunda ejecución concurrente en la instancia del runner y
  aplica intervalo mínimo de reintento por usuario.
- Registra `CRYPTO_LIFECYCLE_E2E_MANUAL_TRIGGERED` y los eventos
  `CRYPTO_LIFECYCLE_E2E_STARTED`, `CRYPTO_LIFECYCLE_E2E_COMPLETED` o
  `CRYPTO_LIFECYCLE_E2E_FAILED` en `organization_audit_events`.

## Flujo ejecutado

1. Genera un PDF válido en memoria, sin contenido de cliente.
2. Crea un documento de prueba aislado en el workspace del operador y cifra
   la fuente con `encryptAndUploadDocumentObject`.
3. Descifra y compara bytes mediante `readDocumentStorageObject`.
4. Ejecuta `integratePadesFinalDocument` con `requiredLevel: 'B-T'`, que usa
   los proveedores productivos ya configurados y verifica antes de promover.
5. Ejecuta `issueNom151ForVerifiedPadesBt` con el provider Nubarium existente.
6. Genera las representaciones PDF de constancia general, auditoría y
   NOM-151, y las cifra como artefactos de evidencia.
7. Descifra y compara los artefactos; la respuesta solo contiene hashes,
   estados, folios, fingerprints e identificadores no sensibles.

Los artefactos E2E se conservan asociados al `run_id` para permitir auditoría
posterior. No se eliminan automáticamente porque la certificación y la
bitácora tienen restricciones de inmutabilidad y referencias históricas.

## Habilitación temporal en Production

1. Configurar el flag y una autorización explícita con el gestor de variables
   de Vercel. No usar `vercel env pull` ni copiar secretos al repositorio.
2. Ejecutar el `POST` desde una sesión autenticada del operador autorizado.
3. Validar la respuesta `status=PRODUCTION_VERIFIED`, junto con PAdES-B-T,
   NOM-151 verificado y las tres constancias cifradas.
4. Revisar el evento de auditoría de inicio y cierre.
5. Deshabilitar inmediatamente `CRYPTO_LIFECYCLE_E2E_ENABLED` y verificar que
   la ruta y `/admin/security/crypto-e2e` devuelven `404`.

Mientras no se complete ese procedimiento, el estado correcto es
`IMPLEMENTED_PENDING_PRODUCTION_E2E`; no se debe presentar
`PRODUCTION_VERIFIED`, `FULLY_ENCRYPTED` ni un PASS de NOM-151 productivo por
la sola existencia del runner.
