import { z } from 'zod';

export const collaborationRequestItemSchema = z
  .object({
    item_type: z.enum(['document', 'form', 'identity', 'signature']).default('document'),
    title: z.string().trim().min(2).max(180),
    description: z.string().trim().max(2000).nullable().optional(),
    required: z.boolean().default(true),
    form_template_id: z.string().uuid().nullable().optional(),
    document_id: z.string().uuid().nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.item_type === 'form' && !value.form_template_id)
      context.addIssue({
        code: 'custom',
        path: ['form_template_id'],
        message: 'Selecciona un formulario publicado.',
      });
    if (value.item_type === 'signature' && !value.document_id)
      context.addIssue({
        code: 'custom',
        path: ['document_id'],
        message: 'Selecciona el documento enviado a firma.',
      });
    if (value.item_type !== 'form' && value.form_template_id)
      context.addIssue({
        code: 'custom',
        path: ['form_template_id'],
        message: 'El formulario solo corresponde a un requisito de formulario.',
      });
    if (value.item_type !== 'signature' && value.document_id)
      context.addIssue({
        code: 'custom',
        path: ['document_id'],
        message: 'El documento para firma solo corresponde a un requisito de firma.',
      });
  });
export type CollaborationRequestItemInput = z.infer<typeof collaborationRequestItemSchema>;
export const collaborationItemTypeLabels: Record<string, string> = {
  document: 'Documento',
  form: 'Formulario',
  identity: 'Documento de identidad',
  signature: 'Firma de documento',
};
export function requestItemReceived(status: string) {
  return ['uploaded', 'in_review', 'approved', 'waived'].includes(status);
}
export function requestProgress(items: Array<{ required?: boolean; status: string }>) {
  const required = items.filter((item) => item.required);
  return {
    total: items.length,
    required: required.length,
    received: items.filter((item) => requestItemReceived(item.status)).length,
    approved: items.filter((item) => ['approved', 'waived'].includes(item.status)).length,
    percent: required.length
      ? Math.round(
          (required.filter((item) => ['approved', 'waived'].includes(item.status)).length /
            required.length) *
            100
        )
      : 100,
  };
}
