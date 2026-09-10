import { NextRequest, NextResponse } from 'next/server';
import { CloudConvertProvider } from '@/lib/document-conversion/cloudconvert-provider';
import { verifyConversionJobToken } from '@/lib/document-conversion/job-token';
import { conversionErrorResponse, requireConversionUser } from '@/lib/document-conversion/server';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireConversionUser(request);
  if (!user) return NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });

  const { id } = await params;
  const jobToken = request.headers.get('x-document-conversion-token');
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(id) || !verifyConversionJobToken(jobToken, id, user.id)) {
    return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
  }

  try {
    const status = await CloudConvertProvider.fromEnvironment().getJobStatus(id);
    if (status.state === 'failed') {
      return NextResponse.json(
        { state: 'failed', code: status.errorCode || 'CONVERSION_FAILED' },
        { status: 422, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    const headers = new Headers({ 'Cache-Control': 'no-store' });
    if (status.retryAfterMs !== undefined)
      headers.set('Retry-After', String(Math.ceil(status.retryAfterMs / 1000)));
    return NextResponse.json(status, { headers });
  } catch (error) {
    return conversionErrorResponse(error);
  }
}
