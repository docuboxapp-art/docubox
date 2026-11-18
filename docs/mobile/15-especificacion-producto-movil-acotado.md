# Docubox móvil: especificación funcional acotada

**Estado:** propuesta de producto para iOS y Android; no describe una app nativa ya construida.
**Revisión del repositorio:** 15 de octubre de 2026. Los informes móviles previos tienen corte del 11 de septiembre de 2026; esta propuesta ajusta su alcance, no certifica el estado de producción.

## 1. Decisión de producto

La app debe resolver las tareas que un usuario necesita hacer fuera de su escritorio: **encontrar y revisar documentos, subir un archivo o escaneo, enviar una solicitud sencilla, participar o firmar, acreditar identidad mediante prueba de vida cuando se exija y consultar el resultado y la evidencia**. La web conserva la preparación compleja de documentos y la administración.

El primer lanzamiento debe cubrir **dos recorridos completos**, sin crear un segundo dominio documental:

1. **Participante:** recibe una invitación → se autentica → revisa el documento → cumple el control de identidad requerido → participa, firma, solicita cambios o rechaza → consulta estado y constancia autorizada.
2. **Creador:** importa un PDF o escanea hojas → revisa el PDF → guarda borrador o configura una solicitud sencilla → agrega participantes y vencimiento → envía → sigue el progreso y, si procede, recuerda o cancela.

Una solicitud que necesite campos arbitrarios sobre el PDF, agrupamiento, condiciones o flujo avanzado debe abrirse en la web. La app no debe simular que ha configurado esos elementos.

## 2. Base comprobada y límite de esta revisión

| Hallazgo en el repositorio | Implicación móvil | Fuente |
|---|---|---|
| La web dispone de biblioteca, borradores, participantes, visor, firma, solicitudes y participaciones. | Se reutilizan las reglas y los datos; se diseña una interfaz nativa más pequeña. | [`/mis-documentos`](../../src/app/mis-documentos/page.tsx), [`/crear-documento`](../../src/app/crear-documento/page.tsx), [`/visor-documento/[id]`](../../src/app/visor-documento/%5Bid%5D/page.tsx), [`/firmar-documento/[id]`](../../src/app/firmar-documento/%5Bid%5D/page.tsx), [`/mis-solicitudes`](../../src/app/participation-requests/page.tsx), [`/mis-participaciones`](../../src/app/mis-participaciones/page.tsx) |
| La carga web acepta PDF, Word, Excel y PowerPoint, muestra límite de 25 MB y usa preparación/conversión. | **MVP: PDF y escaneo a PDF.** Office sólo después de validar en móvil cuota, conversión, tamaño y errores. El límite efectivo lo impone el servidor. | [`StepSubir`](../../src/app/crear-documento/components/StepSubir.tsx), [`mapa de dominio`](01-document-domain-map.md) |
| El creador web también configura campos, participantes, agrupamiento, flujo de trabajo y ajustes. | Un flujo móvil sencillo exige un contrato propio de preparación/envío; reutilizar el asistente web tal cual no es viable. | [`crear-documento`](../../src/app/crear-documento/page.tsx) |
| Hay captura **web móvil** por token de identificación y videoselfie, y un proveedor de verificación en servidor. El firmante de formularios puede exigir `require_liveness`. | Se puede aprovechar la orquestación existente, pero **la captura nativa y su vinculación con toda clase de documento aún deben diseñarse y probarse**. Un QR de captura web no equivale a una función nativa terminada. | [`captura-id-movil`](../../src/app/captura-id-movil/%5Btoken%5D/page.tsx), [`verify-provider`](../../src/lib/identity/verify-provider.ts), [`firmar-documento`](../../src/app/firmar-documento/%5Bid%5D/page.tsx) |
| Las rutas HTTP son reutilizables en parte, pero varios contratos dependen de cookies o DTO de la web. | Antes de lanzar, normalizar autenticación móvil, permisos, errores, paginación e idempotencia. | [`mapa de APIs`](10-mobile-api-reuse-map.md), [`auditoría`](00-current-architecture-audit.md) |

**Alcance de la evidencia:** inspección de código y de documentos del repositorio. No se probaron dispositivos, proveedores biométricos, datos de producción ni entrega de notificaciones. «Existe en web» no significa «listo para app».

