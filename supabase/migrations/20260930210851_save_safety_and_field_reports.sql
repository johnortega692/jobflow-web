-- Let crews save a safety inspection or field report, reopen it, correct it, and send it again.
-- Field report photos stay on the device. A saved report never stores image bytes.

ALTER TABLE public.field_tools_safety_inspections
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

ALTER TABLE public.field_tools_field_reports
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE public.field_tools_safety_inspections
SET status = 'submitted'
WHERE status IS NULL OR status NOT IN ('saved', 'submitted');

UPDATE public.field_tools_field_reports
SET status = 'submitted'
WHERE status IS NULL OR status NOT IN ('saved', 'submitted');

UPDATE public.field_tools_safety_inspections
SET updated_at = completed_at
WHERE updated_at IS NULL;

UPDATE public.field_tools_field_reports
SET updated_at = completed_at
WHERE updated_at IS NULL;

ALTER TABLE public.field_tools_safety_inspections
  ALTER COLUMN status SET DEFAULT 'submitted',
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE public.field_tools_field_reports
  ALTER COLUMN status SET DEFAULT 'submitted',
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE public.field_tools_safety_inspections
  DROP CONSTRAINT IF EXISTS field_tools_safety_inspections_status_chk;
ALTER TABLE public.field_tools_safety_inspections
  ADD CONSTRAINT field_tools_safety_inspections_status_chk
  CHECK (status IN ('saved', 'submitted'));

ALTER TABLE public.field_tools_field_reports
  DROP CONSTRAINT IF EXISTS field_tools_field_reports_status_chk;
