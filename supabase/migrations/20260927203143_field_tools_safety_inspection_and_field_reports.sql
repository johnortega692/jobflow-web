-- Safety inspections and field reports created in Field Tools, readable on the job in JobFlow.

CREATE TABLE IF NOT EXISTS public.field_tools_safety_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  job_number text NOT NULL DEFAULT '',
  job_name text NOT NULL DEFAULT '',
  week_ending date NOT NULL,
  inspector_name text NOT NULL DEFAULT '',
  inspection_date date,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  other_concerns text NOT NULL DEFAULT '',
  accident_attached boolean NOT NULL DEFAULT false,
  submitted_by_profile_id uuid NOT NULL REFERENCES public.field_tools_profiles(id),
  submitted_by_name text NOT NULL DEFAULT '',
  completed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS field_tools_safety_inspections_project_idx
  ON public.field_tools_safety_inspections (project_id, completed_at DESC);

CREATE INDEX IF NOT EXISTS field_tools_safety_inspections_submitter_idx
  ON public.field_tools_safety_inspections (submitted_by_profile_id, completed_at DESC);

CREATE TABLE IF NOT EXISTS public.field_tools_field_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  job_number text NOT NULL DEFAULT '',
  job_name text NOT NULL DEFAULT '',
  report_date date NOT NULL,
  superintendent text NOT NULL DEFAULT '',
  contractor text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  weather jsonb NOT NULL DEFAULT '{}'::jsonb,
  manpower jsonb NOT NULL DEFAULT '[]'::jsonb,
  materials text NOT NULL DEFAULT '',
  work_performed text NOT NULL DEFAULT '',
  delays text[] NOT NULL DEFAULT '{}'::text[],
  delay_notes text NOT NULL DEFAULT '',
  toolbox_talk text NOT NULL DEFAULT '',
  incidents text NOT NULL DEFAULT '',
  ppe_housekeeping text NOT NULL DEFAULT '',
  safety_notes text NOT NULL DEFAULT '',
  reported_by text NOT NULL DEFAULT '',
  reporter_title text NOT NULL DEFAULT '',
  submitted_by_profile_id uuid NOT NULL REFERENCES public.field_tools_profiles(id),
  submitted_by_name text NOT NULL DEFAULT '',
  completed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS field_tools_field_reports_project_idx
  ON public.field_tools_field_reports (project_id, completed_at DESC);

CREATE INDEX IF NOT EXISTS field_tools_field_reports_submitter_idx
  ON public.field_tools_field_reports (submitted_by_profile_id, report_date DESC);

ALTER TABLE public.field_tools_safety_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_tools_field_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS field_tools_safety_inspections_deny ON public.field_tools_safety_inspections;
CREATE POLICY field_tools_safety_inspections_deny ON public.field_tools_safety_inspections
  FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS field_tools_field_reports_deny ON public.field_tools_field_reports;
CREATE POLICY field_tools_field_reports_deny ON public.field_tools_field_reports
  FOR ALL USING (false) WITH CHECK (false);

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
      RETURN ARRAY['ordering', 'job_scope_kit', 'field_view', 'safety_tailgate', 'safety_inspection', 'daily_report', 'admin']::text[];
    END IF;
    RETURN ARRAY['ordering', 'job_scope_kit', 'field_view', 'safety_tailgate', 'safety_inspection', 'daily_report']::text[];
  END IF;

  FOREACH m IN ARRAY p_modules LOOP
    IF m IN ('ordering', 'job_scope_kit', 'pm_order', 'field_view', 'safety_tailgate', 'safety_inspection', 'daily_report', 'admin') THEN
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

UPDATE public.field_tools_profiles
SET modules = array_append(modules, 'safety_inspection')
WHERE NOT ('safety_inspection' = ANY (modules));

UPDATE public.field_tools_profiles
SET modules = array_append(modules, 'daily_report')
WHERE NOT ('daily_report' = ANY (modules));

UPDATE public.field_tools_custom_modules
SET active = false, updated_at = now()
WHERE active = true
  AND title IN ('Field Reports - Daily', 'Safety Inspection - Weekly');

