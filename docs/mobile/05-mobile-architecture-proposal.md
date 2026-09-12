# Propuesta de arquitectura Mobile

## Recomendacion

**React Native + Expo + TypeScript + Expo Router**. No existe una razon tecnica en el repositorio que justifique Flutter: el dominio, validaciones y equipo ya operan en TypeScript/React, y Expo Router ofrece rutas tipadas, deep links y navegacion nativa con un modelo familiar al App Router.

Referencias actuales: [Expo Router](https://docs.expo.dev/router/introduction/), [Supabase Auth con React Native](https://supabase.com/docs/guides/auth/quickstarts/react-native), [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/), [React Native Security](https://reactnative.dev/docs/security). Consultadas 2026-09-11.

Source files: `package.json`, `src/app`, `src/lib/supabase`, `src/lib/ai/security.ts`.  
Confidence: HIGH para afinidad; MEDIUM hasta completar spikes de visor PDF, firma y deep links.

## Capas

```text
apps/mobile
  app/                       Expo Router; solo composicion de pantallas
  src/features/              documents, signing, lucia, activity, profile
  src/components/            primitivas nativas Docubox
  src/lib/auth/              sesion, refresh, app lock
  src/lib/api/               cliente HTTP, errores, idempotencia
  src/lib/files/             temporales, descargas explicitas, cleanup
  src/state/                 estado local acotado

packages
  contracts/                 DTO, Zod, codigos de error, API version
  domain/                    reglas puras sin Node/DOM
  design-tokens/             tokens multiplataforma
  permissions/               nombres de capacidades; servidor decide
```

## Flujo de datos

```text
Screen
  -> feature hook / TanStack Query
  -> typed API client + Bearer JWT + request-id/idempotency-key
  -> Next.js Route Handler/BFF
  -> authorization + domain service
  -> Supabase/Postgres/Storage or privileged service
```

- TanStack Query: cache, revalidacion, deduplicacion, paginacion y mutations.
- Context/Zustand pequeno: workspace seleccionado, preferencias locales y estado efimero; no duplicar documentos como fuente de verdad.
- React Hook Form + Zod: formularios y validacion compartible.
- Supabase client: Auth y, solo tras auditoria, Realtime/lecturas con RLS. Mutaciones privilegiadas pasan por API.

## Autenticacion

1. Supabase Auth sigue siendo autoridad.
2. Mobile usa PKCE/deep links y entrega access token como Bearer a Docubox APIs.
3. Refresh token/sesion se guarda mediante SecureStore/Keychain/Android Keystore, nunca AsyncStorage sin cifrar.
4. Auto-refresh se activa solo en foreground y se detiene en background.
5. El backend aplica la misma politica de sesion/tenant que web; no basta validar localmente el JWT.
6. Biometria es app lock y step-up local complementario, no autenticacion del servidor.

Source files: `src/middleware.ts`, `src/contexts/AuthContext.tsx`, `src/lib/supabase/server.ts`, rutas `src/app/api/auth` y `webauthn`.  
Confidence: HIGH sobre autoridad; MEDIUM sobre PKCE hasta configurar schemes y redirect URLs.

## Repositorio

Recomendacion: **repositorio Mobile independiente al inicio + paquete privado versionado de contratos**. Motivos:

- El proyecto web vive en la raiz y su despliegue Vercel depende de esa forma; moverlo ahora aumenta el riesgo sin beneficiar el MVP.
- Expo/EAS necesita su propio ciclo de releases, credenciales y CI.
- Los contratos versionados reducen drift sin acoplar releases web/mobile.
- Una consolidacion futura a monorepo puede evaluarse cuando los paquetes sean estables.

No copiar codigo del servidor al repositorio Mobile. El paquete compartido debe ser isomorfico: sin `next/*`, Node, DOM, Service Role ni SDK KMS.

## Decisiones pendientes de spike

- Visor PDF nativo: validar rendimiento, busqueda, anotaciones/seleccion, licencia y archivos cifrados temporales en iOS/Android.
- Firma autografa: validar coordenadas normalizadas, rotacion y DPR contra el mismo contrato del backend.
- e.firma: confirmar soporte de seleccion segura de `.cer`/`.key`, password y memoria efimera sin persistir material.
- Deep links: definir bundle ID/package name y dominios universales.

