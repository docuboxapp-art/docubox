/** Keep the wizard and the authenticated create route aligned on lifecycle rules. */
export function taskResourceIsEligible(sourceKind: string, type: string, status: string | null | undefined): boolean {
  const current = (status || '').toLowerCase();
  if (!current) return true;
  if (sourceKind === 'document') {
    if (type === 'retomar_borrador') return current === 'borrador';
    if (['firmar_documento', 'aprobar_documento'].includes(type)) return current === 'en_proceso';
    if (type === 'revisar_vencimiento') return ['borrador', 'en_proceso'].includes(current);
    return !['cancelado', 'rechazado'].includes(current);
  }
  if (sourceKind === 'form_template') return !['closed', 'archived'].includes(current);
  if (sourceKind === 'template') return !['archived', 'archivada'].includes(current);
  if (sourceKind === 'case_file') {
    if (type === 'cerrar_expediente') return current === 'ready_to_close';
    return !['sealed', 'cancelled'].includes(current);
  }
  if (sourceKind === 'form_response' && ['aprobar_documento', 'corregir_datos'].includes(type))
    return !['signed', 'completed', 'cancelled', 'rejected'].includes(current);
  if (sourceKind === 'task') return !['completada', 'cancelada', 'rechazada'].includes(current);
  if (sourceKind === 'participant_requirement') return ['pending', 'rejected'].includes(current);
  return true;
}
