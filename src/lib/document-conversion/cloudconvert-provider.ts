import {
  type ConversionJobStatus,
  type CreatedConversionJob,
  type DocumentConverter,
  DocumentConversionError,
  type OfficeExtension,
} from './types';

type CloudConvertResponse = {
  data?: any;
  message?: string;
};

const PROVIDER_TIMEOUT_MS = 15_000;

function retryAfterMilliseconds(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.min(at - Date.now(), 60_000));
}

function isSafeUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Maps provider conditions without returning provider details to application callers. */
export function normalizeCloudConvertFailure(input: {
  status?: number;
  message?: unknown;
  retryAfter?: string | null;
  timedOut?: boolean;
}): DocumentConversionError {
  const status = input.status;
  const message = typeof input.message === 'string' ? input.message.toLowerCase() : '';
  const retryAfterMs = retryAfterMilliseconds(input.retryAfter ?? null);

  if (input.timedOut) return new DocumentConversionError('CONVERSION_TIMEOUT', 504);
  if (status === 429 || /rate\s*limit|too many requests/.test(message)) {
    return new DocumentConversionError('CONVERSION_RATE_LIMITED', 429, retryAfterMs);
  }
  if (
    /insufficient\s+(account\s+)?credits|not enough credits|credit balance|quota exceeded/.test(
      message
    )
  ) {
    return new DocumentConversionError('CONVERSION_QUOTA_EXHAUSTED', 503);
  }
  if (!status || status >= 500 || /temporarily unavailable|service unavailable/.test(message)) {
    return new DocumentConversionError('CONVERSION_PROVIDER_UNAVAILABLE', 503, retryAfterMs);
  }
  return new DocumentConversionError('CONVERSION_FAILED', 422);
}

export class CloudConvertProvider implements DocumentConverter {
  constructor(
    private readonly config: { apiKey: string; apiUrl: string },
    private readonly fetcher: typeof fetch = fetch
  ) {}

  static fromEnvironment(environment = process.env): CloudConvertProvider {
    if (environment.OFFICE_CONVERSION_ENABLED !== 'true') {
      throw new DocumentConversionError('CONVERSION_PROVIDER_UNAVAILABLE', 503);
    }
    if (environment.OFFICE_CONVERTER_PROVIDER !== 'cloudconvert') {
      throw new DocumentConversionError('CONVERSION_PROVIDER_UNAVAILABLE', 503);
    }
    const apiKey = environment.CLOUDCONVERT_API_KEY;
    if (!apiKey) throw new DocumentConversionError('CONVERSION_PROVIDER_UNAVAILABLE', 503);
    return new CloudConvertProvider({
      apiKey,
      apiUrl: (environment.CLOUDCONVERT_API_URL || 'https://api.cloudconvert.com/v2').replace(
        /\/$/,
        ''
      ),
    });
  }

  private async request(
    path: string,
    init?: Parameters<typeof fetch>[1]
  ): Promise<CloudConvertResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
      const response = await this.fetcher(`${this.config.apiUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          Accept: 'application/json',
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
          ...init?.headers,
        },
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => ({}))) as CloudConvertResponse;
      if (!response.ok) {
        throw normalizeCloudConvertFailure({
          status: response.status,
          message: payload?.message,
          retryAfter: response.headers.get('retry-after'),
        });
      }
      return payload;
    } catch (error) {
      if (error instanceof DocumentConversionError) throw error;
      if (controller.signal.aborted) {
        throw normalizeCloudConvertFailure({ timedOut: true });
      }
      throw normalizeCloudConvertFailure({});
    } finally {
      clearTimeout(timeout);
    }
  }

  private async assertCreditsAvailable() {
    const account = await this.request('/users/me');
    const credits = account.data?.credits;
    if (typeof credits !== 'number' || !Number.isFinite(credits)) {
      throw new DocumentConversionError('CONVERSION_PROVIDER_UNAVAILABLE', 503);
    }
    // Credits at or below zero are an exhausted balance. The provider remains authoritative for
    // per-job pricing and can still reject a job when its account rules or pricing change.
    if (credits <= 0) throw new DocumentConversionError('CONVERSION_QUOTA_EXHAUSTED', 503);
  }

  async createOfficeToPdfJob(input: {
    filename: string;
    extension: OfficeExtension;
  }): Promise<CreatedConversionJob> {
    await this.assertCreditsAvailable();
    const result = await this.request('/jobs', {
      method: 'POST',
      body: JSON.stringify({
        tasks: {
          'import-office': { operation: 'import/upload' },
          'convert-pdf': {
            operation: 'convert',
            input: 'import-office',
            input_format: input.extension,
            output_format: 'pdf',
            filename: input.filename.replace(/\.[^.]+$/, '.pdf'),
          },
          'export-pdf': { operation: 'export/url', input: 'convert-pdf' },
        },
      }),
    });
    const job = result.data;
    const importTask = Array.isArray(job?.tasks)
      ? job.tasks.find((task: any) => task.name === 'import-office')
      : null;
    const form = importTask?.result?.form;
    if (
      !job?.id ||
      !isSafeUrl(form?.url) ||
      !form?.parameters ||
      typeof form.parameters !== 'object'
    ) {
      throw new DocumentConversionError('CONVERSION_FAILED', 502);
    }
    return { id: String(job.id), upload: { url: form.url, parameters: form.parameters } };
  }

  async getJobStatus(jobId: string): Promise<ConversionJobStatus> {
    const result = await this.request(`/jobs/${encodeURIComponent(jobId)}`);
    const job = result.data;
    const tasks = Array.isArray(job?.tasks) ? job.tasks : [];
    const failedTask = tasks.find((task: any) => task.status === 'error');
    if (failedTask || job?.status === 'error') {
      const error = normalizeCloudConvertFailure({
        // The provider successfully returned a terminal job state. Unknown task errors are failures,
        // not an unavailable provider; recognizable quota and rate-limit messages are still normalized.
        status: 422,
        message: failedTask?.message || job?.message,
      });
      return { state: 'failed', errorCode: error.code, retryAfterMs: error.retryAfterMs };
    }
    if (job?.status === 'finished') {
      const exportTask = tasks.find((task: any) => task.name === 'export-pdf');
      const file = exportTask?.result?.files?.find((candidate: any) => isSafeUrl(candidate?.url));
      if (!file || !isSafeUrl(file.url)) return { state: 'failed', errorCode: 'CONVERSION_FAILED' };
      return {
        state: 'finished',
        file: { url: file.url, filename: String(file.filename || 'documento.pdf') },
      };
    }
    return { state: job?.status === 'processing' ? 'processing' : 'waiting' };
  }
}
