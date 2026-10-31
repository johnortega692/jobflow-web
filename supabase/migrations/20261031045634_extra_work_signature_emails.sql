-- A signature request can go to more than one email. Addresses are stored comma-separated.

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
  v_part text;
  v_clean text[] := ARRAY[]::text[];
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

  v_phone := trim(coalesce(p_phone, ''));
  FOREACH v_part IN ARRAY regexp_split_to_array(lower(trim(coalesce(p_email, ''))), '\s*[,;]\s*')
  LOOP
    v_part := trim(v_part);
    IF v_part = '' THEN
      CONTINUE;
    END IF;
    IF v_part !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Enter a valid email.');
    END IF;
    IF NOT v_part = ANY (v_clean) THEN
      v_clean := array_append(v_clean, v_part);
    END IF;
  END LOOP;
  v_email := array_to_string(v_clean, ', ');

  IF v_email = '' AND v_phone = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Enter an email or a phone number.');
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

NOTIFY pgrst, 'reload schema';
