-- The letterhead name is optional. A stale PIN session should return a blank name
-- instead of raising, so the app can use its fallback without a 400 in the console.

CREATE OR REPLACE FUNCTION public.field_tools_company_name(
  p_caller_id uuid,
  p_session_token text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
BEGIN
  BEGIN
    PERFORM public.field_tools_require_session(p_caller_id, p_session_token);
  EXCEPTION
    WHEN sqlstate 'P0001' THEN
      RETURN '';
  END;

  SELECT coalesce(nullif(trim(settings->>'company_name'), ''), '')
  INTO v_name
  FROM public.org_settings
  WHERE id = 1;

  RETURN coalesce(v_name, '');
END;
$$;

GRANT EXECUTE ON FUNCTION public.field_tools_company_name(uuid, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
