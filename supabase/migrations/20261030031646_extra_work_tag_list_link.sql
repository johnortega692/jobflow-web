-- List each tag's latest live signature link so the field list can show expiry without storing raw tokens.

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
             ), '') AS copy_to_email,
             coalesce(live.sent_to_email, '') AS link_email,
             coalesce(live.sent_to_phone, '') AS link_phone,
             live.expires_at AS link_expires_at
      FROM public.field_tools_extra_work_tags
      LEFT JOIN LATERAL (
        SELECT l.sent_to_email, l.sent_to_phone, l.expires_at
        FROM public.field_tools_extra_work_links l
        WHERE l.tag_id = public.field_tools_extra_work_tags.id
          AND l.retired_at IS NULL
        ORDER BY l.created_at DESC
        LIMIT 1
      ) live ON true
      WHERE submitted_by_profile_id = p_caller_id
    ) t
  ), '[]'::jsonb);
END;
$$;

NOTIFY pgrst, 'reload schema';
