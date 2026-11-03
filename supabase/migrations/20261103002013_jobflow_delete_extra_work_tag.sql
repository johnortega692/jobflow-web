-- Office admins can delete any field tag from JobFlow. Field Tools still deletes only its own drafts.

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
    RETURN jsonb_build_object('ok', false, 'error', 'You need an office admin account to delete a tag.');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles pr
    WHERE pr.id = auth.uid() AND pr.app_role = 'admin'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'You need an office admin account to delete a tag.');
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

REVOKE ALL ON FUNCTION public.jobflow_delete_extra_work_tag(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jobflow_delete_extra_work_tag(uuid) TO authenticated;

DROP POLICY IF EXISTS extra_work_tag_pdfs_admin_delete ON storage.objects;
CREATE POLICY extra_work_tag_pdfs_admin_delete
  ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'extra-work-tag-pdfs'
    AND public.is_approved_user(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.profiles pr
      WHERE pr.id = auth.uid() AND pr.app_role = 'admin'
    )
  );

NOTIFY pgrst, 'reload schema';
