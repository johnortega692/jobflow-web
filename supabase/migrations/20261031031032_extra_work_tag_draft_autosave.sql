-- A draft can be stored as soon as a job is chosen. The app still requires a description before a signature.

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
  v_day jsonb;
  v_days jsonb;
  v_name text;
  v_qty text;
  v_hrs numeric;
  v_ot numeric;
  v_dt numeric;
  v_day_hrs numeric;
  v_day_ot numeric;
  v_day_dt numeric;
  v_week text;
  v_date date;
  v_source text;
  v_category text;
  v_row jsonb;
  v_id uuid;
  v_number text;
  v_description text := trim(coalesce(p_description, ''));
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

  IF jsonb_typeof(coalesce(p_hours, '[]'::jsonb)) = 'array' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_hours)
    LOOP
      v_name := trim(coalesce(v_item->>'name', ''));
      v_days := '[]'::jsonb;
      v_hrs := 0;
      v_ot := 0;
      v_dt := 0;
      BEGIN
        v_week := to_char(coalesce(nullif(v_item->>'week_start', ''), nullif(v_item->>'weekStart', ''))::date, 'YYYY-MM-DD');
      EXCEPTION WHEN others THEN
        v_week := '';
      END;

      IF jsonb_typeof(v_item->'days') = 'array' THEN
        FOR v_day IN SELECT value FROM jsonb_array_elements(v_item->'days')
        LOOP
          IF jsonb_array_length(v_days) >= 7 THEN
            EXIT;
          END IF;
          BEGIN
            v_date := (v_day->>'date')::date;
            v_day_hrs := greatest(coalesce((v_day->>'hours')::numeric, 0), 0);
            v_day_ot := greatest(coalesce((v_day->>'overtime')::numeric, 0), 0);
            v_day_dt := greatest(coalesce(nullif(v_day->>'double_time', ''), nullif(v_day->>'doubleTime', ''))::numeric, 0);
          EXCEPTION WHEN others THEN
            CONTINUE;
          END;
          IF v_day_hrs > 24 OR v_day_ot > 24 OR v_day_dt > 24 THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Enter 24 hours or less for one day.');
          END IF;
          IF v_day_hrs <= 0 AND v_day_ot <= 0 AND v_day_dt <= 0 THEN
            CONTINUE;
          END IF;
          v_day_hrs := round(v_day_hrs, 2);
          v_day_ot := round(v_day_ot, 2);
          v_day_dt := round(v_day_dt, 2);
          v_hrs := v_hrs + v_day_hrs;
          v_ot := v_ot + v_day_ot;
          v_dt := v_dt + v_day_dt;
          v_days := v_days || jsonb_build_array(jsonb_build_object(
            'date', to_char(v_date, 'YYYY-MM-DD'),
            'hours', v_day_hrs,
            'overtime', v_day_ot,
            'double_time', v_day_dt
          ));
        END LOOP;
      END IF;

      IF jsonb_array_length(v_days) = 0 THEN
        BEGIN
          v_hrs := greatest(coalesce((v_item->>'hours')::numeric, 0), 0);
          v_ot := greatest(coalesce((v_item->>'overtime')::numeric, 0), 0);
          v_dt := greatest(coalesce(nullif(v_item->>'double_time', ''), nullif(v_item->>'doubleTime', ''))::numeric, 0);
        EXCEPTION WHEN others THEN
          v_hrs := 0;
          v_ot := 0;
          v_dt := 0;
        END;
      END IF;

      IF v_name = '' OR (v_hrs <= 0 AND v_ot <= 0 AND v_dt <= 0) THEN
        CONTINUE;
      END IF;

      v_row := jsonb_build_object('name', v_name, 'hours', v_hrs, 'overtime', v_ot, 'double_time', v_dt);
      IF v_week <> '' THEN
        v_row := v_row || jsonb_build_object('week_start', v_week);
      END IF;
      IF jsonb_array_length(v_days) > 0 THEN
        v_row := v_row || jsonb_build_object('days', v_days);
      END IF;
      v_hours := v_hours || jsonb_build_array(v_row);
    END LOOP;
  END IF;

  IF jsonb_typeof(coalesce(p_materials, '[]'::jsonb)) = 'array' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_materials)
    LOOP
      v_name := trim(coalesce(v_item->>'name', ''));
      v_qty := trim(coalesce(v_item->>'quantity', ''));
      v_source := lower(trim(coalesce(v_item->>'source', '')));
      IF v_source NOT IN ('paint', 'sundry') THEN
        v_source := '';
      END IF;
      v_category := trim(coalesce(v_item->>'category', ''));
      IF v_name = '' THEN
        CONTINUE;
      END IF;
      v_row := jsonb_build_object('name', v_name, 'quantity', v_qty);
      IF v_source <> '' THEN
        v_row := v_row || jsonb_build_object('source', v_source);
      END IF;
      IF v_category <> '' THEN
        v_row := v_row || jsonb_build_object('category', v_category);
      END IF;
      v_materials := v_materials || jsonb_build_array(v_row);
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
      description = v_description,
      hours = v_hours,
      materials = v_materials
    WHERE id = p_id
    RETURNING id, tag_number INTO v_id, v_number;
  ELSE
    v_number := public.next_extra_work_tag_number(p_job_number);
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
      v_description,
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

NOTIFY pgrst, 'reload schema';
