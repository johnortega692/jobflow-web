-- Manpower PIN lockout (same limits as Field Tools) + admin email alert queue.

-- ── Lockout notification queue (processed by Vercel cron → Resend) ───────────

CREATE TABLE IF NOT EXISTS public.pin_lockout_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app text NOT NULL CHECK (app IN ('field_tools', 'manpower')),
  lock_kind text NOT NULL CHECK (lock_kind IN ('per_pin', 'global')),
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz
);

CREATE INDEX IF NOT EXISTS pin_lockout_notifications_pending_idx
  ON public.pin_lockout_notifications (created_at)
  WHERE notified_at IS NULL;

ALTER TABLE public.pin_lockout_notifications ENABLE ROW LEVEL SECURITY;

-- ── Admin alert recipients (Field Tools admin + super emails) ───────────────

CREATE OR REPLACE FUNCTION public.pin_security_admin_emails()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    array_agg(DISTINCT lower(trim(o.email)) ORDER BY lower(trim(o.email))),
    ARRAY[]::text[]
  )
  FROM public.field_tools_profiles ftp
  JOIN public.org_people o ON o.id = ftp.person_id
  WHERE ftp.active
    AND ftp.role IN ('admin', 'super')
    AND o.active
    AND o.email IS NOT NULL
    AND trim(o.email) <> '';
$$;

