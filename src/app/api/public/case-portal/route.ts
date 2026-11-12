import { NextRequest, NextResponse } from 'next/server';
import {
  portalAccess,
  readCasePortal,
  preparePortalUpload,
  finishPortalUpload,
} from '@/lib/case-files/portal.server';
import { CaseRuntimeError, isUuid, record, runtimeFailure } from '@/lib/case-files/runtime.server';

export const runtime = 'nodejs';
export const maxDuration = 120;
const headers = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};
export async function GET(request: NextRequest) {
  try {
    return NextResponse.json(
      { data: await readCasePortal(await portalAccess(request, false)) },
      { headers }
    );
  } catch (cause) {
    const f = runtimeFailure(cause);
    return NextResponse.json(f.body, { status: f.status, headers });
  }
}
export async function POST(request: NextRequest) {
  try {
    if (Number(request.headers.get('content-length')) > 8192)
      throw new CaseRuntimeError('CASE_INPUT_INVALID', 'Solicitud demasiado grande.', 413);
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 8192)
      throw new CaseRuntimeError('CASE_INPUT_INVALID', 'Solicitud demasiado grande.', 413);
    const body = record(JSON.parse(raw));
    const access = await portalAccess(request, true);
    if (body.action === 'refresh')
      return NextResponse.json({ data: await readCasePortal(access, true) }, { headers });
    if (body.action === 'prepare')
      return NextResponse.json({ data: await preparePortalUpload(access, body) }, { headers });
    if (body.action === 'finish') {
      const receipt = await finishPortalUpload(access, body.uploadId);
      let portal = null;
      try {
        portal = await readCasePortal(access, true);
      } catch {
        /* durable receipt survives a transient projection outage */
      }
      return NextResponse.json({ data: receipt, portal }, { headers });
    }
    if (body.action === 'form' && isUuid(body.formId)) {
      const result = await access.service.rpc('case_portal_form_token', {
        p_hash: access.hash,
        p_form: body.formId,
      });
      if (result.error) throw result.error;
      return NextResponse.json(
        {
          data: {
            url: `/${result.data.resume || result.data.accessMode === 'public' ? 'form' : 'portal-formulario'}/${result.data.token}`,
          },
        },
        { headers }
      );
    }
    throw new CaseRuntimeError('CASE_INPUT_INVALID', 'Acción inválida.', 422);
  } catch (cause) {
    const f = runtimeFailure(cause);
    return NextResponse.json(f.body, { status: f.status, headers });
  }
}
