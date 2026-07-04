-- Security hardening: Field View module gate, one-time handoff codes, global PIN rate limit.

-- ── One-time handoff codes (replace session tokens in cross-app URL hashes) ──

CREATE TABLE IF NOT EXISTS public.field_tools_handoff_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.field_tools_profiles(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('field_view', 'manpower')),
  session_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS field_tools_handoff_codes_active_idx
  ON public.field_tools_handoff_codes (profile_id, purpose)
  WHERE used_at IS NULL;

ALTER TABLE public.field_tools_handoff_codes ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.field_tools_validate_session(
  p_caller_id uuid,
  p_session_token text
)
RETURNS public.field_tools_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_profile public.field_tools_profiles%ROWTYPE;
  v_session_profile uuid;
BEGIN
  IF p_caller_id IS NULL OR p_session_token IS NULL OR trim(p_session_token) = '' THEN
    RAISE EXCEPTION 'INVALID_SESSION' USING ERRCODE = 'P0001';
  END IF;

  SELECT s.profile_id INTO v_session_profile
  FROM public.field_tools_sessions s
  WHERE s.token_hash = encode(extensions.digest(trim(p_session_token), 'sha256'), 'hex')
    AND s.expires_at > now()
    AND s.revoked_at IS NULL;

  IF v_session_profile IS NULL OR v_session_profile <> p_caller_id THEN
    RAISE EXCEPTION 'INVALID_SESSION' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_profile
  FROM public.field_tools_profiles ftp
  WHERE ftp.id = p_caller_id AND ftp.active;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_SESSION' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_profile;
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_create_handoff_code(
  p_caller_id uuid,
  p_session_token text,
  p_purpose text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_profile public.field_tools_profiles%ROWTYPE;
  v_code uuid;
BEGIN
  IF p_purpose NOT IN ('field_view', 'manpower') THEN
    RAISE EXCEPTION 'INVALID_HANDOFF_PURPOSE' USING ERRCODE = 'P0001';
  END IF;

  v_profile := public.field_tools_validate_session(p_caller_id, p_session_token);

  IF p_purpose = 'field_view' AND NOT ('field_view' = ANY(v_profile.modules)) THEN
    RAISE EXCEPTION 'MODULE_NOT_ALLOWED' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.field_tools_handoff_codes (
    profile_id,
    purpose,
    session_token,
    expires_at
  )
  VALUES (
    v_profile.id,
    p_purpose,
    trim(p_session_token),
    now() + interval '60 seconds'
  )
  RETURNING id INTO v_code;

  RETURN jsonb_build_object('ok', true, 'code', v_code);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_exchange_handoff_code(
  p_caller_id uuid,
  p_code uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row public.field_tools_handoff_codes%ROWTYPE;
  v_profile public.field_tools_profiles%ROWTYPE;
  v_person public.org_people%ROWTYPE;
BEGIN
  IF p_caller_id IS NULL OR p_code IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_HANDOFF');
  END IF;

  SELECT * INTO v_row
  FROM public.field_tools_handoff_codes h
  WHERE h.id = p_code
    AND h.profile_id = p_caller_id
    AND h.purpose = 'field_view'
    AND h.used_at IS NULL
    AND h.expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_HANDOFF');
  END IF;

  v_profile := public.field_tools_validate_session(v_row.profile_id, v_row.session_token);

  IF NOT ('field_view' = ANY(v_profile.modules)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'MODULE_NOT_ALLOWED');
  END IF;

  UPDATE public.field_tools_handoff_codes
  SET used_at = now()
  WHERE id = v_row.id;

  SELECT * INTO v_person
  FROM public.org_people o
  WHERE o.id = v_profile.person_id;

  RETURN jsonb_build_object(
    'ok', true,
    'session_token', v_row.session_token,
    'profile', jsonb_build_object(
      'id', v_profile.id,
      'name', coalesce(v_person.name, 'Field user'),
      'role', v_profile.role
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.manpower_login_via_handoff_code(
  p_caller_id uuid,
  p_code uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, manpower_api, extensions
AS $$
DECLARE
  v_row public.field_tools_handoff_codes%ROWTYPE;
  v_profile public.field_tools_profiles%ROWTYPE;
  v_person public.org_people%ROWTYPE;
  s public.manpower_supers%ROWTYPE;
  tok uuid;
  exp timestamptz;
BEGIN
  IF p_caller_id IS NULL OR p_code IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_HANDOFF');
  END IF;

  SELECT * INTO v_row
  FROM public.field_tools_handoff_codes h
  WHERE h.id = p_code
    AND h.profile_id = p_caller_id
    AND h.purpose = 'manpower'
    AND h.used_at IS NULL
    AND h.expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_HANDOFF');
  END IF;

  v_profile := public.field_tools_validate_session(v_row.profile_id, v_row.session_token);

  UPDATE public.field_tools_handoff_codes
  SET used_at = now()
  WHERE id = v_row.id;

  SELECT * INTO v_person
  FROM public.org_people o
  WHERE o.id = v_profile.person_id AND o.active;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_SESSION');
  END IF;

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

-- ── Field View module gate ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.field_tools_sanitize_profile_modules(p_role text, p_modules text[])
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  allowed text[] := ARRAY[]::text[];
  m text;
BEGIN
  IF p_modules IS NULL THEN
    IF p_role IN ('admin', 'super') THEN
      RETURN ARRAY['ordering', 'field_view', 'admin']::text[];
    END IF;
    RETURN ARRAY['ordering', 'field_view']::text[];
  END IF;

  FOREACH m IN ARRAY p_modules LOOP
    IF m IN ('ordering', 'field_view', 'safety_tailgate', 'daily_report', 'admin') THEN
      IF m = 'admin' AND p_role NOT IN ('admin', 'super') THEN
        CONTINUE;
      END IF;
      IF NOT (m = ANY(allowed)) THEN
        allowed := array_append(allowed, m);
      END IF;
    END IF;
  END LOOP;

  IF array_length(allowed, 1) IS NULL THEN
    allowed := ARRAY['ordering']::text[];
  END IF;

  RETURN allowed;
END;
$$;

CREATE OR REPLACE FUNCTION public.field_view_require_access(
  p_caller_id uuid DEFAULT NULL,
  p_session_token text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_profile public.field_tools_profiles%ROWTYPE;
BEGIN
  IF auth.uid() IS NOT NULL AND public.is_approved_user(auth.uid()) THEN
    RETURN;
  END IF;

  v_profile := public.field_tools_validate_session(p_caller_id, p_session_token);

  IF NOT ('field_view' = ANY(v_profile.modules)) THEN
    RAISE EXCEPTION 'MODULE_NOT_ALLOWED' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- ── Global PIN login rate limit (in addition to per-PIN lockout) ───────────────

CREATE OR REPLACE FUNCTION public.field_tools_login_pin(p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_person public.org_people%ROWTYPE;
  p public.field_tools_profiles%ROWTYPE;
  match_count integer;
  v_fingerprint text;
  v_attempt public.field_tools_pin_attempts%ROWTYPE;
  v_global public.field_tools_pin_attempts%ROWTYPE;
  v_global_fingerprint constant text := '__global__';
  v_max_attempts constant integer := 5;
  v_global_max_attempts constant integer := 30;
  v_lock_minutes constant integer := 15;
  v_session_token text;
BEGIN
  v_fingerprint := md5(trim(coalesce(p_pin, '')));

  SELECT * INTO v_global
  FROM public.field_tools_pin_attempts
  WHERE pin_fingerprint = v_global_fingerprint;

  IF FOUND AND v_global.locked_until IS NOT NULL AND v_global.locked_until > now() THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', format('Too many failed attempts. Try again in %s minutes.',
        greatest(1, ceil(extract(epoch from (v_global.locked_until - now())) / 60)::integer))
    );
  END IF;

  SELECT * INTO v_attempt
  FROM public.field_tools_pin_attempts
  WHERE pin_fingerprint = v_fingerprint;

  IF FOUND AND v_attempt.locked_until IS NOT NULL AND v_attempt.locked_until > now() THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', format('Too many failed attempts. Try again in %s minutes.',
        greatest(1, ceil(extract(epoch from (v_attempt.locked_until - now())) / 60)::integer))
    );
  END IF;

  SELECT count(*)::integer INTO match_count
  FROM public.org_people o
  WHERE o.active
    AND o.pin_hash IS NOT NULL
    AND o.pin_hash = extensions.crypt(trim(p_pin), o.pin_hash);

  IF match_count = 0 THEN
    INSERT INTO public.field_tools_pin_attempts (pin_fingerprint, fail_count, locked_until, updated_at)
    VALUES (v_fingerprint, 1, NULL, now())
    ON CONFLICT (pin_fingerprint) DO UPDATE SET
      fail_count = CASE
        WHEN field_tools_pin_attempts.updated_at < now() - make_interval(mins => v_lock_minutes) THEN 1
        ELSE field_tools_pin_attempts.fail_count + 1
      END,
      locked_until = CASE
        WHEN field_tools_pin_attempts.updated_at < now() - make_interval(mins => v_lock_minutes) THEN NULL
        WHEN field_tools_pin_attempts.fail_count + 1 >= v_max_attempts
          THEN now() + make_interval(mins => v_lock_minutes)
        ELSE field_tools_pin_attempts.locked_until
      END,
      updated_at = now();

    INSERT INTO public.field_tools_pin_attempts (pin_fingerprint, fail_count, locked_until, updated_at)
    VALUES (v_global_fingerprint, 1, NULL, now())
    ON CONFLICT (pin_fingerprint) DO UPDATE SET
      fail_count = CASE
        WHEN field_tools_pin_attempts.updated_at < now() - make_interval(mins => v_lock_minutes) THEN 1
        ELSE field_tools_pin_attempts.fail_count + 1
      END,
      locked_until = CASE
        WHEN field_tools_pin_attempts.updated_at < now() - make_interval(mins => v_lock_minutes) THEN NULL
        WHEN field_tools_pin_attempts.fail_count + 1 >= v_global_max_attempts
          THEN now() + make_interval(mins => v_lock_minutes)
        ELSE field_tools_pin_attempts.locked_until
      END,
      updated_at = now();

    RETURN jsonb_build_object('ok', false, 'error', 'Invalid PIN');
  END IF;

  IF match_count > 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PIN is not unique — contact admin');
  END IF;

  DELETE FROM public.field_tools_pin_attempts WHERE pin_fingerprint = v_fingerprint;

  SELECT * INTO v_person
  FROM public.org_people o
  WHERE o.active
    AND o.pin_hash IS NOT NULL
    AND o.pin_hash = extensions.crypt(trim(p_pin), o.pin_hash);

  SELECT * INTO p
  FROM public.field_tools_profiles ftp
  WHERE ftp.person_id = v_person.id
    AND ftp.active
  ORDER BY ftp.updated_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No Field Tools access for this PIN');
  END IF;

  v_session_token := public.field_tools_issue_session(p.id);

  RETURN jsonb_build_object(
    'ok', true,
    'session_token', v_session_token,
    'profile', jsonb_build_object(
      'id', p.id,
      'name', v_person.name,
      'email', v_person.email,
      'phone', v_person.phone,
      'role', p.role,
      'modules', to_jsonb(p.modules),
      'custom_modules', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'id', cm.id,
          'title', cm.title,
          'description', cm.description,
          'url', cm.url,
          'sort_order', cm.sort_order
        ) ORDER BY cm.sort_order, cm.title), '[]'::jsonb)
        FROM public.field_tools_profile_custom_modules pcm
        JOIN public.field_tools_custom_modules cm ON cm.id = pcm.module_id
        WHERE pcm.profile_id = p.id AND cm.active = true
      )
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.field_tools_validate_session(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_create_handoff_code(uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_exchange_handoff_code(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manpower_login_via_handoff_code(uuid, uuid) TO anon, authenticated;

-- Preserve Field View access for profiles that had it implicitly before the module gate.
UPDATE public.field_tools_profiles
SET modules = (
  SELECT coalesce(array_agg(DISTINCT m), ARRAY['ordering', 'field_view']::text[])
  FROM unnest(
    CASE
      WHEN modules IS NULL THEN ARRAY['ordering', 'field_view']::text[]
      ELSE modules || ARRAY['field_view']::text[]
    END
  ) AS m
)
WHERE active
  AND NOT ('field_view' = ANY(coalesce(modules, ARRAY[]::text[])));

NOTIFY pgrst, 'reload schema';
