# Auditoria actual de LucIA / IA en Docubox

> Corte de auditoria: 4 de septiembre de 2026. Rama `codex/wif-preview-negative`, commit base `7356a0b`. Revision estatica del codigo y de las migraciones locales; no afirma que todas las migraciones esten aplicadas en la base remota.

## 1. Resumen ejecutivo

LucIA existe y funciona como un chat contextual parcial, pero todavia no es un copiloto global seguro. El flujo principal usa `/api/ai/ask`, clasifica intenciones, construye contextos desde Supabase, recupera chunks con pgvector y llama a `gpt-4o-mini`. Tambien hay respuestas directas desde backend para CURP, RFC, telefono y domicilio fiscal.

El estado global es **rojo para produccion multi-tenant** por cuatro hallazgos prioritarios:

1. **P0: acceso documental demasiado amplio.** Las consultas de LucIA usan `service_role` y normalmente filtran solo por `workspace_id`; no aplican `requireDocumentAccess`, `can_access_documento` ni una lista de documentos visibles para el usuario. Un miembro ordinario puede recibir datos o chunks de documentos ajenos del mismo workspace.
2. **P0: endpoints de IA publicos y facturables.** `/api/ai/chat-completion` y `/api/ai/speech-to-text` no autentican, no limitan modelos ni aplican rate limit. El middleware permite todo `/api/`.
3. **P0: secreto de acceso enviado al proveedor.** En modo publico se serializa el token crudo dentro de `route_context.current_resource_ids` y `permissions_summary` y se envia al modelo.
4. **P1: evidencia insuficiente.** En el visor, la mera presencia de `documentId` cuenta como evidencia aunque no haya chunks; en otros intents cualquier objeto estructurado no vacio puede habilitar la respuesta. La validacion posterior cubre solo una frase de conteo.

Tambien hay una cobertura incompleta: se detectaron **121 rutas `page.tsx` y 5 layouts**, pero el clasificador solo reconoce una fraccion. Expedientes, organizacion, Colabora, certificaciones, Notifica, titulos de credito, firmas masivas y varias subrutas caen al scope generico `workspace`. LucIA no esta montada en todas las rutas autenticadas y tres pantallas que se presentan como publicas por token quedan bloqueadas por el middleware.

Conclusión: la base tecnica existe, pero antes de ampliar capacidades hay que cerrar autenticacion, ACL documental, minimizacion de datos, validacion de tokens y evidencia. No se recomienda habilitar acciones de escritura hasta completar esos controles.

## 2. Rutas reales detectadas

Leyenda: "Si, condicional" significa que LucIA llega mediante `AppLayout -> TopNav`, pero el boton solo aparece con usuario autenticado, modulos cargados y `isModuleActive('lucia')`. "Si, token" significa montaje con `PublicTokenLayout`. "Autenticada pese a token" identifica una discrepancia: la pagina tiene parametro de token, pero el middleware actual exige sesion.