## 3. Navegación y pantallas

Navegación inferior de **Inicio · Documentos · Actividad · Perfil**. Un botón destacado **Subir** abre cámara o selector de archivos. El diseño conserva estados, colores y lenguaje visual de Docubox, con controles nativos, texto legible y una acción principal por pantalla.

| Pantalla o flujo | Contenido imprescindible |
|---|---|
| Acceso | Inicio de sesión, recuperación/challenge aplicable, selección de espacio, sesión vencida y salida segura. Desbloqueo biométrico local opcional; no sustituye la autenticación del servidor. |
| Inicio | Pendientes de participar, solicitudes propias en curso, próximos vencimientos y acceso a «Subir». Sin panel de administración ni LucIA en la primera versión. |
| Documentos | Segmentos **Míos / Participaciones / Solicitudes**; búsqueda por nombre; filtros básicos de estado y vencimiento; orden; paginación. Carpetas y favoritos sólo como navegación/lectura si el contrato ofrece resultados coherentes. |
| Detalle/visor | PDF, nombre, estado, propietario, fecha, participantes, actividad y acciones permitidas. Zoom, páginas y retorno al mismo punto. Evidencia y constancias sólo cuando existan y el usuario tenga permiso. |
| Subir | Cámara/escáner o Archivos; recortar, enderezar, reordenar y eliminar páginas; previsualizar PDF; nombre y destino; carga con progreso; guardar borrador. |
| Nueva solicitud sencilla | Documento ya cargado; participantes, rol/acción compatible, orden simple si existe, vencimiento y prioridad; resumen y confirmación de envío. Si se requieren campos visuales o reglas avanzadas, continuar en web con el borrador conservado. |
| Participar/firmar | Revisión del PDF, requisitos pendientes, consentimiento y método habilitado por el servidor; firma autógrafa/Click & Sign cuando su flujo esté adaptado y validado; confirmación con identificador de operación. |
| Verificar identidad | Instrucciones, permisos de cámara, captura de identificación cuando aplique, videoselfie/prueba de vida, estado de verificación, reintento o salida asistida. |
| Actividad | Solicitudes y participaciones con progreso, vencimiento y línea de tiempo del documento; notificaciones dentro de la app. |
| Perfil | Usuario, espacio activo, seguridad local, permisos de cámara/notificaciones, ayuda y cerrar sesión. |

Los detalles de participantes, actividad y evidencia se abren como paneles o pantallas secundarias del documento; no requieren una réplica de cada pestaña del visor web. Las tarjetas de solicitudes y participaciones deben compartir la misma jerarquía: **nombre → estado/prioridad → vencimiento → progreso/participantes → acción contextual**.

### Lenguaje visual que debe conservarse

La app **conserva la identidad de Docubox**, aunque reorganice controles para pantallas táctiles. Esta es una regla de implementación y de aceptación visual, basada en [`03-web-design-system-extraction.md`](03-web-design-system-extraction.md), [`04-mobile-design-system-proposal.md`](04-mobile-design-system-proposal.md) y [`02-brand-assets-audit.md`](02-brand-assets-audit.md):

| Elemento | Regla para iOS y Android |
|---|---|
| Marca | Usar logotipo 2026 y su variante oscura cuando corresponda; icono de app derivado del isotipo 2026. No usar `app_logo.png`, identificado como legado. |
| Color | Azul primario `#1E6BFF` para acción principal, selección y foco; `#EFF5FF` para selección suave; superficies blancas, bordes fríos y texto oscuro. Mantener verde/ámbar/rojo para éxito/advertencia/error y la semántica de estados existente. |
| Tipografía | Google Sans / Google Sans Text con archivos licenciados; hasta entonces, fuente de sistema en prototipos. Escala móvil: título 22/28, texto 16/24, secundario 14/20 y caption 12/16. Evitar trasladar tamaños excepcionales de la web, como el rail de 8 px. |
| Forma e iconos | Tarjetas de radio 8 px, campos de 6 px y elementos pequeños de 4 px; avatares y badges pueden ser redondos. Iconografía Lucide equivalente a la web, sin mezclar familias en una misma función. |
| Componentes | Botón primario azul, secundario de fondo blanco con borde, destructivo rojo y estados deshabilitado/cargando; pills y badges de estado con el peso visual de Mis Documentos. Targets táctiles mínimos de 44 pt en iOS y 48 dp en Android. |
| Contenido | En listas y tarjetas usar el mismo vocabulario y colores de estado de la web; texto y símbolo juntos para urgencia, rechazo, vencimiento o éxito. Las acciones irreversibles conservan confirmación clara. |

