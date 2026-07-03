-- Field View access: require either an approved office session or a valid
-- Field Tools session token. Keeps the field-facing data shape from 062.

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
  v_profile uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND public.is_approved_user(auth.uid()) THEN
    RETURN;
  END IF;

  IF p_caller_id IS NULL OR p_session_token IS NULL OR trim(p_session_token) = '' THEN
    RAISE EXCEPTION 'FIELD_VIEW_LOGIN_REQUIRED' USING ERRCODE = 'P0001';
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
    SELECT 1
    FROM public.field_tools_profiles
    WHERE id = p_caller_id AND active = true
  ) THEN
    RAISE EXCEPTION 'INVALID_SESSION' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.field_view_list_projects();
DROP FUNCTION IF EXISTS public.field_view_get_project(uuid);
DROP FUNCTION IF EXISTS public.field_view_company_name();
DROP FUNCTION IF EXISTS public.field_view_commit_project_update(uuid, jsonb, text, text, text);

CREATE OR REPLACE FUNCTION public.field_view_list_projects(
  p_caller_id uuid DEFAULT NULL,
  p_session_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_view_require_access(p_caller_id, p_session_token);

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
BEGIN
  PERFORM public.field_view_require_access(p_caller_id, p_session_token);

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

CREATE OR REPLACE FUNCTION public.field_view_company_name(
  p_caller_id uuid DEFAULT NULL,
  p_session_token text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
BEGIN
  PERFORM public.field_view_require_access(p_caller_id, p_session_token);

  SELECT coalesce(nullif(trim(settings->>'company_name'), ''), '')
  INTO v_name
  FROM public.org_settings
  WHERE id = 1;

  RETURN coalesce(v_name, '');
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
BEGIN
  PERFORM public.field_view_require_access(p_caller_id, p_session_token);

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

GRANT EXECUTE ON FUNCTION public.field_view_require_access(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_view_list_projects(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_view_get_project(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_view_company_name(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_view_commit_project_update(uuid, jsonb, text, text, text, uuid, text) TO anon, authenticated;

UPDATE public.field_tools_profiles
SET modules = array_append(modules, 'field_view'),
    updated_at = now()
WHERE active = true
  AND NOT ('field_view' = ANY(modules));
