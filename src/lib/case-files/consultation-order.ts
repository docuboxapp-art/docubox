import type { ListDirection } from '../workspaces/list-order';

type CaseDateField = 'created_at' | 'closed_at';
type CaseOrderColumn = {
  field?: string;
  ascending: string;
  descending: string;
  label: string;
  defaultDirection: ListDirection;
};

export const caseOrderColumns: Readonly<Record<string, CaseOrderColumn>> = {
  created: {
    ascending: 'oldest',
    descending: 'recent',
    label: 'Creación',
    defaultDirection: 'desc',
  },
  title: {
    field: 'title',
    ascending: 'name',
    descending: 'name_desc',
    label: 'Nombre',
    defaultDirection: 'asc',
  },
  type: {
    field: 'case_subtype',
    ascending: 'type_asc',
    descending: 'type_desc',
    label: 'Tipo de expediente',
    defaultDirection: 'asc',
  },
  participant: {
    field: 'subject_name',
    ascending: 'participant_asc',
    descending: 'participant_desc',
    label: 'Participante',
    defaultDirection: 'asc',
  },
  status: {
    field: 'status',
    ascending: 'status_asc',
    descending: 'status_desc',
    label: 'Estado',
    defaultDirection: 'asc',
  },
  progress: {
    field: 'progress',
    ascending: 'progress_asc',
    descending: 'progress_desc',
    label: 'Avance',
    defaultDirection: 'desc',
  },
  updated: {
    field: 'updated_at',
    ascending: 'updated_asc',
    descending: 'updated_desc',
    label: 'Última actividad',
    defaultDirection: 'desc',
  },
  category: {
    field: 'case_type',
    ascending: 'category_asc',
    descending: 'category_desc',
    label: 'Categoría',
    defaultDirection: 'asc',
  },
  folio: {
    field: 'folio',
    ascending: 'folio_asc',
    descending: 'folio_desc',
    label: 'Folio',
    defaultDirection: 'asc',
  },
  due: {
    field: 'target_close_at',
    ascending: 'due_asc',
    descending: 'due_desc',
    label: 'Fecha de vencimiento',
    defaultDirection: 'asc',
  },
};

export const caseOrderOptions = Object.values(caseOrderColumns).flatMap((column) => {
  if (!column.field)
    return [
      { id: column.descending, name: 'Más recientes' },
      { id: column.ascending, name: 'Más antiguos' },
    ];
  if (column.field === 'title')
    return [
      { id: column.ascending, name: 'Nombre A–Z' },
      { id: column.descending, name: 'Nombre Z–A' },
    ];
  return [
    { id: column.ascending, name: `${column.label} ascendente` },
    { id: column.descending, name: `${column.label} descendente` },
  ];
});

export function caseListOrder(sort: string | null, dateField: CaseDateField) {
  const column = Object.values(caseOrderColumns).find(
    ({ ascending, descending }) => sort === ascending || sort === descending
  );
  return {
    field: column?.field ?? dateField,
    ascending: Boolean(column && sort === column.ascending),
  };
}
