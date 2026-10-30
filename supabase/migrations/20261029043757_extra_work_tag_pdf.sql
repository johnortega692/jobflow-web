-- Store the extra-work tag PDF so it can be emailed and opened again.

ALTER TABLE public.field_tools_extra_work_tags
  ADD COLUMN IF NOT EXISTS pdf_storage_path text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS pdf_filename text NOT NULL DEFAULT '';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'extra-work-tag-pdfs',
  'extra-work-tag-pdfs',
  false,
  26214400,
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

DROP POLICY IF EXISTS extra_work_tag_pdfs_admin_read ON storage.objects;
CREATE POLICY extra_work_tag_pdfs_admin_read
  ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'extra-work-tag-pdfs'
    AND public.is_approved_user(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.profiles pr
      WHERE pr.id = auth.uid() AND pr.app_role = 'admin'
    )
    AND EXISTS (
      SELECT 1 FROM public.field_tools_extra_work_tags t
      WHERE t.pdf_storage_path = name
        AND t.pdf_storage_path <> ''
    )
  );

CREATE OR REPLACE FUNCTION public.field_tools_list_my_extra_work_tags(
  p_caller_id uuid,
  p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.field_tools_profiles%ROWTYPE;
BEGIN
  PERFORM public.field_tools_require_session(p_caller_id, p_session_token);

  SELECT * INTO v_profile
  FROM public.field_tools_profiles
  WHERE id = p_caller_id AND active = true;
  IF NOT FOUND OR NOT ('extra_work' = ANY (coalesce(v_profile.modules, '{}'::text[]))) THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(t) ORDER BY t.updated_at DESC)
    FROM (
      SELECT id, project_id, job_number, job_name, tag_number, tag_date, area, description,
             hours, materials, photos, status, submitted_by_name, signer_name, signer_company,
             signature_png, signed_at, refused_note, pdf_storage_path, pdf_filename, updated_at,
             coalesce((
               SELECT l.sent_to_email
               FROM public.field_tools_extra_work_links l
               WHERE l.tag_id = public.field_tools_extra_work_tags.id
                 AND l.retired_at IS NULL
                 AND trim(l.sent_to_email) <> ''
               ORDER BY l.created_at DESC
               LIMIT 1
             ), '') AS copy_to_email
      FROM public.field_tools_extra_work_tags
      WHERE submitted_by_profile_id = p_caller_id
    ) t
  ), '[]'::jsonb);
END;
$$;

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
             refused_note, labor_amount, material_amount, pdf_storage_path, pdf_filename, updated_at
      FROM public.field_tools_extra_work_tags
      WHERE project_id = p_project_id
    ) t
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_get_extra_work_sign_page(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tag public.field_tools_extra_work_tags%ROWTYPE;
  v_link public.field_tools_extra_work_links%ROWTYPE;
  v_submitter text := '';
  v_to text := '';
  v_cc text := '';
BEGIN
  SELECT * INTO v_link
  FROM public.field_tools_extra_work_links
  WHERE token_hash = encode(extensions.digest(trim(coalesce(p_token, '')), 'sha256'), 'hex');
  IF NOT FOUND OR v_link.retired_at IS NOT NULL OR v_link.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This link is no longer valid.');
  END IF;

  SELECT * INTO v_tag FROM public.field_tools_extra_work_tags WHERE id = v_link.tag_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This link is no longer valid.');
  END IF;
  IF v_link.used_at IS NOT NULL OR v_tag.status IN ('signed', 'refused') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This tag has already been answered.', 'status', v_tag.status);
  END IF;

  SELECT lower(trim(coalesce(email, ''))) INTO v_submitter
  FROM public.field_tools_profiles
  WHERE id = v_tag.submitted_by_profile_id;
  v_to := lower(trim(coalesce(v_link.sent_to_email, '')));
  v_cc := coalesce(v_submitter, '');
  IF v_to = '' THEN
    v_to := v_cc;
    v_cc := '';
  ELSIF v_cc = v_to THEN
    v_cc := '';
  END IF;
  IF v_to <> '' AND v_to !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    v_to := '';
    v_cc := '';
  END IF;
  IF v_cc <> '' AND v_cc !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    v_cc := '';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'tag_number', v_tag.tag_number,
    'job_number', v_tag.job_number,
    'job_name', v_tag.job_name,
    'tag_date', v_tag.tag_date,
    'area', v_tag.area,
    'description', v_tag.description,
    'hours', v_tag.hours,
    'materials', v_tag.materials,
    'photos', v_tag.photos,
    'expires_at', v_link.expires_at,
    'copy_to_email', v_to,
    'copy_cc_email', v_cc
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