CREATE OR REPLACE FUNCTION public.field_tools_submit_safety_inspection(
  p_caller_id uuid,
  p_session_token text,
  p_project_id uuid,
  p_job_number text,
  p_job_name text,
  p_week_ending date,
  p_inspector_name text,
  p_inspection_date date,
  p_items jsonb,
  p_other_concerns text,
  p_accident_attached boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.field_tools_profiles%ROWTYPE;
  v_item jsonb;
  v_status text;
  v_id uuid;
  v_count int := 0;
BEGIN
  PERFORM public.field_tools_require_session(p_caller_id, p_session_token);

  SELECT * INTO v_profile
  FROM public.field_tools_profiles
  WHERE id = p_caller_id AND active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Profile not found');
  END IF;

  IF trim(coalesce(p_job_number, '')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pick a job for this inspection.');
  END IF;
  IF p_week_ending IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Week ending is required.');
  END IF;
  IF trim(coalesce(p_inspector_name, '')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Inspector name is required.');
  END IF;
  IF p_project_id IS NOT NULL
     AND NOT public.field_tools_profile_can_access_project(p_caller_id, p_project_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'You don''t have access to this job.');
  END IF;
  IF jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Review each checklist item.');
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_status := lower(trim(coalesce(v_item->>'status', '')));
    IF trim(coalesce(v_item->>'name', '')) = '' OR v_status NOT IN ('ok', 'attention', 'na') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Review each checklist item.');
    END IF;
    v_count := v_count + 1;
  END LOOP;

  IF v_count < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Review each checklist item.');
  END IF;

  INSERT INTO public.field_tools_safety_inspections (
    project_id, job_number, job_name, week_ending, inspector_name, inspection_date,
    items, other_concerns, accident_attached, submitted_by_profile_id, submitted_by_name
  ) VALUES (
    p_project_id,
    trim(p_job_number),
    trim(coalesce(p_job_name, '')),
    p_week_ending,
    trim(p_inspector_name),
    p_inspection_date,
    p_items,
    trim(coalesce(p_other_concerns, '')),
    coalesce(p_accident_attached, false),
    p_caller_id,
    coalesce(nullif(trim(v_profile.name), ''), 'Field user')
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_submit_field_report(
  p_caller_id uuid,
  p_session_token text,
  p_project_id uuid,
  p_job_number text,
  p_job_name text,
  p_report_date date,
  p_superintendent text,
  p_contractor text,
  p_location text,
  p_weather jsonb,
  p_manpower jsonb,
  p_materials text,
  p_work_performed text,
  p_delays text[],
  p_delay_notes text,
  p_toolbox_talk text,
  p_incidents text,
  p_ppe_housekeeping text,
  p_safety_notes text,
  p_reported_by text,
  p_reporter_title text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.field_tools_profiles%ROWTYPE;
  v_id uuid;
BEGIN
  PERFORM public.field_tools_require_session(p_caller_id, p_session_token);

  SELECT * INTO v_profile
  FROM public.field_tools_profiles
  WHERE id = p_caller_id AND active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Profile not found');
  END IF;

  IF trim(coalesce(p_job_number, '')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pick a job for this report.');
  END IF;
  IF p_report_date IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Report date is required.');
  END IF;
  IF trim(coalesce(p_reported_by, '')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Reported by is required.');
  END IF;
  IF p_project_id IS NOT NULL
     AND NOT public.field_tools_profile_can_access_project(p_caller_id, p_project_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'You don''t have access to this job.');
  END IF;

  INSERT INTO public.field_tools_field_reports (
    project_id, job_number, job_name, report_date, superintendent, contractor, location,
    weather, manpower, materials, work_performed, delays, delay_notes,
    toolbox_talk, incidents, ppe_housekeeping, safety_notes,
    reported_by, reporter_title, submitted_by_profile_id, submitted_by_name
  ) VALUES (
    p_project_id,
    trim(p_job_number),
    trim(coalesce(p_job_name, '')),
    p_report_date,
    trim(coalesce(p_superintendent, '')),
    trim(coalesce(p_contractor, '')),
    trim(coalesce(p_location, '')),
    coalesce(p_weather, '{}'::jsonb),
    coalesce(p_manpower, '[]'::jsonb),
    trim(coalesce(p_materials, '')),
    trim(coalesce(p_work_performed, '')),
    coalesce(p_delays, '{}'::text[]),
    trim(coalesce(p_delay_notes, '')),
    lower(trim(coalesce(p_toolbox_talk, ''))),
    lower(trim(coalesce(p_incidents, ''))),
    lower(trim(coalesce(p_ppe_housekeeping, ''))),
    trim(coalesce(p_safety_notes, '')),
    trim(p_reported_by),
    trim(coalesce(p_reporter_title, '')),
    p_caller_id,
    coalesce(nullif(trim(v_profile.name), ''), 'Field user')
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_safety_record_due(
  p_caller_id uuid,
  p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Los_Angeles')::date;
  v_week text;
BEGIN
  PERFORM public.field_tools_require_session(p_caller_id, p_session_token);
  v_week := public.field_tools_link_period_key('weekly', now());

  RETURN jsonb_build_object(
    'ok', true,
    'field_report_due', NOT EXISTS (
      SELECT 1
      FROM public.field_tools_field_reports r
      WHERE r.submitted_by_profile_id = p_caller_id
        AND r.report_date = v_today
    ),
    'field_report_due_label', 'Due today',
    'inspection_due', NOT EXISTS (
      SELECT 1
      FROM public.field_tools_safety_inspections i
      WHERE i.submitted_by_profile_id = p_caller_id
        AND public.field_tools_link_period_key('weekly', i.completed_at) = v_week
    ),
    'inspection_due_label', 'Due this week'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_safety_inspections_for_jobflow(p_project_id uuid)
RETURNS TABLE (
  id uuid,
  week_ending date,
  inspector_name text,
  inspection_date date,
  submitted_by_name text,
  completed_at timestamptz,
  other_concerns text,
  accident_attached boolean,
  ok_count integer,
  attention_count integer,
  na_count integer,
  items jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    i.id,
    i.week_ending,
    i.inspector_name,
    i.inspection_date,
    coalesce(nullif(trim(i.submitted_by_name), ''), 'Field user'),
    i.completed_at,
    i.other_concerns,
    i.accident_attached,
    (SELECT count(*)::integer FROM jsonb_array_elements(i.items) e WHERE e->>'status' = 'ok'),
    (SELECT count(*)::integer FROM jsonb_array_elements(i.items) e WHERE e->>'status' = 'attention'),
    (SELECT count(*)::integer FROM jsonb_array_elements(i.items) e WHERE e->>'status' = 'na'),
    i.items
  FROM public.field_tools_safety_inspections i
  JOIN public.projects p ON p.id = p_project_id
  WHERE public.is_approved_user(auth.uid())
    AND (
      i.project_id = p.id
      OR (
        i.project_id IS NULL
        AND trim(i.job_number) <> ''
        AND trim(i.job_number) = trim(p.job_number)
      )
    )
  ORDER BY i.completed_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.list_field_reports_for_jobflow(p_project_id uuid)
RETURNS TABLE (
  id uuid,
  report_date date,
  job_name text,
  superintendent text,
  contractor text,
  location text,
  weather jsonb,
  manpower jsonb,
  materials text,
  work_performed text,
  delays text[],
  delay_notes text,
  toolbox_talk text,
  incidents text,
  ppe_housekeeping text,
  safety_notes text,
  reported_by text,
  reporter_title text,
  submitted_by_name text,
  completed_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.id,
    r.report_date,
    r.job_name,
    r.superintendent,
    r.contractor,
    r.location,
    r.weather,
    r.manpower,
    r.materials,
    r.work_performed,
    r.delays,
    r.delay_notes,
    r.toolbox_talk,
    r.incidents,
    r.ppe_housekeeping,
    r.safety_notes,
    r.reported_by,
    r.reporter_title,
    coalesce(nullif(trim(r.submitted_by_name), ''), 'Field user'),
    r.completed_at
  FROM public.field_tools_field_reports r
  JOIN public.projects p ON p.id = p_project_id
  WHERE public.is_approved_user(auth.uid())
    AND (
      r.project_id = p.id
      OR (
        r.project_id IS NULL
        AND trim(r.job_number) <> ''
        AND trim(r.job_number) = trim(p.job_number)
      )
    )
  ORDER BY r.report_date DESC, r.completed_at DESC;
$$;

REVOKE ALL ON FUNCTION public.field_tools_submit_safety_inspection(uuid, text, uuid, text, text, date, text, date, jsonb, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.field_tools_submit_field_report(uuid, text, uuid, text, text, date, text, text, text, jsonb, jsonb, text, text, text[], text, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.field_tools_safety_record_due(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_safety_inspections_for_jobflow(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_field_reports_for_jobflow(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.field_tools_submit_safety_inspection(uuid, text, uuid, text, text, date, text, date, jsonb, text, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_submit_field_report(uuid, text, uuid, text, text, date, text, text, text, jsonb, jsonb, text, text, text[], text, text, text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_safety_record_due(uuid, text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.list_safety_inspections_for_jobflow(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.list_field_reports_for_jobflow(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_safety_inspections_for_jobflow(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_field_reports_for_jobflow(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
