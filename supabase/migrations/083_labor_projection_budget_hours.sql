-- Labor Projection job cards: Budget Maker field hours vs projection hours.

CREATE OR REPLACE FUNCTION public.budget_maker_slice_field_hours(p_slice jsonb)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce(sum(
    CASE
      WHEN coalesce((line->>'Hidden')::boolean, false) THEN 0
      WHEN trim(coalesce(
        CASE
          WHEN (nullif(trim(line->>'Bucket'), '') ~ '^[0-9]+$')
            THEN p_slice->'buckets'->(nullif(trim(line->>'Bucket'), '')::int)->>'cost_code'
          ELSE NULL
        END,
        ''
      )) = '990' THEN 0
      ELSE coalesce(
        CASE
          WHEN jsonb_typeof(line->'Hours') = 'number' THEN (line->>'Hours')::numeric
          ELSE nullif(trim(line->>'Hours'), '')::numeric
        END,
        0
      )
    END
  ), 0)
  FROM jsonb_array_elements(coalesce(p_slice->'lines', '[]'::jsonb)) AS line;
$$;

CREATE OR REPLACE FUNCTION public.budget_maker_field_hours(p_budget jsonb)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_total numeric := 0;
  v_by jsonb;
  v_slice jsonb;
BEGIN
  IF p_budget IS NULL OR jsonb_typeof(p_budget) <> 'object' THEN
    RETURN 0;
  END IF;

  v_by := p_budget->'by_contract';
  IF v_by IS NOT NULL AND jsonb_typeof(v_by) = 'object' AND v_by <> '{}'::jsonb THEN
    FOR v_slice IN SELECT value FROM jsonb_each(v_by)
    LOOP
      v_total := v_total + public.budget_maker_slice_field_hours(v_slice);
    END LOOP;
  ELSE
    v_total := public.budget_maker_slice_field_hours(p_budget);
  END IF;

  RETURN coalesce(v_total, 0);
END;
$$;

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
  WITH hours AS (
    SELECT
      coalesce((
        SELECT sum(coalesce(
          CASE
            WHEN jsonb_typeof(cell->'hours') = 'number' THEN (cell->>'hours')::numeric
            ELSE nullif(trim(cell->>'hours'), '')::numeric
          END,
          0
        ))
        FROM jsonb_array_elements(coalesce(p_data->'billing'->'manpowerCells', '[]'::jsonb)) cell
      ), 0) AS projection_hours,
      public.budget_maker_field_hours(p_data->'budget_maker') AS budget_hours
  )
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
    'total_hours', hours.projection_hours,
    'projection_hours', hours.projection_hours,
    'budget_hours', hours.budget_hours,
    'hours_difference', hours.budget_hours - hours.projection_hours
  )
  FROM hours;
$$;

GRANT EXECUTE ON FUNCTION public.budget_maker_slice_field_hours(jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.budget_maker_field_hours(jsonb) TO anon, authenticated;
