-- Letterhead fields for the extra-work tag PDF. Returns only name, logo, and contact lines.

CREATE OR REPLACE FUNCTION public.field_tools_extra_work_letterhead(
  p_caller_id uuid,
  p_session_token text,
  p_token text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok boolean := false;
  v_settings jsonb;
BEGIN
  IF coalesce(trim(p_session_token), '') <> '' THEN
    BEGIN
      PERFORM public.field_tools_require_session(p_caller_id, p_session_token);
      v_ok := true;
    EXCEPTION WHEN OTHERS THEN
      v_ok := false;
    END;
  END IF;

  IF NOT v_ok AND coalesce(trim(p_token), '') <> '' THEN
    SELECT true INTO v_ok
    FROM public.field_tools_extra_work_links
    WHERE token_hash = encode(extensions.digest(trim(p_token), 'sha256'), 'hex');
    v_ok := coalesce(v_ok, false);
  END IF;

  IF NOT v_ok THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT settings INTO v_settings
  FROM public.org_settings
  WHERE id = 1;

  RETURN jsonb_build_object(
    'company_name', coalesce(v_settings->>'company_name', ''),
    'company_address', coalesce(v_settings->>'company_address', ''),
    'company_phone', coalesce(v_settings->>'company_phone', ''),
    'company_license', coalesce(v_settings->>'company_license', ''),
    'logo_url', coalesce(v_settings->>'logo_url', ''),
    'pdf_show', coalesce(v_settings->'pdf_show', '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.field_tools_extra_work_letterhead(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.field_tools_extra_work_letterhead(uuid, text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