La adaptación móvil cambia **acomodo, tamaño táctil y navegación**, no la marca. El contraste, Dynamic Type y lectores de pantalla pueden exigir tamaños mayores que los valores base. Las pantallas de referencia para revisión visual son **Mis Documentos, Mis Solicitudes, Mis Participaciones, visor y firma**; la comparación debe hacerse lado a lado en dispositivos reales antes de aprobar la interfaz.

## 4. Alcance por prioridad

**P0 = primera versión utilizable; P1 = ampliación posterior; Web = permanece fuera de la app.**

| Capacidad | Prioridad | Regla funcional / criterio de aceptación |
|---|---|---|
| Acceder y cambiar de espacio | P0 | Ninguna lista ni archivo de otro espacio permanece visible tras cambiar o cerrar sesión. |
| Ver mis documentos, solicitudes y participaciones | P0 | Estados y conteos vienen del backend; búsqueda y paginación no omiten coincidencias en carpetas; cada acción se habilita según permisos efectivos. |
| Importar PDF y escanear a PDF | P0 | Una carga interrumpida muestra estado recuperable; no crea duplicados al reintentar; el usuario puede comprobar páginas antes de guardar. |
| Guardar borrador | P0 | Retorno seguro al borrador con título, archivo y etapa; no se envía accidentalmente. |
| Enviar solicitud sencilla | P0 condicionado | Disponible únicamente si el backend puede expresar firma/participación sin editor de campos. En caso contrario, P0 termina en «Guardar borrador» y la finalización se hace en web. |
| Visor PDF y detalle | P0 | Respeta revocación de acceso, no conserva el PDF descifrado de manera permanente y muestra error recuperable si falla la carga. |
| Participar, aceptar, solicitar cambios o rechazar | P0 condicionado | Sólo aparecen las acciones válidas para usuario, rol y estado; confirmación explícita para efectos finales y registro de actividad. |
| Firma autógrafa y Click & Sign | P0 condicionado | La evidencia se finaliza en servidor, con protección contra doble envío; se prueban coordenadas, rotación, reanudación y documento de varias páginas. |
| Identificación y prueba de vida | P0 para flujos que la exijan | La app captura; **el servidor/proveedor decide** aprobación. Una selfie tomada no cuenta como verificación exitosa. No se permite firmar si la política exige prueba aprobada y vigente. |
| Estado de evidencia y constancia | P0 | Mostrar «preparando», «listo» o error real; nunca afirmar evidencia completada mientras la finalización sigue pendiente. Descarga autorizada y explícita. |
| Notificaciones dentro de la app | P0 | Invitación, cambio de estado, recordatorio y resultado relevante, sin duplicar eventos; los enlaces revalidan sesión y acceso. |
| Push, favoritos, carpetas avanzadas, recordatorios manuales | P1 | Se añaden tras validar permisos, consistencia de listas, límites de envío y privacidad del contenido en pantalla bloqueada. |
| Importación Office, compartir/descargar archivo, verificación pública QR | P1 | Activar tras probar conversión, derechos de salida del documento y contratos de verificación. |
| e.firma SAT | P1 con evaluación de seguridad | Archivos `.cer`/`.key` y contraseña no quedan persistidos; validar disponibilidad, experiencia y controles antes de habilitarla. Mientras tanto, dirigir ese método a la web. |
| Construir/configurar plantillas y formularios; editor libre de campos; agrupamientos/condiciones; informes, facturación y administración | Web | Sin pantalla ni menú móvil. Los documentos creados por esos módulos sí pueden consultarse o firmarse desde la app **si el flujo requerido está soportado**; de lo contrario, abrir la experiencia web adecuada. |

## 5. Reglas detalladas de los recorridos principales

### 5.1 Subir y preparar

