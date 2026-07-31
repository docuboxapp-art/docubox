-- =============================================================================
-- MIGRACIÓN: 003_docubox_integrity_log.sql
-- Plataforma: DOCUBOX — SaaS de Firma Electrónica Avanzada (México)
-- =============================================================================
--
-- PROPÓSITO LEGAL:
--
-- TABLA document_integrity_log:
--   Columna vertebral criptográfica del sistema. Registra CADA mutación de estado
--   del documento mediante una cadena de hashes encadenados donde cada evento
--   incorpora el hash del evento anterior. Cualquier manipulación posterior de un
--   registro es matemáticamente detectable porque rompe todos los hashes subsiguientes.
--
--   Propósito legal triple:
--   1. Demostrar ante cualquier tribunal que el documento no fue alterado en ningún
--      punto de su ciclo de vida (integridad probatoria bajo NOM-151-SCFI-2016).
--   2. Acreditar la secuencia exacta e ininterrumpida de eventos del proceso de firma
--      (cadena de custodia bajo Código de Comercio Art. 89 bis).
--   3. Proveer el registro técnico que el PSC (Proveedor de Servicios de Certificación)
--      necesita para emitir la constancia de conservación NOM-151.
--
-- FUNDAMENTOS NORMATIVOS:
--   - NOM-151-SCFI-2016: Requisitos para la conservación de mensajes de datos.
--   - Código de Comercio Art. 89 bis: Validez jurídica de los mensajes de datos.
--
-- =============================================================================

-- ---------------------------------------------------------------------------
-- EXTENSIONES
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- TABLA: document_integrity_log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.document_integrity_log (

  -- Identificación del registro
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id                 UUID NOT NULL REFERENCES public.documents(id) ON DELETE RESTRICT,
  sequence_number             INT NOT NULL CHECK (sequence_number >= 1),

  -- Clasificación del evento
  event_type                  TEXT NOT NULL CHECK (event_type IN (
    -- Ciclo de vida del documento
    'documento_creado','documento_cargado','documento_editado',
    'documento_completado','documento_vencido','documento_cancelado',
    'documento_anulado','custodia_transferida',
    -- Participantes
    'participante_asignado','participante_removido','acceso_revocado',
    -- Notificaciones
    'invitacion_enviada','recordatorio_enviado',
    -- Acceso y visualización
    'documento_abierto','documento_visto','descarga_realizada',
    -- Proceso de firma
    'firma_iniciada','efirma_certificado_validado','autografa_capturada',
    'otp_verificado','firma_completada','firma_rechazada','firma_delegada',
    -- Aprobaciones
    'aprobacion_otorgada','aprobacion_rechazada',
    -- Cumplimiento legal
    'nom151_solicitado','nom151_emitido','blockchain_notarizado',
    -- Seguridad
    'intento_fallido_detectado','actividad_sospechosa','sesion_expirada'
  )),
  event_category              TEXT NOT NULL CHECK (event_category IN (
    'ciclo_de_vida','participantes','notificacion',
    'acceso','firma','aprobacion','cumplimiento','seguridad'
  )),

  -- Actor que generó el evento
  actor_id                    UUID REFERENCES auth.users(id),
  actor_role                  TEXT CHECK (actor_role IS NULL OR actor_role IN (
    'propietario','firmante','aprobador','observador',
    'administrador','sistema','psc','api_externa'
  )),
  actor_email_snapshot        TEXT,
  triggered_by                TEXT NOT NULL DEFAULT 'usuario'
    CHECK (triggered_by IN ('usuario','sistema','webhook','scheduler','api')),

  -- NÚCLEO CRIPTOGRÁFICO
  sha256_document_state       CHAR(64) NOT NULL
    CHECK (sha256_document_state ~ '^[0-9a-f]{64}$'),
  previous_event_hash         CHAR(64)
    CHECK (previous_event_hash IS NULL OR previous_event_hash ~ '^[0-9a-f]{64}$'),
  chain_hash                  CHAR(64) NOT NULL
    CHECK (chain_hash ~ '^[0-9a-f]{64}$'),
  server_hmac                 TEXT NOT NULL,
  signed_by_service           TEXT NOT NULL DEFAULT 'docubox-api',
  signing_key_version         TEXT NOT NULL DEFAULT 'v1',

  -- Estado del documento en el momento del evento (desnormalizado)
  document_status_snapshot    TEXT NOT NULL,
  signers_total               INT NOT NULL DEFAULT 0,
  signers_completed           INT NOT NULL DEFAULT 0,
  participants_snapshot       JSONB NOT NULL DEFAULT '[]',

  -- Sellado de tiempo externo (para eventos con valor jurídico)
  nom151_timestamp_token      TEXT,
  nom151_provider             TEXT CHECK (nom151_provider IS NULL OR nom151_provider IN (
    'cincel','mifiel','verificamex','incode','seguridata'
  )),
  rfc3161_time                TIMESTAMPTZ,
  requires_nom151_stamp       BOOLEAN NOT NULL DEFAULT FALSE,

  -- Payload adicional cifrado
  payload_encrypted           TEXT,

  -- Timestamp del servidor
  event_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Restricciones adicionales
  CONSTRAINT uq_integrity_log_document_sequence
    UNIQUE (document_id, sequence_number),
  CONSTRAINT chk_integrity_signers_completed_lte_total
    CHECK (signers_completed <= signers_total),
  CONSTRAINT chk_integrity_rfc3161_time_window
    CHECK (
      rfc3161_time IS NULL
      OR rfc3161_time BETWEEN event_at - INTERVAL '10 minutes'
                          AND event_at + INTERVAL '10 minutes'
    )
);

