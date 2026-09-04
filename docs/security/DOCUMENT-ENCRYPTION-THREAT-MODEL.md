# Document Encryption Threat Model

| Threat | Control | Residual risk |
| --- | --- | --- |
| Bucket copy or leaked signed URL | Storage contains ciphertext; KEK remains in KMS | Traffic analysis and object metadata remain visible |
| Database + Storage dump | Only wrapped DEKs are present | An attacker with concurrent KMS authorization can decrypt |
| Cross-tenant object swap | Tenant/document/version/artifact AAD | Incorrect authorization logic must still be prevented by RLS/backend checks |
| Ciphertext/tag/nonce mutation | Ciphertext SHA-256 and AES-GCM authentication | Availability loss; no silent repair |
| Wrapped DEK mutation | KMS authenticated data and unwrap failure | Availability loss |
| Insider with database access | No plaintext DEKs or KEK in PostgreSQL | KMS-capable privileged identities remain high impact |
| Runtime log exposure | Domain errors and sanitized event metadata | Application code must not add payload logging |
| KMS compromise | Least privilege, temporary identity, independent key | Authorized KMS compromise can expose active documents |
| Replay | Immutable paths, unique DEK/nonce, contextual AAD | Authorized replay of the exact same object remains detectable through version state |
| Metadata loss | Coordinated DB/Storage backups | Ciphertext without metadata is unrecoverable |
| KEK destruction | Rotation and retention procedures | Can cause irreversible crypto-shredding |
| Ransomware | Immutable/versioned objects and independent backups | KMS denial or metadata deletion still affects availability |

Public and authenticated delivery must check access before any KMS call. Browser,
CDN, localStorage, sessionStorage, and IndexedDB are not trusted persistence
locations for plaintext documents.