1. El usuario elige **Escanear**, **Tomar foto** o **Seleccionar archivo**. Cámara y galería se solicitan sólo cuando se necesitan; Archivos admite PDF en P0.
2. El escaneo convierte páginas a un PDF legible. Antes de cargar se muestran orden, orientación, cantidad de páginas y tamaño. El PDF original importado no se altera sin consentimiento.
3. Se revisan nombre, espacio y destino. La validación de MIME, tamaño, integridad, cuota y análisis de archivo ocurre también en servidor. El móvil no toma decisiones de seguridad por extensión.
4. La interfaz distingue **preparando, cargando, procesando, borrador listo y error**. Cada reintento usa una clave idempotente; un cierre de app no debe producir envíos dobles.
5. Desde el borrador: **Guardar y salir** o **Solicitar participación**. El segundo camino muestra participantes, rol/acción, vencimiento y resumen; no permite enviar si hay campos de firma obligatorios sin configurar.

### 5.2 Revisar y actuar

- La entrada por invitación o notificación abre el documento correcto tras autenticar y revalidar autorización.
- El visor conserva clara la diferencia entre **Cerrar** (volver), **Rechazar** (declinar participación), **Solicitar cambios** y **Cancelar documento** (sólo quien tenga permiso, con efecto sobre el proceso). Nunca se agrupan bajo un verbo ambiguo.
- Antes de firmar se muestran todas las páginas, campos/requisitos pendientes, método admitido y resultado de identidad. El botón final permanece bloqueado mientras falte un requisito.
- Al terminar se muestra un estado confirmado por el servidor. Si la finalización de evidencia queda en curso, se informa «Preparando evidencia» y se puede volver al detalle para consultar el resultado; no se anuncia «todo listo» prematuramente.
- Desinvitar a un participante, cuando la app lo ofrezca en P1, requiere autorización y debe bloquearse si ya revisó o interactuó; su evento debe aparecer en la actividad documental. La interfaz no decide esa elegibilidad por sí sola.

### 5.3 Identificación y prueba de vida

- La política del documento o participante determina si se requiere identificación, videoselfie y vigencia de un enrolamiento previo. Debe mostrarse el motivo y qué se capturará antes de activar la cámara.
- La app guía encuadre, luz, nitidez y permisos; muestra una vista previa y envía el material por un canal autenticado o por una sesión de captura temporal vinculada al documento/participante. Los tokens de captura son de un solo uso o vida corta y nunca se imprimen en logs.
- El backend valida identidad y vida con el proveedor, guarda **resultado, referencia de verificación, tiempo y vínculo al evento documental**. La app sólo presenta `pendiente`, `aprobada`, `no aprobada`, `requiere revisión` o `servicio no disponible`, según el contrato real. Un error técnico no se interpreta como rechazo biométrico.
- Hay límite de intentos y vía de recuperación o asistencia definida por política. Un usuario que deniega la cámara puede volver después; no se le marca como verificado ni se lo fuerza a repetir el documento completo.
- Foto, video e identificación son datos sensibles: no guardarlos en galería, copias de seguridad, telemetría ni caché persistente. Retención, consentimiento y acceso a la evidencia biométrica requieren aprobación legal y de seguridad antes del lanzamiento.

## 6. Contratos y arquitectura necesarios antes de implementar

La opción técnica ya propuesta en [`05-mobile-architecture-proposal.md`](05-mobile-architecture-proposal.md) es **React Native + Expo + TypeScript**, con el backend Docubox actual como fuente única. El cliente nativo no contiene `service_role`, llaves KMS/HSM, claves del proveedor de vida ni algoritmos de firma institucional. Las políticas, permisos, finalización y evidencia se resuelven en servidor; la app sólo captura, presenta y solicita acciones.

| Contrato mínimo | Resultado requerido |
|---|---|
| Autenticación | Bearer/refresh y challenges móviles consistentes; restauración de sesión y cambio de espacio sin depender de cookies del navegador. |
| Listados | Paginación/cursor, búsqueda y filtros ejecutados sobre el mismo alcance autorizado; DTO compacto y estado canónico. |
| Detalle | `allowedActions`, requisitos de firma/identidad, versión documental, estado de evidencia y participantes visibles para ese usuario. |
| Carga | Inicio de carga, progreso/reanudación o cancelación, validación, borrador y estado de conversión; errores tipados y límites informados por backend. Los endpoints QR web de `mobile-upload` no sustituyen este contrato. |
| Mutaciones | `Idempotency-Key`, versión esperada, `requestId` y respuesta diferenciada entre aceptada/en proceso/completada. Incluye enviar, participar, rechazar, cancelar y finalizar firma. |
| Vida/identidad | Sesión de captura vinculada a usuario/documento/participante, política efectiva, intentos, resultado firmado por servidor y referencia auditable. Reutilizar la verificación existente sólo tras comprobar su alcance y equivalencia. |
| Archivos y evidencia | Stream o URL temporal autorizada; caché temporal y estados de generación; descarga/compartir sólo si `allowedActions` lo permite. |

