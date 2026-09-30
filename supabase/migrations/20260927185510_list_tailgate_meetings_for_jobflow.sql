-- Approved JobFlow users can list toolbox talks submitted from Field Tools for one job.
-- Signatures stay on the meeting row; this returns a count only.

CREATE OR REPLACE FUNCTION public.list_tailgate_meetings_for_jobflow(p_project_id uuid)
RETURNS TABLE (
  id uuid,
  title text,
  submitted_by_name text,
  completed_at timestamptz,
  attendee_count integer,
  notes text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.id,
    coalesce(nullif(trim(t.title), ''), 'Toolbox talk'),
    coalesce(nullif(trim(m.submitted_by_name), ''), 'Field user'),
    m.completed_at,
    CASE
      WHEN jsonb_typeof(m.attendees) = 'array' THEN jsonb_array_length(m.attendees)
      ELSE 0
    END,
    trim(coalesce(m.notes, ''))
  FROM public.field_tools_tailgate_meetings m
  JOIN public.field_tools_tailgate_topics t ON t.id = m.topic_id
  JOIN public.projects p ON p.id = p_project_id
  WHERE public.is_approved_user(auth.uid())
    AND (
      m.project_id = p.id
      OR (
        m.project_id IS NULL
        AND trim(m.job_number) <> ''
        AND trim(m.job_number) = trim(p.job_number)
      )
    )
  ORDER BY m.completed_at DESC;
$$;

REVOKE ALL ON FUNCTION public.list_tailgate_meetings_for_jobflow(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_tailgate_meetings_for_jobflow(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_tailgate_meetings_for_jobflow(uuid) TO authenticated;

COMMENT ON FUNCTION public.list_tailgate_meetings_for_jobflow(uuid) IS
  'Approved JobFlow users: toolbox talks submitted from Field Tools for one project. No signatures.';

NOTIFY pgrst, 'reload schema';
