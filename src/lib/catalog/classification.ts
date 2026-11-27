import { caseCategories, caseTags } from '@/lib/case-files/category-catalog';

export const catalogKinds = {
  'contact-tag': 'Etiquetas de contactos',
  'document-group': 'Grupos de tipos de documento',
  'document-type': 'Tipos de documento',
  'document-tag': 'Etiquetas de documentos',
  'form-group': 'Grupos de tipos de formulario',
  'form-type': 'Tipos de formulario',
  'form-tag': 'Etiquetas de formularios',
  'template-group': 'Grupos de tipos de plantilla',
  'template-type': 'Tipos de plantilla',
  'template-tag': 'Etiquetas de plantillas',
  'case-category': 'Categorías de expedientes',
  'case-type': 'Tipos de expedientes',
  'case-tag': 'Etiquetas de expedientes',
} as const;

export type CatalogKind = keyof typeof catalogKinds;
export const documentCatalogs = {
  'document-group': { table: 'grupo_tipo_documento', scope: 'document' },
  'document-type': { table: 'tipo_documento', scope: 'document', groupKind: 'document-group' },
  'document-tag': { table: 'etiquetas', scope: 'document' },
  'form-group': { table: 'grupo_tipo_documento', scope: 'form' },
  'form-type': { table: 'tipo_documento', scope: 'form', groupKind: 'form-group' },
  'form-tag': { table: 'etiquetas', scope: 'form' },
  'template-group': { table: 'grupo_tipo_documento', scope: 'template' },
  'template-type': { table: 'tipo_documento', scope: 'template', groupKind: 'template-group' },
  'template-tag': { table: 'etiquetas', scope: 'template' },
} as const;
export type DocumentCatalogKind = keyof typeof documentCatalogs;
export type DocumentTypeCatalogKind = Extract<DocumentCatalogKind, `${string}-type`>;
export type DocumentTagCatalogKind = Extract<DocumentCatalogKind, `${string}-tag`>;
export type PersonalCatalogKind = Exclude<CatalogKind, DocumentCatalogKind>;
export type CatalogScope = (typeof documentCatalogs)[DocumentCatalogKind]['scope'];
export type CatalogAvailability = {
  catalog_scope?: CatalogScope | null;
  catalog_archived?: boolean;
};

export const isDocumentCatalog = (kind: CatalogKind): kind is DocumentCatalogKind =>
  Object.hasOwn(documentCatalogs, kind);

export function matchesCatalogScope(option: CatalogAvailability, scope: CatalogScope) {
  return option.catalog_scope == null || option.catalog_scope === scope;
}
export type CatalogEntry = {
  id: string;
  kind: CatalogKind;
  name: string;
  group: string;
  color?: string;
  custom?: boolean;
  archived?: boolean;
};

export const catalogColors = [
  ['#2563eb', 'Azul'],
  ['#0891b2', 'Turquesa'],
  ['#047857', 'Verde'],
  ['#4d7c0f', 'Oliva'],
  ['#b45309', 'Ámbar'],
  ['#c2410c', 'Naranja'],
  ['#be123c', 'Rojo'],
  ['#be185d', 'Rosa'],
  ['#7c3aed', 'Violeta'],
  ['#4338ca', 'Índigo'],
  ['#475569', 'Gris'],
  ['#795548', 'Café'],
] as const;

export const contactTagGroups = [
  {
    name: 'Tipo',
    color: '#2563eb',
    labels: [
      'Cliente',
      'Proveedor',
      'Colaborador',
      'Notaría',
      'Otro',
      'Socio',
      'Contratista',
      'Asesor',
      'Representante legal',
      'Autoridad',
      'Entidad financiera',
      'Distribuidor',
    ],
  },
  {
    name: 'Relación',
    color: '#7c3aed',
    labels: [
      'Recurrente',
      'Prospecto',
      'Estratégico',
      'Primera vez',
      'Ocasional',
      'Activo',
      'Inactivo',
      'Referido',
      'Aliado',
      'Interno',
      'Externo',
    ],
  },
  {
    name: 'Área',
    color: '#0891b2',
    labels: [
      'Comercial',
      'Legal',
      'Fiscal',
      'Operaciones',
      'Administración',
      'Finanzas',
      'Compras',
      'Recursos humanos',
      'Tecnología',
      'Cumplimiento',
      'Atención al cliente',
      'Dirección',
    ],
  },
  {
    name: 'Seguimiento',
    color: '#b45309',
    labels: [
      'Por contactar',
      'En seguimiento',
      'Pendiente de respuesta',
      'Documentación pendiente',
      'Revisión periódica',
      'Prioritario',
    ],
  },
  {
    name: 'Alcance',
    color: '#047857',
    labels: ['Local', 'Regional', 'Nacional', 'Internacional', 'Multisede'],
  },
] as const;

export const catalogKey = (value: string) =>
  value.trim().normalize('NFC').toLocaleLowerCase('es-MX');
export const catalogVisibilityKey = (kind: CatalogKind, id: string) => `${kind}/${id}`;

export const validCatalogColor = (color: string | null | undefined) =>
  color && /^#[\da-f]{6}$/i.test(color) ? color : '#2563eb';

export const builtInCatalog: CatalogEntry[] = [
  ...contactTagGroups.flatMap(({ name, labels, color }) =>
    labels.map((label) => ({
      id: `${name}:${label}`,
      name: label,
      group: name,
      kind: 'contact-tag' as const,
      color,
    }))
  ),
  ...caseCategories.flatMap(({ code, name, types }): CatalogEntry[] => [
    { id: code, kind: 'case-category', name, group: '' },
    ...types.map((type): CatalogEntry => ({
      id: type.code,
      kind: 'case-type',
      name: type.name,
      group: code,
    })),
  ]),
  ...caseTags.map((tag): CatalogEntry => ({
    id: tag.id,
    kind: 'case-tag',
    group: tag.group,
    name: tag.nombre,
    color: tag.color,
  })),
];

export function splitContactTag(value: string) {
  const separator = value.indexOf(':');
  if (separator > 0 && value.slice(separator + 1).trim()) {
    const name = value.slice(0, separator).trim();
    const group = contactTagGroups.find(
      ({ name: groupName }) => catalogKey(groupName) === catalogKey(name)
    );
    return { category: group?.name ?? name, label: value.slice(separator + 1).trim(), raw: value };
  }
  const group = contactTagGroups.find(({ labels }) =>
    labels.some((label) => catalogKey(label) === catalogKey(value))
  );
  return { category: group?.name ?? 'Otros', label: value, raw: value };
}

export function contactTagColor(entries: CatalogEntry[], category: string, label: string) {
  const matches = entries.filter(
    (entry) =>
      entry.kind === 'contact-tag' &&
      catalogKey(entry.group) === catalogKey(category) &&
      catalogKey(entry.name) === catalogKey(label)
  );
  return validCatalogColor(
    matches.find((entry) => !entry.archived)?.color ??
      matches[0]?.color ??
      contactTagGroups.find((group) => catalogKey(group.name) === catalogKey(category))?.color
  );
}

export type CaseCatalogTag = { id: string; nombre: string; color?: string | null; group?: string };

export function readCaseCatalogTags(value: unknown): CaseCatalogTag[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (
      !item ||
      typeof item.id !== 'string' ||
      typeof item.nombre !== 'string' ||
      !item.nombre.trim() ||
      item.nombre.length > 80
    )
      return [];
    return [
      {
        id: item.id,
        nombre: item.nombre,
        color: validCatalogColor(item.color),
        ...(typeof item.group === 'string' && { group: item.group }),
      },
    ];
  });
}
