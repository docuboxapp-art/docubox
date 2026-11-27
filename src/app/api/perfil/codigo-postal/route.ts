import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DocumentAccessError, requireDocumentIdentity } from '@/lib/security/document-access';
import { consumeServerRateLimit } from '@/lib/security/server-rate-limit';

const postalEntry = z.object({
  error: z.literal(false),
  response: z.object({
    estado: z.string().max(120),
    municipio: z.string().max(120),
    ciudad: z.string().max(120).nullish(),
    asentamiento: z.string().max(180),
  }),
});

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('cp');
  if (!code || !/^\d{5}$/.test(code)) {
    return NextResponse.json({ error: 'Escribe un código postal de cinco dígitos.' }, { status: 422 });
  }
  try {
    const { user } = await requireDocumentIdentity(request);
    const credential = process.env.COPOMEX_TOKEN;
    if (!credential) throw new Error('provider_unconfigured');
    if (!(await consumeServerRateLimit({
      scope: 'profile-postal-code',
      identifiers: [user.id],
      limit: 30,
      windowSeconds: 60,
    }))) {
      return NextResponse.json({ error: 'Espera un momento antes de buscar otro código postal.' }, { status: 429 });
    }
    const url = new URL(`https://api.copomex.com/query/info_cp/${code}`);
    url.searchParams.set('token', credential);
    const response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(4500)]),
      redirect: 'error',
    });
    if (!response.ok && response.status !== 404) throw new Error('provider_unavailable');
    const entries: unknown = response.ok ? await response.json() : [];
    const records = Array.isArray(entries) ? entries.slice(0, 500).flatMap((entry) => {
      const parsed = postalEntry.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    }) : [];
    if (!records.length) return NextResponse.json({ error: 'Código postal no encontrado.' }, { status: 404 });
    return NextResponse.json(records, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof DocumentAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: 'El autocompletado no está disponible. Captura el domicilio manualmente.' }, { status: 503 });
  }
}
