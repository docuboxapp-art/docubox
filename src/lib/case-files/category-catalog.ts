export interface CaseCategory {
  code: string;
  name: string;
  description: string;
  types: { code: string; name: string }[];
}

const names = (category: string, values: string[]) => values.map((name, index) => ({
  code: `${category.slice(-2)}.${String(index + 1).padStart(2, '0')}`,
  name,
}));

// Master catalog: selections are copied into each expediente type, never edited in place.
export const caseCategories: CaseCategory[] = [
  { code: 'CAT-01', name: 'General y personalizado', description: 'Expedientes de cualquier naturaleza, sin estructura especializada', types: names('CAT-01', ['Expediente general', 'Expediente personal', 'Expediente empresarial', 'Expediente de proyecto', 'Expediente histórico', 'Expediente personalizado']) },
  { code: 'CAT-02', name: 'Clientes', description: 'Incorporación, actualización y administración documental de clientes', types: names('CAT-02', ['Alta de cliente — Persona física', 'Alta de cliente — Persona moral', 'Alta de cliente extranjero', 'Actualización documental de cliente', 'Evaluación y reevaluación de cliente', 'Baja o cierre de relación con cliente']) },
  { code: 'CAT-03', name: 'Proveedores y terceros', description: 'Integración y evaluación de proveedores, contratistas y terceros', types: names('CAT-03', ['Alta de proveedor — Persona física', 'Alta de proveedor — Persona moral', 'Alta de contratista', 'Evaluación y homologación de proveedor', 'Actualización documental de proveedor', 'Baja o cierre de relación con proveedor']) },
  { code: 'CAT-04', name: 'Corporativo y societario', description: 'Constitución, organización y documentación jurídica de empresas', types: names('CAT-04', ['Constitución de sociedad', 'Actas de asamblea y acuerdos corporativos', 'Poderes y representación legal', 'Socios y accionistas', 'Beneficiarios controladores', 'Modificaciones estatutarias']) },
  { code: 'CAT-05', name: 'Contratos y convenios', description: 'Integración, formalización y administración contractual', types: names('CAT-05', ['Contrato de prestación de servicios', 'Contrato de compraventa', 'Contrato de arrendamiento', 'Convenio de confidencialidad', 'Convenio modificatorio', 'Cesión, terminación o rescisión contractual']) },
  { code: 'CAT-06', name: 'Laboral y recursos humanos', description: 'Documentación de colaboradores y relaciones laborales', types: names('CAT-06', ['Reclutamiento e ingreso', 'Alta de colaborador', 'Contratación laboral', 'Expediente laboral del colaborador', 'Capacitación y acreditaciones', 'Baja laboral y finiquito']) },
  { code: 'CAT-07', name: 'Fiscal y contable', description: 'Información tributaria, comprobantes y expedientes fiscales', types: names('CAT-07', ['Integración de expediente fiscal', 'Facturación y comprobación fiscal', 'Opiniones y constancias de cumplimiento', 'Solicitud de devolución de impuestos', 'Auditoría y revisión fiscal', 'Actualización de información fiscal']) },
  { code: 'CAT-08', name: 'Cumplimiento y riesgos', description: 'Debida diligencia, controles, verificaciones y prevención de riesgos', types: names('CAT-08', ['Identificación y conocimiento de cliente (KYC)', 'Conocimiento de empresas (KYB)', 'Prevención de lavado de dinero (PLD/FT)', 'Debida diligencia de terceros', 'Evaluación y clasificación de riesgos', 'Monitoreo y revisión de cumplimiento']) },
  { code: 'CAT-09', name: 'Financiero y bancario', description: 'Financiamientos, bancos, garantías y documentación financiera', types: names('CAT-09', ['Apertura de cuenta bancaria', 'Solicitud de crédito', 'Operación de financiamiento', 'Integración de información bancaria', 'Garantías y avales', 'Actualización de información financiera']) },
  { code: 'CAT-10', name: 'Inmobiliario y patrimonial', description: 'Inmuebles, bienes, operaciones patrimoniales y propiedad', types: names('CAT-10', ['Compraventa de inmueble', 'Arrendamiento inmobiliario', 'Escrituración y formalización', 'Administración de inmueble', 'Propiedad, gravámenes y garantías', 'Avalúos y peritajes']) },
  { code: 'CAT-11', name: 'Comercial y operaciones', description: 'Operaciones comerciales, prestación de servicios y entregas', types: names('CAT-11', ['Integración de operación comercial', 'Suministro de bienes', 'Prestación operativa de servicios', 'Entrega y recepción de bienes o servicios', 'Incidencias y reclamaciones comerciales', 'Garantías y servicios posventa']) },
  { code: 'CAT-12', name: 'Compras, licitaciones y proyectos', description: 'Adquisiciones, concursos, obras y administración de proyectos', types: names('CAT-12', ['Solicitud de compra', 'Expediente de adquisición', 'Licitación o concurso', 'Contratación de obra', 'Hitos, avances y entregables', 'Cierre y recepción de proyecto']) },
  { code: 'CAT-13', name: 'Jurídico y procedimientos', description: 'Asuntos legales, controversias, procedimientos y evidencias', types: names('CAT-13', ['Asunto jurídico general', 'Juicio o litigio', 'Procedimiento administrativo', 'Reclamación o controversia', 'Conciliación y acuerdos', 'Integración de pruebas y evidencias']) },
  { code: 'CAT-14', name: 'Trámites y autorizaciones', description: 'Permisos, licencias, registros y gestiones administrativas', types: names('CAT-14', ['Registro e inscripción', 'Solicitud de autorización', 'Renovación de licencia o permiso', 'Permiso o autorización sectorial', 'Avisos y modificaciones', 'Gestión documental ante autoridades']) },
  { code: 'CAT-15', name: 'Gestión y certificación documental', description: 'Digitalización, conservación, certificación y evidencia documental', types: names('CAT-15', ['Digitalización e integración documental', 'Custodia y resguardo documental', 'Expediente de firma electrónica', 'Certificación documental', 'Conservación documental NOM-151', 'Auditoría y trazabilidad documental']) },
  { code: 'CAT-16', name: 'Seguros y siniestros', description: 'Pólizas, coberturas, reclamaciones y expedientes de seguros', types: names('CAT-16', ['Contratación de póliza', 'Renovación de póliza', 'Integración de expediente de siniestro', 'Reclamación de seguro', 'Endosos y modificaciones', 'Acreditación de cobertura']) },
];

