-- JobFlow Material Orders: shared PO sequence with Field Tools + issued-PO log for tracker

CREATE TABLE IF NOT EXISTS public.jobflow_material_order_pos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
  job_number text NOT NULL DEFAULT '',
  job_name text NOT NULL DEFAULT '',
  po_number text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('wallcovering', 'frp', 'fwp')),
  vendor_label text NOT NULL DEFAULT '',
  delivery_address text NOT NULL DEFAULT '',
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_by_name text NOT NULL DEFAULT '',
  received_field boolean NOT NULL DEFAULT false,
  completed boolean NOT NULL DEFAULT false,
  tracking_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS jobflow_material_order_pos_po_uidx
  ON public.jobflow_material_order_pos (po_number);

CREATE INDEX IF NOT EXISTS jobflow_material_order_pos_project_idx
  ON public.jobflow_material_order_pos (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS jobflow_material_order_pos_job_idx
  ON public.jobflow_material_order_pos (job_number);

ALTER TABLE public.jobflow_material_order_pos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jobflow_material_order_pos_authenticated_all ON public.jobflow_material_order_pos;
CREATE POLICY jobflow_material_order_pos_authenticated_all ON public.jobflow_material_order_pos
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- Include JobFlow material POs in shared highest-issued scan
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
    UNION ALL
    SELECT po_number AS num FROM public.jobflow_material_order_pos WHERE po_number <> ''
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

-- Preview next PO without allocating (JobFlow UI)
CREATE OR REPLACE FUNCTION public.jobflow_preview_next_po_number(p_job_code text)
RETURNS text
LANGUAGE plpgsql
STABLE
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

  IF digits IS NULL THEN
    digits := 3;
  END IF;

  highest := public.field_tools_po_highest_issued(clean);

  SELECT j.next_seq INTO admin_next
  FROM public.field_tools_po_job_sequences j
  WHERE j.job_code = clean;

  IF admin_next IS NOT NULL THEN
    seq := greatest(admin_next, highest + 1);
  ELSE
    seq := highest + 1;
  END IF;

  RETURN clean || '-' || lpad(seq::text, digits, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.jobflow_preview_next_po_number(text) TO authenticated, service_role;

-- When a manual PO is used, bump the shared sequence past it
CREATE OR REPLACE FUNCTION public.jobflow_ensure_po_sequence_past(p_job_code text, p_po_number text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  clean text;
  parts text[];
  last_part text;
  seq integer;
  next_needed integer;
BEGIN
  clean := public.field_tools_po_normalize_job_code(p_job_code);
  IF p_po_number IS NULL OR trim(p_po_number) = '' THEN
    RETURN;
  END IF;

  parts := string_to_array(trim(p_po_number), '-');
  IF array_length(parts, 1) < 2 THEN
    RETURN;
  END IF;

  last_part := parts[array_length(parts, 1)];
  seq := NULLIF(regexp_replace(last_part, '[^0-9]', '', 'g'), '')::integer;
  IF seq IS NULL THEN
    RETURN;
  END IF;

  next_needed := seq + 1;

  INSERT INTO public.field_tools_po_job_sequences (job_code, next_seq, updated_at)
  VALUES (clean, next_needed, now())
  ON CONFLICT (job_code) DO UPDATE SET
    next_seq = greatest(public.field_tools_po_job_sequences.next_seq, EXCLUDED.next_seq),
    updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.jobflow_ensure_po_sequence_past(text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
