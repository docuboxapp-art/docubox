# Segunda fase de Organización y Colabora

Estado: código y pruebas aisladas preparados. Las migraciones de esta entrega y de la primera fase siguen sin aplicarse en Supabase. No se declara terminado todo el entorno.

## Implementación

- Las automatizaciones revalidan a su creador persistido antes de cada acción. Los flujos organizacionales usan el creador del flujo, conservando al iniciador como actor del evento. No se cambia ni se simula una identidad JWT.
- La validación exige fuente activa, organización habilitada, miembro activo sin caducidad, permiso de ejecución y alcance sobre el documento. Crear una tarea comprueba además creación, destinatario activo y asignación; metadatos, webhook, LucIA y NOM-151 requieren sus permisos adicionales.
- Una denegación detiene la ejecución; una consulta de permisos no disponible admite reintento. Los helpers con identidad explícita son privados y el punto de entrada del worker sólo admite `service_role`.
- Las bajas programadas revalidan al solicitante dentro de la transición SQL. Una revocación bloquea la operación antes de transferir activos. El procesador registra esa baja como fallida para evitar reintentos continuos de una operación denegada.
- Las políticas de checklist y dependencias permiten trabajar a roles de equipo autorizados sin ampliar las reglas personales ni la edición estructural de tareas terminales. Se mantienen las políticas restrictivas.
- La asignación por equipo comprueba las unidades del destinatario: la pertenencia del creador no permite asignar por sí sola a otra unidad.
- Las acciones de tareas de Colabora comprueban permisos, bloquean la fila, validan versión y guardan historial en una transacción. Se protegen por separado asignación, prioridad y vencimiento; el permiso de asignar no permite editar otros campos.
- Cerrar una tarea exige checklist y dependencias completos y una constancia del resultado. Las acciones verificadas, como firmar un documento, deben completarse en el recurso canónico. Una tarea futura no se inicia anticipadamente.
- La bandeja de tareas tiene paginación, búsqueda con demora breve, conteos bajo RLS y filtros de prioridad, vencidas, próximas a vencer y asignación personal. Cambiar de organización reinicia el estado de la bandeja.
- Las acciones masivas permiten iniciar, enviar a revisión, cambiar prioridad, vencimiento o responsable, con máximo 25 tareas. Cada tarea conserva su versión y sus permisos; los resultados distinguen éxitos, conflictos y denegaciones. Una reasignación genera una notificación agrupada y deduplicada. Un fallo de notificación no oculta que los cambios ya se guardaron.
- Los reportes permiten CSV, PDF y XLSX mediante las mismas consultas autorizadas, con `reports.export`, auditoría y respuestas privadas sin caché. Las bibliotecas de exportación se cargan sólo al necesitarlas. Excel usa valores numéricos y cadenas literales; CSV neutraliza prefijos de fórmula.

## Verificación

| Comprobación                                           | Resultado                                                                                                 |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Regresión combinada de Organización, Colabora y tareas | 191 pruebas distintas aprobadas                                                                           |
| Comando de esta fase                                   | 81 pruebas aprobadas de API, workers, exportaciones y PostgreSQL aislado                                  |
| Interfaz de Colabora                                   | 33 comprobaciones con componentes reales y servidor sintético                                             |
| Interfaz de Organización de la fase anterior           | 23 comprobaciones; no se cambió el editor en esta fase                                                    |
| Guardar y recargar                                     | Cambio masivo de prioridad conservado; selección descartada tras guardar; filtro actualizado mediante API |
| Teléfono y tablet                                      | Controles masivos y bandejas comprobados en 390 y 820 píxeles                                             |
| PDF                                                    | Generado, abierto con `pdf-lib`, renderizado y revisado visualmente; tabla y pie legibles                 |
| XLSX                                                   | ZIP y XML válidos, números conservados, metadatos y filtros de hoja presentes, sin fórmulas ejecutables   |
| TypeScript y ESLint del ámbito modificado              | Sin errores                                                                                               |

Las comprobaciones usan PGlite, proveedores simulados y Chromium headless. No se enviaron notificaciones o correos a usuarios reales, ni se emitieron firmas, constancias o solicitudes de IA reales.

```powershell
npm run test:organization:completion
npm run test:colabora
node scripts/qa/test-colabora-interface.mjs
```

La instalación de las dependencias aisladas de QA se documenta en [la primera fase](./resource-scopes-first-phase.md). Las pruebas de exportación dejan muestras privadas en `.tmp/colabora-exports/`.

## Activación bloqueada

El proyecto `kbjejiclhgjmiasauxyr` respondió `ACTIVE_HEALTHY` por el plano de control. Una consulta SQL mínima volvió a fallar por timeout. Una lectura de una sola clave del catálogo por la API de datos también agotó su timeout de 8 segundos. No se imprimieron claves, URL privadas ni contenido de usuarios.

No se aplicaron migraciones, modificaron planes, hicieron commits, enviaron cambios a GitHub ni desplegaron cambios en Vercel. La base debe recuperarse e inspeccionarse antes de aplicar, en este orden:

1. `20261118005751_colabora_request_forms_and_delivery.sql`
2. `20261118041214_organization_scoped_resource_access.sql`
3. `20261118054913_organization_worker_permissions_and_task_details.sql`
4. `20261118055514_colabora_atomic_task_actions.sql`

Después deben comprobarse las políticas originales, roles base, privilegios de funciones y tablas, asesores de seguridad y rendimiento. La activación SQL debe preceder al despliegue del código que depende de ella. Las funciones ausentes no tienen un fallback que conceda acceso amplio.

## Pendientes que permanecen abiertos

- Integración transversal de alcances en las rutas nativas y el acceso directo a documentos, formularios y expedientes fuera de Colabora. La aplicación de permisos a fuentes vinculadas no sustituye esa cobertura. Se necesita revisar el esquema y los roles reales antes de modificar sus políticas existentes.
- Comprobación y escritura en la misma transacción en las demás mutaciones privilegiadas y en las rutas antiguas de tareas. Esta entrega cubre la mutación de tareas de Colabora y la transición de bajas; no certifica todas las carreras de permisos de toda la aplicación.
- Aplicación global de redes de confianza, MFA, SSO y duración de sesiones organizacionales. Las opciones guardadas no equivalen a ese control. Falta integrar evidencia por sesión y una fuente de dirección de red confiable; no se debe autorizar mediante metadatos editables ni cabeceras arbitrarias.
- Conexión de permisos del inventario de certificados con las operaciones reales KMS/HSM y pruebas con proveedores reales de SSO, correo, almacenamiento, escáner y facturación. Las pruebas simuladas no certifican esas integraciones.
- Pruebas autenticadas con la organización del usuario, dos organizaciones distintas, miembros vencidos/suspendidos, revocaciones concurrentes, cuenta personal y las migraciones originales del proyecto.

La segunda fase reduce los pendientes de código pero no permite presentar todo el entorno como completo o activo en producción.
