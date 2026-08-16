export type OffboardingAssets = {
  documents?: number;
  case_files?: number;
  tasks?: number;
  shared_resources_owned?: number;
  shared_resources_custodied?: number;
  teams_led?: number;
  cost_centers?: number;
  certificate_permissions?: number;
  active_authorities?: number;
};

export const offboardingAssetLabels: Array<[keyof OffboardingAssets, string]> = [
  ['documents', 'Documentos'],
  ['case_files', 'Expedientes'],
  ['tasks', 'Tareas asignadas'],
  ['shared_resources_owned', 'Recursos propios'],
  ['shared_resources_custodied', 'Recursos bajo custodia'],
  ['teams_led', 'Equipos liderados'],
  ['cost_centers', 'Centros de costo'],
  ['certificate_permissions', 'Permisos de certificados'],
  ['active_authorities', 'Facultades activas'],
];

const transferableKeys: Array<keyof OffboardingAssets> = [
  'documents', 'case_files', 'tasks', 'shared_resources_owned',
  'shared_resources_custodied', 'teams_led', 'cost_centers', 'certificate_permissions',
];

export function transferableAssetTotal(assets: OffboardingAssets = {}) {
  return transferableKeys.reduce((total, key) => total + Math.max(0, Number(assets[key] || 0)), 0);
}

export function offboardingAssetTotal(assets: OffboardingAssets = {}) {
  return offboardingAssetLabels.reduce((total, [key]) => total + Math.max(0, Number(assets[key] || 0)), 0);
}

export function validateOffboardingSelection(input: {
  memberId?: string;
  memberRole?: string;
  successorId?: string;
  transferableAssets?: number;
  confirmation?: string;
}) {
  if (!input.memberId) return 'Selecciona el miembro que será dado de baja.';
  if (input.memberRole === 'owner') return 'Primero transfiere la propiedad de la organización.';
  if ((input.transferableAssets || 0) > 0 && !input.successorId) return 'Selecciona un sucesor para los activos.';
  if (input.memberId === input.successorId) return 'El sucesor debe ser una persona distinta.';
  if ((input.confirmation || '').trim().toUpperCase() !== 'DAR DE BAJA') return 'Escribe DAR DE BAJA para confirmar.';
  return '';
}

export function isExecutableOffboarding(status: string, effectiveAt: string, now = Date.now()) {
  if (!['pending', 'scheduled'].includes(status)) return false;
  const timestamp = new Date(effectiveAt).getTime();
  return Number.isFinite(timestamp) && timestamp <= now;
}
