-- Field tags are for every approved JobFlow user (PMs included): view, open PDFs, price, and delete.

CREATE OR REPLACE FUNCTION public.list_extra_work_tags_for_jobflow(p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved_user(auth.uid()) THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(t) ORDER BY t.tag_number DESC, t.updated_at DESC)
    FROM (
      SELECT id, tag_number, tag_date, area, description, hours, materials, photos, status,
             submitted_by_name, signer_name, signer_company, signature_png, signed_at,
             refused_note, labor_amount, material_amount, pdf_storage_path, pdf_filename, updated_at
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
    RETURN jsonb_build_object('ok', false, 'error', 'You need an approved JobFlow account to price a tag.');
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

CREATE OR REPLACE FUNCTION public.jobflow_delete_extra_work_tag(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_pdf text;
  v_number text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved_user(auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'You need an approved JobFlow account to delete a tag.');
  END IF;

  DELETE FROM public.field_tools_extra_work_tags
  WHERE id = p_id
  RETURNING id, coalesce(pdf_storage_path, ''), tag_number INTO v_id, v_pdf, v_number;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'That tag was not found.');
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'tag_number', v_number, 'pdf_storage_path', v_pdf);
END;
$$;

DROP POLICY IF EXISTS field_tools_extra_work_tags_admin_read ON public.field_tools_extra_work_tags;
DROP POLICY IF EXISTS field_tools_extra_work_tags_user_read ON public.field_tools_extra_work_tags;
CREATE POLICY field_tools_extra_work_tags_user_read
  ON public.field_tools_extra_work_tags
  FOR SELECT TO authenticated
  USING (public.is_approved_user(auth.uid()));

DROP POLICY IF EXISTS extra_work_tag_pdfs_admin_read ON storage.objects;
DROP POLICY IF EXISTS extra_work_tag_pdfs_user_read ON storage.objects;
CREATE POLICY extra_work_tag_pdfs_user_read
  ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'extra-work-tag-pdfs'
    AND public.is_approved_user(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.field_tools_extra_work_tags t
      WHERE t.pdf_storage_path = objects.name AND t.pdf_storage_path <> ''
    )
  );

DROP POLICY IF EXISTS extra_work_tag_pdfs_admin_delete ON storage.objects;
DROP POLICY IF EXISTS extra_work_tag_pdfs_user_delete ON storage.objects;
CREATE POLICY extra_work_tag_pdfs_user_delete
  ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'extra-work-tag-pdfs'
    AND public.is_approved_user(auth.uid())
  );

NOTIFY pgrst, 'reload schema';
