-- Let the person who saved an extra work tag delete that draft.
-- Signed, waiting, and refused tags stay.

CREATE OR REPLACE FUNCTION public.field_tools_delete_extra_work_tag(
  p_caller_id uuid,
  p_session_token text,
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.field_tools_profiles%ROWTYPE;
  v_id uuid;
BEGIN
  PERFORM public.field_tools_require_session(p_caller_id, p_session_token);

  SELECT * INTO v_profile
  FROM public.field_tools_profiles
  WHERE id = p_caller_id AND active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Profile not found');
  END IF;

  IF NOT ('extra_work' = ANY (coalesce(v_profile.modules, '{}'::text[]))) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Extra work tags are not turned on for this profile.');
  END IF;

  DELETE FROM public.field_tools_extra_work_tags
  WHERE id = p_id
    AND submitted_by_profile_id = p_caller_id
    AND status = 'draft'
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'That draft tag was not found.');
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.field_tools_delete_extra_work_tag(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.field_tools_delete_extra_work_tag(uuid, text, uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