| Ruta real | Archivo | Acceso efectivo | Params | Modulo | LucIA visible hoy | LucIA deberia estar | Contexto requerido |
|---|---|---|---|---|---|---|---|
| `/admin/[[...section]]` | `src/app/admin/[[...section]]/page.tsx` | Auth; redirige a `/panel` | `section` | Administracion | No | No | Rol de plataforma y sesion privilegiada, fuera de LucIA normal |
| `/admin/security/crypto-e2e` | `src/app/admin/security/crypto-e2e/page.tsx` | Auth | - | Administracion | Si, condicional | No | Herramienta operativa determinista; no enviar secretos ni llaves |
| `/app-market` | `src/app/app-market/page.tsx` | Auth | - | Integraciones | Si, condicional | Si, lectura | Catalogo, activaciones, permisos y plan |
| `/auth` | `src/app/auth/page.tsx` | Redirige a `/login` | - | Autenticacion | No | No | Ayuda determinista |
| `/auth/passkey-enrollment` | `src/app/auth/passkey-enrollment/page.tsx` | Auth | - | Autenticacion | No | No | Estado del paso y errores sanitizados |
| `/auth/passkey-verification` | `src/app/auth/passkey-verification/page.tsx` | Auth | - | Autenticacion | No | No | Estado del paso, nunca credenciales |
| `/auth/totp-enrollment` | `src/app/auth/totp-enrollment/page.tsx` | Auth | - | Autenticacion | No | No | Estado del paso, nunca secreto TOTP |
| `/auth/totp-verification` | `src/app/auth/totp-verification/page.tsx` | Redirige a `/login/totp-verification` | - | Autenticacion | No | No | Ayuda determinista |
| `/ayuda-firmado` | `src/app/ayuda-firmado/page.tsx` | Auth | - | Firma | No | Si, ayuda | Metodo seleccionado y articulo aplicable |
| `/captura-id-movil/[token]` | `src/app/captura-id-movil/[token]/page.tsx` | Publica | `token` | Identidad movil | Si, token | Si, limitada | Token validado, paso, expiracion; nunca biometria cruda |
| `/certificaciones/[id]` | `src/app/certificaciones/[id]/page.tsx` | Auth | `id` | Certificacion | Si, condicional | Si | Caso, producto, estado y evidencias autorizadas |
| `/certificaciones/api` | `src/app/certificaciones/api/page.tsx` | Auth | - | Certificacion | No | Si, ayuda | Permisos y configuracion no secreta |
| `/certificaciones/configuracion` | `src/app/certificaciones/configuracion/page.tsx` | Auth | - | Certificacion | Si, condicional | Si | Politica, proveedor y permisos no secretos |
| `/certificaciones/conservados` | `src/app/certificaciones/conservados/page.tsx` | Auth | - | Certificacion | No | Si | Registros visibles, filtros y conservacion |
| `/certificaciones/consumo` | `src/app/certificaciones/consumo/page.tsx` | Auth | - | Certificacion | No | Si | Consumo y plan autorizados |
| `/certificaciones/lotes/nuevo` | `src/app/certificaciones/lotes/nuevo/page.tsx` | Auth | - | Certificacion | No | Si | Borrador de lote y archivos seleccionados |
| `/certificaciones/lotes` | `src/app/certificaciones/lotes/page.tsx` | Auth | - | Certificacion | No | Si | Lotes visibles, filtros, estado y errores |
| `/certificaciones/nueva` | `src/app/certificaciones/nueva/page.tsx` | Auth | - | Certificacion | Si, condicional | Si | Borrador, producto y requisitos |
| `/certificaciones` | `src/app/certificaciones/page.tsx` | Auth | - | Certificacion | Si, condicional | Si | Casos visibles, metricas y filtros |
| `/certificaciones/verificaciones` | `src/app/certificaciones/verificaciones/page.tsx` | Auth | - | Certificacion | No | Si | Verificaciones autorizadas y filtros |
| `/colabora/[section]/[id]` | `src/app/colabora/[section]/[id]/page.tsx` | Auth | `section`, `id` | Colabora | Si, condicional | Si | Entitlement, permiso, recurso y actividad |
| `/colabora/[section]` | `src/app/colabora/[section]/page.tsx` | Auth | `section` | Colabora | Si, condicional | Si | Seccion, RBAC, filtros y recursos visibles |
| `/colabora/configuracion-inicial` | `src/app/colabora/configuracion-inicial/page.tsx` | Auth | - | Colabora | Si, condicional | Si | Plan, entitlement y estado de alta |
| `/colabora/configuracion` | `src/app/colabora/configuracion/page.tsx` | Auth | - | Colabora | Si, condicional | Si | Configuracion no secreta y permiso |
| `/colabora` | `src/app/colabora/page.tsx` | Auth | - | Colabora | Si, condicional | Si | Espacios, pendientes, actividad y entitlement |
| `/colabora/reportes` | `src/app/colabora/reportes/page.tsx` | Auth | - | Colabora | Si, condicional | Si | Agregados y filtros autorizados |
| `/configuracion` | `src/app/configuracion/page.tsx` | Auth | - | Configuracion | Si, condicional | Si, lectura | Seccion, rol y configuracion no secreta |
| `/configuracion/verificacion-identidad/[id]` | `src/app/configuracion/verificacion-identidad/[id]/page.tsx` | Auth | `id` | Identidad | No | Si, limitada | Politica/sesion, estado y permiso; sin biometria cruda |
| `/configuracion/verificacion-identidad/nueva` | `src/app/configuracion/verificacion-identidad/nueva/page.tsx` | Auth | - | Identidad | No | Si, ayuda | Borrador de politica y permisos |
| `/configuracion/verificacion-identidad` | `src/app/configuracion/verificacion-identidad/page.tsx` | Auth | - | Identidad | Si, condicional | Si | Politicas y sesiones visibles |
| `/contactos` | `src/app/contactos/page.tsx` | Auth | - | Contactos | Si, condicional | Si | Contactos permitidos, filtros y seleccion |
| `/crear-documento` | `src/app/crear-documento/page.tsx` | Auth | - | Documentos | No | Si | Borrador, paso, archivo, participantes y reglas |
| `/credit-titles/operations` | `src/app/credit-titles/operations/page.tsx` | Auth | - | Titulos de credito | No | Si | Operaciones autorizadas, estado y filtros |
| `/credit-titles` | `src/app/credit-titles/page.tsx` | Auth | - | Titulos de credito | Si, condicional | Si | Carteras, pagares y metricas visibles |
| `/credit-titles/portfolios` | `src/app/credit-titles/portfolios/page.tsx` | Auth | - | Titulos de credito | No | Si | Carteras visibles y filtros |
| `/credit-titles/promissory-notes/[id]` | `src/app/credit-titles/promissory-notes/[id]/page.tsx` | Auth | `id` | Titulos de credito | Si, condicional | Si | Pagare, rol, estado y evidencia |
| `/credit-titles/promissory-notes/new` | `src/app/credit-titles/promissory-notes/new/page.tsx` | Auth | - | Titulos de credito | No | Si | Borrador, plantilla y partes |
| `/credit-titles/promissory-notes` | `src/app/credit-titles/promissory-notes/page.tsx` | Auth | - | Titulos de credito | Si, condicional | Si | Pagares visibles, filtros y estado |
| `/credit-titles/settings` | `src/app/credit-titles/settings/page.tsx` | Auth | - | Titulos de credito | No | Si, lectura | Configuracion y permisos no secretos |
| `/credit-titles/templates` | `src/app/credit-titles/templates/page.tsx` | Auth | - | Titulos de credito | No | Si | Plantillas visibles y variables |
| `/documentos/[documentId]/revision` | `src/app/documentos/[documentId]/revision/page.tsx` | Auth | `documentId` | Revision | Si, condicional | Si | Documento, version, revisores y ACL |
| `/documentos/[documentId]/versiones` | `src/app/documentos/[documentId]/versiones/page.tsx` | Auth | `documentId` | Versiones | Si, condicional | Si | Documento, versiones, cambios y ACL |
| `/documents-dashboard` | `src/app/documents-dashboard/page.tsx` | Redirige a `/inicio` | - | Inicio legado | No efectivo | No | Usar ruta canonica |
| `/enrolamiento/[token]` | `src/app/enrolamiento/[token]/page.tsx` | Publica | `token` | Identidad movil | Si, token | Si, limitada | Token validado, estado y expiracion |
| `/expediente/[token]` | `src/app/expediente/[token]/page.tsx` | Auth pese a token | `token` | Expediente externo | No | Si, si se hace publica | Token hash, alcance, expiracion y expediente minimo |
| `/expedientes/[id]` | `src/app/expedientes/[id]/page.tsx` | Auth | `id` | Expedientes | Si, condicional | Si | Expediente, ACL, requisitos, documentos y eventos |
| `/expedientes/auditoria` | `src/app/expedientes/auditoria/page.tsx` | Auth | - | Expedientes | Si, condicional | Si | Eventos auditables visibles y filtros |
| `/expedientes/constancias` | `src/app/expedientes/constancias/page.tsx` | Auth | - | Expedientes | Si, condicional | Si | Constancias visibles y estado |
| `/expedientes/nuevo` | `src/app/expedientes/nuevo/page.tsx` | Auth | - | Expedientes | No | Si | Plantilla, requisitos y borrador |
| `/expedientes` | `src/app/expedientes/page.tsx` | Auth | - | Expedientes | Si, condicional | Si | Expedientes visibles, filtros y pendientes |
| `/expedientes/plantillas` | `src/app/expedientes/plantillas/page.tsx` | Auth | - | Expedientes | Si, condicional | Si | Plantillas de expediente autorizadas |
| `/expedientes/revision` | `src/app/expedientes/revision/page.tsx` | Auth | - | Expedientes | Si, condicional | Si | Cola de revision y permisos |
| `/facturacion` | `src/app/facturacion/page.tsx` | Auth | - | Facturacion | Si, condicional | Si | Plan, consumo, periodo y facturas propias |
| `/firmar-documento/[id]` | `src/app/firmar-documento/[id]/page.tsx` | Auth | `id` | Firma | No | Si, ayuda limitada | Documento, participante, campos y metodo permitido |
| `/firmas-masivas/[id]` | `src/app/firmas-masivas/[id]/page.tsx` | Auth | `id` | Firmas masivas | Si, condicional | Si | Lote, progreso, archivos y errores visibles |
| `/firmas-masivas/configuracion` | `src/app/firmas-masivas/configuracion/page.tsx` | Auth | - | Firmas masivas | No | Si, lectura | Configuracion no secreta y permisos |
| `/firmas-masivas/firmar-lote` | `src/app/firmas-masivas/firmar-lote/page.tsx` | Auth | - | Firmas masivas | No | Si, ayuda | Lote, documentos y paso actual |
| `/firmas-masivas/importaciones` | `src/app/firmas-masivas/importaciones/page.tsx` | Auth | - | Firmas masivas | No | Si | Importaciones, errores y estado |
| `/firmas-masivas/nueva` | `src/app/firmas-masivas/nueva/page.tsx` | Auth | - | Firmas masivas | Si, condicional | Si | Borrador de lote y seleccion |
| `/firmas-masivas` | `src/app/firmas-masivas/page.tsx` | Auth | - | Firmas masivas | Si, condicional | Si | Lotes visibles, filtros y metricas |
| `/firmas-masivas/plantillas` | `src/app/firmas-masivas/plantillas/page.tsx` | Auth | - | Firmas masivas | No | Si | Plantillas autorizadas |
| `/form/[token]` | `src/app/form/[token]/page.tsx` | Auth pese a token | `token` | Formulario publico | Si, token | Si, si se hace publica | Token validado, formulario y campos permitidos |
| `/formularios/builder` | `src/app/formularios/builder/page.tsx` | Auth | - | Formularios | No | Si | Formulario, campos, seleccion y validaciones |
| `/formularios` | `src/app/formularios/page.tsx` | Auth | - | Formularios | Si, condicional | Si | Formularios visibles, estado y filtros |
| `/formularios/preview` | `src/app/formularios/preview/page.tsx` | Auth | - | Formularios | Si, condicional | Si | Formulario actual y modo preview |
| `/formularios/respuestas` | `src/app/formularios/respuestas/page.tsx` | Auth | - | Formularios | Si, condicional | Si | Respuestas autorizadas, filtros y agregados |
| `/inicio` | `src/app/inicio/page.tsx` | Auth | - | Inicio | Si, condicional | Si | Workspace, metricas, pendientes y actividad visible |
| `/invitacion-organizacion/[token]` | `src/app/invitacion-organizacion/[token]/page.tsx` | Auth pese a token | `token` | Invitacion | No | Si, si se hace publica | Invitacion minima, expiracion y organizacion |
| `/login` | `src/app/login/page.tsx` | Publica | - | Autenticacion | No | No | Ayuda determinista |
| `/login/totp-verification` | `src/app/login/totp-verification/page.tsx` | Publica | - | Autenticacion | No | No | Estado del paso, sin OTP |
| `/mi-perfil` | `src/app/mi-perfil/page.tsx` | Auth | - | Perfil | Si, condicional | Si | Perfil propio; sensibles respondidos por backend |
| `/mis-documentos` | `src/app/mis-documentos/page.tsx` | Auth | - | Documentos | Si, condicional | Si | Documentos visibles, filtros, pagina y seleccion |
| `/mis-participaciones` | `src/app/mis-participaciones/page.tsx` | Auth | - | Participaciones | Si, condicional | Si | Invitaciones y participaciones visibles del usuario |
| `/mis-solicitudes` | `src/app/mis-solicitudes/page.tsx` | Auth | - | Solicitudes | Si, condicional | Si | Solicitudes visibles, filtros y estado |
| `/mis-tareas` | `src/app/mis-tareas/page.tsx` | Auth | - | Tareas | Si, condicional | Si | Tareas asignadas, prioridad y vencimiento |
| `/notificacion/[token]` | `src/app/notificacion/[token]/page.tsx` | Publica | `token` | Notifica | No | No generativa | Resultado y evidencia deterministas |
| `/notificaciones-certificadas/[id]` | `src/app/notificaciones-certificadas/[id]/page.tsx` | Auth | `id` | Notifica | Si, condicional | Si | Notificacion, destinatarios, canales y evidencias |
| `/notificaciones-certificadas/auditoria` | `src/app/notificaciones-certificadas/auditoria/page.tsx` | Auth | - | Notifica | Si, condicional | Si | Eventos visibles y filtros |
| `/notificaciones-certificadas/constancias` | `src/app/notificaciones-certificadas/constancias/page.tsx` | Auth | - | Notifica | Si, condicional | Si | Constancias visibles y estado |
| `/notificaciones-certificadas/nueva` | `src/app/notificaciones-certificadas/nueva/page.tsx` | Auth | - | Notifica | No | Si | Borrador, destinatarios y politica |
| `/notificaciones-certificadas` | `src/app/notificaciones-certificadas/page.tsx` | Auth | - | Notifica | Si, condicional | Si | Notificaciones visibles, filtros y estado |
| `/notificaciones/[id]` | `src/app/notificaciones/[id]/page.tsx` | Auth | `id` | Notificaciones | No | Si | Notificacion propia y destino autorizado |
| `/notificaciones/auditoria` | `src/app/notificaciones/auditoria/page.tsx` | Auth | - | Notificaciones | No | Si | Eventos de notificacion autorizados |
| `/notificaciones/constancias` | `src/app/notificaciones/constancias/page.tsx` | Auth | - | Notificaciones | No | Si | Constancias autorizadas |
| `/notificaciones/nueva` | `src/app/notificaciones/nueva/page.tsx` | Auth | - | Notificaciones | No | Si | Borrador y destinatarios permitidos |
| `/notificaciones` | `src/app/notificaciones/page.tsx` | Auth | - | Notificaciones | Si, condicional | Si | Usuario, filtros, conteos y pagina visible |
| `/notificationes` | `src/app/notificationes/page.tsx` | Redirige a `/notificaciones` | - | Alias | No | No | Usar ruta canonica |
| `/notifications` | `src/app/notifications/page.tsx` | Redirige a `/notificaciones` | - | Alias | No | No | Usar ruta canonica |
| `/olvide-contrasena` | `src/app/olvide-contrasena/page.tsx` | Publica | - | Autenticacion | No | No | Ayuda determinista, sin datos de cuenta |
| `/organizacion/[section]` | `src/app/organizacion/[section]/page.tsx` | Auth | `section` | Organizacion | Si, condicional | Si | Seccion, permisos RBAC y entidad objetivo |
| `/organizacion/directorio/[personId]` | `src/app/organizacion/directorio/[personId]/page.tsx` | Auth | `personId` | Organizacion | Si, condicional | Si | Persona, campos autorizados y permiso |
| `/organizacion/miembros/[memberId]` | `src/app/organizacion/miembros/[memberId]/page.tsx` | Auth | `memberId` | Organizacion | Si, condicional | Si | Miembro, rol, permisos y auditoria visible |
| `/organizacion` | `src/app/organizacion/page.tsx` | Auth | - | Organizacion | Si, condicional | Si | Organizacion, rol, permisos y resumen |
| `/panel/[[...section]]` | `src/app/panel/[[...section]]/page.tsx` | Auth privilegiada | `section` | Administracion | No | No | Mantener fuera del copiloto de tenant |
| `/participation-requests` | `src/app/participation-requests/page.tsx` | Redirige a `/mis-solicitudes` | - | Alias | No efectivo | No | Usar ruta canonica |
| `/pending-tasks` | `src/app/pending-tasks/page.tsx` | Redirige a `/mis-tareas` | - | Alias | No efectivo | No | Usar ruta canonica |
| `/plantillas/nueva` | `src/app/plantillas/nueva/page.tsx` | Auth | - | Plantillas | No | Si | Borrador, variables y permisos |
| `/plantillas` | `src/app/plantillas/page.tsx` | Auth | - | Plantillas | Si, condicional | Si | Plantillas visibles, filtros y variables |
| `/portal-participante/[token]` | `src/app/portal-participante/[token]/page.tsx` | Auth pese a token | `token` | Portal externo | Si, token | Si, si se hace publica | Token validado, participante y documento minimo |
| `/register-device` | `src/app/register-device/page.tsx` | Publica | - | Seguridad | No | No | Flujo determinista, sin reto crudo |
| `/registro-participante/[token]` | `src/app/registro-participante/[token]/page.tsx` | Auth pese a token | `token` | Portal externo | Si, token | Si, si se hace publica | Token validado, invitacion y alcance minimo |
| `/registro` | `src/app/registro/page.tsx` | Publica | - | Registro | No | No | Ayuda determinista |
| `/reportes` | `src/app/reportes/page.tsx` | Auth | - | Reportes | Si, condicional | Si | Filtros, rango y agregados autorizados |
| `/sala/[publicToken]` | `src/app/sala/[publicToken]/page.tsx` | Auth pese a token | `publicToken` | Colabora externo | No | Si, si se hace publica | Token hash, sala, invitado y expiracion |
| `/settings/security` | `src/app/settings/security/page.tsx` | Auth | - | Seguridad | Si, condicional | Si, lectura | Estado de controles, nunca secretos ni desafios |
| `/sign-up-login-screen` | `src/app/sign-up-login-screen/page.tsx` | Redirige a `/login` | - | Alias | No | No | Usar ruta canonica |
| `/solicitud/[publicToken]` | `src/app/solicitud/[publicToken]/page.tsx` | Auth pese a token | `publicToken` | Colabora externo | No | Si, si se hace publica | Token hash, solicitud, invitado y expiracion |
| `/subir-movil/[token]` | `src/app/subir-movil/[token]/page.tsx` | Publica | `token` | Carga movil | No | Si, limitada | Token validado, sesion, tipos y estado |
| `/superadmin/[[...section]]` | `src/app/superadmin/[[...section]]/page.tsx` | Redirige a `/panel` | `section` | Alias admin | No | No | Usar panel |
| `/test-notifications` | `src/app/test-notifications/page.tsx` | Auth | - | Pruebas internas | No | No | No exponer en produccion |
| `/v/[token]` | `src/app/v/[token]/page.tsx` | Publica | `token` | Notifica | No | No generativa | Resultado verificable determinista |
| `/validar-expediente/[id]` | `src/app/validar-expediente/[id]/page.tsx` | Auth | `id` | Expedientes | No | Si | Expediente, validaciones y permisos |
| `/validar-formulario/[id]` | `src/app/validar-formulario/[id]/page.tsx` | Auth | `id` | Formularios | No | Si | Formulario, validaciones y permisos |
| `/verificar-certificacion/[verificationUuid]` | `src/app/verificar-certificacion/[verificationUuid]/page.tsx` | Publica | `verificationUuid` | Verificacion | No | No generativa | Resultado criptografico determinista |
| `/verificar-certificacion/c/[token]` | `src/app/verificar-certificacion/c/[token]/page.tsx` | Publica | `token` | Verificacion | No | No generativa | Resultado criptografico determinista |
| `/verificar-certificacion` | `src/app/verificar-certificacion/page.tsx` | Publica | - | Verificacion | No | No generativa | Identificador y resultado determinista |
| `/verificar-correo` | `src/app/verificar-correo/page.tsx` | Publica | - | Autenticacion | No | No | Estado del flujo, sin codigo |
| `/verificar-documento/[identifier]` | `src/app/verificar-documento/[identifier]/page.tsx` | Publica | `identifier` | Verificacion | No | No generativa | Resultado verificable, hash y estado |
| `/verificar-documento` | `src/app/verificar-documento/page.tsx` | Publica | - | Verificacion | No | No generativa | Identificador y resultado determinista |
| `/verify/promissory-note/[token]` | `src/app/verify/promissory-note/[token]/page.tsx` | Publica | `token` | Titulos de credito | No | No generativa | Resultado verificable del pagare |
| `/visor-documento/[id]` | `src/app/visor-documento/[id]/page.tsx` | Auth | `id` | Visor | Si, condicional | Si | Documento, ACL, chunks, participantes e historial |

