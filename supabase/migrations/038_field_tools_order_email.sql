-- Field Tools: Supabase-owned orders/POs; GAS is email-only

ALTER TABLE public.field_tools_orders
  ADD COLUMN IF NOT EXISTS job_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS po_number text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS email_status text NOT NULL DEFAULT 'pending'
    CHECK (email_status IN ('pending', 'partial', 'sent', 'failed'));

CREATE TABLE IF NOT EXISTS public.field_tools_order_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.field_tools_orders (id) ON DELETE CASCADE,
  dispatch_type text NOT NULL CHECK (dispatch_type IN (
    'material', 'rental', 'equipment', 'wallcovering', 'haul_off', 'job_scope_kit'
  )),
  po_number text NOT NULL DEFAULT '',
  to_email text NOT NULL DEFAULT '',
  cc_emails text NOT NULL DEFAULT '',
  subject text NOT NULL DEFAULT '',
  email_status text NOT NULL DEFAULT 'pending'
    CHECK (email_status IN ('pending', 'sent', 'failed', 'skipped')),
  gas_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  emailed_at timestamptz
);

CREATE INDEX IF NOT EXISTS field_tools_order_dispatches_order_idx
  ON public.field_tools_order_dispatches (order_id);

ALTER TABLE public.field_tools_order_dispatches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS field_tools_order_dispatches_anon_all ON public.field_tools_order_dispatches;
CREATE POLICY field_tools_order_dispatches_anon_all ON public.field_tools_order_dispatches
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Next PO: {job_code}-{seq} e.g. 1097-001
CREATE OR REPLACE FUNCTION public.field_tools_next_po_number(p_job_code text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  clean text;
  highest integer := 0;
  r record;
  parts text[];
  seq integer;
  last_part text;
BEGIN
  clean := split_part(trim(coalesce(p_job_code, '')), ' ', 1);
  IF clean = '' THEN
    clean := 'JOB';
  END IF;

  FOR r IN
    SELECT po_number AS num FROM public.field_tools_order_dispatches WHERE po_number <> ''
    UNION ALL
    SELECT po_number AS num FROM public.field_tools_orders WHERE po_number <> ''
  LOOP
    IF r.num LIKE clean || '-%' THEN
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

  RETURN clean || '-' || lpad((highest + 1)::text, 3, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.field_tools_next_po_number(text) TO anon, authenticated, service_role;

-- Recompute order-level email_status from dispatches
CREATE OR REPLACE FUNCTION public.field_tools_refresh_order_email_status(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total integer;
  sent integer;
  failed integer;
BEGIN
  SELECT count(*)::integer,
         count(*) FILTER (WHERE email_status = 'sent')::integer,
         count(*) FILTER (WHERE email_status = 'failed')::integer
  INTO total, sent, failed
  FROM public.field_tools_order_dispatches
  WHERE order_id = p_order_id;

  IF total = 0 THEN
    UPDATE public.field_tools_orders SET email_status = 'pending' WHERE id = p_order_id;
  ELSIF failed > 0 AND sent = 0 THEN
    UPDATE public.field_tools_orders SET email_status = 'failed' WHERE id = p_order_id;
  ELSIF sent = total THEN
    UPDATE public.field_tools_orders
    SET email_status = 'sent', status = 'confirmed'
    WHERE id = p_order_id;
  ELSE
    UPDATE public.field_tools_orders SET email_status = 'partial' WHERE id = p_order_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.field_tools_refresh_order_email_status(uuid) TO service_role;
