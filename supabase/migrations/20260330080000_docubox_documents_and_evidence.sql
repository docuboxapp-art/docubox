-- =============================================================================
-- MIGRACIÓN: 001_docubox_documents_and_evidence.sql
-- Plataforma: DOCUBOX — SaaS de Firma Electrónica Avanzada (México)
-- =============================================================================
--
-- PROPÓSITO LEGAL:
--
-- TABLA documents:
--   Registro principal de cada documento en la plataforma. Controla el ciclo de
--   vida completo del documento, acredita su integridad criptográfica y demuestra
--   el cumplimiento legal ante cualquier autoridad o tribunal conforme al
--   Código de Comercio Art. 49 y la NOM-151-SCFI-2016.
--
-- TABLA document_evidence:
--   Captura el contexto forense completo del momento exacto en que el documento
--   fue cargado/creado. Es INMUTABLE: ningún rol puede hacer UPDATE ni DELETE.
--   Tiene valor probatorio directo bajo el Art. 49 del Código de Comercio para
--   acreditar: quién cargó el documento, desde dónde, con qué dispositivo,
--   exactamente cuándo, que el archivo no fue alterado y que el usuario fue
--   notificado de los términos legales.
--
-- =============================================================================

-- ---------------------------------------------------------------------------
-- EXTENSIONES
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- TABLA: documents
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.documents (

  -- Identidad básica
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                    UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  owner_id                        UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  title                           TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  description                     TEXT,
  document_type                   TEXT NOT NULL DEFAULT 'contrato'
    CHECK (document_type IN (
      'contrato','factura','poder_notarial','addendum','convenio',
      'carta_responsiva','pagare','otro'
    )),
  status                          TEXT NOT NULL DEFAULT 'borrador'
    CHECK (status IN (
      'borrador','pendiente','en_proceso','completado',
      'vencido','cancelado','anulado','en_disputa'
    )),

  -- Integridad criptográfica (núcleo del valor probatorio)
  sha256_original                 CHAR(64) NOT NULL
    CHECK (sha256_original ~ '^[0-9a-f]{64}$'),
  sha256_signed                   CHAR(64)
    CHECK (sha256_signed IS NULL OR sha256_signed ~ '^[0-9a-f]{64}$'),
  sha256_metadata_package         CHAR(64)
    CHECK (sha256_metadata_package IS NULL OR sha256_metadata_package ~ '^[0-9a-f]{64}$'),

  -- Almacenamiento
  storage_path_encrypted          TEXT NOT NULL,
  storage_bucket                  TEXT NOT NULL DEFAULT 'docubox-documents',
  file_size_bytes                 BIGINT NOT NULL CHECK (file_size_bytes > 0),
  mime_type                       TEXT NOT NULL DEFAULT 'application/pdf'
    CHECK (mime_type IN (
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )),
  page_count                      INT CHECK (page_count IS NULL OR page_count > 0),

  -- Control del proceso de firma
  signing_mode                    TEXT NOT NULL DEFAULT 'secuencial'
    CHECK (signing_mode IN ('secuencial','paralelo','mixto')),
  signing_order                   JSONB NOT NULL DEFAULT '[]',
  require_otp                     BOOLEAN NOT NULL DEFAULT TRUE,
  require_geolocation             BOOLEAN NOT NULL DEFAULT FALSE,
  require_device_fingerprint      BOOLEAN NOT NULL DEFAULT TRUE,
  allow_delegation                BOOLEAN NOT NULL DEFAULT FALSE,
  max_attempts_per_signer         INT NOT NULL DEFAULT 3
    CHECK (max_attempts_per_signer BETWEEN 1 AND 10),
  notify_on_view                  BOOLEAN NOT NULL DEFAULT TRUE,
  notify_on_sign                  BOOLEAN NOT NULL DEFAULT TRUE,
  notify_channels                 TEXT[] NOT NULL DEFAULT ARRAY['email'],

  -- Fechas del ciclo de vida
  expires_at                      TIMESTAMPTZ,
  reminder_sent_at                TIMESTAMPTZ,
  first_viewed_at                 TIMESTAMPTZ,
  first_signed_at                 TIMESTAMPTZ,
  completed_at                    TIMESTAMPTZ,
  voided_at                       TIMESTAMPTZ,
  voided_by                       UUID REFERENCES auth.users(id),
  voided_reason                   TEXT,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at                      TIMESTAMPTZ,

  -- Cumplimiento legal y trazabilidad
  legal_framework                 TEXT[] NOT NULL DEFAULT ARRAY['codigo_comercio_art49','nom151'],
  retention_years                 INT NOT NULL DEFAULT 10
    CHECK (retention_years BETWEEN 5 AND 99),
  custodian_id                    UUID REFERENCES auth.users(id),
  plan_tier                       TEXT NOT NULL DEFAULT 'basic'
    CHECK (plan_tier IN ('basic','pro','enterprise')),
  is_legally_executed             BOOLEAN NOT NULL DEFAULT FALSE,
  probatory_value_confirmed_at    TIMESTAMPTZ,
  nom151_constancia_id            UUID,
  blockchain_tx_hash              TEXT,

  -- Restricciones de fechas
  CONSTRAINT chk_expires_after_created
    CHECK (expires_at IS NULL OR expires_at > created_at),
  CONSTRAINT chk_completed_after_created
    CHECK (completed_at IS NULL OR completed_at >= created_at),
  CONSTRAINT chk_voided_after_created
    CHECK (voided_at IS NULL OR voided_at >= created_at)
);