Las rutas candidatas están inventariadas en [`10-mobile-api-reuse-map.md`](10-mobile-api-reuse-map.md). Su clasificación **ADAPT** sigue vigente como hipótesis de implementación; no debe tratarse como API pública móvil ya aprobada. Para autenticación, almacenamiento seguro, revocación y descargas, aplicar [`09-mobile-security-boundaries.md`](09-mobile-security-boundaries.md).

## 7. Requisitos de calidad y aceptación

- **Seguridad:** autorización por petición y por espacio; pruebas negativas de acceso cruzado; secretos de sesión en Keychain/Keystore; limpieza de temporales al salir, revocar o cambiar de cuenta. No firma ni prueba de vida offline.
- **Confiabilidad:** estados vacíos, sin red, sesión expirada, archivo demasiado grande, conversión fallida, proveedor biométrico caído, rechazo genuino y evidencia pendiente se distinguen visualmente. Reintentos sin duplicar documentos, firmas ni invitaciones.
- **Accesibilidad:** lector de pantalla, tamaño dinámico de texto, contraste, objetivos táctiles adecuados, orientación y mensajes que no dependan sólo de color. La captura de vida debe tener salida asistida para quien no pueda completarla.
- **Rendimiento:** listas paginadas, visor probado con PDF real de varias páginas, progreso de subida y uso medido de memoria. Definir umbrales con dispositivos iOS/Android objetivo antes de fijar números contractuales.
- **Privacidad:** push sin título ni contenido sensible por defecto; analítica sin documento, correo, imagen, token o dato biométrico; permisos de cámara explicados en contexto.

**Pruebas de salida obligatorias:** (1) subir/guardar/enviar PDF; (2) invitación → revisar → vida requerida → firmar → evidencia lista; (3) solicitar cambios y rechazar; (4) revocar acceso durante el visor; (5) sesión caducada durante carga/firma; (6) doble toque/reintento; (7) red intermitente; (8) cambio de espacio; (9) captura no aprobada/proveedor caído; (10) documentos complejos con derivación correcta a web. Ejecutarlas en iOS y Android, con cuentas de distintos roles y espacios.

## 8. Secuencia recomendada y decisiones pendientes

1. **Cerrar contratos y permisos** para listado, detalle, archivo, carga y acciones. Probar aislamiento por usuario/espacio y normalizar estados y errores.
2. **Entregar consulta + carga PDF/escaneo + borrador** en dispositivos físicos. Esto ya aporta valor sin depender del editor de campos.
3. **Entregar participación y firma admitidas**, con finalización/evidencia observables y prueba de vida integrada donde la política la exija.
4. **Habilitar envío sencillo** sólo después de probar que todos los documentos resultantes son válidos sin colocar campos en un canvas. Si no se cumple, conservar el borrador y completar en web.
5. Añadir P1 según uso real: push, Office, carpetas/favoritos avanzados, QR público y, tras revisión separada, e.firma SAT.

Antes de comprometer fecha de lanzamiento faltan decisiones de producto y seguridad sobre: **qué tipos de solicitud se pueden enviar sin editor de campos**, métodos de firma iniciales, proveedor/contrato nativo de prueba de vida, política de retención biométrica, descarga/compartir PDF y dispositivos/SO mínimos. Son decisiones de alcance, no trabajo que la app pueda resolver automáticamente.

Este documento define el **alcance móvil acotado solicitado**. Los documentos [`11-mobile-phase-1-scope.md`](11-mobile-phase-1-scope.md) y [`14-mobile-screen-inventory.md`](14-mobile-screen-inventory.md) conservan el inventario amplio de discovery; sus 21 pantallas y LucIA no son compromiso para este primer lanzamiento.
