import { createHash } from 'crypto';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import { createServiceClient } from '@/lib/supabase/server';
import { hasCurrentCollaborationEntitlement } from '@/lib/collaboration/entitlements-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');

function clientIp(request: Request) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    null
  );
}

function storageReference(raw: string | null | undefined) {
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) return { bucket: 'documents', path: raw };
  try {
    const parsed = new URL(raw);
    const match = parsed.pathname.match(
      /\/storage\/v1\/object\/(?:sign|public|authenticated)\/([^/]+)\/(.+)$/
    );
    return match
      ? { bucket: decodeURIComponent(match[1]), path: decodeURIComponent(match[2]) }
      : null;
  } catch {
    return null;
  }
}

async function watermarkPdf(bytes: Uint8Array, label: string) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    const text = `DOCUBOX · ${label} · ${new Date().toISOString()}`;
    page.drawText(text, {
      x: Math.max(18, width * 0.12),
      y: height * 0.48,
      size: Math.max(12, Math.min(22, width / 34)),
      font,
      color: rgb(0.3, 0.42, 0.64),
      opacity: 0.18,
      rotate: degrees(35),
    });
  }
  return pdf.save({ useObjectStreams: true });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string; resourceId: string }> }
) {
  const service = createServiceClient();
  try {
    const { token, resourceId } = await context.params;
    const guestResult = await service
      .from('collaboration_room_guests')
      .select('*,room:collaboration_rooms(*)')
      .eq('token_hash', sha(token))
      .maybeSingle();
    if (guestResult.error) throw guestResult.error;
    const guest = guestResult.data;
    const room = guest?.room as Record<string, unknown> | null;
    if (
      !guest ||
      !room ||
      guest.revoked_at ||
      !['pending', 'active'].includes(guest.status) ||
      room.status !== 'active' ||
      new Date(guest.token_expires_at).getTime() <= Date.now()
    )
      return Response.json({ error: 'El acceso vencio o fue revocado.' }, { status: 410 });
    if (!await hasCurrentCollaborationEntitlement(
      service,
      guest.workspace_id,
      'collaboration_external_rooms',
      true
    )) {
      return Response.json({ error: 'El acceso vencio o fue revocado.' }, { status: 410 });
    }
    if (room.terms_required && !guest.nda_accepted_at) {
      return Response.json(
        { error: 'Debes aceptar los terminos de acceso antes de abrir recursos.' },
        { status: 403 }
      );
    }

    const sessionToken = request.headers.get('x-colabora-session') || '';
    const session = await service
      .from('collaboration_external_sessions')
      .select('id')
      .eq('guest_id', guest.id)
      .eq('session_token_hash', sha(sessionToken))
      .is('revoked_at', null)
      .not('otp_consumed_at', 'is', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (session.error) throw session.error;
    if (!session.data) return Response.json({ error: 'La sesion vencio.' }, { status: 401 });

    const roomResource = await service
      .from('collaboration_room_resources')
      .select('*')
      .eq('workspace_id', guest.workspace_id)
      .eq('room_id', room.id)
      .eq('id', resourceId)
      .maybeSingle();
    if (roomResource.error) throw roomResource.error;
    if (!roomResource.data)
      return Response.json({ error: 'El recurso no esta disponible.' }, { status: 404 });
    const guestPermissions = guest.permissions || {};
    const resourcePermissions = roomResource.data.permissions || {};
    const wantsDownload = new URL(request.url).searchParams.get('download') === '1';
    const canView = guestPermissions.view !== false && resourcePermissions.view !== false;
    const canDownload =
      room.downloads_allowed === true &&
      guestPermissions.download === true &&
      resourcePermissions.download === true;
    if (!canView || (wantsDownload && !canDownload)) {
      await service.from('collaboration_external_events').insert({
        workspace_id: guest.workspace_id,
        room_id: room.id,
        guest_id: guest.id,
        session_id: session.data.id,
        event_type: wantsDownload ? 'resource.download_denied' : 'resource.view_denied',
        resource_type: roomResource.data.resource_type,
        resource_id: roomResource.data.resource_id,
        outcome: 'denied',
        ip_address: clientIp(request),
        user_agent: request.headers.get('user-agent'),
      });
      return Response.json({ error: 'No tienes permiso para esta accion.' }, { status: 403 });
    }

    let source: Record<string, unknown> | null = null;
    if (roomResource.data.resource_type === 'document') {
      const result = await service
        .from('documentos')
        .select('id,nombre,file_url,sealed_pdf_path,file_type')
        .eq('workspace_id', guest.workspace_id)
        .eq('id', roomResource.data.resource_id)
        .maybeSingle();
      if (result.error) throw result.error;
      source = result.data;
    } else if (roomResource.data.resource_type === 'document_version') {
      const result = await service
        .from('document_versions')
        .select('id,storage_path,file_url,mime_type,documentos(nombre)')
        .eq('workspace_id', guest.workspace_id)
        .eq('id', roomResource.data.resource_id)
        .maybeSingle();
      if (result.error) throw result.error;
      source = result.data;
    } else {
      return Response.json(
        { error: 'Este tipo de recurso todavia no tiene una vista externa segura.' },
        { status: 409 }
      );
    }
    if (!source) return Response.json({ error: 'El archivo no existe.' }, { status: 404 });

    const candidates = [
      storageReference(String(source.sealed_pdf_path || '')),
      storageReference(String(source.storage_path || '')),
      storageReference(String(source.file_url || '')),
    ].filter(Boolean) as Array<{ bucket: string; path: string }>;
    let file: Blob | null = null;
    for (const candidate of candidates) {
      const downloaded = await service.storage.from(candidate.bucket).download(candidate.path);
      if (!downloaded.error && downloaded.data) {
        file = downloaded.data;
        break;
      }
    }
    if (!file) return Response.json({ error: 'No se pudo recuperar el archivo.' }, { status: 404 });
    let bytes: Uint8Array<ArrayBufferLike> = new Uint8Array(await file.arrayBuffer());
    if (room.watermark_enabled === true) bytes = await watermarkPdf(bytes, guest.email);

    await service.from('collaboration_external_events').insert({
      workspace_id: guest.workspace_id,
      room_id: room.id,
      guest_id: guest.id,
      session_id: session.data.id,
      event_type: wantsDownload ? 'resource.downloaded' : 'resource.viewed',
      resource_type: roomResource.data.resource_type,
      resource_id: roomResource.data.resource_id,
      ip_address: clientIp(request),
      user_agent: request.headers.get('user-agent'),
      metadata: { watermarked: room.watermark_enabled === true },
    });
    const fileName = String(roomResource.data.display_name || source.nombre || 'documento.pdf')
      .replace(/[^a-zA-Z0-9._ -]/g, '_')
      .slice(0, 120);
    return new Response(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${wantsDownload ? 'attachment' : 'inline'}; filename="${fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`}"`,
        'Cache-Control': 'private, no-store, max-age=0',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return Response.json({ error: 'No se pudo abrir el recurso.' }, { status: 500 });
  }
}
