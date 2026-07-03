-- Field Tools admin sessions + narrower field-view reads.

-- ── Sessions (server-issued tokens; no direct client access) ─────────────

CREATE TABLE IF NOT EXISTS public.field_tools_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.field_tools_profiles (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS field_tools_sessions_profile_idx
  ON public.field_tools_sessions (profile_id, expires_at DESC);

ALTER TABLE public.field_tools_sessions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.field_tools_issue_session(p_profile_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_token text;
BEGIN
  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'profile_id required';
  END IF;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  INSERT INTO public.field_tools_sessions (profile_id, token_hash, expires_at)
  VALUES (
    p_profile_id,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    now() + interval '12 hours'
  );

  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_revoke_session(p_session_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF p_session_token IS NULL OR trim(p_session_token) = '' THEN
    RETURN;
  END IF;

  UPDATE public.field_tools_sessions
  SET revoked_at = now()
  WHERE token_hash = encode(extensions.digest(trim(p_session_token), 'sha256'), 'hex')
    AND revoked_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_require_admin(
  p_caller_id uuid,
  p_session_token text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_profile uuid;
BEGIN
  IF p_caller_id IS NULL THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  IF p_session_token IS NULL OR trim(p_session_token) = '' THEN
    RAISE EXCEPTION 'SESSION_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT s.profile_id INTO v_profile
  FROM public.field_tools_sessions s
  WHERE s.token_hash = encode(extensions.digest(trim(p_session_token), 'sha256'), 'hex')
    AND s.expires_at > now()
    AND s.revoked_at IS NULL;

  IF v_profile IS NULL OR v_profile <> p_caller_id THEN
    RAISE EXCEPTION 'INVALID_SESSION' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.field_tools_profiles
    WHERE id = p_caller_id AND active = true AND role IN ('admin', 'super')
  ) THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_require_strict_admin(
  p_caller_id uuid,
  p_session_token text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_profile uuid;
BEGIN
  IF p_caller_id IS NULL THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  IF p_session_token IS NULL OR trim(p_session_token) = '' THEN
    RAISE EXCEPTION 'SESSION_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT s.profile_id INTO v_profile
  FROM public.field_tools_sessions s
  WHERE s.token_hash = encode(extensions.digest(trim(p_session_token), 'sha256'), 'hex')
    AND s.expires_at > now()
    AND s.revoked_at IS NULL;

  IF v_profile IS NULL OR v_profile <> p_caller_id THEN
    RAISE EXCEPTION 'INVALID_SESSION' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.field_tools_profiles
    WHERE id = p_caller_id AND active = true AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- ── PIN login: issue session token (keeps 061 lockout behavior) ───────────

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
  v_session_token text;
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

GRANT EXECUTE ON FUNCTION public.field_tools_issue_session(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_revoke_session(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_require_admin(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_require_strict_admin(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_login_pin(text) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.field_tools_require_admin(uuid);
DROP FUNCTION IF EXISTS public.field_tools_require_strict_admin(uuid);

-- ── Field view: scoped reads (strip billing from project data) ───────────

CREATE OR REPLACE FUNCTION public.field_view_strip_project_data(p_data jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_data IS NULL THEN NULL
    ELSE p_data - 'billing'
  END;
$$;

CREATE OR REPLACE FUNCTION public.field_view_list_projects()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN coalesce((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'job_number', p.job_number,
        'job_name', p.job_name,
        'job_address', p.job_address,
        'job_address2', p.job_address2,
        'contractor', p.contractor,
        'architect', p.architect,
        'owner', p.owner,
        'organization_id', p.organization_id,
        'data', public.field_view_strip_project_data(p.data),
        'created_at', p.created_at,
        'updated_at', p.updated_at,
        'created_by', p.created_by,
        'updated_by', p.updated_by
      )
      ORDER BY p.job_number
    )
    FROM public.projects p
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_view_get_project(p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.projects%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.projects WHERE id = p_project_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'job_number', v_row.job_number,
    'job_name', v_row.job_name,
    'job_address', v_row.job_address,
    'job_address2', v_row.job_address2,
    'contractor', v_row.contractor,
    'architect', v_row.architect,
    'owner', v_row.owner,
    'organization_id', v_row.organization_id,
    'data', public.field_view_strip_project_data(v_row.data),
    'created_at', v_row.created_at,
    'updated_at', v_row.updated_at,
    'created_by', v_row.created_by,
    'updated_by', v_row.updated_by
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.field_view_company_name()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(nullif(trim(settings->>'company_name'), ''), '')
  FROM public.org_settings
  WHERE id = 1;
$$;

GRANT EXECUTE ON FUNCTION public.field_view_list_projects() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_view_get_project(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_view_company_name() TO anon, authenticated;

DROP POLICY IF EXISTS "projects_select_anon" ON public.projects;
DROP POLICY IF EXISTS "org_settings_select_anon" ON public.org_settings;

-- ── Admin RPCs: require session token (generated below) ──────────────────
-- Generated admin RPC session-token patches (29 functions)

DROP FUNCTION IF EXISTS public.field_tools_admin_list_profiles(uuid);
DROP FUNCTION IF EXISTS public.field_tools_admin_upsert_profile(uuid, uuid, text, text, text, text, text, boolean, text[], uuid[]);
DROP FUNCTION IF EXISTS public.field_tools_admin_list_vendors(uuid);
DROP FUNCTION IF EXISTS public.field_tools_admin_upsert_vendor(uuid, uuid, text, text, text, text, integer, boolean);
DROP FUNCTION IF EXISTS public.field_tools_admin_list_catalog(uuid, text);
DROP FUNCTION IF EXISTS public.field_tools_admin_upsert_catalog_item(uuid, uuid, text, text, text, integer, boolean);
DROP FUNCTION IF EXISTS public.field_tools_admin_delete_catalog_item(uuid, uuid);
DROP FUNCTION IF EXISTS public.field_tools_admin_list_custom_modules(uuid);
DROP FUNCTION IF EXISTS public.field_tools_admin_upsert_custom_module(uuid, uuid, text, text, text, integer, boolean);
DROP FUNCTION IF EXISTS public.field_tools_admin_delete_custom_module(uuid, uuid);
DROP FUNCTION IF EXISTS public.field_tools_admin_reorder_catalog(uuid, text, text, uuid[]);
DROP FUNCTION IF EXISTS public.field_tools_admin_get_order_settings(uuid);
DROP FUNCTION IF EXISTS public.field_tools_admin_upsert_order_settings(uuid, text, text, integer);
DROP FUNCTION IF EXISTS public.field_tools_admin_list_orders_by_job(uuid, text);
DROP FUNCTION IF EXISTS public.field_tools_admin_list_sundry_packages(uuid);
DROP FUNCTION IF EXISTS public.field_tools_admin_upsert_sundry_package(uuid, uuid, text, integer, boolean, jsonb);
DROP FUNCTION IF EXISTS public.field_tools_admin_delete_sundry_package(uuid, uuid);
DROP FUNCTION IF EXISTS public.field_tools_admin_list_job_scope_kit(uuid);
DROP FUNCTION IF EXISTS public.field_tools_admin_upsert_scope(uuid, uuid, text, text, text, integer, boolean);
DROP FUNCTION IF EXISTS public.field_tools_admin_delete_scope(uuid, uuid);
DROP FUNCTION IF EXISTS public.field_tools_admin_upsert_scope_material(uuid, uuid, uuid, uuid, numeric, text, integer);
DROP FUNCTION IF EXISTS public.field_tools_admin_delete_scope_material(uuid, uuid);
DROP FUNCTION IF EXISTS public.field_tools_admin_upsert_crew_kit(uuid, uuid, text, text, text, integer, boolean);
DROP FUNCTION IF EXISTS public.field_tools_admin_delete_crew_kit(uuid, uuid);
DROP FUNCTION IF EXISTS public.field_tools_admin_upsert_crew_kit_item(uuid, uuid, uuid, uuid, numeric, text, integer);
DROP FUNCTION IF EXISTS public.field_tools_admin_delete_crew_kit_item(uuid, uuid);
DROP FUNCTION IF EXISTS public.field_tools_admin_list_po_sequences(uuid);
DROP FUNCTION IF EXISTS public.field_tools_admin_upsert_po_job_sequence(uuid, text, integer);
DROP FUNCTION IF EXISTS public.field_tools_admin_delete_po_job_sequence(uuid, text);

CREATE OR REPLACE FUNCTION public.field_tools_admin_list_profiles(
  p_caller_id uuid,
  p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id, p_session_token);
  RETURN jsonb_build_object(
    'ok', true,
    'profiles', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'email', p.email, 'phone', p.phone,
        'role', p.role, 'modules', to_jsonb(p.modules), 'active', p.active,
        'custom_module_ids', (
          SELECT coalesce(jsonb_agg(pcm.module_id ORDER BY cm.sort_order, cm.title), '[]'::jsonb)
          FROM public.field_tools_profile_custom_modules pcm
          JOIN public.field_tools_custom_modules cm ON cm.id = pcm.module_id
          WHERE pcm.profile_id = p.id
        )
      ) ORDER BY p.name), '[]'::jsonb)
      FROM public.field_tools_profiles p
      WHERE NOT (
        EXISTS (
          SELECT 1 FROM public.field_tools_profiles c
          WHERE c.id = p_caller_id AND c.active AND c.role = 'super'
        )
        AND p.role = 'admin'
      )
    )
  );
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_upsert_profile(
  p_caller_id uuid,
  p_session_token text,
  p_profile_id uuid,
  p_name text,
  p_email text,
  p_phone text,
  p_pin text,
  p_role text,
  p_active boolean DEFAULT true,
  p_modules text[] DEFAULT NULL,
  p_custom_module_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  pid uuid;
  v_person_id uuid;
  mods text[];
  mid uuid;
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id, p_session_token);

  IF EXISTS (
    SELECT 1 FROM public.field_tools_profiles
    WHERE id = p_caller_id AND active AND role = 'super'
  ) THEN
    IF p_role = 'admin' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Cannot assign admin role');
    END IF;
    IF p_profile_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.field_tools_profiles
      WHERE id = p_profile_id AND role = 'admin'
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Cannot edit admin profiles');
    END IF;
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Name is required');
  END IF;

  IF p_role NOT IN ('admin', 'super', 'foreman', 'laborer') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid role');
  END IF;

  mods := public.field_tools_sanitize_profile_modules(p_role, p_modules);

  IF p_profile_id IS NULL THEN
    IF p_pin IS NULL OR length(trim(p_pin)) < 4 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'PIN required (4+ digits) for new profile');
    END IF;
    IF public.org_pin_in_use(p_pin) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'PIN already in use');
    END IF;

    INSERT INTO public.org_people (name, email, phone, pin_hash, active)
    VALUES (
      trim(p_name),
      coalesce(p_email, ''),
      coalesce(p_phone, ''),
      extensions.crypt(trim(p_pin), extensions.gen_salt('bf')),
      coalesce(p_active, true)
    )
    RETURNING id INTO v_person_id;

    INSERT INTO public.field_tools_profiles (person_id, name, email, phone, pin_hash, role, modules, active)
    VALUES (
      v_person_id,
      trim(p_name),
      coalesce(p_email, ''),
      coalesce(p_phone, ''),
      (SELECT pin_hash FROM public.org_people WHERE id = v_person_id),
      p_role,
      mods,
      coalesce(p_active, true)
    )
    RETURNING id INTO pid;
  ELSE
    SELECT ftp.person_id INTO v_person_id
    FROM public.field_tools_profiles ftp
    WHERE ftp.id = p_profile_id;

    IF v_person_id IS NULL THEN
      INSERT INTO public.org_people (name, email, phone, pin_hash, active)
      VALUES (
        trim(p_name),
        coalesce(p_email, ''),
        coalesce(p_phone, ''),
        CASE
          WHEN p_pin IS NOT NULL AND length(trim(p_pin)) >= 4
          THEN extensions.crypt(trim(p_pin), extensions.gen_salt('bf'))
          ELSE NULL
        END,
        coalesce(p_active, true)
      )
      RETURNING id INTO v_person_id;
    END IF;

    IF p_pin IS NOT NULL AND length(trim(p_pin)) >= 4 THEN
      IF public.org_pin_in_use(p_pin, v_person_id) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'PIN already in use');
      END IF;
      PERFORM public.org_set_pin(v_person_id, p_pin);
    END IF;

    PERFORM public.org_sync_identity(v_person_id, p_name, p_email, p_phone, p_active);

    UPDATE public.field_tools_profiles SET
      person_id = v_person_id,
      role = p_role,
      modules = CASE
        WHEN p_modules IS NULL THEN modules
        ELSE mods
      END,
      updated_at = now()
    WHERE id = p_profile_id
    RETURNING id INTO pid;

    IF pid IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Profile not found');
    END IF;
  END IF;

  IF p_custom_module_ids IS NOT NULL THEN
    DELETE FROM public.field_tools_profile_custom_modules WHERE profile_id = pid;
    IF array_length(p_custom_module_ids, 1) IS NOT NULL THEN
      FOREACH mid IN ARRAY p_custom_module_ids LOOP
        IF EXISTS (SELECT 1 FROM public.field_tools_custom_modules WHERE id = mid AND active = true) THEN
          INSERT INTO public.field_tools_profile_custom_modules (profile_id, module_id)
          VALUES (pid, mid)
          ON CONFLICT DO NOTHING;
        END IF;
      END LOOP;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', pid);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_list_vendors(
  p_caller_id uuid,
  p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id, p_session_token);
  RETURN jsonb_build_object(
    'ok', true,
    'vendors', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', v.id, 'name', v.name, 'email', v.email, 'email_cc', v.email_cc,
        'category', v.category, 'sort_order', v.sort_order, 'active', v.active
      ) ORDER BY v.category, v.sort_order, v.name), '[]'::jsonb)
      FROM public.field_tools_vendors v
    )
  );
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_upsert_vendor(
  p_caller_id uuid,
  p_session_token text,
  p_vendor_id uuid,
  p_name text,
  p_email text,
  p_email_cc text,
  p_category text,
  p_sort_order integer DEFAULT 0,
  p_active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE vid uuid;
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id, p_session_token);
  IF p_category NOT IN ('paint', 'rental') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid vendor category');
  END IF;
  IF p_vendor_id IS NULL THEN
    INSERT INTO public.field_tools_vendors (name, email, email_cc, category, sort_order, active)
    VALUES (trim(p_name), coalesce(p_email, ''), coalesce(p_email_cc, ''), p_category,
      coalesce(p_sort_order, 0), coalesce(p_active, true))
    RETURNING id INTO vid;
  ELSE
    UPDATE public.field_tools_vendors SET
      name = trim(p_name), email = coalesce(p_email, ''), email_cc = coalesce(p_email_cc, ''),
      category = p_category, sort_order = coalesce(p_sort_order, sort_order),
      active = coalesce(p_active, active), updated_at = now()
    WHERE id = p_vendor_id RETURNING id INTO vid;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', vid);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_list_catalog(
  p_caller_id uuid,
  p_session_token text,
  p_section text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id, p_session_token);
  RETURN jsonb_build_object(
    'ok', true,
    'items', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'section', c.section, 'category', c.category, 'name', c.name,
        'sort_order', c.sort_order, 'active', c.active
      ) ORDER BY c.section, c.category, c.sort_order, c.name), '[]'::jsonb)
      FROM public.field_tools_catalog_items c
      WHERE p_section IS NULL OR c.section = p_section
    )
  );
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_upsert_catalog_item(
  p_caller_id uuid,
  p_session_token text,
  p_item_id uuid,
  p_section text,
  p_category text,
  p_name text,
  p_sort_order integer DEFAULT 0,
  p_active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE iid uuid;
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id, p_session_token);
  IF p_item_id IS NULL THEN
    INSERT INTO public.field_tools_catalog_items (section, category, name, sort_order, active)
    VALUES (p_section, coalesce(p_category, ''), trim(p_name), coalesce(p_sort_order, 0), coalesce(p_active, true))
    RETURNING id INTO iid;
  ELSE
    UPDATE public.field_tools_catalog_items SET
      section = coalesce(p_section, section),
      category = coalesce(p_category, category),
      name = trim(p_name),
      sort_order = coalesce(p_sort_order, sort_order),
      active = coalesce(p_active, active),
      updated_at = now()
    WHERE id = p_item_id RETURNING id INTO iid;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', iid);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_delete_catalog_item(
  p_caller_id uuid,
  p_session_token text,
  p_item_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id, p_session_token);
  DELETE FROM public.field_tools_catalog_items WHERE id = p_item_id;
  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_list_custom_modules(
  p_caller_id uuid,
  p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id, p_session_token);
  RETURN jsonb_build_object(
    'ok', true,
    'modules', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id, 'title', m.title, 'description', m.description, 'url', m.url,
        'sort_order', m.sort_order, 'active', m.active
      ) ORDER BY m.sort_order, m.title), '[]'::jsonb)
      FROM public.field_tools_custom_modules m
    )
  );
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_upsert_custom_module(
  p_caller_id uuid,
  p_session_token text,
  p_module_id uuid,
  p_title text,
  p_description text,
  p_url text,
  p_sort_order integer DEFAULT 0,
  p_active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE mid uuid;
BEGIN
  PERFORM public.field_tools_require_strict_admin(p_caller_id, p_session_token);
  IF p_title IS NULL OR length(trim(p_title)) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Title is required');
  END IF;
  IF p_url IS NULL OR length(trim(p_url)) < 4 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'URL is required');
  END IF;

  IF p_module_id IS NULL THEN
    INSERT INTO public.field_tools_custom_modules (title, description, url, sort_order, active)
    VALUES (trim(p_title), coalesce(p_description, ''), trim(p_url), coalesce(p_sort_order, 0), coalesce(p_active, true))
    RETURNING id INTO mid;
  ELSE
    UPDATE public.field_tools_custom_modules SET
      title = trim(p_title),
      description = coalesce(p_description, ''),
      url = trim(p_url),
      sort_order = coalesce(p_sort_order, sort_order),
      active = coalesce(p_active, active),
      updated_at = now()
    WHERE id = p_module_id
    RETURNING id INTO mid;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', mid);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_delete_custom_module(
  p_caller_id uuid,
  p_session_token text,
  p_module_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_tools_require_strict_admin(p_caller_id, p_session_token);
  DELETE FROM public.field_tools_custom_modules WHERE id = p_module_id;
  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_reorder_catalog(
  p_caller_id uuid,
  p_session_token text,
  p_section text,
  p_category text,
  p_item_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  i integer;
  iid uuid;
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id, p_session_token);

  IF p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No items to reorder');
  END IF;

  i := 0;
  FOREACH iid IN ARRAY p_item_ids LOOP
    i := i + 1;
    UPDATE public.field_tools_catalog_items SET
      sort_order = i,
      updated_at = now()
    WHERE id = iid
      AND section = p_section
      AND coalesce(category, '') = coalesce(p_category, '');
  END LOOP;

  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_get_order_settings(
  p_caller_id uuid,
  p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id, p_session_token);
  RETURN jsonb_build_object(
    'ok', true,
    'settings', (
      SELECT jsonb_build_object(
        'warehouse_email', coalesce(s.warehouse_email, ''),
        'global_cc_emails', coalesce(s.global_cc_emails, ''),
        'po_seq_digits', coalesce(s.po_seq_digits, 3),
        'updated_at', s.updated_at
      )
      FROM public.field_tools_order_settings s
      WHERE s.id = 1
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_upsert_order_settings(
  p_caller_id uuid,
  p_session_token text,
  p_warehouse_email text,
  p_global_cc_emails text DEFAULT '',
  p_po_seq_digits integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  warehouse text := lower(trim(coalesce(p_warehouse_email, '')));
  global_raw text := trim(coalesce(p_global_cc_emails, ''));
  global_norm text := '';
  part text;
  parts text[];
  i int;
  digits smallint;
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id, p_session_token);

  IF warehouse <> '' AND warehouse !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Enter a valid warehouse email address.');
  END IF;

  IF global_raw <> '' THEN
    parts := regexp_split_to_array(global_raw, '[,;]');
    FOR i IN 1..coalesce(array_length(parts, 1), 0) LOOP
      part := lower(trim(parts[i]));
      IF part = '' THEN
        CONTINUE;
      END IF;
      IF part !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Enter valid email addresses for Always CC (comma-separated).');
      END IF;
      IF global_norm <> '' THEN
        global_norm := global_norm || ',';
      END IF;
      global_norm := global_norm || part;
    END LOOP;
  END IF;

  digits := coalesce(p_po_seq_digits, (SELECT po_seq_digits FROM public.field_tools_order_settings WHERE id = 1), 3);
  IF digits < 1 OR digits > 6 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PO sequence digits must be between 1 and 6.');
  END IF;

  INSERT INTO public.field_tools_order_settings (id, warehouse_email, global_cc_emails, po_seq_digits, updated_at)
  VALUES (1, warehouse, global_norm, digits, now())
  ON CONFLICT (id) DO UPDATE SET
    warehouse_email = EXCLUDED.warehouse_email,
    global_cc_emails = EXCLUDED.global_cc_emails,
    po_seq_digits = EXCLUDED.po_seq_digits,
    updated_at = now();

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_list_orders_by_job(
  p_caller_id uuid,
  p_session_token text,
  p_job_number text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean text;
  v_orders jsonb;
  v_job_name text;
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id, p_session_token);

  v_clean := split_part(trim(coalesce(p_job_number, '')), ' ', 1);
  IF v_clean = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Job number is required');
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', o.id,
        'job_number', o.job_number,
        'job_name', o.job_name,
        'po_number', o.po_number,
        'order_type', o.order_type,
        'status', o.status,
        'email_status', o.email_status,
        'submitted_by_name', o.submitted_by_name,
        'submitted_by_email', o.submitted_by_email,
        'site_contact', o.site_contact,
        'notes', o.notes,
        'delivery_type', o.delivery_type,
        'date_needed', o.date_needed,
        'crew_kit', o.crew_kit,
        'crew_count', o.crew_count,
        'payload', o.payload,
        'created_at', o.created_at
      )
      ORDER BY o.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_orders
  FROM public.field_tools_orders o
  WHERE split_part(trim(o.job_number), ' ', 1) = v_clean
     OR lower(trim(o.job_number)) = lower(trim(p_job_number));

  SELECT coalesce(nullif(trim(o.job_name), ''), '')
  INTO v_job_name
  FROM public.field_tools_orders o
  WHERE split_part(trim(o.job_number), ' ', 1) = v_clean
     OR lower(trim(o.job_number)) = lower(trim(p_job_number))
  ORDER BY o.created_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'job_number', v_clean,
    'job_name', coalesce(v_job_name, ''),
    'orders', v_orders
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_list_sundry_packages(
  p_caller_id uuid,
  p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id, p_session_token);
  RETURN jsonb_build_object(
    'ok', true,
    'packages', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'sort_order', p.sort_order,
        'active', p.active,
        'items', (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', i.id,
            'catalog_item_id', i.catalog_item_id,
            'name', coalesce(c.name, i.item_name),
            'qty', i.default_qty,
            'sort_order', i.sort_order
          ) ORDER BY i.sort_order, coalesce(c.name, i.item_name)), '[]'::jsonb)
          FROM public.field_tools_sundry_package_items i
          LEFT JOIN public.field_tools_catalog_items c ON c.id = i.catalog_item_id
          WHERE i.package_id = p.id
        )
      ) ORDER BY p.sort_order, p.name), '[]'::jsonb)
      FROM public.field_tools_sundry_packages p
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_upsert_sundry_package(
  p_caller_id uuid,
  p_session_token text,
  p_package_id uuid,
  p_name text,
  p_sort_order integer,
  p_active boolean,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_name text := trim(coalesce(p_name, ''));
  item jsonb;
  idx integer := 0;
  v_catalog_id uuid;
  v_item_name text;
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id, p_session_token);

  IF v_name = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Package name is required.');
  END IF;

  IF p_package_id IS NULL THEN
    INSERT INTO public.field_tools_sundry_packages (name, sort_order, active, updated_at)
    VALUES (v_name, coalesce(p_sort_order, 0), coalesce(p_active, true), now())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.field_tools_sundry_packages
    SET name = v_name,
        sort_order = coalesce(p_sort_order, sort_order),
        active = coalesce(p_active, active),
        updated_at = now()
    WHERE id = p_package_id
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Package not found.');
    END IF;

    DELETE FROM public.field_tools_sundry_package_items WHERE package_id = v_id;
  END IF;

  IF p_items IS NOT NULL AND jsonb_typeof(p_items) = 'array' THEN
    FOR item IN SELECT value FROM jsonb_array_elements(p_items)
    LOOP
      idx := idx + 1;
      v_catalog_id := nullif(trim(item->>'catalog_item_id'), '')::uuid;
      IF v_catalog_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Each line item must be selected from the sundry catalog.');
      END IF;

      SELECT c.name INTO v_item_name
      FROM public.field_tools_catalog_items c
      WHERE c.id = v_catalog_id AND c.section = 'sundry' AND c.active;

      IF v_item_name IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Invalid or inactive catalog item.');
      END IF;

      INSERT INTO public.field_tools_sundry_package_items (
        package_id, catalog_item_id, item_name, default_qty, sort_order
      )
      VALUES (
        v_id,
        v_catalog_id,
        v_item_name,
        greatest(coalesce((item->>'qty')::numeric, 1), 0.001),
        coalesce((item->>'sort_order')::integer, idx)
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_delete_sundry_package(
  p_caller_id uuid,
  p_session_token text,
  p_package_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id, p_session_token);

  UPDATE public.field_tools_sundry_packages
  SET active = false, updated_at = now()
  WHERE id = p_package_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Package not found.');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_list_job_scope_kit(
  p_caller_id uuid,
  p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_tools_require_strict_admin(p_caller_id, p_session_token);
  RETURN jsonb_build_object(
    'ok', true,
    'scopes', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'icon', s.icon,
        'color', s.color,
        'sort_order', s.sort_order,
        'active', s.active,
        'materials', (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', m.id,
            'catalog_item_id', m.catalog_item_id,
            'name', m.name,
            'unit', m.unit,
            'default_qty', m.default_qty,
            'sort_order', m.sort_order
          ) ORDER BY m.sort_order, m.name), '[]'::jsonb)
          FROM public.field_tools_scope_materials m
          WHERE m.scope_id = s.id
        )
      ) ORDER BY s.sort_order, s.name), '[]'::jsonb)
      FROM public.field_tools_scope_library s
    ),
    'crew_kits', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', k.id,
        'name', k.name,
        'icon', k.icon,
        'color', k.color,
        'sort_order', k.sort_order,
        'active', k.active,
        'items', (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', i.id,
            'catalog_item_id', i.catalog_item_id,
            'name', i.name,
            'unit', i.unit,
            'qty_per_man', i.qty_per_man,
            'sort_order', i.sort_order
          ) ORDER BY i.sort_order, i.name), '[]'::jsonb)
          FROM public.field_tools_crew_kit_items i
          WHERE i.crew_kit_id = k.id
        )
      ) ORDER BY k.sort_order, k.name), '[]'::jsonb)
      FROM public.field_tools_crew_kits k
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_upsert_scope(
  p_caller_id uuid,
  p_session_token text,
  p_scope_id uuid,
  p_name text,
  p_icon text,
  p_color text,
  p_sort_order integer,
  p_active boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_name text := trim(coalesce(p_name, ''));
BEGIN
  PERFORM public.field_tools_require_strict_admin(p_caller_id, p_session_token);
  IF v_name = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Scope name is required.');
  END IF;

  IF p_scope_id IS NULL THEN
    INSERT INTO public.field_tools_scope_library (name, icon, color, sort_order, active)
    VALUES (v_name, coalesce(p_icon, ''), coalesce(nullif(trim(p_color), ''), '#2f81f7'), coalesce(p_sort_order, 0), coalesce(p_active, true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.field_tools_scope_library
    SET name = v_name,
        icon = coalesce(p_icon, icon),
        color = coalesce(nullif(trim(p_color), ''), color),
        sort_order = coalesce(p_sort_order, sort_order),
        active = coalesce(p_active, active)
    WHERE id = p_scope_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Scope not found.');
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_delete_scope(
  p_caller_id uuid,
  p_session_token text,
  p_scope_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_tools_require_strict_admin(p_caller_id, p_session_token);
  UPDATE public.field_tools_scope_library SET active = false WHERE id = p_scope_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Scope not found.');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_upsert_scope_material(
  p_caller_id uuid,
  p_session_token text,
  p_material_id uuid,
  p_scope_id uuid,
  p_catalog_item_id uuid,
  p_default_qty numeric,
  p_unit text,
  p_sort_order integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_name text;
BEGIN
  PERFORM public.field_tools_require_strict_admin(p_caller_id, p_session_token);

  IF p_scope_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Scope is required.');
  END IF;

  SELECT c.name INTO v_name
  FROM public.field_tools_catalog_items c
  WHERE c.id = p_catalog_item_id AND c.section = 'sundry' AND c.active;

  IF v_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Select an active sundry from the catalog.');
  END IF;

  IF p_material_id IS NULL THEN
    INSERT INTO public.field_tools_scope_materials (scope_id, catalog_item_id, name, unit, default_qty, sort_order)
    VALUES (
      p_scope_id,
      p_catalog_item_id,
      v_name,
      coalesce(nullif(trim(p_unit), ''), 'ea'),
      greatest(coalesce(p_default_qty, 1), 0.001),
      coalesce(p_sort_order, 0)
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.field_tools_scope_materials
    SET catalog_item_id = p_catalog_item_id,
        name = v_name,
        unit = coalesce(nullif(trim(p_unit), ''), unit),
        default_qty = greatest(coalesce(p_default_qty, default_qty), 0.001),
        sort_order = coalesce(p_sort_order, sort_order)
    WHERE id = p_material_id AND scope_id = p_scope_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Material not found.');
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_delete_scope_material(
  p_caller_id uuid,
  p_session_token text,
  p_material_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_tools_require_strict_admin(p_caller_id, p_session_token);
  DELETE FROM public.field_tools_scope_materials WHERE id = p_material_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Material not found.');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_upsert_crew_kit(
  p_caller_id uuid,
  p_session_token text,
  p_kit_id uuid,
  p_name text,
  p_icon text,
  p_color text,
  p_sort_order integer,
  p_active boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_name text := trim(coalesce(p_name, ''));
BEGIN
  PERFORM public.field_tools_require_strict_admin(p_caller_id, p_session_token);

  IF v_name = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Crew kit name is required.');
  END IF;

  IF p_kit_id IS NULL THEN
    INSERT INTO public.field_tools_crew_kits (name, icon, color, sort_order, active)
    VALUES (v_name, coalesce(p_icon, ''), coalesce(nullif(trim(p_color), ''), '#2f81f7'), coalesce(p_sort_order, 0), coalesce(p_active, true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.field_tools_crew_kits
    SET name = v_name,
        icon = coalesce(p_icon, icon),
        color = coalesce(nullif(trim(p_color), ''), color),
        sort_order = coalesce(p_sort_order, sort_order),
        active = coalesce(p_active, active)
    WHERE id = p_kit_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Crew kit not found.');
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_delete_crew_kit(
  p_caller_id uuid,
  p_session_token text,
  p_kit_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_tools_require_strict_admin(p_caller_id, p_session_token);
  UPDATE public.field_tools_crew_kits SET active = false WHERE id = p_kit_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Crew kit not found.');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_upsert_crew_kit_item(
  p_caller_id uuid,
  p_session_token text,
  p_item_id uuid,
  p_crew_kit_id uuid,
  p_catalog_item_id uuid,
  p_qty_per_man numeric,
  p_unit text,
  p_sort_order integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_name text;
BEGIN
  PERFORM public.field_tools_require_strict_admin(p_caller_id, p_session_token);

  IF p_crew_kit_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Crew kit is required.');
  END IF;

  SELECT c.name INTO v_name
  FROM public.field_tools_catalog_items c
  WHERE c.id = p_catalog_item_id AND c.section = 'sundry' AND c.active;

  IF v_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Select an active sundry from the catalog.');
  END IF;

  IF p_item_id IS NULL THEN
    INSERT INTO public.field_tools_crew_kit_items (crew_kit_id, catalog_item_id, name, unit, qty_per_man, sort_order)
    VALUES (
      p_crew_kit_id,
      p_catalog_item_id,
      v_name,
      coalesce(nullif(trim(p_unit), ''), 'ea'),
      greatest(coalesce(p_qty_per_man, 1), 0.001),
      coalesce(p_sort_order, 0)
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.field_tools_crew_kit_items
    SET catalog_item_id = p_catalog_item_id,
        name = v_name,
        unit = coalesce(nullif(trim(p_unit), ''), unit),
        qty_per_man = greatest(coalesce(p_qty_per_man, qty_per_man), 0.001),
        sort_order = coalesce(p_sort_order, sort_order)
    WHERE id = p_item_id AND crew_kit_id = p_crew_kit_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Kit item not found.');
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_delete_crew_kit_item(
  p_caller_id uuid,
  p_session_token text,
  p_item_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_tools_require_strict_admin(p_caller_id, p_session_token);
  DELETE FROM public.field_tools_crew_kit_items WHERE id = p_item_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Kit item not found.');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_list_po_sequences(
  p_caller_id uuid,
  p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id, p_session_token);
  RETURN jsonb_build_object(
    'ok', true,
    'sequences', (
      WITH codes AS (
        SELECT job_code FROM public.field_tools_po_job_sequences
        UNION
        SELECT DISTINCT public.field_tools_po_normalize_job_code(o.job_number)
        FROM public.field_tools_orders o
        WHERE trim(coalesce(o.job_number, '')) <> ''
      )
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'job_code', c.job_code,
        'highest_issued', public.field_tools_po_highest_issued(c.job_code),
        'next_seq', coalesce(
          j.next_seq,
          public.field_tools_po_highest_issued(c.job_code) + 1
        ),
        'has_override', j.job_code IS NOT NULL,
        'updated_at', j.updated_at
      ) ORDER BY c.job_code), '[]'::jsonb)
      FROM codes c
      LEFT JOIN public.field_tools_po_job_sequences j ON j.job_code = c.job_code
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_upsert_po_job_sequence(
  p_caller_id uuid,
  p_session_token text,
  p_job_code text,
  p_next_seq integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  clean text;
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id, p_session_token);

  clean := public.field_tools_po_normalize_job_code(p_job_code);
  IF clean = 'JOB' AND trim(coalesce(p_job_code, '')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Job code is required.');
  END IF;

  IF p_next_seq IS NULL OR p_next_seq < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Next sequence must be at least 1.');
  END IF;

  IF p_next_seq <= public.field_tools_po_highest_issued(clean) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error',
      format('Next sequence must be greater than highest issued (%s).', public.field_tools_po_highest_issued(clean))
    );
  END IF;

  INSERT INTO public.field_tools_po_job_sequences (job_code, next_seq, updated_at)
  VALUES (clean, p_next_seq, now())
  ON CONFLICT (job_code) DO UPDATE SET
    next_seq = EXCLUDED.next_seq,
    updated_at = now();

  RETURN jsonb_build_object('ok', true, 'job_code', clean, 'next_seq', p_next_seq);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_delete_po_job_sequence(
  p_caller_id uuid,
  p_session_token text,
  p_job_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  clean text;
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id, p_session_token);
  clean := public.field_tools_po_normalize_job_code(p_job_code);
  DELETE FROM public.field_tools_po_job_sequences WHERE job_code = clean;
  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.field_tools_admin_list_profiles(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_upsert_profile(uuid, text, uuid, text, text, text, text, text, boolean, text[], uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_list_vendors(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_upsert_vendor(uuid, text, uuid, text, text, text, text, integer, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_list_catalog(uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_upsert_catalog_item(uuid, text, uuid, text, text, text, integer, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_delete_catalog_item(uuid, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_list_custom_modules(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_upsert_custom_module(uuid, text, uuid, text, text, text, integer, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_delete_custom_module(uuid, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_reorder_catalog(uuid, text, text, text, uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_get_order_settings(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_upsert_order_settings(uuid, text, text, text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_list_orders_by_job(uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_list_sundry_packages(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_upsert_sundry_package(uuid, text, uuid, text, integer, boolean, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_delete_sundry_package(uuid, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_list_job_scope_kit(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_upsert_scope(uuid, text, uuid, text, text, text, integer, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_delete_scope(uuid, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_upsert_scope_material(uuid, text, uuid, uuid, uuid, numeric, text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_delete_scope_material(uuid, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_upsert_crew_kit(uuid, text, uuid, text, text, text, integer, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_delete_crew_kit(uuid, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_upsert_crew_kit_item(uuid, text, uuid, uuid, uuid, numeric, text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_delete_crew_kit_item(uuid, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_list_po_sequences(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_upsert_po_job_sequence(uuid, text, text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_delete_po_job_sequence(uuid, text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