No existe `src/pages`; no se encontro Pages Router ni una configuracion de router alternativa. Los menus principales estan en `TopNav.tsx`, `Sidebar.tsx`, `organization/navigation` y `collaboration/navigation`.

## 3. Rutas citadas anteriormente que NO existen

Las cinco rutas que el encargo pidio no asumir **si existen en el codigo actual**. Algunas son canonicas y otra es legado redirigido.

| Ruta citada | Existe | Equivalente probable | Recomendacion |
|---|---|---|---|
| `/mis-documentos` | Si | Es la ruta canonica | Mantener y mapear su estado UI real |
| `/documents-dashboard` | Si, legado | `/inicio` | Mantener solo redireccion; no configurar LucIA aqui |
| `/visor-documento/[id]` | Si | Es la ruta canonica del visor | Aplicar ACL documental antes de RAG |
| `/mi-perfil` | Si | Es la ruta canonica | Mantener respuestas sensibles directas en backend |
| `/facturacion` | Si | Es la ruta canonica | Usar datos reales de plan/consumo; no inventar facturas |

No se identifico ninguna de esas cinco como inexistente. Si se consideran nombres de conversaciones previas adicionales, `/notificationes`, `/notifications`, `/participation-requests`, `/pending-tasks`, `/auth`, `/auth/totp-verification`, `/admin` y `/superadmin` existen solo como alias o rutas redirigidas.

