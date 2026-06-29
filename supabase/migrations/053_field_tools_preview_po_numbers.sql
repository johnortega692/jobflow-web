-- Field Tools: read-only PO preview (does not advance sequence)

CREATE OR REPLACE FUNCTION public.field_tools_preview_po_numbers(p_job_code text, p_count integer DEFAULT 1)
RETURNS text[]
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
  i integer;
  n integer;
  out text[] := '{}';
BEGIN
  n := greatest(coalesce(p_count, 1), 0);
  IF n = 0 THEN
    RETURN out;
  END IF;

  clean := public.field_tools_po_normalize_job_code(p_job_code);

  SELECT coalesce(s.po_seq_digits, 3) INTO digits
  FROM public.field_tools_order_settings s
  WHERE s.id = 1;

  highest := public.field_tools_po_highest_issued(clean);

  SELECT j.next_seq INTO admin_next
  FROM public.field_tools_po_job_sequences j
  WHERE j.job_code = clean;

  IF admin_next IS NOT NULL THEN
    seq := greatest(admin_next, highest + 1);
  ELSE
    seq := highest + 1;
  END IF;

  FOR i IN 0..(n - 1) LOOP
    out := array_append(out, clean || '-' || lpad((seq + i)::text, digits, '0'));
  END LOOP;

  RETURN out;
END;
$$;

GRANT EXECUTE ON FUNCTION public.field_tools_preview_po_numbers(text, integer) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
