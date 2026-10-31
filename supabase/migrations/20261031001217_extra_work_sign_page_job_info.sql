-- Public signature page includes the project address and GC info for the PDF.

CREATE OR REPLACE FUNCTION public.field_tools_get_extra_work_sign_page(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tag public.field_tools_extra_work_tags%ROWTYPE;
  v_link public.field_tools_extra_work_links%ROWTYPE;
  v_project public.projects%ROWTYPE;
  v_info jsonb := '{}'::jsonb;
  v_street text := '';
  v_city text := '';
  v_address text := '';
  v_gc_super text := '';
  v_gc_name text := '';
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

  IF v_tag.project_id IS NOT NULL THEN
    SELECT * INTO v_project FROM public.projects WHERE id = v_tag.project_id;
    IF FOUND THEN
      v_info := coalesce(v_project.data -> 'job_info', '{}'::jsonb);
      IF jsonb_typeof(v_info) <> 'object' THEN
        v_info := '{}'::jsonb;
      END IF;
      v_street := coalesce(nullif(trim(coalesce(v_project.job_address, '')), ''), '');
      v_city := coalesce(nullif(trim(concat_ws(', ',
        nullif(trim(coalesce(v_info ->> 'job_city', '')), ''),
        nullif(trim(coalesce(v_info ->> 'job_zip', '')), ''),
        nullif(trim(coalesce(v_info ->> 'job_county', '')), '')
      )), ''), '');
      IF v_city = '' THEN
        v_city := coalesce(nullif(trim(coalesce(v_project.job_address2, '')), ''), '');
      END IF;
      v_address := coalesce(nullif(trim(concat_ws(', ', nullif(v_street, ''), nullif(v_city, ''))), ''), '');
      IF v_address = '' THEN
        v_address := coalesce(nullif(trim(coalesce(v_info ->> 'gc_address', '')), ''), '');
      END IF;
      v_gc_super := trim(coalesce(v_info ->> 'gc_superintendent', ''));
      IF lower(v_gc_super) = 'tbd' THEN
        v_gc_super := '';
      END IF;
      v_gc_name := trim(coalesce(v_project.contractor, ''));
    END IF;
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
    'job_address', v_address,
    'gc_name', v_gc_name,
    'gc_job_number', trim(coalesce(v_info ->> 'gc_job_number', '')),
    'gc_address', trim(coalesce(v_info ->> 'gc_address', '')),
    'gc_phone', trim(coalesce(v_info ->> 'gc_office_phone', '')),
    'gc_super', v_gc_super,
    'gc_super_phone', trim(coalesce(v_info ->> 'gc_super_phone', '')),
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
