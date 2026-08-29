type DenoEnvironment = {
  get(key: string): string | undefined;
};

declare const Deno: { env: DenoEnvironment };

const DEFAULT_PRODUCTION_ORIGINS = new Set([
  'https://docubox-docubox.vercel.app',
  'https://docubox.mx',
  'https://www.docubox.mx',
]);

const DEFAULT_DEVELOPMENT_ORIGINS = new Set([
  'http://localhost:3000',
  'http://localhost:4028',
  'http://localhost:4030',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:4028',
  'http://127.0.0.1:4030',
]);

function configuredOrigins() {
  const configured = [
    Deno.env.get('DOCUBOX_ALLOWED_ORIGINS'),
    Deno.env.get('SITE_URL'),
    Deno.env.get('APP_URL'),
  ]
    .filter(Boolean)
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim().replace(/\/$/, ''))
    .filter(Boolean);

  return new Set([...DEFAULT_PRODUCTION_ORIGINS, ...configured]);
}

function isProduction() {
  return ['production', 'prod'].includes(
    String(Deno.env.get('DOCUBOX_ENV') || Deno.env.get('ENVIRONMENT') || '').toLowerCase(),
  );
}

export function isAllowedOrigin(origin: string | null) {
  if (!origin) return true;
  const normalized = origin.replace(/\/$/, '');
  return configuredOrigins().has(normalized)
    || (!isProduction() && DEFAULT_DEVELOPMENT_ORIGINS.has(normalized));
}

export function corsHeaders(request: Request) {
  const origin = request.headers.get('Origin');
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };

  if (origin && isAllowedOrigin(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}
