import { createClient } from '@supabase/supabase-js';
import { dbSchemaMap as s } from './dbSchemaMap';

// Use service role for server-side queries (bypasses RLS for authorized reads)
function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Verify user is a member of the workspace */
export async function verifyWorkspaceMembership(
  workspaceId: string,
  userId: string
): Promise<boolean> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from(s.workspaceMembersTable)
    .select(s.memberUserField)
    .eq(s.memberWorkspaceField, workspaceId)
    .eq(s.memberUserField, userId)
    .maybeSingle();
  return !error && !!data;
}

// ── buildUserContext ───────────────────────────────────────────────────────

/**
 * Builds a comprehensive authorized context for the authenticated user
 * within the given workspace. Queries real Supabase tables.
 */
export async function buildUserContext(userId: string, workspaceId: string) {
  const supabase = getServiceClient();
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const context: Record<string, any> = {};

  // ── 1. User profile (including sensitive fields) ─────────────────────────
  try {
    const { data: profile } = await supabase
      .from(s.usersTable)
      .select(`
        ${s.userIdField},
        ${s.userFullNameField},
        ${s.userNombreField},
        ${s.userApellidoPaternoField},
        ${s.userApellidoMaternoField},
        ${s.userEmailField},
        ${s.userAvatarField},
        ${s.userAccountTypeField},
        ${s.userRfcField},
        ${s.userCurpField},
        ${s.userPhoneField},
        ${s.userRegimenFiscalField},
        ${s.userCodigoPostalField},
        ${s.userEstadoField},
        ${s.userMunicipioField},
        ${s.userColoniaField},
        ${s.userCalleField},
        ${s.userNumExteriorField},
        ${s.userNumInteriorField},
        ${s.userCreatedAtField},
        updated_at
      `)
      .eq(s.userIdField, userId)
      .maybeSingle();
    if (profile) context.userProfile = profile;
  } catch (e) {
    console.error('[buildUserContext] profile error:', e);
  }

  // ── 2. Workspace + membership role ──────────────────────────────────────
  try {
    const { data: workspace } = await supabase
      .from(s.workspacesTable)
      .select(`
        ${s.workspaceIdField},
        ${s.workspaceNameField},
        ${s.workspaceTypeField},
        ${s.workspaceOwnerField},
        ${s.workspaceCreatedAtField}
      `)
      .eq(s.workspaceIdField, workspaceId)
      .maybeSingle();

    const { data: membership } = await supabase
      .from(s.workspaceMembersTable)
      .select(`${s.memberRoleField}, ${s.memberJoinedAtField}`)
      .eq(s.memberWorkspaceField, workspaceId)
      .eq(s.memberUserField, userId)
      .maybeSingle();

    if (workspace) {
      context.workspace = {
        ...workspace,
        userRole: membership?.[s.memberRoleField] ?? null,
        joinedAt: membership?.[s.memberJoinedAtField] ?? null,
        isOwner: workspace[s.workspaceOwnerField] === userId,
      };
    }
  } catch (e) {
    console.error('[buildUserContext] workspace error:', e);
  }

  // ── 3. Subscription / usage ──────────────────────────────────────────────
  try {
    const { data: sub } = await supabase
      .from(s.subscriptionsTable)
      .select(`
        ${s.subscriptionStatusField},
        ${s.subscriptionDocsUsedField},
        ${s.subscriptionDocsLimitField},
        ${s.subscriptionPeriodStartField},
        ${s.subscriptionPeriodEndField},
        plan:${s.subscriptionPlanField}(
          ${s.planNameField},
          ${s.planSlugField},
          ${s.planDocsIncludedField},
          ${s.planFeaturesField}
        )
      `)
      .eq(s.subscriptionWorkspaceField, workspaceId)
      .eq(s.subscriptionUserField, userId)
      .eq(s.subscriptionStatusField, 'active')
      .order(s.subscriptionPeriodStartField, { ascending: false })
      .limit(1)
      .maybeSingle();

    const { count: docsThisMonth } = await supabase
      .from(s.documentsTable)
      .select('id', { count: 'exact', head: true })
      .eq(s.documentWorkspaceField, workspaceId)
      .eq(s.documentCreatedByField, userId)
      .gte(s.documentCreatedAtField, startOfMonth)
      .is('deleted_at', null);

    const { count: docsSentToSign } = await supabase
      .from(s.documentsTable)
      .select('id', { count: 'exact', head: true })
      .eq(s.documentWorkspaceField, workspaceId)
      .eq(s.documentCreatedByField, userId)
      .in(s.documentStatusField, ['en_proceso', 'pendiente_firma'])
      .is('deleted_at', null);

    const { count: docsCompleted } = await supabase
      .from(s.documentsTable)
      .select('id', { count: 'exact', head: true })
      .eq(s.documentWorkspaceField, workspaceId)
      .eq(s.documentCreatedByField, userId)
      .eq(s.documentStatusField, 'completado')
      .is('deleted_at', null);

    const { count: docsPending } = await supabase
      .from(s.documentsTable)
      .select('id', { count: 'exact', head: true })
      .eq(s.documentWorkspaceField, workspaceId)
      .eq(s.documentCreatedByField, userId)
      .eq(s.documentStatusField, 'borrador')
      .is('deleted_at', null);

    context.usage = {
      subscription: sub ?? null,
      documentsCreatedThisMonth: docsThisMonth ?? 0,
      documentsSentToSignature: docsSentToSign ?? 0,
      documentsCompleted: docsCompleted ?? 0,
      documentsPending: docsPending ?? 0,
    };
  } catch (e) {
    console.error('[buildUserContext] usage error:', e);
  }

  // ── 4. Documents created by user ─────────────────────────────────────────
  try {
    const { data: createdDocs } = await supabase
      .from(s.documentsTable)
      .select(`
        ${s.documentIdField},
        ${s.documentTitleField},
        ${s.documentStatusField},
        ${s.documentCreatedAtField},
        ${s.documentUpdatedAtField},
        ${s.documentExpiryField},
        ${s.documentEsUrgenteField},
        tipo:${s.documentTipoDocumentoField}(${s.tipoDocumentoNameField}),
        grupo:${s.documentGrupoTipoField}(${s.grupoTipoNameField}),
        carpeta:${s.documentFolderField}(${s.carpetaNameField})
      `)
      .eq(s.documentWorkspaceField, workspaceId)
      .eq(s.documentCreatedByField, userId)
      .is('deleted_at', null)
      .order(s.documentCreatedAtField, { ascending: false })
      .limit(20);
    context.createdDocuments = createdDocs ?? [];
  } catch (e) {
    console.error('[buildUserContext] createdDocs error:', e);
  }

  // ── 5 & 6. Documents assigned to user + participations ───────────────────
  try {
    const { data: participations } = await supabase
      .from(s.participationTable)
      .select(`
        ${s.participationDocumentField},
        ${s.participationTypeField},
        ${s.participationSignedField},
        ${s.participationSignedAtField},
        ${s.participationApprovedField},
        ${s.participationApprovedAtField},
        ${s.participationObservacionesField},
        ${s.participationCreatedAtField}
      `)
      .eq(s.participationUserIdField, userId)
      .order(s.participationCreatedAtField, { ascending: false })
      .limit(50);

    if (participations && participations.length > 0) {
      const docIds = [...new Set(participations.map((p: any) => p[s.participationDocumentField]))];

      const { data: assignedDocs } = await supabase
        .from(s.documentsTable)
        .select(`
          ${s.documentIdField},
          ${s.documentTitleField},
          ${s.documentStatusField},
          ${s.documentCreatedAtField},
          ${s.documentExpiryField},
          ${s.documentEsUrgenteField},
          tipo:${s.documentTipoDocumentoField}(${s.tipoDocumentoNameField}),
          grupo:${s.documentGrupoTipoField}(${s.grupoTipoNameField})
        `)
        .in(s.documentIdField, docIds)
        .eq(s.documentWorkspaceField, workspaceId)
        .is('deleted_at', null)
        .limit(30);

      const assignedWithParticipation = (assignedDocs ?? []).map((doc: any) => {
        const participation = participations.find(
          (p: any) => p[s.participationDocumentField] === doc[s.documentIdField]
        );
        return {
          ...doc,
          participationRole: participation?.[s.participationTypeField] ?? null,
          firmada: participation?.[s.participationSignedField] ?? false,
          firmadaAt: participation?.[s.participationSignedAtField] ?? null,
          aprobada: participation?.[s.participationApprovedField] ?? false,
          aprobadaAt: participation?.[s.participationApprovedAtField] ?? null,
          pendingAction: getPendingAction(participation, doc),
        };
      });

      context.assignedDocuments = assignedWithParticipation;
      context.participations = participations;
    } else {
      context.assignedDocuments = [];
      context.participations = [];
    }
  } catch (e) {
    console.error('[buildUserContext] assignedDocs error:', e);
  }

  // ── 7. Document types assigned ───────────────────────────────────────────
  try {
    const assignedDocs: any[] = context.assignedDocuments ?? [];
    const typeSet = new Set<string>();
    const groupSet = new Set<string>();
    for (const doc of assignedDocs) {
      if (doc.tipo?.nombre) typeSet.add(doc.tipo.nombre);
      if (doc.grupo?.nombre) groupSet.add(doc.grupo.nombre);
    }
    const createdDocs: any[] = context.createdDocuments ?? [];
    for (const doc of createdDocs) {
      if (doc.tipo?.nombre) typeSet.add(doc.tipo.nombre);
      if (doc.grupo?.nombre) groupSet.add(doc.grupo.nombre);
    }
    context.documentTypesAssigned = {
      types: Array.from(typeSet),
      groups: Array.from(groupSet),
    };
  } catch (e) {
    console.error('[buildUserContext] documentTypes error:', e);
  }

  // ── 8. Pending actions ───────────────────────────────────────────────────
  try {
    const assignedDocs: any[] = context.assignedDocuments ?? [];
    const pendingSignatures = assignedDocs.filter(
      (d: any) => d.participationRole === 'firmante' && !d.firmada
    );
    const pendingApprovals = assignedDocs.filter(
      (d: any) => d.participationRole === 'aprobador' && !d.aprobada
    );
    const pendingReview = assignedDocs.filter(
      (d: any) => d.participationRole === 'revisor' && !d.firmada && !d.aprobada
    );
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const expiringSoon = assignedDocs.filter((d: any) => {
      if (!d[s.documentExpiryField]) return false;
      const exp = new Date(d[s.documentExpiryField]);
      return exp >= now && exp <= sevenDaysFromNow;
    });
    const overdue = assignedDocs.filter((d: any) => {
      if (!d[s.documentExpiryField]) return false;
      return new Date(d[s.documentExpiryField]) < now;
    });

    context.pendingActions = {
      pendingSignatures: pendingSignatures.map((d: any) => ({
        id: d[s.documentIdField],
        title: d[s.documentTitleField],
        status: d[s.documentStatusField],
        expiry: d[s.documentExpiryField],
        urgent: d[s.documentEsUrgenteField],
      })),
      pendingApprovals: pendingApprovals.map((d: any) => ({
        id: d[s.documentIdField],
        title: d[s.documentTitleField],
        status: d[s.documentStatusField],
      })),
      pendingReview: pendingReview.map((d: any) => ({
        id: d[s.documentIdField],
        title: d[s.documentTitleField],
        status: d[s.documentStatusField],
      })),
      expiringSoon: expiringSoon.map((d: any) => ({
        id: d[s.documentIdField],
        title: d[s.documentTitleField],
        expiry: d[s.documentExpiryField],
      })),
      overdue: overdue.map((d: any) => ({
        id: d[s.documentIdField],
        title: d[s.documentTitleField],
        expiry: d[s.documentExpiryField],
      })),
    };
  } catch (e) {
    console.error('[buildUserContext] pendingActions error:', e);
  }

  // ── 9. Activity history ──────────────────────────────────────────────────
  try {
    const ownedDocIds = (context.createdDocuments ?? [])
      .slice(0, 10)
      .map((d: any) => d[s.documentIdField]);
    const assignedDocIds = (context.assignedDocuments ?? [])
      .slice(0, 10)
      .map((d: any) => d[s.documentIdField]);
    const allDocIds = [...new Set([...ownedDocIds, ...assignedDocIds])];

    if (allDocIds.length > 0) {
      const { data: activity } = await supabase
        .from(s.activityLogTable)
        .select(`
          id,
          ${s.activityDocumentField},
          ${s.activityActorIdField},
          ${s.activityActorNameField},
          ${s.activityActorEmailField},
          ${s.activityActionField},
          ${s.activityCategoryField},
          ${s.activityDetailsField},
          ${s.activityCreatedAtField},
          documento:${s.activityDocumentField}(${s.documentTitleField})
        `)
        .in(s.activityDocumentField, allDocIds)
        .order(s.activityCreatedAtField, { ascending: false })
        .limit(20);
      context.activityHistory = activity ?? [];
    } else {
      context.activityHistory = [];
    }
  } catch (e) {
    console.error('[buildUserContext] activityHistory error:', e);
  }

  // ── 10. Notifications (recent unread) ────────────────────────────────────
  try {
    const { data: notifs } = await supabase
      .from(s.notificationsTable)
      .select(`
        ${s.notificationIdField},
        ${s.notificationTypeField},
        ${s.notificationTitleField},
        ${s.notificationDescriptionField},
        ${s.notificationPriorityField},
        ${s.notificationReadField},
        ${s.notificationCreatedAtField}
      `)
      .eq(s.notificationUserIdField, userId)
      .order(s.notificationCreatedAtField, { ascending: false })
      .limit(20);
    context.notifications = notifs ?? [];
    context.unreadNotificationsCount = (notifs ?? []).filter((n: any) => !n[s.notificationReadField]).length;
  } catch (e) {
    console.error('[buildUserContext] notifications error:', e);
  }

  // ── 11. Contacts ─────────────────────────────────────────────────────────
  try {
    const { data: contacts } = await supabase
      .from(s.contactsTable)
      .select(`
        ${s.contactIdField},
        ${s.contactNombreField},
        ${s.contactApellidoPaternoField},
        ${s.contactEmailField},
        ${s.contactTelefonoField},
        ${s.contactRfcField},
        ${s.contactCreatedAtField}
      `)
      .eq(s.contactUserIdField, userId)
      .order(s.contactCreatedAtField, { ascending: false })
      .limit(30);
    context.contacts = contacts ?? [];
  } catch (e) {
    console.error('[buildUserContext] contacts error:', e);
  }

  // ── 12. Plantillas ───────────────────────────────────────────────────────
  try {
    const { data: plantillas } = await supabase
      .from(s.plantillasTable)
      .select(`
        ${s.plantillaIdField},
        ${s.plantillaNameField},
        ${s.plantillaDescriptionField},
        ${s.plantillaCategoryField},
        ${s.plantillaStatusField},
        ${s.plantillaCreatedAtField}
      `)
      .eq(s.plantillaWorkspaceField, workspaceId)
      .order(s.plantillaCreatedAtField, { ascending: false })
      .limit(20);
    context.plantillas = plantillas ?? [];
  } catch (e) {
    console.error('[buildUserContext] plantillas error:', e);
  }

  // ── 13. Form templates ───────────────────────────────────────────────────
  try {
    const { data: forms } = await supabase
      .from(s.formTemplatesTable)
      .select(`
        ${s.formTemplateIdField},
        ${s.formTemplateNameField},
        ${s.formTemplateDescriptionField},
        ${s.formTemplateStatusField},
        ${s.formTemplateCreatedAtField}
      `)
      .eq(s.formTemplateWorkspaceField, workspaceId)
      .order(s.formTemplateCreatedAtField, { ascending: false })
      .limit(20);
    context.formTemplates = forms ?? [];
  } catch (e) {
    console.error('[buildUserContext] formTemplates error:', e);
  }

  return context;
}

