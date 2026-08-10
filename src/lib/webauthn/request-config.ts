import type { NextRequest } from 'next/server';

export interface WebAuthnRequestConfig {
  origin: string;
  rpId: string;
}

function firstHeaderValue(value: string | null) {
  return value?.split(',')[0]?.trim() || '';
}

function isRpIdValidForHostname(rpId: string, hostname: string) {
  return hostname === rpId || hostname.endsWith(`.${rpId}`);
}

export function getWebAuthnRequestConfig(request: NextRequest): WebAuthnRequestConfig {
  const forwardedHost = firstHeaderValue(request.headers.get('x-forwarded-host'));
  const requestHost = forwardedHost || firstHeaderValue(request.headers.get('host'));
  const forwardedProto = firstHeaderValue(request.headers.get('x-forwarded-proto'));
  const fallbackProtocol =
    requestHost.startsWith('localhost') || requestHost.startsWith('127.0.0.1') ? 'http' : 'https';
  const requestOrigin = new URL(
    `${forwardedProto || fallbackProtocol}://${requestHost || request.nextUrl.host}`
  );

  let origin = requestOrigin.origin;
  const originHeader = request.headers.get('origin');
  if (originHeader) {
    try {
      const suppliedOrigin = new URL(originHeader);
      if (suppliedOrigin.host === requestOrigin.host) origin = suppliedOrigin.origin;
    } catch {
      // Keep the origin reconstructed from trusted proxy headers.
    }
  }

  const hostname = new URL(origin).hostname.toLowerCase();
  const configuredRpId = (process.env.WEBAUTHN_RP_ID || '').trim().toLowerCase();
  const rpId =
    configuredRpId && isRpIdValidForHostname(configuredRpId, hostname) ? configuredRpId : hostname;

  return { origin, rpId };
}

export function getWebAuthnChallengeKey(prefix: string, subject: string, rpId: string) {
  return `${prefix}:${subject}:${rpId}`;
}
