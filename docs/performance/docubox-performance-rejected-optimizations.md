# Optimizaciones descartadas o pendientes de decisión

Fecha: 2026-09-08

## Seguridad y datos

### Eliminar la validación de sesión del middleware

Rechazada. Reduciría latencia, pero el requisito exige vencimiento validado en servidor.

`DECISION=KEEP_SECURITY`

### Confiar en autorización validada únicamente por frontend o por un header interno

Rechazada. Los endpoints continúan autenticando el token y aplicando RLS.

`DECISION=KEEP_SECURITY`

### Cachear listados privados en CDN

Rechazada. Podría mezclar datos entre usuarios o tenants y servir permisos o estados obsoletos.

`DECISION=NO_CACHE`

### Consolidar las 52 políticas permisivas

Rechazada por ahora. No existe evidencia suficiente de equivalencia semántica para cada owner,
participante, miembro, administrador y acceso público.

`DECISION=KEEP_SECURITY`

## PostgreSQL

### Crear índices para las 401 foreign keys

Rechazada. La cardinalidad y los planes actuales no justifican una creación masiva con costo de
escritura y almacenamiento.

`DECISION=REVIEW_WITH_WORKLOAD`

### Eliminar los 490 índices sin uso observado

Rechazada. El proyecto tiene módulos nuevos y tráfico insuficiente para concluir que no se usan.

`DECISION=KEEP_OR_REVIEW`

### Añadir un índice compuesto nuevo a `documentos`

Rechazada. El plan PRE de propietario ejecutó en 5.38 ms con solo 35 documentos. Se priorizó RLS y
forma de consulta antes de introducir costo de escritura.

`DECISION=NO_SPECULATIVE_INDEX`

## Next.js y experiencia

### Convertir páginas completas a Server Components

No implementada. El 81.2% de los TSX usa cliente, pero las rutas principales contienen estado e
interacción extensa. Una migración masiva sería un refactor de producto sin medición por isla.

`PERFORMANCE_CHANGE_REQUIRES_PRODUCT_DECISION`

### Desactivar globalmente el prefetch de navegación

No implementada. Puede reducir requests, pero también empeorar navegación. Requiere trazas de red
y RUM por enlace.

`PERFORMANCE_CHANGE_REQUIRES_PRODUCT_DECISION`

### Sustituir Google Fonts por otra tipografía o modificar su carga

No implementada para proteger la apariencia exacta. La migración a `next/font` debe acompañarse de
comparación visual y métricas de fuente.

`PERFORMANCE_CHANGE_REQUIRES_PRODUCT_DECISION`

### Aplicar paginación visible nueva

No implementada. La base observada tiene 35 documentos y cambiar la UX del listado está prohibido.
Se recomienda keyset pagination cuando exista volumen que lo justifique y pueda mantenerse la UX.

`PERFORMANCE_CHANGE_REQUIRES_PRODUCT_DECISION`

## PDF, Storage y procesos

### Cambiar upload a browser → Storage directo

No implementada. Requiere diseñar autorización temporal, tenant, MIME, tamaño, antivirus, hashes,
auditoría y recuperación de fallos como un proyecto separado.

`PERFORMANCE_CHANGE_REQUIRES_PRODUCT_DECISION`

### Diferir PAdES, TSA, NOM-151, hashes o evidencia obligatoria

Rechazada. Podría confirmar éxito antes de completar evidencia crítica.

`DECISION=KEEP_CRYPTOGRAPHIC_INTEGRITY`

### Cambiar bibliotecas criptográficas por peso de bundle

Rechazada sin pruebas de equivalencia binaria y criptográfica.

`DECISION=KEEP_CRYPTOGRAPHIC_INTEGRITY`

### Renderizar PDF mediante rangos HTTP y virtualización completa

No implementada. Requiere confirmar soporte de rangos en Storage, signed URLs y comportamiento de
todos los visores. La mejora bajo demanda de `StepAjustes` cubre el costo probado sin cambiar el
contrato de descarga.

`PERFORMANCE_CHANGE_REQUIRES_PRODUCT_DECISION`

## Herramientas

### Migrar inmediatamente `middleware.ts` a `proxy.ts`

No implementada. Next.js 16 marca la convención como deprecada, pero el cambio no resuelve por sí
mismo el timeout y amplía la superficie del cambio. Debe hacerse en una migración dedicada.

`DECISION=DEFER_FRAMEWORK_MIGRATION`
