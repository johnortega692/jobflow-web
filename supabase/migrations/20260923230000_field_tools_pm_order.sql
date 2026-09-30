-- PM Order: assign a PO and download the PDF with no vendor email.

alter table public.field_tools_orders
  drop constraint if exists field_tools_orders_order_type_check;

alter table public.field_tools_orders
  add constraint field_tools_orders_order_type_check
  check (order_type = any (array[
    'field_request'::text,
    'job_scope_kit'::text,
    'last_min'::text,
    'haul_off'::text,
    'pm_order'::text
  ]));

alter table public.field_tools_orders
  drop constraint if exists field_tools_orders_email_status_check;

alter table public.field_tools_orders
  add constraint field_tools_orders_email_status_check
  check (email_status = any (array[
    'pending'::text,
    'partial'::text,
    'sent'::text,
    'failed'::text,
    'skipped'::text
  ]));

CREATE OR REPLACE FUNCTION public.field_tools_sanitize_profile_modules(p_role text, p_modules text[])
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  allowed text[] := ARRAY[]::text[];
  m text;
BEGIN
  IF p_modules IS NULL THEN
    IF p_role IN ('admin', 'super') THEN
      RETURN ARRAY['ordering', 'job_scope_kit', 'field_view', 'safety_tailgate', 'admin']::text[];
    END IF;
    RETURN ARRAY['ordering', 'job_scope_kit', 'field_view', 'safety_tailgate']::text[];
  END IF;

  FOREACH m IN ARRAY p_modules LOOP
    IF m IN ('ordering', 'job_scope_kit', 'pm_order', 'field_view', 'safety_tailgate', 'daily_report', 'admin') THEN
      IF m = 'admin' AND p_role NOT IN ('admin', 'super') THEN
        CONTINUE;
      END IF;
      IF NOT (m = ANY(allowed)) THEN
        allowed := array_append(allowed, m);
      END IF;
    END IF;
  END LOOP;

  IF array_length(allowed, 1) IS NULL THEN
    allowed := ARRAY['ordering']::text[];
  END IF;

  RETURN allowed;
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_refresh_order_email_status(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total integer;
  sent integer;
  skipped integer;
  failed integer;
  complete integer;
BEGIN
  SELECT count(*)::integer,
         count(*) FILTER (WHERE email_status = 'sent')::integer,
         count(*) FILTER (WHERE email_status = 'skipped')::integer,
         count(*) FILTER (WHERE email_status = 'failed')::integer
  INTO total, sent, skipped, failed
  FROM public.field_tools_order_dispatches
  WHERE order_id = p_order_id;

  complete := sent + skipped;

  IF total = 0 THEN
    UPDATE public.field_tools_orders SET email_status = 'pending' WHERE id = p_order_id;
  ELSIF failed > 0 AND complete = 0 THEN
    UPDATE public.field_tools_orders SET email_status = 'failed' WHERE id = p_order_id;
  ELSIF complete = total AND skipped = total THEN
    UPDATE public.field_tools_orders
    SET email_status = 'skipped', status = 'confirmed'
    WHERE id = p_order_id;
  ELSIF complete = total THEN
    UPDATE public.field_tools_orders
    SET email_status = 'sent', status = 'confirmed'
    WHERE id = p_order_id;
  ELSE
    UPDATE public.field_tools_orders SET email_status = 'partial' WHERE id = p_order_id;
  END IF;
END;
$$;
