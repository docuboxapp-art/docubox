# Inventario de pantallas Mobile

## Required Phase 1: 21

| ID | Pantalla | Objetivo | API/dominio | Riesgo principal | Source files | Confidence |
|---|---|---|---|---|---|---|
| M01 | Splash/Session Restore | cargar marca y validar sesion | Supabase Auth + session policy | no mostrar datos antes de revalidar | auth/layout | HIGH |
| M02 | Login | autenticar | Supabase Auth, login options | rate limit/errores | `/login`, APIs auth | HIGH |
| M03 | Auth Challenge | OTP/TOTP/step-up | `/api/auth/*`, `/api/webauthn/*` | deep link/replay | rutas auth | HIGH |
| M04 | Workspace | elegir tenant activo | workspace memberships | cross-tenant cache | `WorkspaceContext` | HIGH |
| M05 | Inicio/LucIA | pendientes y entrada IA | documentos + `/api/ai/ask` | autorizacion IA | `/inicio`, `LucIAChat` | HIGH |
| M06 | Documentos | lista paginada | `/api/documentos/listar` | escala/cache | `/mis-documentos` | HIGH |
| M07 | Busqueda y filtros | consulta por estado/tipo/participacion | listar/query layer | filtros inconsistentes | `/mis-documentos` | HIGH |
| M08 | Carga | PDF/Office y progreso | guardar borrador/conversion jobs | cuota/retry/upload | `/crear-documento`, conversion | HIGH |
| M09 | Detalle | resumen y acciones permitidas | obtener + metadata | UI no debe inferir permisos | visor | HIGH |
| M10 | Visor PDF | leer/navegar/buscar | viewer-file | temp files/rendimiento | visor web | HIGH |
| M11 | Informacion/Metadatos | datos y versiones esenciales | metadata/additional metadata | schema dinamico | tabs visor | HIGH |
| M12 | Participantes | roles/estados | participations/permissions | PII/ACL | tabs visor | HIGH |
| M13 | Actividad documento | timeline/comunicacion/vencimiento | activity/notifications | paginacion | tabs visor | MEDIUM |
| M14 | Evidencia/Verificacion | estado y artefactos | evidence/certifications | claims legales | tabs visor/APIs | HIGH |
| M15 | Firma | terminos, campos y metodo | `/api/firma/*` | idempotencia/crypto | `/firmar-documento/[id]` | HIGH |
| M16 | Rechazo/Cancelacion | accion confirmada cuando aplica | participation/update estado | accion irreversible | firma/lifecycle | HIGH |
| M17 | Descarga/Compartir | salida explicita | viewer/evidence artifacts | fuga local | visor/APIs | HIGH |
| M18 | Papelera | listar/restaurar/purgar permitido | papelera/lifecycle | retencion/legal hold | `/mis-documentos` | HIGH |
| M19 | Actividad global | solicitudes/eventos | notifications/participations | payload sensible | TopNav/APIs | MEDIUM |
| M20 | LucIA Conversacion | consulta multi-turn autorizada | ask/chat-completion | scope/citas | `LucIAChat` | HIGH |
| M21 | LucIA Contextual | consulta del documento abierto | AI + document context | seleccion/exfiltracion | viewer + Lucia context | HIGH |

## Optional Phase 1

| Pantalla/flujo | Justificacion | Source | Confidence |
|---|---|---|---|
| Perfil/configuracion minima dedicada | puede iniciar como sheet en M19/M04 | contexts y settings web | MEDIUM |
| Versiones/comparacion | backend existe; UX/flag requiere madurez | rutas versiones y compare | HIGH |
| Verificacion publica por QR/deep link | valiosa, no necesaria para usuario autenticado inicial | rutas verify | HIGH |
| Gestion de permisos | sensible y menos frecuente en movil | viewer permissions | HIGH |
| Crear carpetas | puede limitarse a navegacion al inicio | carpetas API | HIGH |
| Recordatorio manual | requiere contrato/rate-limit | send-reminder | HIGH |

## Future

- Push center y preferencias avanzadas.
- Alertas inteligentes LucIA.
- Acciones LucIA con command/approval layer.
- Edicion documental rica.
- Plantillas, formularios, builders, reportes y administracion de organizacion.
- Certifica/Colabora como modulos completos.
- Offline controlado.

## Jerarquia del visor

M10 es la superficie central; M11-M14 se presentan como bottom sheets o pantallas apiladas segun profundidad. M15-M17 son flujos modales/apilados con confirmacion y retorno al mismo documento. Este modelo conserva la informacion del visor web sin transportar su rail lateral.

## Estados obligatorios por pantalla

Todas las pantallas de datos deben definir: initial loading estable, empty, partial/stale, offline, forbidden, session expired, not found, server error y retry con backoff. Mutaciones deben diferenciar submitting, accepted/processing, completed y failed terminal.

Source files: patrones actuales en paginas y APIs; propuesta Mobile.  
Confidence: HIGH para necesidades; MEDIUM para numero final hasta prototipo navegable.

