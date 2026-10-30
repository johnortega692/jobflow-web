-- Extra-work materials keep the paint or sundries catalog source.

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
  v_name text;
  v_qty text;
  v_hrs numeric;
  v_ot numeric;
  v_dt numeric;
  v_source text;
  v_category text;
  v_row jsonb;
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
      v_name := trim(coalesce(v_item->>'name', ''));
      BEGIN
        v_hrs := greatest(coalesce((v_item->>'hours')::numeric, 0), 0);
      EXCEPTION WHEN others THEN
        v_hrs := 0;
      END;
      BEGIN
        v_ot := greatest(coalesce((v_item->>'overtime')::numeric, 0), 0);
      EXCEPTION WHEN others THEN
        v_ot := 0;
      END;
      BEGIN
        v_dt := greatest(coalesce(nullif(v_item->>'double_time', ''), nullif(v_item->>'doubleTime', ''))::numeric, 0);
      EXCEPTION WHEN others THEN
        v_dt := 0;
      END;
      IF v_name = '' OR (v_hrs <= 0 AND v_ot <= 0 AND v_dt <= 0) THEN
        CONTINUE;
      END IF;
      v_hours := v_hours || jsonb_build_array(
        jsonb_build_object('name', v_name, 'hours', v_hrs, 'overtime', v_ot, 'double_time', v_dt)
      );
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
