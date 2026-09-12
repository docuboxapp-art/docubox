# Alcance Mobile Fase 1

## Objetivo MVP

Permitir a un usuario autenticado encontrar, abrir, revisar y actuar sobre sus documentos, completar una firma cuando corresponda y consultar LucIA con el mismo alcance de autorizacion del backend.

## Incluido

- Login, recuperacion/challenge compatible y restauracion segura de sesion.
- Seleccion/cambio de workspace.
- Inicio centrado en LucIA y pendientes documentales.
- Lista de documentos y participaciones con busqueda, filtros y paginacion.
- Carga PDF/Office con progreso, conversion y cuota existente.
- Detalle y visor PDF.
- Participantes, metadatos esenciales, actividad y evidencia.
- Descarga/compartir solo cuando la politica backend lo permita.
- Firma autografa, Click & Sign y e.firma mediante procesos existentes, sujeto a spikes de seguridad/UX.
- Rechazo/cancelacion cuando `allowedActions` lo autorice.
- Papelera basica y restauracion conforme a lifecycle.
- LucIA global y contextual con evidencia.
- Perfil minimo: sesion, workspace y app lock.

Source files: rutas `/mis-documentos`, `/visor-documento/[id]`, `/firmar-documento/[id]`, `src/lib/documents`, `src/lib/ai`.  
Confidence: HIGH sobre dominio; MEDIUM sobre esfuerzo movil.

## Fuera de alcance

- Plantillas, formularios y sus builders.
- Administracion integral de organizaciones, billing, webhooks y backoffice.
- Certifica/Colabora como modulos completos.
- Reportes complejos.
- Legal Hold/retencion como consola administrativa.
- Automatizaciones avanzadas.
- Nueva criptografia o base de datos Mobile.
- Edicion WYSIWYG equivalente a Tiptap.
- Alertas inteligentes autonomas y acciones sin confirmacion.
- Offline authoring o firma offline.

## Criterios de exito

1. Ninguna operacion puede ampliar permisos respecto de web/backend.
2. No quedan documentos descifrados permanentemente por defecto.
3. Firma y mutaciones son idempotentes y auditables.
4. Lista y visor cumplen objetivos de rendimiento en un corpus real.
5. LucIA devuelve solo documentos autorizados y evidencia trazable.
6. Deep links revalidan sesion y autorizacion.
7. iOS y Android pasan pruebas de rotacion, background, revocacion y redes lentas.

## Notificaciones

| Evento | In-app actual/futuro | Push | Email | WhatsApp |
|---|---|---|---|---|
| Solicitud de firma | REQUIRED | PHASE 1.1 | EXISTING/VERIFY | NOT FOUND |
| Documento firmado | REQUIRED | PHASE 1.1 | EXISTING/VERIFY | NOT FOUND |
| Rechazo/cancelacion | REQUIRED | PHASE 1.1 | EXISTING/VERIFY | NOT FOUND |
| Vencimiento/recordatorio | REQUIRED | PHASE 1.1 | EXISTING/VERIFY | NOT FOUND |
| Invitacion | REQUIRED | PHASE 1.1 | EXISTING | NOT FOUND |
| Comentario/evento | OPTIONAL | FUTURE | PARTIAL/VERIFY | NOT FOUND |
| Alerta LucIA | FUTURE | FUTURE | FUTURE | NOT FOUND |

No se implementa proveedor push en discovery. El contenido de lock screen debe ser no sensible por defecto.

Source files: `src/app/api/notifications`, `src/app/api/notificaciones`, `src/components/TopNav.tsx`, `src/lib/ai`.  
Confidence: MEDIUM; se requiere inventario operacional de plantillas/canales antes de activar push.

## Cantidad

Se recomiendan **21 pantallas REQUIRED PHASE 1**, con funciones secundarias agrupadas en sheets para evitar replicar cada pestaña web. El detalle esta en `14-mobile-screen-inventory.md`.

