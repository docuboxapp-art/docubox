export const HELP_ROOT = '/centro-ayuda';

export const HELP_AUDIENCES = {
  participar: 'Firmar o participar',
  gestionar: 'Crear y gestionar documentos',
  organizacion: 'Administrar mi organización',
} as const;

export const HELP_KINDS = {
  guia: 'Guía',
  tutorial: 'Tutorial',
  solucion: 'Solución de problemas',
  pregunta: 'Pregunta frecuente',
  legal: 'Legal y seguridad',
} as const;

export const HELP_CATEGORIES = {
  acceso: {
    title: 'Primeros pasos y acceso',
    description: 'Abre tu invitación, entra a tu cuenta y recupera el acceso.',
  },
  'firmar-y-participar': {
    title: 'Firmar y participar',
    description: 'Conoce tu rol, elige el método disponible y completa tu participación.',
  },
  'crear-y-enviar': {
    title: 'Crear y enviar documentos',
    description: 'Prepara un documento y asigna participantes, plazos y métodos de firma.',
  },
  seguimiento: {
    title: 'Seguimiento y expedientes',
    description: 'Consulta estados, reúne entregas y encuentra las descargas disponibles.',
  },
  'plantillas-y-formularios': {
    title: 'Plantillas y formularios',
    description: 'Reutiliza documentos y recopila respuestas en el espacio de trabajo.',
  },
  'cuenta-y-organizacion': {
    title: 'Cuenta, organización y permisos',
    description: 'Configura tu cuenta, administra el equipo y revisa sus accesos.',
  },
  'solucion-de-problemas': {
    title: 'Solución de problemas',
    description: 'Resuelve fallas de códigos, enlaces, firma y descarga.',
  },
  'legal-y-seguridad': {
    title: 'Aspectos legales y seguridad',
    description: 'Entiende el alcance de las firmas, las evidencias y la conservación.',
  },
} as const;

export type HelpAudience = keyof typeof HELP_AUDIENCES;
export type HelpCategory = keyof typeof HELP_CATEGORIES;
export type HelpKind = keyof typeof HELP_KINDS;

export type HelpFilters = {
  categoria?: HelpCategory;
  audiencia?: HelpAudience;
  tipo?: HelpKind;
};

export type HelpSearchParams = Record<string, string | string[] | undefined>;

export function readHelpFilters(params: HelpSearchParams): HelpFilters {
  const { categoria, audiencia, tipo } = params;
  return {
    categoria: readChoice(HELP_CATEGORIES, categoria),
    audiencia: readChoice(HELP_AUDIENCES, audiencia),
    tipo: readChoice(HELP_KINDS, tipo),
  };
}

function readChoice<T extends object>(choices: T, value: unknown) {
  return typeof value === 'string' && Object.hasOwn(choices, value)
    ? (value as keyof T)
    : undefined;
}

export type HelpSource = { title: string; href: string; scope: string };

export type HelpSection = {
  id: string;
  title: string;
  paragraphs?: readonly string[];
  steps?: readonly string[];
  items?: readonly string[];
};

export type HelpArticle = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  category: HelpCategory;
  section: string;
  kind: HelpKind;
  audiences: readonly HelpAudience[];
  tags: readonly string[];
  searchTerms: readonly string[];
  status: 'draft' | 'published' | 'archived';
  visibility: 'public' | 'internal';
  updatedAt: string;
  reviewedAt: string;
  related: readonly string[];
  sections: readonly HelpSection[];
  requirements?: readonly string[];
  sources?: readonly HelpSource[];
  scope?: string;
  action?: { label: string; href: `/${string}` };
};

export type HelpSearchResult = Pick<HelpArticle, 'slug' | 'title' | 'category' | 'kind'> & {
  excerpt: string;
};

export const HELP_FEEDBACK_REASONS = {
  missing_answer: 'No encontré la respuesta',
  steps_changed: 'Los pasos no coinciden',
  incomplete: 'La información está incompleta',
  unresolved: 'El problema continúa',
} as const;

export function helpArticleHref(slug: string) {
  return `${HELP_ROOT}/articulos/${slug}`;
}

export function contextualHelpHref(slug?: string, audience: HelpAudience = 'participar') {
  const path = slug ? helpArticleHref(slug) : HELP_ROOT;
  return path + '?' + new URLSearchParams({ audiencia: audience, origen: 'flujo' }).toString();
}

export function helpCategoryHref(category: HelpCategory) {
  return category === 'legal-y-seguridad'
    ? `${HELP_ROOT}/${category}`
    : `${HELP_ROOT}/categorias/${category}`;
}

export const HELP_API_ROUTES = [
  '/api/centro-ayuda/buscar',
  '/api/centro-ayuda/valoraciones',
  '/api/centro-ayuda/eventos',
] as const;

export function isHelpPage(pathname: string) {
  return pathname === HELP_ROOT || pathname.startsWith(`${HELP_ROOT}/`);
}

export function isHelpApi(pathname: string) {
  return HELP_API_ROUTES.some((route) => route === pathname);
}