-- ---------------------------------------------------------------------------
-- ÍNDICES: documents
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_documents_workspace_id
  ON public.documents (workspace_id);

CREATE INDEX IF NOT EXISTS idx_documents_owner_id
  ON public.documents (owner_id);

CREATE INDEX IF NOT EXISTS idx_documents_status
  ON public.documents (status);

CREATE INDEX IF NOT EXISTS idx_documents_expires_at
  ON public.documents (expires_at);

CREATE INDEX IF NOT EXISTS idx_documents_completed_at
  ON public.documents (completed_at);

CREATE INDEX IF NOT EXISTS idx_documents_created_at_desc
  ON public.documents (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_documents_workspace_status
  ON public.documents (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_documents_signing_order_gin
  ON public.documents USING GIN (signing_order);

CREATE INDEX IF NOT EXISTS idx_documents_title_trgm
  ON public.documents USING GIN (title gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- TABLA: document_evidence
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.document_evidence (

  -- Vínculo con el documento
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id                     UUID NOT NULL UNIQUE REFERENCES public.documents(id) ON DELETE RESTRICT,

  -- Red y conectividad
  ip_address                      INET NOT NULL,
  ip_version                      TEXT NOT NULL CHECK (ip_version IN ('ipv4','ipv6')),
  isp                             TEXT,
  asn                             TEXT,
  vpn_detected                    BOOLEAN NOT NULL DEFAULT FALSE,
  proxy_detected                  BOOLEAN NOT NULL DEFAULT FALSE,
  tor_detected                    BOOLEAN NOT NULL DEFAULT FALSE,
  maxmind_risk_score              NUMERIC(5,2)
    CHECK (maxmind_risk_score IS NULL OR maxmind_risk_score BETWEEN 0 AND 100),
  maxmind_connection_type         TEXT,

  -- Dispositivo y navegador
  user_agent                      TEXT NOT NULL,
  user_agent_parsed               JSONB,
  device_fingerprint              TEXT,
  device_type                     TEXT
    CHECK (device_type IS NULL OR device_type IN ('escritorio','movil','tablet','servidor','desconocido')),
  os_name                         TEXT,
  os_version                      TEXT,
  browser_name                    TEXT,
  browser_version                 TEXT,
  screen_resolution               TEXT,
  timezone_client                 TEXT,

  -- Geolocalización
  latitude                        NUMERIC(10,7)
    CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude                       NUMERIC(10,7)
    CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  geolocation_accuracy_meters     NUMERIC(10,2),
  geolocation_source              TEXT
    CHECK (geolocation_source IS NULL OR geolocation_source IN (
      'gps','network','ip_fallback','manual','no_disponible'
    )),
  geocoded_address                TEXT,
  country_code                    CHAR(2),
  state_province                  TEXT,
  city                            TEXT,
  postal_code                     TEXT,
  timezone_geocoded               TEXT,
  opencage_response_encrypted     TEXT,

  -- Integridad criptográfica del archivo
  sha256_file_at_event            CHAR(64) NOT NULL
    CHECK (sha256_file_at_event ~ '^[0-9a-f]{64}$'),
  sha256_metadata_at_event        CHAR(64)
    CHECK (sha256_metadata_at_event IS NULL OR sha256_metadata_at_event ~ '^[0-9a-f]{64}$'),
  server_received_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Sellado de tiempo NOM-151
  nom151_timestamp_token          TEXT,
  nom151_provider                 TEXT
    CHECK (nom151_provider IS NULL OR nom151_provider IN (
      'cincel','mifiel','verificamex','incode','seguridata'
    )),
  rfc3161_time                    TIMESTAMPTZ,

  -- Contexto legal y consentimiento
  upload_channel                  TEXT NOT NULL
    CHECK (upload_channel IN ('web','api','movil','importacion')),
  session_id                      TEXT,
  workspace_ip_policy_passed      BOOLEAN NOT NULL DEFAULT TRUE,
  legal_notice_shown_at           TIMESTAMPTZ,
  legal_notice_version            TEXT,
  terms_accepted                  BOOLEAN NOT NULL DEFAULT FALSE,
  terms_accepted_at               TIMESTAMPTZ,
  recorded_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- ÍNDICES: document_evidence
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_document_evidence_ip_address
  ON public.document_evidence (ip_address);

CREATE INDEX IF NOT EXISTS idx_document_evidence_recorded_at_desc
  ON public.document_evidence (recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_document_evidence_risk_flags
  ON public.document_evidence (vpn_detected, proxy_detected, tor_detected);

CREATE INDEX IF NOT EXISTS idx_document_evidence_country_code
  ON public.document_evidence (country_code);

-- ---------------------------------------------------------------------------
-- FK CIRCULARES (tablas creadas en migraciones posteriores)
-- ---------------------------------------------------------------------------
-- NOTA: Las siguientes FK se agregan cuando las tablas nom151_records y
-- blockchain_notarizations sean creadas en migraciones futuras.
--
-- ALTER TABLE documents
--   ADD CONSTRAINT fk_documents_nom151_constancia
--   FOREIGN KEY (nom151_constancia_id) REFERENCES nom151_records(id);
--
-- ALTER TABLE documents
--   ADD CONSTRAINT fk_documents_blockchain_tx
--   FOREIGN KEY (blockchain_tx_hash) REFERENCES blockchain_notarizations(tx_hash);

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: documents
-- ---------------------------------------------------------------------------
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

-- SELECT: miembros del workspace pueden ver documentos de su workspace
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'documents' AND policyname = 'documents_select_workspace_members'
  ) THEN
    CREATE POLICY documents_select_workspace_members
      ON public.documents FOR SELECT
      USING (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members
          WHERE user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- INSERT: solo service_role y el owner pueden crear documentos
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'documents' AND policyname = 'documents_insert_owner_or_service'
  ) THEN
    CREATE POLICY documents_insert_owner_or_service
      ON public.documents FOR INSERT
      WITH CHECK (
        auth.role() = 'service_role'
        OR owner_id = auth.uid()
      );
  END IF;
END $$;

-- UPDATE: solo service_role puede actualizar
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'documents' AND policyname = 'documents_update_service_role_only'
  ) THEN
    CREATE POLICY documents_update_service_role_only
      ON public.documents FOR UPDATE
      USING (auth.role() = 'service_role');
  END IF;
END $$;

-- DELETE: nadie puede hacer DELETE (solo soft delete via deleted_at)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'documents' AND policyname = 'documents_no_delete'
  ) THEN
    CREATE POLICY documents_no_delete
      ON public.documents FOR DELETE
      USING (FALSE);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: document_evidence
-- ---------------------------------------------------------------------------
ALTER TABLE public.document_evidence ENABLE ROW LEVEL SECURITY;

-- SELECT: usuarios con acceso al documento padre pueden ver la evidencia
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'document_evidence' AND policyname = 'evidence_select_document_access'
  ) THEN
    CREATE POLICY evidence_select_document_access
      ON public.document_evidence FOR SELECT
      USING (
        document_id IN (
          SELECT d.id FROM public.documents d
          JOIN workspace_members wm ON wm.workspace_id = d.workspace_id
          WHERE wm.user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- INSERT: solo service_role
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'document_evidence' AND policyname = 'evidence_insert_service_role_only'
  ) THEN
    CREATE POLICY evidence_insert_service_role_only
      ON public.document_evidence FOR INSERT
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- UPDATE: INMUTABLE — lanza excepción para cualquier rol
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'document_evidence' AND policyname = 'evidence_no_update'
  ) THEN
    CREATE POLICY evidence_no_update
      ON public.document_evidence FOR UPDATE
      USING (FALSE);
  END IF;
END $$;

-- DELETE: INMUTABLE — lanza excepción para cualquier rol
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'document_evidence' AND policyname = 'evidence_no_delete'
  ) THEN
    CREATE POLICY evidence_no_delete
      ON public.document_evidence FOR DELETE
      USING (FALSE);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- TRIGGER: updated_at automático en documents
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_documents_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_documents_updated_at ON public.documents;
CREATE TRIGGER trg_documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION update_documents_updated_at();

