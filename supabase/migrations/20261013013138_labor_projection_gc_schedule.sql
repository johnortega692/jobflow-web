-- Keep the imported GC schedule, including rows sent to Upcoming, on the labor projection.

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
  WITH synced AS (
    SELECT public.sync_labor_projection_phases_in_data(p_data) AS data
  ),
  hours AS (
    SELECT
      coalesce((
        SELECT sum(coalesce(
          CASE
            WHEN jsonb_typeof(cell->'hours') = 'number' THEN (cell->>'hours')::numeric
            ELSE nullif(trim(cell->>'hours'), '')::numeric
          END,
          0
        ))
        FROM jsonb_array_elements(coalesce((SELECT data FROM synced)->'billing'->'manpowerCells', '[]'::jsonb)) cell
      ), 0) AS projection_hours,
      public.budget_maker_field_hours((SELECT data FROM synced)->'budget_maker') AS budget_hours
  )
  SELECT jsonb_build_object(
    'project_id', p_id,
    'job_number', coalesce(p_job_number, ''),
    'job_name', coalesce(p_job_name, ''),
    'start_date', coalesce(nullif(trim((SELECT data FROM synced)->'job_info'->>'start_date'), ''), ''),
    'end_date', coalesce(nullif(trim((SELECT data FROM synced)->'job_info'->>'end_date'), ''), ''),
    'week_count', greatest(
      1,
      coalesce(nullif(trim((SELECT data FROM synced)->'billing'->>'manpowerWeekCount'), '')::int, 8)
    ),
    'phases', coalesce((SELECT data FROM synced)->'billing'->'manpowerPhases', '[]'::jsonb),
    'cells', coalesce((SELECT data FROM synced)->'billing'->'manpowerCells', '[]'::jsonb),
    'gc_schedule', coalesce((SELECT data FROM synced)->'billing'->'gcSchedule', '{}'::jsonb),
    'total_hours', hours.projection_hours,
    'projection_hours', hours.projection_hours,
    'budget_hours', hours.budget_hours,
    'hours_difference', hours.budget_hours - hours.projection_hours
  )
  FROM hours;
$$;

DROP FUNCTION IF EXISTS public.field_view_save_labor_projection(uuid, jsonb, text, uuid, text);

CREATE OR REPLACE FUNCTION public.field_view_save_labor_projection(
  p_project_id uuid,
  p_cells jsonb,
  p_user_name text DEFAULT 'Field view',
  p_caller_id uuid DEFAULT NULL,
  p_session_token text DEFAULT NULL,
  p_gc_schedule jsonb DEFAULT NULL
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
  v_job_number text;
  v_job_name text;
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

  SELECT coalesce(jsonb_agg(elem), '[]'::jsonb)
  INTO v_cells
  FROM jsonb_array_elements(p_cells) elem
  WHERE jsonb_typeof(elem) = 'object'
    AND nullif(trim(elem->>'phaseId'), '') IS NOT NULL
    AND nullif(trim(elem->>'weekStartIso'), '') IS NOT NULL
    AND coalesce(nullif(trim(elem->>'hours'), '')::numeric, 0) >= 0;

  SELECT data, job_number, job_name
  INTO v_data, v_job_number, v_job_name
  FROM public.projects
  WHERE id = p_project_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found';
  END IF;

  v_billing := coalesce(v_data->'billing', '{}'::jsonb);
  v_billing := v_billing || jsonb_build_object('manpowerCells', coalesce(v_cells, '[]'::jsonb));
  IF p_gc_schedule IS NOT NULL AND jsonb_typeof(p_gc_schedule) = 'object' THEN
    v_billing := v_billing || jsonb_build_object('gcSchedule', p_gc_schedule);
  END IF;
  IF v_billing->>'version' IS NULL THEN
    v_billing := jsonb_build_object('version', 1) || v_billing;
  END IF;

  v_data := coalesce(v_data, '{}'::jsonb) || jsonb_build_object('billing', v_billing);
  v_data := public.sync_labor_projection_phases_in_data(v_data);

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
    v_job_number,
    v_job_name,
    v_data
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.field_view_save_labor_projection(uuid, jsonb, text, uuid, text, jsonb) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
