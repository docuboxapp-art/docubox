import { isIP } from 'node:net';

export function isPrivateNetworkAddress(address: string) {
  const normalized = address.toLowerCase();
  if (normalized === '::1' || normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (isIP(normalized) !== 4) return false;
  const octets = normalized.split('.').map(Number);
  return octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
    || octets[0] === 0;
}

export function parsePublicWebhookUrl(value: unknown) {
  try {
    const url = new URL(String(value || ''));
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || !hostname || hostname === 'localhost' || hostname.endsWith('.local')) return null;
    if (isIP(hostname) && isPrivateNetworkAddress(hostname)) return null;
    return url;
  } catch {
    return null;
  }
}
