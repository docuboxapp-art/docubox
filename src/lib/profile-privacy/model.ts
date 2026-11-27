export const PROFILE_SCOPES = ['nadie', 'workspaces', 'solo_contactos', 'contactos'] as const;
export type ProfileScope = (typeof PROFILE_SCOPES)[number];
export const PROFILE_VISIBILITY_MODES = ['general', 'fields'] as const;
export type ProfileVisibilityMode = (typeof PROFILE_VISIBILITY_MODES)[number];

export const PROFILE_SECTIONS = [
  {
    key: 'identity',
    label: 'Identidad y contacto',
    description: 'Nombre, foto, correo y teléfono',
  },
  {
    key: 'tax_identity',
    label: 'Identificación oficial y datos fiscales',
    description: 'CURP, RFC y régimen fiscal',
  },
  { key: 'address', label: 'Domicilio fiscal', description: 'Dirección y código postal' },
  { key: 'account', label: 'Cuenta y actividad', description: 'Tipo de cuenta y última conexión' },
] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number]['key'];

export const PROFILE_FIELDS = [
  { key: 'avatar_url', label: 'Foto de perfil', group: 'identity' },
  { key: 'personalidad_juridica', label: 'Tipo de persona', group: 'identity' },
  { key: 'nombre', label: 'Nombre', group: 'identity' },
  { key: 'apellido_paterno', label: 'Apellido paterno', group: 'identity' },
  { key: 'apellido_materno', label: 'Apellido materno', group: 'identity' },
  { key: 'full_name', label: 'Nombre completo o razón social', group: 'identity' },
  { key: 'email', label: 'Correo electrónico', group: 'identity' },
  { key: 'phone', label: 'Teléfono', group: 'identity' },
  { key: 'curp', label: 'CURP', group: 'tax_identity' },
  { key: 'rfc', label: 'RFC', group: 'tax_identity' },
  { key: 'regimen_fiscal', label: 'Régimen fiscal', group: 'tax_identity' },
  { key: 'codigo_postal', label: 'Código postal', group: 'address' },
  { key: 'estado', label: 'Estado', group: 'address' },
  { key: 'municipio', label: 'Municipio o alcaldía', group: 'address' },
  { key: 'colonia', label: 'Colonia', group: 'address' },
  { key: 'localidad', label: 'Localidad', group: 'address' },
  { key: 'calle', label: 'Calle', group: 'address' },
  { key: 'num_exterior', label: 'Número exterior', group: 'address' },
  { key: 'num_interior', label: 'Número interior', group: 'address' },
  { key: 'account_type', label: 'Tipo de cuenta', group: 'account' },
  { key: 'last_sign_in_at', label: 'Última conexión', group: 'account' },
] as const;

export type ProfileField = (typeof PROFILE_FIELDS)[number]['key'];
export type SharedProfile = Partial<Record<ProfileField, string>>;
export type ProfileSettings = {
  mode: ProfileVisibilityMode;
  scope: ProfileScope;
  sections: ProfileSection[];
  fields: Partial<Record<ProfileField, ProfileScope>>;
  allowContacts: boolean;
  allowMessages: boolean;
  allowNotes: boolean;
};

export const PROFILE_SCOPE_LABELS: Record<ProfileScope, string> = {
  workspaces: 'Miembros de mis espacios',
  solo_contactos: 'Mis contactos',
  contactos: 'Mis contactos y miembros de mis espacios',
  nadie: 'Solo yo',
};

export const SEARCH_CRITERIA = ['correo', 'rfc', 'curp', 'telefono', 'nombre'] as const;
export type SearchCriterion = (typeof SEARCH_CRITERIA)[number];
export const REQUEST_STATUS_LABELS = {
  pending: 'Pendiente',
  approved: 'Aprobada',
  declined: 'Rechazada',
  revoked: 'Revocada',
} as const;
export type RequestStatus = keyof typeof REQUEST_STATUS_LABELS;
export const CONTACT_REQUEST_APPROVAL_LABEL = 'Aprobar solicitudes de contacto';
export const SENT_REQUEST_STATUS_LABELS = {
  ...REQUEST_STATUS_LABELS,
  pending: 'Pendiente de aprobación',
  revoked: 'Acceso revocado',
} as const;
export type DirectoryResult = {
  id: string;
  full_name: string | null;
  email: string | null;
  contactId: string | null;
  requestStatus: RequestStatus | null;
  canView: boolean;
  canRequest: boolean;
  canAddDirectly: boolean;
};
type ContactAccessRequest = {
  id: string;
  status: RequestStatus;
  created_at: string;
};
export type ContactRequestInbox = {
  allowContacts: boolean;
  received: Array<ContactAccessRequest & { name: string }>;
  sent: Array<
    ContactAccessRequest & { name: string | null; email: string | null; contactId: string | null }
  >;
};
export type ProfileVisit = { viewer_id: string; name: string; viewed_at: string };
export type ProfileBlock = { blocked_id: string; label: string; created_at: string };
export type ProfileCard = {
  id: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
};

export type CommunicationKind = 'message' | 'note';
export type CommunicationPeer = { id: string; name: string; messages: boolean; notes: boolean };
export type Communication = {
  id: string;
  sender_id: string;
  recipient_id: string;
  document_id: string | null;
  document_name: string | null;
  peer: string;
  peer_name: string;
  kind: CommunicationKind;
  content: string;
  created_at: string;
};
export type CommunicationContext =
  { contactId: string } | { documentId: string; peerId?: string } | { peerId: string };
export type Conversation = {
  viewerId: string;
  peers: CommunicationPeer[];
  messages: Communication[];
};

export function formatPrivacyDate(value: string) {
  return new Date(value).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
}
