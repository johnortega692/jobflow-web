-- Super and admin can list and open every field report. Everyone else still sees only their own.

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
    WHERE id = p_id
      AND (
        submitted_by_profile_id = p_caller_id
        OR v_profile.role IN ('admin', 'super')
      );
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

CREATE OR REPLACE FUNCTION public.field_tools_list_my_field_reports(
  p_caller_id uuid,
  p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  PERFORM public.field_tools_require_session(p_caller_id, p_session_token);

  SELECT role INTO v_role
  FROM public.field_tools_profiles
  WHERE id = p_caller_id AND active = true;

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
          r.updated_at,
          r.submitted_by_name
        FROM public.field_tools_field_reports r
        WHERE v_role IN ('admin', 'super')
           OR r.submitted_by_profile_id = p_caller_id
        ORDER BY r.updated_at DESC
        LIMIT CASE WHEN v_role IN ('admin', 'super') THEN 200 ELSE 40 END
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
  v_role text;
  v_row public.field_tools_field_reports%ROWTYPE;
  v_record jsonb;
BEGIN
  PERFORM public.field_tools_require_session(p_caller_id, p_session_token);

  SELECT role INTO v_role
  FROM public.field_tools_profiles
  WHERE id = p_caller_id AND active = true;

  SELECT * INTO v_row
  FROM public.field_tools_field_reports
  WHERE id = p_id
    AND (
      submitted_by_profile_id = p_caller_id
      OR v_role IN ('admin', 'super')
    );
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'That saved report was not found.');
  END IF;
  v_record := to_jsonb(v_row);
  v_record := jsonb_set(v_record, '{photos}', '[]'::jsonb);
  RETURN jsonb_build_object('ok', true, 'record', v_record);
END;
$$;

NOTIFY pgrst, 'reload schema';
