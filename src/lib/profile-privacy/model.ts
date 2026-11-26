export const PROFILE_SCOPES = ['workspaces', 'contactos', 'cualquiera', 'nadie'] as const;
export type ProfileScope = (typeof PROFILE_SCOPES)[number];
export type FieldScope = ProfileScope | 'heredar';

export const PROFILE_FIELDS = [
  { key: 'avatar_url', label: 'Foto de perfil', group: 'Identidad y contacto' },
  { key: 'personalidad_juridica', label: 'Tipo de persona', group: 'Identidad y contacto' },
  { key: 'nombre', label: 'Nombre', group: 'Identidad y contacto' },
  { key: 'apellido_paterno', label: 'Apellido paterno', group: 'Identidad y contacto' },
  { key: 'apellido_materno', label: 'Apellido materno', group: 'Identidad y contacto' },
  { key: 'full_name', label: 'Nombre completo o razón social', group: 'Identidad y contacto' },
  { key: 'email', label: 'Correo electrónico', group: 'Identidad y contacto' },
  { key: 'phone', label: 'Teléfono', group: 'Identidad y contacto' },
  { key: 'curp', label: 'CURP', group: 'Identidad y contacto', private: true },
  { key: 'rfc', label: 'RFC', group: 'Datos fiscales', private: true },
  { key: 'regimen_fiscal', label: 'Régimen fiscal', group: 'Datos fiscales', private: true },
  { key: 'codigo_postal', label: 'Código postal', group: 'Domicilio fiscal', private: true },
  { key: 'estado', label: 'Estado', group: 'Domicilio fiscal', private: true },
  { key: 'municipio', label: 'Municipio o alcaldía', group: 'Domicilio fiscal', private: true },
  { key: 'colonia', label: 'Colonia', group: 'Domicilio fiscal', private: true },
  { key: 'localidad', label: 'Localidad', group: 'Domicilio fiscal', private: true },
  { key: 'calle', label: 'Calle', group: 'Domicilio fiscal', private: true },
  { key: 'num_exterior', label: 'Número exterior', group: 'Domicilio fiscal', private: true },
  { key: 'num_interior', label: 'Número interior', group: 'Domicilio fiscal', private: true },
  { key: 'account_type', label: 'Tipo de cuenta', group: 'Cuenta y seguridad', private: true },
  { key: 'last_sign_in_at', label: 'Última conexión', group: 'Cuenta y seguridad', private: true },
] as const;

export type ProfileField = (typeof PROFILE_FIELDS)[number]['key'];
export type SharedProfile = Partial<Record<ProfileField, string>>;
export type ProfileSettings = {
  scope: ProfileScope;
  fields: Partial<Record<ProfileField, FieldScope>>;
  allowContacts: boolean;
  allowMessages: boolean;
  allowNotes: boolean;
};

export const PROFILE_SCOPE_LABELS: Record<ProfileScope, string> = {
  workspaces: 'Mis espacios de trabajo',
  contactos: 'Mis contactos y espacios de trabajo',
  cualquiera: 'Usuarios de Docubox',
  nadie: 'Privado',
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
export type DirectoryResult = {
  id: string;
  full_name: string | null;
  email: string | null;
  contactId: string | null;
  requestStatus: RequestStatus | null;
  canView: boolean;
  canRequest: boolean;
};
export type ContactAccessRequest = {
  id: string;
  requester_id: string;
  name: string;
  status: RequestStatus;
  created_at: string;
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
