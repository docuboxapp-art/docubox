# Comparación de rendimiento de Docubox

Fecha: 2026-09-08

## Matriz PRE y POST

| Métrica | Antes | Después | Mejora |
| --- | ---: | ---: | ---: |
| Llamadas remotas de middleware sin sesión | 1 `getUser` habitual | 0 | -1 por request |
| Validaciones remotas de middleware autenticado | `getUser` + RPC | 1 RPC | -1 por request |
| Bloqueo de fila en validación normal | Sí, `FOR UPDATE` | No | Elimina serialización normal |
| Middleware local sin sesión | N/D | 0.1-0.3 ms en `Server-Timing` | N/D, entorno no equivalente |
| `/mis-documentos` TTFB sin sesión | 285 ms producción | 3.9 ms local producción | N/D, entorno no equivalente |
| `/inicio` TTFB sin sesión | 423 ms producción | 3.9 ms local producción | N/D, entorno no equivalente |
| Consulta de participaciones | todos los documentos globales + filtro Node | filas permitidas por RLS | Menor escala y payload; bytes N/D |
| Consultas auxiliares de participaciones | visibilidad + perfiles | perfiles | -1 query |
| Inicio de listados en `/mis-documentos` | secuencial | paralelo | elimina un waterfall |
| JS inicial `/mis-documentos` | 1082.7 KiB, 12 chunks | 1071.1 KiB, 11 chunks | -11.6 KiB, -1 chunk |
| Rasterización inicial de PDF en Ajustes | hasta 50 páginas | 1 página | hasta 98% menos páginas iniciales |
| Advisor `auth_rls_initplan` | 142 | 141 | -1 |
| Índices duplicados | 1 | 0 | -1 |
| Errores 504 posteriores | 18 eventos PRE en 7 días | N/D | requiere ventana posterior al despliegue |
| LCP autenticado | N/D | N/D | sin RUM disponible |
| INP autenticado | N/D | N/D | sin RUM disponible |
| CLS autenticado | N/D | N/D | sin RUM disponible |
| Payload autenticado | N/D | N/D | no se capturó contenido privado |

No se calcula un porcentaje entre producción PRE y localhost POST. La evidencia equivalente de
producción debe recolectarse después de una ventana con tráfico real.

## Resultado por prioridad

| Prioridad | Resultado |
| --- | --- |
| P0 | Middleware sin llamada remota para tráfico anónimo, una validación autenticada y refresh inválido controlado |
| P1 | RLS antes de transferencia, una query menos, waterfall eliminado y política optimizada |
| P2 | Modal diferido y un chunk inicial menos |
| P3 | Páginas PDF rasterizadas bajo demanda; criptografía y upload intactos |
| P4 | `Server-Timing`, logging lento sin PII, estrategia de caché y carga moderada |

## Seguimiento recomendado

Tras 7 días de tráfico comparable, revisar:

- timeouts y `refresh_token_not_found` de `/middleware`;
- p50, p95 y p99 de la RPC de sesión;
- p50/p95 de listados autenticados;
- payload y número de documentos transferidos por participación;
- Web Vitals por ruta con una solución RUM aprobada.
