-- Digital extra-work tags. Per-profile module, granted only to Field Tools admins while testing.

CREATE TABLE IF NOT EXISTS public.field_tools_extra_work_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects (id) ON DELETE SET NULL,
  job_number text NOT NULL DEFAULT '',
  job_name text NOT NULL DEFAULT '',
  tag_number text NOT NULL DEFAULT '',
  tag_date date NOT NULL,
  area text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  hours jsonb NOT NULL DEFAULT '[]'::jsonb,
  materials jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft')),
  submitted_by_profile_id uuid NOT NULL REFERENCES public.field_tools_profiles (id),
  submitted_by_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS field_tools_extra_work_tags_project_idx
  ON public.field_tools_extra_work_tags (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS field_tools_extra_work_tags_submitter_idx
  ON public.field_tools_extra_work_tags (submitted_by_profile_id, updated_at DESC);

DROP TRIGGER IF EXISTS field_tools_extra_work_tags_updated_at ON public.field_tools_extra_work_tags;
CREATE TRIGGER field_tools_extra_work_tags_updated_at
  BEFORE UPDATE ON public.field_tools_extra_work_tags
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.field_tools_extra_work_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS field_tools_extra_work_tags_admin_read ON public.field_tools_extra_work_tags;
CREATE POLICY field_tools_extra_work_tags_admin_read
  ON public.field_tools_extra_work_tags
  FOR SELECT TO authenticated
  USING (
    public.is_approved_user(auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.profiles pr
      WHERE pr.id = auth.uid()
        AND pr.app_role = 'admin'
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.field_tools_extra_work_tags FROM anon, authenticated;

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
    IF p_role = 'admin' THEN
      RETURN ARRAY['ordering', 'job_scope_kit', 'field_view', 'safety_tailgate', 'safety_inspection', 'daily_report', 'tool_inventory', 'store_capture', 'extra_work', 'admin']::text[];
    END IF;
    IF p_role = 'super' THEN
      RETURN ARRAY['ordering', 'job_scope_kit', 'field_view', 'safety_tailgate', 'safety_inspection', 'daily_report', 'tool_inventory', 'store_capture', 'admin']::text[];
    END IF;
    RETURN ARRAY['ordering', 'job_scope_kit', 'field_view', 'safety_tailgate', 'safety_inspection', 'daily_report', 'tool_inventory']::text[];
  END IF;

  FOREACH m IN ARRAY p_modules LOOP
    IF m IN (
      'ordering',
      'job_scope_kit',
      'pm_order',
      'field_view',
      'safety_tailgate',
      'safety_inspection',
      'daily_report',
      'tool_inventory',
      'rentals',
      'reimbursements',
      'store_capture',
      'extra_work',
      'admin'
    ) THEN
      IF m = 'admin' AND p_role NOT IN ('admin', 'super') THEN
        CONTINUE;
      END IF;
      IF m = 'store_capture' AND p_role NOT IN ('admin', 'super') THEN
        CONTINUE;
      END IF;
      IF NOT (m = ANY (allowed)) THEN
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

UPDATE public.field_tools_profiles
SET modules = public.field_tools_sanitize_profile_modules(
  role,
  CASE
    WHEN modules IS NULL THEN NULL
    ELSE array_append(modules, 'extra_work')
  END
)
WHERE role = 'admin'
  AND (modules IS NULL OR NOT ('extra_work' = ANY (modules)));

CREATE OR REPLACE FUNCTION public.next_ewo_number(p_project_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max int := 0;
  v_n int;
BEGIN
  IF p_project_id IS NULL THEN
    RETURN '001';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_approved_user(auth.uid()) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  FOR v_n IN
    SELECT NULLIF(regexp_replace(ewo_number, '\D', '', 'g'), '')::int
    FROM public.work_orders
    WHERE project_id = p_project_id
    UNION ALL
    SELECT NULLIF(regexp_replace(tag_number, '\D', '', 'g'), '')::int
    FROM public.field_tools_extra_work_tags
    WHERE project_id = p_project_id
  LOOP
    IF v_n IS NOT NULL AND v_n > v_max THEN
      v_max := v_n;
    END IF;
  END LOOP;

  RETURN lpad((v_max + 1)::text, 3, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_save_extra_work_tag(
  p_caller_id uuid,
  p_session_token text,
  p_id uuid,
  p_project_id uuid,
  p_job_number text,
  p_job_name text,
  p_tag_date date,
  p_area text,
  p_description text,
  p_hours jsonb,
  p_materials jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.field_tools_profiles%ROWTYPE;
  v_existing public.field_tools_extra_work_tags%ROWTYPE;
  v_hours jsonb := '[]'::jsonb;
  v_materials jsonb := '[]'::jsonb;
  v_item jsonb;
  v_trade text;
  v_name text;
  v_qty text;
  v_hrs numeric;
  v_id uuid;
  v_number text;
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

  IF p_project_id IS NULL OR trim(coalesce(p_job_number, '')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pick a job for this tag.');
  END IF;
  IF NOT public.field_tools_profile_can_access_project(p_caller_id, p_project_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'You don''t have access to this job.');
  END IF;
  IF p_tag_date IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Date is required.');
  END IF;
  IF trim(coalesce(p_description, '')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Describe the extra work.');
  END IF;

  IF jsonb_typeof(coalesce(p_hours, '[]'::jsonb)) = 'array' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_hours)
    LOOP
      v_trade := trim(coalesce(v_item->>'trade', ''));
      BEGIN
        v_hrs := coalesce((v_item->>'hours')::numeric, 0);
      EXCEPTION WHEN others THEN
        v_hrs := 0;
      END;
      IF v_trade = '' OR v_hrs <= 0 THEN
        CONTINUE;
      END IF;
      v_hours := v_hours || jsonb_build_array(jsonb_build_object('trade', v_trade, 'hours', v_hrs));
    END LOOP;
  END IF;

  IF jsonb_typeof(coalesce(p_materials, '[]'::jsonb)) = 'array' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_materials)
    LOOP
      v_name := trim(coalesce(v_item->>'name', ''));
      v_qty := trim(coalesce(v_item->>'quantity', ''));
      IF v_name = '' THEN
        CONTINUE;
      END IF;
      v_materials := v_materials || jsonb_build_array(jsonb_build_object('name', v_name, 'quantity', v_qty));
    END LOOP;
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.field_tools_extra_work_tags
    WHERE id = p_id AND submitted_by_profile_id = p_caller_id AND status = 'draft';
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'That draft could not be updated.');
    END IF;
    UPDATE public.field_tools_extra_work_tags
    SET
      project_id = p_project_id,
      job_number = trim(p_job_number),
      job_name = trim(coalesce(p_job_name, '')),
      tag_date = p_tag_date,
      area = trim(coalesce(p_area, '')),
      description = trim(p_description),
      hours = v_hours,
      materials = v_materials
    WHERE id = p_id
    RETURNING id, tag_number INTO v_id, v_number;
  ELSE
    v_number := public.next_ewo_number(p_project_id);
    INSERT INTO public.field_tools_extra_work_tags (
      project_id, job_number, job_name, tag_number, tag_date, area, description,
      hours, materials, submitted_by_profile_id, submitted_by_name
    ) VALUES (
      p_project_id,
      trim(p_job_number),
      trim(coalesce(p_job_name, '')),
      v_number,
      p_tag_date,
      trim(coalesce(p_area, '')),
      trim(p_description),
      v_hours,
      v_materials,
      p_caller_id,
      coalesce(nullif(trim(v_profile.name), ''), 'Field user')
    )
    RETURNING id, tag_number INTO v_id, v_number;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'tag_number', v_number);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_list_my_extra_work_tags(
  p_caller_id uuid,
  p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.field_tools_profiles%ROWTYPE;
BEGIN
  PERFORM public.field_tools_require_session(p_caller_id, p_session_token);

  SELECT * INTO v_profile
  FROM public.field_tools_profiles
  WHERE id = p_caller_id AND active = true;
  IF NOT FOUND OR NOT ('extra_work' = ANY (coalesce(v_profile.modules, '{}'::text[]))) THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(t) ORDER BY t.updated_at DESC)
    FROM (
      SELECT id, project_id, job_number, job_name, tag_number, tag_date, area, description,
             hours, materials, status, submitted_by_name, updated_at
      FROM public.field_tools_extra_work_tags
      WHERE submitted_by_profile_id = p_caller_id
    ) t
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_extra_work_tags_for_jobflow(p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_approved_user(auth.uid()) THEN
    RETURN '[]'::jsonb;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles pr
    WHERE pr.id = auth.uid() AND pr.app_role = 'admin'
  ) THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(t) ORDER BY t.tag_number DESC, t.updated_at DESC)
    FROM (
      SELECT id, tag_number, tag_date, area, description, hours, materials, status,
             submitted_by_name, updated_at
      FROM public.field_tools_extra_work_tags
      WHERE project_id = p_project_id
    ) t
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.next_ewo_number(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.field_tools_save_extra_work_tag(uuid, text, uuid, uuid, text, text, date, text, text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.field_tools_list_my_extra_work_tags(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_extra_work_tags_for_jobflow(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.next_ewo_number(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_save_extra_work_tag(uuid, text, uuid, uuid, text, text, date, text, text, jsonb, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_list_my_extra_work_tags(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_extra_work_tags_for_jobflow(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