## 4. Layouts y montaje de LucIA

| Pregunta | Resultado |
|---|---|
| ¿Esta montada globalmente? | No en el root layout. Esta montada globalmente solo dentro del subconjunto que usa `AppLayout`. |
| ¿Donde se monta? | `AppLayout` monta `TopNav`; `TopNav` monta `LucIAChat`. `PublicTokenLayout` monta otra instancia en modo token. |
| ¿Todas las rutas autenticadas? | No. Varias paginas usan `AppLayout` directamente; Organizacion y Colabora lo heredan de sus shells; muchas subrutas carecen de ese layout. |
| ¿Todas las rutas publicas por token? | No. Solo cinco paginas usan `PublicTokenLayout`; `/subir-movil/[token]` esta documentada por el componente pero no lo usa. |
| ¿Donde falta? | Crear documento, firma individual, formularios builder, varios flujos de certificacion, firmas masivas, titulos de credito, detalle de notificaciones y validadores autenticados. |
| ¿Donde sobra? | `/admin/security/crypto-e2e` hereda `AppLayout`; el copiloto normal no deberia coexistir con operaciones criptograficas privilegiadas. |
| `currentRoute` | Si, se obtiene con `usePathname()` y se envia a `/api/ai/ask`. |
| Params | Solo infiere `documentId` para `/visor-documento/` y `/firmar-documento/`. No pasa `params` a `buildRouteContext`; `expedienteId` solo existe como prop pero ninguna instancia lo proporciona. |
| `workspaceId` | Si, desde `WorkspaceContext`, cuando ya cargo. Si falta, cae al endpoint generico inseguro. |
| `uiState` | Existe, pero solo incluye booleans, scope, pathname y nombre/entidades del modulo. No incluye filtros, tab, seleccion, paginacion ni IDs visibles. |

Discrepancia adicional: `PublicTokenLayout` declara como publicas `/portal-participante`, `/registro-participante` y `/form`, pero esos prefijos no estan en `PUBLIC_PREFIXES`; un visitante sin sesion es redirigido a `/login` antes de ver la pagina.

## 5. Modelos de IA detectados

| Proveedor | Modelo | Archivo | Endpoint | Proposito | Observaciones |
|---|---|---|---|---|---|
| OpenAI via `@rocketnew/llm-sdk` | `gpt-4o-mini` | `src/app/api/ai/ask/route.ts` | `/api/ai/ask` | Respuesta contextual auth y token | Hardcodeado; `max_tokens` 1500 auth y 800 token; temperatura no fijada |
| OpenAI via SDK | `gpt-4o-mini` | `src/components/LucIAChat.tsx` | `/api/ai/chat-completion` | Fallback sin workspace | Hardcodeado en cliente; streaming; prompt legado; `max_completion_tokens` 2048 |
| OpenAI / Anthropic / Gemini / Perplexity | Elegido por cliente | `src/app/api/ai/chat-completion/route.ts` | Mismo | Proxy generico | P0: publico, sin allowlist, cuota ni auth; acepta parametros arbitrarios |
| OpenAI Embeddings | `text-embedding-3-small` | `src/lib/ai/luciaQueries.ts` | OpenAI `/v1/embeddings` | Embedding de pregunta | Hardcodeado; input truncado a 8,000 caracteres |
| OpenAI Embeddings | `text-embedding-3-small` | `src/app/api/ai/embed-document/route.ts` | OpenAI `/v1/embeddings` | Indexacion documental | 1536 dimensiones, chunks de 800 caracteres, overlap 150, batch 20 |
| OpenAI transcription | `gpt-4o-transcribe` desde UI | `LucIAChat.tsx` y `speech-to-text/route.ts` | `/api/ai/speech-to-text` | Dictado | P0: endpoint publico y modelo/parametros confiados al cliente |

No se encontro uso de `openai.responses.create`; se usa un SDK de compatibilidad de chat y `fetch` directo para embeddings. Las claves vienen de variables de entorno, pero no se encontro validacion central de configuracion ni politica de proveedor/modelo.

## 6. Endpoints y flujo actual

```text
Ruta con AppLayout
  -> TopNav (feature flag lucia)
  -> LucIAChat
  -> si user + workspace: POST /api/ai/ask con Bearer
       -> Supabase Auth
       -> membresia de workspace (service_role)
       -> getScopeFromRoute + classifyIntent
       -> buildUserContext + buildStructuredContext + buildRagContext (en paralelo)
       -> checkEvidence
       -> respuesta backend para datos sensibles, o gpt-4o-mini
       -> sanitizeAnswer + validacion parcial + ai_query_logs
  -> si public-token: POST /api/ai/ask sin Bearer
       -> rate limit en memoria
       -> resolver token con service_role
       -> gpt-4o-mini
  -> si falta workspace: POST /api/ai/chat-completion
       -> prompt generico + historial completo
       -> modelo/proveedor elegidos por cliente
```

La ruta principal correcta es `/api/ai/ask`. El fallback `/api/ai/chat-completion` no debe considerarse un segundo nucleo de LucIA: pierde contexto, aislamiento, evidencia y observabilidad.

## 7. Prompts actuales

1. **Prompt estricto de backend:** `LUCIA_SYSTEM_PROMPT` en `src/app/api/ai/ask/route.ts`. Prohibe inventar y contiene la respuesta exacta sin evidencia. Es el prompt principal correcto, aunque depende de controles de evidencia insuficientes.
2. **Prompt legado de frontend:** `GENERAL_SYSTEM_PROMPT` en `src/components/LucIAChat.tsx`. Reduce Docubox a documentos legales/contractuales, ofrece generacion de contratos y no exige evidencia. Se usa justo cuando no hay workspace, el escenario menos controlado.
3. **Duplicacion de capacidades:** `buildRouteContext` y `moduleCapabilities.ts` mantienen listas paralelas de entidades, acciones y sugerencias. Ya difieren y ambas omiten modulos reales.
4. **Sugerencias contractuales viejas:** `getProactiveSuggestions` propone "Resume este contrato", riesgos legales y clausulas aunque Docubox no se limita a contratos.
5. **Frases de acceso:** las frases "no tengo acceso" aparecen en el backend como lista prohibida, no como instruccion positiva. Sin embargo, el frontend fabrica mensajes "No pude procesar..." a partir de 401/402/403/500, y el backend devuelve "con tus permisos actuales". Por eso el usuario aun percibe respuestas de falta de acceso.
6. No se encontraron prompts de LucIA en base de datos ni Edge Functions. El texto relevante esta en frontend/backend y constantes TypeScript.

Recomendacion: un solo prompt versionado en servidor, sin fallback generativo desde cliente, con contrato de salida estructurado y politicas por scope. Las sugerencias deben derivarse de la misma definicion de capacidades.

## 8. Contextos actuales

| Contexto | Existe | Datos reales | Cuando queda vacio | Problemas | Recomendacion |
|---|---|---|---|---|---|
| `route_context` | Si | Parcial | Nunca totalmente; cae a `workspace` | Solo reconoce una fraccion de rutas; no recibe `params`; anuncia acciones no ejecutables | Registro de rutas tipado y params validados en servidor |
| `user_context` | Si | Si | Errores se capturan por bloque | Siempre consulta perfil fiscal completo; participaciones incompletas; posibles estados/columnas desalineados | Minimizar por intent y propagar errores tipados |
| `structured_context` | Si | Parcial | Intents de usuario, RAG, error o help | Consultas con `service_role` y ACL solo por workspace; `metadata_search` no forma parte del union de intents | Gateway de consultas autorizado por usuario/recurso |
| `rag_context` | Si | Si, si hay chunks | Documento no indexado, PDF no extraible, similitud baja o error | Recupera por workspace, no por lista ACL; se ejecuta para todas las preguntas, aun si no es necesario | RAG solo para intents documentales y sobre IDs autorizados |
| `token_context` | Si | Parcial | Token no encontrado | Consulta `document_participants`, tabla inexistente; no valida expiracion de `enrollment_tokens`; no cubre formularios reales | Resolver unico por hash, tipo, estado, expiracion y alcance |
| `permissions_summary` | Si | Metadatos del request | No | No es una prueba de permiso; incluye IDs enviados por cliente y token crudo | Incluir decision ACL del servidor, nunca secretos |
| `evidence_summary` | No | No | Siempre | La confianza se etiqueta `verified` sin un resumen verificable por claim | Crear manifiesto de evidencia con fuente, ID, version y campos permitidos |
| `finalContext` | Si | Mezcla de todos | Rara vez parece vacio porque el perfil/workspace lo llena | Sobrecarga y minimizacion deficiente; datos no relacionados habilitan evidencia | Construir por intent con esquema cerrado y redaccion |

