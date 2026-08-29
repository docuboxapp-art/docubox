# Prompt maestro para construir la aplicación base

```text
Actúa como Principal Software Architect, Staff Full-Stack Engineer, Security
Engineer, especialista en Supabase y Product Designer senior.

Debes diseñar e implementar una aplicación SaaS multi-tenant de gestión
documental y firma electrónica llamada [NOMBRE DE LA APLICACIÓN]. La aplicación
debe reproducir la arquitectura, navegación, pantallas, flujos y nivel funcional
de la plataforma base de Docubox, pero sin App Market ni módulos instalables.

No entregues solamente un diseño, wireframes, documentación o datos simulados.
Construye una aplicación funcional de extremo a extremo, conectada a Supabase,
con autenticación, persistencia real, RLS, Storage privado, notificaciones,
auditoría y pruebas.

======================================================================
1. ALCANCE Y EXCLUSIONES
======================================================================

Incluye exclusivamente la plataforma base:

- autenticación y seguridad de cuenta;
- cuenta personal y cuenta empresarial;
- espacios de trabajo;
- organización y miembros para cuentas empresariales;
- dashboard;
- repositorio documental;
- creación y envío de documentos;
- participantes y solicitudes;
- firma electrónica;
- tareas, contactos y reportes;
- visor documental;
- evidencias y constancias del proceso de firma;
- notificaciones internas, correo y recordatorios;
- perfil, configuración, seguridad y facturación;
- portal de participante;
- portal público de verificación.

NO construyas ni menciones como disponibles:

- App Market;
- Formularios Firmables;
- Plantillas;
- Expedientes Digitales;
- Notifica;
- Verificación de identidad o prueba de vida como módulo independiente;
- Colabora o Colabora Pro;
- Firmas Masivas;
- Títulos de Crédito;
- Docubox Certifica;
- LucIA o asistentes de inteligencia artificial;
- ningún menú, tarjeta, ruta, tabla o permiso propio de esos módulos.

No crees componentes vacíos ni enlaces de “próximamente” para lo excluido.

======================================================================
2. STACK OBLIGATORIO
======================================================================

- Next.js con App Router.
- React y TypeScript en modo estricto.
- Tailwind CSS con tokens semánticos.
- Lucide React para iconografía.
- Supabase Auth.
- PostgreSQL de Supabase.
- Row Level Security en todas las tablas de negocio.
- Supabase Storage privado para documentos y evidencias.
- Supabase Realtime para notificaciones y cambios relevantes.
- Route Handlers de Next.js como BFF para operaciones privilegiadas.
- Supabase Edge Functions únicamente cuando aporten aislamiento, ejecución
  asíncrona o integración con proveedores.
- Vercel como destino de despliegue web.
- Servicio backend de correo mediante una interfaz EmailProvider.
- pdf-lib o una biblioteca madura equivalente para operaciones sobre PDF.
- Zod para validar entradas de API y formularios críticos.

No expongas service role, secretos, tokens de proveedores ni credenciales en el
frontend. Ningún secreto debe utilizar un prefijo público.

======================================================================
3. ARQUITECTURA
======================================================================

Construye un monolito modular. Usa esta dirección de dependencias:

UI -> casos de uso -> dominio -> interfaces -> adaptadores externos.

Estructura sugerida:

src/
  app/
    api/
    login/
    registro/
    inicio/
    mis-documentos/
    crear-documento/
    visor-documento/[id]/
    firmar-documento/[id]/
    mis-solicitudes/
    mis-participaciones/
    mis-tareas/
    contactos/
    reportes/
    notifications/
    mi-perfil/
    configuracion/
    facturacion/
    organizacion/
    portal-participante/[token]/
    verificar-documento/
  components/
    layout/
    documents/
    signing/
    security/
    organization/
  contexts/
    AuthContext.tsx
    WorkspaceContext.tsx
    ThemeContext.tsx
    SidebarContext.tsx
  lib/
    auth/
    tenancy/
    documents/
    signing/
    evidence/
    notifications/
    organization/
    security/
    public-verification/
supabase/
  migrations/
  functions/
tests/

No coloques reglas de negocio importantes dentro de componentes React.

======================================================================
4. EXPERIENCIAS
======================================================================

A. Experiencia interna

Debe ser completa, productiva y orientada a trabajo repetido: dashboard,
documentos, filtros, revisión, participantes, actividad, evidencia, reportes,
organización y configuración.

B. Experiencia del participante

Debe ser mobile-first, guiada, clara y sin navegación interna innecesaria. El
participante solo debe ver el documento, sus campos, método de firma, progreso,
ayuda y resultado.

C. Experiencia pública

Debe permitir comprobar un folio o QR y mostrar únicamente datos públicos de
integridad. El documento final solo puede visualizarse cuando fue marcado como
público y está completado.

======================================================================
5. NAVEGACIÓN GLOBAL
======================================================================

Implementa un encabezado de dos niveles en escritorio y una adaptación móvil.

Barra superior:

- logotipo de la aplicación;
- selector de espacio de trabajo;
- buscador global;
- botón de acciones rápidas;
- centro de ayuda;
- pantalla completa;
- selector de tema claro/oscuro;
- notificaciones con contador;
- avatar y menú de cuenta.

Menú principal, en este orden:

1. Inicio -> /inicio
2. Mis Documentos -> /mis-documentos
3. Solicitudes Enviadas -> /mis-solicitudes
4. Mis Participaciones -> /mis-participaciones
5. Tareas Pendientes -> /mis-tareas
6. Mis Contactos -> /contactos
7. Mi organización -> /organizacion, solo en workspace empresarial y para
   owner o admin
8. Reportes -> /reportes

Menú del avatar:

- Mi perfil -> /mi-perfil
- Configuración -> /configuracion
- Plan y facturación -> /facturacion
- Cerrar sesión

No incluyas App Market en ninguna navegación.

El selector de workspace debe mostrar:

- “ESPACIO DE TRABAJO PERSONAL” para la cuenta personal;
- el nombre del usuario como nombre visible del espacio personal;
- nombre de la organización para espacios empresariales;
- tipo de espacio y estado activo en líneas separadas;
- cambio de workspace sin recargar toda la aplicación;
- opción de unirse a un workspace mediante invitación.

En móvil usa menú lateral o drawer. Conserva acceso visible a crear documento,
notificaciones y perfil.

======================================================================
6. PANTALLAS PÚBLICAS Y DE AUTENTICACIÓN
======================================================================

6.1 /login

- Login por correo y contraseña.
- Recuperación de contraseña.
- Login mediante código OTP enviado por correo.
- Al elegir OTP, oculta contraseña, botón normal y opciones adicionales; muestra
  únicamente el flujo OTP y un enlace “Cambiar método”.
- Login WebAuthn/FIDO2 cuando existan credenciales registradas.
- Segundo factor TOTP cuando esté habilitado.
- Mensajes de error humanos sin revelar si una cuenta sensible existe.
- Rate limiting, protección contra enumeración y registro de intentos.
- Página dividida y sobria: mensaje de producto a la izquierda y formulario a la
  derecha; versión móvil de una columna.

6.2 /registro

- Elección entre cuenta personal y empresarial.
- Datos personales, correo, contraseña y aceptación legal.
- Verificación de correo mediante OTP.
- Para cuenta empresarial: nombre de organización y slug editable, normalizado,
  único y validado en servidor.
- La primera cuenta empresarial debe ser owner/administradora del workspace.
- No invites miembros durante el registro. Informa que podrán configurarse
  posteriormente desde Mi organización.
- Crea automáticamente workspace, membership y perfil dentro de una transacción
  o procedimiento idempotente.

6.3 Recuperación y seguridad

- /olvide-contrasena
- restablecimiento mediante token u OTP de un solo uso;
- expiración, intentos máximos y revocación tras uso;
- aviso por correo al cambiar contraseña;
- cierre opcional de otras sesiones.

6.4 /verificar-documento

- Entrada de folio, identificador o lectura de QR.
- Resultado con título, folio, estado, fechas, participantes contabilizados,
  hash SHA-256 completo y eventos públicos permitidos.
- No muestres campos artificiales como “código de verificación”.
- Si el documento es público y está completado, ofrece “Ver documento” y abre el
  PDF dentro del visor propio.
- Si es privado, informa que no puede verse ni descargarse.
- Nunca expongas una URL firmada de Storage en la barra del navegador.

======================================================================
7. PANTALLAS INTERNAS
======================================================================

7.1 /inicio

- Saludo y resumen del workspace activo.
- Indicadores: documentos totales, en proceso, completados, pendientes de mi
  firma y próximos a vencer.
- Acciones rápidas: crear documento, revisar participaciones y abrir tareas.
- Actividad reciente real.
- Documentos recientes.
- Tareas prioritarias.
- Estados de carga, vacío, error y actualización.
- Las métricas deben consultarse por workspace y respetar RLS.

7.2 /mis-documentos

- Repositorio con vistas Todos, Mi espacio, carpetas, favoritos y papelera.
- Tabla con nombre, folio, propietario, participantes, estado, fecha de creación,
  modificación y acciones.
- Filtros por estado, propietario, fecha, carpeta y etiqueta.
- Ordenamiento, paginación y búsqueda en servidor.
- Selección múltiple únicamente donde haya una acción real.
- Acciones: abrir, renombrar, mover, etiquetar, duplicar como derivación, descargar
  según permisos, enviar a papelera y restaurar.
- No muestres borradores de otras personas ni documentos de otro workspace.
- Los originales, cerrados y firmados no pueden sobrescribirse.

7.3 /crear-documento

Implementa un wizard de cuatro pasos:

Paso 1. Subir

- Origen “Equipo de cómputo”.
- Origen “Teléfono” mediante QR y sesión temporal.
- Origen “Docubox” para reutilizar únicamente el archivo original del repositorio.
- Acepta PDF y DOCX dentro de límites configurables.
- Valida MIME real, tamaño, malware y estructura del archivo.
- Calcula SHA-256 backend-side.
- Conserva el original inmutable en Storage privado.
- Al seleccionar desde Docubox, deduplica por documento original, excluye
  borradores y permite: utilizar, ver el original e inspeccionar historial de uso.
- La visualización usa /visor-documento/{id}?archivo=original.

Paso 2. Participantes

- Agregar desde contactos o correo.
- Nombre, correo, rol, método de firma y método de notificación.
- El usuario autenticado puede participar.
- Orden paralelo o secuencial.
- En secuencial solo se invita al primer participante pendiente; al completar,
  se activa e invita al siguiente.
- En paralelo se invita simultáneamente a todos los participantes activos.
- Mensaje personalizado opcional y fecha de vencimiento.
- Validación de duplicados y coherencia de roles.

Paso 3. Ajustes

- Visor PDF y colocación de campos por participante.
- Firma, nombre, fecha, texto, checkbox e iniciales.
- Arrastrar, redimensionar, cambiar página y eliminar campos.
- Configurar recordatorios, vencimiento, zona horaria y privacidad.
- Opción “Hacer público el documento al completarse”. Debe explicar que permite
  mostrar el documento firmado en el portal público; desactivada lo conserva
  privado para consulta y descarga.
- Validar que cada firmante tenga los campos obligatorios correspondientes.

Paso 4. Enviar

- Resumen de archivo, participantes, orden, campos, vencimiento y privacidad.
- Permitir regresar al paso correspondiente.
- Guardar borrador idempotente.
- Al enviar, congelar la versión de trabajo y crear solicitudes.
- Enviar invitación por correo solo a participantes cuyo método lo incluya.
- Evitar correos duplicados mediante idempotency_key.
- Registrar evento de documento enviado.

7.4 /visor-documento/[id]

Diseña un visor principal del PDF con una barra lateral fija sin acción de
contraer. Las opciones deben ser:

- Detalles
- Participantes
- Mensajes
- Actividad
- Vencimientos
- Notas
- Editar, solo si el estado y permiso lo permiten
- Descargas, cuando existan artefactos descargables

Detalles:

- información general, auditoría, ubicación, participantes y estado;
- datos reales, nunca placeholders legales;
- fechas en UTC más presentación en zona local.

Participantes:

- nombre, correo, rol, método, orden, estado y fecha;
- reenviar recordatorio cuando esté permitido;
- descargar “Mi constancia” únicamente para el participante autenticado y firmado;
- no permitir descargar la constancia individual de otra persona.

Mensajes:

- encabezado “Comunicación” separado visualmente de “Participantes”;
- conversación vinculada al documento;
- mensajes en tiempo real;
- estado vacío y formulario accesible.

Actividad:

- bitácora cronológica con actor, acción, fecha, IP cuando sea legalmente
  necesario, user agent resumido y detalles permitidos;
- filtros por tipo de evento;
- la constancia de auditoría debe cerrar eventos en la fecha de completado y no
  incorporar visualizaciones posteriores.

Vencimientos:

- fecha, recordatorios, expiración y acciones permitidas.

Notas:

- notas privadas o compartidas según permiso;
- autor, fecha, edición controlada y auditoría.

Editar:

- únicamente documentos de trabajo no cerrados;
- datos, participantes y campos;
- toda modificación relevante crea versión o evento según su naturaleza.

Descargas:

- documento original;
- documento final firmado cuando exista;
- constancia general del proceso;
- constancia individual del usuario autenticado cuando corresponda;
- constancia de auditoría hasta el cierre;
- XML de evidencia;
- paquete de evidencias.

Los botones solo se habilitan si el artefacto existe y el usuario tiene permiso.
No presentes un archivo como “pendiente de generación automática” indefinidamente:
usa estados queued, processing, available, failed y retry autorizado.

7.5 /mis-solicitudes

- Solicitudes enviadas por el usuario o workspace.
- Estado global, participante actual, avance, vencimiento y última actividad.
- Acciones: abrir, recordar, cancelar según estado y duplicar como derivación.
- Diferencia visual entre paralelo y secuencial.

7.6 /mis-participaciones

- Documentos donde el usuario es participante.
- Estados pendiente, disponible para firmar, esperando turno, firmado, rechazado,
  vencido y cancelado.
- Acción principal contextual: revisar, firmar o consultar.
- Acceso a constancia individual una vez firmado.

7.7 /mis-tareas

- Bandeja unificada de tareas accionables.
- Prioridad, vencimiento, documento, solicitante y estado.
- Filtros Pendientes, Próximas, Completadas y Vencidas.
- Completar una tarea debe ejecutar el caso de uso real asociado.

7.8 /contactos

- Contactos personales y del workspace según permisos.
- Nombre, correo, teléfono, organización, RFC/CURP opcional y etiquetas.
- Alta, edición, archivo, búsqueda y deduplicación.
- Selección reutilizable al crear participantes.
- No exponer contactos de otros tenants.

7.9 /reportes

- Indicadores de volumen, completitud, tiempos de firma, vencimientos y métodos.
- Filtros por periodo, estado, propietario y workspace.
- Gráficas accesibles y tabla de detalle.
- Exportación CSV con autorización y registro de auditoría.
- No calcules métricas masivas en el navegador.

7.10 /notifications

- Bandeja de notificaciones reales.
- Leídas/no leídas, categoría, fecha y vínculo contextual.
- Marcar individualmente o todas como leídas.
- Actualización por Realtime.
- Al abrir una notificación, validar nuevamente permiso sobre el recurso.

7.11 /mi-perfil

- Datos personales y preferencias.
- Firma autógrafa predeterminada.
- Preferencias de estampa por método.
- Seguridad de cuenta: contraseña, TOTP, WebAuthn y dispositivos registrados.
- Revocación real y persistente de credenciales WebAuthn.
- Sesiones e historial de acceso.
- Preferencias de idioma, zona horaria, tema y notificaciones.

7.12 /configuracion

- Configuración general del workspace.
- Usuarios, grupos, roles y permisos para cuenta empresarial.
- Seguridad, sesiones, políticas de acceso y auditoría.
- Notificaciones y recordatorios.
- Integraciones base de correo y webhooks si están configuradas.
- Acciones sensibles con step-up authentication.

7.13 /facturacion

- Plan actual, uso, límites, historial de pagos y datos fiscales.
- No incluir catálogo de módulos.
- Cambio de plan con confirmación y registro de eventos.
- Los límites deben verificarse también en backend.

7.14 /organizacion

Visible solo para workspaces empresariales y usuarios autorizados.

- Perfil y datos legales de la organización.
- Miembros, invitaciones, estado y último acceso.
- Unidades, áreas, cargos y responsables.
- Roles y permisos granulares.
- Políticas de seguridad y firma.
- Branding básico para correos y portales.
- Auditoría administrativa.
- Transferencia de propiedad con step-up y doble confirmación.

No incluyas colaboración, salas, comités ni automatizaciones de Colabora.

======================================================================
8. PORTAL DE PARTICIPANTE Y FIRMA
======================================================================

8.1 /portal-participante/[token]

- Validar token aleatorio, expiración, estado, participante y documento.
- Mostrar bienvenida, documento, rol, checklist y acciones necesarias.
- Permitir registro o comprobación de correo cuando corresponda.
- No mostrar navegación interna de la cuenta.
- Registrar acceso y visualización con privacidad adecuada.

8.2 /firmar-documento/[id]

- Mostrar PDF y campos asignados únicamente al participante activo.
- Bloquear firma fuera de turno en flujo secuencial.
- Métodos:
  a. firma autógrafa digitalizada;
  b. e.firma SAT;
  c. Click & Sign.
- Firma autógrafa: captura real del trazo y consentimiento.
- e.firma: procesar `.cer`, `.key` y contraseña temporalmente en backend o entorno
  seguro; nunca persistir la llave o contraseña.
- Click & Sign: checkbox de aceptación no preseleccionado, versión documental y
  botón “Firmar y aceptar”.
- OTP para confirmar firma cuando la política lo exija.
- Tras firmar: persistir evidencia, sellar el campo visual solicitado, avanzar el
  flujo, enviar la siguiente invitación si es secuencial y completar el documento
  cuando todos hayan terminado.
- No colocar estampas en posiciones no solicitadas.

======================================================================
9. VERSIONADO E INMUTABILIDAD
======================================================================

Distingue:

- archivo original: exactamente lo recibido, nunca se modifica;
- versión de trabajo: editable y preparable;
- versión cerrada: firmada o completada, siempre inmutable.

Cada versión debe conservar:

- id;
- document_id;
- workspace_id;
- version_number;
- kind;
- storage_path;
- SHA-256 completo;
- byte_length;
- MIME real;
- created_by;
- created_at;
- derived_from_document_id y derived_from_version_id cuando corresponda;
- closed_at y closure_reason para versiones cerradas.

Una reutilización de un original debe conservar el mismo hash inicial hasta que
exista una modificación real. Nunca dupliques filas visuales por cada uso del
mismo original; muestra los usos en su historial.

======================================================================
10. CONSTANCIAS Y EVIDENCIA
======================================================================

Genera PDFs con el mismo lenguaje visual de la aplicación, logotipo real, folios
breves con prefijo DBX, paginación y valores completos.

Constancia individual:

- únicamente para el participante correspondiente;
- variante específica para autógrafa, e.firma y Click & Sign;
- participante, rol, método, fecha real, evidencia aplicable, hash completo,
  documento, folio y URL de verificación;
- no inventar RFC, CURP, certificado, OCSP, IP o sello de tiempo.

Constancia general:

- datos del documento y proceso;
- todos los participantes y estados;
- fechas reales de creación, envío, firma y cierre;
- hashes completos del original, final y expediente de evidencia;
- eventos principales hasta el cierre;
- QR y URL propia de verificación;
- fundamento y alcance sin afirmar servicios no configurados.

Constancia de auditoría:

- eventos cronológicos desde creación hasta cierre;
- actor, acción, fecha UTC, IP cuando corresponda y descripción;
- hash del expediente y QR de verificación;
- snapshot inmutable al completarse;
- nunca agregar visualizaciones posteriores al cierre.

XML de evidencia:

- esquema versionado;
- documento, participantes, consentimientos, eventos, hashes y cierre;
- contenido determinista y validable;
- descarga protegida.

======================================================================
11. MODELO DE DATOS MÍNIMO
======================================================================

Antes de crear tablas, busca equivalentes y extiéndelos mediante migraciones no
destructivas.

Entidades mínimas:

- user_profiles
- user_sessions
- auth_security_events
- user_totp_settings
- webauthn_credentials
- workspaces
- workspace_members
- workspace_roles
- workspace_permissions
- organization_profiles
- organization_invitations
- contacts
- documentos
- document_versions
- document_relations
- document_signers
- document_fields
- document_signatures
- participation_requests
- participation_responses
- document_activity_log
- document_audit_trail
- document_notes
- document_chat_messages
- signature_evidence
- document_artifacts
- tasks
- notifications
- notification_deliveries
- subscription_accounts
- usage_records

Incluye índices para tenant, documento, participante, estado, fechas y consultas
de bandejas. Añade constraints para estados y relaciones. No almacenes información
duplicada si puede derivarse de una fuente autoritativa sin afectar auditoría.

======================================================================
12. SEGURIDAD
======================================================================

- Autenticación server-side en rutas protegidas.
- RLS por workspace en todas las tablas de negocio.
- RBAC adicional para mutaciones administrativas.
- Pruebas explícitas de acceso cruzado entre tenants.
- Storage privado con paths por workspace/documento/versión.
- URLs firmadas de corta duración generadas backend-side.
- `Referrer-Policy: no-referrer` en el visor.
- Validación contra SSRF: no aceptar URLs arbitrarias para que el backend las
  descargue.
- CORS limitado a orígenes configurados.
- Rate limiting en login, OTP, invitaciones, firma y verificación pública.
- Idempotencia en envío, recordatorios, firmas, generación de artefactos y cierre.
- Auditoría de operaciones privilegiadas.
- Sanitización de nombres de archivo y contenido mostrado.
- CSP, headers de seguridad y cookies seguras.
- No usar service role como material de cifrado.
- No sobrescribir artefactos cerrados; usar nombres versionados y `upsert: false`.

======================================================================
13. NOTIFICACIONES
======================================================================

Plantillas base con codificación UTF-8, logotipo y lenguaje visual consistente:

- verificación de correo;
- código OTP de acceso;
- invitación a participar;
- recordatorio de participación;
- código OTP para firma;
- documento completado;
- contraseña modificada;
- nuevo dispositivo o evento sensible.

El remitente visible debe ser [NOMBRE DE LA APLICACIÓN]. Los enlaces de invitación
y recordatorio deben apuntar al portal de participante en el dominio configurado,
con el token y documento correctos. Nunca uses localhost en producción.

Implementa una outbox o cola persistente con estados queued, processing, sent,
failed y retry_count. Evita duplicados por evento, participante y canal.

======================================================================
14. LENGUAJE VISUAL
======================================================================

- SaaS moderno, sobrio, empresarial y orientado a operación.
- Fondo general #F8FAFC o neutro equivalente.
- Superficies #FFFFFF.
- Bordes #E2E8F0.
- Texto principal cercano a #18181B.
- Texto secundario #52525B.
- Acento principal #1E6BFF.
- Verde para éxito, ámbar para advertencia y rojo para error/destrucción.
- Google Sans con fallback Segoe UI y Arial.
- Letter spacing 0.
- Radio de cards y paneles de 8 px como máximo habitual.
- Sombras muy discretas; la separación principal se logra con fondo, borde y
  jerarquía.
- No uses gradientes decorativos, orbes, bokeh, cards anidadas ni hero de
  marketing dentro de la aplicación.
- Usa iconos Lucide en botones cuando exista un símbolo conocido.
- Los botones solo deben llevar texto cuando la acción no sea evidente; los
  botones solo-icono requieren tooltip y aria-label.
- Tablas compactas, filtros claros, encabezados consistentes y estados legibles.
- Tema oscuro neutral, sin convertir toda la interfaz en azul o morado.
- Logotipo horizontal en navegación y variante blanca en tema oscuro.
- Todos los textos deben caber en móvil y escritorio sin solaparse.

======================================================================
15. ESTADOS Y ERRORES
======================================================================

Cada pantalla debe implementar:

- loading con skeleton estable;
- empty state útil;
- error con explicación humana y acción de recuperación;
- estado de permiso insuficiente;
- éxito confirmado;
- reintento controlado cuando sea seguro;
- prevención de doble submit;
- feedback de operaciones asíncronas.

No muestres errores crudos de Supabase o proveedores al usuario. Registra un
trace_id y conserva el detalle seguro en backend.

======================================================================
16. PRUEBAS
======================================================================

Implementa como mínimo:

- unitarias para reglas de estados, orden de firma, folios y hashes;
- integración para registro personal/empresarial;
- RLS para propietario, miembro, admin y acceso entre tenants;
- Storage para acceso permitido, denegado y objeto inexistente;
- creación de documento y preservación del original;
- flujo paralelo y secuencial;
- invitación y recordatorio sin duplicados;
- firma de cada método y evidencias correspondientes;
- rechazo, cancelación, vencimiento y recuperación;
- generación y autorización de constancias;
- cierre de auditoría sin eventos posteriores;
- verificación pública de documento público y privado;
- WebAuthn, TOTP, OTP y revocación de dispositivo;
- E2E de registro -> creación -> invitación -> firma -> cierre -> verificación.

Usa Playwright para verificar escritorio y móvil. Comprueba visualmente que no
existan solapamientos, texto cortado, paneles vacíos incorrectos ni controles sin
función.

======================================================================
17. PLAN DE ENTREGA
======================================================================

Trabaja en verticales funcionales pequeñas y verificables:

Fase 1. Base técnica, tokens visuales, Supabase, Auth y RLS.
Fase 2. Cuenta personal/empresarial, workspaces y organización.
Fase 3. App shell, navegación, dashboard y notificaciones.
Fase 4. Repositorio, Storage privado, original y versionado.
Fase 5. Wizard de documento, participantes, campos y envío.
Fase 6. Portal de participante y métodos de firma.
Fase 7. Visor, comunicación, actividad, tareas y vencimientos.
Fase 8. Evidencias, constancias, descargas y verificación pública.
Fase 9. Contactos, reportes, configuración, perfil y facturación.
Fase 10. Hardening, rendimiento, pruebas E2E, accesibilidad y despliegue.

En cada fase:

1. inspecciona lo existente antes de modificar;
2. reutiliza componentes y tablas correctos;
3. crea migraciones pequeñas y reversibles;
4. implementa frontend y backend juntos;
5. añade pruebas;
6. ejecuta typecheck, lint, tests y build;
7. prueba visualmente escritorio y móvil;
8. documenta riesgos y pendientes reales;
9. no declares completa una integración simulada.

======================================================================
18. CRITERIOS DE ACEPTACIÓN FINAL
======================================================================

- No aparece App Market ni ninguno de sus módulos en código visible, navegación
  o permisos de producto.
- Cuenta personal y empresarial funcionan de extremo a extremo.
- La navegación cambia correctamente por workspace y rol.
- Ningún tenant accede a información de otro.
- El original documental nunca se sobrescribe.
- Las versiones y derivaciones son trazables.
- Los flujos paralelo y secuencial envían invitaciones correctamente.
- Los tres métodos de firma generan su evidencia real y correspondiente.
- Las estampas solo aparecen donde fueron colocadas.
- Las constancias contienen datos, IDs, hashes, URLs y fechas reales y completos.
- El visor nunca expone URLs firmadas de Storage.
- El portal público respeta la configuración público/privado.
- Reintentar no duplica documentos, firmas, artefactos ni correos.
- Todas las rutas sensibles validan sesión, tenant, rol y recurso.
- La experiencia móvil del participante es completa.
- No quedan botones decorativos, rutas sin contenido ni datos críticos simulados.
- TypeScript, lint, pruebas y build terminan correctamente.

Empieza auditando el repositorio. Después implementa las fases en orden y no te
detengas en una propuesta: continúa hasta tener verticales funcionales y
verificadas. Si una integración externa requiere credenciales, implementa la
interfaz, persistencia, estados fail-closed, health check y pruebas con un fake
controlado, pero márcala como “No configurada” hasta recibir credenciales reales.
```
