import type { NextRequest } from 'next/server';
import { DocumentAccessError, requireDocumentAccess } from '@/lib/security/document-access';
import { auditViewAccess, hasDocumentViewAccess } from '@/lib/security/document-view-access';

export async function requireDocumentContentAccess(request: NextRequest, documentId: string) {
  const access = await requireDocumentAccess(request, documentId);
  const viewAccess = await hasDocumentViewAccess({
    request,
    service: access.service,
    document: access.document,
    user: access.user,
    accessToken: access.accessToken,
  });
  if (!viewAccess.allowed) {
    await auditViewAccess({
      service: access.service,
      request,
      document: access.document,
      user: access.user,
      action: viewAccess.reason === 'ACCESS_SESSION_EXPIRED'
        ? 'VIEW_ACCESS_SESSION_EXPIRED'
        : 'VIEW_ACCESS_CHALLENGE_SHOWN',
      result: 'denied',
      reason: viewAccess.reason,
    }).catch(() => undefined);
    throw new DocumentAccessError(
      'ACCESS_CODE_REQUIRED',
      'Introduce el código de acceso para visualizar este documento.',
      423,
    );
  }
  return { ...access, viewAccess };
}
