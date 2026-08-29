const DEFAULT_PUBLIC_APP_URL = 'https://docubox-docubox.vercel.app';
const OBSOLETE_HOSTS = ['firmamax4272.builtwithrocket.new'];

export function getPublicAppUrl(): string {
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();

  if (!configuredUrl || OBSOLETE_HOSTS.some((host) => configuredUrl.includes(host))) {
    return DEFAULT_PUBLIC_APP_URL;
  }

  try {
    const url = new URL(configuredUrl);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      return DEFAULT_PUBLIC_APP_URL;
    }
    return url.origin.replace(/\/$/, '');
  } catch {
    return DEFAULT_PUBLIC_APP_URL;
  }
}

export function getParticipantPortalUrl(portalToken: string): string {
  return `${getPublicAppUrl()}/portal-participante/${encodeURIComponent(portalToken)}`;
}

export function rebaseToPublicAppUrl(urlOrPath: string): string {
  try {
    const parsed = new URL(urlOrPath, DEFAULT_PUBLIC_APP_URL);
    return `${getPublicAppUrl()}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return getPublicAppUrl();
  }
}