-- ---------------------------------------------------------------------------
-- TRIGGER: verificación de consistencia de hash en document_evidence
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION verify_evidence_hash_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_sha256_original CHAR(64);
BEGIN
  SELECT sha256_original INTO v_sha256_original
  FROM public.documents
  WHERE id = NEW.document_id;

  IF v_sha256_original IS NULL THEN
    RAISE EXCEPTION
      'Inconsistencia de hash: no se encontró el documento con id % para verificar la evidencia.',
      NEW.document_id;
  END IF;

  IF NEW.sha256_file_at_event <> v_sha256_original THEN
    RAISE EXCEPTION
      'Inconsistencia de hash detectada: el hash SHA-256 del archivo en la evidencia (%) '
      'no coincide con el hash original del documento (%). '
      'El archivo puede haber sido alterado antes de registrar la evidencia.',
      NEW.sha256_file_at_event, v_sha256_original;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_verify_evidence_hash ON public.document_evidence;
CREATE TRIGGER trg_verify_evidence_hash
  AFTER INSERT ON public.document_evidence
  FOR EACH ROW
  EXECUTE FUNCTION verify_evidence_hash_consistency();

-- ---------------------------------------------------------------------------
-- FUNCIÓN: get_document_with_evidence
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_document_with_evidence(p_document_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'document', row_to_json(d.*),
    'evidence', row_to_json(e.*)
  )
  INTO v_result
  FROM public.documents d
  LEFT JOIN public.document_evidence e ON e.document_id = d.id
  WHERE d.id = p_document_id;

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- COMENTARIOS: documents
-- ---------------------------------------------------------------------------
COMMENT ON TABLE public.documents IS
  'Registro principal de cada documento en la plataforma DOCUBOX. '
  'Controla el ciclo de vida completo, acredita integridad criptográfica y '
  'demuestra cumplimiento legal conforme al Código de Comercio Art. 49 y NOM-151-SCFI-2016.';

