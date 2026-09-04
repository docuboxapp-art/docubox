# Estado de reconciliación Supabase

Fecha: 2026-08-30T02:39:43.319Z

1. Supabase CLI: 2.116.0.
2. Migraciones presentes: 225; Git: 199; copias diagnósticas/nueva: 26.
3. Migraciones remotas: 25.
4. APPLIED_BUT_UNTRACKED: 0.
5. ACTUALLY_PENDING: 1.
6. SUPERSEDED: 25.
7. CONFLICTING: 0.
8. REMOTE_ONLY: 25.
9. UNKNOWN: 174.
10. Repairs ejecutados: 0.
11. `db push --include-all`: no ejecutado.
12. `db push --dry-run`: sigue bloqueado por historia legacy local no conciliada.
13. Migración de cifrado aplicada: no.
14. RLS de cifrado nuevo: no verificable hasta aplicar; tabla legacy tiene políticas incompatibles con diseño backend-only.
15. Storage E2E cifrado: pendiente.
16. KMS HSM wrap/unwrap: PASS previo, no modificado.
17. PAdES/TSA/NOM-151 sobre objetos cifrados: pendiente.
18. Objetos legacy: 12 PLAINTEXT, 1 CORRUPT, 0 ENCRYPTED, 0 migrados.
19. Objeto corrupto: aislado documentalmente; sin mutación.
20. Replay local: bloqueado por ausencia de Docker/Podman.
21. Advisors: 195 WARN (anon_security_definer_function_executable=76, auth_leaked_password_protection=1, authenticated_security_definer_function_executable=86, extension_in_public=3, function_search_path_mutable=29).
22. Estado final: `IMPLEMENTED_PENDING_PRODUCTION_E2E`.

## Criterio de parada

No existe evidencia para demostrar todavía `Git history ≈ production schema ≈ migration history`. Se preservó el estado remoto sin DDL, DML, repairs ni despliegues.