/** Helper: determine pending action label for a participation */
function getPendingAction(participation: any, _doc: any): string | null {
  if (!participation) return null;
  const role = participation.tipo_participacion;
  if (role === 'firmante' && !participation.firma_completada) return 'pendiente_de_firma';
  if (role === 'aprobador' && !participation.aprobacion_completada) return 'pendiente_de_aprobacion';
  if (role === 'revisor') return 'pendiente_de_revision';
  return null;
}

// ── Structured Query Functions ─────────────────────────────────────────────

export async function getDocumentCreator(workspaceId: string, documentId: string) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from(s.documentsTable)
    .select(`
      ${s.documentIdField},
      ${s.documentTitleField},
      ${s.documentCreatedAtField},
      owner:${s.documentCreatedByField}(${s.userIdField}, ${s.userFullNameField}, ${s.userNombreField}, ${s.userApellidoPaternoField}, ${s.userEmailField})
    `)
    .eq(s.documentIdField, documentId)
    .eq(s.documentWorkspaceField, workspaceId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getDocumentsByStatus(workspaceId: string, status: string) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from(s.documentsTable)
    .select(`
      ${s.documentIdField},
      ${s.documentTitleField},
      ${s.documentStatusField},
      ${s.documentCreatedAtField},
      ${s.documentExpiryField},
      owner:${s.documentCreatedByField}(${s.userFullNameField}, ${s.userNombreField}, ${s.userEmailField})
    `)
    .eq(s.documentWorkspaceField, workspaceId)
    .eq(s.documentStatusField, status)
    .is('deleted_at', null)
    .order(s.documentCreatedAtField, { ascending: false })
    .limit(20);
  if (error) throw error;
  return data || [];
}

