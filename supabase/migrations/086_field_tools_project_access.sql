-- Field Tools job access: all jobs vs assigned jobs.
-- Existing profiles keep all-jobs. New foreman/laborer default to assigned.
-- Only admin can grant all-jobs. Super can assign jobs they themselves can see.

ALTER TABLE public.field_tools_profiles
  ADD COLUMN IF NOT EXISTS job_access text NOT NULL DEFAULT 'all';

ALTER TABLE public.field_tools_profiles
  DROP CONSTRAINT IF EXISTS field_tools_profiles_job_access_check;

ALTER TABLE public.field_tools_profiles
  ADD CONSTRAINT field_tools_profiles_job_access_check
  CHECK (job_access IN ('all', 'assigned'));

UPDATE public.field_tools_profiles
SET job_access = 'all'
WHERE job_access IS DISTINCT FROM 'all';

CREATE TABLE IF NOT EXISTS public.field_tools_project_access (
  profile_id uuid NOT NULL REFERENCES public.field_tools_profiles (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, project_id)
);

CREATE INDEX IF NOT EXISTS field_tools_project_access_project_idx
  ON public.field_tools_project_access (project_id);

ALTER TABLE public.field_tools_project_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS field_tools_project_access_deny_anon ON public.field_tools_project_access;
CREATE POLICY field_tools_project_access_deny_anon ON public.field_tools_project_access
  FOR ALL TO anon USING (false);

