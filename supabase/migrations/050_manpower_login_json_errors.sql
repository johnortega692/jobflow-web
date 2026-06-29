-- Manpower login: return JSON errors (HTTP 200) and distinguish no-access vs bad PIN

CREATE OR REPLACE FUNCTION manpower_api.login(p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, manpower_api, extensions
AS $$
DECLARE
  v_person public.org_people%ROWTYPE;
  s public.manpower_supers%ROWTYPE;
  tok uuid;
  exp timestamptz;
  match_count integer;
BEGIN
  IF p_pin IS NULL OR length(trim(p_pin)) < 4 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Enter at least 4 digits');
  END IF;

  SELECT count(*)::integer INTO match_count
  FROM public.org_people o
  WHERE o.active
    AND o.pin_hash IS NOT NULL
    AND o.pin_hash = extensions.crypt(trim(p_pin), o.pin_hash);

  IF match_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid PIN');
  END IF;

  IF match_count > 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PIN is not unique — contact admin');
  END IF;

  SELECT * INTO v_person
  FROM public.org_people o
  WHERE o.active
    AND o.pin_hash IS NOT NULL
    AND o.pin_hash = extensions.crypt(trim(p_pin), o.pin_hash);

  SELECT * INTO s
  FROM public.manpower_supers ms
  WHERE ms.person_id = v_person.id
    AND ms.active
  ORDER BY ms.is_admin DESC, ms.updated_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No Manpower Cal access for this PIN');
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

NOTIFY pgrst, 'reload schema';