export async function getDocumentsPendingSignature(workspaceId: string, userId: string) {
  const supabase = getServiceClient();
  const { data: participations, error: pErr } = await supabase
    .from(s.participationTable)
    .select(`
      ${s.participationDocumentField},
      ${s.participationEmailField},
      ${s.participationNameField},
      ${s.participationTypeField},
      ${s.participationSignedField}
    `)
    .eq(s.participationUserIdField, userId)
    .eq(s.participationSignedField, false)
    .eq(s.participationTypeField, 'firmante');
  if (pErr) throw pErr;
  if (!participations || participations.length === 0) return [];

  const docIds = participations.map((p: any) => p[s.participationDocumentField]);
  const { data: docs, error: dErr } = await supabase
    .from(s.documentsTable)
    .select(`
      ${s.documentIdField},
      ${s.documentTitleField},
      ${s.documentStatusField},
      ${s.documentCreatedAtField},
      ${s.documentExpiryField}
    `)
    .in(s.documentIdField, docIds)
    .eq(s.documentWorkspaceField, workspaceId)
    .is('deleted_at', null)
    .limit(20);
  if (dErr) throw dErr;
  return docs || [];
}

export async function getDocumentsCreatedByUser(workspaceId: string, targetUserName: string) {
  const supabase = getServiceClient();
  const { data: users, error: uErr } = await supabase
    .from(s.usersTable)
    .select(`${s.userIdField}, ${s.userFullNameField}, ${s.userNombreField}, ${s.userEmailField}`)
    .or(`${s.userFullNameField}.ilike.%${targetUserName}%,${s.userNombreField}.ilike.%${targetUserName}%,${s.userEmailField}.ilike.%${targetUserName}%`);
  if (uErr) throw uErr;
  if (!users || users.length === 0) return [];

  const userIds = users.map((u: any) => u[s.userIdField]);
  const { data, error } = await supabase
    .from(s.documentsTable)
    .select(`
      ${s.documentIdField},
      ${s.documentTitleField},
      ${s.documentStatusField},
      ${s.documentCreatedAtField},
      owner:${s.documentCreatedByField}(${s.userFullNameField}, ${s.userNombreField}, ${s.userEmailField})
    `)
    .in(s.documentCreatedByField, userIds)
    .eq(s.documentWorkspaceField, workspaceId)
    .is('deleted_at', null)
    .order(s.documentCreatedAtField, { ascending: false })
    .limit(20);
  if (error) throw error;
  return data || [];
}

