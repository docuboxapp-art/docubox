# Docubox Mobile: auditoria de arquitectura actual

Fecha de corte: 2026-09-11  
Commit auditado: `c44554c` (`codex/wif-preview-negative`)  
Alcance: discovery para Mobile Fase 1, exclusivamente Documentos + LucIA.

## Dictamen

Docubox es un monolito modular full-stack sobre Next.js con Supabase como plataforma de identidad, PostgreSQL, Storage y Edge Functions. La futura aplicacion movil puede reutilizar el backend y buena parte del dominio, pero no los componentes React DOM. La integracion correcta es `Mobile -> Route Handlers/BFF -> dominio server-side -> Supabase/Storage/crypto/AI`, con acceso directo de cliente solo donde RLS y el contrato hayan sido auditados expresamente.

| Conclusion | Estado | Source files | Confidence |
|---|---|---|---|
| Frontend Next.js 16.3.4, React 19.0.3 y TypeScript estricto | IMPLEMENTED | `package.json`, `tsconfig.json` | HIGH |
| Enrutamiento mediante App Router | IMPLEMENTED | `src/app/layout.tsx`, `src/app/**/page.tsx` | HIGH |
| Backend principal mediante Route Handlers | IMPLEMENTED | `src/app/api/**/route.ts` | HIGH |
| Server Actions como capa significativa | NOT FOUND | busqueda de `use server` en `src` | HIGH |
| Identidad, datos y archivos sobre Supabase | IMPLEMENTED | `src/lib/supabase/server.ts`, `src/lib/supabase/client.tsx`, `supabase/migrations`, `supabase/functions` | HIGH |
| Python se usa en runtime acotado de OpenTimestamps | IMPLEMENTED | `api/opentimestamps_runtime.py`, `workers/ots-worker`, `requirements.txt` | HIGH |
| La API ya acepta Bearer en partes relevantes | PARTIAL | `src/middleware.ts`, `src/lib/supabase/server.ts`, `src/lib/ai/security.ts` | HIGH |
| Existe una app movil nativa | NOT FOUND | inventario del repositorio | HIGH |
| Existen propuestas moviles previas | DOCUMENTED ONLY | `docs/app-movil-arquitectura-adaptacion-webapp.md`, `docs/app-movil-pantallas-ui-ux.md` | HIGH |

## Frontend

- `src/app/layout.tsx` compone `AuthProvider`, `WorkspaceProvider`, `ThemeProvider`, `SidebarProvider`, `AppModulesProvider` y `LuciaAssistantProvider`.
- `src/components/AppLayout.tsx`, `TopNav.tsx` y `Sidebar.tsx` forman el shell web. `TopNav.tsx` es la fuente mas confiable para navegacion vigente; `Sidebar.tsx` contiene entradas estaticas/legadas y no debe convertirse automaticamente en IA movil.
- El estado global usa React Context. No hay una libreria dedicada de server state.
- Los formularios usan React Hook Form y Zod; hay hooks de sesion, WebAuthn, geolocalizacion, firma, realtime, auto-guardado y voz.
- La UI combina Tailwind, CSS global, Lucide y Heroicons. Los componentes compartidos son pocos; gran parte del estilo vive en paginas.

Source files: `src/app/layout.tsx`, `src/components/AppLayout.tsx`, `src/components/TopNav.tsx`, `src/components/Sidebar.tsx`, `src/contexts`, `src/hooks`, `package.json`.  
Confidence: HIGH.

## Backend

- Los Route Handlers en `src/app/api` son la fachada HTTP predominante.
- `createServiceClient()` conserva el Service Role exclusivamente en servidor; `createAnonClient(accessToken?)` permite validar JWT de usuario.
- Existen Edge Functions para firma, e.firma, sellado, NOM-151, carga, correo y captura biometrica.
- PostgreSQL contiene el dominio documental, membresias, permisos, evidencia, LucIA y auditoria.
- Storage usa el bucket privado `documents`; los archivos protegidos deben continuar sirviendose desde backend autorizado.
- KMS/HSM, AES-256-GCM, PAdES, TSA, NOM-151 y OpenTimestamps permanecen en servicios server-side.

Source files: `src/lib/supabase/server.ts`, `src/app/api`, `supabase/functions`, `supabase/migrations`, `src/lib/certification`, `src/lib/crypto`, `src/lib/nom151`, `src/lib/blockchain-evidence`.  
Confidence: HIGH.

## Flujo objetivo

```text
Docubox Mobile
  -> cliente API autenticado con Bearer
  -> Next.js Route Handlers / BFF movil
  -> servicios de dominio Docubox
  -> Supabase Auth + PostgreSQL + Storage
  -> servicios privilegiados: KMS/HSM, PAdES, TSA, NOM-151, OTS, OpenAI
```

No se recomienda un backend, base de datos ni implementacion criptografica paralela para Mobile.

## Reutilizacion conceptual

| Area | Clasificacion | Nota |
|---|---|---|
| Tipos, enums y reglas puras | SHARE DIRECTLY tras extraer dependencias Node/DOM | Versionar contratos antes de compartir |
| Zod y contratos HTTP | SHARE DIRECTLY/ADAPT | Hoy estan dispersos; crear paquete de contratos |
| Route Handlers y servicios de dominio | ADAPT | Normalizar Bearer, errores, paginacion e idempotencia |
| React Context web | DO NOT SHARE | Crear estado nativo orientado a sesion, workspace y UI |
| Componentes React DOM/Tailwind | DO NOT SHARE | Reproducir semantica visual con componentes nativos |
| Tokens y activos PNG | ADAPT | Compartir valores/activos, no CSS |
| Crypto y Service Role | DO NOT SHARE | Solo servidor |

## Estado de produccion

Esta auditoria no ejecuto migraciones, no modifico Supabase remoto, no cambio variables, no desplego Vercel y no altero codigo productivo.

