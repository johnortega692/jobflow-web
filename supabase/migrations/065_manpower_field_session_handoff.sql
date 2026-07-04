-- One-tap handoff: exchange a valid Field Tools session for a Manpower Cal
-- session token, so a crew member already logged into Field Tools / Field View
-- can open Manpower without re-entering their PIN. No PIN ever leaves the DB.
--
-- Security: the Field Tools session token is validated exactly like
-- field_view_require_access (064). Manpower access is still gated by an active
-- manpower_supers row for the same org_people identity — crew without Manpower
-- access get a clear error and fall back to the PIN screen.

CREATE OR REPLACE FUNCTION public.manpower_login_via_field_session(
  p_caller_id uuid,
  p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, manpower_api, extensions
AS $$
DECLARE
  v_profile public.field_tools_profiles%ROWTYPE;
  v_person public.org_people%ROWTYPE;
  s public.manpower_supers%ROWTYPE;
  v_session_profile uuid;
  tok uuid;
  exp timestamptz;
BEGIN
  IF p_caller_id IS NULL OR p_session_token IS NULL OR trim(p_session_token) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FIELD_SESSION_REQUIRED');
  END IF;

  -- Validate the Field Tools session token (same check as 064).
  SELECT s2.profile_id INTO v_session_profile
  FROM public.field_tools_sessions s2
  WHERE s2.token_hash = encode(extensions.digest(trim(p_session_token), 'sha256'), 'hex')
    AND s2.expires_at > now()
    AND s2.revoked_at IS NULL;

  IF v_session_profile IS NULL OR v_session_profile <> p_caller_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_SESSION');
  END IF;

  SELECT * INTO v_profile
  FROM public.field_tools_profiles ftp
  WHERE ftp.id = p_caller_id AND ftp.active;

  IF NOT FOUND OR v_profile.person_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_SESSION');
  END IF;

  SELECT * INTO v_person
  FROM public.org_people o
  WHERE o.id = v_profile.person_id AND o.active;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_SESSION');
  END IF;

  -- Resolve Manpower access for this identity.
  SELECT * INTO s
  FROM public.manpower_supers ms
  WHERE ms.person_id = v_person.id
    AND ms.active
  ORDER BY ms.is_admin DESC, ms.updated_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_MANPOWER_ACCESS');
  END IF;

  exp := now() + interval '12 hours';
  INSERT INTO public.manpower_sessions (super_id, expires_at)
  VALUES (s.id, exp)
  RETURNING token INTO tok;

  RETURN jsonb_build_object(
    'ok', true,
    'token', tok,
    'expires_at', exp,
    'super', jsonb_build_object(
      'id', s.id,
      'name', v_person.name,
      'is_admin', s.is_admin,
      'supervisor_label', s.supervisor_label
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.manpower_login_via_field_session(uuid, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
