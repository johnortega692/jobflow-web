-- Paint and sundry lines from a job's field-tools purchase orders, for extra work tags.

CREATE OR REPLACE FUNCTION public.field_tools_list_job_po_materials(
  p_caller_id uuid,
  p_session_token text,
  p_project_id uuid,
  p_job_number text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.field_tools_profiles%ROWTYPE;
  v_job text;
  v_order record;
  v_pos text[];
  v_paint jsonb;
  v_sundries jsonb;
  v_item jsonb;
  v_buckets jsonb := '{}'::jsonb;
  v_paint_po text;
  v_sundry_po text;
  v_separate boolean;
  v_paint_vendor text;
  v_sundry_vendor text;
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

  v_job := split_part(trim(p_job_number), ' ', 1);
  IF public.field_tools_job_number_hidden(p_job_number) THEN
    RETURN jsonb_build_object('ok', true, 'pos', '[]'::jsonb);
  END IF;

  FOR v_order IN
    SELECT o.id, o.po_number, o.payload, o.paint, o.materials
    FROM public.field_tools_orders o
    WHERE split_part(trim(o.job_number), ' ', 1) = v_job
       OR lower(trim(o.job_number)) = lower(trim(p_job_number))
    ORDER BY o.created_at DESC
  LOOP
    SELECT coalesce(array_agg(s.num ORDER BY s.first_at), '{}'::text[])
    INTO v_pos
    FROM (
      SELECT trim(d.po_number) AS num, min(d.created_at) AS first_at
      FROM public.field_tools_order_dispatches d
      WHERE d.order_id = v_order.id
        AND trim(coalesce(d.po_number, '')) <> ''
      GROUP BY trim(d.po_number)
    ) s;

    IF coalesce(array_length(v_pos, 1), 0) = 0 AND trim(coalesce(v_order.po_number, '')) <> '' THEN
      v_pos := ARRAY[trim(v_order.po_number)];
    END IF;
    IF coalesce(array_length(v_pos, 1), 0) = 0 THEN
      CONTINUE;
    END IF;

    v_paint := CASE
      WHEN jsonb_typeof(v_order.payload->'lists'->'paint') = 'array' THEN v_order.payload->'lists'->'paint'
      WHEN jsonb_typeof(v_order.paint) = 'array' THEN v_order.paint
      ELSE '[]'::jsonb
    END;
    v_sundries := CASE
      WHEN jsonb_typeof(v_order.payload->'lists'->'sundries') = 'array' THEN v_order.payload->'lists'->'sundries'
      ELSE '[]'::jsonb
    END;
    IF jsonb_typeof(v_order.payload->'lists'->'additional') = 'array' THEN
      v_sundries := v_sundries || (v_order.payload->'lists'->'additional');
    END IF;
    IF jsonb_array_length(v_sundries) = 0 AND jsonb_typeof(v_order.materials) = 'array' THEN
      v_sundries := v_order.materials;
    END IF;
    IF jsonb_array_length(v_paint) = 0 AND jsonb_array_length(v_sundries) = 0 THEN
      CONTINUE;
    END IF;

    v_separate := coalesce(v_order.payload->>'separateSundriesVendor', '') IN ('true', 't', '1');
    v_paint_vendor := trim(coalesce(v_order.payload->>'vendor', ''));
    v_sundry_vendor := trim(coalesce(nullif(v_order.payload->>'sundriesVendor', ''), v_order.payload->>'vendor', ''));
    v_paint_po := v_pos[1];
    v_sundry_po := v_pos[1];
    IF v_separate AND array_length(v_pos, 1) > 1 AND jsonb_array_length(v_sundries) > 0 THEN
      v_sundry_po := v_pos[array_length(v_pos, 1)];
    END IF;

    FOR v_item IN SELECT value FROM jsonb_array_elements(v_paint)
    LOOP
      v_buckets := public.field_tools_po_material_bucket(
        v_buckets, v_paint_po, 'paint', v_paint_vendor, v_item
      );
    END LOOP;
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_sundries)
    LOOP
      v_buckets := public.field_tools_po_material_bucket(
        v_buckets, v_sundry_po, 'sundry', v_sundry_vendor, v_item
      );
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'pos', coalesce((
      SELECT jsonb_agg(entry.value ORDER BY entry.value->>'po_number')
      FROM jsonb_each(v_buckets) AS entry
      WHERE jsonb_array_length(coalesce(entry.value->'lines', '[]'::jsonb)) > 0
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_po_material_bucket(
  p_buckets jsonb,
  p_po text,
  p_source text,
  p_vendor text,
  p_item jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_detail text;
  v_qty text;
  v_category text;
  v_line jsonb;
  v_bucket jsonb;
BEGIN
  IF p_item IS NULL OR jsonb_typeof(p_item) <> 'object' THEN
    RETURN p_buckets;
  END IF;

  v_name := trim(coalesce(p_item->>'name', p_item->>'raw', ''));
  v_detail := trim(coalesce(p_item->>'detail', ''));
  IF v_name = '' THEN
    RETURN p_buckets;
  END IF;
  IF v_detail <> '' AND position(lower(v_detail) IN lower(v_name)) = 0 THEN
    v_name := v_name || ' · ' || v_detail;
  END IF;

  v_qty := substring(trim(coalesce(p_item->>'quantity', '')) FROM '^([0-9]+(?:[.][0-9]+)?)');
  IF v_qty IS NULL OR v_qty = '' THEN
    v_qty := '1';
  END IF;
  v_category := trim(coalesce(nullif(trim(coalesce(p_item->>'vendor', '')), ''), p_vendor, ''));

  v_bucket := coalesce(
    p_buckets->p_po,
    jsonb_build_object('po_number', p_po, 'vendor', v_category, 'lines', '[]'::jsonb)
  );
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(coalesce(v_bucket->'lines', '[]'::jsonb)) AS line
    WHERE lower(line->>'name') = lower(v_name)
      AND line->>'source' = p_source
  ) THEN
    RETURN p_buckets;
  END IF;

  v_line := jsonb_build_object(
    'source', p_source,
    'name', v_name,
    'quantity', v_qty,
    'category', v_category
  );
  v_bucket := jsonb_set(v_bucket, '{lines}', (v_bucket->'lines') || jsonb_build_array(v_line));
  IF trim(coalesce(v_bucket->>'vendor', '')) = '' AND v_category <> '' THEN
    v_bucket := jsonb_set(v_bucket, '{vendor}', to_jsonb(v_category));
  END IF;
  RETURN jsonb_set(p_buckets, ARRAY[p_po], v_bucket);
END;
$$;

REVOKE ALL ON FUNCTION public.field_tools_po_material_bucket(jsonb, text, text, text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.field_tools_list_job_po_materials(uuid, text, uuid, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
