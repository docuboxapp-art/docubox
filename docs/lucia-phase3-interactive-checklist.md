# Checklist interactivo de LucIA Fase 3

## Preparacion

- Usar una cuenta owner/admin, una cuenta miembro sin permisos y un participante autorizado.
- Confirmar el workspace activo antes de cada prueba.
- Preparar un ID real, uno inexistente y uno perteneciente a otro workspace por modulo.
- Revisar `ai_query_logs` despues de cada bloque: no debe contener PII, tokens, OTP, hashes probatorios ni rutas de almacenamiento.

## Recorrido de rutas

Probar en cada ruta una pregunta con datos reales, sin datos, sin permiso, con recurso inexistente, sensible, RAG, de estado y de historial cuando aplique.

- [ ] `/inicio`
- [ ] `/mis-documentos`
- [ ] `/visor-documento/[id]`
- [ ] `/crear-documento`
- [ ] `/firmar-documento/[id]`
- [ ] `/mis-participaciones`
- [ ] `/mis-solicitudes`
- [ ] `/mis-tareas`
- [ ] `/expedientes`
- [ ] `/expedientes/[id]`
- [ ] `/formularios`
- [ ] `/formularios/builder`
- [ ] `/plantillas`
- [ ] `/notificaciones`
- [ ] `/notificaciones-certificadas`
- [ ] `/certificaciones`
- [ ] `/firmas-masivas`
- [ ] `/credit-titles`
- [ ] `/organizacion`
- [ ] `/colabora`
- [ ] `/facturacion`
- [ ] `/reportes`
- [ ] `/mi-perfil`
- [ ] `/configuracion`

## Resultados esperados

- Datos reales: respuesta basada en `evidence_sources` autorizadas.
- Sin datos: `No encontre informacion verificable en Docubox para responder eso.`
- Sin permiso: HTTP 403 y `RESOURCE_ACCESS_DENIED` o `WORKSPACE_ACCESS_DENIED`.
- Recurso inexistente/no visible: HTTP 404 sin revelar existencia fuera del ACL.
- Recurso no indexado: `RESOURCE_NOT_INDEXED`; no se invoca el modelo.
- Pregunta sensible: no se envian CURP, RFC u otros datos al modelo salvo el flujo propio y explicitamente permitido.
- Error de esquema/Supabase: HTTP 503; nunca se transforma en una lista vacia.
- Error del proveedor: HTTP 502 y `AI_PROVIDER_ERROR`.

## Validadores publicos

### `/validar-formulario/[id]`

Recomendacion: mantenerlo publico solamente mediante un identificador opaco respaldado por hash, con expiracion y revocacion. Debe seguir en `deterministic_only`, sin LucIA generativa. Mostrar unicamente vigencia, estado, folio publico, fecha de emision, integridad del artefacto y resultado de verificacion; nunca respuestas, identidad completa, token, IP, firma o evidencia interna.

### `/validar-expediente/[id]`

Recomendacion: mantenerlo publico solamente mediante token/hash verificable, no mediante el UUID interno desnudo. Debe seguir en `deterministic_only`, con LucIA deshabilitada. Mostrar unicamente folio publico, estado de cierre, fecha, version de constancia, resultado de integridad y emisor; nunca documentos, participantes, requisitos internos, historial, hashes de acceso o rutas de almacenamiento.

No se modifica `middleware.ts` en esta fase. Antes de hacer publicas rutas nuevas debe comprobarse que el parametro actual ya sea una capacidad opaca y no un ID interno predecible.
