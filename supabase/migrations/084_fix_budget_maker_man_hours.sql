-- Fix: Budget Maker line hours are stored as "Man Hours", not "Hours".

CREATE OR REPLACE FUNCTION public.budget_maker_line_man_hours(p_line jsonb)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT coalesce(
    CASE
      WHEN jsonb_typeof(p_line->'Man Hours') = 'number' THEN (p_line->>'Man Hours')::numeric
      WHEN nullif(trim(p_line->>'Man Hours'), '') IS NOT NULL THEN nullif(trim(p_line->>'Man Hours'), '')::numeric
      WHEN jsonb_typeof(p_line->'Hours') = 'number' THEN (p_line->>'Hours')::numeric
      ELSE nullif(trim(p_line->>'Hours'), '')::numeric
    END,
    0
  );
$$;

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
      ELSE public.budget_maker_line_man_hours(line)
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
  v_top numeric;
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
  END IF;

  -- Also count top-level lines (legacy / active tab not yet mirrored into by_contract).
  v_top := public.budget_maker_slice_field_hours(p_budget);

  -- Prefer the larger of contract-sum vs top-level to avoid double-count when both mirror the same data.
  -- If by_contract has data, use it; otherwise use top-level.
  IF v_by IS NOT NULL AND jsonb_typeof(v_by) = 'object' AND v_by <> '{}'::jsonb AND v_total > 0 THEN
    RETURN v_total;
  END IF;

  RETURN coalesce(nullif(v_total, 0), v_top, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.budget_maker_line_man_hours(jsonb) TO anon, authenticated;
