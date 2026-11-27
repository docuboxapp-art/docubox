import { z } from 'zod';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';
import { isDefinitivelyInvalidAuthToken } from '@/lib/supabase/auth-verification';
import { documentTypeReferences } from '@/lib/catalog/document-reads';
import { formDefinitionFields, responseColumns } from '@/lib/reporting/form-fields';
import { taskStatusAtTime, visibleTaskStatus, isFinishedTask } from '@/lib/tasks/view-state';
import {
  DATASETS,
  datasetIds,
  type DatasetId,
  type ReportField,
  type ReportRow,
} from '@/lib/reporting/catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  workspaceId: z.uuid(),
  dataset: z.enum(datasetIds as [DatasetId, ...DatasetId[]]),
  formId: z.uuid().optional(),
  summary: z.literal('1').optional(),
  period: z.enum(['all', '7d', '30d', '90d', '1y']).default('all'),
  dateField: z.string().max(240).default(''),
});
type Raw = Record<string, any>;
type RowsQuery = {
  range: (from: number, to: number) => PromiseLike<{ data: Raw[] | null; error: unknown }>;
};
const MAX_ROWS = 10000,
  PAGE_SIZE = 500,
  ID_BATCH = 100;
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
const reply = (data: object, status = 200) => Response.json(data, { status, headers });

async function getRows(query: RowsQuery): Promise<{ data: Raw[]; truncated: boolean }> {
  const rows: Raw[] = [];
  while (rows.length <= MAX_ROWS) {
    const size = Math.min(PAGE_SIZE, MAX_ROWS + 1 - rows.length);
    const { data, error } = await query.range(rows.length, rows.length + size - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < size) break;
  }
  return { data: rows.slice(0, MAX_ROWS), truncated: rows.length > MAX_ROWS };
}
const asCount = (value: unknown) => (Array.isArray(value) ? value.length : 0);
const joinLabels = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').join(', ') || null
    : typeof value === 'string'
      ? value
      : null;
const daysByPeriod = { all: 0, '7d': 7, '30d': 30, '90d': 90, '1y': 365 };

