export interface Participant {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: 'firmante' | 'aprobador' | 'observador';
  configured?: boolean;
  isNewUser?: boolean;
  acto?: string;
  rolDocumento?: string;
  tipoFirma?: string[];
  tipoNotificacion?: string[];
  mensajePersonalizado?: string;
  savedAsContact?: boolean;
  tipoPersona?: 'fisica' | 'moral';
  denominacion?: string;
  fechaVencimientoParticipacion?: string;
}

export interface DocumentSettings {
  title: string;
  message: string;
  deadline: string;
  reminderDays: string;
  requireAllSignatures: boolean;
  allowDecline: boolean;
}

export interface SecuritySettings {
  vencimientoEnabled: boolean;
  fechaVencimiento: string;
  recordatorioFrecuencia: string;
  codigoAccesoEnabled: boolean;
  codigoAcceso: string;
  proteccionAdicionalEnabled: boolean;
  proteccionParticipacionEnabled?: boolean;
  impedirImpresion: boolean;
  evitarCopiaTexto: boolean;
  impedirModificacion: boolean;
  impedirExtraccion: boolean;
  evitarMontaje: boolean;
  legalHoldEnabled: boolean;
  legalHoldReason?:
    | 'litigio'
    | 'requerimiento_autoridad'
    | 'auditoria_investigacion'
    | 'prevencion_eliminacion'
    | 'otro'
    | '';
  urgente?: boolean;
  publico?: boolean;
  selloDigital?: boolean;
  selloUbicacion?: 'calce' | 'libre';
  estampaAutenticacion?: boolean;
  metadatosAdicionales?: boolean;
  leyendasDocumento?: boolean;
  vencimientoSolicitud?: boolean;
  vencimientoCompletar?: boolean;
}

export type CryptographicElementType =
  'document_chain' | 'document_seal' | 'timestamp' | 'evidence_chain';

export type AdditionalMetadataScope = 'document' | 'management';

export type AdditionalMetadataDataType =
  | 'text'
  | 'number'
  | 'currency'
  | 'date'
  | 'datetime'
  | 'boolean'
  | 'list'
  | 'rfc'
  | 'curp'
  | 'email'
  | 'identifier'
  | 'reference';

export interface AdditionalDocumentMetadata {
  id: string;
  name: string;
  dataType: AdditionalMetadataDataType;
  value: string | boolean;
  scope: AdditionalMetadataScope;
}

export interface DocumentConfig {
  nombre: string;
  descripcion: string;
  numeroOficio: string;
  grupotipoId: string;
  tipoDocumentoId: string;
  otroTipoDocumento: string;
  ruta: string;
  etiquetasIds: string[];
  additionalMetadata: AdditionalDocumentMetadata[];
}

export interface DocuboxSourceSelection {
  workspaceId: string;
  sourceDocumentId: string;
  sourceVersionId: string | null;
  sourceVariant: 'original' | 'version' | 'certified';
  sourceDocumentoId: string;
  sourceDocumentName: string;
  sourceVersionNumber: number;
  sourceVersionLabel: string;
  sourceStatus: string;
  sourceSha256: string;
  fileName: string;
  fileSize: number | null;
  fileType: string;
  relationType: 'derived_from';
}

export interface GrupoTipoDocumento {
  id: string;
  nombre: string;
  orden: number;
}

export interface TipoDocumento {
  id: string;
  grupo_id: string;
  nombre: string;
  descripcion: string | null;
}

export interface Etiqueta {
  id: string;
  nombre: string;
  color: string;
}

export interface Carpeta {
  id: string;
  nombre: string;
  parent_id: string | null;
}

export type ParticipantMode = 'solo_yo' | 'yo_y_otros' | 'solo_otros' | null;

export interface PlacedField {
  id: string;
  label: string;
  icon: React.ReactNode;
  x: number;
  y: number;
  width: number;
  height: number;
  page?: number;
  participantId?: string;
  participantName?: string;
  color?: string;
  colorHex?: string;
  placementKind?: 'participant' | 'general' | 'cryptographic';
  cryptographicType?: CryptographicElementType;
  generatedOnCompletion?: boolean;
  dropdownOptions?: string[];
  radioOptions?: string[];
  casillaLabel?: string;
  // Label / name configuration
  fieldConfig?: {
    customName?: string;
    showLabelInDocument?: boolean;
  };
  // Type-specific configuration
  fieldTypeConfig?: {
    // Imagen
    imageType?: 'foto' | 'firma_imagen' | 'logo' | 'documento' | 'otro';
    // Número
    decimals?: number;
    numberFormat?: 'entero' | 'decimal' | 'porcentaje';
    // Moneda
    currency?: 'MXN' | 'USD' | 'EUR' | 'GBP' | 'CAD' | 'otro';
    currencySymbol?: string;
    // Fecha
    dateFormat?: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD' | 'DD-MM-YYYY' | 'DD MMMM YYYY';
    // Hora
    timeFormat?: '12h' | '24h';
    timeWithSeconds?: boolean;
    // Font/style (set by document creator in toolbar)
    fontFamily?: string;
    fontSize?: number;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
  };
}

export const STEPS = [
  { id: 1, label: 'Subir', iconName: 'Upload' },
  { id: 2, label: 'Participantes', iconName: 'Users' },
  { id: 3, label: 'Ajustes', iconName: 'Settings' },
  { id: 4, label: 'Enviar', iconName: 'Send' },
];

export const PARTICIPANT_COLORS = [
  'bg-blue-500',
  'bg-violet-500',
  'bg-emerald-500',
  'bg-orange-500',
  'bg-pink-500',
  'bg-teal-500',
];

export const PARTICIPANT_COLORS_HEX = [
  '#3b82f6',
  '#8b5cf6',
  '#10b981',
  '#f97316',
  '#ec4899',
  '#14b8a6',
];

export interface GrupoFirma {
  id: string;
  nombre: string;
  tipo: 'paralelo' | 'secuencial';
  mensaje: string;
  participantIds: string[];
}
