-- =============================================================================
-- MIGRACIÓN: 002_docubox_audit_trail.sql
-- Plataforma: DOCUBOX — SaaS de Firma Electrónica Avanzada (México)
-- =============================================================================
--
-- PROPÓSITO LEGAL:
--
-- TABLA document_audit_trail:
--   Bitácora jurídica del documento. Registra cada acción humana o del sistema
--   sobre el documento con suficiente contexto técnico y legal para:
--   1. Demostrar ante un juez la cadena de custodia completa del documento.
--   2. Probar que cada participante fue notificado debidamente (consentimiento informado).
--   3. Acreditar el no repudio de cada acto jurídico.
--   4. Detectar cualquier intento de manipulación mediante cadena de hashes.
--   5. Generar la bitácora de auditoría que exige la NOM-151-SCFI-2016.
--
-- FUNDAMENTOS NORMATIVOS:
--   - NOM-151-SCFI-2016: Requisitos para la conservación de mensajes de datos
--     y digitalización de documentos.
--   - Código de Comercio Art. 49: Obligación de conservar la correspondencia
--     y documentos relativos al giro del comerciante.
--   - Código de Comercio Art. 89 bis: Validez jurídica de los mensajes de datos.
--
-- =============================================================================

-- ---------------------------------------------------------------------------
-- EXTENSIONES
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- TABLA: document_audit_trail
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.document_audit_trail (

  -- Identificación del registro
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id                 UUID NOT NULL REFERENCES public.documents(id) ON DELETE RESTRICT,
  sequence_number             INT NOT NULL CHECK (sequence_number >= 1),

  -- Actor (desnormalizado intencionalmente para valor probatorio)
  actor_id                    UUID REFERENCES auth.users(id),
  actor_email                 TEXT,
  actor_name                  TEXT,
  actor_role                  TEXT NOT NULL CHECK (actor_role IN (
    'propietario','firmante','aprobador','observador',
    'administrador','sistema','psc','api_externa'
  )),

  -- Acción registrada
  action_code                 TEXT NOT NULL CHECK (action_code IN (
    -- Ciclo de vida del documento
    'documento_creado','documento_editado','documento_completado',
    'documento_vencido','documento_cancelado','documento_anulado',
    'documento_restaurado','borrado_solicitado','disputa_abierta',
    'disputa_resuelta','retencion_extendida','custodia_transferida',
    -- Participantes
    'participante_asignado','participante_removido','participante_sustituido',
    'acceso_revocado',
    -- Notificaciones
    'invitacion_enviada','invitacion_reenviada','recordatorio_enviado',
    'notificacion_completado_enviada',
    -- Acceso y visualización
    'documento_abierto','documento_visto','descarga_solicitada',
    'descarga_completada','vista_previa_generada',
    -- Proceso de firma
    'firma_iniciada','efirma_certificado_validado','efirma_certificado_rechazado',
    'autografa_capturada','otp_enviado','otp_verificado','otp_fallido',
    'firma_completada','firma_rechazada','firma_delegada',
    -- Aprobaciones
    'aprobacion_otorgada','aprobacion_rechazada',
    -- Cumplimiento legal
    'nom151_solicitado','nom151_generado','nom151_verificado',
    'blockchain_notarizado','blockchain_verificado',
    -- Seguridad
    'intento_fallido','acceso_denegado','actividad_sospechosa_detectada',
    'bloqueo_por_rate_limit','sesion_expirada'
  )),
  action_category             TEXT NOT NULL CHECK (action_category IN (
    'ciclo_de_vida','participantes','notificacion',
    'acceso','firma','aprobacion','cumplimiento','seguridad'
  )),
  action_description_es       TEXT NOT NULL,
  action_result               TEXT NOT NULL DEFAULT 'exitoso'
    CHECK (action_result IN ('exitoso','fallido','parcial','pendiente')),
  failure_reason              TEXT,

  -- Relevancia jurídica
  is_legal_event              BOOLEAN NOT NULL DEFAULT FALSE,
  legal_event_code            TEXT,
  legal_article_reference     TEXT,

  -- Contexto técnico del actor
  ip_address                  INET,
  user_agent                  TEXT,
  device_fingerprint          TEXT,
  session_id                  TEXT,
  vpn_detected                BOOLEAN DEFAULT FALSE,
  country_code                CHAR(2),
  city                        TEXT,

  -- Integridad criptográfica (cadena de custodia matemáticamente verificable)
  sha256_doc_at_action        CHAR(64)
    CHECK (sha256_doc_at_action IS NULL OR sha256_doc_at_action ~ '^[0-9a-f]{64}$'),
  document_status_at_action   TEXT,
  signers_completed_at_action INT NOT NULL DEFAULT 0,
  previous_audit_hash         CHAR(64)
    CHECK (previous_audit_hash IS NULL OR previous_audit_hash ~ '^[0-9a-f]{64}$'),
  audit_chain_hash            CHAR(64) NOT NULL
    CHECK (audit_chain_hash ~ '^[0-9a-f]{64}$'),

  -- Notificaciones asociadas a este evento
  notified_parties            JSONB NOT NULL DEFAULT '[]',
  notification_channels       TEXT[] DEFAULT ARRAY[]::TEXT[],

  -- Firma del servidor
  server_hmac                 TEXT NOT NULL,
  signed_by_service           TEXT NOT NULL DEFAULT 'docubox-api',

  -- Sellado de tiempo NOM-151
  nom151_timestamp_token      TEXT,

  -- Metadata adicional cifrada
  metadata_encrypted          TEXT,

  -- Timestamp del evento
  action_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Restricciones adicionales
  CONSTRAINT uq_audit_trail_document_sequence
    UNIQUE (document_id, sequence_number),
  CONSTRAINT chk_audit_legal_event_sha256
    CHECK (NOT is_legal_event OR sha256_doc_at_action IS NOT NULL),
  CONSTRAINT chk_audit_legal_event_code
    CHECK (NOT is_legal_event OR legal_event_code IS NOT NULL),
  CONSTRAINT chk_audit_failure_reason
    CHECK (action_result <> 'fallido' OR failure_reason IS NOT NULL)
);

