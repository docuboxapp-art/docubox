# Extraccion del sistema visual web

## Fuentes de verdad

- `tailwind.config.js`: paleta primary, tipografias, radios y sombras.
- `src/styles/tailwind.css`: variables light/dark, estilos globales y overrides.
- `src/components/ui/AppLogo.tsx`, `AppIcon.tsx`, `AppImage.tsx`, `StatusBadge.tsx`, `EmptyState.tsx`, `MetricCard.tsx`: primitivas compartidas actuales.
- Paginas en `src/app`: patrones de botones, inputs, tarjetas, alertas, modales y tablas.

Confidence: HIGH.

## Colores existentes

| Token conceptual | Valor | Variable/Tailwind | Uso | Source |
|---|---|---|---|---|
| Primary | `#1E6BFF` | `--primary`, `primary-600` | acciones principales, seleccion, foco | ambos archivos |
| Primary 50 | `#EFF5FF` | `primary-50` | fondos seleccionados | `tailwind.config.js` |
| Primary 100 | `#D9E8FF` | `primary-100` | superficies informativas | `tailwind.config.js` |
| Primary 500 | `#347CFF` | `primary-500` | acento alterno | `tailwind.config.js` |
| Primary 700 | `#1557D6` | `primary-700` | pressed/contraste | `tailwind.config.js` |
| Background/surface | `#FFFFFF` | `--background`, `--card` | pagina y tarjetas | `src/styles/tailwind.css` |
| Foreground | `hsl(222.2 84% 4.9%)` | `--foreground` | texto principal | `src/styles/tailwind.css` |
| Muted | `hsl(210 40% 96.1%)` | `--muted` | fondos secundarios | `src/styles/tailwind.css` |
| Muted foreground | `hsl(215.4 16.3% 46.9%)` | `--muted-foreground` | texto secundario | `src/styles/tailwind.css` |
| Border/input | `hsl(214.3 31.8% 91.4%)` | `--border`, `--input` | divisores y campos | `src/styles/tailwind.css` |
| Destructive | `hsl(0 84.2% 60.2%)` | `--destructive` | error/eliminar | `src/styles/tailwind.css` |
| Success | `hsl(142 71% 42%)` | `--success` | confirmacion/operativa | `src/styles/tailwind.css` |
| Warning | `hsl(43 96% 52%)` | `--warning` | advertencia | `src/styles/tailwind.css` |

La paleta primaria completa es 50 `#EFF5FF`, 100 `#D9E8FF`, 200 `#B8D3FF`, 300 `#86B5FF`, 400 `#5494FF`, 500 `#347CFF`, 600 `#1E6BFF`, 700 `#1557D6`, 800 `#1749AD`, 900 `#193F88`, 950 `#102754`.

## Tipografia

- Familia principal: `Google Sans`, luego `Google Sans Text`, `Segoe UI`, Arial, sans-serif.
- Monoespaciada: `IBM Plex Mono`.
- Pesos cargados/empleados: 400, 500, 600 y 700.
- Los botones globales quedan en 14px/500.
- Caption de workspace: 10px; nombre: 13px.
- El rail de visor tiene un override web de 8px causado por ajustes especificos; no es un token oficial para Mobile.
- Tracking esperado: 0; no hay una escala tipografica central completamente normalizada.

Source files: `src/app/layout.tsx`, `tailwind.config.js`, `src/styles/tailwind.css`.  
Confidence: HIGH.

## Forma, sombras y movimiento

| Elemento | Valor existente | Estado |
|---|---|---|
| Radius card `lg` | 8px | canonical candidate |
| Radius `md` | 6px | existing |
| Radius `sm` | 4px | existing |
| Card shadow | `0 1px 3px rgba(0,0,0,.1), 0 1px 2px -1px rgba(0,0,0,.05)` | existing |
| Card hover | `0 4px 12px rgba(0,0,0,.12), 0 2px 4px -1px rgba(0,0,0,.08)` | web only |
| Modal shadow | `0 20px 60px -10px rgba(0,0,0,.25)` | existing |
| Dropdown shadow | `0 8px 24px -4px rgba(0,0,0,.15)` | existing |
| Fade | 200ms | existing |
| Slide-up | 250ms | existing |
| Pulse | 600ms | existing |

Hay inconsistencia entre `rounded-lg`, `rounded-xl`, `rounded-2xl` y `rounded-full`. Para Mobile se normalizan por funcion, sin presentar la inconsistencia como identidad.

## Componentes y madurez

| Familia | Estado real | Hallazgo |
|---|---|---|
| Botones | PARTIAL design system | estilos globales y clases repetidas; no hay primitiva unica |
| Inputs | PARTIAL | patrones consistentes pero ad hoc |
| Cards | PARTIAL | `MetricCard`, mas multiples variantes locales |
| Modales | PARTIAL | implementaciones locales, sin contrato unico |
| Badges | IMPLEMENTED | `StatusBadge` concentra estados principales |
| Empty states | IMPLEMENTED | `EmptyState` reusable |
| Toasts | IMPLEMENTED con multiples librerias | `react-hot-toast` y `sonner`; inconsistencia |
| Dropdowns/menus | PARTIAL | implementaciones de pagina |
| Loaders/skeletons | PARTIAL | loaders presentes; skeleton no uniforme |
| Iconos | IMPLEMENTED | Lucide dominante; Heroicons mediante `AppIcon` |

Conclusion: `DESIGN_SYSTEM_REUSABLE = PARTIAL`. Son reutilizables la marca, tokens, semantica de estados y patrones; no los componentes DOM ni todas las decisiones locales.