Hallazgos especificos:

- `buildRouteContext` existe, pero el cliente no le pasa `params`. En el visor se infiere ID; en expedientes, certificaciones, notificaciones, organizacion, Colabora y titulos de credito no.
- `buildUserContext` consulta perfil, workspace, rol, suscripcion/consumo, documentos creados, participaciones, pendientes, actividad, notificaciones, contactos, plantillas y formularios.
- Los documentos asignados dependen de `participation_responses`; una invitacion aun no respondida puede existir en `documentos.participantes` y no aparecer.
- `buildStructuredContext` cubre historial, estado, firma, busqueda y una aproximacion de expediente basada en `carpeta_id`; no consulta los modelos reales `case_files`, tareas `tareas`, facturas, certificaciones, Colabora, organizacion o Notifica.
- `buildRagContext` usa `ai_document_chunks`, pgvector y RPC `match_document_chunks`; no hay Qdrant ni OpenAI Vector Store.
- Los errores de Supabase se registran en consola y se convierten en `{}`, `null` o `[]`; LucIA no distingue "no hay datos" de "fallo la consulta".

## 9. Tablas reales detectadas

La columna RLS refleja las migraciones locales. Las tablas creadas dentro de bucles dinamicos si se consideraron, aunque un escaneo textual simple no encuentre una policy individual.

| Entidad funcional | Tabla real encontrada | Campos clave | RLS | Observaciones para LucIA |
|---|---|---|---|---|
| Usuarios/perfiles | `user_profiles` | `id`, `email`, `full_name`, `rfc`, `curp`, domicilio | Si | Usar solo perfil propio y seleccionar campos por intent |
| Workspaces | `workspaces` | `id`, `owner_id`, `name`, `workspace_type` | Si | Es el tenant principal |
| Membresias | `workspace_members` | `workspace_id`, `user_id`, `role`, `joined_at` | Si | LucIA no valida estado activo ni permiso especifico |
| Organizacion/RBAC | `organization_*` | `workspace_id`, roles, permisos, unidades | Si | FALTA integracion con contextos de LucIA |
| Documentos canonicos | `documentos` | `id`, `workspace_id`, `owner_id`, `nombre`, `estado`, `participantes`, `file_name` | Si | Tabla correcta; tambien existen legados `documents` y `workspace_documents` |
| Versiones | `document_versions` | `document_id`, version, storage, hash | Si | FALTA en contexto/RAG y citas |
| Visibilidad personal | `document_user_visibility` | `document_id`, `user_id`, `trashed_at` | Si | Parte de la ACL actual; LucIA no la usa |
| Participantes registrados | `participation_responses` | `documento_id`, `participante_id/email`, rol, firma/aprobacion | Si | Representa respuestas, no necesariamente todas las invitaciones |
| Participantes no registrados | `unregistered_participants` | documento, email, token/estado | Si | Acceso principalmente de servicio; revisar exposicion de PII |
| Lista invitada embebida | `documentos.participantes` | JSONB de personas, rol, estado/acceso | Hereda `documentos` | Fuente real adicional; no hay tabla `document_participants` |
| Solicitudes/campos de firma | `signature_requests`, `signature_blocks` | documento/formulario, participante, estado, geometria | Si por migraciones | FALTA adaptador de contexto y ACL especifica |
| Firmas/evidencia | `document_signatures`, `signature_evidence`, `signature_events`, `firma_eventos` | documento, firmante, metodo, hash, fecha | Si | No enviar certificados, blobs, biometria ni material criptografico al modelo |
| e.firma/PAdES | `document_pdf_signatures`, `document_signature_seals`, `document_artifacts` | documento, certificado, sello, hashes | Si | No existe una tabla unica `efirma`; usar metadatos no secretos |
| Tareas | `tareas`, `task_*` | workspace, documento, asignado, estado, prioridad, vencimiento | Si | LucIA calcula pendientes desde participaciones; no consulta la tabla real |
| Colabora | `collaboration_*` | workspace, espacio, recurso, tarea/revision, eventos | Si | Solo valida entitlement; FALTA contexto funcional |
| Auditoria documental | `document_activity_log`, `document_lifecycle_audit_events`, `document_audit_trail`, `document_integrity_log` | documento, actor, accion, detalles, fecha | Si | LucIA solo usa `document_activity_log` |
| Plan y consumo | `subscriptions`, `subscription_plans`, `subscription_history`, `organization_usage_ledger` | user/workspace, plan, periodo, limites | Si | Query actual exige simultaneamente `workspace_id` y `user_id`; validar cardinalidad real |
| Facturas fiscales | **FALTA tabla dedicada identificable** | - | - | No afirmar historial de facturas ni descargas hasta definir fuente real |
| Notificaciones personales | `notifications`, `notification_preferences`, `notification_deliveries` | user, tipo, prioridad, read, entrega | Si | LucIA solo consulta `notifications` por usuario |
| Notifica certificada | `certified_notifications`, `notification_recipients`, `notification_access_tokens`, `notification_evidence_events`, `notification_certificates` | workspace, destinatario, token hash, evidencia | Si por bucle | FALTA contexto; nunca enviar token ni evidencia completa |
| Contactos | `contacts`, `contact_custom_fields`, `contact_notes` | `user_id`, nombre, email, telefono | Si | Query actual es por propietario `user_id`, no por permisos de organizacion |
| Plantillas | `plantillas` | workspace, creador, nombre, categoria, fields, estado | Si | Contexto de lectura parcial |
| Formularios | `form_templates`, `form_fields`, `form_sections`, `form_responses`, `form_response_answers`, `form_tokens` | workspace, form, campos, respuesta, token | Si | LucIA solo lista templates; no conoce formulario ni respuesta actual |
| Expedientes | `case_files`, `case_file_*` | workspace, folio, estado, participantes, requisitos, documentos | Si por bucle | LucIA confunde expediente con `carpeta_id`; usar las tablas reales |
| Chunks/embeddings | `ai_document_chunks` | workspace, documento, contenido, vector(1536), pagina, indice | Si | Policy y RPC permiten todo el workspace; falta ACL documental |
| Logs IA | `ai_query_logs` | workspace, user, pregunta, intent, contexto, respuesta, tokens, latencia | Si | Falta redaccion, retencion, modelo, costos y errores |
| Historial de chat | `lucia_sessions`, `lucia_messages` | user, session, role, content | Si, propio | No hay politica de retencion/minimizacion |
| Tokens de enrolamiento | `enrollment_tokens` | token, documento, participante, status, expires | Si | El resolver de LucIA no valida expiracion |
| Carga movil | `mobile_upload_sessions` | token, status, expires, metadata | Si | Si valida expiracion, pero el token se envia despues al modelo |
| Invitaciones | `organization_invitations`, `case_file_invitations`, participantes/documento | token/hash, email, status, expires | Si | No hay un resolver comun para LucIA |
| Biometria/identidad | `identity_enrollments`, `identity_biometric_references`, `identity_verification_*`, `face_comparison_logs`, `nubarium_ocr_logs` | workspace, sujeto, estado, referencias cifradas | Si por bucle | Mantener biometria cruda totalmente fuera de IA y logs |
| OTP | `signature_otp_challenges`, `signature_otps`, `login_otps` | user/participante, hash, intentos, expiracion | Si | Nunca incluir codigo/hash en contexto |

No se encontro `document_participants`, aunque `/api/ai/ask` la consulta para resolver el portal externo. Tampoco existe `executeLuciaAction`. La base ya tiene equivalentes de ACL (`can_access_documento`, `can_read_documento`, `requireDocumentAccess` y `document_user_visibility`); lo que **FALTA** es un gateway unico de acceso documental para IA.

## 10. Seguridad actual

### Controles que si existen

- Supabase Auth valida el Bearer en `/api/ai/ask` y `/api/ai/embed-document`; `userId` se deriva de la sesion.
- Se exige membresia del `workspaceId` solicitado.
- El flujo Colabora consulta `get_my_collaboration_access` y el entitlement `collaboration_ai_assistant`.
- El esquema normal de documentos tiene politicas para propietario/participantes y helpers de acceso.
- RLS esta habilitado en las tablas de IA, sesiones, mensajes y en los dominios principales.
- Los datos sensibles de perfil detectados por el intent especial se responden desde backend sin llamar al modelo.

### Riesgos

