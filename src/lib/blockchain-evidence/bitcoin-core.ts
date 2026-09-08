import 'server-only';

type RpcResponse<T> = { result?: T; error?: { code: number; message: string } | null };

async function bitcoinRpc<T>(method: string, params: unknown[]): Promise<T> {
  const url = process.env.BITCOIN_RPC_URL;
  const username = process.env.BITCOIN_RPC_USERNAME;
  const password = process.env.BITCOIN_RPC_PASSWORD;
  if (!url || !username || !password) throw new Error('BITCOIN_RPC_NOT_CONFIGURED');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params }),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`BITCOIN_RPC_HTTP_${response.status}`);
  const payload = (await response.json()) as RpcResponse<T>;
  if (payload.error || payload.result === undefined)
    throw new Error(`BITCOIN_RPC_ERROR:${payload.error?.code || 'UNKNOWN'}`);
  return payload.result;
}

export async function resolveBitcoinBlock(height: number) {
  const hash = await bitcoinRpc<string>('getblockhash', [height]);
  const header = await bitcoinRpc<{
    hash: string;
    height: number;
    time: number;
    confirmations: number;
  }>('getblockheader', [hash, true]);
  if (header.hash !== hash || header.height !== height || header.confirmations < 1)
    throw new Error('BITCOIN_BLOCK_NOT_CONFIRMED');
  return { hash, height, attestedAt: new Date(header.time * 1000).toISOString() };
}
