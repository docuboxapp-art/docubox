-- Historical participants were intentionally seeded into the stable reference
-- bridge without rewriting documentos.participantes. Atomic completion requires
-- the reference in both places, so add it without changing workflow state or the
-- user-visible document modification timestamp.

CREATE TEMP TABLE docubox_participant_reference_backfill_dates ON COMMIT DROP AS
SELECT document.id, document.updated_at
FROM public.documentos document
WHERE jsonb_typeof(document.participantes) = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(document.participantes) participant
    WHERE COALESCE(participant ->> 'participant_ref_id', '')
      !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );

ALTER TABLE public.documentos DISABLE TRIGGER documentos_updated_at;
ALTER TABLE public.documentos DISABLE TRIGGER enforce_atomic_participant_completion;

WITH rebuilt AS (
  SELECT
    document.id,
    jsonb_agg(
      CASE
        WHEN COALESCE(item.participant ->> 'participant_ref_id', '')
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          THEN item.participant
        WHEN participant_reference.id IS NOT NULL
          THEN jsonb_set(
            item.participant,
            '{participant_ref_id}',
            to_jsonb(participant_reference.id::TEXT),
            true
          )
        ELSE item.participant
      END
      ORDER BY item.ordinality
    ) AS participantes
  FROM public.documentos document
  CROSS JOIN LATERAL jsonb_array_elements(document.participantes)
    WITH ORDINALITY AS item(participant, ordinality)
  LEFT JOIN LATERAL (
    SELECT reference.id
    FROM public.document_participant_references reference
    WHERE reference.document_id = document.id
      AND reference.active = true
      AND (
        (
          NULLIF(item.participant ->> 'id', '') IS NOT NULL
          AND reference.participant_json_id = item.participant ->> 'id'
        )
        OR (
          COALESCE(item.participant ->> 'user_id', '')
            ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          AND reference.participant_user_id::TEXT = item.participant ->> 'user_id'
        )
        OR (
          NULLIF(lower(trim(item.participant ->> 'email')), '') IS NOT NULL
          AND reference.participant_email_normalized = lower(trim(item.participant ->> 'email'))
        )
        OR reference.ordinal = item.ordinality - 1
      )
    ORDER BY
      CASE
        WHEN reference.participant_json_id = item.participant ->> 'id' THEN 0
        WHEN reference.participant_user_id::TEXT = item.participant ->> 'user_id' THEN 1
        WHEN reference.participant_email_normalized = lower(trim(item.participant ->> 'email')) THEN 2
        ELSE 3
      END,
      reference.first_seen_at
    LIMIT 1
  ) participant_reference ON true
  WHERE jsonb_typeof(document.participantes) = 'array'
  GROUP BY document.id
)
UPDATE public.documentos document
SET participantes = rebuilt.participantes
FROM rebuilt
WHERE document.id = rebuilt.id
  AND document.participantes IS DISTINCT FROM rebuilt.participantes;

UPDATE public.documentos document
SET updated_at = original.updated_at
FROM docubox_participant_reference_backfill_dates original
WHERE document.id = original.id;

ALTER TABLE public.documentos ENABLE TRIGGER enforce_atomic_participant_completion;
ALTER TABLE public.documentos ENABLE TRIGGER documentos_updated_at;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.documentos document
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(document.participantes) = 'array' THEN document.participantes
        ELSE '[]'::JSONB
      END
    ) participant
    JOIN public.document_participant_references reference
      ON reference.document_id = document.id
     AND reference.active = true
     AND (
       reference.participant_json_id = participant ->> 'id'
       OR reference.participant_user_id::TEXT = participant ->> 'user_id'
       OR reference.participant_email_normalized = lower(trim(participant ->> 'email'))
     )
    WHERE COALESCE(participant ->> 'participant_ref_id', '')
      !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) THEN
    RAISE EXCEPTION 'HISTORICAL_PARTICIPANT_REFERENCE_BACKFILL_INCOMPLETE';
  END IF;
END $$;
