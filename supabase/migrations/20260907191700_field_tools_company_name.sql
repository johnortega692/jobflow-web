-- Letterhead company name for Field Tools hub (any valid PIN session).
-- Distinct from field_view_company_name, which also requires the field_view module.

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
  PERFORM public.field_tools_require_session(p_caller_id, p_session_token);

  SELECT coalesce(nullif(trim(settings->>'company_name'), ''), '')
  INTO v_name
  FROM public.org_settings
  WHERE id = 1;

  RETURN coalesce(v_name, '');
END;
$$;

GRANT EXECUTE ON FUNCTION public.field_tools_company_name(uuid, text) TO anon, authenticated;
