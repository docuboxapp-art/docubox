# LucIA Mobile: vision de producto

## Posicionamiento

LucIA debe ser un **Document Intelligence Assistant** con resultados verificables y acciones acotadas, no un chat generico. El resultado siempre incluye documentos autorizados, evidencia/citas internas y una transicion directa a la pantalla relevante.

```text
Usuario
  -> LucIA Mobile
  -> Authorized Retrieval Layer
  -> Document Intelligence / structured queries / RAG
  -> LLM
  -> respuesta sustentada + documento/accion autorizada
```

Source files: `src/lib/ai/luciaAuthorization.ts`, `luciaQueries.ts`, `evidence.ts`, `documentIntelligence.ts`.  
Confidence: HIGH sobre capacidades base; MEDIUM sobre UX propuesta.

## Casos priorizados

| Caso | Fase | Viabilidad actual | Requisito faltante |
|---|---|---|---|
| Que documentos necesitan mi firma | MVP | HIGH con consulta estructurada | contrato movil de resultado/CTA |
| Buscar por nombre, parte, estado, fecha | MVP | HIGH | paginacion y filtros tipados |
| Preguntar sobre un documento | MVP | HIGH | index coverage + citas estables |
| Resumen ejecutivo | MVP | HIGH | feature flag/observabilidad |
| Fechas, montos, partes, obligaciones | MVP controlado | MEDIUM/HIGH | perfiles procesados y schema versionado |
| Contratos con X durante 2026 | MVP beta | MEDIUM | authorized retrieval DB-side multi-documento |
| Comparar versiones | OPTIONAL PHASE 1 | MEDIUM/HIGH | UX y flag operacional |
| Explicar clausula seleccionada | OPTIONAL PHASE 1 | MEDIUM | visor con seleccion confiable |
| Riesgos y clausulas relevantes | OPTIONAL PHASE 1 | MEDIUM | taxonomia, disclaimers y evaluacion |
| Tags/metadatos sugeridos | OPTIONAL PHASE 1 | HIGH tecnicamente | confirmacion humana antes de escribir |
| Timeline documental | OPTIONAL PHASE 1 | HIGH | DTO unificado de actividad |
| Alertas inteligentes | FUTURE | MEDIUM | scheduler, preferencias, push y evaluacion |
| Crear recordatorio/acciones | FUTURE | MEDIUM | command layer, step-up y confirmacion |

## Experiencia

- Inicio muestra composer prominente, sugerencias reales y resultados en tarjetas documentales compactas.
- Cada respuesta declara alcance: documento actual o conjunto autorizado.
- Los resultados incluyen `Ver documento`, `Abrir firma`, `Ver evidencia` o `Aplicar filtro`; LucIA no ejecuta acciones irreversibles silenciosamente.
- En visor, `Preguntar a LucIA` abre bottom sheet conservando el contexto del documento.
- Sobre seleccion: `Explicar`, `Resumir`, `Obligaciones`, `Riesgos`, `Relacionados`. La seleccion nunca se envia sin mostrar al usuario el alcance.
- Estados sin evidencia deben decir que no hay soporte suficiente; no presentar inferencias como hechos documentales.

## Contrato minimo de respuesta

```ts
type LuciaMobileAnswer = {
  answer: string;
  scope: { workspaceId: string; documentIds: string[] };
  evidence: Array<{ documentId: string; versionId?: string; page?: number; excerpt?: string }>;
  actions: Array<{ type: string; documentId?: string; requiresConfirmation: boolean }>;
  confidence: 'high' | 'medium' | 'low';
  requestId: string;
};
```

Esto es una propuesta de contrato, no codigo existente.

## Guardrails

- `AI AUTHORIZATION = USER AUTHORIZATION` en cada consulta, no solo al iniciar chat.
- Retrieval filtra por tenant, membresia, permisos, participacion, estado y visibilidad antes del LLM.
- Las acciones mutables requieren API normal, autorizacion repetida y confirmacion explicita.
- Registrar prompt/version/modelo/documentos/citas sin guardar secretos ni contenido innecesario.
- Eliminar/redactar PII de logs y limitar retencion.

## Potencial

`LUCIA_MOBILE_POTENTIAL = HIGH`: ya existe una base tecnica diferenciadora. El riesgo principal no es construir el chat, sino garantizar cobertura de indexacion, retrieval autorizado escalable y respuestas sustentadas.

