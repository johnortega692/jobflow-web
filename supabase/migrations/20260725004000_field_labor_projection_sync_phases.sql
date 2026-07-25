-- Field Labor Projection: sync cost-code phases from Budget Maker when supers open a job.

CREATE OR REPLACE FUNCTION public.labor_projection_cost_code_number(p_label text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT coalesce(
    nullif(substring(trim(coalesce(p_label, '')) from '^([0-9]+)'), ''),
    nullif(trim(split_part(coalesce(p_label, ''), ' - ', 1)), ''),
    trim(coalesce(p_label, ''))
  );
$$;

CREATE OR REPLACE FUNCTION public.labor_projection_bucket_is_amount_only(p_bucket jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT
    upper(trim(coalesce(p_bucket->>'template_type', ''))) IN ('MATERIALS', 'EQUIPMENT', 'EQUIPMENT_RENTED')
    OR trim(coalesce(p_bucket->>'cost_class', '')) IN ('2', '4', '5');
$$;

CREATE OR REPLACE FUNCTION public.labor_projection_slice_hours_for_bucket(
  p_slice jsonb,
  p_bucket_idx int
)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce(sum(
    CASE
      WHEN coalesce((line->>'Hidden')::boolean, false) THEN 0
      WHEN nullif(trim(line->>'Bucket'), '') IS DISTINCT FROM p_bucket_idx::text THEN 0
      ELSE coalesce(
        CASE
          WHEN jsonb_typeof(line->'Man Hours') = 'number' THEN (line->>'Man Hours')::numeric
          ELSE nullif(trim(line->>'Man Hours'), '')::numeric
        END,
        0
      )
    END
  ), 0)
  FROM jsonb_array_elements(coalesce(p_slice->'lines', '[]'::jsonb)) AS line;
$$;

CREATE OR REPLACE FUNCTION public.labor_projection_slice_amount_for_bucket(
  p_slice jsonb,
  p_bucket_idx int
)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce(sum(
    CASE
      WHEN coalesce((line->>'Hidden')::boolean, false) THEN 0
      WHEN nullif(trim(line->>'Bucket'), '') IS DISTINCT FROM p_bucket_idx::text THEN 0
      ELSE coalesce(
        CASE
          WHEN jsonb_typeof(line->'Amount') = 'number' THEN (line->>'Amount')::numeric
          ELSE nullif(trim(line->>'Amount'), '')::numeric
        END,
        0
      )
    END
  ), 0)
  FROM jsonb_array_elements(coalesce(p_slice->'lines', '[]'::jsonb)) AS line;
$$;

CREATE OR REPLACE FUNCTION public.labor_projection_cost_code_description(
  p_code text,
  p_cost_class text DEFAULT NULL
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH codes AS (
    SELECT cc
    FROM public.org_settings o
    CROSS JOIN LATERAL jsonb_array_elements(
      coalesce(o.settings->'budget_library'->'cost_codes', '[]'::jsonb)
    ) cc
    WHERE o.id = 1
      AND public.labor_projection_cost_code_number(cc->>'cost_code')
        = public.labor_projection_cost_code_number(p_code)
  ),
  ranked AS (
    SELECT
      nullif(trim(coalesce(cc->>'description', '')), '') AS description,
      CASE
        WHEN nullif(trim(coalesce(p_cost_class, '')), '') IS NOT NULL
          AND trim(coalesce(cc->>'cost_class', '')) = trim(p_cost_class) THEN 0
        ELSE 1
      END AS rank_score
    FROM codes
  )
  SELECT description
  FROM ranked
  WHERE description IS NOT NULL
  ORDER BY rank_score, description
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.labor_projection_phases_from_slice(
  p_contract text,
  p_slice jsonb,
  p_hide_zero_amounts boolean
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_bucket jsonb;
  v_idx int := 0;
  v_code text;
  v_name text;
  v_raw_code text;
  v_hours numeric;
  v_amount numeric;
  v_map jsonb := '{}'::jsonb;
  v_id text;
  v_existing jsonb;
  v_class text;
BEGIN
  IF p_slice IS NULL OR jsonb_typeof(p_slice) <> 'object' THEN
    RETURN '[]'::jsonb;
  END IF;

  FOR v_bucket IN
    SELECT value
    FROM jsonb_array_elements(coalesce(p_slice->'buckets', '[]'::jsonb))
  LOOP
    IF coalesce((v_bucket->>'hide_from_hours_pdf')::boolean, false) THEN
      v_idx := v_idx + 1;
      CONTINUE;
    END IF;

    IF public.labor_projection_bucket_is_amount_only(v_bucket) THEN
      v_idx := v_idx + 1;
      CONTINUE;
    END IF;

    v_amount := public.labor_projection_slice_amount_for_bucket(p_slice, v_idx);
    IF p_hide_zero_amounts AND coalesce(v_amount, 0) = 0 THEN
      v_idx := v_idx + 1;
      CONTINUE;
    END IF;

    v_raw_code := trim(coalesce(v_bucket->>'cost_code', ''));
    v_code := public.labor_projection_cost_code_number(v_raw_code);
    IF v_code IS NULL OR v_code = '' THEN
      v_idx := v_idx + 1;
      CONTINUE;
    END IF;

    v_hours := public.labor_projection_slice_hours_for_bucket(p_slice, v_idx);
    v_class := trim(coalesce(v_bucket->>'cost_class', ''));

    -- Prefer library description (Paint Walls), then embedded "901 - …", then notes.
    v_name := public.labor_projection_cost_code_description(v_code, v_class);
    IF v_name IS NULL OR v_name = '' THEN
      IF position(' - ' in v_raw_code) > 0 THEN
        v_name := trim(substring(v_raw_code from position(' - ' in v_raw_code) + 3));
      ELSE
        v_name := nullif(trim(coalesce(v_bucket->>'notes', '')), '');
      END IF;
    END IF;
    IF v_name IS NULL OR v_name = '' THEN
      v_name := v_code;
    END IF;

    v_id := p_contract || ':' || v_code;
    v_existing := v_map->v_id;
    IF v_existing IS NULL THEN
      v_map := v_map || jsonb_build_object(
        v_id,
        jsonb_build_object(
          'id', v_id,
          'name', v_name,
          'costCode', v_code,
          'contract', p_contract,
          'budgetHours', coalesce(v_hours, 0),
          'actualHours', 0
        )
      );
    ELSE
      v_map := jsonb_set(
        v_map,
        ARRAY[v_id, 'budgetHours'],
        to_jsonb(coalesce((v_existing->>'budgetHours')::numeric, 0) + coalesce(v_hours, 0))
      );
      IF coalesce(v_existing->>'name', v_code) = v_code AND v_name IS DISTINCT FROM v_code THEN
        v_map := jsonb_set(v_map, ARRAY[v_id, 'name'], to_jsonb(v_name));
      END IF;
    END IF;

    v_idx := v_idx + 1;
  END LOOP;

  RETURN coalesce((
    SELECT jsonb_agg(value ORDER BY value->>'costCode')
    FROM jsonb_each(v_map)
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.labor_projection_phases_from_budget(p_budget jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_hide boolean := false;
  v_by jsonb;
  v_contract text;
  v_slice jsonb;
  v_phases jsonb := '[]'::jsonb;
  v_part jsonb;
BEGIN
  IF p_budget IS NULL OR jsonb_typeof(p_budget) <> 'object' THEN
    RETURN '[]'::jsonb;
  END IF;

  v_hide := coalesce((p_budget->>'hide_zero_amounts')::boolean, false);
  v_by := p_budget->'by_contract';

  IF v_by IS NOT NULL AND jsonb_typeof(v_by) = 'object' AND v_by <> '{}'::jsonb THEN
    FOR v_contract, v_slice IN SELECT key, value FROM jsonb_each(v_by)
    LOOP
      IF v_contract NOT IN ('paint', 'wallcovering', 'frp', 'track') THEN
        CONTINUE;
      END IF;
      v_part := public.labor_projection_phases_from_slice(v_contract, v_slice, v_hide);
      v_phases := v_phases || coalesce(v_part, '[]'::jsonb);
    END LOOP;
  ELSE
    v_phases := public.labor_projection_phases_from_slice(
      coalesce(nullif(trim(p_budget->>'contract'), ''), 'paint'),
      p_budget,
      v_hide
    );
  END IF;

  RETURN coalesce(v_phases, '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_labor_projection_phases_in_data(p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_billing jsonb;
  v_from_budget jsonb;
  v_keep_ids text[];
  v_cells jsonb;
  v_actuals jsonb;
  v_prev jsonb;
  v_phase jsonb;
  v_id text;
  v_planned numeric;
  v_merged jsonb := '[]'::jsonb;
BEGIN
  v_billing := coalesce(p_data->'billing', '{}'::jsonb);
  v_from_budget := public.labor_projection_phases_from_budget(p_data->'budget_maker');

  FOR v_phase IN SELECT value FROM jsonb_array_elements(coalesce(v_from_budget, '[]'::jsonb))
  LOOP
    v_id := v_phase->>'id';
    v_prev := (
      SELECT ph
      FROM jsonb_array_elements(coalesce(v_billing->'manpowerPhases', '[]'::jsonb)) ph
      WHERE ph->>'id' = v_id
      LIMIT 1
    );
    IF v_prev IS NOT NULL THEN
      -- Keep actuals; always refresh label/budgetHours from budget + library.
      v_phase := v_phase || jsonb_build_object(
        'actualHours', coalesce((v_prev->>'actualHours')::numeric, 0)
      );
    END IF;
    v_merged := v_merged || jsonb_build_array(v_phase);
  END LOOP;

  SELECT coalesce(array_agg(value->>'id'), ARRAY[]::text[])
  INTO v_keep_ids
  FROM jsonb_array_elements(v_merged);

  FOR v_prev IN
    SELECT value
    FROM jsonb_array_elements(coalesce(v_billing->'manpowerPhases', '[]'::jsonb))
  LOOP
    v_id := v_prev->>'id';
    IF v_id IS NULL OR v_id = ANY (v_keep_ids) THEN
      CONTINUE;
    END IF;
    IF v_id IN ('prime', 'final', 'punch') THEN
      CONTINUE;
    END IF;
    SELECT coalesce(sum(coalesce((cell->>'hours')::numeric, 0)), 0)
    INTO v_planned
    FROM jsonb_array_elements(coalesce(v_billing->'manpowerCells', '[]'::jsonb)) cell
    WHERE cell->>'phaseId' = v_id;
    IF coalesce(v_planned, 0) <= 0 THEN
      CONTINUE;
    END IF;
    IF position('(removed)' in coalesce(v_prev->>'name', '')) = 0 THEN
      v_prev := v_prev || jsonb_build_object('name', coalesce(v_prev->>'name', v_id) || ' (removed)');
    END IF;
    v_merged := v_merged || jsonb_build_array(v_prev);
    v_keep_ids := array_append(v_keep_ids, v_id);
  END LOOP;

  SELECT coalesce(jsonb_agg(cell), '[]'::jsonb)
  INTO v_cells
  FROM jsonb_array_elements(coalesce(v_billing->'manpowerCells', '[]'::jsonb)) cell
  WHERE cell->>'phaseId' = ANY (v_keep_ids);

  SELECT coalesce(jsonb_agg(a), '[]'::jsonb)
  INTO v_actuals
  FROM jsonb_array_elements(coalesce(v_billing->'manpowerPeriodActuals', '[]'::jsonb)) a
  WHERE a->>'phaseId' = ANY (v_keep_ids);

  v_billing := v_billing
    || jsonb_build_object(
      'version', 1,
      'manpowerPhases', coalesce(v_merged, '[]'::jsonb),
      'manpowerCells', coalesce(v_cells, '[]'::jsonb),
      'manpowerPeriodActuals', coalesce(v_actuals, '[]'::jsonb)
    );

  RETURN coalesce(p_data, '{}'::jsonb) || jsonb_build_object('billing', v_billing);
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
    'total_hours', hours.projection_hours,
    'projection_hours', hours.projection_hours,
    'budget_hours', hours.budget_hours,
    'hours_difference', hours.budget_hours - hours.projection_hours
  )
  FROM hours;
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
  v_synced jsonb;
BEGIN
  PERFORM public.field_view_require_access(p_caller_id, p_session_token);

  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id required';
  END IF;

  SELECT * INTO v_row FROM public.projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF public.project_hidden_from_field_apps(p_project_id) THEN
    RAISE EXCEPTION 'Project not available';
  END IF;

  v_synced := public.sync_labor_projection_phases_in_data(v_row.data);

  IF v_synced IS DISTINCT FROM v_row.data THEN
    UPDATE public.projects
    SET data = v_synced,
        updated_at = now()
    WHERE id = p_project_id;
  END IF;

  RETURN public.field_view_labor_projection_from_project(
    v_row.id,
    v_row.job_number,
    v_row.job_name,
    v_synced
  );
END;
$$;

-- After Field saves cells, re-sync phases from budget so rows stay present.
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