export async function getDocumentsExpiringSoon(workspaceId: string, daysAhead = 7) {
  const supabase = getServiceClient();
  const now = new Date();
  const future = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const { data, error } = await supabase
    .from(s.documentsTable)
    .select(`
      ${s.documentIdField},
      ${s.documentTitleField},
      ${s.documentStatusField},
      ${s.documentExpiryField},
      owner:${s.documentCreatedByField}(${s.userFullNameField}, ${s.userNombreField}, ${s.userEmailField})
    `)
    .eq(s.documentWorkspaceField, workspaceId)
    .eq(s.documentHasExpiryField, true)
    .gte(s.documentExpiryField, now.toISOString())
    .lte(s.documentExpiryField, future.toISOString())
    .is('deleted_at', null)
    .order(s.documentExpiryField, { ascending: true })
    .limit(20);
  if (error) throw error;
  return data || [];
}

export async function getDocumentParticipants(workspaceId: string, documentId: string) {
  const supabase = getServiceClient();
  const { data: doc, error: dErr } = await supabase
    .from(s.documentsTable)
    .select(`${s.documentIdField}, ${s.documentTitleField}, ${s.documentParticipantsJsonField}`)
    .eq(s.documentIdField, documentId)
    .eq(s.documentWorkspaceField, workspaceId)
    .maybeSingle();
  if (dErr) throw dErr;
  if (!doc) return null;

  const { data: responses, error: rErr } = await supabase
    .from(s.participationTable)
    .select(`
      ${s.participationEmailField},
      ${s.participationNameField},
      ${s.participationTypeField},
      ${s.participationSignedField},
      ${s.participationSignedAtField},
      ${s.participationApprovedField}
    `)
    .eq(s.participationDocumentField, documentId);
  if (rErr) throw rErr;
  return { document: doc, participations: responses || [] };
}

export async function getDocumentsByExpediente(workspaceId: string, carpetaId: string) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from(s.documentsTable)
    .select(`
      ${s.documentIdField},
      ${s.documentTitleField},
      ${s.documentStatusField},
      ${s.documentCreatedAtField},
      owner:${s.documentCreatedByField}(${s.userFullNameField}, ${s.userNombreField}, ${s.userEmailField})
    `)
    .eq(s.documentWorkspaceField, workspaceId)
    .eq(s.documentFolderField, carpetaId)
    .is('deleted_at', null)
    .order(s.documentCreatedAtField, { ascending: false })
    .limit(30);
  if (error) throw error;
  return data || [];
}

export async function searchDocumentMetadata(
  workspaceId: string,
  filters: { query?: string; status?: string; ownerId?: string; carpetaId?: string }
) {
  const supabase = getServiceClient();
  let q = supabase
    .from(s.documentsTable)
    .select(`
      ${s.documentIdField},
      ${s.documentTitleField},
      ${s.documentStatusField},
      ${s.documentCreatedAtField},
      ${s.documentExpiryField},
      ${s.documentDescriptionField},
      owner:${s.documentCreatedByField}(${s.userFullNameField}, ${s.userNombreField}, ${s.userEmailField})
    `)
    .eq(s.documentWorkspaceField, workspaceId)
    .is('deleted_at', null);

  if (filters.query) {
    q = q.or(
      `${s.documentTitleField}.ilike.%${filters.query}%,${s.documentDescriptionField}.ilike.%${filters.query}%`
    );
  }
  if (filters.status) q = q.eq(s.documentStatusField, filters.status);
  if (filters.ownerId) q = q.eq(s.documentCreatedByField, filters.ownerId);
  if (filters.carpetaId) q = q.eq(s.documentFolderField, filters.carpetaId);

  const { data, error } = await q.order(s.documentCreatedAtField, { ascending: false }).limit(20);
  if (error) throw error;
  return data || [];
}

export async function getDocumentActivityHistory(workspaceId: string, documentId?: string) {
  const supabase = getServiceClient();
  let query = supabase
    .from(s.activityLogTable)
    .select(`
      id,
      ${s.activityDocumentField},
      ${s.activityActorIdField},
      ${s.activityActorNameField},
      ${s.activityActorEmailField},
      ${s.activityActionField},
      ${s.activityCategoryField},
      ${s.activityDetailsField},
      ${s.activityCreatedAtField},
      documento:${s.activityDocumentField}(
        id,
        ${s.documentTitleField},
        ${s.documentWorkspaceField}
      )
    `)
    .order(s.activityCreatedAtField, { ascending: false })
    .limit(20);

  if (documentId) {
    query = query.eq(s.activityDocumentField, documentId);
  }

  const { data, error } = await query;
  if (error) throw error;
  if (!data || data.length === 0) return [];

  const filtered = documentId
    ? data
    : data.filter((row: any) => row.documento?.workspace_id === workspaceId);
  return filtered;
}

/** Get notifications for a user */
export async function getUserNotifications(userId: string) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from(s.notificationsTable)
    .select(`
      ${s.notificationIdField},
      ${s.notificationTypeField},
      ${s.notificationTitleField},
      ${s.notificationDescriptionField},
      ${s.notificationPriorityField},
      ${s.notificationReadField},
      ${s.notificationCreatedAtField}
    `)
    .eq(s.notificationUserIdField, userId)
    .order(s.notificationCreatedAtField, { ascending: false })
    .limit(30);
  if (error) throw error;
  return data || [];
}

/** Get contacts for a user */
export async function getUserContacts(userId: string) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from(s.contactsTable)
    .select(`
      ${s.contactIdField},
      ${s.contactNombreField},
      ${s.contactApellidoPaternoField},
      ${s.contactEmailField},
      ${s.contactTelefonoField},
      ${s.contactRfcField},
      ${s.contactCreatedAtField}
    `)
    .eq(s.contactUserIdField, userId)
    .order(s.contactCreatedAtField, { ascending: false })
    .limit(50);
  if (error) throw error;
  return data || [];
}

/** Get plantillas for a workspace */
export async function getWorkspacePlantillas(workspaceId: string) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from(s.plantillasTable)
    .select(`
      ${s.plantillaIdField},
      ${s.plantillaNameField},
      ${s.plantillaDescriptionField},
      ${s.plantillaCategoryField},
      ${s.plantillaStatusField},
      ${s.plantillaFieldsField},
      ${s.plantillaCreatedAtField}
    `)
    .eq(s.plantillaWorkspaceField, workspaceId)
    .order(s.plantillaCreatedAtField, { ascending: false })
    .limit(20);
  if (error) throw error;
  return data || [];
}

