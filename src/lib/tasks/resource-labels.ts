const statusLabels: Record<string, string> = {
  en_proceso: 'En proceso', borrador: 'Borrador', completado: 'Completado',
  pendiente: 'Pendiente', cancelado: 'Cancelado', rechazado: 'Rechazado',
  publicado: 'Publicado', archivado: 'Archivado', activo: 'Activo',
  draft: 'Borrador', published: 'Publicado', active: 'Activo',
  completed: 'Completado', pending: 'Pendiente', rejected: 'Rechazado',
  signed: 'Firmado', submitted: 'Enviado', pending_signature: 'Pendiente de firma',
  signing: 'En firma', ready_to_close: 'Listo para cerrar', closed: 'Cerrado',
  approved: 'Aprobado', accepted: 'Aceptado', provided: 'Entregado',
  waived: 'Eximido', expired: 'Vencido', failed: 'Fallido',
};

export function resourceStatusLabel(status?: string | null) {
  if (!status) return '';
  return statusLabels[status] || status.replace(/[_-]+/g, ' ').replace(/^./, letter => letter.toLocaleUpperCase('es'));
}
