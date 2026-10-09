export function reportLoginDevice(userId: string | undefined | null, accessToken: string | undefined): void {
  if (!userId || !accessToken) return;
  void fetch('/api/security/check-device', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ userId }),
    keepalive: true,
  }).catch(() => undefined);
}