/** Get form templates for a workspace */
export async function getWorkspaceFormTemplates(workspaceId: string) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from(s.formTemplatesTable)
    .select(`
      ${s.formTemplateIdField},
      ${s.formTemplateNameField},
      ${s.formTemplateDescriptionField},
      ${s.formTemplateStatusField},
      ${s.formTemplateCreatedAtField}
    `)
    .eq(s.formTemplateWorkspaceField, workspaceId)
    .order(s.formTemplateCreatedAtField, { ascending: false })
    .limit(20);
  if (error) throw error;
  return data || [];
}

/**
 * Generates an OpenAI embedding vector for a given text.
 */
async function generateQueryEmbedding(text: string): Promise<number[] | null> {
  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text.slice(0, 8000),
      }),
    });
    if (!response.ok) {
      const err = await response.text();
      console.error('[generateQueryEmbedding] OpenAI error:', err);
      return null;
    }
    const json = await response.json();
    return json?.data?.[0]?.embedding ?? null;
  } catch (e) {
    console.error('[generateQueryEmbedding] fetch error:', e);
    return null;
  }
}

export async function searchDocumentContent(
  workspaceId: string,
  question: string,
  documentId?: string
): Promise<any[]> {
  const supabase = getServiceClient();

  const embedding = await generateQueryEmbedding(question);

  if (embedding) {
    const { data: vectorResults, error: rpcError } = await supabase.rpc(
      'match_document_chunks',
      {
        query_embedding: embedding,
        p_workspace_id: workspaceId,
        p_document_id: documentId ?? null,
        match_threshold: 0.65,
        match_count: 8,
      }
    );

    if (!rpcError && vectorResults && vectorResults.length > 0) {
      console.log(`[searchDocumentContent] Vector search returned ${vectorResults.length} chunks`);
      return vectorResults;
    }

    if (rpcError) {
      console.error('[searchDocumentContent] RPC error:', rpcError);
    } else {
      console.log('[searchDocumentContent] Vector search returned 0 results, falling back to keyword search');
    }
  }

  try {
    let q = supabase
      .from(s.chunksTable)
      .select(`
        ${s.chunkDocumentField},
        ${s.chunkContentField},
        ${s.chunkPageField},
        ${s.chunkIndexField},
        ${s.chunkWorkspaceField}
      `)
      .eq(s.chunkWorkspaceField, workspaceId);

    if (documentId) q = q.eq(s.chunkDocumentField, documentId);

    const keywords = question
      .toLowerCase()
      .replace(/[^a-záéíóúüñ\s]/gi, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3)
      .slice(0, 5)
      .join(' & ');

    if (keywords) {
      const { data: ftData, error: ftError } = await q
        .textSearch(s.chunkContentField, keywords, { type: 'plain' })
        .limit(8);

      if (!ftError && ftData && ftData.length > 0) {
        console.log(`[searchDocumentContent] Full-text search returned ${ftData.length} chunks`);
        return ftData;
      }
    }

    const { data: likeData } = await supabase
      .from(s.chunksTable)
      .select(`${s.chunkDocumentField}, ${s.chunkContentField}, ${s.chunkPageField}, ${s.chunkIndexField}`)
      .eq(s.chunkWorkspaceField, workspaceId)
      .ilike(s.chunkContentField, `%${question.slice(0, 40)}%`)
      .limit(8);

    return likeData || [];
  } catch (fallbackErr) {
    console.error('[searchDocumentContent] Fallback error:', fallbackErr);
    return [];
  }
}

export async function isDocumentEmbedded(workspaceId: string, documentId: string): Promise<boolean> {
  const supabase = getServiceClient();
  const { count } = await supabase
    .from(s.chunksTable)
    .select('id', { count: 'exact', head: true })
    .eq(s.chunkDocumentField, documentId)
    .eq(s.chunkWorkspaceField, workspaceId);
  return (count ?? 0) > 0;
}

/**
 * Builds structured context for a given intent.
 */
export async function buildStructuredContext(
  question: string,
  intent: string,
  userId: string,
  workspaceId: string,
  opts: {
    documentId?: string;
    expedienteId?: string;
    extractedStatus?: string;
    extractedUserName?: string;
    mode?: string;
  } = {}
): Promise<any> {
  const { documentId, expedienteId, extractedStatus, extractedUserName, mode } = opts;

  // For user-centric intents, structured context comes from buildUserContext
  const USER_CONTEXT_INTENTS = new Set([
    'user_profile',
    'user_profile_sensitive',
    'user_usage',
    'billing_status',
    'user_created_documents',
    'user_assigned_documents',
    'user_participations',
    'document_types_assigned',
    'pending_tasks',
    'notifications_search',
    'contacts_search',
    'templates_help',
    'forms_help',
    'configuration_security',
    'reports_analysis',
  ]);

  if (USER_CONTEXT_INTENTS.has(intent)) {
    return null;
  }

  if (mode === 'rag') {
    return null;
  }

  try {
    switch (intent) {
      case 'activity_history': {
        return await getDocumentActivityHistory(workspaceId, documentId);
      }
      case 'metadata_search': {
        if (documentId) {
          return await getDocumentCreator(workspaceId, documentId);
        } else if (extractedUserName) {
          return await getDocumentsCreatedByUser(workspaceId, extractedUserName);
        } else {
          return await searchDocumentMetadata(workspaceId, { query: question.slice(0, 80) });
        }
      }
      case 'document_status_search': {
        if (extractedStatus === 'vencido') {
          return await getDocumentsExpiringSoon(workspaceId, 0);
        } else if (extractedStatus) {
          return await getDocumentsByStatus(workspaceId, extractedStatus);
        } else {
          return await searchDocumentMetadata(workspaceId, { query: question.slice(0, 80) });
        }
      }
      case 'signature_status': {
        if (documentId) {
          return await getDocumentParticipants(workspaceId, documentId);
        } else {
          return await getDocumentsPendingSignature(workspaceId, userId);
        }
      }
      case 'expediente_search': {
        if (expedienteId) {
          return await getDocumentsByExpediente(workspaceId, expedienteId);
        } else {
          return await searchDocumentMetadata(workspaceId, { query: question.slice(0, 80) });
        }
      }
      case 'signing_help': case 'external_participant_help': case 'general_help': case 'configuration_security': case 'reports_analysis': {
        // These are help/info intents — no structured DB query needed
        return null;
      }
      default: {
        if (documentId) {
          return await getDocumentCreator(workspaceId, documentId);
        } else {
          return await searchDocumentMetadata(workspaceId, { query: question.slice(0, 80) });
        }
      }
    }
  } catch (err) {
    console.error('[buildStructuredContext] error:', err);
    return null;
  }
}

/**
 * Builds RAG context (document chunks) for a given question.
 */
