-- Field Labor Projection: read plan-shaped payload + save manpowerCells only.
-- Does not expose billing cost UI; storage remains projects.data.billing.

CREATE OR REPLACE FUNCTION public.field_view_labor_projection_from_project(
  p_id uuid,
  p_job_number text,
  p_job_name text,
  p_data jsonb
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'project_id', p_id,
    'job_number', coalesce(p_job_number, ''),
    'job_name', coalesce(p_job_name, ''),
    'start_date', coalesce(nullif(trim(p_data->'job_info'->>'start_date'), ''), ''),
    'end_date', coalesce(nullif(trim(p_data->'job_info'->>'end_date'), ''), ''),
    'week_count', greatest(
      1,
      coalesce(nullif(trim(p_data->'billing'->>'manpowerWeekCount'), '')::int, 8)
    ),
    'cells', coalesce(p_data->'billing'->'manpowerCells', '[]'::jsonb),
    'total_hours', coalesce((
      SELECT sum(coalesce(nullif(trim(cell->>'hours'), '')::numeric, 0))
      FROM jsonb_array_elements(coalesce(p_data->'billing'->'manpowerCells', '[]'::jsonb)) cell
    ), 0)
  );
$$;

CREATE OR REPLACE FUNCTION public.field_view_list_labor_projections(
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
    SELECT jsonb_agg(row.payload ORDER BY row.job_number)
    FROM (
      SELECT
        p.job_number,
        public.field_view_labor_projection_from_project(p.id, p.job_number, p.job_name, p.data) AS payload
      FROM public.projects p
      WHERE NOT public.project_hidden_from_field_apps(p.id)
    ) row
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_view_get_labor_projection(
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

  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id required';
  END IF;

  SELECT * INTO v_row FROM public.projects WHERE id = p_project_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF public.project_hidden_from_field_apps(p_project_id) THEN
    RAISE EXCEPTION 'Project not available';
  END IF;

  RETURN public.field_view_labor_projection_from_project(
    v_row.id,
    v_row.job_number,
    v_row.job_name,
    v_row.data
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.field_view_save_labor_projection(
  p_project_id uuid,
  p_cells jsonb,
  p_user_name text DEFAULT 'Field view',
  p_caller_id uuid DEFAULT NULL,
  p_session_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_data jsonb;
  v_billing jsonb;
  v_cells jsonb;
BEGIN
  PERFORM public.field_view_require_access(p_caller_id, p_session_token);

  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id required';
  END IF;

  IF public.project_hidden_from_field_apps(p_project_id) THEN
    RAISE EXCEPTION 'Project not available';
  END IF;

  IF p_cells IS NULL OR jsonb_typeof(p_cells) <> 'array' THEN
    RAISE EXCEPTION 'cells must be a JSON array';
  END IF;

  -- Normalize to array of objects with phaseId, weekStartIso, hours (+ optional dayHours).
  SELECT coalesce(jsonb_agg(elem), '[]'::jsonb)
  INTO v_cells
  FROM jsonb_array_elements(p_cells) elem
  WHERE jsonb_typeof(elem) = 'object'
    AND nullif(trim(elem->>'phaseId'), '') IS NOT NULL
    AND nullif(trim(elem->>'weekStartIso'), '') IS NOT NULL
    AND coalesce(nullif(trim(elem->>'hours'), '')::numeric, 0) >= 0;

  SELECT data INTO v_data FROM public.projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found';
  END IF;

  v_billing := coalesce(v_data->'billing', '{}'::jsonb);
  v_billing := v_billing || jsonb_build_object('manpowerCells', coalesce(v_cells, '[]'::jsonb));
  IF v_billing->>'version' IS NULL THEN
    v_billing := jsonb_build_object('version', 1) || v_billing;
  END IF;

  v_data := coalesce(v_data, '{}'::jsonb) || jsonb_build_object('billing', v_billing);

  UPDATE public.projects
  SET data = v_data,
      updated_at = now()
  WHERE id = p_project_id;

  INSERT INTO public.project_activity (project_id, user_id, user_name, action, summary)
  VALUES (
    p_project_id,
    NULL,
    coalesce(nullif(trim(p_user_name), ''), 'Field view'),
    'labor_projection_saved',
    'Labor Projection updated'
  );

  RETURN public.field_view_labor_projection_from_project(
    p_project_id,
    (SELECT job_number FROM public.projects WHERE id = p_project_id),
    (SELECT job_name FROM public.projects WHERE id = p_project_id),
    v_data
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.field_view_labor_projection_from_project(uuid, text, text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_view_list_labor_projections(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_view_get_labor_projection(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_view_save_labor_projection(uuid, jsonb, text, uuid, text) TO anon, authenticated;
