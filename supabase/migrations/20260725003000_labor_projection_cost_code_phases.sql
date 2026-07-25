-- Include manpowerPhases in Field Labor Projection payload (cost-code rows).

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
    'phases', coalesce(p_data->'billing'->'manpowerPhases', '[]'::jsonb),
    'cells', coalesce(p_data->'billing'->'manpowerCells', '[]'::jsonb),
    'total_hours', hours.projection_hours,
    'projection_hours', hours.projection_hours,
    'budget_hours', hours.budget_hours,
    'hours_difference', hours.budget_hours - hours.projection_hours
  )
  FROM hours;
$$;
