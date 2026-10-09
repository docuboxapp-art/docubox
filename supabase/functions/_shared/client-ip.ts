function isValidIp(value: string): boolean {
  const ipv4Parts = value.split('.');
  if (
    ipv4Parts.length === 4 &&
    ipv4Parts.every((part) => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255)
  ) {
    return true;
  }

  if (!value.includes(':')) return false;
  try {
    return Boolean(new URL(`http://[${value}]/`).hostname);
  } catch {
    return false;
  }
}

export function getClientIp(headers: Headers): string | null {
  for (const name of ['x-forwarded-for', 'cf-connecting-ip', 'x-real-ip']) {
    const candidate = headers.get(name)?.split(',')[0]?.trim();
    if (candidate && isValidIp(candidate)) return candidate;
  }
  return null;
}
