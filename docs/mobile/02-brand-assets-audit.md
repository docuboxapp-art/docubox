# Auditoria de activos de marca

## Resultado canonico

| Rol | Archivo | Formato/dimensiones | Uso real | Canonico | Source files | Confidence |
|---|---|---|---|---|---|---|
| Logotipo light | `public/assets/images/docubox-logo-2026.png` | PNG 1906x366 | login, enrolamiento, captura movil, plantillas, correos, PDFs y constancias | YES | `src/components/ui/AppLogo.tsx` y usos encontrados en `src` | HIGH |
| Logotipo dark | `public/assets/images/docubox-logo-2026-dark-mode.png` | PNG 1906x367 | variante de `AppLogo` para tema oscuro | YES | `src/components/ui/AppLogo.tsx` | HIGH |
| Isotipo | `public/assets/images/docubox-isotipo-2026.png` | PNG 690x745 | metadata icon/shortcut/apple y shell superadmin | YES | `src/app/layout.tsx`, `src/components/platform-admin/SuperadminShell.tsx` | HIGH |
| `app_logo.png` | `public/assets/images/app_logo.png` | PNG 494x503 | no se encontro uso canonico; identidad visual distinta | NO, LEGACY | busqueda global de referencias y revision visual | HIGH |
| favicon | `public/favicon.ico` | ICO 16x16 | favicon legado | NO como fuente maestra | archivo y metadata actual | MEDIUM |
| Otros PNG Docubox | `public/assets/images/*Docubox*`, `logo-D*` | PNG, tamanos diversos | activos historicos/sin uso canonico vigente | NO | inventario de `public/assets/images` | MEDIUM |

## Declaraciones

```text
CANONICAL_LOGO = public/assets/images/docubox-logo-2026.png
CANONICAL_LOGO_DARK = public/assets/images/docubox-logo-2026-dark-mode.png
CANONICAL_ISOTYPE = public/assets/images/docubox-isotipo-2026.png
APP_ICON_SOURCE = public/assets/images/docubox-isotipo-2026.png
SPLASH_SCREEN_SOURCE = NOT_FOUND
```

No existe una fuente vectorial canonica localizada. El isotipo PNG puede usarse como referencia para generar los tamaños de plataforma, pero el padding, fondo, mascara adaptativa y variantes de store son `MOBILE_ADAPTATION` y requieren aprobacion visual. No debe redibujarse ni sustituirse por `app_logo.png`.

Source files: `public/assets/images`, `src/components/ui/AppLogo.tsx`, `src/app/layout.tsx`.  
Confidence: HIGH para logo/isotipo; HIGH para ausencia de SVG dentro del repositorio auditado.

## Comportamiento esperado en Mobile

- Pantallas light: logotipo light sobre superficie blanca.
- Pantallas dark: logotipo dark solo si se habilita tema oscuro.
- Icono de app: derivado del isotipo, conservando forma y colores; no usar wordmark completo.
- Splash: no hay arte final canonico. Puede proponerse el isotipo/logotipo existente sobre un fondo de token, pero no producirse hasta aprobacion humana.
- Emails y PDFs continúan usando el logotipo del backend; Mobile no cambia esos activos.

## Dependencia humana

Solicitar al custodio de marca el archivo maestro vectorial oficial y aprobar safe area/fondo del icono adaptativo. Esta es una dependencia real antes de publicar en App Store/Google Play, no un bloqueo para construir el prototipo funcional.

