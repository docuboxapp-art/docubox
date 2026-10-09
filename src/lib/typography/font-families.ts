export const TEMPLATE_FONT_FAMILIES = [
  'Arial', 'Arial Black', 'Times New Roman', 'Georgia', 'Garamond', 'Courier New',
  'Verdana', 'Tahoma', 'Trebuchet MS', 'Impact', 'Helvetica', 'Palatino',
  'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Raleway', 'Nunito', 'Poppins',
  'Source Sans 3', 'Merriweather', 'Playfair Display', 'Oswald', 'PT Sans',
  'PT Serif', 'Ubuntu', 'Noto Sans', 'Libre Baskerville', 'Crimson Text',
  'EB Garamond', 'Josefin Sans', 'Quicksand', 'Mulish', 'Barlow', 'Inter',
  'DM Sans', 'Fira Sans', 'Cabin', 'Exo 2', 'Titillium Web', 'Zilla Slab',
  'Spectral', 'Cormorant Garamond', 'Alegreya', 'Lora', 'Arvo', 'Bitter',
  'Karla', 'Rubik', 'Work Sans', 'Manrope', 'Space Grotesk', 'Plus Jakarta Sans',
  'Sora', 'Outfit', 'Figtree', 'Lexend', 'Jost', 'Urbanist', 'Archivo', 'Asap',
  'Heebo', 'Hind', 'Varela Round', 'Comfortaa', 'Pacifico', 'Dancing Script',
  'Caveat', 'Sacramento', 'Great Vibes', 'Satisfy', 'Kaushan Script', 'Lobster',
  'Righteous', 'Fredoka One', 'Boogaloo', 'Indie Flower', 'Patrick Hand',
  'Shadows Into Light', 'Amatic SC', 'Permanent Marker', 'Rock Salt',
  'Special Elite', 'Courier Prime', 'Source Code Pro', 'Fira Code',
  'Space Mono', 'Inconsolata', 'Anonymous Pro', 'Share Tech Mono',
] as const;

export type TemplateFontFamily = (typeof TEMPLATE_FONT_FAMILIES)[number];
export type FormTypography = 'sans' | 'serif' | TemplateFontFamily;

export function isFormTypography(value: unknown): value is FormTypography {
  return value === 'sans' || value === 'serif' ||
    TEMPLATE_FONT_FAMILIES.includes(value as TemplateFontFamily);
}

export function formFontFamily(value: FormTypography): string | undefined {
  if (value === 'sans') return undefined;
  if (value === 'serif') return 'Georgia, serif';
  const fallback = /(?:Serif|Roman|Georgia|Garamond|Palatino|Baskerville|Merriweather|Lora|Arvo|Bitter|Spectral|Alegreya)/i.test(value)
    ? 'serif' : /(?:Mono|Courier|Code|Inconsolata|Anonymous|Elite)/i.test(value)
      ? 'monospace' : 'sans-serif';
  return `"${value}", ${fallback}`;
}

const SYSTEM_FONTS = new Set<string>(TEMPLATE_FONT_FAMILIES.slice(0, 12));

export function formFontStylesheet(value: FormTypography): string | null {
  if (value === 'sans' || value === 'serif' || SYSTEM_FONTS.has(value)) return null;
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(value)}:wght@400;500;600;700&display=swap`;
}