| Severidad | Riesgo | Evidencia | Impacto |
|---|---|---|---|
| P0 | Fuga intra-workspace | `luciaQueries.ts` usa `service_role` y filtra documentos/chunks por workspace, no por ACL del usuario | Miembro ordinario puede conocer documentos de otro miembro |
| P0 | Fuga inter-workspace por RPC | `match_document_chunks` y `get_document_chunks_count` son `SECURITY DEFINER`, aceptan `p_workspace_id`, no validan membresia y tienen `GRANT EXECUTE` a `authenticated` | Cliente autenticado puede intentar leer chunks de otro tenant con un UUID conocido |
| P0 | Proxy LLM publico | Middleware libera `/api/`; `chat-completion` no autentica ni limita proveedor/modelo/parametros | Abuso de claves, costo, contenido no autorizado |
| P0 | Transcripcion publica | `speech-to-text` no autentica ni limita tipo/tamano/modelo | Abuso de carga y costo; posible DoS |
| P0 | Token publico exfiltrado | Se incluye `publicToken` en `finalContext` enviado a OpenAI | Reutilizacion del enlace si aparece en telemetria o retencion del proveedor |
| P1 | Resolver token incompleto | Tabla inexistente, `enrollment_tokens` sin chequeo de expiracion, rate limit en memoria | Respuestas vacias, tokens expirados aceptados, proteccion inconsistente en serverless |
| P1 | Contexto PII excesivo | `buildUserContext` carga RFC, CURP, telefono y domicilio en todas las consultas y luego serializa todo | Datos personales enviados sin necesidad al proveedor |
| P1 | Embedding sin ACL | `/api/ai/embed-document` permite a cualquier miembro del workspace descargar/indexar cualquier documento de ese workspace | Lectura indirecta y procesamiento no autorizado |
| P1 | Membresia insuficiente | `verifyWorkspaceMembership` no valida estado, rol ni permiso | Invitado/suspendido podria conservar acceso IA |
| P1 | Logs con contenido sensible | `ai_query_logs` y `lucia_messages` guardan pregunta/respuesta sin redaccion ni TTL | Exposicion secundaria y obligaciones de privacidad |
| P2 | Token/ID confiado desde cliente | `workspaceId`, `documentId`, `scope` y `currentRoute` llegan del body | El backend debe derivar/verificar, no tomar el scope como autoridad |
| P2 | Politicas amplias por workspace | Expedientes, identidad y Notifica usan policy generica de membresia para `FOR ALL` | Un miembro puede tener mas acceso del que permite el RBAC de producto |

La regla central debe ser: el modelo solo recibe una proyeccion de datos que el usuario podria obtener mediante la API normal del modulo. `workspace_id` es condicion necesaria, nunca suficiente.

## 11. Evidencia y riesgo de alucinaciones

Existen `checkEvidence`, `hasEvidence`, fuentes sintetizadas y una validacion posterior, pero no constituyen un sistema de evidencia robusto.

- Para acciones RAG del visor, `ragContext.length > 0 || documentId` permite llamar al modelo con cero contenido. Esto habilita invencion de clausulas, obligaciones, riesgos, fechas y resumen.
- Para cualquier `structured_context` objeto no vacio se acepta evidencia sin comprobar que corresponda al intent.
- El fallback final acepta cualquier valor no vacio de `user_context`; datos del perfil pueden habilitar una respuesta sobre otro dominio.
- `general_help` siempre tiene evidencia por definicion y recibe el perfil/contexto completo.
- `postValidateAnswer` solo reconoce la expresion "encontre N registros verificados" y tolera casi cualquier otra afirmacion.
- `extractSources` crea etiquetas de tabla a posteriori; no enlaza cada afirmacion con fila/chunk/version.
- La respuesta publica devuelve `confidence: verified` solo porque encontro algun contexto de token.
- Los errores de datos se transforman en vacio, por lo que el motor no puede diferenciar ausencia, fallo de esquema, RLS o timeout.

**Puede inventar actualmente:** contenido y clausulas de un documento no indexado; estado o participantes cuando recibe un ID sin evidencia; datos agregados al caer en `general_help`; explicaciones de facturacion sin tabla de facturas; y capacidades/acciones anunciadas pero inexistentes.

Para datos internos se debe aplicar antes del modelo:

```text
evidence = authorize(user, workspace, resource)
         -> query(intent-specific schema)
         -> validate(minimum evidence contract)

if evidence is empty:
  return "No encontre informacion verificable en Docubox para responder eso."
else:
  call model with only evidence.allowedProjection
```

La salida debe referenciar `source_id`, `source_type`, `document_id`, `version_id`, `page/chunk`, `retrieved_at` y decision ACL. Para resumen/analisis documental, cero chunks debe bloquear el modelo, sin excepcion por `documentId`.

## 12. Capacidades LucIA por modulo real

Esta matriz complementa la tabla ruta por ruta de la seccion 2. "Accion" significa una futura operacion validada en servidor; hoy casi todas son solo texto/sugerencia.

| Rutas reales | Modulo | Funciones LucIA | Suggested prompts | Acciones permitidas | Contexto/fuentes | Modo |
|---|---|---|---|---|---|---|
| `/inicio` | Inicio | Priorizar pendientes y explicar actividad | "¿Que requiere atencion hoy?" | Navegar/abrir; sin mutacion | `tareas`, participaciones, documentos ACL, actividad | Estructurado |
| `/mis-documentos`, `/documentos/*` | Documentos | Buscar, filtrar, comparar metadatos/versiones | "Busca mis documentos vencidos" | Aplicar filtro; abrir; mutaciones con confirmacion | `documentos`, versiones, visibilidad, ACL | Estructurado/both |
| `/visor-documento/[id]` | Visor | Resumir, localizar clausulas, estado de firma e historial | "Resume este documento con citas" | Agregar borrador de nota; nunca ejecutar sin confirmacion | Chunks del documento/version autorizados, participantes, auditoria | RAG/both |
| `/crear-documento` | Creacion | Recomendar plantilla/participantes y validar configuracion | "¿Que falta antes de enviar?" | Completar borrador UI; no enviar solo | Estado real del wizard, plantillas, contactos permitidos | Estructurado |
| `/mis-participaciones`, `/mis-solicitudes` | Participaciones | Explicar rol, pendientes y vencimientos | "¿Que debo firmar primero?" | Abrir; aceptar/rechazar con confirmacion | JSON participantes + respuestas + visibilidad | Estructurado |
| `/mis-tareas` | Tareas | Priorizar y resumir bloqueos | "Ordena mis tareas por urgencia" | Crear borrador/recordatorio confirmado | `tareas`, `task_*`, documentos ACL | Estructurado |
| `/firmar-documento/[id]`, `/ayuda-firmado` | Firma | Explicar metodo y campos faltantes | "¿Que me falta para firmar?" | Navegar al campo; nunca firmar/OTP automatico | Solicitud, bloques, rol y politica | Estructurado |
| `/firmas-masivas/*` | Firmas masivas | Resumir lote y diagnosticar filas | "¿Que documentos fallaron?" | Reintento confirmado, si el backend lo permite | Lote, items, estados, errores | Estructurado |
| `/expedientes/*` | Expedientes | Resumir requisitos, hitos, faltantes y auditoria | "¿Que falta para cerrar este expediente?" | Crear borrador de tarea/observacion | `case_files` y `case_file_*` con ACL | Both |
| `/formularios/*` | Formularios | Sugerir campos, validar reglas y resumir respuestas | "¿Que campos tienen mas abandono?" | Editar borrador/filtrar; publicar con confirmacion | Formularios, campos, respuestas autorizadas | Estructurado |
| `/plantillas/*` | Plantillas | Buscar, comparar y proponer variables | "Sugiere una plantilla para este flujo" | Crear borrador; nunca publicar solo | `plantillas`, variables y permisos | Both |
| `/contactos` | Contactos | Buscar y sugerir participantes por reglas explicables | "Busca contactos de Finanzas" | Seleccionar/agregar a borrador | Contactos permitidos, no toda la organizacion | Estructurado |
| `/notificaciones` y detalle | Notificaciones | Resumir urgentes/no leidas | "Resume las alertas del ultimo mes" | Marcar leida/no leida; filtrar | `notifications` del usuario | Estructurado |
| `/reportes` | Reportes | Explicar tendencias y resumir agregados | "Compara actividad mensual" | Aplicar filtros/exportar confirmado | API de agregados, nunca filas amplias | Estructurado |
| `/facturacion` | Facturacion | Explicar plan, consumo y limites | "¿Cuanto consumo me queda?" | Navegar/cambio de plan con flujo explicito | Suscripcion, ledger y fuente real de facturas | Estructurado directo |
| `/mi-perfil` | Perfil | Consultar datos propios y explicar configuracion | "¿Cual es mi RFC registrado?" | Actualizacion con confirmacion y validacion | `user_profiles` proyectado por intent | Backend directo |
| `/configuracion*`, `/settings/security` | Configuracion | Explicar politicas y postura de seguridad | "¿Que sesiones siguen activas?" | Revocar/cambiar solo con reautenticacion | APIs de seguridad, rol y seccion | Estructurado; sin secretos |
| `/organizacion/*` | Organizacion | Resumir miembros, roles, workflows y auditoria | "¿Quien puede aprobar pagos?" | Proponer cambio; ejecutar con RBAC y confirmacion | `organization_*`, permisos efectivos | Estructurado |
| `/colabora/*` | Colabora | Resumir espacios, revisiones, solicitudes y tareas | "¿Que bloquea esta revision?" | Crear borradores/abrir recursos | `collaboration_*` + entitlement + RBAC | Both |
| `/certificaciones/*` | Certificacion | Explicar estado, evidencia y consumo | "¿Por que fallo esta certificacion?" | Reintento confirmado; navegar evidencia | `certification_*` y productos | Estructurado |
| `/notificaciones-certificadas/*` | Notifica | Explicar entrega, acceso, respuesta y constancia | "¿Que destinatarios no han accedido?" | Reenvio confirmado cuando proceda | `certified_notifications` y `notification_*` | Estructurado |
| `/credit-titles/*` | Titulos de credito | Explicar estado, endosos/operaciones y riesgos | "Resume el estado de este pagare" | Navegar/proponer operacion confirmada | Tablas reales del modulo y evidencia | Both |
| Rutas publicas de enrolamiento/carga | Movil por token | Guiar el paso actual | "¿Por que no puedo continuar?" | Solo acciones propias del token | Resolver comun, estado minimo, expiracion | Estructurado/token |
| Portales externos por token | Participante externo | Explicar participacion/recurso | "¿Que debo completar?" | Abrir paso permitido; sin acceso al workspace | Recurso exacto del token y permisos | Estructurado/token |
| Verificaciones publicas | Verificacion | Explicar campos ya verificados | "¿Que significa este resultado?" | Ninguna mutacion | Respuesta criptografica determinista | Sin LLM por defecto |
| `/panel`, `/admin`, `/superadmin`, crypto E2E | Control plane | Ninguna dentro de LucIA tenant | - | - | Mantener separado | No IA generativa |

