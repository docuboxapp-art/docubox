# Estabilización de Organización y Colabora sin cambiar el plan

Se aplicaron correcciones de presión de conexiones y de amplificación de solicitudes. El plan de Supabase, el cómputo, los planes del producto y la prueba vencida de Colabora conservan su estado. No se cambiaron RLS, reglas de sesión, privilegios, esquemas expuestos ni límites de filas.

## Diagnóstico y cambio operativo

El panel de Supabase mostró memoria comprometida de **1,44 GB** con aviso **SEVERE**, uso elevado de swap y CPU indicada de 4,72 % en su informe de la última hora. No se obtuvo la serie de IOPS o conexiones del panel; no se inventan esos datos. La instantánea SQL tenía 23 conexiones de un máximo de 60, sin locks pendientes ni transacciones abiertas largas. Once conexiones ociosas correspondían a Data API.

El pool de PostgREST estaba sin valor explícito, en automático. Se fijó **Pool size = 4** en Data API → Settings y se verificó al recargar. Max rows se mantuvo en 1000 y las selecciones de esquemas, tablas y funciones no se modificaron. Una captura posterior mostró tres conexiones ociosas de Data API; el número de conexiones realmente abiertas puede variar hasta el límite configurado.

El cambio evita reservar tantos backends de base para conexiones ociosas; puede introducir espera en cola durante ráfagas. No es un aumento de cómputo ni un cambio del pool de Supavisor. Referencias oficiales: [pool interno de PostgREST](https://supabase.com/kb/troubleshooting/supavisor-faq-YyP5tI), [configuración de PostgREST](https://supabase.com/docs/reference/api/v1-update-postgrest-service-config), [memoria y swap](https://supabase.com/docs/guides/troubleshooting/memory-and-swap-usage-explained-aPNgm0).

Para revertir únicamente este ajuste, dejar Pool size vacío y guardar, recuperando la configuración automática anterior. No elevar max_connections ni ampliar statement_timeout para ocultar la espera.

## Cambios de aplicación

- Equipos, miembros, secciones de Organización y detalle de Colabora iniciaban lecturas duplicadas durante setup/cleanup de efectos. `deferRead` cancela el inicio de una lectura cuyo efecto ya se desmontó. No almacena resultados ni decisiones de permisos.
- Las verificaciones de Auth idénticas y simultáneas pueden compartir la petición todavía pendiente dentro de un proceso. La clave incluye token y credenciales del proyecto mediante SHA-256; se retira al resolver o fallar, y el mapa está acotado a 128 entradas. Una solicitud posterior vuelve a consultar Auth. El funcionamiento correcto no depende de que diferentes instancias compartan memoria.
- Cada solicitud conserva su cliente con token y sus comprobaciones propias de organización, permisos y ámbito. Se mantiene `getUser`, su límite vigente, la distinción 401/403/503 y la política de sesión del Proxy. No se guardan autorizaciones exitosas para reutilizarlas en solicitudes posteriores.

## Comprobación realizada

La suite `test:organization:completion` aprobó **147 pruebas**, sin fallos ni omisiones. Incluye cancelación de lecturas antes de iniciarse, aislamiento por token/proyecto, nueva validación después de resolver o fallar Auth y permisos distintos para solicitudes que compartieron únicamente una verificación de identidad. TypeScript pasó y el lint no presenta errores nuevos; conserva 19 advertencias previas en componentes existentes.

Con la sesión real del propietario se verificaron seis cargas completas: equipos dos veces, roles, resumen de Colabora dos veces y tareas. Llegar al contenido tomó entre 10,2 y 15,1 segundos en las cargas aprobadas. No se presenta la experiencia como instantánea.

La primera navegación a Tareas superó el plazo de espera del selector de la prueba. El servidor finalmente devolvió 200 y mostró las dos filas: 23,4 s totales, de los cuales 14,3 s correspondieron a compilación local y 8,7 s al handler. La repetición con la ruta compilada pasó. La espera inicial se conserva en los resultados privados, no se elimina para mejorar el total.

En **18:56:57–19:02:28 UTC**, los logs locales de las rutas observadas registraron **26 respuestas, todas 200**. Hubo tres lecturas de `/api/organizacion/structure` para las tres cargas de estructura, frente a las lecturas duplicadas comprobadas anteriormente.

El gateway de Supabase, para la misma ventana y las seis rutas seleccionadas, devolvió **89 respuestas, todas 200**:

| Ruta                    | Muestras | Mediana upstream | Máximo upstream |
| ----------------------- | -------: | ---------------: | --------------: |
| Auth JWKS               |        3 |             9 ms |           10 ms |
| Auth user               |       13 |           339 ms |        1.657 ms |
| Política de sesión      |       45 |           322 ms |        4.727 ms |
| Acceso a Colabora       |        9 |           240 ms |        3.989 ms |
| Permiso de Organización |        6 |         236,5 ms |        1.089 ms |
| Membresías              |       13 |           679 ms |        4.759 ms |

La ventana anterior de 30 minutos había mostrado máximos de 6.543 ms en Auth user, 14.466 ms en política de sesión, 17.521 ms en acceso a Colabora y 43.686 ms en membresías. Son ventanas de duración y tráfico distintos; la comparación es descriptiva, no un benchmark causal ni una garantía de recuperación permanente. Los tiempos upstream no son tiempos de SQL puro.

## Alcance y límites

Las correcciones reducen dos factores comprobados: backends ociosos bajo presión de memoria y solicitudes redundantes de la aplicación. La muestra posterior no presentó nuevos 503, pero no identifica retrospectivamente la causa de cada error histórico ni demuestra estabilidad continua de 24 horas.

El informe posterior de los últimos diez minutos (**18:56:33–19:06:33 UTC**) todavía mostró memoria comprometida de **1,30 GB, SEVERE**, un indicador de memoria de 403,04 MB y CPU de 12,07 %. Los informes horarios anteriores se solapan y no son mediciones instantáneas comparables. Por tanto, no se declara eliminada la presión de memoria ni se atribuye al ajuste una reducción causal exacta. La compilación de producción local también terminó correctamente.

La compilación local en frío agrega demoras que no deben atribuirse a Supabase. El monitor existente conserva su guía y estado privado; esta investigación no declaró recuperación del incidente mediante su evaluador ni cambió su programación. Capturas, CSV y registros privados no se incorporaron a Git. No se enviaron invitaciones ni se ejecutaron firmas reales.
