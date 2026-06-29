-- Field Tools: admin PO sequence settings (per job + global digit padding)

ALTER TABLE public.field_tools_order_settings
  ADD COLUMN IF NOT EXISTS po_seq_digits smallint NOT NULL DEFAULT 3
    CHECK (po_seq_digits >= 1 AND po_seq_digits <= 6);

CREATE TABLE IF NOT EXISTS public.field_tools_po_job_sequences (
  job_code text PRIMARY KEY,
  next_seq integer NOT NULL CHECK (next_seq >= 1),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.field_tools_po_job_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS field_tools_po_job_sequences_deny_anon ON public.field_tools_po_job_sequences;
CREATE POLICY field_tools_po_job_sequences_deny_anon ON public.field_tools_po_job_sequences
  FOR ALL TO anon USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.field_tools_po_normalize_job_code(p_job_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(nullif(split_part(trim(coalesce(p_job_code, '')), ' ', 1), ''), 'JOB');
$$;

CREATE OR REPLACE FUNCTION public.field_tools_po_highest_issued(p_clean_code text)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  highest integer := 0;
  r record;
  parts text[];
  seq integer;
  last_part text;
BEGIN
  FOR r IN
    SELECT po_number AS num FROM public.field_tools_order_dispatches WHERE po_number <> ''
    UNION ALL
    SELECT po_number AS num FROM public.field_tools_orders WHERE po_number <> ''
  LOOP
    IF r.num LIKE p_clean_code || '-%' THEN
      parts := string_to_array(r.num, '-');
      IF array_length(parts, 1) >= 2 THEN
        last_part := parts[array_length(parts, 1)];
        seq := NULLIF(regexp_replace(last_part, '[^0-9]', '', 'g'), '')::integer;
        IF seq IS NOT NULL AND seq > highest THEN
          highest := seq;
        END IF;
      END IF;
    END IF;
  END LOOP;
  RETURN highest;
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_next_po_number(p_job_code text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  clean text;
  digits integer;
  highest integer;
  admin_next integer;
  seq integer;
BEGIN
  clean := public.field_tools_po_normalize_job_code(p_job_code);

  SELECT coalesce(s.po_seq_digits, 3) INTO digits
  FROM public.field_tools_order_settings s
  WHERE s.id = 1;

  highest := public.field_tools_po_highest_issued(clean);

  SELECT j.next_seq INTO admin_next
  FROM public.field_tools_po_job_sequences j
  WHERE j.job_code = clean
  FOR UPDATE;

  IF admin_next IS NOT NULL THEN
    seq := greatest(admin_next, highest + 1);
  ELSE
    seq := highest + 1;
  END IF;

  INSERT INTO public.field_tools_po_job_sequences (job_code, next_seq, updated_at)
  VALUES (clean, seq + 1, now())
  ON CONFLICT (job_code) DO UPDATE SET
    next_seq = EXCLUDED.next_seq,
    updated_at = now();

  RETURN clean || '-' || lpad(seq::text, digits, '0');
END;
$$;

DROP FUNCTION IF EXISTS public.field_tools_admin_upsert_order_settings(uuid, text, text);

CREATE OR REPLACE FUNCTION public.field_tools_admin_get_order_settings(p_caller_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id);
  RETURN jsonb_build_object(
    'ok', true,
    'settings', (
      SELECT jsonb_build_object(
        'warehouse_email', coalesce(s.warehouse_email, ''),
        'global_cc_emails', coalesce(s.global_cc_emails, ''),
        'po_seq_digits', coalesce(s.po_seq_digits, 3),
        'updated_at', s.updated_at
      )
      FROM public.field_tools_order_settings s
      WHERE s.id = 1
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_upsert_order_settings(
  p_caller_id uuid,
  p_warehouse_email text,
  p_global_cc_emails text DEFAULT '',
  p_po_seq_digits integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  warehouse text := lower(trim(coalesce(p_warehouse_email, '')));
  global_raw text := trim(coalesce(p_global_cc_emails, ''));
  global_norm text := '';
  part text;
  parts text[];
  i int;
  digits smallint;
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id);

  IF warehouse <> '' AND warehouse !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Enter a valid warehouse email address.');
  END IF;

  IF global_raw <> '' THEN
    parts := regexp_split_to_array(global_raw, '[,;]');
    FOR i IN 1..coalesce(array_length(parts, 1), 0) LOOP
      part := lower(trim(parts[i]));
      IF part = '' THEN
        CONTINUE;
      END IF;
      IF part !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Enter valid email addresses for Always CC (comma-separated).');
      END IF;
      IF global_norm <> '' THEN
        global_norm := global_norm || ',';
      END IF;
      global_norm := global_norm || part;
    END LOOP;
  END IF;

  digits := coalesce(p_po_seq_digits, (SELECT po_seq_digits FROM public.field_tools_order_settings WHERE id = 1), 3);
  IF digits < 1 OR digits > 6 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PO sequence digits must be between 1 and 6.');
  END IF;

  INSERT INTO public.field_tools_order_settings (id, warehouse_email, global_cc_emails, po_seq_digits, updated_at)
  VALUES (1, warehouse, global_norm, digits, now())
  ON CONFLICT (id) DO UPDATE SET
    warehouse_email = EXCLUDED.warehouse_email,
    global_cc_emails = EXCLUDED.global_cc_emails,
    po_seq_digits = EXCLUDED.po_seq_digits,
    updated_at = now();

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_list_po_sequences(p_caller_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id);
  RETURN jsonb_build_object(
    'ok', true,
    'sequences', (
      WITH codes AS (
        SELECT job_code FROM public.field_tools_po_job_sequences
        UNION
        SELECT DISTINCT public.field_tools_po_normalize_job_code(o.job_number)
        FROM public.field_tools_orders o
        WHERE trim(coalesce(o.job_number, '')) <> ''
      )
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'job_code', c.job_code,
        'highest_issued', public.field_tools_po_highest_issued(c.job_code),
        'next_seq', coalesce(
          j.next_seq,
          public.field_tools_po_highest_issued(c.job_code) + 1
        ),
        'has_override', j.job_code IS NOT NULL,
        'updated_at', j.updated_at
      ) ORDER BY c.job_code), '[]'::jsonb)
      FROM codes c
      LEFT JOIN public.field_tools_po_job_sequences j ON j.job_code = c.job_code
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_upsert_po_job_sequence(
  p_caller_id uuid,
  p_job_code text,
  p_next_seq integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  clean text;
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id);

  clean := public.field_tools_po_normalize_job_code(p_job_code);
  IF clean = 'JOB' AND trim(coalesce(p_job_code, '')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Job code is required.');
  END IF;

  IF p_next_seq IS NULL OR p_next_seq < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Next sequence must be at least 1.');
  END IF;

  IF p_next_seq <= public.field_tools_po_highest_issued(clean) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error',
      format('Next sequence must be greater than highest issued (%s).', public.field_tools_po_highest_issued(clean))
    );
  END IF;

  INSERT INTO public.field_tools_po_job_sequences (job_code, next_seq, updated_at)
  VALUES (clean, p_next_seq, now())
  ON CONFLICT (job_code) DO UPDATE SET
    next_seq = EXCLUDED.next_seq,
    updated_at = now();

  RETURN jsonb_build_object('ok', true, 'job_code', clean, 'next_seq', p_next_seq);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_delete_po_job_sequence(
  p_caller_id uuid,
  p_job_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  clean text;
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id);
  clean := public.field_tools_po_normalize_job_code(p_job_code);
  DELETE FROM public.field_tools_po_job_sequences WHERE job_code = clean;
  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.field_tools_admin_upsert_order_settings(uuid, text, text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_list_po_sequences(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_upsert_po_job_sequence(uuid, text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_delete_po_job_sequence(uuid, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
