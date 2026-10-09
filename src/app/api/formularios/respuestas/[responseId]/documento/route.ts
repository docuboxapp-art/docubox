import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';
import {
  documentEncryptionPolicy,
  encryptAndUploadDocumentObject,
} from '@/lib/crypto/document-encryption';
import { initializeCollaborationDocumentVersion } from '@/lib/collaboration/documents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ responseId: string }> }
) {
  try {
    const { responseId } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(responseId))
      return NextResponse.json({ error: 'Respuesta inválida.' }, { status: 400 });
    const authorization = request.headers.get('authorization') || '';
    const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || '';
    if (!bearer)
      return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });
    const service = createServiceClient();
    const serviceCall = Boolean(bearer && bearer === process.env.SUPABASE_SERVICE_ROLE_KEY);
    let requester: { id: string; email: string } | null = null;
    let canManageResponse = false;
    if (!serviceCall) {
      const anon = createAnonClient(bearer);
      const {
        data: { user },
        error: authError,
      } = await anon.auth.getUser();
      if (authError || !user || user.is_anonymous || !user.email_confirmed_at || !user.email)
        return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });
      requester = { id: user.id, email: user.email.trim().toLowerCase() };
      const { data: visible } = await anon
        .from('form_responses')
        .select('id')
        .eq('id', responseId)
        .maybeSingle();
      canManageResponse = Boolean(visible);
    }

    const { data: initialResponse, error: responseError } = await service
      .from('form_responses')
      .select(
        'id,workspace_id,template_id,token_id,document_id,pdf_output_path,pdf_output_hash,submitted_at,status'
      )
      .eq('id', responseId)
      .single();
    if (responseError || !initialResponse)
      return NextResponse.json({ error: 'Respuesta no encontrada.' }, { status: 404 });
    if (requester && !canManageResponse) {
      const { data: recipient } = await service.from('form_tokens')
        .select('recipient_email,recipient_user_id,used_at')
        .eq('id', initialResponse.token_id).maybeSingle();
      if (!recipient?.used_at || recipient.recipient_email.trim().toLowerCase() !== requester.email ||
        (recipient.recipient_user_id && recipient.recipient_user_id !== requester.id))
        return NextResponse.json({ error: 'Esta respuesta no pertenece a tu cuenta.' }, { status: 403 });
    }
    let response = initialResponse;
    if (!response.pdf_output_path || !response.pdf_output_hash) {
      const generation = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/generate-form-pdf`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ response_id: responseId }),
        }
      );
      if (!generation.ok)
        return NextResponse.json(
          { error: 'No se pudo generar el PDF de esta respuesta.' },
          { status: 502 }
        );
      const refreshed = await service
        .from('form_responses')
        .select(
          'id,workspace_id,template_id,token_id,document_id,pdf_output_path,pdf_output_hash,submitted_at,status'
        )
        .eq('id', responseId)
        .single();
      if (refreshed.error || !refreshed.data?.pdf_output_path || !refreshed.data?.pdf_output_hash) {
        return NextResponse.json({ error: 'El PDF aún no está disponible.' }, { status: 409 });
      }
      response = refreshed.data;
    }
    const { data: form, error: formError } = await service
      .from('form_templates')
      .select('name,created_by,workspace_id,description')
      .eq('id', response.template_id)
      .single();
    if (formError || !form || form.workspace_id !== response.workspace_id)
      throw new Error('Formulario no disponible.');

    const { data: responseToken, error: tokenError } = await service
      .from('form_tokens')
      .select('recipient_email,recipient_name,recipient_user_id,signature_type,require_liveness,access_mode,liveness_verified_at,liveness_reference')
      .eq('id', response.token_id)
      .single();
    if (tokenError || !responseToken) throw new Error('Participante del formulario no disponible.');
    const { data: registeredRecipient } = responseToken.recipient_user_id
      ? { data: { id: responseToken.recipient_user_id } }
      : await service.from('user_profiles').select('id')
          .eq('email', responseToken.recipient_email.trim().toLowerCase()).maybeSingle();
    const layoutPath = response.pdf_output_path.replace(/\.pdf$/i, '.signature-layout.json');
    const layoutDownload = await service.storage.from('form-artifacts').download(layoutPath);
    let signatureFields: Array<Record<string, unknown>> = [];
    if (layoutDownload.data) {
      const layout = JSON.parse(await layoutDownload.data.text()) as {
        pdfSha256?: string;
        placements?: Array<Record<string, unknown>>;
      };
      if (layout.pdfSha256?.toLowerCase() !== response.pdf_output_hash.toLowerCase())
        return NextResponse.json({ error: 'La posición de firma no coincide con el PDF.' }, { status: 422 });
      const placements = Array.isArray(layout.placements) ? layout.placements : [];
      signatureFields = placements.filter((placement) =>
        typeof placement.id === 'string' && typeof placement.label === 'string' &&
        typeof placement.page === 'number' && Number.isInteger(placement.page) && placement.page > 0 &&
        ['x', 'y', 'width', 'height'].every((key) =>
          typeof placement[key] === 'number' && Number.isFinite(Number(placement[key])) &&
          Number(placement[key]) >= 0 && Number(placement[key]) <= 100
        ) && Number(placement.x) + Number(placement.width) <= 100 &&
        Number(placement.y) + Number(placement.height) <= 100
      ).map((placement) => ({
        id: placement.id,
        label: placement.label,
        tipo: 'firma',
        placementKind: 'participant',
        participantId: registeredRecipient?.id || responseToken.recipient_email,
        participantName: responseToken.recipient_name || responseToken.recipient_email,
        page: placement.page,
        x: placement.x,
        y: placement.y,
        width: placement.width,
        height: placement.height,
      }));
    } else if (layoutDownload.error && !/not found|does not exist/i.test(layoutDownload.error.message)) {
      throw layoutDownload.error;
    }
    const participant = {
      ...(registeredRecipient?.id ? { id: registeredRecipient.id, user_id: registeredRecipient.id } : {}),
      nombre: responseToken.recipient_name || responseToken.recipient_email,
      email: responseToken.recipient_email,
      acto: 'firmar',
      rol: 'Firmante',
      tipo_firma: responseToken.signature_type || 'click_sign',
      require_liveness: responseToken.require_liveness === true && !responseToken.liveness_verified_at,
      ...(responseToken.liveness_verified_at ? { form_access_liveness_verified_at: responseToken.liveness_verified_at, form_access_liveness_reference: responseToken.liveness_reference } : {}),
      sub_estado: 'en_revision',
      current_access: true,
    };

    const { data: prior, error: priorError } = await service
      .from('documentos')
      .select('id,storage_path,estado,campos_solicitados,participantes')
      .eq('source_form_response_id', responseId)
      .maybeSingle();
    if (priorError) throw priorError;
    if (prior?.storage_path) {
      if (prior.estado === 'en_proceso') {
        const updates: Record<string, unknown> = {};
        if (signatureFields.length && (!Array.isArray(prior.campos_solicitados) ||
            !prior.campos_solicitados.some((field: { tipo?: string }) => field.tipo === 'firma'))) {
          updates.campos_solicitados = signatureFields;
        }
        if (Array.isArray(prior.participantes)) {
          const patched = prior.participantes.map((entry: Record<string, unknown>) =>
            String(entry.email || '').trim().toLowerCase() === responseToken.recipient_email.trim().toLowerCase() && !entry.sub_estado
              ? { ...entry, sub_estado: 'en_revision' } : entry
          );
          if (patched.some((entry: Record<string, unknown>, index: number) => entry !== prior.participantes[index]))
            updates.participantes = patched;
        }
        if (Object.keys(updates).length) {
          const repaired = await service.from('documentos').update(updates).eq('id', prior.id);
          if (repaired.error) throw repaired.error;
        }
      }
      if (response.document_id !== prior.id)
        await service.from('form_responses').update({ document_id: prior.id }).eq('id', responseId);
      return NextResponse.json({ document_id: prior.id, created: false });
    }

    const downloaded = await service.storage
      .from('form-artifacts')
      .download(response.pdf_output_path);
    if (downloaded.error || !downloaded.data)
      throw downloaded.error || new Error('PDF no disponible.');
    const bytes = Buffer.from(await downloaded.data.arrayBuffer());
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (hash !== response.pdf_output_hash.toLowerCase())
      return NextResponse.json(
        { error: 'El PDF no superó la verificación de integridad.' },
        { status: 422 }
      );

    const fileName = `${form.name.replace(/[^\p{L}\p{N}._ -]/gu, '').trim() || 'Formulario'}-${responseId.slice(0, 8)}.pdf`;
    const documentRecord = {
      documento_id: `FORM-${responseId.toUpperCase()}`,
      owner_id: form.created_by,
      workspace_id: response.workspace_id,
      source_form_response_id: responseId,
      file_name: fileName,
      file_size: bytes.length,
      file_type: 'application/pdf',
      file_hash_sha256: hash,
      nombre: `${form.name} · ${new Date(response.submitted_at).toLocaleDateString('es-MX')}`,
      descripcion: form.description || 'Respuesta de formulario',
      participantes: [participant],
      campos_solicitados: signatureFields,
      ruta_guardado: 'raiz',
      estado: 'en_proceso',
      fecha_completado: null,
    };
    let documentId = prior?.id;
    if (!documentId) {
      const inserted = await service
        .from('documentos')
        .insert(documentRecord)
        .select('id')
        .single();
      if (inserted.error) {
        if (inserted.error.code !== '23505') throw inserted.error;
        const raced = await service
          .from('documentos')
          .select('id,storage_path')
          .eq('source_form_response_id', responseId)
          .single();
        if (raced.error) throw raced.error;
        if (raced.data.storage_path) {
          await service
            .from('form_responses')
            .update({ document_id: raced.data.id })
            .eq('id', responseId);
          return NextResponse.json({ document_id: raced.data.id, created: false });
        }
        documentId = raced.data.id;
      } else documentId = inserted.data.id;
    }
    if (!documentId) throw new Error('No se pudo crear el documento.');

    const policy = documentEncryptionPolicy();
    let storagePath: string;
    const version = await initializeCollaborationDocumentVersion({
      service,
      workspaceId: response.workspace_id,
      documentId,
      actorUserId: form.created_by,
      sha256: hash,
      mimeType: 'application/pdf',
      byteSize: bytes.length,
      displayName: fileName,
      fileUrl: `/api/documentos/${documentId}/viewer-file`,
      requireCollaborationEntitlement: false,
    });
    if (!version.versionId) throw new Error('No se pudo crear la versión documental.');
    try {
      if (policy.enabled) {
        storagePath = `tenants/${response.workspace_id}/documents/${documentId}/versions/${version.versionId}/payload.enc`;
        await encryptAndUploadDocumentObject({
          service,
          plaintext: bytes,
          tenantId: response.workspace_id,
          documentId,
          documentVersionId: version.versionId,
          artifactKind: 'document',
          storageBucket: 'documents',
          storagePath,
          originalFileName: fileName,
          originalMimeType: 'application/pdf',
          userId: form.created_by,
        });
      } else {
        storagePath = `${response.workspace_id}/${documentId}/${fileName}`;
        const uploaded = await service.storage
          .from('documents')
          .upload(storagePath, bytes, { contentType: 'application/pdf', upsert: true });
        if (uploaded.error) throw uploaded.error;
      }
    } catch (uploadError) {
      const raced = await service
        .from('documentos')
        .select('id,storage_path')
        .eq('id', documentId)
        .single();
      if (raced.data?.storage_path) {
        await service
          .from('form_responses')
          .update({ document_id: documentId })
          .eq('id', responseId);
        return NextResponse.json({ document_id: documentId, created: false });
      }
      throw uploadError;
    }
    const fileUrl = `/api/documentos/${documentId}/viewer-file`;
    const [docUpdate, versionUpdate, responseUpdate] = await Promise.all([
      service
        .from('documentos')
        .update({ storage_path: storagePath, file_url: fileUrl, campos_solicitados: signatureFields, participantes: [participant] })
        .eq('id', documentId),
      service
        .from('document_versions')
        .update({ storage_path: storagePath, file_url: fileUrl })
        .eq('id', version.versionId),
      service.from('form_responses').update({ document_id: documentId }).eq('id', responseId),
    ]);
    if (docUpdate.error || versionUpdate.error || responseUpdate.error)
      throw docUpdate.error || versionUpdate.error || responseUpdate.error;
    return NextResponse.json({ document_id: documentId, created: true });
  } catch (error) {
    console.error('[formularios/documento]', error);
    return NextResponse.json(
      { error: 'No se pudo guardar el PDF en Mis Documentos.' },
      { status: 500 }
    );
  }
}
