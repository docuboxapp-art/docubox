/**
 * dbSchemaMap — maps logical AI query concepts to the real Supabase schema.
 * Update this file if table/column names change in migrations.
 * All table/column names verified against actual migration files.
 */
export const dbSchemaMap = {
  // ── Documents ──────────────────────────────────────────────
  documentsTable: 'documentos',
  documentIdField: 'id',
  documentTitleField: 'nombre',
  documentStatusField: 'estado',
  documentCreatedByField: 'owner_id',
  documentCreatedAtField: 'created_at',
  documentUpdatedAtField: 'updated_at',
  documentExpiryField: 'fecha_vencimiento',
  documentHasExpiryField: 'tiene_vencimiento',
  documentWorkspaceField: 'workspace_id',
  documentFolderField: 'carpeta_id',
  documentDescriptionField: 'descripcion',
  documentFileNameField: 'file_name',
  documentParticipantsJsonField: 'participantes', // jsonb array on documentos
  documentTipoDocumentoField: 'tipo_documento_id',
  documentGrupoTipoField: 'grupo_tipo_documento_id',
  documentEsUrgenteField: 'es_urgente',

  // ── Users / Profiles ───────────────────────────────────────
  usersTable: 'user_profiles',
  userIdField: 'id',
  userFullNameField: 'full_name',
  userNombreField: 'nombre',
  userApellidoPaternoField: 'apellido_paterno',
  userApellidoMaternoField: 'apellido_materno',
  userEmailField: 'email',
  userAvatarField: 'avatar_url',
  userCreatedAtField: 'created_at',
  userPhoneField: 'telefono',
  userAccountTypeField: 'account_type',
  userRfcField: 'rfc',
  userCurpField: 'curp',
  // Fiscal / address fields (from profile_extended_fields migration)
  userRegimenFiscalField: 'regimen_fiscal',
  userCodigoPostalField: 'codigo_postal',
  userEstadoField: 'estado',
  userMunicipioField: 'municipio',
  userColoniaField: 'colonia',
  userCalleField: 'calle',
  userNumExteriorField: 'num_exterior',
  userNumInteriorField: 'num_interior',

  // ── Workspaces ─────────────────────────────────────────────
  workspacesTable: 'workspaces',
  workspaceIdField: 'id',
  workspaceNameField: 'name',
  workspaceTypeField: 'workspace_type',
  workspaceOwnerField: 'owner_id',
  workspaceCreatedAtField: 'created_at',

  // ── Workspace Members ──────────────────────────────────────
  workspaceMembersTable: 'workspace_members',
  memberWorkspaceField: 'workspace_id',
  memberUserField: 'user_id',
  memberRoleField: 'role',
  memberJoinedAtField: 'joined_at',

  // ── Subscriptions ──────────────────────────────────────────
  subscriptionsTable: 'subscriptions',
  subscriptionUserField: 'user_id',
  subscriptionWorkspaceField: 'workspace_id',
  subscriptionPlanField: 'plan_id',
  subscriptionStatusField: 'status',
  subscriptionDocsUsedField: 'documents_used',
  subscriptionDocsLimitField: 'documents_limit',
  subscriptionPeriodStartField: 'current_period_start',
  subscriptionPeriodEndField: 'current_period_end',

  // ── Subscription Plans ─────────────────────────────────────
  subscriptionPlansTable: 'subscription_plans',
  planIdField: 'id',
  planNameField: 'name',
  planSlugField: 'slug',
  planFeaturesField: 'features',
  planDocsIncludedField: 'documents_included',

  // ── Document Types ─────────────────────────────────────────
  tipoDocumentoTable: 'tipo_documento',
  tipoDocumentoIdField: 'id',
  tipoDocumentoNameField: 'nombre',
  grupoTipoDocumentoTable: 'grupo_tipo_documento',
  grupoTipoIdField: 'id',
  grupoTipoNameField: 'nombre',

  // ── Participation Responses (signatures / approvals) ───────
  participationTable: 'participation_responses',
  participationDocumentField: 'documento_id',
  participationEmailField: 'participante_email',
  participationNameField: 'participante_nombre',
  participationUserIdField: 'participante_id',
  participationTypeField: 'tipo_participacion',
  participationSignedField: 'firma_completada',
  participationSignedAtField: 'firma_completada_at',
  participationApprovedField: 'aprobacion_completada',
  participationApprovedAtField: 'aprobacion_completada_at',
  participationObservacionesField: 'observaciones',
  participationCreatedAtField: 'created_at',

  // ── Folders / Carpetas ─────────────────────────────────────
  carpetasTable: 'carpetas',
  carpetaIdField: 'id',
  carpetaNameField: 'nombre',

  // ── Activity Log ───────────────────────────────────────────
  activityLogTable: 'document_activity_log',
  activityDocumentField: 'documento_id',
  activityActorIdField: 'actor_id',
  activityActorNameField: 'actor_nombre',
  activityActorEmailField: 'actor_email',
  activityActionField: 'action',
  activityCategoryField: 'category',
  activityDetailsField: 'details',
  activityCreatedAtField: 'created_at',

  // ── Contacts ───────────────────────────────────────────────
  contactsTable: 'contacts',
  contactIdField: 'id',
  contactUserIdField: 'user_id',
  contactNombreField: 'nombre',
  contactApellidoPaternoField: 'apellido_paterno',
  contactEmailField: 'email',
  contactTelefonoField: 'telefono',
  contactRfcField: 'rfc',
  contactCurpField: 'curp',
  contactNotasField: 'notas',
  contactCreatedAtField: 'created_at',

  // ── Notifications ──────────────────────────────────────────
  notificationsTable: 'notifications',
  notificationIdField: 'id',
  notificationUserIdField: 'user_id',
  notificationTypeField: 'type',
  notificationTitleField: 'title',
  notificationDescriptionField: 'description',
  notificationPriorityField: 'priority',
  notificationReadField: 'read',
  notificationCreatedAtField: 'created_at',

  // ── Plantillas (Templates) ─────────────────────────────────
  plantillasTable: 'plantillas',
  plantillaIdField: 'id',
  plantillaWorkspaceField: 'workspace_id',
  plantillaCreatedByField: 'created_by',
  plantillaNameField: 'name',
  plantillaDescriptionField: 'description',
  plantillaCategoryField: 'category',
  plantillaStatusField: 'status',
  plantillaFieldsField: 'fields',
  plantillaCreatedAtField: 'created_at',

  // ── Form Templates ─────────────────────────────────────────
  formTemplatesTable: 'form_templates',
  formTemplateIdField: 'id',
  formTemplateWorkspaceField: 'workspace_id',
  formTemplateCreatedByField: 'created_by',
  formTemplateNameField: 'name',
  formTemplateDescriptionField: 'description',
  formTemplateStatusField: 'status',
  formTemplateCreatedAtField: 'created_at',

  // ── AI Chunks (RAG) ────────────────────────────────────────
  chunksTable: 'ai_document_chunks',
  chunkDocumentField: 'document_id',
  chunkWorkspaceField: 'workspace_id',
  chunkContentField: 'content',
  chunkEmbeddingField: 'embedding',
  chunkIndexField: 'chunk_index',
  chunkPageField: 'page_number',

  // ── AI Query Logs ──────────────────────────────────────────
  queryLogsTable: 'ai_query_logs',
} as const;

export type DbSchemaMap = typeof dbSchemaMap;