## 13. Acciones ejecutables existentes/faltantes

No existe `executeLuciaAction` ni un registro de tools con autorizacion, validacion, idempotencia y confirmacion. `ROUTE_ACTION_INTENTS` convierte algunas frases en preguntas; no ejecuta acciones. La UI incluso contiene el comentario `suggestions and callable actions removed`.

| Accion solicitada | Estado real | Implementacion relacionada | Permisos/log | Recomendacion |
|---|---|---|---|---|
| `search_documents` | Parcial, lectura conversacional | `searchDocumentMetadata` | Solo workspace; log parcial | Exponer tool con lista ACL de documentos |
| `filter_documents` | No | Accion/sugerencia textual | No | Accion de UI local, sin LLM cuando sea posible |
| `summarize_document` | Parcial | Intent `document_summary` + RAG | ACL insuficiente | Exigir chunks/version y citas |
| `analyze_document_risks` | Parcial | Intent `legal_analysis` | ACL/evidencia insuficientes | Salida estructurada y disclaimer, con citas |
| `get_document_history` | Si, lectura | `getDocumentActivityHistory` | Query global antes de filtrar si no hay ID | Filtrar autorizado en SQL antes de `limit` |
| `get_pending_tasks` | Parcial | Derivado de participaciones | No usa `tareas` | Consultar tareas reales y ACL |
| `get_signature_status` | Parcial | `getDocumentParticipants` / pendientes | Solo workspace+ID | Aplicar ACL y modelo unificado de participantes |
| `get_user_profile` | Si, lectura | `buildUserContext` | Propio; sobreconsulta PII | Proyeccion por campo/intent |
| `get_user_usage` | Parcial | `buildUserContext.usage` | Propio/workspace | Validar esquema de suscripcion y ledger |
| `get_notifications` | Si, lectura | `getUserNotifications` | Por `user_id` | Añadir rango/filtros y fuente |
| `suggest_template` | No determinista | Prompt/listado de plantillas | Sin motor de ranking | Ranking explicable sobre templates permitidos |
| `suggest_participants` | No | Solo sugerencias de UI | No | Tool de contactos con reglas y minimizacion |
| `explain_signing_method` | Ayuda generativa | Intent `signing_help` | Sin fuente versionada | Base de conocimiento versionada/determinista |
| `recommend_plan` | No | Prompt de facturacion | No | Reglas de producto, precios versionados; confirmacion humana |
| `generate_report_summary` | Muy parcial | `reports_analysis` usa contadores de usuario | No usa reporte actual | Resumir dataset agregado identificado |
| `create_task_from_obligation` | No | - | - | Fase posterior: borrador, fuente/cita, confirmacion e idempotencia |
| `create_reminder` | No | - | - | Tool con politica, confirmacion y auditoria |
| `resend_signature_reminder` | No | Solo pregunta sobre candidatos | - | Envolver API real y verificar propietario/admin |
| `cancel_document` | No | Solo pregunta sobre documentos cancelables | - | Tool de alto impacto con confirmacion reforzada |

Antes de cualquier escritura debe existir un contrato comun: `authorize -> validate input -> preview -> explicit confirmation -> execute idempotently -> audit -> return evidence`.

## 14. Costos y observabilidad

`ai_query_logs` registra `workspace_id`, `user_id`, `session_id`, pregunta, intent, scope, `document_id`, un resumen de contexto, respuesta truncada, tokens totales y latencia. El consumo de Colabora tambien se registra mediante su ledger.

Falta registrar de forma uniforme:

- proveedor, modelo y version/hash de prompt;
- tokens de entrada, salida, cacheados y totales;
- costo estimado y moneda con tabla de precios versionada;
- request/response ID del proveedor;
- route, params normalizados y version de capability;
- fuentes/chunks utilizados: IDs, version, pagina, similitud y decision ACL;
- tablas/RPC consultadas, duracion y cantidad de filas;
- estado final, HTTP status, clase de error Supabase/proveedor, reintentos;
- llamadas public-token, fallback generico, embeddings y transcripcion;
- redaccion de PII, politica de retencion y borrado.

El endpoint debe usar una sola envoltura de telemetria. En desarrollo puede incluir diagnostico tipado sin valores sensibles; en produccion debe registrar IDs correlacionables y codigos de error, nunca tokens, OTP, biometria, certificados, contenido completo ni claves.

La API moderna de Responses permite obtener `usage` y adjuntar `metadata`; conviene evaluar una migracion directa para eliminar el proxy generico y controlar almacenamiento/retencion explicitamente. Referencia: [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create).

## 15. Brechas contra el ecosistema LucIA deseado

### IA global contextual

- Montaje fragmentado y condicionado por layouts locales.
- Scope incompleto para la mayoria de modulos nuevos.
- Sin estado de UI real ni registro unico de capacidades.
- Fallback sin workspace rompe el modelo de seguridad.

### IA documental

- RAG existe, pero indexacion manual/parcial y extraccion PDF por heuristica de bytes.
- No hay OCR robusto para escaneados, versionado de chunks ni invalidez al reemplazar archivo.
- ACL de chunks es por workspace, no por documento/usuario.
- Citas no vinculadas a claims.

### IA operativa

- No existe motor de acciones ejecutables.
- Tareas se infieren de participaciones en vez de usar `tareas`/`task_*`.
- Sin previews, confirmaciones, idempotencia ni auditoria de tools.

### IA de firma

- El scope existe para firma individual, pero LucIA no esta montada alli.
- No consulta solicitudes/bloques/evidencia reales.
- Debe mantenerse fuera de OTP, secretos, biometria cruda y acto de consentimiento/firma.

### IA de compliance

- Solo hay intents genericos de analisis legal/compliance.
- Sin taxonomia, jurisdiccion, reglas mexicanas versionadas, evaluacion estructurada ni fuentes.
- Un LLM no debe decidir cumplimiento ni validez criptografica.

### IA de reportes

- `reports_analysis` usa cuatro contadores y tamaños de listas truncadas, no el reporte visible.
- No recibe rango, filtros, agregados ni definiciones de metricas.

### IA de perfil/facturacion

- Los sensibles propios tienen una buena ruta backend directa.
- Aun asi el perfil completo se envia al modelo en consultas no sensibles.
- No se encontro tabla dedicada de facturas; no debe prometer historial/descarga sin fuente.

### IA publica por token

- Cobertura/middleware inconsistentes.
- Resolver fragmentado e incompleto.
- Token crudo enviado al proveedor.
- Rate limit local no funciona como control distribuido.
- No hay logging seguro ni contrato de minima divulgacion.

## 16. Plan de implementacion recomendado

### Fase 1: nucleo seguro y correcto

