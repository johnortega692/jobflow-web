-- Field Tools safety history: the caller's tailgate meetings, without signatures or photos.

CREATE OR REPLACE FUNCTION public.field_tools_list_my_tailgate_meetings(
  p_caller_id uuid,
  p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_tools_require_session(p_caller_id, p_session_token);
  RETURN jsonb_build_object(
    'ok', true,
    'meetings', COALESCE((
      SELECT jsonb_agg(row_to_json(s)::jsonb ORDER BY s.completed_at DESC)
      FROM (
        SELECT
          m.id,
          t.title AS topic_title,
          m.job_number,
          m.job_name,
          m.submitted_by_name,
          m.completed_at,
          COALESCE((
            SELECT jsonb_agg(trim(a->>'name') ORDER BY ord)
            FROM jsonb_array_elements(m.attendees) WITH ORDINALITY AS att(a, ord)
            WHERE trim(coalesce(a->>'name', '')) <> ''
          ), '[]'::jsonb) AS attendee_names
        FROM public.field_tools_tailgate_meetings m
        JOIN public.field_tools_tailgate_topics t ON t.id = m.topic_id
        WHERE m.submitted_by_profile_id = p_caller_id
        ORDER BY m.completed_at DESC
        LIMIT 80
      ) s
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.field_tools_list_my_tailgate_meetings(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.field_tools_list_my_tailgate_meetings(uuid, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
