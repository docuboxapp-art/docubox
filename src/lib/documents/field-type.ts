const typesByLabel: Record<string, string> = {
  Firma: 'firma',
  'Nombre Completo': 'nombre_completo',
  RFC: 'rfc',
  CURP: 'curp',
  'Correo Electrónico': 'correo',
  'Número Telefónico': 'telefono',
  Dirección: 'direccion',
  Texto: 'texto',
  Fecha: 'fecha',
  Hora: 'hora',
  Número: 'numero',
  Moneda: 'moneda',
  Casilla: 'checkbox',
  Imagen: 'imagen',
  'Botones de opción': 'radio',
  Desplegable: 'dropdown',
  'Cadena original': 'document_chain',
  'Sello digital': 'document_seal',
  'Estampa de tiempo': 'timestamp',
  'Cadena de evidencia': 'evidence_chain',
};

export function documentFieldType(label: string) {
  return Object.hasOwn(typesByLabel, label) ? typesByLabel[label] : 'texto';
}