COMMENT ON COLUMN public.documents.id IS 'Identificador único del documento (UUID v4).';
COMMENT ON COLUMN public.documents.workspace_id IS 'Workspace al que pertenece el documento. No se puede eliminar el workspace si tiene documentos.';
COMMENT ON COLUMN public.documents.owner_id IS 'Usuario propietario del documento. No se puede eliminar el usuario si tiene documentos.';
COMMENT ON COLUMN public.documents.title IS 'Título del documento. Entre 1 y 500 caracteres.';
COMMENT ON COLUMN public.documents.description IS 'Descripción opcional del documento.';
COMMENT ON COLUMN public.documents.document_type IS 'Tipo de documento: contrato, factura, poder_notarial, addendum, convenio, carta_responsiva, pagare, otro.';
COMMENT ON COLUMN public.documents.status IS 'Estado del ciclo de vida: borrador, pendiente, en_proceso, completado, vencido, cancelado, anulado, en_disputa.';
COMMENT ON COLUMN public.documents.sha256_original IS 'Hash SHA-256 del archivo en crudo antes de cualquier procesamiento. Ancla criptográfica del valor probatorio.';
COMMENT ON COLUMN public.documents.sha256_signed IS 'Hash SHA-256 del PDF final con todas las firmas aplicadas. NULL hasta que el documento esté completado.';
COMMENT ON COLUMN public.documents.sha256_metadata_package IS 'Hash SHA-256 del paquete de metadatos JSON del documento al crearse.';
COMMENT ON COLUMN public.documents.storage_path_encrypted IS 'Ruta cifrada AES-256 en Cloudflare R2 donde se almacena el archivo.';
COMMENT ON COLUMN public.documents.storage_bucket IS 'Nombre del bucket de almacenamiento en Cloudflare R2.';
COMMENT ON COLUMN public.documents.file_size_bytes IS 'Tamaño del archivo en bytes. Debe ser mayor a 0.';
COMMENT ON COLUMN public.documents.mime_type IS 'Tipo MIME del archivo: PDF, Word (.doc) o Word moderno (.docx).';
COMMENT ON COLUMN public.documents.page_count IS 'Número de páginas del documento. NULL si no aplica.';
COMMENT ON COLUMN public.documents.signing_mode IS 'Modo de firma: secuencial (uno a la vez), paralelo (todos al mismo tiempo), mixto.';
COMMENT ON COLUMN public.documents.signing_order IS 'Lista ordenada de objetos {signer_id, role, order_index, status} que define el orden de firma.';
COMMENT ON COLUMN public.documents.require_otp IS 'Si se requiere OTP para verificar la identidad del firmante.';
COMMENT ON COLUMN public.documents.require_geolocation IS 'Si se requiere geolocalización del firmante al momento de firmar.';
COMMENT ON COLUMN public.documents.require_device_fingerprint IS 'Si se requiere huella de dispositivo del firmante.';
COMMENT ON COLUMN public.documents.allow_delegation IS 'Si se permite delegar la firma a otro usuario.';
COMMENT ON COLUMN public.documents.max_attempts_per_signer IS 'Número máximo de intentos de firma por firmante (1-10).';
COMMENT ON COLUMN public.documents.notify_on_view IS 'Si se notifica al propietario cuando un participante abre el documento.';
COMMENT ON COLUMN public.documents.notify_on_sign IS 'Si se notifica al propietario cuando un participante firma.';
COMMENT ON COLUMN public.documents.notify_channels IS 'Canales de notificación habilitados: email, whatsapp, sms.';
COMMENT ON COLUMN public.documents.expires_at IS 'Fecha y hora de vencimiento del documento. Debe ser posterior a created_at.';
COMMENT ON COLUMN public.documents.reminder_sent_at IS 'Timestamp del último recordatorio enviado a los participantes.';
COMMENT ON COLUMN public.documents.first_viewed_at IS 'Timestamp de la primera vez que el documento fue abierto por un participante.';
COMMENT ON COLUMN public.documents.first_signed_at IS 'Timestamp de la primera firma aplicada al documento.';
COMMENT ON COLUMN public.documents.completed_at IS 'Timestamp en que el documento fue completado (todas las firmas requeridas aplicadas).';
COMMENT ON COLUMN public.documents.voided_at IS 'Timestamp en que el documento fue anulado.';
COMMENT ON COLUMN public.documents.voided_by IS 'Usuario que anuló el documento.';
COMMENT ON COLUMN public.documents.voided_reason IS 'Razón de la anulación del documento.';
COMMENT ON COLUMN public.documents.created_at IS 'Timestamp de creación del documento en UTC.';
COMMENT ON COLUMN public.documents.updated_at IS 'Timestamp de la última actualización. Actualizado automáticamente por trigger.';
COMMENT ON COLUMN public.documents.deleted_at IS 'Soft delete: timestamp de eliminación lógica. Nunca se borra físicamente.';
COMMENT ON COLUMN public.documents.legal_framework IS 'Marco legal aplicable: codigo_comercio_art49, nom151, etc.';
COMMENT ON COLUMN public.documents.retention_years IS 'Años de retención del documento (5-99). Por defecto 10 años.';
COMMENT ON COLUMN public.documents.custodian_id IS 'Usuario responsable legal de la custodia del documento.';
COMMENT ON COLUMN public.documents.plan_tier IS 'Nivel del plan de suscripción: basic, pro, enterprise.';
COMMENT ON COLUMN public.documents.is_legally_executed IS 'TRUE cuando todas las firmas requeridas están completas y el documento tiene plena validez legal.';
COMMENT ON COLUMN public.documents.probatory_value_confirmed_at IS 'Timestamp en que el sistema confirma que el documento tiene valor probatorio pleno.';
COMMENT ON COLUMN public.documents.nom151_constancia_id IS 'FK a la tabla nom151_records (se agrega en migración posterior).';
COMMENT ON COLUMN public.documents.blockchain_tx_hash IS 'FK a la tabla blockchain_notarizations (se agrega en migración posterior).';

