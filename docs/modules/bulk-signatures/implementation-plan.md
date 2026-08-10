# Firmas Masivas - Plan de implementacion

## 1. Arquitectura actual encontrada

Docubox usa Next.js App Router, Supabase Auth/Postgres/Storage y un layout compartido con navegacion dinamica por modulos. El dominio documental principal vive en `documentos` y se complementa con participantes, workflows, evidencias, firmas, auditoria, identidad, certificacion, notificaciones, plantillas, formularios y expedientes.

El App Market mantiene un unico modulo activo por usuario mediante `user_module_preferences.active_module_id`. Los modulos aparecen condicionalmente en `Sidebar` y `TopNav`.

## 2. Servicios reutilizables

- Autenticacion: clientes Supabase de `src/lib/supabase` y contexto `AuthContext`.
- Multi-tenant: `workspaces`, `workspace_members` y `WorkspaceContext`.
- Documentos: tabla `documentos` y APIs bajo `src/app/api/documentos`.
- Envio y workflow: `api/documentos/enviar`, `workflow_flows` y roles documentales.
- Firma y evidencia: APIs bajo `api/firma`, tablas `signature_evidence`, `document_signatures` y `document_evidence`.
- Identidad: motor y politicas de `identity_*` y `participant_identity_requirements`.
- Certificacion: `document_certifications`, `evidence_manifests` y endpoints de certificaciones.
- Notificaciones: `notifications` y APIs de email, SMS, invitaciones y recordatorios.
- Auditoria: `document_audit_trail`, `document_activity_log` y `security_audit_log`.
- Plantillas, formularios y expedientes: tablas y rutas existentes; se referencian, no se duplican.

## 3. Tablas reutilizables

`documentos`, `documents`, `document_signers`, `document_signatures`, `document_evidence`, `signature_evidence`, `workflow_flows`, `roles_documento`, `notifications`, `form_templates`, `case_files`, `document_certifications`, `evidence_manifests`, `workspace_members` y `workspaces`.

## 4. Nuevas entidades necesarias

- `bulk_signature_campaigns`: configuracion y agregados de una campana.
- `bulk_campaign_items`: referencia entre campana y documento Docubox.
- `bulk_campaign_imports`: archivo, mapeo y resumen de validacion.
- `bulk_campaign_jobs`: lotes de procesamiento, reintentos e idempotencia.
- `bulk_campaign_incidents`: errores aislados y recuperables.
- `bulk_campaign_manifests`: evidencia consolidada de la campana.
- `bulk_signing_sessions` y `bulk_signing_session_items`: autorizacion unica con resultado independiente por documento.
- `bulk_campaign_events`: auditoria del orquestador; no reemplaza la auditoria documental.

No se crean tablas nuevas de documentos, participantes, firmas o evidencia individual.

## 5. Componentes existentes reutilizables

Se reutilizan `AppLayout`, los contextos de autenticacion/workspace/modulos, el patron visual de paginas operativas, iconos Lucide y los clientes Supabase. El modulo agrega componentes propios solo para estado, progreso, navegacion interna, importacion y monitoreo de campanas.

## 6. Riesgos de duplicidad

- Generar PDFs o firmas dentro del modulo: prohibido; se delega al motor documental.
- Copiar datos completos de participantes: se guardan solo configuracion de origen y referencias.
- Crear otra bitacora documental: los eventos de campana solo describen la orquestacion.
- Ejecutar miles de elementos desde el navegador: se modelan jobs paginados e idempotentes.

## 7. Plan de migracion

1. Crear tablas de orquestacion e indices.
2. Activar RLS por membresia del workspace.
3. Crear funciones auxiliares para actualizar contadores y `updated_at`.
4. Agregar permisos conceptuales `bulk_signatures.*` sin alterar el RBAC actual.
5. Aplicar la migracion en Supabase antes de habilitar procesamiento real.

## 8. Plan de seguridad

- Validar sesion y membresia en servidor para cada API.
- Aplicar aislamiento por `workspace_id` en todas las tablas.
- No almacenar `.key`, contrasenas de e.firma ni secretos de firma.
- Usar idempotency keys para crear, lanzar y reintentar.
- Registrar actor, correlation ID, IP y user agent en acciones sensibles.
- Procesar por lotes y limitar tamano/paginacion.
- Mantener storage privado y URLs firmadas temporales mediante los servicios existentes.

## 9. Orden exacto de implementacion

1. Integrar el producto en App Market y navegacion condicional.
2. Crear esquema de datos, RLS e indices.
3. Crear contratos TypeScript y API segura de campanas.
4. Construir dashboard y wizard con guardado local de contingencia.
5. Construir monitor, incidencias y resumen de evidencia.
6. Conectar el worker de generacion con `documentos` y el motor actual.
7. Agregar importador XLSX/CSV, firma por lote, descargas y reportes.
8. Ejecutar pruebas de carga, tenant isolation, idempotencia y seguridad.