export async function GET(request: Request) {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return reply({ error: 'Informe inválido.' }, 400);
  const jwt = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!jwt) return reply({ error: 'Inicia sesión para consultar los informes.' }, 401);
  const { workspaceId, dataset, formId, summary, period, dateField } = parsed.data;
  if (
    (formId && dataset !== 'respuestas') ||
    (summary && !['documentos', 'tareas'].includes(dataset))
  )
    return reply({ error: 'El alcance indicado no aplica a este informe.' }, 400);

  try {
    const deadline = AbortSignal.any([request.signal, AbortSignal.timeout(22000)]);
    const scoped = createAnonClient(jwt, deadline);
    const { data: auth, error: authError } = await scoped.auth.getUser(jwt);
    if (authError && !isDefinitivelyInvalidAuthToken(authError))
      return reply({ error: 'No fue posible verificar la sesión. Intenta nuevamente.' }, 503);
    if (!auth.user || authError)
      return reply({ error: 'Inicia sesión para consultar los informes.' }, 401);
    if (auth.user.is_anonymous || !auth.user.email_confirmed_at)
      return reply({ error: 'Confirma tu correo para consultar los informes.' }, 403);
    const userId = auth.user.id;
    const now = Date.now();
    const service = createServiceClient(deadline);
    const { data: membership, error: membershipError } = await service
      .from('workspace_members')
      .select('role,status,access_expires_at')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (
      !membership ||
      membership.status !== 'active' ||
      (membership.access_expires_at && Date.parse(membership.access_expires_at) <= now)
    )
      return reply({ error: 'No tienes acceso activo a este espacio.' }, 403);
    const manager = ['owner', 'admin'].includes(membership.role);
    const { data: workspace, error: workspaceError } = await service
      .from('workspaces')
      .select('workspace_type,owner_id')
      .eq('id', workspaceId)
      .single();
    if (workspaceError) throw workspaceError;
    const personal = workspace?.workspace_type === 'personal' && workspace.owner_id === userId;

    let rows: ReportRow[] = [];
    let fields: ReportField[] = DATASETS[dataset].fields;
    let formOptions: { id: string; name: string }[] | undefined;
    let truncated = false;
    const source = async (query: RowsQuery) => {
      const result = await getRows(query);
      truncated ||= result.truncated;
      return result.data;
    };
    const linked = async (ids: string[], query: (chunk: string[]) => RowsQuery) => {
      const unique = [...new Set(ids.filter(Boolean))];
      const result: Raw[] = [];
      for (let start = 0; start < unique.length; start += ID_BATCH) {
        const linkedRows = await source(query(unique.slice(start, start + ID_BATCH)));
        const remaining = MAX_ROWS - result.length;
        result.push(...linkedRows.slice(0, remaining));
        if (
          linkedRows.length > remaining ||
          (result.length === MAX_ROWS && start + ID_BATCH < unique.length)
        ) {
          truncated = true;
          break;
        }
      }
      return result;
    };
    const restrictDates = <
      T extends {
        gte: (field: string, value: string) => T;
        lte: (field: string, value: string) => T;
      },
    >(
      query: T,
      columns: Record<string, string>
    ) => {
      const column = Object.hasOwn(columns, dateField) ? columns[dateField] : '';
      if (!column || period === 'all') return query;
      return query
        .gte(column, new Date(now - daysByPeriod[period] * 86400000).toISOString())
        .lte(column, new Date(now).toISOString());
    };
    const profiles = async (ids: (string | null | undefined)[]) => {
      const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
      const data = await linked(unique, (chunk) =>
        service.from('user_profiles').select('id,full_name,email').in('id', chunk).order('id')
      );
      return new Map<string, string>(
        data.map((profile) => [profile.id, profile.full_name || 'Usuario'])
      );
    };
    const documentsQuery = (columns: string, count = false) => {
      const current = `current_custodian_workspace_id.eq.${workspaceId}`;
      const legacy = personal
        ? `or(workspace_id.eq.${workspaceId},workspace_id.is.null)`
        : `workspace_id.eq.${workspaceId}`;
      const query = service
        .from('documentos')
        .select(columns, count ? { head: true, count: 'exact' } : {})
        .is('deleted_at', null)
        .is('trashed_at', null)
        .is('purged_at', null)
        .or(`${current},and(current_custodian_workspace_id.is.null,${legacy})`);
      return personal || !manager ? query.eq('owner_id', userId) : query;
    };
    const documents = async (withParticipants = false) => {
      const columns =
        'id,nombre,documento_id,descripcion,estado,tipo_documento_id,otro_tipo_documento,owner_id,es_urgente,file_size,created_at,updated_at,fecha_vencimiento,fecha_completado,folio_interno,numero_oficio,priority,source_template_id,source_form_response_id,es_publico,cancelado_at';
      const query = documentsQuery(columns + (withParticipants ? ',participantes' : ''));
      return source(
        (dataset === 'documentos'
          ? restrictDates(query, {
              creado: 'created_at',
              actualizado: 'updated_at',
              vence: 'fecha_vencimiento',
              completado: 'fecha_completado',
              cancelado: 'cancelado_at',
            })
          : query
        )
          .order('created_at', { ascending: false })
          .order('id')
      );
    };
    const forms = async () => {
      let query = service
        .from('form_templates')
        .select(
          'id,name,description,status,version_number,schema,form_schema,created_by,created_at,updated_at,requires_signature,published_at,archived_at,closed_at'
        )
        .eq('workspace_id', workspaceId);
      if (!manager) query = query.eq('created_by', userId);
      return source(
        (dataset === 'formularios'
          ? restrictDates(query, {
              creado: 'created_at',
              actualizado: 'updated_at',
              publicado: 'published_at',
              cerrado: 'closed_at',
              archivado: 'archived_at',
            })
          : query
        )
          .order('created_at', { ascending: false })
          .order('id')
      );
    };
    const cases = () => {
      let query = service
        .from('case_files')
        .select(
          'id,folio,title,description,case_type,case_subtype,subject_name,status,priority,progress,owner_user_id,created_by,created_at,updated_at,opened_at,target_close_at,closed_at,responsible_area,tags'
        )
        .eq('workspace_id', workspaceId);
      if (!manager) query = query.or(`owner_user_id.eq.${userId},created_by.eq.${userId}`);
      return source(
        (dataset === 'expedientes'
          ? restrictDates(query, {
              creado: 'created_at',
              actualizado: 'updated_at',
              apertura: 'opened_at',
              objetivo: 'target_close_at',
              cerrado: 'closed_at',
            })
          : query
        )
          .order('created_at', { ascending: false })
          .order('id')
      );
    };
    const tasks = (columns: string, count = false) =>
      scoped
        .from('tareas')
        .select(columns, count ? { head: true, count: 'exact' } : {})
        .eq('workspace_id', workspaceId);

    if (summary) {
      const result =
        dataset === 'documentos'
          ? await documentsQuery('id', true)
          : await tasks('id', true).not('estado', 'in', '(completada,cancelada,rechazada)');
      if (result.error) throw result.error;
      return reply({ dataset, total: result.count ?? 0 });
    }

    if (dataset === 'documentos') {
      const docs = await documents(true);
      const [owners, types] = await Promise.all([
        profiles(docs.map((row) => row.owner_id)),
        linked(
          docs.map((row) => row.tipo_documento_id),
          (chunk) => documentTypeReferences(service, chunk)
        ),
      ]);
      const typeNames = new Map(types.map((type) => [type.id, type.nombre]));
      rows = docs.map((row) => ({
        nombre: row.nombre,
        folio: row.documento_id,
        descripcion: row.descripcion,
        estado: row.estado,
        tipo: typeNames.get(row.tipo_documento_id) || row.otro_tipo_documento || null,
        propietario: owners.get(row.owner_id) || null,
        participantes: asCount(row.participantes),
        urgente: Boolean(row.es_urgente || row.priority === 'urgent'),
        tamano: row.file_size ?? null,
        creado: row.created_at,
        actualizado: row.updated_at,
        vence: row.fecha_vencimiento,
        completado: row.fecha_completado,
        folio_interno: row.folio_interno,
        oficio: row.numero_oficio,
        prioridad: row.es_urgente ? 'urgent' : row.priority || 'normal',
        publico: Boolean(row.es_publico),
        cancelado: row.cancelado_at,
        origen: row.source_form_response_id
          ? 'Formulario'
          : row.source_template_id
            ? 'Plantilla'
            : 'Documento',
      }));
    } else if (dataset === 'plantillas') {
      let query = service
        .from('plantillas')
        .select(
          'id,nombre,descripcion,category,language,estado,estado_plantilla,requires_efirma,requires_nom151,fields,created_by,created_at,updated_at,numero_oficio,area_responsable,tipo_plantilla,version_publicada,revisor_nombre,last_draft_at'
        )
        .eq('workspace_id', workspaceId);
      if (!manager) query = query.eq('created_by', userId);
      const items = await source(
        restrictDates(query, {
          creado: 'created_at',
          actualizado: 'updated_at',
          ultimo_borrador: 'last_draft_at',
        })
          .order('created_at', { ascending: false })
          .order('id')
      );
      const names = await profiles(items.map((row) => row.created_by));
      rows = items.map((row) => ({
        nombre: row.nombre,
        descripcion: row.descripcion,
        categoria: row.category,
        estado: row.estado_plantilla || row.estado,
        idioma: row.language,
        efirma: Boolean(row.requires_efirma),
        nom151: Boolean(row.requires_nom151),
        campos: asCount(row.fields),
        creador: names.get(row.created_by) || null,
        creado: row.created_at,
        actualizado: row.updated_at,
        oficio: row.numero_oficio,
        area: row.area_responsable,
        tipo: row.tipo_plantilla,
        version: row.version_publicada,
        revisor: row.revisor_nombre,
        ultimo_borrador: row.last_draft_at,
      }));
    } else if (dataset === 'formularios' || dataset === 'respuestas') {
      const items = await forms();
      if (dataset === 'respuestas')
        formOptions = items
          .map((row) => ({ id: row.id, name: row.name }))
          .sort((a, b) => a.name.localeCompare(b.name, 'es'));
      const selected = formId ? items.filter((row) => row.id === formId) : items;
      if (formId && !selected.length)
        return reply(
          { error: 'El formulario elegido ya no está disponible en este espacio.' },
          404
        );
      const responseSelect =
        dataset === 'formularios'
          ? 'id,template_id'
          : 'id,template_id,token_id,document_id,response_data,submitted_at,pdf_output_path,status,folio,respondent_name,respondent_email';
      const responses = await linked(
        selected.map((row) => row.id),
        (chunk) => {
          const query = service
            .from('form_responses')
            .select(responseSelect)
            .eq('workspace_id', workspaceId)
            .in('template_id', chunk)
            .not('submitted_at', 'is', null)
            .or('status.is.null,status.neq.draft');
          return (
            dataset === 'respuestas' ? restrictDates(query, { enviado: 'submitted_at' }) : query
          )
            .order('submitted_at', { ascending: false })
            .order('id');
        }
      );
      if (dataset === 'formularios') {
        const names = await profiles(items.map((row) => row.created_by));
        const counts = new Map<string, number>();
        responses.forEach((row) =>
          counts.set(row.template_id, (counts.get(row.template_id) || 0) + 1)
        );
        rows = items.map((row) => ({
          nombre: row.name,
          descripcion: row.description,
          estado: row.status,
          version: row.version_number || 1,
          campos: formDefinitionFields({ schema: row.schema, form_schema: row.form_schema }).length,
          respuestas: counts.get(row.id) || 0,
          creador: names.get(row.created_by) || null,
          creado: row.created_at,
          actualizado: row.updated_at,
          requiere_firma: Boolean(row.requires_signature),
          publicado: row.published_at,
          cerrado: row.closed_at,
          archivado: row.archived_at,
        }));
      } else {
        const [generatedDocuments, tokens] = await Promise.all([
          linked(
            responses.map((row) => row.document_id),
            (chunk) => documentsQuery('id,nombre').in('id', chunk).order('id')
          ),
          linked(
            responses.map((row) => row.token_id),
            (chunk) =>
              service
                .from('form_tokens')
                .select('id,template_id,recipient_name,recipient_email,access_mode')
                .in('id', chunk)
                .order('id')
          ),
        ]);
        const documentNames = new Map(generatedDocuments.map((row) => [row.id, row.nombre]));
        const tokenMap = new Map(tokens.map((row) => [row.id, row]));
        const formMap = new Map(selected.map((row) => [row.id, row]));
        const captured = responseColumns(
          selected.map(({ id, name, schema, form_schema }) => ({ id, name, schema, form_schema }))
        );
        fields = [...fields, ...captured.fields];
        rows = responses.map((row) => {
          const invitation = tokenMap.get(row.token_id);
          const token = invitation?.template_id === row.template_id ? invitation : undefined;
          const form = formMap.get(row.template_id);
          return {
            formulario: form?.name || null,
            participante: row.respondent_name || token?.recipient_name || null,
            correo: row.respondent_email || token?.recipient_email || null,
            documento:
              documentNames.get(row.document_id) ||
              (row.document_id ? 'Documento vinculado' : null),
            enviado: row.submitted_at,
            estado: row.status || 'submitted',
            folio: row.folio,
            acceso: token?.access_mode || null,
            pdf: Boolean(row.pdf_output_path),
            requiere_firma: Boolean(form?.requires_signature),
            ...captured.project(row.template_id, row.response_data),
          };
        });
      }
    } else if (dataset === 'expedientes') {
      const items = await cases();
      const names = await profiles(items.flatMap((row) => [row.owner_user_id, row.created_by]));
      rows = items.map((row) => ({
        folio: row.folio,
        nombre: row.title,
        descripcion: row.description,
        tipo: row.case_type,
        estado: row.status,
        prioridad: row.priority,
        progreso: row.progress ?? 0,
        responsable: names.get(row.owner_user_id) || null,
        creado: row.created_at,
        objetivo: row.target_close_at,
        cerrado: row.closed_at,
        subtipo: row.case_subtype,
        sujeto: row.subject_name,
        area: row.responsible_area,
        emisor: names.get(row.created_by) || null,
        etiquetas: joinLabels(row.tags),
        apertura: row.opened_at,
        actualizado: row.updated_at,
      }));
    } else if (dataset === 'tareas') {
      const items = await source(
        restrictDates(
          tasks(
            'id,title,description,tipo,work_kind,estado,prioridad,riesgo,origin,assigned_to,created_by,responsible_name,creator_name,document_name,expediente_name,created_at,updated_at,due_date,completed_at,scheduled_for,is_blocked,is_overdue,is_critical,tags,sla_due_at'
          ),
          {
            creado: 'created_at',
            actualizado: 'updated_at',
            vence: 'due_date',
            completado: 'completed_at',
            programada: 'scheduled_for',
            sla: 'sla_due_at',
          }
        )
          .order('created_at', { ascending: false })
          .order('id')
      );
      const names = await profiles(items.flatMap((row) => [row.assigned_to, row.created_by]));
      rows = items.map((row) => {
        const status = taskStatusAtTime(
          { status: row.estado, scheduledFor: row.scheduled_for },
          now
        );
        const isOverdue = Boolean(
          row.is_overdue || (row.due_date && Date.parse(row.due_date) < now)
        );
        return {
          nombre: row.title,
          descripcion: row.description,
          tipo: row.tipo,
          clase: row.work_kind,
          estado: visibleTaskStatus({ status, isOverdue, isBlocked: row.is_blocked }),
          prioridad: row.prioridad,
          riesgo: row.riesgo,
          origen: row.origin,
          responsable: row.responsible_name || names.get(row.assigned_to) || null,
          creador: row.creator_name || names.get(row.created_by) || null,
          recurso: row.document_name || row.expediente_name || null,
          creado: row.created_at,
          vence: row.due_date,
          completado: row.completed_at,
          actualizado: row.updated_at,
          programada: row.scheduled_for,
          sla: row.sla_due_at,
          critica: Boolean(row.is_critical),
          bloqueada: !isFinishedTask(status) && (Boolean(row.is_blocked) || status === 'bloqueada'),
          etiquetas: joinLabels(row.tags),
        };
      });
    } else if (dataset === 'participantes') {
      const [docs, visibleCases, formItems] = await Promise.all([
        documents(true),
        cases(),
        forms(),
      ]);
      docs.forEach((doc) =>
        (Array.isArray(doc.participantes) ? doc.participantes : [])
          .filter(Boolean)
          .forEach((person: Raw) => {
            rows.push({
              nombre: person.nombre || person.name || null,
              correo: person.email || person.correo || null,
              rol: person.rolDocumento || person.rol || person.role || person.acto || null,
              estado:
                person.current_access === false
                  ? 'revoked'
                  : person.sub_estado ||
                    person.participation_status ||
                    person.estado ||
                    person.status ||
                    'pending',
              recurso: doc.nombre,
              modulo: 'Documentos',
              creado: person.created_at || doc.created_at,
              respondido:
                person.fecha_participacion || person.fecha_firma || person.fecha_rechazo || null,
              vence: person.portal_token_expires_at || null,
            });
          })
      );
      const [participants, tokens, publicInvitees] = await Promise.all([
        linked(
          visibleCases.map((row) => row.id),
          (chunk) =>
            service
              .from('case_file_participants')
              .select('id,case_file_id,name,email,role,status,created_at')
              .eq('workspace_id', workspaceId)
              .in('case_file_id', chunk)
              .order('created_at', { ascending: false })
              .order('id')
        ),
        linked(
          formItems.map((row) => row.id),
          (chunk) =>
            service
              .from('form_tokens')
              .select(
                'id,template_id,recipient_name,recipient_email,used_at,created_at,expires_at,access_mode'
              )
              .in('template_id', chunk)
              .order('created_at', { ascending: false })
              .order('id')
        ),
        linked(
          formItems.map((row) => row.id),
          (chunk) =>
            service
              .from('form_public_invitees')
              .select('form_id,recipient_name,recipient_email,invited_at')
              .in('form_id', chunk)
              .order('invited_at', { ascending: false })
              .order('form_id')
              .order('recipient_email')
        ),
      ]);
      const casesById = new Map(visibleCases.map((row) => [row.id, row.title]));
      const formNames = new Map(formItems.map((row) => [row.id, row.name]));
      const recipientKey = (form: string, email: string) => form + ':' + email.trim().toLowerCase();
      const claimed = new Set(
        tokens
          .filter((row) => row.access_mode === 'public' && row.recipient_email)
          .map((row) => recipientKey(row.template_id, row.recipient_email))
      );
      rows.push(
        ...participants.map((row) => ({
          nombre: row.name,
          correo: row.email,
          rol: row.role,
          estado: row.status,
          recurso: casesById.get(row.case_file_id) || null,
          modulo: 'Expedientes',
          creado: row.created_at,
          respondido: null,
          vence: null,
        }))
      );
      rows.push(
        ...tokens.map((row) => ({
          nombre: row.recipient_name,
          correo: row.recipient_email,
          rol: 'Invitado',
          estado: row.used_at
            ? 'responded'
            : row.expires_at && Date.parse(row.expires_at) <= now
              ? 'expired'
              : 'pending',
          recurso: formNames.get(row.template_id) || null,
          modulo: 'Formularios',
          creado: row.created_at,
          respondido: row.used_at,
          vence: row.expires_at,
        }))
      );
      rows.push(
        ...publicInvitees
          .filter(
            (row) =>
              row.recipient_email && !claimed.has(recipientKey(row.form_id, row.recipient_email))
          )
          .map((row) => ({
            nombre: row.recipient_name,
            correo: row.recipient_email,
            rol: 'Invitado',
            estado: 'pending',
            recurso: formNames.get(row.form_id) || null,
            modulo: 'Formularios',
            creado: row.invited_at,
            respondido: null,
            vence: null,
          }))
      );
      rows.sort((a, b) => String(b.creado || '').localeCompare(String(a.creado || '')));
    } else if (dataset === 'actividad') {
      const [docs, formItems, visibleCases, taskItems] = await Promise.all([
        documents(),
        forms(),
        cases(),
        source(tasks('id,title').order('id')),
      ]);
      if (docs.length) {
        const events = await linked(
          docs.map((row) => row.id),
          (chunk) =>
            restrictDates(
              service
                .from('document_activity_log')
                .select('id,documento_id,actor_nombre,actor_email,action,category,created_at')
                .in('documento_id', chunk),
              { fecha: 'created_at' }
            )
              .order('created_at', { ascending: false })
              .order('id')
        );
        const docNames = new Map(docs.map((row) => [row.id, row.nombre]));
        rows.push(
          ...events.map((row) => ({
            accion: row.action,
            categoria: row.category,
            actor: row.actor_nombre,
            correo: row.actor_email,
            documento: docNames.get(row.documento_id) || null,
            modulo: 'Documentos',
            fecha: row.created_at,
          }))
        );
      }
      if (formItems.length) {
        const events = await linked(
          formItems.map((row) => row.id),
          (chunk) =>
            restrictDates(
              service
                .from('form_audit_logs')
                .select('id,form_id,actor_email,action,created_at')
                .eq('workspace_id', workspaceId)
                .in('form_id', chunk),
              { fecha: 'created_at' }
            )
              .order('created_at', { ascending: false })
              .order('id')
        );
        const names = new Map(formItems.map((row) => [row.id, row.name]));
        rows.push(
          ...events.map((row) => ({
            accion: row.action,
            categoria: 'Formulario',
            actor: row.actor_email,
            correo: row.actor_email,
            documento: names.get(row.form_id) || null,
            modulo: 'Formularios',
            fecha: row.created_at,
          }))
        );
      }
      if (visibleCases.length) {
        const events = await linked(
          visibleCases.map((row) => row.id),
          (chunk) =>
            restrictDates(
              service
                .from('case_file_audit_events')
                .select('id,case_file_id,actor_label,action,occurred_at')
                .eq('workspace_id', workspaceId)
                .in('case_file_id', chunk),
              { fecha: 'occurred_at' }
            )
              .order('occurred_at', { ascending: false })
              .order('id')
        );
        const names = new Map(visibleCases.map((row) => [row.id, row.title]));
        rows.push(
          ...events.map((row) => ({
            accion: row.action,
            categoria: 'Expediente',
            actor: row.actor_label,
            correo: null,
            documento: names.get(row.case_file_id) || null,
            modulo: 'Expedientes',
            fecha: row.occurred_at,
          }))
        );
      }
      if (taskItems.length) {
        const events = await linked(
          taskItems.map((row) => row.id),
          (chunk) =>
            restrictDates(
              service
                .from('task_history')
                .select('id,tarea_id,action,actor_name,created_at')
                .eq('workspace_id', workspaceId)
                .in('tarea_id', chunk),
              { fecha: 'created_at' }
            )
              .order('created_at', { ascending: false })
              .order('id')
        );
        const names = new Map(taskItems.map((row) => [row.id, row.title]));
        rows.push(
          ...events.map((row) => ({
            accion: row.action,
            categoria: 'Tarea',
            actor: row.actor_name,
            correo: null,
            documento: names.get(row.tarea_id) || null,
            modulo: 'Tareas',
            fecha: row.created_at,
          }))
        );
      }
      if (personal) {
        const logins = await source(
          restrictDates(
            service
              .from('login_activity_log')
              .select('id,event_type,status,created_at')
              .eq('user_id', userId),
            { fecha: 'created_at' }
          )
            .order('created_at', { ascending: false })
            .order('id')
        );
        rows.push(
          ...logins.map((row) => ({
            accion: row.event_type,
            categoria: row.status,
            actor: auth.user.email || null,
            correo: auth.user.email || null,
            documento: null,
            modulo: 'Acceso',
            fecha: row.created_at,
          }))
        );
      }
      rows.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
    } else if (dataset === 'usuarios') {
      const items = await source(
        restrictDates(
          scoped
            .from('workspace_members')
            .select('id,user_id,role,status,joined_at,access_expires_at')
            .eq('workspace_id', workspaceId),
          { ingreso: 'joined_at', vence: 'access_expires_at' }
        )
          .order('joined_at', { ascending: false })
          .order('id')
      );
      const people = await linked(
        items.map((row) => row.user_id),
        (chunk) =>
          service.from('user_profiles').select('id,full_name,email').in('id', chunk).order('id')
      );
      const names = new Map(people.map((row) => [row.id, row]));
      rows = items.map((row) => ({
        nombre: names.get(row.user_id)?.full_name || null,
        correo: names.get(row.user_id)?.email || null,
        rol: row.role,
        estado: row.status,
        ingreso: row.joined_at,
        vence: row.access_expires_at,
      }));
    } else if (dataset === 'contactos') {
      const items = await source(
        restrictDates(
          scoped
            .from('contacts')
            .select(
              'id,nombre,apellido_paterno,apellido_materno,email,telefono,empresa,cargo,tipo_persona,etiqueta_rol,canal_preferido,created_at,updated_at,tags'
            )
            .eq('user_id', userId),
          { creado: 'created_at', actualizado: 'updated_at' }
        )
          .order('created_at', { ascending: false })
          .order('id')
      );
      rows = items.map((row) => ({
        nombre: [row.nombre, row.apellido_paterno, row.apellido_materno].filter(Boolean).join(' '),
        correo: row.email,
        telefono: row.telefono,
        empresa: row.empresa,
        cargo: row.cargo,
        tipo: row.tipo_persona,
        rol: row.etiqueta_rol,
        canal: row.canal_preferido,
        creado: row.created_at,
        actualizado: row.updated_at,
        etiquetas: joinLabels(row.tags),
      }));
    } else if (dataset === 'certificaciones') {
      const items = await source(
        restrictDates(
          scoped
            .from('certification_cases')
            .select(
              'id,human_folio,title,description,source_type,service_key,status,provider_mode,created_by,assigned_reviewer_id,created_at,submitted_at,issued_at,validated_at,purpose_key,retention_ends_at,updated_at'
            )
            .eq('workspace_id', workspaceId),
          {
            creado: 'created_at',
            actualizado: 'updated_at',
            enviado: 'submitted_at',
            emitido: 'issued_at',
            validado: 'validated_at',
            conservar_hasta: 'retention_ends_at',
          }
        )
          .order('created_at', { ascending: false })
          .order('id')
      );
      const names = await profiles(
        items.flatMap((row) => [row.created_by, row.assigned_reviewer_id])
      );
      rows = items.map((row) => ({
        folio: row.human_folio,
        nombre: row.title,
        descripcion: row.description,
        origen: row.source_type,
        servicio: row.service_key,
        estado: row.status,
        modo: row.provider_mode,
        creador: names.get(row.created_by) || null,
        creado: row.created_at,
        enviado: row.submitted_at,
        emitido: row.issued_at,
        validado: row.validated_at,
        finalidad: row.purpose_key,
        conservar_hasta: row.retention_ends_at,
        actualizado: row.updated_at,
        revisor: names.get(row.assigned_reviewer_id) || null,
      }));
    } else if (dataset === 'notificaciones') {
      let query = scoped
        .from('notifications')
        .select('id,title,description,type,category,priority,status,read,created_at,read_at')
        .eq('user_id', userId);
      query = personal
        ? query.or(`workspace_id.eq.${workspaceId},workspace_id.is.null`)
        : query.eq('workspace_id', workspaceId);
      const items = await source(
        restrictDates(query, { creado: 'created_at', leido: 'read_at' })
          .order('created_at', { ascending: false })
          .order('id')
      );
      rows = items.map((row) => ({
        titulo: row.title,
        descripcion: row.description,
        tipo: row.type,
        categoria: row.category,
        prioridad: row.priority,
        estado: row.status,
        leida: Boolean(row.read),
        creado: row.created_at,
        leido: row.read_at,
      }));
    } else if (dataset === 'colaboracion') {
      const items = await source(
        restrictDates(
          scoped
            .from('collaboration_spaces')
            .select(
              'id,name,description,space_type,status,confidentiality,owner_id,created_by,created_at,updated_at,closed_at,archived_at'
            )
            .eq('workspace_id', workspaceId),
          {
            creado: 'created_at',
            actualizado: 'updated_at',
            archivado: 'archived_at',
            cerrado: 'closed_at',
          }
        )
          .order('created_at', { ascending: false })
          .order('id')
      );
      const names = await profiles(items.flatMap((row) => [row.owner_id, row.created_by]));
      rows = items.map((row) => ({
        nombre: row.name,
        descripcion: row.description,
        tipo: row.space_type,
        estado: row.status,
        confidencialidad: row.confidentiality,
        responsable: names.get(row.owner_id) || null,
        creado: row.created_at,
        cerrado: row.closed_at,
        actualizado: row.updated_at,
        archivado: row.archived_at,
        creador: names.get(row.created_by) || null,
      }));
    } else if (dataset === 'firmas_masivas') {
      const items = await source(
        restrictDates(
          scoped
            .from('bulk_signature_campaigns')
            .select(
              'id,name,status,total_items,completed_items,pending_items,failed_items,participant_count,campaign_type,source_type,priority,department,internal_reference,owner_user_id,created_at,scheduled_at,started_at,expires_at,completed_at,closed_at,updated_at'
            )
            .eq('workspace_id', workspaceId),
          {
            creado: 'created_at',
            actualizado: 'updated_at',
            programada: 'scheduled_at',
            iniciada: 'started_at',
            vence: 'expires_at',
            completado: 'completed_at',
            cerrado: 'closed_at',
          }
        )
          .order('created_at', { ascending: false })
          .order('id')
      );
      const names = await profiles(items.map((row) => row.owner_user_id));
      rows = items.map((row) => ({
        nombre: row.name,
        estado: row.status,
        total: row.total_items,
        completados: row.completed_items,
        pendientes: row.pending_items,
        fallidos: row.failed_items,
        participantes: row.participant_count,
        tipo: row.campaign_type,
        origen: row.source_type,
        prioridad: row.priority,
        area: row.department,
        referencia: row.internal_reference,
        responsable: names.get(row.owner_user_id) || null,
        creado: row.created_at,
        programada: row.scheduled_at,
        iniciada: row.started_at,
        vence: row.expires_at,
        completado: row.completed_at,
        cerrado: row.closed_at,
        actualizado: row.updated_at,
      }));
    }
    if (rows.length > MAX_ROWS) {
      rows = rows.slice(0, MAX_ROWS);
      truncated = true;
    }
    return reply({
      dataset,
      rows,
      fields,
      total: rows.length,
      truncated,
      formOptions,
      generatedAt: new Date(now).toISOString(),
    });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    console.error('[reportes] No se pudo cargar el módulo', { dataset, code });
    return reply(
      { error: 'No se pudieron consultar los datos de este informe. Intenta nuevamente.' },
      503
    );
  }
}