-- ---------------------------------------------------------------------------
-- COMENTARIOS: document_evidence
-- ---------------------------------------------------------------------------
COMMENT ON TABLE public.document_evidence IS
  'Contexto forense completo del momento exacto en que el documento fue cargado/creado. '
  'INMUTABLE: ningún rol puede hacer UPDATE ni DELETE. Relación 1:1 con documents. '
  'Valor probatorio directo bajo Art. 49 del Código de Comercio y NOM-151-SCFI-2016.';

COMMENT ON COLUMN public.document_evidence.id IS 'Identificador único del registro de evidencia (UUID v4).';
COMMENT ON COLUMN public.document_evidence.document_id IS 'FK al documento padre. Relación 1:1 garantizada por UNIQUE.';
COMMENT ON COLUMN public.document_evidence.ip_address IS 'Dirección IP del cliente al momento de cargar el documento.';
COMMENT ON COLUMN public.document_evidence.ip_version IS 'Versión del protocolo IP: ipv4 o ipv6.';
COMMENT ON COLUMN public.document_evidence.isp IS 'Proveedor de servicios de internet del cliente.';
COMMENT ON COLUMN public.document_evidence.asn IS 'Número de sistema autónomo para identificar redes corporativas.';
COMMENT ON COLUMN public.document_evidence.vpn_detected IS 'TRUE si se detectó uso de VPN.';
COMMENT ON COLUMN public.document_evidence.proxy_detected IS 'TRUE si se detectó uso de proxy.';
COMMENT ON COLUMN public.document_evidence.tor_detected IS 'TRUE si se detectó uso de la red Tor.';
COMMENT ON COLUMN public.document_evidence.maxmind_risk_score IS 'Puntuación de riesgo de MaxMind (0-100). Mayor valor = mayor riesgo.';
COMMENT ON COLUMN public.document_evidence.maxmind_connection_type IS 'Tipo de conexión según MaxMind: Cable/DSL, Corporate, Cellular, etc.';
COMMENT ON COLUMN public.document_evidence.user_agent IS 'Cadena User-Agent completa del navegador del cliente.';
COMMENT ON COLUMN public.document_evidence.user_agent_parsed IS 'Objeto JSON con browser, os y device parseados por el backend.';
COMMENT ON COLUMN public.document_evidence.device_fingerprint IS 'Hash de la huella de dispositivo del navegador.';
COMMENT ON COLUMN public.document_evidence.device_type IS 'Tipo de dispositivo: escritorio, movil, tablet, servidor, desconocido.';
COMMENT ON COLUMN public.document_evidence.os_name IS 'Nombre del sistema operativo del cliente.';
COMMENT ON COLUMN public.document_evidence.os_version IS 'Versión del sistema operativo del cliente.';
COMMENT ON COLUMN public.document_evidence.browser_name IS 'Nombre del navegador del cliente.';
COMMENT ON COLUMN public.document_evidence.browser_version IS 'Versión del navegador del cliente.';
COMMENT ON COLUMN public.document_evidence.screen_resolution IS 'Resolución de pantalla del cliente, ej: 1920x1080.';
COMMENT ON COLUMN public.document_evidence.timezone_client IS 'Zona horaria reportada por el navegador del cliente.';
COMMENT ON COLUMN public.document_evidence.latitude IS 'Latitud geográfica del cliente (-90 a 90).';
COMMENT ON COLUMN public.document_evidence.longitude IS 'Longitud geográfica del cliente (-180 a 180).';
COMMENT ON COLUMN public.document_evidence.geolocation_accuracy_meters IS 'Precisión de la geolocalización en metros.';
COMMENT ON COLUMN public.document_evidence.geolocation_source IS 'Fuente de la geolocalización: gps, network, ip_fallback, manual, no_disponible.';
COMMENT ON COLUMN public.document_evidence.geocoded_address IS 'Dirección legible resultado del geocodificado inverso con OpenCage.';
COMMENT ON COLUMN public.document_evidence.country_code IS 'Código de país ISO 3166-1 alpha-2.';
COMMENT ON COLUMN public.document_evidence.state_province IS 'Estado o provincia del cliente.';
COMMENT ON COLUMN public.document_evidence.city IS 'Ciudad del cliente.';
COMMENT ON COLUMN public.document_evidence.postal_code IS 'Código postal del cliente.';
COMMENT ON COLUMN public.document_evidence.timezone_geocoded IS 'Zona horaria de la ubicación física del cliente.';
COMMENT ON COLUMN public.document_evidence.opencage_response_encrypted IS 'Respuesta completa de OpenCage cifrada AES-256.';
COMMENT ON COLUMN public.document_evidence.sha256_file_at_event IS 'Hash SHA-256 del archivo al momento del evento. Debe coincidir con documents.sha256_original.';
COMMENT ON COLUMN public.document_evidence.sha256_metadata_at_event IS 'Hash SHA-256 de los metadatos del documento al momento del evento.';
COMMENT ON COLUMN public.document_evidence.server_received_at IS 'Timestamp del servidor (no del cliente) en UTC cuando se recibió el archivo.';
COMMENT ON COLUMN public.document_evidence.nom151_timestamp_token IS 'Token RFC 3161 en base64 emitido por PSC acreditado bajo NOM-151.';
COMMENT ON COLUMN public.document_evidence.nom151_provider IS 'Proveedor del sellado de tiempo NOM-151: cincel, mifiel, verificamex, incode, seguridata.';
COMMENT ON COLUMN public.document_evidence.rfc3161_time IS 'Timestamp extraído del token RFC 3161.';
COMMENT ON COLUMN public.document_evidence.upload_channel IS 'Canal por el que se cargó el documento: web, api, movil, importacion.';
COMMENT ON COLUMN public.document_evidence.session_id IS 'ID de sesión del usuario al momento del upload.';
COMMENT ON COLUMN public.document_evidence.workspace_ip_policy_passed IS 'TRUE si la IP del cliente pasó la política de IP del workspace.';
COMMENT ON COLUMN public.document_evidence.legal_notice_shown_at IS 'Timestamp en que se mostró el aviso legal al usuario.';
COMMENT ON COLUMN public.document_evidence.legal_notice_version IS 'Versión del aviso legal aceptado por el usuario.';
COMMENT ON COLUMN public.document_evidence.terms_accepted IS 'TRUE si el usuario aceptó los términos y condiciones.';
COMMENT ON COLUMN public.document_evidence.terms_accepted_at IS 'Timestamp en que el usuario aceptó los términos.';
COMMENT ON COLUMN public.document_evidence.recorded_at IS 'Timestamp del servidor en UTC cuando se registró la evidencia.';

-- ---------------------------------------------------------------------------
-- VERIFICACIÓN FINAL
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  RAISE NOTICE '=== VERIFICACIÓN 001_docubox_documents_and_evidence ===';
END $$;

SELECT
  'documents' AS tabla,
  COUNT(*) AS columnas
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'documents';

SELECT
  'document_evidence' AS tabla,
  COUNT(*) AS columnas
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'document_evidence';

SELECT
  tablename,
  policyname,
  cmd
FROM pg_policies
WHERE tablename IN ('documents', 'document_evidence')
ORDER BY tablename, policyname;

SELECT
  indexname,
  tablename
FROM pg_indexes
WHERE tablename IN ('documents', 'document_evidence')
ORDER BY tablename, indexname;

SELECT
  routine_name,
  routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'update_documents_updated_at',
    'verify_evidence_hash_consistency',
    'get_document_with_evidence'
  );
