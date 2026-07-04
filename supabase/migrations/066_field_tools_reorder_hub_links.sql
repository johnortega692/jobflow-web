-- Reorder custom hub links (Field Tools admin → Hub links).

CREATE OR REPLACE FUNCTION public.field_tools_admin_reorder_custom_modules(
  p_caller_id uuid,
  p_session_token text,
  p_module_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  i integer;
  mid uuid;
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id, p_session_token);

  IF p_module_ids IS NULL OR array_length(p_module_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No links to reorder');
  END IF;

  i := 0;
  FOREACH mid IN ARRAY p_module_ids LOOP
    i := i + 1;
    UPDATE public.field_tools_custom_modules SET
      sort_order = i,
      updated_at = now()
    WHERE id = mid;
  END LOOP;

  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
END;
$$;

GRANT EXECUTE ON FUNCTION public.field_tools_admin_reorder_custom_modules(uuid, text, uuid[]) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
