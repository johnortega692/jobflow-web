-- Expired PIN sessions were RAISE EXCEPTION, which PostgREST surfaces as HTTP 400
-- in the Field Tools browser console. Return JSON instead; callers already handle ok=false.

CREATE OR REPLACE FUNCTION public.field_tools_get_session_profile(
  p_caller_id uuid,
  p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  p public.field_tools_profiles%ROWTYPE;
  v_person public.org_people%ROWTYPE;
BEGIN
  BEGIN
    PERFORM public.field_tools_require_session(p_caller_id, p_session_token);
  EXCEPTION
    WHEN OTHERS THEN
      RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
  END;

  SELECT * INTO p
  FROM public.field_tools_profiles
  WHERE id = p_caller_id AND active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Profile not found');
  END IF;

  IF p.person_id IS NOT NULL THEN
    SELECT * INTO v_person FROM public.org_people WHERE id = p.person_id AND active = true;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'profile', jsonb_build_object(
      'id', p.id,
      'name', coalesce(nullif(trim(v_person.name), ''), nullif(trim(p.name), ''), ''),
      'email', coalesce(nullif(trim(v_person.email), ''), nullif(trim(p.email), ''), ''),
      'role', p.role
    )
  );
END;
$$;