1. Cerrar o autenticar `/api/ai/chat-completion` y `/api/ai/speech-to-text`; allowlist de proveedor/modelo, limites de cuerpo y rate limit distribuido.
2. Crear `LuciaAuthorizationContext` que derive usuario, workspace, rol y documentos visibles; reutilizar `requireDocumentAccess`/`can_access_documento`.
3. Corregir/revocar los RPC `SECURITY DEFINER` de chunks y verificar membresia + ACL dentro de la funcion.
4. Eliminar el token crudo de todo prompt/log; resolverlo por hash y emitir un `resource_grant_id` efimero.
5. Sustituir el fallback generico por estado de carga o ayuda estatica.
6. Registrar todas las rutas reales en un unico `moduleCapabilities` tipado; derivar params en servidor.
7. Construir contexto por intent con seleccion minima. Sensibles siempre directos desde backend.
8. Hacer `checkEvidence` especifico por intent y fail-closed ante errores.

### Fase 2: capacidades por modulo y acciones

1. Unificar scope, suggested prompts, required context y allowed actions en un registro.
2. Integrar tablas reales de tareas, expedientes, organizacion, Colabora, certificacion, Notifica, firmas masivas y titulos de credito.
3. Incorporar `uiState` real: filtros, tab, seleccion, paginacion e IDs visibles.
4. Crear un registro de tools de solo lectura primero.
5. Añadir acciones de escritura solo con preview, confirmacion, idempotencia, permiso y auditoria.

### Fase 3: RAG documental

1. Pipeline de extraccion robusto por MIME con PDF parser y OCR para escaneados.
2. Chunks ligados a `document_id`, `version_id`, pagina, hash y politica de acceso.
3. Indexacion asincrona observable, reintentos, invalidacion por nueva version y borrado.
4. Recuperacion solo sobre IDs autorizados y respuestas con citas internas verificables.
5. Evaluaciones de retrieval y groundedness antes de habilitar analisis.

### Fase 4: extraccion, clasificacion y compliance

1. Esquemas estructurados para partes, fechas, obligaciones, montos y riesgos.
2. Revision humana y trazabilidad campo -> pagina/chunk/version.
3. Taxonomia documental general, no centrada en contratos.
4. Reglas de compliance mexicano versionadas y separadas del razonamiento generativo.
5. Datos estructurados reutilizables para tareas/reportes, sin mutacion automatica.

### Fase 5: agentes especializados

Separar agentes de documentos, firma, expedientes, operacion, compliance y reportes sobre un mismo gateway de identidad, ACL, evidencia, tools y telemetria. Un orquestador solo debe delegar despues de autorizar el recurso y limitar el contexto.

## 17. Backlog tecnico

### P0 critico

- `AI-SEC-001`: autenticar/cerrar proxy de chat y STT; allowlist, cuotas y rate limit.
- `AI-SEC-002`: aplicar ACL por documento a toda consulta estructurada, embedding y RAG.
- `AI-SEC-003`: corregir RPC vectorial `SECURITY DEFINER`; revocar ejecucion insegura.
- `AI-SEC-004`: retirar tokens crudos de prompts, logs y metadatos de proveedor.
- `AI-SEC-005`: minimizar PII por intent y bloquear biometria/OTP/e.firma material.

### P1 alto

- `AI-CTX-001`: registro de las 121 rutas y params reales con tests de cobertura.
- `AI-CTX-002`: resolver token comun por hash, tipo, estado, expiracion y alcance.
- `AI-CTX-003`: integrar participantes JSONB + respuestas + no registrados sin duplicados.
- `AI-CTX-004`: usar `case_files` para expedientes y `tareas`/`task_*` para tareas.
- `AI-EVD-001`: evidencia por intent y bloqueo estricto si falta.
- `AI-EVD-002`: citas por claim con documento/version/pagina/chunk.
- `AI-OBS-001`: telemetria comun de modelo, tokens, costo, fuentes y errores, con redaccion/TTL.
- `AI-RAG-001`: reemplazar extractor PDF heuristico por parser/OCR de produccion.
- `AI-UX-001`: eliminar fallback generico y mostrar estados diferenciados: cargando, sin datos, sin permiso, error.

### P2 medio

- `AI-MOD-001`: adaptadores de contexto para organizacion, Colabora, Certifica, Notifica, firmas masivas y titulos de credito.
- `AI-ACT-001`: registro de tools read-only con esquema, autorizacion y auditoria.
- `AI-ACT-002`: acciones de UI locales para filtros/navegacion sin costo de LLM.
- `AI-BILL-001`: definir fuente canonica de facturas o retirar esa capacidad anunciada.
- `AI-DATA-001`: reconciliar tablas legadas `documents`/`workspace_documents` con `documentos`.
- `AI-DATA-002`: propagar errores de contexto en vez de convertirlos en arreglos vacios.

### P3 futuro

- `AI-ACT-003`: tools de escritura con preview/confirmacion/idempotencia.
- `AI-COMP-001`: extraccion estructurada y motor de compliance versionado.
- `AI-EVAL-001`: suite de evaluaciones de retrieval, groundedness, permisos y calidad por modulo.
- `AI-AGENT-001`: agentes especializados sobre el nucleo comun.

## 18. Pruebas obligatorias

No se encontraron pruebas especificas de LucIA, `/api/ai/*`, RAG o sus politicas. La suite minima debe incluir:

1. **Inventario de rutas:** prueba que enumere los 121 `page.tsx`, detecte altas/bajas y obligue a clasificar cada ruta como `lucia: enabled|limited|disabled`.
2. **Scope y params:** casos por cada ruta real dinamica; validar `id`, `documentId`, `token`, `publicToken`, `section`, `memberId`, `personId`, `identifier` y `verificationUuid`.
3. **Montaje:** pruebas de componentes/layout para AppLayout, shells de Organizacion/Colabora, rutas sin layout y public-token.
4. **Middleware:** matriz de usuario anonimo/autenticado para cada ruta publica y cada ruta con token; corregir y fijar la discrepancia de portal/formulario/registro.
5. **Auth de endpoints:** anonimo debe recibir 401 en chat, STT, embed y ask auth; modelos/proveedores fuera de allowlist deben fallar.
6. **Aislamiento multi-tenant:** usuario A no obtiene documentos, chunks, participantes, logs ni perfil de workspace B aun con UUIDs conocidos.
7. **ACL intra-workspace:** miembro sin acceso al documento no obtiene metadata, embedding, chunks, historial ni firma; propietario/participante autorizado si.
8. **RPC vectorial:** llamada directa como `authenticated` con workspace ajeno debe devolver cero/403; nunca depender solo de RLS bajo `SECURITY DEFINER`.
9. **Tokens publicos:** token invalido, expirado, revocado, usado y de tipo equivocado; confirmar que el proveedor/log nunca recibe el token crudo.
10. **PII:** preguntas no sensibles no incluyen RFC/CURP/telefono/domicilio; pregunta propia sensible responde backend; otro usuario y otra persona fallan.
11. **Evidencia:** cada intent interno sin evidencia no llama al proveedor y devuelve el texto canonico; `documentId` sin chunks no habilita resumen.
12. **Grounding:** respuestas de documento solo contienen afirmaciones respaldadas por chunks citados de la version autorizada.
13. **Errores:** distinguir sin datos, permiso denegado, esquema incompatible, timeout Supabase y error proveedor sin filtrar detalles sensibles.
14. **Participaciones:** invitado sin respuesta, respuesta existente, desinvitado, historial conservado y acceso revocado.
15. **UI state:** filtros, seleccion, tab y paginacion llegan como IDs/valores validados, no como texto libre confiable.
16. **Acciones:** ninguna mutacion sin confirmacion; replay conserva idempotencia; permiso revocado entre preview y execute cancela la operacion.
17. **Costos:** tokens/costo/modelo se registran en exito y error; embeddings/STT/public-token tambien; limites se aplican por usuario/workspace/IP.
18. **Retencion:** expiracion/borrado de chats y logs, redaccion de PII y ausencia de secretos en consola/telemetria.
19. **RAG:** PDF textual, comprimido, escaneado, protegido, nueva version, reemplazo y borrado; paginas/chunks correctos.
20. **Cobertura por modulo:** smoke tests de Inicio, Documentos, Visor, Firma, Expedientes, Formularios, Tareas, Notificaciones, Reportes, Perfil, Facturacion, Organizacion, Colabora, Certifica, Notifica, firmas masivas y titulos de credito.

## Dictamen

LucIA tiene un buen esqueleto de intenciones, contexto, RAG y persistencia, pero hoy combina una cobertura funcional parcial con fronteras de autorizacion demasiado amplias. El siguiente cambio no debe ser agregar mas prompts ni mas acciones: debe ser convertir identidad, ACL, evidencia y telemetria en dependencias obligatorias de cualquier lectura o llamada al modelo.

Esta auditoria no implementa cambios, conforme a lo solicitado.
