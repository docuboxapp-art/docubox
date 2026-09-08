const DEFAULT_CALENDARS = [
  'https://a.pool.opentimestamps.org',
  'https://b.pool.opentimestamps.org',
  'https://a.pool.eternitywall.com',
  'https://ots.btc.catallaxy.com',
];

function parseIsoDurationMs(value: string) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  if (!match || (!match[1] && !match[2] && !match[3]))
    throw new Error('OPENTIMESTAMPS_UPGRADE_INTERVAL_INVALID');
  return (
    Number(match[1] || 0) * 60 * 60_000 +
    Number(match[2] || 0) * 60_000 +
    Number(match[3] || 0) * 1000
  );
}

export function blockchainEvidenceConfig() {
  const calendars = (process.env.OPENTIMESTAMPS_CALENDARS || DEFAULT_CALENDARS.join(','))
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  for (const calendar of calendars) {
    const url = new URL(calendar);
    if (url.protocol !== 'https:') throw new Error('OPENTIMESTAMPS_CALENDAR_NOT_HTTPS');
    if (url.username || url.password || url.search || url.hash)
      throw new Error('OPENTIMESTAMPS_CALENDAR_INVALID');
  }
  return {
    enabled:
      process.env.DOCUBOX_BLOCKCHAIN_EVIDENCE_ENABLED === 'true' &&
      process.env.OPENTIMESTAMPS_ENABLED === 'true',
    calendars: [...new Set(calendars)],
    cliPath: process.env.OPENTIMESTAMPS_CLI_PATH || 'ots',
    bitcoinVerificationMode: process.env.BITCOIN_VERIFICATION_MODE || 'OTS_COMPATIBLE',
    upgradeIntervalMs: parseIsoDurationMs(process.env.OPENTIMESTAMPS_UPGRADE_INTERVAL || 'PT1H'),
    timeoutMs: Math.min(
      Math.max(Number(process.env.OPENTIMESTAMPS_TIMEOUT_MS || 30000), 5000),
      120000
    ),
  };
}
