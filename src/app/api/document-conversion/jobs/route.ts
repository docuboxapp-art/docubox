import { NextRequest, NextResponse } from 'next/server';
import { CloudConvertProvider } from '@/lib/document-conversion/cloudconvert-provider';
import { issueConversionJobToken } from '@/lib/document-conversion/job-token';
import {
  conversionErrorResponse,
  requireConversionUser,
  reserveOfficeConversionAttempt,
} from '@/lib/document-conversion/server';
import { getDocumentExtension, isOfficeExtension } from '@/lib/document-conversion/types';

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const user = await requireConversionUser(request);
  if (!user) return NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });

  try {
    const body = await request.json();
    const filename = typeof body?.filename === 'string' ? body.filename.trim() : '';
    const fileSize = body?.fileSize;
    const extension = getDocumentExtension(filename);
    if (!filename || filename.length > 180 || !extension || !isOfficeExtension(extension)) {
      return NextResponse.json({ code: 'INVALID_DOCUMENT' }, { status: 400 });
    }
    if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json({ code: 'INVALID_DOCUMENT' }, { status: 400 });
    }

    await reserveOfficeConversionAttempt(user.id);
    const provider = CloudConvertProvider.fromEnvironment();
    const job = await provider.createOfficeToPdfJob({ filename, extension });
    return NextResponse.json(
      {
        jobId: job.id,
        jobToken: issueConversionJobToken(job.id, user.id),
        upload: job.upload,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return conversionErrorResponse(error);
  }
}
