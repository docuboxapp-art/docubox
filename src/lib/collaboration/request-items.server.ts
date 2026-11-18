import type { SupabaseClient } from '@supabase/supabase-js';
import { OrganizationApiError } from '@/lib/organization/server';
import {
  collaborationRequestItemSchema,
  type CollaborationRequestItemInput,
} from './request-items';

export async function prepareCollaborationRequestItems(
  service: SupabaseClient,
  workspaceId: string,
  recipientEmail: string,
  input: CollaborationRequestItemInput[]
) {
  const rows = [];
  for (const raw of input) {
    const item = collaborationRequestItemSchema.parse(raw);
    let sourceSnapshot: Record<string, unknown> = {};
    if (item.item_type === 'form') {
      const form = await service
        .from('form_templates')
        .select('id,name,status,version_number,revision_number,settings')
        .eq('workspace_id', workspaceId)
        .eq('id', item.form_template_id!)
        .eq('status', 'published')
        .maybeSingle();
      if (form.error) throw form.error;
      if (!form.data)
        throw new OrganizationApiError(
          422,
          'form_unavailable',
          'Selecciona un formulario publicado de esta organización.'
        );
      sourceSnapshot = {
        name: form.data.name,
        version: form.data.version_number,
        revision: form.data.revision_number,
        requiresSignature: form.data.settings?.requiresSignature !== false,
      };
    }
    if (item.item_type === 'signature') {
      const document = await service
        .from('documentos')
        .select('id,nombre,documento_id,estado,participantes')
        .eq('workspace_id', workspaceId)
        .eq('id', item.document_id!)
        .is('deleted_at', null)
        .maybeSingle();
      if (document.error) throw document.error;
      const participants = Array.isArray(document.data?.participantes)
        ? document.data.participantes
        : [];
      if (
        !document.data ||
        ['borrador', 'cancelado', 'rechazado', 'vencido'].includes(document.data.estado) ||
        !participants.some(
          (person: Record<string, unknown>) =>
            String(person.email || '')
              .trim()
              .toLowerCase() === recipientEmail.trim().toLowerCase()
        )
      )
        throw new OrganizationApiError(
          422,
          'signature_recipient_unavailable',
          'El documento debe estar enviado a firma e incluir al destinatario de la solicitud.'
        );
      sourceSnapshot = { name: document.data.nombre, documento_id: document.data.documento_id };
    }
    rows.push({
      ...item,
      form_template_id: item.form_template_id || null,
      document_id: item.document_id || null,
      source_snapshot: sourceSnapshot,
    });
  }
  return rows;
}
