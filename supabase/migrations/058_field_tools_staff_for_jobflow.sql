-- JobFlow office: list Field Tools supers/foremen for new-project and job-setup dropdowns.

CREATE OR REPLACE FUNCTION public.list_field_tools_staff_for_jobflow()
RETURNS TABLE (
  id uuid,
  person_id uuid,
  name text,
  email text,
  role text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ftp.id,
    ftp.person_id,
    trim(ftp.name),
    trim(ftp.email),
    ftp.role
  FROM public.field_tools_profiles ftp
  WHERE ftp.active = true
    AND ftp.role IN ('super', 'foreman')
    AND public.is_approved_user(auth.uid())
  ORDER BY
    CASE ftp.role WHEN 'super' THEN 0 WHEN 'foreman' THEN 1 ELSE 2 END,
    lower(trim(ftp.name));
$$;

GRANT EXECUTE ON FUNCTION public.list_field_tools_staff_for_jobflow() TO authenticated;

COMMENT ON FUNCTION public.list_field_tools_staff_for_jobflow IS
  'Approved JobFlow users: active Field Tools super/foreman profiles for project staff pickers.';
