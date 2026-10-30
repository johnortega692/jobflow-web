-- Office price on a signed field tag. The field never writes these amounts.

ALTER TABLE public.field_tools_extra_work_tags
  ADD COLUMN IF NOT EXISTS labor_amount numeric,
  ADD COLUMN IF NOT EXISTS material_amount numeric;

CREATE OR REPLACE FUNCTION public.list_extra_work_tags_for_jobflow(p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_approved_user(auth.uid()) THEN
    RETURN '[]'::jsonb;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles pr
    WHERE pr.id = auth.uid() AND pr.app_role = 'admin'
  ) THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(t) ORDER BY t.tag_number DESC, t.updated_at DESC)
    FROM (
      SELECT id, tag_number, tag_date, area, description, hours, materials, photos, status,
             submitted_by_name, signer_name, signer_company, signature_png, signed_at,
             refused_note, labor_amount, material_amount, updated_at
      FROM public.field_tools_extra_work_tags
      WHERE project_id = p_project_id
    ) t
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.jobflow_set_extra_work_tag_price(
  p_id uuid,
  p_labor numeric,
  p_material numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_labor numeric;
  v_material numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved_user(auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'You need an office admin account to price a tag.');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles pr
    WHERE pr.id = auth.uid() AND pr.app_role = 'admin'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'You need an office admin account to price a tag.');
  END IF;

  SELECT status INTO v_status
  FROM public.field_tools_extra_work_tags
  WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'That tag could not be priced.');
  END IF;
  IF v_status <> 'signed' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'A tag can be priced after it is signed.');
  END IF;
  IF p_labor IS NULL OR p_material IS NULL
     OR p_labor < 0 OR p_material < 0
     OR p_labor > 9999999.99 OR p_material > 9999999.99 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Enter a labor amount and a material amount.');
  END IF;

  v_labor := round(p_labor, 2);
  v_material := round(p_material, 2);
  UPDATE public.field_tools_extra_work_tags
  SET labor_amount = v_labor,
      material_amount = v_material
  WHERE id = p_id;

  RETURN jsonb_build_object(
    'ok', true,
    'labor_amount', v_labor,
    'material_amount', v_material,
    'total_amount', v_labor + v_material
  );
END;
$$;

REVOKE ALL ON FUNCTION public.jobflow_set_extra_work_tag_price(uuid, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.jobflow_set_extra_work_tag_price(uuid, numeric, numeric) TO authenticated;

NOTIFY pgrst, 'reload schema';