ALTER TABLE public.field_tools_field_reports
  ADD CONSTRAINT field_tools_field_reports_status_chk
  CHECK (status IN ('saved', 'submitted'));

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
        AND r.status = 'submitted'
    ),
    'field_report_due_label', 'Due today',
    'inspection_due', NOT EXISTS (
      SELECT 1
      FROM public.field_tools_safety_inspections i
      WHERE i.submitted_by_profile_id = p_caller_id
        AND i.status = 'submitted'
        AND public.field_tools_link_period_key('weekly', i.completed_at) = v_week
    ),
    'inspection_due_label', 'Due this week'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_save_safety_inspection(
  p_caller_id uuid,
  p_session_token text,
  p_id uuid,
  p_project_id uuid,
  p_job_number text,
  p_job_name text,
  p_week_ending date,
  p_inspector_name text,
  p_inspection_date date,
  p_items jsonb,
  p_other_concerns text,
  p_accident_attached boolean,
  p_submit boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.field_tools_profiles%ROWTYPE;
  v_existing public.field_tools_safety_inspections%ROWTYPE;
  v_item jsonb;
  v_status text;
  v_count int := 0;
  v_id uuid;
  v_week date;
  v_next_status text;
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
  IF p_project_id IS NOT NULL
     AND NOT public.field_tools_profile_can_access_project(p_caller_id, p_project_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'You don''t have access to this job.');
  END IF;
  IF jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Review each checklist item.');
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  LOOP
    v_status := lower(trim(coalesce(v_item->>'status', '')));
    IF v_status <> '' AND v_status NOT IN ('ok', 'attention', 'na') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Review each checklist item.');
    END IF;
    IF coalesce(p_submit, false) AND (trim(coalesce(v_item->>'name', '')) = '' OR v_status NOT IN ('ok', 'attention', 'na')) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Review each checklist item.');
    END IF;
    v_count := v_count + 1;
  END LOOP;

  IF coalesce(p_submit, false) THEN
    IF p_week_ending IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Week ending is required.');
    END IF;
    IF trim(coalesce(p_inspector_name, '')) = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Inspector name is required.');
    END IF;
    IF v_count < 1 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Review each checklist item.');
    END IF;
  END IF;

  v_week := coalesce(p_week_ending, (now() AT TIME ZONE 'America/Los_Angeles')::date);

  IF p_id IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.field_tools_safety_inspections
    WHERE id = p_id AND submitted_by_profile_id = p_caller_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'That saved inspection was not found.');
    END IF;
    v_next_status := CASE
      WHEN coalesce(p_submit, false) THEN 'submitted'
      WHEN v_existing.status = 'submitted' THEN 'submitted'
      ELSE 'saved'
    END;
    UPDATE public.field_tools_safety_inspections
    SET
      project_id = p_project_id,
      job_number = trim(p_job_number),
      job_name = trim(coalesce(p_job_name, '')),
      week_ending = v_week,
      inspector_name = trim(coalesce(p_inspector_name, '')),
      inspection_date = p_inspection_date,
      items = coalesce(p_items, '[]'::jsonb),
      other_concerns = trim(coalesce(p_other_concerns, '')),
      accident_attached = coalesce(p_accident_attached, false),
      status = v_next_status,
      updated_at = now(),
      completed_at = CASE WHEN coalesce(p_submit, false) THEN now() ELSE completed_at END
    WHERE id = p_id
    RETURNING id INTO v_id;
  ELSE
    v_next_status := CASE WHEN coalesce(p_submit, false) THEN 'submitted' ELSE 'saved' END;
    INSERT INTO public.field_tools_safety_inspections (
      project_id, job_number, job_name, week_ending, inspector_name, inspection_date,
      items, other_concerns, accident_attached, submitted_by_profile_id, submitted_by_name,
      status, updated_at, completed_at
    ) VALUES (
      p_project_id,
      trim(p_job_number),
      trim(coalesce(p_job_name, '')),
      v_week,
      trim(coalesce(p_inspector_name, '')),
      p_inspection_date,
      coalesce(p_items, '[]'::jsonb),
      trim(coalesce(p_other_concerns, '')),
      coalesce(p_accident_attached, false),
      p_caller_id,
      coalesce(nullif(trim(v_profile.name), ''), 'Field user'),
      v_next_status,
      now(),
      now()
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'status', v_next_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_save_field_report(
  p_caller_id uuid,
  p_session_token text,
  p_id uuid,
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
  p_reporter_title text,
  p_sign_date date,
  p_submit boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.field_tools_profiles%ROWTYPE;
  v_existing public.field_tools_field_reports%ROWTYPE;
  v_id uuid;
  v_date date;
  v_next_status text;
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
  IF p_project_id IS NOT NULL
     AND NOT public.field_tools_profile_can_access_project(p_caller_id, p_project_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'You don''t have access to this job.');
  END IF;
  IF coalesce(p_submit, false) THEN
    IF p_report_date IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Report date is required.');
    END IF;
    IF trim(coalesce(p_reported_by, '')) = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Reported by is required.');
    END IF;
  END IF;

  v_date := coalesce(p_report_date, (now() AT TIME ZONE 'America/Los_Angeles')::date);

  IF p_id IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.field_tools_field_reports
    WHERE id = p_id AND submitted_by_profile_id = p_caller_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'That saved report was not found.');
    END IF;
    v_next_status := CASE
      WHEN coalesce(p_submit, false) THEN 'submitted'
      WHEN v_existing.status = 'submitted' THEN 'submitted'
      ELSE 'saved'
    END;
    UPDATE public.field_tools_field_reports
    SET
      project_id = p_project_id,
      job_number = trim(p_job_number),
      job_name = trim(coalesce(p_job_name, '')),
      report_date = v_date,
      superintendent = trim(coalesce(p_superintendent, '')),
      contractor = trim(coalesce(p_contractor, '')),
      location = trim(coalesce(p_location, '')),
      weather = coalesce(p_weather, '{}'::jsonb),
      manpower = coalesce(p_manpower, '[]'::jsonb),
      materials = trim(coalesce(p_materials, '')),
      work_performed = trim(coalesce(p_work_performed, '')),
      delays = coalesce(p_delays, '{}'::text[]),
      delay_notes = trim(coalesce(p_delay_notes, '')),
      toolbox_talk = lower(trim(coalesce(p_toolbox_talk, ''))),
      incidents = lower(trim(coalesce(p_incidents, ''))),
      ppe_housekeeping = lower(trim(coalesce(p_ppe_housekeeping, ''))),
      safety_notes = trim(coalesce(p_safety_notes, '')),
      reported_by = trim(coalesce(p_reported_by, '')),
      reporter_title = trim(coalesce(p_reporter_title, '')),
      sign_date = p_sign_date,
      photos = '[]'::jsonb,
      status = v_next_status,
      updated_at = now(),
      completed_at = CASE WHEN coalesce(p_submit, false) THEN now() ELSE completed_at END
    WHERE id = p_id
    RETURNING id INTO v_id;
  ELSE
    v_next_status := CASE WHEN coalesce(p_submit, false) THEN 'submitted' ELSE 'saved' END;
    INSERT INTO public.field_tools_field_reports (
      project_id, job_number, job_name, report_date, superintendent, contractor, location,
      weather, manpower, materials, work_performed, delays, delay_notes,
      toolbox_talk, incidents, ppe_housekeeping, safety_notes,
      reported_by, reporter_title, sign_date, photos,
      submitted_by_profile_id, submitted_by_name, status, updated_at, completed_at
    ) VALUES (
      p_project_id,
      trim(p_job_number),
      trim(coalesce(p_job_name, '')),
      v_date,
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
      trim(coalesce(p_reported_by, '')),
      trim(coalesce(p_reporter_title, '')),
      p_sign_date,
      '[]'::jsonb,
      p_caller_id,
      coalesce(nullif(trim(v_profile.name), ''), 'Field user'),
      v_next_status,
      now(),
      now()
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'status', v_next_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_list_my_safety_inspections(
  p_caller_id uuid,
  p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_tools_require_session(p_caller_id, p_session_token);
  RETURN jsonb_build_object(
    'ok', true,
    'records', COALESCE((
      SELECT jsonb_agg(row_to_json(s)::jsonb ORDER BY s.updated_at DESC)
      FROM (
        SELECT
          i.id,
          i.project_id,
          i.job_number,
          i.job_name,
          i.week_ending,
          i.status,
          i.updated_at
        FROM public.field_tools_safety_inspections i
        WHERE i.submitted_by_profile_id = p_caller_id
        ORDER BY i.updated_at DESC
        LIMIT 40
      ) s
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_get_safety_inspection(
  p_caller_id uuid,
  p_session_token text,
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.field_tools_safety_inspections%ROWTYPE;
BEGIN
  PERFORM public.field_tools_require_session(p_caller_id, p_session_token);
  SELECT * INTO v_row
  FROM public.field_tools_safety_inspections
  WHERE id = p_id AND submitted_by_profile_id = p_caller_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'That saved inspection was not found.');
  END IF;
  RETURN jsonb_build_object('ok', true, 'record', to_jsonb(v_row));
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_list_my_field_reports(
  p_caller_id uuid,
  p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_tools_require_session(p_caller_id, p_session_token);
  RETURN jsonb_build_object(
    'ok', true,
    'records', COALESCE((
      SELECT jsonb_agg(row_to_json(s)::jsonb ORDER BY s.updated_at DESC)
      FROM (
        SELECT
          r.id,
          r.project_id,
          r.job_number,
          r.job_name,
          r.report_date,
          r.status,
          r.updated_at
        FROM public.field_tools_field_reports r
        WHERE r.submitted_by_profile_id = p_caller_id
        ORDER BY r.updated_at DESC
        LIMIT 40
      ) s
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_get_field_report(
  p_caller_id uuid,
  p_session_token text,
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.field_tools_field_reports%ROWTYPE;
  v_record jsonb;
BEGIN
  PERFORM public.field_tools_require_session(p_caller_id, p_session_token);
  SELECT * INTO v_row
  FROM public.field_tools_field_reports
  WHERE id = p_id AND submitted_by_profile_id = p_caller_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'That saved report was not found.');
  END IF;
  v_record := to_jsonb(v_row);
  v_record := jsonb_set(v_record, '{photos}', '[]'::jsonb);
  RETURN jsonb_build_object('ok', true, 'record', v_record);
END;
$$;

DROP FUNCTION IF EXISTS public.list_safety_inspections_for_jobflow(uuid);
CREATE FUNCTION public.list_safety_inspections_for_jobflow(p_project_id uuid)
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
  items jsonb,
  status text,
  updated_at timestamptz
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
    i.items,
    i.status,
    i.updated_at
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
  ORDER BY i.updated_at DESC;
$$;

DROP FUNCTION IF EXISTS public.list_field_reports_for_jobflow(uuid);
CREATE FUNCTION public.list_field_reports_for_jobflow(p_project_id uuid)
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
  sign_date date,
  photos jsonb,
  submitted_by_name text,
  completed_at timestamptz,
  status text,
  updated_at timestamptz
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
    r.sign_date,
    '[]'::jsonb,
    coalesce(nullif(trim(r.submitted_by_name), ''), 'Field user'),
    r.completed_at,
    r.status,
    r.updated_at
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
  ORDER BY r.updated_at DESC;
$$;

REVOKE ALL ON FUNCTION public.field_tools_save_safety_inspection(uuid, text, uuid, uuid, text, text, date, text, date, jsonb, text, boolean, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.field_tools_save_field_report(uuid, text, uuid, uuid, text, text, date, text, text, text, jsonb, jsonb, text, text, text[], text, text, text, text, text, text, text, date, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.field_tools_list_my_safety_inspections(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.field_tools_get_safety_inspection(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.field_tools_list_my_field_reports(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.field_tools_get_field_report(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_safety_inspections_for_jobflow(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_field_reports_for_jobflow(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.field_tools_save_safety_inspection(uuid, text, uuid, uuid, text, text, date, text, date, jsonb, text, boolean, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_save_field_report(uuid, text, uuid, uuid, text, text, date, text, text, text, jsonb, jsonb, text, text, text[], text, text, text, text, text, text, text, date, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_list_my_safety_inspections(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_get_safety_inspection(uuid, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_list_my_field_reports(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_get_field_report(uuid, text, uuid) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.list_safety_inspections_for_jobflow(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.list_field_reports_for_jobflow(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_safety_inspections_for_jobflow(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_field_reports_for_jobflow(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
