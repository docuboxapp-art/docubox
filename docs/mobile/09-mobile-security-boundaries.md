# Limites de seguridad Mobile

## Matriz de ejecucion

| Capacidad | Mobile ejecuta | Mobile solicita backend | Motivo/fuente | Confidence |
|---|---:|---:|---|---|
| Login, refresh, logout Supabase | YES | YES | cliente Auth soportado; servidor valida politica (`src/middleware.ts`) | HIGH |
| Seleccion de workspace | YES UI | YES | membresia/tenant se resuelve en servidor | HIGH |
| Autorizacion documental | NO | YES | reglas, RLS y permisos son autoridad server-side | HIGH |
| RLS | NO | YES indirecto | PostgreSQL aplica politicas | HIGH |
| Descifrado AES-256-GCM | NO | YES | KMS/envelope y metadata estan en servidor (`src/lib/crypto/document-encryption`) | HIGH |
| Operaciones KMS/HSM | NO | YES | llaves nunca salen del servicio (`src/lib/certification`, `@google-cloud/kms`) | HIGH |
| Firma PAdES | NO | YES | firma institucional y PDF final son server-side | HIGH |
| TSA/RFC 3161 | NO | YES | proveedor y confianza server-side | HIGH |
| NOM-151 | NO | YES | generacion/validacion en APIs y Edge Functions | HIGH |
| OpenTimestamps | NO | YES | runtime Python/jobs internos | HIGH |
| Hash local para UX | YES, no autoritativo | YES para evidencia | hash oficial se genera/verifica en backend | HIGH |
| Captura autografa | YES | YES persistencia/finalizacion | Mobile captura puntos normalizados; backend autoriza y registra | HIGH |
| e.firma: seleccionar archivos/password | YES efimero | YES validacion/firma | no persistir `.key`, password ni material descifrado | HIGH |
| Lectura de PDF protegido | YES temporal | YES stream autorizado | no cache permanente por defecto | HIGH |
| LucIA UI | YES | YES | retrieval/modelo/keys quedan server-side | HIGH |
| Service Role | NO | NO desde cliente | solo servidor (`src/lib/supabase/server.ts`) | HIGH |

## Sesion y almacenamiento local

- Guardar material de sesion en `expo-secure-store`; no usar AsyncStorage para secretos.
- Definir accesibilidad Keychain/Keystore y comportamiento ante cambio de biometria/reinstalacion.
- Auto-refresh solo en foreground; al reanudar, validar claims y politica de sesion antes de recuperar datos.
- Borrar sesion, temporales, cache sensible y llaves derivadas al logout/revocacion.
- App lock biometrico es defensa local adicional; no reemplaza token ni step-up del servidor.

Source files: `src/contexts/AuthContext.tsx`, `src/middleware.ts`, `src/lib/supabase/server.ts`; referencia oficial `https://docs.expo.dev/versions/latest/sdk/securestore/`.  
Confidence: HIGH para frontera; MEDIUM para configuracion nativa pendiente.

## Archivos locales

| Operacion | Politica propuesta |
|---|---|
| View | archivo temporal protegido, nombre no sensible, cleanup al cerrar/background/logout |
| Temp download | directorio de cache, TTL corto, excluir backups, no indexar |
| Explicit download | consentimiento y aviso de que sale del control de Docubox |
| Share | autorizacion server-side inmediata y confirmacion; usar share sheet solo si politica lo permite |
| Screenshot | evaluar bloqueo/blur en Android y app switcher; iOS no ofrece prevencion total |
| Clipboard | no copiar contenido sensible automaticamente; limpiar datos generados por la app cuando sea posible |

Las restricciones PDF deben seguir en el PDF final; la app no debe simular seguridad que el sistema operativo no garantiza.

## Riesgos RLS observados

En una comprobacion remota de solo lectura realizada durante el discovery se observaron `public.rate_limits`, `public.ip_blocklist`, `public.auth_attempts` y `public.auth_lockouts` con RLS deshabilitado. Los roles `anon` y `authenticated` no tenian privilegios CRUD directos, por lo que no se demostro exposicion directa; sigue siendo una brecha de defensa en profundidad que debe cerrarse antes del lanzamiento movil.

Accion recomendada para revision humana/DBA, **no ejecutada**:

```sql
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ip_blocklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_lockouts ENABLE ROW LEVEL SECURITY;
```

Despues se deben validar grants, funciones `SECURITY DEFINER` y pruebas negativas; no crear politicas permisivas por defecto.

Source files/context: migraciones de seguridad y snapshot remoto read-only 2026-09-11.  
Confidence: HIGH para el snapshot; el estado puede cambiar fuera de este commit.

## Amenazas prioritarias

- Token robado o filtrado en logs/deep links.
- IDOR por confiar en `documentId` sin reautorizar.
- Cache o archivo descifrado abandonado.
- Cross-tenant retrieval de LucIA.
- Replay/doble envio de firma o carga.
- Captura autografa deformada por coordenadas/rotacion.
- Instrumentacion en dispositivo comprometido.
- Push con contenido sensible visible en lock screen.

Controles: Bearer de corta vida, refresh protegido, autorizacion por request, DTO de capacidades, idempotencia, pinning solo tras evaluar operacion, observabilidad sin PII, DeviceCheck/App Attest/Play Integrity como fase posterior y pruebas de aislamiento tenant.

