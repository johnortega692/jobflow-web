-- Security hardening: PIN lockout, scoped field-view project updates.

-- ── PIN attempt tracking (no direct client access) ───────────────────────

CREATE TABLE IF NOT EXISTS public.field_tools_pin_attempts (
  pin_fingerprint text PRIMARY KEY,
  fail_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.field_tools_pin_attempts ENABLE ROW LEVEL SECURITY;

-- ── PIN login with lockout (5 failures → 15 min lock) ─────────────────────

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
  v_max_attempts constant integer := 5;
  v_lock_minutes constant integer := 15;
BEGIN
  v_fingerprint := md5(trim(coalesce(p_pin, '')));

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
    VALUES (
      v_fingerprint,
      1,
      NULL,
      now()
    )
    ON CONFLICT (pin_fingerprint) DO UPDATE SET
      fail_count = CASE
        WHEN field_tools_pin_attempts.updated_at < now() - make_interval(mins => v_lock_minutes)
          THEN 1
        ELSE field_tools_pin_attempts.fail_count + 1
      END,
      locked_until = CASE
        WHEN field_tools_pin_attempts.updated_at < now() - make_interval(mins => v_lock_minutes)
          THEN NULL
        WHEN field_tools_pin_attempts.fail_count + 1 >= v_max_attempts
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

  RETURN jsonb_build_object(
    'ok', true,
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

GRANT EXECUTE ON FUNCTION public.field_tools_login_pin(text) TO anon, authenticated;

-- ── Field view: scoped project data writes (replaces blanket anon UPDATE) ─

CREATE OR REPLACE FUNCTION public.field_view_commit_project_update(
  p_project_id uuid,
  p_merge_data jsonb,
  p_action text,
  p_summary text,
  p_user_name text DEFAULT 'Field view'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_allowed text[] := ARRAY[
    'paint_tracker',
    'paint_submittal',
    'wc_tracker',
    'wc_tracker_lines',
    'wallcovering_submittal',
    'job_info'
  ];
  v_data jsonb;
  v_merged jsonb;
BEGIN
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id required';
  END IF;

  IF p_merge_data IS NULL OR p_merge_data = '{}'::jsonb THEN
    RAISE EXCEPTION 'merge_data required';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_merge_data)
  LOOP
    IF NOT (v_key = ANY(v_allowed)) THEN
      RAISE EXCEPTION 'Field view cannot update key: %', v_key;
    END IF;
  END LOOP;

  SELECT data INTO v_data FROM public.projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found';
  END IF;

  v_merged := coalesce(v_data, '{}'::jsonb);

  FOREACH v_key IN ARRAY v_allowed
  LOOP
    IF p_merge_data ? v_key THEN
      IF v_key = 'job_info' AND v_merged ? 'job_info' THEN
        v_merged := jsonb_set(
          v_merged,
          '{job_info}',
          coalesce(v_merged->'job_info', '{}'::jsonb) || (p_merge_data->'job_info'),
          true
        );
      ELSE
        v_merged := jsonb_set(v_merged, ARRAY[v_key], p_merge_data->v_key, true);
      END IF;
    END IF;
  END LOOP;

  UPDATE public.projects
  SET data = v_merged, updated_at = now()
  WHERE id = p_project_id;

  INSERT INTO public.project_activity (project_id, user_id, user_name, action, summary)
  VALUES (
    p_project_id,
    NULL,
    coalesce(nullif(trim(p_user_name), ''), 'Field view'),
    coalesce(nullif(trim(p_action), ''), 'project_data_saved'),
    coalesce(nullif(trim(p_summary), ''), 'Field view update')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.field_view_commit_project_update(uuid, jsonb, text, text, text) TO anon, authenticated;

-- Remove blanket anon UPDATE on projects (reads stay open for field dashboard).
DROP POLICY IF EXISTS "projects_update_anon" ON public.projects;
