-- Field report sign-off date and photo captions, matching the ICBI daily report form.

ALTER TABLE public.field_tools_field_reports
  ADD COLUMN IF NOT EXISTS sign_date date,
  ADD COLUMN IF NOT EXISTS photos jsonb NOT NULL DEFAULT '[]'::jsonb;

DROP FUNCTION IF EXISTS public.field_tools_submit_field_report(uuid, text, uuid, text, text, date, text, text, text, jsonb, jsonb, text, text, text[], text, text, text, text, text, text, text);

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
  p_reporter_title text,
  p_sign_date date,
  p_photos jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.field_tools_profiles%ROWTYPE;
  v_id uuid;
  v_photo jsonb;
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
  IF jsonb_typeof(coalesce(p_photos, '[]'::jsonb)) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Photos could not be saved.');
  END IF;
  IF jsonb_array_length(coalesce(p_photos, '[]'::jsonb)) > 12 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Add 12 photos or fewer.');
  END IF;

  FOR v_photo IN SELECT value FROM jsonb_array_elements(coalesce(p_photos, '[]'::jsonb))
  LOOP
    IF length(coalesce(v_photo->>'image_jpeg', '')) > 2000000 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'One of the photos is too large.');
    END IF;
  END LOOP;

  INSERT INTO public.field_tools_field_reports (
    project_id, job_number, job_name, report_date, superintendent, contractor, location,
    weather, manpower, materials, work_performed, delays, delay_notes,
    toolbox_talk, incidents, ppe_housekeeping, safety_notes,
    reported_by, reporter_title, sign_date, photos,
    submitted_by_profile_id, submitted_by_name
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
    p_sign_date,
    coalesce(p_photos, '[]'::jsonb),
    p_caller_id,
    coalesce(nullif(trim(v_profile.name), ''), 'Field user')
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

DROP FUNCTION IF EXISTS public.list_field_reports_for_jobflow(uuid);

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
  sign_date date,
  photos jsonb,
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
    r.sign_date,
    r.photos,
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

REVOKE ALL ON FUNCTION public.field_tools_submit_field_report(uuid, text, uuid, text, text, date, text, text, text, jsonb, jsonb, text, text, text[], text, text, text, text, text, text, text, date, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.field_tools_submit_field_report(uuid, text, uuid, text, text, date, text, text, text, jsonb, jsonb, text, text, text[], text, text, text, text, text, text, text, date, jsonb) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.list_field_reports_for_jobflow(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_field_reports_for_jobflow(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_field_reports_for_jobflow(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
