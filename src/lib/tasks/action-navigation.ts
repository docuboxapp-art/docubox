export function formInvitationPath(templateId: string, recipientEmail: string | null, userEmail: string | null | undefined) {
  const recipient = recipientEmail?.trim().toLowerCase();
  if (!recipient || recipient !== userEmail?.trim().toLowerCase()) return null;
  return `/formulario-publico/${encodeURIComponent(templateId)}?email=${encodeURIComponent(recipientEmail!.trim())}`;
}

export function formResponsePath(templateId: string, responseId: string) {
  return `/formularios/respuestas?id=${encodeURIComponent(templateId)}&respuesta=${encodeURIComponent(responseId)}`;
}