export async function buildRagContext(
  question: string,
  workspaceId: string,
  documentId?: string
): Promise<any[]> {
  try {
    const chunks = await searchDocumentContent(workspaceId, question, documentId);
    console.log(`[buildRagContext] Retrieved ${chunks.length} chunks (documentId: ${documentId ?? 'all'})`);
    return chunks;
  } catch (err) {
    console.error('[buildRagContext] error:', err);
    return [];
  }
}

/** Build authorized AI context string from query results */
export function buildAuthorizedAIContext(results: {
  structuredData?: any;
  ragChunks?: any[];
  intent: string;
  userContext?: any;
}): string {
  const parts: string[] = [];

  if (results.intent === 'user_profile' && results.userContext) {
    const uc = results.userContext;
    const profile = uc.userProfile ?? {};
    const workspace = uc.workspace ?? {};
    const sub = uc.usage?.subscription ?? null;
    const name = profile.full_name || [profile.nombre, profile.apellido_paterno].filter(Boolean).join(' ') || profile.email || 'Desconocido';
    const planName = sub?.plan?.name ?? 'Sin plan activo';
    const planSlug = sub?.plan?.slug ?? '';
    parts.push(`## Perfil del usuario
- Nombre: ${name}
- Email: ${profile.email ?? 'N/D'}
- RFC: ${profile.rfc ?? 'N/D'}
- CURP: ${profile.curp ?? 'N/D'}
- Teléfono: ${profile.telefono ?? 'N/D'}
- Tipo de cuenta: ${profile.account_type ?? 'personal'}
- Miembro desde: ${profile.created_at ? new Date(profile.created_at).toLocaleDateString('es-MX') : 'N/D'}
- Workspace activo: ${workspace.name ?? 'N/D'}
- Rol en workspace: ${workspace.userRole ?? 'N/D'}
- Plan activo: ${planName}${planSlug ? ` (${planSlug})` : ''}`);
    return parts.join('\n\n');
  }

  if (results.intent === 'user_profile_sensitive' && results.userContext) {
    const profile = results.userContext.userProfile ?? {};
    const name = profile.full_name || [profile.nombre, profile.apellido_paterno].filter(Boolean).join(' ') || profile.email || 'Desconocido';
    const domicilio = [
      profile.calle ? `${profile.calle} ${profile.num_exterior ?? ''}${profile.num_interior ? ' Int. ' + profile.num_interior : ''}`.trim() : null,
      profile.colonia,
      profile.municipio,
      profile.estado,
      profile.codigo_postal ? `C.P. ${profile.codigo_postal}` : null,
    ].filter(Boolean).join(', ');
    parts.push(`## Datos personales y fiscales del usuario
- Nombre: ${name}
- Email: ${profile.email ?? 'N/D'}
- RFC: ${profile.rfc ?? 'N/D'}
- CURP: ${profile.curp ?? 'N/D'}
- Teléfono: ${profile.telefono ?? 'N/D'}
- Régimen fiscal: ${profile.regimen_fiscal ?? 'N/D'}
- Domicilio fiscal: ${domicilio || 'N/D'}`);
    return parts.join('\n\n');
  }

  if (results.intent === 'user_usage' && results.userContext) {
    const uc = results.userContext;
    const usage = uc.usage ?? {};
    const sub = usage.subscription ?? null;
    const workspace = uc.workspace ?? {};
    parts.push(`## Consumo del usuario en workspace "${workspace.name ?? 'N/D'}"
- Documentos creados este mes: ${usage.documentsCreatedThisMonth ?? 0}
- Documentos enviados a firma: ${usage.documentsSentToSignature ?? 0}
- Documentos completados/firmados: ${usage.documentsCompleted ?? 0}
- Documentos en borrador: ${usage.documentsPending ?? 0}
- Límite del plan: ${sub?.documents_limit ?? sub?.plan?.documents_included ?? 'N/D'} documentos
- Documentos usados (total): ${sub?.documents_used ?? 'N/D'}
- Plan activo: ${sub?.plan?.name ?? 'Sin plan activo'}
- Estado de suscripción: ${sub?.status ?? 'N/D'}
- Período actual: ${sub?.current_period_start ? new Date(sub.current_period_start).toLocaleDateString('es-MX') : 'N/D'} — ${sub?.current_period_end ? new Date(sub.current_period_end).toLocaleDateString('es-MX') : 'N/D'}`);
    return parts.join('\n\n');
  }

  if (results.intent === 'billing_status' && results.userContext) {
    const uc = results.userContext;
    const usage = uc.usage ?? {};
    const sub = usage.subscription ?? null;
    const workspace = uc.workspace ?? {};
    parts.push(`## Facturación y suscripción en workspace "${workspace.name ?? 'N/D'}"
- Plan activo: ${sub?.plan?.name ?? 'Sin plan activo'}
- Estado: ${sub?.status ?? 'N/D'}
- Documentos usados: ${sub?.documents_used ?? 'N/D'} / ${sub?.documents_limit ?? sub?.plan?.documents_included ?? 'N/D'}
- Documentos creados este mes: ${usage.documentsCreatedThisMonth ?? 0}
- Período: ${sub?.current_period_start ? new Date(sub.current_period_start).toLocaleDateString('es-MX') : 'N/D'} — ${sub?.current_period_end ? new Date(sub.current_period_end).toLocaleDateString('es-MX') : 'N/D'}`);
    return parts.join('\n\n');
  }

  if (results.intent === 'user_created_documents' && results.userContext) {
    const docs: any[] = results.userContext.createdDocuments ?? [];
    const workspace = results.userContext.workspace ?? {};
    if (docs.length === 0) {
      return `## Documentos creados por el usuario\n\nNo encontré documentos creados por ti en el workspace "${workspace.name ?? 'N/D'}".`;
    }
    const lines = docs.map((d: any, i: number) => {
      const tipo = d.tipo?.nombre ?? d.grupo?.nombre ?? 'Sin tipo';
      const carpeta = d.carpeta?.nombre ? ` | Carpeta: ${d.carpeta.nombre}` : '';
      const fecha = d.created_at ? new Date(d.created_at).toLocaleDateString('es-MX') : 'N/D';
      return `${i + 1}. **${d.nombre ?? 'Sin título'}** — Estado: ${d.estado ?? 'N/D'} | Tipo: ${tipo} | Creado: ${fecha}${carpeta}`;
    });
    parts.push(`## Documentos creados por el usuario en workspace "${workspace.name ?? 'N/D'}" (${docs.length} documentos)\n\n${lines.join('\n')}`);
    return parts.join('\n\n');
  }

  if (results.intent === 'user_assigned_documents' && results.userContext) {
    const docs: any[] = results.userContext.assignedDocuments ?? [];
    const workspace = results.userContext.workspace ?? {};
    if (docs.length === 0) {
      return `## Documentos asignados al usuario\n\nNo encontré documentos asignados a ti en el workspace "${workspace.name ?? 'N/D'}".`;
    }
    const lines = docs.map((d: any, i: number) => {
      const tipo = d.tipo?.nombre ?? d.grupo?.nombre ?? 'Sin tipo';
      const rol = d.participationRole ?? 'participante';
      const pendingAction = d.pendingAction ? ` | Acción: ${d.pendingAction.replace(/_/g, ' ')}` : '';
      const urgente = d.es_urgente ? ' 🔴 URGENTE' : '';
      return `${i + 1}. **${d.nombre ?? 'Sin título'}** — Rol: ${rol} | Estado: ${d.estado ?? 'N/D'} | Tipo: ${tipo}${pendingAction}${urgente}`;
    });
    parts.push(`## Documentos asignados al usuario en workspace "${workspace.name ?? 'N/D'}" (${docs.length} documentos)\n\n${lines.join('\n')}`);
    return parts.join('\n\n');
  }

  if (results.intent === 'user_participations' && results.userContext) {
    const assignedDocs: any[] = results.userContext.assignedDocuments ?? [];
    const workspace = results.userContext.workspace ?? {};
    if (assignedDocs.length === 0) {
      return `## Participaciones del usuario\n\nNo encontré participaciones activas en el workspace "${workspace.name ?? 'N/D'}".`;
    }
    const byRole: Record<string, any[]> = {};
    for (const doc of assignedDocs) {
      const role = doc.participationRole ?? 'otro';
      if (!byRole[role]) byRole[role] = [];
      byRole[role].push(doc);
    }
    const roleLines: string[] = [];
    for (const [role, docs] of Object.entries(byRole)) {
      const signed = docs.filter((d: any) => d.firmada || d.aprobada).length;
      const pending = docs.length - signed;
      roleLines.push(`- Como **${role}**: ${docs.length} documento(s) — ${signed} completado(s), ${pending} pendiente(s)`);
    }
    const pendingSign = assignedDocs.filter((d: any) => d.participationRole === 'firmante' && !d.firmada);
    const pendingApprove = assignedDocs.filter((d: any) => d.participationRole === 'aprobador' && !d.aprobada);
    parts.push(`## Participaciones del usuario en workspace "${workspace.name ?? 'N/D'}"\n\n${roleLines.join('\n')}`);
    if (pendingSign.length > 0) {
      const signLines = pendingSign.map((d: any, i: number) => `  ${i + 1}. ${d.nombre ?? 'Sin título'} — Estado: ${d.estado ?? 'N/D'}`).join('\n');
      parts.push(`### Documentos pendientes de tu firma:\n${signLines}`);
    }
    if (pendingApprove.length > 0) {
      const approveLines = pendingApprove.map((d: any, i: number) => `  ${i + 1}. ${d.nombre ?? 'Sin título'}`).join('\n');
      parts.push(`### Documentos pendientes de tu aprobación:\n${approveLines}`);
    }
    return parts.join('\n\n');
  }

  if (results.intent === 'document_types_assigned' && results.userContext) {
    const types = results.userContext.documentTypesAssigned ?? { types: [], groups: [] };
    const workspace = results.userContext.workspace ?? {};
    if (types.types.length === 0 && types.groups.length === 0) {
      return `## Tipos de documentos asignados\n\nNo encontré tipos de documentos específicos asignados en el workspace "${workspace.name ?? 'N/D'}".`;
    }
    const typeList = types.types.length > 0 ? `Tipos específicos: ${types.types.join(', ')}` : '';
    const groupList = types.groups.length > 0 ? `Grupos/categorías: ${types.groups.join(', ')}` : '';
    parts.push(`## Tipos de documentos asignados en workspace "${workspace.name ?? 'N/D'}"\n\n${[typeList, groupList].filter(Boolean).join('\n')}`);
    return parts.join('\n\n');
  }

  if (results.intent === 'pending_tasks' && results.userContext) {
    const pending = results.userContext.pendingActions ?? {};
    const workspace = results.userContext.workspace ?? {};
    const totalPending =
      (pending.pendingSignatures?.length ?? 0) +
      (pending.pendingApprovals?.length ?? 0) +
      (pending.pendingReview?.length ?? 0);
    if (totalPending === 0 && (pending.expiringSoon?.length ?? 0) === 0 && (pending.overdue?.length ?? 0) === 0) {
      return `## Tareas pendientes\n\nNo tienes tareas pendientes en el workspace "${workspace.name ?? 'N/D'}". ¡Todo al día!`;
    }
    const sections: string[] = [];
    if (pending.overdue?.length > 0) {
      const lines = pending.overdue.map((d: any, i: number) =>
        `  ${i + 1}. **${d.title ?? 'Sin título'}** — Venció: ${d.expiry ? new Date(d.expiry).toLocaleDateString('es-MX') : 'N/D'}`
      ).join('\n');
      sections.push(`### 🔴 Documentos vencidos (${pending.overdue.length}):\n${lines}`);
    }
    if (pending.pendingSignatures?.length > 0) {
      const lines = pending.pendingSignatures.map((d: any, i: number) =>
        `  ${i + 1}. **${d.title ?? 'Sin título'}** — Estado: ${d.status ?? 'N/D'}${d.urgent ? ' 🔴 URGENTE' : ''}`
      ).join('\n');
      sections.push(`### ✍️ Pendientes de tu firma (${pending.pendingSignatures.length}):\n${lines}`);
    }
    if (pending.pendingApprovals?.length > 0) {
      const lines = pending.pendingApprovals.map((d: any, i: number) =>
        `  ${i + 1}. **${d.title ?? 'Sin título'}**`
      ).join('\n');
      sections.push(`### ✅ Pendientes de tu aprobación (${pending.pendingApprovals.length}):\n${lines}`);
    }
    if (pending.pendingReview?.length > 0) {
      const lines = pending.pendingReview.map((d: any, i: number) =>
        `  ${i + 1}. **${d.title ?? 'Sin título'}**`
      ).join('\n');
      sections.push(`### 👁️ Pendientes de tu revisión (${pending.pendingReview.length}):\n${lines}`);
    }
    if (pending.expiringSoon?.length > 0) {
      const lines = pending.expiringSoon.map((d: any, i: number) =>
        `  ${i + 1}. **${d.title ?? 'Sin título'}** — Vence: ${d.expiry ? new Date(d.expiry).toLocaleDateString('es-MX') : 'N/D'}`
      ).join('\n');
      sections.push(`### ⚠️ Próximos a vencer (${pending.expiringSoon.length}):\n${lines}`);
    }
    parts.push(`## Tareas pendientes en workspace "${workspace.name ?? 'N/D'}"\n\n${sections.join('\n\n')}`);
    return parts.join('\n\n');
  }

  if (results.intent === 'notifications_search' && results.userContext) {
    const notifs: any[] = results.userContext.notifications ?? [];
    const unread = results.userContext.unreadNotificationsCount ?? 0;
    if (notifs.length === 0) {
      return `## Notificaciones\n\nNo encontré notificaciones registradas.`;
    }
    const lines = notifs.slice(0, 10).map((n: any, i: number) => {
      const fecha = n.created_at ? new Date(n.created_at).toLocaleDateString('es-MX') : 'N/D';
      const leida = n.read ? '✓' : '🔵 Sin leer';
      return `${i + 1}. [${leida}] **${n.title}** — ${n.description ?? ''} (${fecha})`;
    });
    parts.push(`## Notificaciones (${unread} sin leer de ${notifs.length} total)\n\n${lines.join('\n')}`);
    return parts.join('\n\n');
  }

  if (results.intent === 'contacts_search' && results.userContext) {
    const contacts: any[] = results.userContext.contacts ?? [];
    if (contacts.length === 0) {
      return `## Contactos\n\nNo encontré contactos registrados.`;
    }
    const lines = contacts.slice(0, 15).map((c: any, i: number) => {
      const nombre = [c.nombre, c.apellido_paterno].filter(Boolean).join(' ');
      return `${i + 1}. **${nombre}** — ${c.email ?? 'Sin email'}${c.telefono ? ` | Tel: ${c.telefono}` : ''}`;
    });
    parts.push(`## Contactos (${contacts.length} registrados)\n\n${lines.join('\n')}`);
    return parts.join('\n\n');
  }

  if (results.intent === 'templates_help' && results.userContext) {
    const plantillas: any[] = results.userContext.plantillas ?? [];
    if (plantillas.length === 0) {
      return `## Plantillas\n\nNo encontré plantillas en este workspace.`;
    }
    const lines = plantillas.map((p: any, i: number) =>
      `${i + 1}. **${p.name}** — Categoría: ${p.category ?? 'N/D'} | Estado: ${p.status ?? 'N/D'}`
    );
    parts.push(`## Plantillas disponibles (${plantillas.length})\n\n${lines.join('\n')}`);
    return parts.join('\n\n');
  }

  if (results.intent === 'forms_help' && results.userContext) {
    const forms: any[] = results.userContext.formTemplates ?? [];
    if (forms.length === 0) {
      return `## Formularios\n\nNo encontré formularios en este workspace.`;
    }
    const lines = forms.map((f: any, i: number) =>
      `${i + 1}. **${f.name}** — Estado: ${f.status ?? 'N/D'}`
    );
    parts.push(`## Formularios disponibles (${forms.length})\n\n${lines.join('\n')}`);
    return parts.join('\n\n');
  }

  if (results.intent === 'activity_history') {
    const records = Array.isArray(results.structuredData) ? results.structuredData : [];
    if (records.length === 0) {
      return '## Historial de actividad\n\nNo se encontraron registros de historial para este documento o workspace con los permisos actuales.';
    }
    const lines = records.map((r: any, i: number) => {
      const fecha = r.created_at
        ? new Date(r.created_at).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })
        : 'Fecha desconocida';
      const actor = r.actor_nombre || r.actor_email || 'Usuario desconocido';
      const accion = r.action || 'acción desconocida';
      const docTitle = r.documento?.nombre ? ` en "${r.documento.nombre}"` : '';
      const details = r.details ? ` — ${JSON.stringify(r.details)}` : '';
      return `${i + 1}. [${fecha}] ${actor} — ${accion}${docTitle}${details}`;
    });
    parts.push(`## Historial de actividad\n\n${lines.join('\n')}`);
    return parts.join('\n\n');
  }

  if (results.intent === 'configuration_security' && results.userContext) {
    const uc = results.userContext;
    const workspace = uc.workspace ?? {};
    const parts: string[] = [];
    parts.push(`## Configuración del workspace "${workspace.name ?? 'N/D'}"
- Nombre del workspace: ${workspace.name ?? 'N/D'}
- Tipo: ${workspace.workspace_type ?? 'N/D'}
- Tu rol: ${workspace.userRole ?? 'N/D'}
- Eres propietario: ${workspace.isOwner ? 'Sí' : 'No'}
- Miembro desde: ${workspace.joinedAt ? new Date(workspace.joinedAt).toLocaleDateString('es-MX') : 'N/D'}`);
    return parts.join('\n\n');
  }

  if (results.intent === 'reports_analysis' && results.userContext) {
    const uc = results.userContext;
    const usage = uc.usage ?? {};
    const workspace = uc.workspace ?? {};
    const parts: string[] = [];
    parts.push(`## Datos de uso y reportes en workspace "${workspace.name ?? 'N/D'}"
- Documentos creados este mes: ${usage.documentsCreatedThisMonth ?? 0}
- Documentos enviados a firma: ${usage.documentsSentToSignature ?? 0}
- Documentos completados: ${usage.documentsCompleted ?? 0}
- Documentos en borrador: ${usage.documentsPending ?? 0}
- Total documentos creados: ${(uc.createdDocuments ?? []).length}
- Total participaciones: ${(uc.assignedDocuments ?? []).length}`);
    return parts.join('\n\n');
  }

  if (results.structuredData) {
    const json = JSON.stringify(results.structuredData, null, 2);
    parts.push(`## Datos estructurados del workspace\n\`\`\`json\n${json}\n\`\`\``);
  }

  if (results.ragChunks && results.ragChunks.length > 0) {
    const chunks = results.ragChunks
      .map((c: any, i: number) => `[Fragmento ${i + 1} - Página ${c.page_number ?? '?'}]\n${c.content}`)
      .join('\n\n');
    parts.push(`## Contenido documental recuperado\n${chunks}`);
  }

  if (parts.length === 0) {
    return 'No se encontró información relevante en el workspace para esta consulta.';
  }

  return parts.join('\n\n');
}

/** Save AI query log */
export async function saveQueryLog(log: {
  workspaceId: string;
  userId: string;
  sessionId?: string;
  question: string;
  intent: string;
  scope: string;
  documentId?: string;
  contextUsed: any;
  responseText: string;
  tokensUsed?: number;
  durationMs?: number;
}) {
  const supabase = getServiceClient();
  await supabase.from(s.queryLogsTable).insert({
    workspace_id: log.workspaceId,
    user_id: log.userId,
    session_id: log.sessionId || null,
    question: log.question,
    intent: log.intent,
    scope: log.scope,
    document_id: log.documentId || null,
    context_used: log.contextUsed,
    response_text: log.responseText.slice(0, 5000),
    tokens_used: log.tokensUsed || null,
    duration_ms: log.durationMs || null,
  });
}