CREATE OR REPLACE FUNCTION public.pin_lockout_enqueue(
  p_app text,
  p_lock_kind text,
  p_message text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.pin_lockout_notifications (app, lock_kind, message)
  VALUES (p_app, p_lock_kind, p_message);
END;
$$;

-- ── Shared failed-login counter (uses field_tools_pin_attempts fingerprints) ─

CREATE OR REPLACE FUNCTION public.pin_apply_failed_login(
  p_app text,
  p_pin text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_fingerprint text;
  v_global_fingerprint text;
  v_app_label text;
  v_max_attempts constant integer := 5;
  v_global_max_attempts constant integer := 30;
  v_lock_minutes constant integer := 15;
  v_old_per_pin_locked timestamptz;
  v_new_per_pin_locked timestamptz;
  v_old_global_locked timestamptz;
  v_new_global_locked timestamptz;
BEGIN
  IF p_app = 'manpower' THEN
    v_fingerprint := 'mp:' || md5(trim(coalesce(p_pin, '')));
    v_global_fingerprint := '__manpower_global__';
    v_app_label := 'Manpower Cal';
  ELSIF p_app = 'field_tools' THEN
    v_fingerprint := md5(trim(coalesce(p_pin, '')));
    v_global_fingerprint := '__global__';
    v_app_label := 'Field Tools';
  ELSE
    RAISE EXCEPTION 'INVALID_APP' USING ERRCODE = 'P0001';
  END IF;

  SELECT locked_until INTO v_old_per_pin_locked
  FROM public.field_tools_pin_attempts
  WHERE pin_fingerprint = v_fingerprint;

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

  SELECT locked_until INTO v_new_per_pin_locked
  FROM public.field_tools_pin_attempts
  WHERE pin_fingerprint = v_fingerprint;

  IF v_new_per_pin_locked IS NOT NULL
     AND v_new_per_pin_locked > now()
     AND (v_old_per_pin_locked IS NULL OR v_old_per_pin_locked <= now()) THEN
    PERFORM public.pin_lockout_enqueue(
      p_app,
      'per_pin',
      format(
        '%s PIN login locked for %s minutes after %s failed attempts on one PIN guess.',
        v_app_label,
        v_lock_minutes,
        v_max_attempts
      )
    );
  END IF;

  SELECT locked_until INTO v_old_global_locked
  FROM public.field_tools_pin_attempts
  WHERE pin_fingerprint = v_global_fingerprint;

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

  SELECT locked_until INTO v_new_global_locked
  FROM public.field_tools_pin_attempts
  WHERE pin_fingerprint = v_global_fingerprint;

  IF v_new_global_locked IS NOT NULL
     AND v_new_global_locked > now()
     AND (v_old_global_locked IS NULL OR v_old_global_locked <= now()) THEN
    PERFORM public.pin_lockout_enqueue(
      p_app,
      'global',
      format(
        '%s PIN login locked for %s minutes after %s failed attempts across all PIN guesses.',
        v_app_label,
        v_lock_minutes,
        v_global_max_attempts
      )
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.pin_clear_failed_login(p_app text, p_pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_fingerprint text;
BEGIN
  IF p_app = 'manpower' THEN
    v_fingerprint := 'mp:' || md5(trim(coalesce(p_pin, '')));
  ELSIF p_app = 'field_tools' THEN
    v_fingerprint := md5(trim(coalesce(p_pin, '')));
  ELSE
    RETURN;
  END IF;

  DELETE FROM public.field_tools_pin_attempts WHERE pin_fingerprint = v_fingerprint;
END;
$$;

CREATE OR REPLACE FUNCTION public.pin_lockout_error_message(
  p_app text,
  p_pin text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_fingerprint text;
  v_global_fingerprint text;
  v_locked_until timestamptz;
BEGIN
  IF p_app = 'manpower' THEN
    v_fingerprint := 'mp:' || md5(trim(coalesce(p_pin, '')));
    v_global_fingerprint := '__manpower_global__';
  ELSE
    v_fingerprint := md5(trim(coalesce(p_pin, '')));
    v_global_fingerprint := '__global__';
  END IF;

  SELECT locked_until INTO v_locked_until
  FROM public.field_tools_pin_attempts
  WHERE pin_fingerprint = v_global_fingerprint;

  IF v_locked_until IS NOT NULL AND v_locked_until > now() THEN
    RETURN format(
      'Too many failed attempts. Try again in %s minutes.',
      greatest(1, ceil(extract(epoch from (v_locked_until - now())) / 60)::integer)
    );
  END IF;

  SELECT locked_until INTO v_locked_until
  FROM public.field_tools_pin_attempts
  WHERE pin_fingerprint = v_fingerprint;

  IF v_locked_until IS NOT NULL AND v_locked_until > now() THEN
    RETURN format(
      'Too many failed attempts. Try again in %s minutes.',
      greatest(1, ceil(extract(epoch from (v_locked_until - now())) / 60)::integer)
    );
  END IF;

  RETURN NULL;
END;
$$;

-- ── Field Tools login (lockout + alert enqueue) ─────────────────────────────

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
  v_lock_msg text;
  v_session_token text;
BEGIN
  v_lock_msg := public.pin_lockout_error_message('field_tools', p_pin);
  IF v_lock_msg IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', v_lock_msg);
  END IF;

  SELECT count(*)::integer INTO match_count
  FROM public.org_people o
  WHERE o.active
    AND o.pin_hash IS NOT NULL
    AND o.pin_hash = extensions.crypt(trim(p_pin), o.pin_hash);

  IF match_count = 0 THEN
    PERFORM public.pin_apply_failed_login('field_tools', p_pin);
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid PIN');
  END IF;

  IF match_count > 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PIN is not unique — contact admin');
  END IF;

  PERFORM public.pin_clear_failed_login('field_tools', p_pin);

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

-- ── Manpower login (lockout + alert enqueue) ────────────────────────────────

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
  v_lock_msg text;
BEGIN
  IF p_pin IS NULL OR length(trim(p_pin)) < 4 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Enter at least 4 digits');
  END IF;

  v_lock_msg := public.pin_lockout_error_message('manpower', p_pin);
  IF v_lock_msg IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', v_lock_msg);
  END IF;

  SELECT count(*)::integer INTO match_count
  FROM public.org_people o
  WHERE o.active
    AND o.pin_hash IS NOT NULL
    AND o.pin_hash = extensions.crypt(trim(p_pin), o.pin_hash);

  IF match_count = 0 THEN
    PERFORM public.pin_apply_failed_login('manpower', p_pin);
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid PIN');
  END IF;

  IF match_count > 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PIN is not unique — contact admin');
  END IF;

  PERFORM public.pin_clear_failed_login('manpower', p_pin);

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

CREATE OR REPLACE FUNCTION public.pin_lockout_list_pending()
RETURNS TABLE (
  id uuid,
  app text,
  lock_kind text,
  message text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT n.id, n.app, n.lock_kind, n.message, n.created_at
  FROM public.pin_lockout_notifications n
  WHERE n.notified_at IS NULL
  ORDER BY n.created_at
  LIMIT 50;
$$;

CREATE OR REPLACE FUNCTION public.pin_lockout_mark_notified(p_ids uuid[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.pin_lockout_notifications
  SET notified_at = now()
  WHERE id = ANY(p_ids)
    AND notified_at IS NULL;
$$;

GRANT EXECUTE ON FUNCTION public.pin_security_admin_emails() TO service_role;
GRANT EXECUTE ON FUNCTION public.pin_lockout_list_pending() TO service_role;
GRANT EXECUTE ON FUNCTION public.pin_lockout_mark_notified(uuid[]) TO service_role;

NOTIFY pgrst, 'reload schema';
