import { NextRequest, NextResponse } from 'next/server';
import { requireDocumentContentAccess } from '@/lib/security/document-content-access';
import { DocumentAccessError, documentAccessResponse } from '@/lib/security/document-access';

export const dynamic = 'force-dynamic';

type FormField = {
  id?: string;
  slug?: string;
  label?: string;
  type?: string;
  sectionId?: string;
  options?: Array<{ label?: string; value?: string }>;
};
type FormSection = { id?: string; title?: string; fieldIds?: string[] };

const SIGNATURE_TYPES = new Set([
  'firma_efirma', 'firma_autografa', 'firma_click', 'signature_block', 'iniciales',
]);
const NON_RESPONSE_TYPES = new Set(['divider', 'texto_bloque', 'imagen_estatica', 'columnas']);

function displayAnswer(value: unknown, field: FormField): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (Array.isArray(value)) {
    const labels = value.map((item) => displayAnswer(item, field)).filter(Boolean);
    return labels.length ? labels.join(', ') : null;
  }
  if (typeof value === 'object') {
    const name = (value as Record<string, unknown>).name;
    return typeof name === 'string' && name.trim() ? name.trim() : 'Dato capturado';
  }
  const text = String(value).trim();
  if (!text) return null;
  if (field.type === 'imagen' || field.type === 'documento' || text.startsWith('data:')) {
    return field.type === 'documento' ? 'Documento adjunto' : 'Imagen capturada';
  }
  const option = field.options?.find((item) => item.value === text);
  return (option?.label || text).slice(0, 2000);
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await context.params;
    const { document, service } = await requireDocumentContentAccess(request, documentId, 'view');
    const responseId = String(document.source_form_response_id || '');
    if (!responseId) {
      return NextResponse.json({ error: 'Este documento no proviene de un formulario.' }, { status: 404 });
    }

    const { data: response, error: responseError } = await service
      .from('form_responses')
      .select('id,template_id,response_data,respondent_name,respondent_email,submitted_at,folio,status')
      .eq('id', responseId)
      .maybeSingle();
    if (responseError) throw responseError;
    if (!response) return NextResponse.json({ error: 'Respuesta no encontrada.' }, { status: 404 });

    const { data: form, error: formError } = await service
      .from('form_templates')
      .select('name,description,schema,form_schema,settings,version_number,created_by')
      .eq('id', response.template_id)
      .maybeSingle();
    if (formError) throw formError;

    const { data: creator } = form?.created_by
      ? await service.from('user_profiles')
          .select('full_name,nombre,apellido_paterno,apellido_materno')
          .eq('id', form.created_by)
          .maybeSingle()
      : { data: null };
    const creatorName = creator?.full_name ||
      [creator?.nombre, creator?.apellido_paterno, creator?.apellido_materno].filter(Boolean).join(' ') || null;

    const snapshot = form?.form_schema && typeof form.form_schema === 'object' &&
      !Array.isArray(form.form_schema) ? form.form_schema as Record<string, unknown> : null;
    const fields = (Array.isArray(snapshot?.fields) ? snapshot.fields : form?.schema) as FormField[] | null;
    const settings = form?.settings && typeof form.settings === 'object'
      ? form.settings as Record<string, unknown> : null;
    const sections = (Array.isArray(snapshot?.sections) ? snapshot.sections : settings?.sections) as FormSection[] | null;
    const answers = response.response_data && typeof response.response_data === 'object' &&
      !Array.isArray(response.response_data)
      ? response.response_data as Record<string, unknown> : {};
    const sectionRows = new Map<string, { title: string; fields: Array<{ label: string; value: string }> }>();
    for (const field of Array.isArray(fields) ? fields : []) {
      if (!field?.id || !field.label || SIGNATURE_TYPES.has(field.type || '') || NON_RESPONSE_TYPES.has(field.type || '')) continue;
      const value = displayAnswer(answers[field.id] ?? (field.slug ? answers[field.slug] : undefined), field);
      if (!value) continue;
      const section = (Array.isArray(sections) ? sections : []).find((item) =>
        item.id === field.sectionId || item.fieldIds?.includes(field.id!)
      );
      const key = section?.id || 'general';
      if (!sectionRows.has(key)) sectionRows.set(key, { title: section?.title || 'Datos capturados', fields: [] });
      sectionRows.get(key)!.fields.push({ label: field.label, value });
    }

    return NextResponse.json({
      formName: form?.name || document.nombre,
      description: form?.description || null,
      version: form?.version_number || null,
      createdBy: creatorName,
      respondentName: response.respondent_name || null,
      respondentEmail: response.respondent_email || null,
      submittedAt: response.submitted_at,
      folio: response.folio || null,
      sections: Array.from(sectionRows.values()),
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof DocumentAccessError) {
      const { status, body } = documentAccessResponse(error);
      return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
    }
    console.error('[form-response] No se pudo cargar la respuesta vinculada:', error);
    return NextResponse.json(
      { error: 'No se pudieron cargar los datos del formulario.' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }
}
