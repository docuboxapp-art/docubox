import { getDocumentExtension, isOfficeExtension, type ConversionErrorCode } from './types';

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const JOB_TIMEOUT_MS = 5 * 60_000;

export class ClientDocumentConversionError extends Error {
  constructor(readonly code: ConversionErrorCode | 'INVALID_DOCUMENT' | 'UNAUTHORIZED') {
    super(code);
  }
}

function errorFromResponse(payload: any): ClientDocumentConversionError {
  const code = typeof payload?.code === 'string' ? payload.code : 'CONVERSION_FAILED';
  return new ClientDocumentConversionError(code as ClientDocumentConversionError['code']);
}

function wait(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true }
    );
  });
}

async function json(response: Response) {
  return response.json().catch(() => ({}));
}

async function uploadDirectly(
  upload: { url: string; parameters: Record<string, string> },
  file: File,
  signal?: AbortSignal
) {
  const form = new FormData();
  Object.entries(upload.parameters).forEach(([name, value]) => form.append(name, value));
  form.append('file', file, file.name);
  const response = await fetch(upload.url, { method: 'POST', body: form, signal });
  if (!response.ok) throw new ClientDocumentConversionError('CONVERSION_FAILED');
}

export async function prepareDocument(
  file: File,
  accessToken: string,
  signal?: AbortSignal
): Promise<File> {
  const extension = getDocumentExtension(file.name);
  if (!extension || file.size <= 0 || file.size > MAX_FILE_SIZE_BYTES) {
    throw new ClientDocumentConversionError('INVALID_DOCUMENT');
  }
  if (extension === 'pdf') return file;

  if (!isOfficeExtension(extension)) throw new ClientDocumentConversionError('INVALID_DOCUMENT');
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  const createResponse = await fetch('/api/document-conversion/jobs', {
    method: 'POST',
    headers,
    body: JSON.stringify({ filename: file.name, fileSize: file.size }),
    signal,
  });
  const created = await json(createResponse);
  if (!createResponse.ok) throw errorFromResponse(created);

  await uploadDirectly(created.upload, file, signal);
  const startedAt = Date.now();
  let nextDelay = 1_500;
  while (Date.now() - startedAt < JOB_TIMEOUT_MS) {
    await wait(nextDelay, signal);
    const response = await fetch(
      `/api/document-conversion/jobs/${encodeURIComponent(created.jobId)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'x-document-conversion-token': created.jobToken,
        },
        signal,
      }
    );
    const status = await json(response);
    if (!response.ok || status.state === 'failed') throw errorFromResponse(status);
    if (status.state === 'finished' && status.file?.url) {
      const pdfResponse = await fetch(status.file.url, { signal });
      if (!pdfResponse.ok) throw new ClientDocumentConversionError('CONVERSION_FAILED');
      const pdf = new Blob([await pdfResponse.arrayBuffer()], { type: 'application/pdf' });
      const signature = new Uint8Array(await pdf.slice(0, 4).arrayBuffer());
      if (signature.join(',') !== '37,80,68,70')
        throw new ClientDocumentConversionError('CONVERSION_FAILED');
      return new File([pdf], file.name.replace(/\.[^.]+$/, '.pdf'), { type: 'application/pdf' });
    }
    const retryAfter = Number(response.headers.get('retry-after'));
    nextDelay =
      Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 60_000) : 1_500;
  }
  throw new ClientDocumentConversionError('CONVERSION_TIMEOUT');
}