export const caseTagGroups = [
  { code: 'finalidad', name: 'Finalidad del expediente', color: '#2563eb', tags: ['Incorporación', 'Actualización', 'Renovación', 'Revalidación', 'Regularización', 'Evaluación', 'Auditoría', 'Certificación', 'Seguimiento', 'Cierre'] },
  { code: 'perfil', name: 'Relación o perfil', color: '#7c3aed', tags: ['Estratégico', 'Recurrente', 'Ocasional', 'Primera vez', 'Interno', 'Externo', 'Filial', 'Grupo empresarial', 'Gubernamental', 'Internacional'] },
  { code: 'materia', name: 'Materia', color: '#0891b2', tags: ['Fiscal', 'Corporativo', 'Jurídico', 'Laboral', 'Bancario', 'Financiero', 'Comercial', 'Inmobiliario', 'Regulatorio', 'Ambiental', 'Tecnológico', 'Administrativo'] },
  { code: 'actividad', name: 'Actividad u operación', color: '#d97706', tags: ['Servicios', 'Suministro', 'Construcción', 'Arrendamiento', 'Compraventa', 'Consultoría', 'Logística', 'Licitaciones', 'Mantenimiento', 'Comercio exterior'] },
  { code: 'alcance', name: 'Alcance geográfico', color: '#059669', tags: ['Nacional', 'Extranjero', 'Transfronterizo', 'Regional', 'Multisede', 'Sucursal', 'Corporativo nacional', 'Corporativo internacional'] },
  { code: 'documental', name: 'Características documentales', color: '#475569', tags: ['Documentación histórica', 'Múltiples participantes', 'Documentación extranjera', 'Traducción requerida', 'Apostilla', 'Documentos notariales', 'Evidencia digital', 'Documentación de terceros', 'Integración mixta', 'Expediente físico digitalizado'] },
  { code: 'control', name: 'Control y seguimiento', color: '#dc2626', tags: ['Supervisión periódica', 'Evaluación reforzada', 'Control preventivo', 'Revisión extraordinaria', 'Seguimiento de terceros', 'Monitoreo continuo', 'Control anual', 'Proyecto especial'] },
] as const;

export const caseTags = caseTagGroups.flatMap((group) => group.tags.map((name, index) => ({
  id: `${group.code}-${index + 1}`,
  nombre: name,
  color: group.color,
  group: group.name,
})));