-- ---------------------------------------------------------------------------
-- ÍNDICES: document_integrity_log
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_integrity_log_document_id
  ON public.document_integrity_log (document_id);

CREATE INDEX IF NOT EXISTS idx_integrity_log_event_type
  ON public.document_integrity_log (event_type);

CREATE INDEX IF NOT EXISTS idx_integrity_log_event_category
  ON public.document_integrity_log (event_category);

CREATE INDEX IF NOT EXISTS idx_integrity_log_actor_id
  ON public.document_integrity_log (actor_id)
  WHERE actor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_integrity_log_nom151_required
  ON public.document_integrity_log (document_id, event_at DESC)
  WHERE requires_nom151_stamp = TRUE;

CREATE INDEX IF NOT EXISTS idx_integrity_log_event_at_desc
  ON public.document_integrity_log (event_at DESC);

CREATE INDEX IF NOT EXISTS idx_integrity_log_document_event_at
  ON public.document_integrity_log (document_id, event_at DESC);

CREATE INDEX IF NOT EXISTS idx_integrity_log_participants_gin
  ON public.document_integrity_log USING GIN (participants_snapshot);

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: document_integrity_log
-- ---------------------------------------------------------------------------
ALTER TABLE public.document_integrity_log ENABLE ROW LEVEL SECURITY;

-- INMUTABLE ABSOLUTO: función que lanza excepción para cualquier UPDATE o DELETE
CREATE OR REPLACE FUNCTION enforce_integrity_log_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'El log de integridad es inmutable por requerimiento legal NOM-151. '
    'Operación: %. Document ID: %', TG_OP, OLD.document_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_integrity_log_immutable ON public.document_integrity_log;
CREATE TRIGGER trg_integrity_log_immutable
  BEFORE UPDATE OR DELETE ON public.document_integrity_log
  FOR EACH ROW
  EXECUTE FUNCTION enforce_integrity_log_immutability();

