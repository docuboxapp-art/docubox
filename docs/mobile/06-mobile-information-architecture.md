# Arquitectura de informacion Mobile

## Navegacion primaria

Bottom navigation de cuatro destinos:

1. **Inicio**: resumen accionable y acceso prominente a LucIA.
2. **Documentos**: documentos, participaciones, filtros y papelera contextual.
3. **Actividad**: eventos, solicitudes y alertas documentales.
4. **Perfil**: workspace, sesion, app lock y configuracion minima.

LucIA tiene dos superficies: experiencia completa desde Inicio y accion contextual dentro del visor. No se recomienda un quinto tab porque Inicio/LucIA es el diferenciador principal y evita competir por espacio.

Source files: `src/components/TopNav.tsx`, `src/app/inicio/page.tsx`, `src/components/LucIAChat.tsx`, `src/app/visor-documento/[id]/page.tsx`.  
Confidence: HIGH para funciones web; MEDIUM para composicion movil.

## Rutas web a experiencias Mobile

| Ruta web real | Funcion | Equivalente Mobile | Fase | Confidence |
|---|---|---|---|---|
| `/login` | autenticacion | Auth/Login | REQUIRED | HIGH |
| `/inicio` | panel y sugerencias | Inicio/LucIA | REQUIRED | HIGH |
| `/mis-documentos` | biblioteca, filtros, carpetas, papelera | Documentos + Search/Filters + Trash | REQUIRED | HIGH |
| `/crear-documento` | carga y preparacion | Upload | REQUIRED acotado | HIGH |
| `/visor-documento/[id]` | detalle documental por pestañas | Detail + Viewer + sheets | REQUIRED | HIGH |
| `/firmar-documento/[id]` | revisar y firmar | Signing | REQUIRED cuando aplica | HIGH |
| `/mis-participaciones` | documentos donde participa | filtro Participaciones | REQUIRED | HIGH |
| `/mis-solicitudes` | solicitudes enviadas | Actividad/Solicitudes | OPTIONAL | HIGH |
| `/mis-tareas` | tareas | Actividad | OPTIONAL | MEDIUM |
| `/documentos/[id]/versiones` | versiones | Detail/Versions sheet | OPTIONAL | HIGH |
| `/documentos/[id]/revision` | revision | Viewer/Review | OPTIONAL | HIGH |
| `/verificar-documento` | verificacion publica | Verify | OPTIONAL | HIGH |
| `/verificar-documento/[identifier]` | resultado publico | Verify result/deep link | OPTIONAL | HIGH |
| `/verificar-evidencia/[token]` | evidencia publica | Evidence result/deep link | OPTIONAL | HIGH |
| `/contactos` | contactos | selector durante accion | FUTURE modulo | HIGH |
| `/plantillas`, `/formularios` | builders/catalogos | sin destino principal | OUT OF SCOPE | HIGH |
| `/reportes` | reportes | sin destino en MVP | FUTURE | HIGH |

## Detalle/visor

La pestaña web lateral se transforma en:

- Documento PDF a pantalla completa.
- Header compacto con titulo, paginas y overflow.
- Bottom sheet **Informacion**: Detalles, Metadatos y Versiones.
- Bottom sheet **Personas**: Participantes y Permisos si el usuario puede gestionarlos.
- Bottom sheet **Actividad**: actividad, comunicaciones, vencimientos y notas.
- Bottom sheet **Evidencia**: evidencia, auditoria y descargas autorizadas.
- CTA contextual para firmar, revisar, rechazar o cancelar segun acciones devueltas por backend.
- Boton `Preguntar a LucIA`; una seleccion puede ofrecer explicar/resumir/identificar obligacion o riesgo solo cuando el visor soporte seleccion confiable.

Source files: `src/app/visor-documento/[id]/page.tsx`, `src/app/firmar-documento/[id]/page.tsx`.  
Confidence: HIGH sobre contenido; MEDIUM sobre adaptacion.

## Deep links

Destinos minimos: documento, solicitud de firma, verificacion publica, invitacion/auth callback y alerta LucIA. Todo deep link autenticado revalida sesion y autorizacion en servidor antes de mostrar contenido.

