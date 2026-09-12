# Propuesta de sistema de diseno Mobile

Esta propuesta traduce el lenguaje web existente a componentes nativos. No cambia la marca y no afirma que las adaptaciones sean activos oficiales.

## Principios

1. Conservar `#1E6BFF`, Google Sans/Google Sans Text, superficies blancas, bordes frios y semantica de estados.
2. Priorizar densidad legible y acciones documentales, no una portada de marketing.
3. Usar componentes nativos con targets tactiles minimos de 44pt iOS/48dp Android.
4. Limitar radios a 4/6/8px salvo avatares, badges y controles circulares.
5. Mantener LucIA visible sin ocultar el documento ni sustituir navegacion.

Source files: `tailwind.config.js`, `src/styles/tailwind.css`, `src/components/ui`.  
Confidence: HIGH para herencia; MEDIUM para adaptaciones, que requieren QA nativa.

## Tipografia React Native

| Token | Mobile | Source |
|---|---|---|
| display | 28/34, 500 | MOBILE_ADAPTATION |
| title | 22/28, 500 | MOBILE_ADAPTATION |
| heading | 18/24, 500 | MOBILE_ADAPTATION |
| body | 16/24, 400 | MOBILE_ADAPTATION |
| bodySmall | 14/20, 400 | MOBILE_ADAPTATION desde botones/texto web |
| label | 14/18, 500 | EXISTING + MOBILE_ADAPTATION |
| caption | 12/16, 400 | MOBILE_ADAPTATION; no reutilizar 8px del rail web |

Familia: cargar Google Sans y Google Sans Text desde archivos licenciados/aprobados. Hasta contar con esos archivos, usar fallback de sistema en builds internos; no descargar tipografia en runtime.

## Componentes propuestos

| Componente | Variantes/estado | Medida base | Origen |
|---|---|---|---|
| `Button` | primary, secondary, ghost, destructive; loading/disabled | 48 alto | MOBILE_ADAPTATION |
| `IconButton` | default, selected, destructive | 44/48 cuadrado | MOBILE_ADAPTATION |
| `TextField` | default, focus, error, disabled | 48 minimo | MOBILE_ADAPTATION |
| `DocumentListItem` | normal, selected, urgent, offline metadata | 72 minimo | MOBILE_ADAPTATION basada en listas web |
| `StatusBadge` | mismos estados web | altura 24 | EXISTING semantica, ADAPT visual |
| `Card` | default, actionable | radio 8 | EXISTING |
| `BottomSheet` | medium/full | safe areas + gesto | MOBILE_ADAPTATION |
| `Alert` | info, success, warning, error | contenido flexible | EXISTING semantica |
| `Avatar` | inicial/foto | 32, 40, 48 | ADAPT |
| `EmptyState` | icono, titulo, detalle, CTA | icono 56 | EXISTING |
| `Skeleton` | lista, detalle, visor | dimensiones estables | MOBILE_ADAPTATION |
| `LuciaComposer` | global/contextual, voz, loading | 48 minimo | MOBILE_ADAPTATION |

## Iconografia

Usar `lucide-react-native` como biblioteca principal y conservar nombres semanticos cuando existan. Heroicons y `AppIcon` son implementaciones React DOM y no se comparten. Iconos propios solo para marca o capacidades sin equivalente, con aprobacion.

Source files: `package.json`, `src/components/ui/AppIcon.tsx`, usos de `lucide-react`.  
Confidence: HIGH.

## Tokens

La fuente estructurada es `artifacts/mobile-design-tokens.json`. Cada valor declara `EXISTING` o `MOBILE_ADAPTATION`; las adaptaciones no deben retroalimentar la web durante esta fase.