-- INSERT: solo service_role
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'document_integrity_log' AND policyname = 'integrity_log_insert_service_role'
  ) THEN
    CREATE POLICY integrity_log_insert_service_role
      ON public.document_integrity_log FOR INSERT
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- SELECT: miembros del workspace con acceso al documento
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'document_integrity_log' AND policyname = 'integrity_log_select_workspace_members'
  ) THEN
    CREATE POLICY integrity_log_select_workspace_members
      ON public.document_integrity_log FOR SELECT
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
-- FUNCIÓN: register_integrity_event
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION register_integrity_event(
  p_document_id         UUID,
  p_event_type          TEXT,
  p_actor_id            UUID,
  p_actor_role          TEXT,
  p_actor_email         TEXT,
  p_triggered_by        TEXT,
  p_sha256_doc_state    CHAR(64),
  p_chain_hash          CHAR(64),
  p_server_hmac         TEXT,
  p_signing_key_version TEXT,
  p_requires_nom151     BOOLEAN,
  p_nom151_token        TEXT,
  p_nom151_provider     TEXT,
  p_participants_json   JSONB,
  p_payload_encrypted   TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next_sequence         INT;
  v_previous_hash         CHAR(64);
  v_event_category        TEXT;
  v_doc_status            TEXT;
  v_signers_total         INT;
  v_signers_completed     INT;
  v_new_id                UUID;
BEGIN
  -- Validar token NOM-151 si es requerido
  IF p_requires_nom151 = TRUE AND p_nom151_token IS NULL THEN
    RAISE EXCEPTION
      'El token NOM-151 es obligatorio para el tipo de evento "%" cuando requires_nom151_stamp = TRUE. '
      'Proporcione el token RFC 3161 emitido por el PSC acreditado antes de registrar este evento.',
      p_event_type;
  END IF;

  -- Obtener el último sequence_number con bloqueo para evitar race conditions
  SELECT
    COALESCE(MAX(dil.sequence_number), 0) + 1,
    (SELECT dil2.chain_hash FROM document_integrity_log dil2
     WHERE dil2.document_id = p_document_id
     ORDER BY dil2.sequence_number DESC LIMIT 1)
  INTO v_next_sequence, v_previous_hash
  FROM document_integrity_log dil
  WHERE dil.document_id = p_document_id
  FOR UPDATE;

  -- Derivar event_category automáticamente del event_type
  v_event_category := CASE
    WHEN p_event_type IN (
      'documento_creado','documento_cargado','documento_editado',
      'documento_completado','documento_vencido','documento_cancelado',
      'documento_anulado','custodia_transferida'
    ) THEN 'ciclo_de_vida'
    WHEN p_event_type IN (
      'participante_asignado','participante_removido','acceso_revocado'
    ) THEN 'participantes'
    WHEN p_event_type IN (
      'invitacion_enviada','recordatorio_enviado'
    ) THEN 'notificacion'
    WHEN p_event_type IN (
      'documento_abierto','documento_visto','descarga_realizada'
    ) THEN 'acceso'
    WHEN p_event_type IN (
      'firma_iniciada','efirma_certificado_validado','autografa_capturada',
      'otp_verificado','firma_completada','firma_rechazada','firma_delegada'
    ) THEN 'firma'
    WHEN p_event_type IN (
      'aprobacion_otorgada','aprobacion_rechazada'
    ) THEN 'aprobacion'
    WHEN p_event_type IN (
      'nom151_solicitado','nom151_emitido','blockchain_notarizado'
    ) THEN 'cumplimiento'
    WHEN p_event_type IN (
      'intento_fallido_detectado','actividad_sospechosa','sesion_expirada'
    ) THEN 'seguridad'
    ELSE 'ciclo_de_vida'
  END;

  -- Obtener estado actual del documento con bloqueo compartido
  SELECT
    d.status,
    COALESCE(jsonb_array_length(d.signing_order), 0),
    (
      SELECT COUNT(*)::INT
      FROM jsonb_array_elements(d.signing_order) AS so
      WHERE (so->>'status') = 'completado'
    )
  INTO v_doc_status, v_signers_total, v_signers_completed
  FROM documents d
  WHERE d.id = p_document_id
  FOR SHARE;

  -- Insertar el nuevo registro
  INSERT INTO document_integrity_log (
    document_id,
    sequence_number,
    event_type,
    event_category,
    actor_id,
    actor_role,
    actor_email_snapshot,
    triggered_by,
    sha256_document_state,
    previous_event_hash,
    chain_hash,
    server_hmac,
    signed_by_service,
    signing_key_version,
    document_status_snapshot,
    signers_total,
    signers_completed,
    participants_snapshot,
    nom151_timestamp_token,
    nom151_provider,
    requires_nom151_stamp,
    payload_encrypted,
    event_at
  )
  VALUES (
    p_document_id,
    v_next_sequence,
    p_event_type,
    v_event_category,
    p_actor_id,
    p_actor_role,
    p_actor_email,
    p_triggered_by,
    p_sha256_doc_state,
    v_previous_hash,
    p_chain_hash,
    p_server_hmac,
    'docubox-api',
    p_signing_key_version,
    v_doc_status,
    v_signers_total,
    v_signers_completed,
    COALESCE(p_participants_json, '[]'::JSONB),
    p_nom151_token,
    p_nom151_provider,
    p_requires_nom151,
    p_payload_encrypted,
    NOW()
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- FUNCIÓN: verify_integrity_chain
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION verify_integrity_chain(p_document_id UUID)
RETURNS TABLE(
  sequence_number     INT,
  event_type          TEXT,
  event_at            TIMESTAMPTZ,
  chain_hash_stored   CHAR(64),
  chain_hash_computed CHAR(64),
  is_valid            BOOLEAN,
  tamper_detected     BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rec               RECORD;
  v_prev_chain_hash   CHAR(64) := NULL;
  v_computed          TEXT;
  v_input             TEXT;
BEGIN
  FOR v_rec IN
    SELECT
      dil.sequence_number,
      dil.event_type,
      dil.event_at,
      dil.chain_hash,
      dil.previous_event_hash,
      dil.sha256_document_state,
      dil.document_id
    FROM document_integrity_log dil
    WHERE dil.document_id = p_document_id
    ORDER BY dil.sequence_number ASC
  LOOP
    sequence_number   := v_rec.sequence_number;
    event_type        := v_rec.event_type;
    event_at          := v_rec.event_at;
    chain_hash_stored := v_rec.chain_hash;

    -- Recalcular chain_hash usando el mismo algoritmo del backend
    v_input := v_rec.sequence_number::TEXT
      || '|' || v_rec.document_id::TEXT
      || '|' || v_rec.event_type
      || '|' || v_rec.sha256_document_state
      || '|' || COALESCE(v_rec.previous_event_hash, 'GENESIS')
      || '|' || v_rec.event_at::TEXT;

    v_computed := encode(digest(v_input, 'sha256'), 'hex');
    chain_hash_computed := v_computed;

    is_valid := (v_rec.chain_hash = v_computed);

    -- tamper_detected si el hash no coincide O si previous_event_hash no coincide con el hash anterior
    IF v_rec.sequence_number = 1 THEN
      tamper_detected := NOT is_valid;
    ELSE
      tamper_detected := NOT is_valid OR (v_rec.previous_event_hash <> v_prev_chain_hash);
    END IF;

    v_prev_chain_hash := v_rec.chain_hash;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- FUNCIÓN: get_integrity_summary
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_integrity_summary(p_document_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_events      INT;
  v_first_event_at    TIMESTAMPTZ;
  v_last_event_at     TIMESTAMPTZ;
  v_chain_intact      BOOLEAN;
  v_events_by_cat     JSONB;
  v_legal_events      JSONB;
  v_tamper_count      INT := 0;
  v_rec               RECORD;
BEGIN
  -- Conteos básicos
  SELECT
    COUNT(*),
    MIN(event_at),
    MAX(event_at)
  INTO v_total_events, v_first_event_at, v_last_event_at
  FROM document_integrity_log
  WHERE document_id = p_document_id;

  -- Conteo por categoría
  SELECT jsonb_object_agg(event_category, cnt)
  INTO v_events_by_cat
  FROM (
    SELECT event_category, COUNT(*) AS cnt
    FROM document_integrity_log
    WHERE document_id = p_document_id
    GROUP BY event_category
  ) sub;

  -- Verificar integridad de la cadena
  FOR v_rec IN
    SELECT tamper_detected
    FROM verify_integrity_chain(p_document_id)
  LOOP
    IF v_rec.tamper_detected THEN
      v_tamper_count := v_tamper_count + 1;
    END IF;
  END LOOP;
  v_chain_intact := (v_tamper_count = 0);

  -- Eventos legales (requires_nom151_stamp = TRUE)
  SELECT jsonb_agg(
    jsonb_build_object(
      'sequence_number',        dil.sequence_number,
      'event_type',             dil.event_type,
      'sha256_document_state',  dil.sha256_document_state,
      'chain_hash',             dil.chain_hash,
      'nom151_timestamp_token', dil.nom151_timestamp_token,
      'event_at',               dil.event_at
    )
    ORDER BY dil.sequence_number ASC
  )
  INTO v_legal_events
  FROM document_integrity_log dil
  WHERE dil.document_id = p_document_id
    AND dil.requires_nom151_stamp = TRUE;

  RETURN jsonb_build_object(
    'total_events',       v_total_events,
    'first_event_at',     v_first_event_at,
    'last_event_at',      v_last_event_at,
    'chain_intact',       v_chain_intact,
    'events_by_category', COALESCE(v_events_by_cat, '{}'::JSONB),
    'legal_events',       COALESCE(v_legal_events, '[]'::JSONB)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- COMENTARIOS: document_integrity_log
-- ---------------------------------------------------------------------------
COMMENT ON TABLE document_integrity_log IS
  'Log de integridad criptográfica del documento. Columna vertebral del sistema DOCUBOX. '
  'Registra cada mutación de estado mediante cadena de hashes encadenados. INMUTABLE. '
  'Fundamento: NOM-151-SCFI-2016 y Código de Comercio Art. 89 bis.';

COMMENT ON COLUMN document_integrity_log.id IS 'Identificador único del registro (UUID v4).';
COMMENT ON COLUMN document_integrity_log.document_id IS 'FK al documento. No se puede eliminar el documento si tiene registros de integridad.';
COMMENT ON COLUMN document_integrity_log.sequence_number IS 'Número de secuencia monotónico por documento. Empieza en 1. No puede haber huecos. Un hueco indica manipulación.';
COMMENT ON COLUMN document_integrity_log.event_type IS 'Tipo de evento registrado. Catálogo cerrado de valores.';
COMMENT ON COLUMN document_integrity_log.event_category IS 'Categoría del evento: ciclo_de_vida, participantes, notificacion, acceso, firma, aprobacion, cumplimiento, seguridad.';
COMMENT ON COLUMN document_integrity_log.actor_id IS 'UUID del actor. NULL para eventos del sistema (nom151_emitido, blockchain_notarizado, etc.).';
COMMENT ON COLUMN document_integrity_log.actor_role IS 'Rol del actor al momento del evento.';
COMMENT ON COLUMN document_integrity_log.actor_email_snapshot IS 'Email del actor desnormalizado al momento del evento. Preserva identidad histórica aunque el usuario cambie su email.';
COMMENT ON COLUMN document_integrity_log.triggered_by IS 'Origen del evento: usuario, sistema, webhook, scheduler, api.';
COMMENT ON COLUMN document_integrity_log.sha256_document_state IS 'Hash SHA-256 del documento en su estado exacto al momento de este evento. Ancla criptográfica del evento al documento. Nunca NULL.';
COMMENT ON COLUMN document_integrity_log.previous_event_hash IS 'chain_hash del registro anterior. NULL solo en el primer evento (sequence_number = 1), donde se usa GENESIS en el cálculo.';
COMMENT ON COLUMN document_integrity_log.chain_hash IS 'Hash encadenado calculado por el backend. Algoritmo: SHA256(seq||doc_id||event_type||sha256_doc||prev_hash||event_at). Nunca calculado en la BD.';
COMMENT ON COLUMN document_integrity_log.server_hmac IS 'HMAC-SHA256 del registro completo firmado con la clave secreta del servidor. Permite detectar alteraciones directas en la BD.';
COMMENT ON COLUMN document_integrity_log.signed_by_service IS 'Identificador del microservicio que generó este registro.';
COMMENT ON COLUMN document_integrity_log.signing_key_version IS 'Versión de la clave de firma usada para server_hmac. Permite rotación de claves sin invalidar registros históricos.';
COMMENT ON COLUMN document_integrity_log.document_status_snapshot IS 'Estado del documento al momento del evento (desnormalizado). El registro es autocontenido.';
COMMENT ON COLUMN document_integrity_log.signers_total IS 'Total de firmantes requeridos en este punto del proceso.';
COMMENT ON COLUMN document_integrity_log.signers_completed IS 'Cuántos firmantes habían completado su firma cuando ocurrió este evento.';
COMMENT ON COLUMN document_integrity_log.participants_snapshot IS 'Snapshot de los participantes: [{signer_id, email, role, status, signed_at}]. Permite reconstruir el estado completo en cualquier punto histórico.';
COMMENT ON COLUMN document_integrity_log.nom151_timestamp_token IS 'Token RFC 3161 en base64 emitido por PSC acreditado bajo NOM-151. Obligatorio cuando requires_nom151_stamp = TRUE.';
COMMENT ON COLUMN document_integrity_log.nom151_provider IS 'Proveedor del sellado de tiempo: cincel, mifiel, verificamex, incode, seguridata.';
COMMENT ON COLUMN document_integrity_log.rfc3161_time IS 'Timestamp extraído del token RFC 3161. Debe estar dentro de ±10 minutos de event_at.';
COMMENT ON COLUMN document_integrity_log.requires_nom151_stamp IS 'TRUE para eventos jurídicamente significativos: firma_completada, documento_completado, nom151_emitido, blockchain_notarizado, documento_anulado, custodia_transferida.';
COMMENT ON COLUMN document_integrity_log.payload_encrypted IS 'JSON cifrado AES-256 con contexto adicional del evento. Ej: para firma_completada: {sat_cert_serial, rfc3161_token, autograph_svg_hash, otp_method}.';
COMMENT ON COLUMN document_integrity_log.event_at IS 'Timestamp del servidor en UTC. Nunca del cliente. Es el timestamp que el RFC 3161 certifica.';

-- ---------------------------------------------------------------------------
-- VERIFICACIÓN FINAL
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  RAISE NOTICE '=== VERIFICACIÓN 003_docubox_integrity_log ===';
END $$;

SELECT
  'document_integrity_log' AS tabla,
  COUNT(*) AS columnas
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'document_integrity_log';

SELECT
  tablename,
  policyname,
  cmd
FROM pg_policies
WHERE tablename = 'document_integrity_log'
ORDER BY policyname;

SELECT
  indexname
FROM pg_indexes
WHERE tablename = 'document_integrity_log'
ORDER BY indexname;

SELECT
  routine_name,
  routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'enforce_integrity_log_immutability',
    'register_integrity_event',
    'verify_integrity_chain',
    'get_integrity_summary'
  );

SELECT
  tgname AS trigger_name,
  tgrelid::regclass AS table_name
FROM pg_trigger
WHERE tgname = 'trg_integrity_log_immutable';
