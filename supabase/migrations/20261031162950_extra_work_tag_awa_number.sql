-- Digital extra work tags are numbered AWA-{job}-0001.
-- AWA stands for additional work authorization.
-- The count continues from numbers already used on that job, including 001, 224, and 1058-EWO0230.
-- A scanned form number such as 22463 stays on the paper work order and does not set the next tag.

CREATE OR REPLACE FUNCTION public.next_extra_work_tag_number(p_job_number text)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  clean text;
  ewo_prefix text;
  awa_prefix text;
  v_tag text;
  v_rest text;
  v_n integer;
  v_max integer := 0;
BEGIN
  clean := public.field_tools_po_normalize_job_code(p_job_number);
  ewo_prefix := upper(clean) || '-EWO';
  awa_prefix := 'AWA-' || upper(clean) || '-';
  PERFORM pg_advisory_xact_lock(hashtext('ewo-seq:' || upper(clean)));

  FOR v_n IN
    SELECT NULLIF(tag_number, '')::int
    FROM public.field_tools_extra_work_tags
    WHERE upper(public.field_tools_po_normalize_job_code(job_number)) = upper(clean)
      AND tag_number ~ '^[0-9]+$'
    UNION ALL
    SELECT NULLIF(trim(w.ewo_number), '')::int
    FROM public.work_orders w
    JOIN public.projects p ON p.id = w.project_id
    WHERE upper(public.field_tools_po_normalize_job_code(p.job_number)) = upper(clean)
      AND trim(w.ewo_number) ~ '^[0-9]{1,4}$'
  LOOP
    IF v_n IS NOT NULL AND v_n > v_max THEN
      v_max := v_n;
    END IF;
  END LOOP;

  FOR v_tag IN
    SELECT upper(trim(tag_number))
    FROM public.field_tools_extra_work_tags
    WHERE upper(public.field_tools_po_normalize_job_code(job_number)) = upper(clean)
  LOOP
    IF left(v_tag, length(ewo_prefix)) = ewo_prefix THEN
      v_rest := substr(v_tag, length(ewo_prefix) + 1);
    ELSIF left(v_tag, length(awa_prefix)) = awa_prefix THEN
      v_rest := substr(v_tag, length(awa_prefix) + 1);
    ELSE
      CONTINUE;
    END IF;
    IF v_rest !~ '^[0-9]+$' THEN
      CONTINUE;
    END IF;
    v_n := v_rest::int;
    IF v_n > v_max THEN
      v_max := v_n;
    END IF;
  END LOOP;

  RETURN 'AWA-' || clean || '-' || lpad((v_max + 1)::text, 4, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.next_extra_work_tag_number(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_extra_work_tag_number(text) TO authenticated;

-- Paper work orders stay 001, 002. Their count includes AWA-{job}-0001 and older {job}-EWO0001 numbers.
CREATE OR REPLACE FUNCTION public.next_ewo_number(p_project_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  clean text;
  v_tag text;
  v_rest text;
  ewo_mark text := '-EWO';
  v_max int := 0;
  v_n int;
  v_pos int;
BEGIN
  IF p_project_id IS NULL THEN
    RETURN '001';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_approved_user(auth.uid()) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  SELECT public.field_tools_po_normalize_job_code(job_number) INTO clean
  FROM public.projects
  WHERE id = p_project_id;
  PERFORM pg_advisory_xact_lock(hashtext('ewo-seq:' || upper(coalesce(nullif(clean, ''), p_project_id::text))));

  FOR v_n IN
    SELECT NULLIF(regexp_replace(ewo_number, '[^0-9]', '', 'g'), '')::int
    FROM public.work_orders
    WHERE project_id = p_project_id
    UNION ALL
    SELECT NULLIF(tag_number, '')::int
    FROM public.field_tools_extra_work_tags
    WHERE project_id = p_project_id
      AND tag_number ~ '^[0-9]+$'
  LOOP
    IF v_n IS NOT NULL AND v_n > v_max THEN
      v_max := v_n;
    END IF;
  END LOOP;

  FOR v_tag IN
    SELECT upper(trim(tag_number))
    FROM public.field_tools_extra_work_tags
    WHERE project_id = p_project_id
  LOOP
    v_pos := position(ewo_mark IN v_tag);
    IF v_pos > 0 THEN
      v_rest := substr(v_tag, v_pos + length(ewo_mark));
    ELSIF v_tag ~ '^AWA-.+-[0-9]+$' THEN
      v_rest := regexp_replace(v_tag, '^AWA-.*-', '');
    ELSE
      CONTINUE;
    END IF;
    IF v_rest !~ '^[0-9]+$' THEN
      CONTINUE;
    END IF;
    v_n := v_rest::int;
    IF v_n > v_max THEN
      v_max := v_n;
    END IF;
  END LOOP;

  RETURN pg_catalog.lpad((v_max + 1)::text, 3, '0');
END;
$$;

DROP FUNCTION IF EXISTS public.extra_work_issued_seq(uuid);

NOTIFY pgrst, 'reload schema';
