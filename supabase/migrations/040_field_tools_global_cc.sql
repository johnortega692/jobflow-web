-- Global CC on all outgoing Field Tools order emails (e.g. VP)

ALTER TABLE public.field_tools_order_settings
  ADD COLUMN IF NOT EXISTS global_cc_emails text NOT NULL DEFAULT '';

DROP FUNCTION IF EXISTS public.field_tools_admin_upsert_order_settings(uuid, text);

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
  p_global_cc_emails text DEFAULT ''
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

  INSERT INTO public.field_tools_order_settings (id, warehouse_email, global_cc_emails, updated_at)
  VALUES (1, warehouse, global_norm, now())
  ON CONFLICT (id) DO UPDATE SET
    warehouse_email = EXCLUDED.warehouse_email,
    global_cc_emails = EXCLUDED.global_cc_emails,
    updated_at = now();

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.field_tools_admin_upsert_order_settings(uuid, text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
