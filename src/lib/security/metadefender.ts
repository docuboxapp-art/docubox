import { createHash } from 'crypto';

const METADEFENDER_API_URL = 'https://api.metadefender.com/v4';

type FetchLike = typeof fetch;

type MetaDefenderScan = {
  clean: boolean;
  threat?: string;
  engine: string;
  signatureVersion?: string;
};

type ScanDetails = Record<
  string,
  {
    threat_found?: unknown;
    scan_result_i?: unknown;
    def_time?: unknown;
  }
>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function parseMetaDefenderResult(payload: unknown): MetaDefenderScan | null {
  const root = asRecord(payload);
  const processInfo = asRecord(root.process_info);
  const scanResults = asRecord(root.scan_results);
  const progress = Number(processInfo.progress_percentage ?? 100);
  if (Number.isFinite(progress) && progress < 100) return null;

  const details = asRecord(scanResults.scan_details) as ScanDetails;
  const threats = Object.entries(details)
    .map(([engine, result]) => ({
      engine,
      threat: typeof result.threat_found === 'string' ? result.threat_found.trim() : '',
      result: Number(result.scan_result_i),
      signatureVersion: typeof result.def_time === 'string' ? result.def_time : undefined,
    }))
    .filter((result) => result.threat || (Number.isFinite(result.result) && result.result !== 0));

  if (threats.length > 0) {
    const first = threats[0];
    return {
      clean: false,
      threat: first.threat || `Resultado no limpio (${first.engine})`,
      engine: 'MetaDefender Cloud',
      signatureVersion: first.signatureVersion,
    };
  }

  const aggregateResult = Number(scanResults.scan_all_result_i);
  if (aggregateResult === 0 || (Object.keys(details).length > 0 && !Number.isNaN(progress))) {
    return { clean: true, engine: 'MetaDefender Cloud' };
  }

  throw new Error('metadefender_inconclusive_result');
}

async function requireJson(response: Response, errorCode: string) {
  if (!response.ok) throw new Error(`${errorCode}:${response.status}`);
  return response.json() as Promise<unknown>;
}

export async function scanWithMetaDefender({
  bytes,
  filename,
  apiKey,
  fetchImpl = fetch,
  pollIntervalMs = 2_000,
  maxPolls = 15,
}: {
  bytes: Buffer;
  filename: string;
  apiKey: string;
  fetchImpl?: FetchLike;
  pollIntervalMs?: number;
  maxPolls?: number;
}): Promise<MetaDefenderScan> {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const headers = { apikey: apiKey };
  const hashResponse = await fetchImpl(`${METADEFENDER_API_URL}/hash/${sha256}`, {
    headers,
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  });

  if (hashResponse.ok) {
    const knownResult = parseMetaDefenderResult(await hashResponse.json());
    if (knownResult) return knownResult;
  } else if (hashResponse.status !== 404) {
    throw new Error(`metadefender_hash_lookup_failed:${hashResponse.status}`);
  }

  const uploadBytes = new Uint8Array(bytes.byteLength);
  uploadBytes.set(bytes);
  const uploadResponse = await fetchImpl(`${METADEFENDER_API_URL}/file`, {
    method: 'POST',
    headers: {
      ...headers,
      filename: encodeURIComponent(filename),
      'Content-Type': 'application/octet-stream',
    },
    body: uploadBytes.buffer,
    signal: AbortSignal.timeout(30_000),
    cache: 'no-store',
  });
  const uploadPayload = asRecord(
    await requireJson(uploadResponse, 'metadefender_upload_failed')
  );
  const dataId = typeof uploadPayload.data_id === 'string' ? uploadPayload.data_id : '';
  if (!dataId) throw new Error('metadefender_missing_data_id');

  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    if (attempt > 0 || pollIntervalMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    const resultResponse = await fetchImpl(`${METADEFENDER_API_URL}/file/${dataId}`, {
      headers,
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
    const result = parseMetaDefenderResult(
      await requireJson(resultResponse, 'metadefender_result_failed')
    );
    if (result) return result;
  }

  throw new Error('metadefender_scan_timeout');
}
