import { z } from 'zod';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';
import { DATASETS, datasetIds, type DatasetId, type ReportField, type ReportRow } from '@/lib/reporting/catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({ workspaceId: z.string().uuid(), dataset: z.enum(datasetIds as [DatasetId, ...DatasetId[]]) });
type Raw = Record<string, any>;
const MAX_ROWS = 10000;

async function getRows(query: any): Promise<{ data: Raw[]; truncated: boolean }> {
  const rows: Raw[] = [];
  for (let from = 0; from <= MAX_ROWS; from += 1000) {
    const { data, error } = await query.range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) return { data: rows, truncated: false };
    if (from + 1000 >= MAX_ROWS) return { data: rows, truncated: true };
  }
  return { data: rows, truncated: true };
}
const asCount = (value: unknown) => Array.isArray(value) ? value.length : 0;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ workspaceId: url.searchParams.get('workspaceId'), dataset: url.searchParams.get('dataset') });
  if (!parsed.success) return Response.json({ error: 'Informe inválido.' }, { status: 400 });
  const jwt = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return Response.json({ error: 'Inicia sesión.' }, { status: 401 });
  const { data: auth, error: authError } = await createAnonClient().auth.getUser(jwt);
  if (authError || !auth.user) return Response.json({ error: 'Sesión inválida.' }, { status: 401 });
  const service = createServiceClient();
  const { workspaceId, dataset } = parsed.data;
  const { data: membership } = await service.from('workspace_members').select('role,status')
    .eq('workspace_id', workspaceId).eq('user_id', auth.user.id).maybeSingle();
  if (!membership || membership.status !== 'active') return Response.json({ error: 'No tienes acceso a este espacio.' }, { status: 403 });
  const manager = ['owner', 'admin'].includes(membership.role);
  const { data: workspace } = await service.from('workspaces').select('workspace_type,owner_id').eq('id', workspaceId).single();
  const personal = workspace?.workspace_type === 'personal' && workspace?.owner_id === auth.user.id;
  const userId = auth.user.id;

  try {
    let rows: ReportRow[] = [];
    let fields: ReportField[] = DATASETS[dataset].fields;
    let truncated = false;
    const source = async (query: any) => { const result = await getRows(query); truncated ||= result.truncated; return result.data; };
    const profiles = async (ids: (string | null | undefined)[]) => {
      const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
      if (!unique.length) return new Map<string, string>();
      const { data, error } = await service.from('user_profiles').select('id,full_name,email').in('id', unique);
      if (error) throw error;
      return new Map((data || []).map(profile => [profile.id, profile.full_name || profile.email || 'Usuario']));
    };
    const documents = async () => {
      const columns = 'id,nombre,documento_id,descripcion,estado,tipo_documento_id,owner_id,participantes,es_urgente,file_size,created_at,updated_at,fecha_vencimiento,fecha_completado';
      if (personal) return source(service.from('documentos').select(columns).is('deleted_at', null).eq('owner_id', userId)
        .or(`workspace_id.eq.${workspaceId},workspace_id.is.null`).order('created_at', { ascending: false }));
      let query = service.from('documentos').select(columns).eq('workspace_id', workspaceId).is('deleted_at', null).order('created_at', { ascending: false });
      if (!manager) query = query.eq('owner_id', userId);
      return source(query);
    };
    const forms = async () => {
      let query = service.from('form_templates').select('id,name,description,status,version_number,schema,created_by,created_at,updated_at')
        .eq('workspace_id', workspaceId).order('created_at', { ascending: false });
      if (!manager) query = query.eq('created_by', userId);
      return source(query);
    };

    if (dataset === 'documentos') {
      const docs = await documents();
      const [owners, types] = await Promise.all([profiles(docs.map(row => row.owner_id)), service.from('tipo_documento').select('id,nombre')]);
      if (types.error) throw types.error;
      const typeNames = new Map((types.data || []).map(type => [type.id, type.nombre]));
      rows = docs.map(row => ({ nombre: row.nombre, folio: row.documento_id, descripcion: row.descripcion,
        estado: row.estado, tipo: typeNames.get(row.tipo_documento_id) || null, propietario: owners.get(row.owner_id) || null,
        participantes: asCount(row.participantes), urgente: Boolean(row.es_urgente), tamano: row.file_size || 0,
        creado: row.created_at, actualizado: row.updated_at, vence: row.fecha_vencimiento, completado: row.fecha_completado }));
    } else if (dataset === 'plantillas') {
      let query = service.from('plantillas').select('id,nombre,descripcion,category,language,estado,estado_plantilla,requires_efirma,requires_nom151,fields,created_by,created_at,updated_at,numero_oficio,area_responsable,tipo_plantilla,version_publicada,revisor_nombre,last_draft_at')
        .eq('workspace_id', workspaceId).order('created_at', { ascending: false });
      if (!manager) query = query.eq('created_by', userId);
      const items = await source(query);
      const names = await profiles(items.map(row => row.created_by));
      rows = items.map(row => ({ nombre: row.nombre, descripcion: row.descripcion, categoria: row.category, estado: row.estado_plantilla || row.estado,
        idioma: row.language, efirma: Boolean(row.requires_efirma), nom151: Boolean(row.requires_nom151),
        campos: asCount(row.fields), creador: names.get(row.created_by) || null, creado: row.created_at, actualizado: row.updated_at,
        oficio: row.numero_oficio, area: row.area_responsable, tipo: row.tipo_plantilla,
        version: row.version_publicada, revisor: row.revisor_nombre, ultimo_borrador: row.last_draft_at }));
    } else if (dataset === 'formularios' || dataset === 'respuestas') {
      const items = await forms();
      const ids = items.map(row => row.id);
      const names = await profiles(items.map(row => row.created_by));
      const responses = ids.length ? await source(service.from('form_responses').select('id,template_id,token_id,document_id,response_data,submitted_at,pdf_output_path')
        .eq('workspace_id', workspaceId).in('template_id', ids).order('submitted_at', { ascending: false })) : [];
      if (dataset === 'formularios') {
        const counts = new Map<string, number>(); responses.forEach(row => counts.set(row.template_id, (counts.get(row.template_id) || 0) + 1));
        rows = items.map(row => ({ nombre: row.name, descripcion: row.description, estado: row.status, version: row.version_number || 1,
          campos: asCount(row.schema), respuestas: counts.get(row.id) || 0, creador: names.get(row.created_by) || null,
          creado: row.created_at, actualizado: row.updated_at }));
      } else {
        const generatedDocuments = responses.length ? await documents() : [];
        const documentNames = new Map(generatedDocuments.map(row => [row.id, row.nombre]));
        const tokens = responses.length ? await source(service.from('form_tokens').select('id,recipient_name,recipient_email').in('id', responses.map(row => row.token_id))) : [];
        const tokenMap = new Map(tokens.map(row => [row.id, row]));
        const formMap = new Map(items.map(row => [row.id, row.name]));
        const dynamic = new Map<string, ReportField>();
        const fieldTypes = new Map<string, string>();
        items.forEach(form => (Array.isArray(form.schema) ? form.schema : []).forEach((field: Raw) => {
          if (!field.id || !field.label) return;
          const id = `respuesta.${field.id}`;
          fieldTypes.set(id, field.type || 'text');
          dynamic.set(id, { id, label: `${form.name} · ${field.label}`, type: ['number','currency'].includes(field.type) ? 'number' : ['date','datetime'].includes(field.type) ? 'date' : field.type === 'checkbox' ? 'boolean' : 'text' });
        }));
        rows = responses.map(row => {
          const token = tokenMap.get(row.token_id);
          const result: ReportRow = { formulario: formMap.get(row.template_id) || null,
            participante: token?.recipient_name || null, correo: token?.recipient_email || null,
            documento: documentNames.get(row.document_id) || (row.document_id ? 'Documento vinculado' : null), enviado: row.submitted_at,
            estado: row.pdf_output_path ? 'PDF generado' : 'Respuesta recibida' };
          if (row.response_data && typeof row.response_data === 'object' && !Array.isArray(row.response_data)) {
            Object.entries(row.response_data).forEach(([key, value]) => {
              const field = `respuesta.${key}`;
              const privateCapture = ['signature','signature_block','file','file_upload'].includes(fieldTypes.get(field) || '');
              result[field] = value == null ? null : privateCapture ? 'Capturado' : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
                ? value : JSON.stringify(value);
              if (!dynamic.has(field)) dynamic.set(field, { id: field, label: `${formMap.get(row.template_id) || 'Formulario'} · ${key}`, type: 'text' });
            });
          }
          return result;
        });
        fields = [...fields, ...[...dynamic.values()].sort((a, b) => a.label.localeCompare(b.label, 'es'))];
      }
    } else if (dataset === 'expedientes') {
      let query = service.from('case_files').select('id,folio,title,description,case_type,status,priority,progress,owner_user_id,created_by,created_at,target_close_at,closed_at')
        .eq('workspace_id', workspaceId).order('created_at', { ascending: false });
      if (!manager) query = query.or(`owner_user_id.eq.${userId},created_by.eq.${userId}`);
      const items = await source(query);
      const names = await profiles(items.map(row => row.owner_user_id));
      rows = items.map(row => ({ folio: row.folio, nombre: row.title, descripcion: row.description, tipo: row.case_type,
        estado: row.status, prioridad: row.priority, progreso: row.progress || 0, responsable: names.get(row.owner_user_id) || null,
        creado: row.created_at, objetivo: row.target_close_at, cerrado: row.closed_at }));
    } else if (dataset === 'tareas') {
      let query = service.from('tareas').select('id,title,description,tipo,work_kind,estado,prioridad,riesgo,origin,assigned_to,created_by,document_name,expediente_name,created_at,due_date,completed_at')
        .eq('workspace_id', workspaceId).order('created_at', { ascending: false });
      if (!manager) query = query.or(`assigned_to.eq.${userId},created_by.eq.${userId}`);
      const items = await source(query);
      const names = await profiles(items.flatMap(row => [row.assigned_to, row.created_by]));
      rows = items.map(row => ({ nombre: row.title, descripcion: row.description, tipo: row.tipo, clase: row.work_kind,
        estado: row.estado, prioridad: row.prioridad, riesgo: row.riesgo, origen: row.origin,
        responsable: names.get(row.assigned_to) || null, creador: names.get(row.created_by) || null,
        recurso: row.document_name || row.expediente_name || null, creado: row.created_at, vence: row.due_date,
        completado: row.completed_at }));
    } else if (dataset === 'participantes') {
      const [docs, caseFiles, formItems] = await Promise.all([documents(), source(service.from('case_files').select('id,title,owner_user_id,created_by')
        .eq('workspace_id', workspaceId)), forms()]);
      const visibleCases = manager ? caseFiles : caseFiles.filter(row => row.owner_user_id === userId || row.created_by === userId);
      docs.forEach(doc => (Array.isArray(doc.participantes) ? doc.participantes : []).forEach((person: Raw) => {
        rows.push({ nombre: person.nombre || person.name || null, correo: person.email || person.correo || null,
          rol: person.rol || person.role || null, estado: person.estado || person.status || null,
          recurso: doc.nombre, modulo: 'Documentos', creado: doc.created_at });
      }));
      if (visibleCases.length) {
        const participants = await source(service.from('case_file_participants').select('case_file_id,name,email,role,status,created_at')
          .eq('workspace_id', workspaceId).in('case_file_id', visibleCases.map(row => row.id)));
        const casesById = new Map(visibleCases.map(row => [row.id, row.title]));
        rows.push(...participants.map(row => ({ nombre: row.name, correo: row.email, rol: row.role, estado: row.status,
          recurso: casesById.get(row.case_file_id) || null, modulo: 'Expedientes', creado: row.created_at })));
      }
      if (formItems.length) {
        const tokens = await source(service.from('form_tokens').select('template_id,recipient_name,recipient_email,used_at,created_at')
          .in('template_id', formItems.map(row => row.id)));
        const formNames = new Map(formItems.map(row => [row.id, row.name]));
        rows.push(...tokens.map(row => ({ nombre: row.recipient_name, correo: row.recipient_email, rol: 'Invitado',
          estado: row.used_at ? 'Respondió' : 'Pendiente', recurso: formNames.get(row.template_id) || null,
          modulo: 'Formularios', creado: row.created_at })));
      }
    } else if (dataset === 'actividad') {
      const docs = await documents();
      if (docs.length) {
        const events = await source(service.from('document_activity_log').select('documento_id,actor_nombre,actor_email,action,category,created_at')
          .in('documento_id', docs.map(row => row.id)).order('created_at', { ascending: false }));
        const docNames = new Map(docs.map(row => [row.id, row.nombre]));
        rows.push(...events.map(row => ({ accion: row.action, categoria: row.category, actor: row.actor_nombre,
          correo: row.actor_email, documento: docNames.get(row.documento_id) || null, modulo: 'Documentos', fecha: row.created_at })));
      }
      const [formItems, caseItems] = await Promise.all([forms(), source(service.from('case_files')
        .select('id,title,owner_user_id,created_by').eq('workspace_id', workspaceId))]);
      const visibleCases = manager ? caseItems : caseItems.filter(row => row.owner_user_id === userId || row.created_by === userId);
      if (formItems.length) {
        const events = await source(service.from('form_audit_logs').select('form_id,actor_email,action,created_at')
          .eq('workspace_id', workspaceId).in('form_id', formItems.map(row => row.id)).order('created_at', { ascending: false }));
        const names = new Map(formItems.map(row => [row.id, row.name]));
        rows.push(...events.map(row => ({ accion: row.action, categoria: 'Formulario', actor: row.actor_email,
          correo: row.actor_email, documento: names.get(row.form_id) || null, modulo: 'Formularios', fecha: row.created_at })));
      }
      if (visibleCases.length) {
        const events = await source(service.from('case_file_audit_events').select('case_file_id,actor_label,action,occurred_at')
          .eq('workspace_id', workspaceId).in('case_file_id', visibleCases.map(row => row.id)).order('occurred_at', { ascending: false }));
        const names = new Map(visibleCases.map(row => [row.id, row.title]));
        rows.push(...events.map(row => ({ accion: row.action, categoria: 'Expediente', actor: row.actor_label,
          correo: null, documento: names.get(row.case_file_id) || null, modulo: 'Expedientes', fecha: row.occurred_at })));
      }
      let tasksQuery = service.from('tareas').select('id,title,assigned_to,created_by').eq('workspace_id', workspaceId);
      if (!manager) tasksQuery = tasksQuery.or(`assigned_to.eq.${userId},created_by.eq.${userId}`);
      const taskItems = await source(tasksQuery);
      if (taskItems.length) {
        const events = await source(service.from('task_history').select('tarea_id,action,actor_name,created_at')
          .eq('workspace_id', workspaceId).in('tarea_id', taskItems.map(row => row.id)).order('created_at', { ascending: false }));
        const names = new Map(taskItems.map(row => [row.id, row.title]));
        rows.push(...events.map(row => ({ accion: row.action, categoria: 'Tarea', actor: row.actor_name,
          correo: null, documento: names.get(row.tarea_id) || null, modulo: 'Tareas', fecha: row.created_at })));
      }
      const logins = await source(service.from('login_activity_log').select('event_type,status,created_at')
        .eq('user_id', userId).order('created_at', { ascending: false }));
      rows.push(...logins.map(row => ({ accion: row.event_type, categoria: row.status, actor: auth.user.email || null,
        correo: auth.user.email || null, documento: null, modulo: 'Acceso', fecha: row.created_at })));
      rows.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
    } else if (dataset === 'usuarios') {
      const items = await source(service.from('workspace_members').select('user_id,role,status,joined_at').eq('workspace_id', workspaceId));
      const visible = manager ? items : items.filter(row => row.user_id === userId);
      const { data: people, error } = visible.length ? await service.from('user_profiles').select('id,full_name,email').in('id', visible.map(row => row.user_id)) : { data: [], error: null };
      if (error) throw error;
      const names = new Map((people || []).map(row => [row.id, row]));
      rows = visible.map(row => ({ nombre: names.get(row.user_id)?.full_name || null,
        correo: names.get(row.user_id)?.email || null, rol: row.role, estado: row.status, ingreso: row.joined_at }));
    } else if (dataset === 'contactos') {
      const items = await source(service.from('contacts').select('nombre,apellido_paterno,apellido_materno,email,telefono,empresa,cargo,tipo_persona,etiqueta_rol,canal_preferido,created_at,updated_at')
        .eq('user_id', userId).order('created_at', { ascending: false }));
      rows = items.map(row => ({ nombre: [row.nombre,row.apellido_paterno,row.apellido_materno].filter(Boolean).join(' '),
        correo: row.email, telefono: row.telefono, empresa: row.empresa, cargo: row.cargo, tipo: row.tipo_persona,
        rol: row.etiqueta_rol, canal: row.canal_preferido, creado: row.created_at, actualizado: row.updated_at }));
    } else if (dataset === 'certificaciones') {
      let query = service.from('certification_cases').select('human_folio,title,description,source_type,service_key,status,provider_mode,created_by,assigned_reviewer_id,created_at,submitted_at,issued_at,validated_at')
        .eq('workspace_id', workspaceId).order('created_at', { ascending: false });
      if (!manager) query = query.or(`created_by.eq.${userId},assigned_reviewer_id.eq.${userId}`);
      const items = await source(query);
      const names = await profiles(items.map(row => row.created_by));
      rows = items.map(row => ({ folio: row.human_folio, nombre: row.title, descripcion: row.description, origen: row.source_type,
        servicio: row.service_key, estado: row.status, modo: row.provider_mode, creador: names.get(row.created_by) || null,
        creado: row.created_at, enviado: row.submitted_at, emitido: row.issued_at, validado: row.validated_at }));
    } else if (dataset === 'notificaciones') {
      let query = service.from('notifications').select('title,description,type,category,priority,status,read,created_at,read_at')
        .eq('user_id', userId).order('created_at', { ascending: false });
      query = personal ? query.or(`workspace_id.eq.${workspaceId},workspace_id.is.null`) : query.eq('workspace_id', workspaceId);
      const items = await source(query);
      rows = items.map(row => ({ titulo: row.title, descripcion: row.description, tipo: row.type, categoria: row.category,
        prioridad: row.priority, estado: row.status, leida: Boolean(row.read), creado: row.created_at, leido: row.read_at }));
    } else if (dataset === 'colaboracion') {
      let query = service.from('collaboration_spaces').select('name,description,space_type,status,confidentiality,owner_id,created_by,created_at,closed_at')
        .eq('workspace_id', workspaceId).order('created_at', { ascending: false });
      if (!manager) query = query.or(`owner_id.eq.${userId},created_by.eq.${userId}`);
      const items = await source(query);
      const names = await profiles(items.map(row => row.owner_id));
      rows = items.map(row => ({ nombre: row.name, descripcion: row.description, tipo: row.space_type,
        estado: row.status, confidencialidad: row.confidentiality, responsable: names.get(row.owner_id) || null,
        creado: row.created_at, cerrado: row.closed_at }));
    }
    return Response.json({ dataset, rows, fields, total: rows.length, truncated, generatedAt: new Date().toISOString() },
      { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('Report data failed', dataset, error);
    return Response.json({ error: 'No se pudieron consultar los datos de este informe.' }, { status: 500 });
  }
}
