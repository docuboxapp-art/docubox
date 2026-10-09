import { isIP } from 'node:net';

export type LoginLocation = {
  city: string | null;
  country: string | null;
  countryCode: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
};

type PriorLogin = {
  device_fingerprint: string;
  city: string | null;
  country: string | null;
};

const UNKNOWN = new Set(['', 'unknown', 'desconocida', 'desconocido', 'red local', 'local', 'local/private network']);

function clean(value: string | null): string | null {
  if (!value) return null;
  try {
    const decoded = decodeURIComponent(value).trim().slice(0, 120);
    return UNKNOWN.has(decoded.toLowerCase()) ? null : decoded;
  } catch {
    return null;
  }
}

function coordinate(value: string | null, maximum: number): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && Math.abs(parsed) <= maximum ? parsed : null;
}

export function clientIp(headers: Headers): string | null {
  const forwarded = process.env.VERCEL === '1'
    ? headers.get('x-vercel-forwarded-for') || headers.get('x-forwarded-for')
    : headers.get('x-forwarded-for');
  const candidate = (forwarded?.split(',')[0] || headers.get('x-real-ip') || '').trim();
  return isIP(candidate) ? candidate : null;
}

export function approximateLoginLocation(headers: Headers, ip: string | null): LoginLocation {
  const empty: LoginLocation = {
    city: null, country: null, countryCode: null, region: null,
    latitude: null, longitude: null, timezone: null,
  };
  // Only Vercel's edge-supplied geolocation is used. Local/private requests have no reliable city.
  if (process.env.VERCEL !== '1' || !ip || isPrivateIp(ip)) return empty;

  const countryCode = clean(headers.get('x-vercel-ip-country'))?.toUpperCase() || null;
  let country: string | null = null;
  if (countryCode && /^[A-Z]{2}$/.test(countryCode)) {
    try {
      country = new Intl.DisplayNames(['en'], { type: 'region' }).of(countryCode) || null;
    } catch {
      country = countryCode;
    }
  }
  if (!country) return empty;
  return {
    city: clean(headers.get('x-vercel-ip-city')),
    country,
    countryCode,
    region: clean(headers.get('x-vercel-ip-country-region')),
    latitude: coordinate(headers.get('x-vercel-ip-latitude'), 90),
    longitude: coordinate(headers.get('x-vercel-ip-longitude'), 180),
    timezone: clean(headers.get('x-vercel-ip-timezone')),
  };
}

function isPrivateIp(ip: string): boolean {
  if (ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:')) return true;
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false;
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 169 && parts[1] === 254);
}

function comparable(value: string | null): string | null {
  const normalized = clean(value);
  return normalized?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es') || null;
}

export function shouldAlertForLocation(
  previous: PriorLogin[],
  fingerprint: string,
  location: LoginLocation
): boolean {
  if (!previous.length || !location.country) return false;
  const country = comparable(location.country);
  const knownLocations = previous.filter((item) => comparable(item.country));
  if (!knownLocations.length) return false;
  if (!knownLocations.some((item) => comparable(item.country) === country)) return true;

  const city = comparable(location.city);
  if (!city || previous.some((item) =>
    comparable(item.country) === country && comparable(item.city) === city
  )) return false;

  // A city-level IP estimate alone is too noisy; require a new browser as a second signal.
  return !previous.some((item) => item.device_fingerprint === fingerprint);
}