-- ── Helpers ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.field_tools_valid_session_profile_id(
  p_caller_id uuid,
  p_session_token text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_profile uuid;
BEGIN
  IF p_caller_id IS NULL OR p_session_token IS NULL OR trim(p_session_token) = '' THEN
    RETURN NULL;
  END IF;

  SELECT s.profile_id INTO v_profile
  FROM public.field_tools_sessions s
  WHERE s.token_hash = encode(extensions.digest(trim(p_session_token), 'sha256'), 'hex')
    AND s.expires_at > now()
    AND s.revoked_at IS NULL
    AND s.profile_id = p_caller_id;

  IF v_profile IS NULL THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.field_tools_profiles WHERE id = v_profile AND active = true
  ) THEN
    RETURN NULL;
  END IF;

  RETURN v_profile;
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_profile_can_access_project(
  p_profile_id uuid,
  p_project_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.field_tools_profiles p
    WHERE p.id = p_profile_id
      AND p.active = true
      AND (
        p.job_access = 'all'
        OR EXISTS (
          SELECT 1
          FROM public.field_tools_project_access a
          WHERE a.profile_id = p.id
            AND a.project_id = p_project_id
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.field_tools_valid_session_profile_id(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.field_tools_profile_can_access_project(uuid, uuid) FROM PUBLIC;

-- ── Field View list / get / commit honor Field Tools job access ──────────

CREATE OR REPLACE FUNCTION public.field_view_list_projects(
  p_caller_id uuid DEFAULT NULL,
  p_session_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ft_profile uuid;
BEGIN
  PERFORM public.field_view_require_access(p_caller_id, p_session_token);
  v_ft_profile := public.field_tools_valid_session_profile_id(p_caller_id, p_session_token);

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
    WHERE v_ft_profile IS NULL
       OR public.field_tools_profile_can_access_project(v_ft_profile, p.id)
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_view_get_project(
  p_project_id uuid,
  p_caller_id uuid DEFAULT NULL,
  p_session_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.projects%ROWTYPE;
  v_ft_profile uuid;
BEGIN
  PERFORM public.field_view_require_access(p_caller_id, p_session_token);
  v_ft_profile := public.field_tools_valid_session_profile_id(p_caller_id, p_session_token);

  IF v_ft_profile IS NOT NULL
     AND NOT public.field_tools_profile_can_access_project(v_ft_profile, p_project_id) THEN
    RETURN NULL;
  END IF;

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

CREATE OR REPLACE FUNCTION public.field_view_commit_project_update(
  p_project_id uuid,
  p_merge_data jsonb,
  p_action text,
  p_summary text,
  p_user_name text DEFAULT 'Field view',
  p_caller_id uuid DEFAULT NULL,
  p_session_token text DEFAULT NULL
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
  v_ft_profile uuid;
BEGIN
  PERFORM public.field_view_require_access(p_caller_id, p_session_token);
  v_ft_profile := public.field_tools_valid_session_profile_id(p_caller_id, p_session_token);

  IF v_ft_profile IS NOT NULL
     AND NOT public.field_tools_profile_can_access_project(v_ft_profile, p_project_id) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = 'P0001';
  END IF;

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

  v_merged := coalesce(v_data, '{}'::jsonb) || p_merge_data;

  UPDATE public.projects
  SET data = v_merged,
      updated_at = now()
  WHERE id = p_project_id;

  INSERT INTO public.project_activity (project_id, user_id, user_name, action, summary)
  VALUES (
    p_project_id,
    NULL,
    coalesce(nullif(trim(p_user_name), ''), 'Field view'),
    coalesce(nullif(trim(p_action), ''), 'project_data_saved'),
    coalesce(nullif(trim(p_summary), ''), 'Field view updated')
  );
END;
$$;

-- ── Admin list / upsert ──────────────────────────────────────────────────

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
        'job_access', p.job_access,
        'projects', (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', pr.id,
            'job_number', pr.job_number,
            'job_name', pr.job_name
          ) ORDER BY pr.job_number), '[]'::jsonb)
          FROM public.field_tools_project_access a
          JOIN public.projects pr ON pr.id = a.project_id
          WHERE a.profile_id = p.id
        ),
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

DROP FUNCTION IF EXISTS public.field_tools_admin_upsert_profile(uuid, uuid, text, text, text, text, text, boolean);
DROP FUNCTION IF EXISTS public.field_tools_admin_upsert_profile(uuid, text, uuid, text, text, text, text, text, boolean, text[], uuid[]);

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
  p_custom_module_ids uuid[] DEFAULT NULL,
  p_job_access text DEFAULT NULL,
  p_project_ids uuid[] DEFAULT NULL
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
  v_caller_role text;
  v_existing_access text;
  v_access text;
  v_project_id uuid;
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id, p_session_token);

  SELECT role INTO v_caller_role
  FROM public.field_tools_profiles
  WHERE id = p_caller_id AND active = true;

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

  IF p_profile_id IS NOT NULL THEN
    SELECT job_access INTO v_existing_access
    FROM public.field_tools_profiles
    WHERE id = p_profile_id;
  END IF;

  IF p_job_access IS NULL OR trim(p_job_access) = '' THEN
    IF p_profile_id IS NULL THEN
      v_access := CASE
        WHEN p_role IN ('admin', 'super') AND v_caller_role = 'admin' THEN 'all'
        ELSE 'assigned'
      END;
    ELSE
      v_access := NULL;
    END IF;
  ELSE
    v_access := trim(p_job_access);
    IF v_access NOT IN ('all', 'assigned') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Invalid job access');
    END IF;
    IF v_access = 'all' AND v_caller_role = 'super' THEN
      IF p_profile_id IS NULL OR coalesce(v_existing_access, '') IS DISTINCT FROM 'all' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Only admin can grant all jobs');
      END IF;
    END IF;
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

    INSERT INTO public.field_tools_profiles (person_id, name, email, phone, pin_hash, role, modules, active, job_access)
    VALUES (
      v_person_id,
      trim(p_name),
      coalesce(p_email, ''),
      coalesce(p_phone, ''),
      (SELECT pin_hash FROM public.org_people WHERE id = v_person_id),
      p_role,
      mods,
      coalesce(p_active, true),
      coalesce(v_access, 'assigned')
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
      job_access = CASE
        WHEN v_access IS NULL THEN job_access
        ELSE v_access
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

  IF p_project_ids IS NOT NULL THEN
    DELETE FROM public.field_tools_project_access WHERE profile_id = pid;
    FOREACH v_project_id IN ARRAY p_project_ids LOOP
      IF v_project_id IS NULL THEN
        CONTINUE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = v_project_id) THEN
        CONTINUE;
      END IF;
      IF v_caller_role <> 'admin'
         AND NOT public.field_tools_profile_can_access_project(p_caller_id, v_project_id) THEN
        CONTINUE;
      END IF;
      INSERT INTO public.field_tools_project_access (profile_id, project_id)
      VALUES (pid, v_project_id)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', pid);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
END;
$$;

GRANT EXECUTE ON FUNCTION public.field_tools_admin_list_profiles(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_upsert_profile(uuid, text, uuid, text, text, text, text, text, boolean, text[], uuid[], text, uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_view_list_projects(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_view_get_project(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_view_commit_project_update(uuid, jsonb, text, text, text, uuid, text) TO anon, authenticated;
