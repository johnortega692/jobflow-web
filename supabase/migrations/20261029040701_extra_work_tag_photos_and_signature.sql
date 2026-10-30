-- Extra-work photos, in-person signature, and a one-time GC signature link.

ALTER TABLE public.field_tools_extra_work_tags
  DROP CONSTRAINT IF EXISTS field_tools_extra_work_tags_status_check;

ALTER TABLE public.field_tools_extra_work_tags
  ADD CONSTRAINT field_tools_extra_work_tags_status_check
  CHECK (status IN ('draft', 'waiting', 'signed', 'refused'));

ALTER TABLE public.field_tools_extra_work_tags
  ADD COLUMN IF NOT EXISTS photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS signer_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS signer_company text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS signature_png text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS refused_note text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS public.field_tools_extra_work_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_id uuid NOT NULL REFERENCES public.field_tools_extra_work_tags (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  sent_to_email text NOT NULL DEFAULT '',
  sent_to_phone text NOT NULL DEFAULT '',
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.field_tools_extra_work_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.field_tools_extra_work_links FROM anon, authenticated;

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
             signature_png, signed_at, refused_note, updated_at
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
             refused_note, updated_at
      FROM public.field_tools_extra_work_tags
      WHERE project_id = p_project_id
    ) t
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_set_extra_work_photos(
  p_caller_id uuid,
  p_session_token text,
  p_id uuid,
  p_photos jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.field_tools_profiles%ROWTYPE;
  v_photos jsonb := '[]'::jsonb;
  v_item jsonb;
  v_jpeg text;
  v_count int := 0;
BEGIN
  PERFORM public.field_tools_require_session(p_caller_id, p_session_token);

  SELECT * INTO v_profile
  FROM public.field_tools_profiles
  WHERE id = p_caller_id AND active = true;
  IF NOT FOUND OR NOT ('extra_work' = ANY (coalesce(v_profile.modules, '{}'::text[]))) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Extra work tags are not turned on for this profile.');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.field_tools_extra_work_tags
    WHERE id = p_id AND submitted_by_profile_id = p_caller_id AND status = 'draft'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Photos can only be changed on a draft.');
  END IF;

  IF jsonb_typeof(coalesce(p_photos, '[]'::jsonb)) = 'array' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_photos)
    LOOP
      v_jpeg := regexp_replace(trim(coalesce(v_item->>'image_jpeg', '')), '^data:image/jpeg;base64,', '');
      IF v_jpeg = '' THEN
        CONTINUE;
      END IF;
      IF length(v_jpeg) > 400000 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'One of the photos is too large.');
      END IF;
      v_count := v_count + 1;
      IF v_count > 6 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'A tag can have up to 6 photos.');
      END IF;
      v_photos := v_photos || jsonb_build_array(jsonb_build_object('image_jpeg', v_jpeg));
    END LOOP;
  END IF;

  UPDATE public.field_tools_extra_work_tags
  SET photos = v_photos
  WHERE id = p_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_sign_extra_work_tag(
  p_caller_id uuid,
  p_session_token text,
  p_id uuid,
  p_signer_name text,
  p_signer_company text,
  p_signature_png text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tag public.field_tools_extra_work_tags%ROWTYPE;
  v_signature text;
BEGIN
  PERFORM public.field_tools_require_session(p_caller_id, p_session_token);

  IF NOT EXISTS (
    SELECT 1 FROM public.field_tools_profiles
    WHERE id = p_caller_id AND active = true
      AND 'extra_work' = ANY (coalesce(modules, '{}'::text[]))
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Extra work tags are not turned on for this profile.');
  END IF;

  SELECT * INTO v_tag
  FROM public.field_tools_extra_work_tags
  WHERE id = p_id AND submitted_by_profile_id = p_caller_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'That tag could not be signed.');
  END IF;
  IF v_tag.status NOT IN ('draft', 'waiting') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This tag is already finished.');
  END IF;
  IF trim(coalesce(p_signer_name, '')) = '' OR trim(coalesce(p_signer_company, '')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Enter the signer''s name and company.');
  END IF;
  v_signature := trim(coalesce(p_signature_png, ''));
  IF v_signature = '' OR length(v_signature) > 500000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sign in the box.');
  END IF;

  UPDATE public.field_tools_extra_work_tags
  SET
    status = 'signed',
    signer_name = trim(p_signer_name),
    signer_company = trim(p_signer_company),
    signature_png = v_signature,
    signed_at = now(),
    refused_note = ''
  WHERE id = p_id;

  UPDATE public.field_tools_extra_work_links
  SET retired_at = now()
  WHERE tag_id = p_id AND used_at IS NULL AND retired_at IS NULL;

  RETURN jsonb_build_object('ok', true, 'tag_number', v_tag.tag_number);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_request_extra_work_signature(
  p_caller_id uuid,
  p_session_token text,
  p_id uuid,
  p_email text,
  p_phone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tag public.field_tools_extra_work_tags%ROWTYPE;
  v_token text;
  v_email text;
  v_phone text;
BEGIN
  PERFORM public.field_tools_require_session(p_caller_id, p_session_token);

  IF NOT EXISTS (
    SELECT 1 FROM public.field_tools_profiles
    WHERE id = p_caller_id AND active = true
      AND 'extra_work' = ANY (coalesce(modules, '{}'::text[]))
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Extra work tags are not turned on for this profile.');
  END IF;

  SELECT * INTO v_tag
  FROM public.field_tools_extra_work_tags
  WHERE id = p_id AND submitted_by_profile_id = p_caller_id;
  IF NOT FOUND OR v_tag.status NOT IN ('draft', 'waiting') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'That tag cannot be sent for signature.');
  END IF;

  v_email := lower(trim(coalesce(p_email, '')));
  v_phone := trim(coalesce(p_phone, ''));
  IF v_email = '' AND v_phone = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Enter an email or a phone number.');
  END IF;
  IF v_email <> '' AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Enter a valid email.');
  END IF;

  UPDATE public.field_tools_extra_work_links
  SET retired_at = now()
  WHERE tag_id = p_id AND used_at IS NULL AND retired_at IS NULL;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.field_tools_extra_work_links (tag_id, token_hash, sent_to_email, sent_to_phone, expires_at)
  VALUES (
    p_id,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    v_email,
    v_phone,
    now() + interval '3 days'
  );

  UPDATE public.field_tools_extra_work_tags
  SET status = 'waiting'
  WHERE id = p_id AND status = 'draft';

  RETURN jsonb_build_object('ok', true, 'token', v_token, 'email', v_email, 'phone', v_phone, 'tag_number', v_tag.tag_number);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_extra_work_link_for_mail(
  p_caller_id uuid,
  p_session_token text,
  p_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
BEGIN
  PERFORM public.field_tools_require_session(p_caller_id, p_session_token);

  SELECT t.job_number, t.job_name, t.tag_number, l.sent_to_email, l.expires_at
  INTO v_row
  FROM public.field_tools_extra_work_links l
  JOIN public.field_tools_extra_work_tags t ON t.id = l.tag_id
  WHERE l.token_hash = encode(extensions.digest(trim(coalesce(p_token, '')), 'sha256'), 'hex')
    AND t.submitted_by_profile_id = p_caller_id
    AND l.used_at IS NULL
    AND l.retired_at IS NULL
    AND l.expires_at > now()
    AND l.sent_to_email <> '';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'That signature link is no longer active.');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'email', v_row.sent_to_email,
    'job_number', v_row.job_number,
    'job_name', v_row.job_name,
    'tag_number', v_row.tag_number,
    'expires_at', v_row.expires_at
  );
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
    'expires_at', v_link.expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_submit_extra_work_signature(
  p_token text,
  p_signer_name text,
  p_signer_company text,
  p_signature_png text,
  p_decision text,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tag public.field_tools_extra_work_tags%ROWTYPE;
  v_link public.field_tools_extra_work_links%ROWTYPE;
  v_decision text;
  v_signature text;
BEGIN
  SELECT * INTO v_link
  FROM public.field_tools_extra_work_links
  WHERE token_hash = encode(extensions.digest(trim(coalesce(p_token, '')), 'sha256'), 'hex')
  FOR UPDATE;
  IF NOT FOUND OR v_link.retired_at IS NOT NULL OR v_link.used_at IS NOT NULL OR v_link.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This link is no longer valid.');
  END IF;

  SELECT * INTO v_tag
  FROM public.field_tools_extra_work_tags
  WHERE id = v_link.tag_id
  FOR UPDATE;
  IF NOT FOUND OR v_tag.status <> 'waiting' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This tag has already been answered.');
  END IF;

  v_decision := lower(trim(coalesce(p_decision, '')));
  IF trim(coalesce(p_signer_name, '')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Enter your name.');
  END IF;

  IF v_decision = 'refuse' THEN
    UPDATE public.field_tools_extra_work_tags
    SET status = 'refused', signer_name = trim(p_signer_name), signer_company = trim(coalesce(p_signer_company, '')),
        refused_note = trim(coalesce(p_note, '')), signed_at = now(), signature_png = ''
    WHERE id = v_tag.id;
  ELSIF v_decision = 'sign' THEN
    IF trim(coalesce(p_signer_company, '')) = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Enter your company.');
    END IF;
    v_signature := trim(coalesce(p_signature_png, ''));
    IF v_signature = '' OR length(v_signature) > 500000 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Sign in the box.');
    END IF;
    UPDATE public.field_tools_extra_work_tags
    SET status = 'signed', signer_name = trim(p_signer_name), signer_company = trim(p_signer_company),
        signature_png = v_signature, signed_at = now(), refused_note = ''
    WHERE id = v_tag.id;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'Choose sign or refuse.');
  END IF;

  UPDATE public.field_tools_extra_work_links
  SET used_at = now()
  WHERE id = v_link.id;

  UPDATE public.field_tools_extra_work_links
  SET retired_at = now()
  WHERE tag_id = v_tag.id AND id <> v_link.id AND used_at IS NULL AND retired_at IS NULL;

  RETURN jsonb_build_object('ok', true, 'status', CASE WHEN v_decision = 'refuse' THEN 'refused' ELSE 'signed' END);
END;
$$;

REVOKE ALL ON FUNCTION public.field_tools_set_extra_work_photos(uuid, text, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.field_tools_sign_extra_work_tag(uuid, text, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.field_tools_request_extra_work_signature(uuid, text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.field_tools_extra_work_link_for_mail(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.field_tools_get_extra_work_sign_page(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.field_tools_submit_extra_work_signature(text, text, text, text, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.field_tools_set_extra_work_photos(uuid, text, uuid, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_sign_extra_work_tag(uuid, text, uuid, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_request_extra_work_signature(uuid, text, uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_extra_work_link_for_mail(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.field_tools_get_extra_work_sign_page(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_submit_extra_work_signature(text, text, text, text, text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
