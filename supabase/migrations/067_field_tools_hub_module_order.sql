-- Global Field Tools hub tile order (built-in modules + custom hub links).

ALTER TABLE public.field_tools_order_settings
  ADD COLUMN IF NOT EXISTS hub_module_order text[] DEFAULT NULL;

CREATE OR REPLACE FUNCTION public.field_tools_default_hub_module_order()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY['ordering', 'field_view', 'safety_tailgate', 'daily_report']::text[];
$$;

CREATE OR REPLACE FUNCTION public.field_tools_get_hub_module_order(
  p_caller_id uuid,
  p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order text[];
BEGIN
  PERFORM public.field_view_require_access(p_caller_id, p_session_token);

  SELECT coalesce(s.hub_module_order, public.field_tools_default_hub_module_order())
  INTO v_order
  FROM public.field_tools_order_settings s
  WHERE s.id = 1;

  IF v_order IS NULL THEN
    v_order := public.field_tools_default_hub_module_order();
  END IF;

  RETURN jsonb_build_object('ok', true, 'hub_module_order', to_jsonb(v_order));
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_reorder_hub_modules(
  p_caller_id uuid,
  p_session_token text,
  p_module_keys text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  key text;
  custom_id uuid;
  custom_idx integer := 0;
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id, p_session_token);

  IF p_module_keys IS NULL OR array_length(p_module_keys, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No modules to reorder');
  END IF;

  INSERT INTO public.field_tools_order_settings (id, hub_module_order, updated_at)
  VALUES (1, p_module_keys, now())
  ON CONFLICT (id) DO UPDATE SET
    hub_module_order = excluded.hub_module_order,
    updated_at = now();

  FOREACH key IN ARRAY p_module_keys LOOP
    IF key LIKE 'custom:%' THEN
      custom_idx := custom_idx + 1;
      custom_id := (substring(key from 8))::uuid;
      UPDATE public.field_tools_custom_modules SET
        sort_order = custom_idx,
        updated_at = now()
      WHERE id = custom_id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
WHEN invalid_text_representation THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Invalid custom module id in order list');
END;
$$;

GRANT EXECUTE ON FUNCTION public.field_tools_get_hub_module_order(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_reorder_hub_modules(uuid, text, text[]) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
