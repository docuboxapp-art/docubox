import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const port = Number(process.env.TSA_PORT || 8080);
const token = process.env.TSA_INTERNAL_TOKEN;
const openssl = process.env.OPENSSL_BIN || (process.platform === 'win32'
  ? 'C:/Program Files/Git/usr/bin/openssl.exe'
  : 'openssl');
const config = resolve(process.env.TSA_CONFIG_PATH || join(import.meta.dirname, 'openssl-tsa.cnf'));
const configDirectory = resolve(config, '..');
const maxRequestBytes = 64 * 1024;

async function issueTimestamp(query) {
  const directory = await mkdtemp(join(tmpdir(), 'docubox-tsa-'));
  try {
    const requestPath = join(directory, 'request.tsq');
    const responsePath = join(directory, 'response.tsr');
    await writeFile(requestPath, query);
    await execFileAsync(openssl, ['ts', '-reply', '-config', config, '-section', 'tsa_config1', '-queryfile', requestPath, '-out', responsePath], {
      cwd: configDirectory,
      timeout: 15_000,
      maxBuffer: 512 * 1024,
    });
    return await readFile(responsePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

createServer(async (request, response) => {
  if (request.url !== '/internal/tsa' || request.method !== 'POST') {
    response.writeHead(404).end();
    return;
  }
  if (token && request.headers.authorization !== `Bearer ${token}`) {
    response.writeHead(401).end();
    return;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxRequestBytes) {
      response.writeHead(413).end();
      request.destroy();
      return;
    }
    chunks.push(chunk);
  }
  try {
    const timestampResponse = await issueTimestamp(Buffer.concat(chunks));
    response.writeHead(200, {
      'content-type': 'application/timestamp-reply',
      'cache-control': 'no-store',
      'content-length': timestampResponse.byteLength,
    }).end(timestampResponse);
  } catch (error) {
    // Do not disclose OpenSSL, path, or key material diagnostics to callers.
    if (process.env.NODE_ENV !== 'production') console.error('Development TSA request failed:', error instanceof Error ? error.message : 'unknown error');
    response.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      .end(JSON.stringify({ error: 'tsa_unavailable' }));
  }
}).listen(port, '0.0.0.0', () => {
  process.stdout.write(`Docubox development TSA listening on ${port}\n`);
});