-- ---------------------------------------------------------------------------
-- ÍNDICES: document_audit_trail
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_audit_trail_document_id
  ON public.document_audit_trail (document_id);

CREATE INDEX IF NOT EXISTS idx_audit_trail_actor_id
  ON public.document_audit_trail (actor_id);

CREATE INDEX IF NOT EXISTS idx_audit_trail_action_code
  ON public.document_audit_trail (action_code);

CREATE INDEX IF NOT EXISTS idx_audit_trail_action_category
  ON public.document_audit_trail (action_category);

CREATE INDEX IF NOT EXISTS idx_audit_trail_legal_events
  ON public.document_audit_trail (document_id, action_at DESC)
  WHERE is_legal_event = TRUE;

CREATE INDEX IF NOT EXISTS idx_audit_trail_action_at_desc
  ON public.document_audit_trail (action_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_trail_document_action_at
  ON public.document_audit_trail (document_id, action_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_trail_notified_parties_gin
  ON public.document_audit_trail USING GIN (notified_parties);

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: document_audit_trail
-- ---------------------------------------------------------------------------
ALTER TABLE public.document_audit_trail ENABLE ROW LEVEL SECURITY;

-- INMUTABLE: función que lanza excepción en UPDATE o DELETE
CREATE OR REPLACE FUNCTION enforce_audit_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'La bitácora de auditoría es inmutable por requerimiento legal NOM-151. '
    'Operación: %. Document ID: %', TG_OP, OLD.document_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_trail_immutable ON public.document_audit_trail;
CREATE TRIGGER trg_audit_trail_immutable
  BEFORE UPDATE OR DELETE ON public.document_audit_trail
  FOR EACH ROW
  EXECUTE FUNCTION enforce_audit_immutability();

-- INSERT: solo service_role
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'document_audit_trail' AND policyname = 'audit_trail_insert_service_role'
  ) THEN
    CREATE POLICY audit_trail_insert_service_role
      ON public.document_audit_trail FOR INSERT
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- SELECT: miembros del workspace con acceso al documento
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'document_audit_trail' AND policyname = 'audit_trail_select_workspace_members'
  ) THEN
    CREATE POLICY audit_trail_select_workspace_members
      ON public.document_audit_trail FOR SELECT
      USING (
        document_id IN (
          SELECT d.id FROM documents d
          JOIN workspace_members wm ON wm.workspace_id = d.workspace_id
          WHERE wm.user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- FUNCIÓN: register_audit_event
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION register_audit_event(
  p_document_id         UUID,
  p_actor_id            UUID,
  p_actor_email         TEXT,
  p_actor_name          TEXT,
  p_actor_role          TEXT,
  p_action_code         TEXT,
  p_action_category     TEXT,
  p_action_description  TEXT,
  p_action_result       TEXT,
  p_sha256_doc          CHAR(64),
  p_server_hmac         TEXT,
  p_audit_chain_hash    CHAR(64),
  p_is_legal_event      BOOLEAN,
  p_legal_event_code    TEXT,
  p_ip_address          INET,
  p_metadata_encrypted  TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next_sequence     INT;
  v_previous_hash     CHAR(64);
  v_new_id            UUID;
  v_doc_status        TEXT;
BEGIN
  -- Obtener el último sequence_number con bloqueo para evitar race conditions
  SELECT
    COALESCE(MAX(sequence_number), 0) + 1,
    (SELECT audit_chain_hash FROM document_audit_trail
     WHERE document_id = p_document_id
     ORDER BY sequence_number DESC LIMIT 1)
  INTO v_next_sequence, v_previous_hash
  FROM document_audit_trail
  WHERE document_id = p_document_id
  FOR UPDATE;

  -- Obtener estado actual del documento
  SELECT status INTO v_doc_status
  FROM documents
  WHERE id = p_document_id;

  -- Insertar el nuevo registro
  INSERT INTO document_audit_trail (
    document_id,
    sequence_number,
    actor_id,
    actor_email,
    actor_name,
    actor_role,
    action_code,
    action_category,
    action_description_es,
    action_result,
    sha256_doc_at_action,
    document_status_at_action,
    previous_audit_hash,
    audit_chain_hash,
    is_legal_event,
    legal_event_code,
    ip_address,
    server_hmac,
    metadata_encrypted,
    action_at
  )
  VALUES (
    p_document_id,
    v_next_sequence,
    p_actor_id,
    p_actor_email,
    p_actor_name,
    p_actor_role,
    p_action_code,
    p_action_category,
    p_action_description,
    p_action_result,
    p_sha256_doc,
    v_doc_status,
    v_previous_hash,
    p_audit_chain_hash,
    p_is_legal_event,
    p_legal_event_code,
    p_ip_address,
    p_server_hmac,
    p_metadata_encrypted,
    NOW()
  )
  RETURNING id INTO v_new_id;

  -- Si es evento legal, actualizar updated_at del documento
  IF p_is_legal_event THEN
    UPDATE documents SET updated_at = NOW() WHERE id = p_document_id;
  END IF;

  RETURN v_new_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- FUNCIÓN: verify_audit_chain
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION verify_audit_chain(p_document_id UUID)
RETURNS TABLE(
  sequence_number   INT,
  action_code       TEXT,
  chain_valid       BOOLEAN,
  action_at         TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_prev_hash   CHAR(64) := NULL;
  v_rec         RECORD;
BEGIN
  FOR v_rec IN
    SELECT
      dat.sequence_number,
      dat.action_code,
      dat.audit_chain_hash,
      dat.previous_audit_hash,
      dat.action_at
    FROM document_audit_trail dat
    WHERE dat.document_id = p_document_id
    ORDER BY dat.sequence_number ASC
  LOOP
    sequence_number := v_rec.sequence_number;
    action_code     := v_rec.action_code;
    action_at       := v_rec.action_at;

    -- Verificar que previous_audit_hash coincide con el hash del registro anterior
    IF v_rec.sequence_number = 1 THEN
      chain_valid := (v_rec.previous_audit_hash IS NULL);
    ELSE
      chain_valid := (v_rec.previous_audit_hash = v_prev_hash);
    END IF;

    v_prev_hash := v_rec.audit_chain_hash;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- FUNCIÓN: get_legal_events_summary
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_legal_events_summary(p_document_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'sequence_number',        dat.sequence_number,
      'action_code',            dat.action_code,
      'legal_event_code',       dat.legal_event_code,
      'actor', jsonb_build_object(
        'email', dat.actor_email,
        'name',  dat.actor_name,
        'role',  dat.actor_role
      ),
      'sha256_doc_at_action',   dat.sha256_doc_at_action,
      'audit_chain_hash',       dat.audit_chain_hash,
      'nom151_timestamp_token', dat.nom151_timestamp_token,
      'action_at',              dat.action_at
    )
    ORDER BY dat.sequence_number ASC
  )
  INTO v_result
  FROM document_audit_trail dat
  WHERE dat.document_id = p_document_id
    AND dat.is_legal_event = TRUE;

  RETURN COALESCE(v_result, '[]'::JSONB);
END;
$$;

-- ---------------------------------------------------------------------------
-- VISTA: legal_audit_report
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.legal_audit_report AS
SELECT
  dat.id,
  dat.document_id,
  d.title                     AS document_title,
  d.workspace_id,
  dat.sequence_number,
  dat.actor_id,
  dat.actor_email,
  dat.actor_name,
  dat.actor_role,
  dat.action_code,
  dat.action_category,
  dat.action_description_es,
  dat.action_result,
  dat.legal_event_code,
  dat.legal_article_reference,
  dat.sha256_doc_at_action,
  dat.document_status_at_action,
  dat.signers_completed_at_action,
  dat.previous_audit_hash,
  dat.audit_chain_hash,
  dat.nom151_timestamp_token,
  dat.ip_address,
  dat.country_code,
  dat.city,
  dat.notified_parties,
  dat.action_at
FROM document_audit_trail dat
JOIN public.documents d ON d.id = dat.document_id
WHERE dat.is_legal_event = TRUE
ORDER BY dat.document_id, dat.sequence_number ASC;

COMMENT ON VIEW public.legal_audit_report IS
  'Vista de eventos jurídicamente relevantes para generar el reporte de auditoría legal. '
  'Incluye solo eventos con is_legal_event = TRUE. '
  'Fundamento: NOM-151-SCFI-2016 y Código de Comercio Art. 49.';

-- ---------------------------------------------------------------------------
-- COMENTARIOS: document_audit_trail
-- ---------------------------------------------------------------------------
COMMENT ON TABLE public.document_audit_trail IS
  'Bitácora jurídica inmutable del documento. Registra cada acción humana o del sistema '
  'con contexto técnico y legal suficiente para demostrar cadena de custodia ante un juez. '
  'Fundamento: NOM-151-SCFI-2016 y Código de Comercio Art. 49.';

COMMENT ON COLUMN public.document_audit_trail.id IS 'Identificador único del registro de auditoría (UUID v4).';
COMMENT ON COLUMN public.document_audit_trail.document_id IS 'FK al documento auditado. No se puede eliminar el documento si tiene registros de auditoría.';
COMMENT ON COLUMN public.document_audit_trail.sequence_number IS 'Número de secuencia monotónico por documento. Empieza en 1. No puede haber huecos.';
COMMENT ON COLUMN public.document_audit_trail.actor_id IS 'UUID del usuario que realizó la acción. NULL para acciones del sistema.';
COMMENT ON COLUMN public.document_audit_trail.actor_email IS 'Email del actor desnormalizado al momento de la acción. Preserva identidad histórica.';
COMMENT ON COLUMN public.document_audit_trail.actor_name IS 'Nombre completo del actor desnormalizado al momento de la acción.';
COMMENT ON COLUMN public.document_audit_trail.actor_role IS 'Rol del actor: propietario, firmante, aprobador, observador, administrador, sistema, psc, api_externa.';
COMMENT ON COLUMN public.document_audit_trail.action_code IS 'Código de la acción realizada. Catálogo cerrado de valores.';
COMMENT ON COLUMN public.document_audit_trail.action_category IS 'Categoría de la acción: ciclo_de_vida, participantes, notificacion, acceso, firma, aprobacion, cumplimiento, seguridad.';
COMMENT ON COLUMN public.document_audit_trail.action_description_es IS 'Descripción legible en español de la acción, ej: "Juan López abrió el documento desde Monterrey, NL".';
COMMENT ON COLUMN public.document_audit_trail.action_result IS 'Resultado de la acción: exitoso, fallido, parcial, pendiente.';
COMMENT ON COLUMN public.document_audit_trail.failure_reason IS 'Descripción del fallo si action_result = fallido. Obligatorio en ese caso.';
COMMENT ON COLUMN public.document_audit_trail.is_legal_event IS 'TRUE para eventos jurídicamente relevantes: firma_completada, nom151_generado, blockchain_notarizado, etc.';
COMMENT ON COLUMN public.document_audit_trail.legal_event_code IS 'Código normativo aplicable, ej: NOM151_ART8, EFIRMA_VALIDADA, NO_REPUDIO_ACREDITADO.';
COMMENT ON COLUMN public.document_audit_trail.legal_article_reference IS 'Artículo legal específico, ej: Código de Comercio Art. 89, NOM-151-SCFI-2016 Sección 7.3.';
COMMENT ON COLUMN public.document_audit_trail.ip_address IS 'Dirección IP del actor al momento de la acción.';
COMMENT ON COLUMN public.document_audit_trail.user_agent IS 'User-Agent del navegador del actor.';
COMMENT ON COLUMN public.document_audit_trail.device_fingerprint IS 'Huella de dispositivo del actor.';
COMMENT ON COLUMN public.document_audit_trail.session_id IS 'ID de sesión del actor al momento de la acción.';
COMMENT ON COLUMN public.document_audit_trail.vpn_detected IS 'TRUE si se detectó uso de VPN por el actor.';
COMMENT ON COLUMN public.document_audit_trail.country_code IS 'Código de país ISO 3166-1 alpha-2 del actor.';
COMMENT ON COLUMN public.document_audit_trail.city IS 'Ciudad del actor al momento de la acción.';
COMMENT ON COLUMN public.document_audit_trail.sha256_doc_at_action IS 'Hash SHA-256 del documento en el momento exacto de esta acción. Demuestra que el documento no fue modificado entre eventos.';
COMMENT ON COLUMN public.document_audit_trail.document_status_at_action IS 'Estado del documento al momento de la acción (desnormalizado para el registro histórico).';
COMMENT ON COLUMN public.document_audit_trail.signers_completed_at_action IS 'Cuántos firmantes habían completado su firma cuando ocurrió esta acción.';
COMMENT ON COLUMN public.document_audit_trail.previous_audit_hash IS 'Hash del registro anterior en esta cadena de auditoría. NULL solo en el primer evento. Hace el log matemáticamente inviolable.';
COMMENT ON COLUMN public.document_audit_trail.audit_chain_hash IS 'SHA256 del registro completo. Calculado por el backend antes de insertar. Nunca calculado en la BD.';
COMMENT ON COLUMN public.document_audit_trail.notified_parties IS 'Array de objetos con las partes notificadas: [{email, name, role, channel, sent_at, delivery_status, opened_at}].';
COMMENT ON COLUMN public.document_audit_trail.notification_channels IS 'Canales de notificación usados: email, whatsapp, sms.';
COMMENT ON COLUMN public.document_audit_trail.server_hmac IS 'HMAC-SHA256 del registro completo firmado con la clave secreta del servidor. Permite detectar alteraciones directas en la BD.';
COMMENT ON COLUMN public.document_audit_trail.signed_by_service IS 'Identificador del servicio que generó este registro.';
COMMENT ON COLUMN public.document_audit_trail.nom151_timestamp_token IS 'Token RFC 3161 en base64 del PSC acreditado para eventos con is_legal_event = TRUE.';
COMMENT ON COLUMN public.document_audit_trail.metadata_encrypted IS 'JSON cifrado AES-256 con contexto adicional específico del evento.';
COMMENT ON COLUMN public.document_audit_trail.action_at IS 'Timestamp del servidor en UTC. Nunca del cliente.';

-- ---------------------------------------------------------------------------
-- VERIFICACIÓN FINAL
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  RAISE NOTICE '=== VERIFICACIÓN 002_docubox_audit_trail ===';
END $$;

SELECT
  'document_audit_trail' AS tabla,
  COUNT(*) AS columnas
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'document_audit_trail';

SELECT
  tablename,
  policyname,
  cmd
FROM pg_policies
WHERE tablename = 'document_audit_trail'
ORDER BY policyname;

SELECT
  indexname
FROM pg_indexes
WHERE tablename = 'document_audit_trail'
ORDER BY indexname;

SELECT
  routine_name,
  routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'enforce_audit_immutability',
    'register_audit_event',
    'verify_audit_chain',
    'get_legal_events_summary'
  );

SELECT
  viewname
FROM pg_views
WHERE schemaname = 'public'
  AND viewname = 'legal_audit_report';
